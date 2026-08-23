/**
 * The thumbnail renderer, against real geometry, in a browser.
 *
 * Same argument as the rest of this harness: the renderer normally runs inside Electron behind a
 * sandbox where nothing can be looked at. Here the framing, the lighting and the alpha cutout can
 * all be seen at once, on objects taken from a real installation.
 *
 * It also exercises the arrangement the app will use rather than a convenient one: a **single**
 * WebGL context drawing every thumbnail in turn, each result copied off to its own canvas. A
 * context per thumbnail would work here and fall over at the browser's limit of about sixteen,
 * where the older ones quietly go black.
 *
 * Sample data comes from `samples.local.json`, which is built by `npm run samples` from the
 * user's own installation and is gitignored — nothing from Laminar belongs in this repository.
 *
 *   npm run preview:ui  →  http://localhost:5200/dev/thumbnails.html
 */
import { createThumbnailRenderer, type ThumbnailTexture } from '../thumbnails/gl.js';
import type { Bounds, Obj8Mesh } from '../../core/obj8/parse.js';

const SIZE = 168;

interface Sample {
  readonly name: string;
  readonly virtualPath: string;
  readonly triangles: number;
  readonly grounded?: boolean;
  readonly bounds: Bounds;
  readonly mesh: { positions: string; normals: string; uvs: string; indices: string };
  readonly texture: null | {
    format: 'BC1' | 'BC3';
    width: number;
    height: number;
    data: string;
    from: string;
  };
}

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const summary = document.querySelector('#summary')!;
const grid = document.querySelector('#grid')!;
const errorBox = document.querySelector('#error')!;

async function main(): Promise<void> {
  const response = await fetch('./samples.local.json');
  if (!response.ok) {
    errorBox.textContent =
      'No samples.local.json. Build it from your own installation first:\n\n' +
      '  npm run samples';
    summary.textContent = '';
    return;
  }
  const samples: Sample[] = await response.json();

  // One canvas, one context, every thumbnail.
  const source = document.createElement('canvas');
  source.width = SIZE;
  source.height = SIZE;
  const renderer = createThumbnailRenderer(source);

  let total = 0;
  let textured = 0;

  for (const sample of samples) {
    const figure = document.createElement('figure');
    const shot = document.createElement('canvas');
    shot.className = 'shot';
    shot.width = SIZE;
    shot.height = SIZE;
    shot.dataset.name = sample.name;

    const caption = document.createElement('figcaption');
    figure.append(shot, caption);
    grid.append(figure);

    const mesh: Obj8Mesh = {
      positions: new Float32Array(bytesOf(sample.mesh.positions).buffer),
      normals: new Float32Array(bytesOf(sample.mesh.normals).buffer),
      uvs: new Float32Array(bytesOf(sample.mesh.uvs).buffer),
      indices: new Uint32Array(bytesOf(sample.mesh.indices).buffer),
    };
    const texture: ThumbnailTexture | undefined = sample.texture
      ? {
          format: sample.texture.format,
          width: sample.texture.width,
          height: sample.texture.height,
          data: bytesOf(sample.texture.data),
        }
      : undefined;

    try {
      const started = performance.now();
      renderer.render({
        mesh,
        bounds: sample.bounds,
        ...(texture ? { texture } : {}),
        // Flat on the ground: looked at from nearly overhead, as the app does.
        ...(sample.grounded ? { framing: { elevation: (68 * Math.PI) / 180 } } : {}),
      });
      const bitmap = await createImageBitmap(source);
      shot.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const ms = performance.now() - started;
      total += ms;
      if (texture) textured += 1;

      // How much of the square the object covers. A thumbnail that renders without error and
      // fills 0.3% of its frame is a failure that no exception reports, and reading it off the
      // pixels is the only way to catch it without looking at every one.
      const pixels = shot.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 8) opaque += 1;
      const coverage = (100 * opaque) / (SIZE * SIZE);
      shot.dataset.coverage = coverage.toFixed(1);

      caption.innerHTML =
        `${sample.name}<br><span class="meta">${sample.triangles.toLocaleString()} tris · ` +
        `${sample.texture ? sample.texture.format : 'untextured'} · ${ms.toFixed(0)} ms · ` +
        `${coverage.toFixed(0)}% of frame</span>`;
      if (coverage < 3) caption.querySelector('.meta')!.classList.add('fail');
    } catch (error) {
      shot.dataset.coverage = 'error';
      caption.innerHTML = `${sample.name}<br><span class="fail">${(error as Error).message}</span>`;
    }
  }

  summary.textContent =
    `${samples.length} objects · ${textured} textured · ` +
    `${total.toFixed(0)} ms total, ${(total / Math.max(1, samples.length)).toFixed(1)} ms each · ` +
    `compressed textures ${renderer.supportsCompressedTextures ? 'supported' : 'UNAVAILABLE'}`;
  document.body.dataset.done = 'true';
}

void main().catch((error: Error) => {
  errorBox.textContent = error.stack ?? error.message;
  document.body.dataset.done = 'error';
});
