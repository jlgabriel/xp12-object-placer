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

import type { ObjectGeometry } from '../../shared/api.js';
import { createThumbnailRenderer, type ThumbnailRenderer } from './gl.js';

/** Pixels. Twice the size it is shown at, so it stays sharp on a high-density screen. */
const SIZE = 128;

/**
 * Pixels, for the picture the hover preview enlarges.
 *
 * Drawn again at this size rather than blown up from the 128 in the row, which is the whole point
 * of the preview: an object you cannot make out at 44px is not made out any better by scaling the
 * same 128 pixels to 240 — you get the same doubt, softer. Twice the size it is shown at, for the
 * same reason SIZE is.
 *
 * It never goes to the disk cache. That cache is keyed by virtual path with no size in the key, so
 * writing this into it would hand every row a picture four times the weight it needs.
 */
const LARGE_SIZE = 480;

/**
 * How many thumbnails to keep decoded in memory.
 *
 * Each is an object URL over a PNG of a few kilobytes, and they have to be revoked or the session
 * leaks them one scroll at a time. Comfortably more than fits on screen, so scrolling back up never
 * redraws.
 */
const MEMORY_LIMIT = 300;

/** The same, for the large ones. You look at one at a time, and each is a hundred kilobytes. */
const LARGE_MEMORY_LIMIT = 8;

/** At once. The work is mostly main reading files, and a queue of four keeps it busy without
 *  flooding the bridge with requests for rows that scrolled past before they were answered. */
const CONCURRENCY = 4;

export interface ThumbnailService {
  /** The picture for an object, or null if it cannot be drawn. Safe to call repeatedly. */
  get(virtualPath: string): Promise<string | null>;
  /**
   * The same object drawn large, for the hover preview.
   *
   * Memory only, and a small memory at that: it is one object, looked at once, and the next hover
   * is somewhere else.
   */
  getLarge(virtualPath: string): Promise<string | null>;
  /**
   * What is already drawn for this object, without asking for anything.
   *
   * `undefined` means nothing has been drawn yet. It exists so the preview can open on the small
   * picture the row is already showing — blurred, but instantly — and swap to the sharp one when
   * it arrives, rather than opening on an empty frame.
   */
  peek(virtualPath: string): string | null | undefined;
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
  /** The hover preview's pictures, kept apart because they are a different size of the same thing. */
  const large = new Map<string, string | null>();
  const largePending = new Map<string, Promise<string | null>>();

  let renderer: ThumbnailRenderer | null = null;
  let largeRenderer: ThumbnailRenderer | null = null;
  let running = 0;
  const queue: Array<() => void> = [];

  const canvas = (size: number): HTMLCanvasElement => {
    const element = document.createElement('canvas');
    element.width = size;
    element.height = size;
    return element;
  };

  /** Created on first use, so a session that never scrolls the catalog never makes a GL context. */
  const gl = (): ThumbnailRenderer => (renderer ??= createThumbnailRenderer(canvas(SIZE)));

  /**
   * And a second one, its own size, created on the first hover that rests long enough.
   *
   * A separate context rather than resizing the first canvas between draws: the small ones are
   * drawn four at a time and a shared canvas would have them resizing under each other. Two
   * contexts is nowhere near the browser's limit, and a session that never hovers never makes it.
   */
  const largeGl = (): ThumbnailRenderer =>
    (largeRenderer ??= createThumbnailRenderer(canvas(LARGE_SIZE)));

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

  const remember = (
    store: Map<string, string | null>,
    limit: number,
    virtualPath: string,
    url: string | null,
  ): string | null => {
    store.set(virtualPath, url);
    while (store.size > limit) {
      const [oldest, oldestUrl] = store.entries().next().value as [string, string | null];
      store.delete(oldest);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
    return url;
  };

  const urlFor = (bytes: Uint8Array): string =>
    URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));

  /** One object, into whichever canvas was asked for, as PNG bytes. */
  async function paint(
    renderer: ThumbnailRenderer,
    geometry: ObjectGeometry,
  ): Promise<Uint8Array | null> {
    renderer.render({
      mesh: geometry.mesh,
      bounds: geometry.bounds,
      ...(geometry.texture ? { texture: geometry.texture } : {}),
      // A marking, a drain, an oil stain: flat on the ground. The three-quarter view that
      // flatters a hangar reduces one of these to a bright thread, so they are looked at from
      // much higher up — nearly overhead, which is also how you would ever see one.
      ...(geometry.grounded ? { framing: { elevation: (68 * Math.PI) / 180 } } : {}),
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      (renderer.canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'),
    );
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  async function draw(virtualPath: string): Promise<string | null> {
    const cached = await bridge.getThumbnail(virtualPath);
    if (cached) return urlFor(cached);

    const bytes = await paint(gl(), await bridge.getObjectGeometry(virtualPath));
    if (!bytes) return null;

    // Store it before handing it over. If this throws, the picture is still shown this session —
    // failing to cache is not a reason to show nothing.
    void bridge.putThumbnail(virtualPath, bytes).catch(() => undefined);
    return urlFor(bytes);
  }

  async function drawLarge(virtualPath: string): Promise<string | null> {
    // Straight to the geometry: the disk cache holds the small size only, and by design.
    const bytes = await paint(largeGl(), await bridge.getObjectGeometry(virtualPath));
    return bytes ? urlFor(bytes) : null;
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
        .then((url) => remember(memory, MEMORY_LIMIT, virtualPath, url))
        .finally(() => pending.delete(virtualPath));

      pending.set(virtualPath, request);
      return request;
    },

    peek(virtualPath) {
      return memory.get(virtualPath);
    },

    async getLarge(virtualPath) {
      if (large.has(virtualPath)) return large.get(virtualPath)!;
      const already = largePending.get(virtualPath);
      if (already) return already;

      // Outside the queue the small ones wait in, deliberately: this is the object the user is
      // looking at right now, and there is at most one of it in flight, so it does not need
      // protecting from itself. Behind four background rows it would arrive late for no reason.
      const request = drawLarge(virtualPath)
        .catch(() => null)
        .then((url) => remember(large, LARGE_MEMORY_LIMIT, virtualPath, url))
        .finally(() => largePending.delete(virtualPath));

      largePending.set(virtualPath, request);
      return request;
    },

    clear() {
      for (const url of memory.values()) if (url) URL.revokeObjectURL(url);
      memory.clear();
      for (const url of large.values()) if (url) URL.revokeObjectURL(url);
      large.clear();
    },

    dispose() {
      this.clear();
      renderer?.dispose();
      renderer = null;
      largeRenderer?.dispose();
      largeRenderer = null;
    },
  };
}
