/**
 * Thumbnails, on demand, once each.
 *
 * The catalog has 3 700 objects in it and you look at a few dozen. So nothing is drawn until it is
 * about to be seen, and once drawn it is kept — in memory for this session, and on disk by main for
 * every session after.
 *
 * **No worker, deliberately.** The plan was OffscreenCanvas in a worker, until the drawing was
 * measured: a millisecond per object, less than a frame. What actually takes time is reading the
 * `.obj` and pulling a mip out of a multi-megabyte atlas, and that already happens in main, off
 * this thread, behind an await. Moving a one-millisecond draw to a worker would buy nothing and
 * cost a second copy of every mesh crossing a second boundary. If a 400 000-triangle object ever
 * makes this stutter, the worker is a small change from here — the renderer takes any canvas.
 */

import { createThumbnailRenderer, type ThumbnailRenderer } from './gl.js';

/** Pixels. Twice the size it is shown at, so it stays sharp on a high-density screen. */
const SIZE = 128;

/**
 * How many thumbnails to keep decoded in memory.
 *
 * Each is an object URL over a PNG of a few kilobytes, and they have to be revoked or the session
 * leaks them one scroll at a time. Comfortably more than fits on screen, so scrolling back up never
 * redraws.
 */
const MEMORY_LIMIT = 300;

/** At once. The work is mostly main reading files, and a queue of four keeps it busy without
 *  flooding the bridge with requests for rows that scrolled past before they were answered. */
const CONCURRENCY = 4;

export interface ThumbnailService {
  /** The picture for an object, or null if it cannot be drawn. Safe to call repeatedly. */
  get(virtualPath: string): Promise<string | null>;
  /** Forget everything. Called after a rescan, when the objects may have changed. */
  clear(): void;
  dispose(): void;
}

type Bridge = Pick<Window['xop'], 'getThumbnail' | 'getObjectGeometry' | 'putThumbnail'>;

export function createThumbnailService(bridge: Bridge): ThumbnailService {
  /** Resolved object URLs, oldest first — a Map preserves insertion order, which is the eviction order. */
  const memory = new Map<string, string | null>();
  /** In-flight requests, so two rows asking for the same object wait on one answer. */
  const pending = new Map<string, Promise<string | null>>();

  let renderer: ThumbnailRenderer | null = null;
  let running = 0;
  const queue: Array<() => void> = [];

  const canvas = (): HTMLCanvasElement => {
    const element = document.createElement('canvas');
    element.width = SIZE;
    element.height = SIZE;
    return element;
  };

  /** Created on first use, so a session that never scrolls the catalog never makes a GL context. */
  const gl = (): ThumbnailRenderer => (renderer ??= createThumbnailRenderer(canvas()));

  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= CONCURRENCY) await new Promise<void>((resolve) => queue.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      queue.shift()?.();
    }
  };

  const remember = (virtualPath: string, url: string | null): string | null => {
    memory.set(virtualPath, url);
    while (memory.size > MEMORY_LIMIT) {
      const [oldest, oldestUrl] = memory.entries().next().value as [string, string | null];
      memory.delete(oldest);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
    return url;
  };

  const urlFor = (bytes: Uint8Array): string =>
    URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));

  async function draw(virtualPath: string): Promise<string | null> {
    const cached = await bridge.getThumbnail(virtualPath);
    if (cached) return urlFor(cached);

    const geometry = await bridge.getObjectGeometry(virtualPath);
    gl().render({
      mesh: geometry.mesh,
      bounds: geometry.bounds,
      ...(geometry.texture ? { texture: geometry.texture } : {}),
      // A marking, a drain, an oil stain: flat on the ground. The three-quarter view that
      // flatters a hangar reduces one of these to a bright thread, so they are looked at from
      // much higher up — nearly overhead, which is also how you would ever see one.
      ...(geometry.grounded ? { framing: { elevation: (68 * Math.PI) / 180 } } : {}),
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      (gl().canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'),
    );
    if (!blob) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Store it before handing it over. If this throws, the picture is still shown this session —
    // failing to cache is not a reason to show nothing.
    void bridge.putThumbnail(virtualPath, bytes).catch(() => undefined);
    return urlFor(bytes);
  }

  return {
    async get(virtualPath) {
      if (memory.has(virtualPath)) return memory.get(virtualPath)!;
      const already = pending.get(virtualPath);
      if (already) return already;

      const request = slot(() => draw(virtualPath))
        // An object that cannot be drawn — no geometry, an unreadable file — is remembered as null
        // rather than retried on every scroll. The row shows its fallback and stops asking.
        .catch(() => null)
        .then((url) => remember(virtualPath, url))
        .finally(() => pending.delete(virtualPath));

      pending.set(virtualPath, request);
      return request;
    },

    clear() {
      for (const url of memory.values()) if (url) URL.revokeObjectURL(url);
      memory.clear();
    },

    dispose() {
      this.clear();
      renderer?.dispose();
      renderer = null;
    },
  };
}
