/**
 * Where the hover preview lands beside the row it belongs to.
 *
 * Ported from PCT's `src/renderer/catalog/previewPosition.ts` (GPL-3.0, the same licence as this
 * project — see docs/LINEAGE.md). The rules are about a viewport and a box, not about a simulator,
 * which is why they crossed unchanged.
 *
 * Pure, and viewport-only: every input is already in `getBoundingClientRect` coordinates, so this
 * tests without a DOM and the popup — which is portalled to <body> and positioned `fixed` — can use
 * the answer directly, with no scroll offset entering anywhere.
 */

/** The part of a DOMRect this needs. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Position {
  readonly left: number;
  readonly top: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

/**
 * Beside the row, never on top of it.
 *
 * The anchor is the whole catalog row rather than its little picture, which is the one change from
 * PCT: the catalog is the left-hand panel, so a popup hung off the row's right edge clears the
 * panel entirely and floats over the map. Hung off the picture instead it would cover the name and
 * the measurements of the very object it is enlarging.
 *
 * Vertically it centres on the row and is then clamped, with a margin, so the box is always whole:
 * a preview taller than the window pins to the top margin rather than running off both ends.
 */
export function computePreviewPosition(
  anchor: Rect,
  preview: Size,
  viewport: Size,
  gap = 10,
): Position {
  const margin = 8;

  // To the right first — that is where the map is. Flip left only if it would not fit.
  let left = anchor.right + gap;
  if (left + preview.width + margin > viewport.width) {
    left = anchor.left - gap - preview.width;
  }
  left = clamp(left, margin, Math.max(margin, viewport.width - preview.width - margin));

  let top = anchor.top + anchor.height / 2 - preview.height / 2;
  top = clamp(top, margin, Math.max(margin, viewport.height - preview.height - margin));

  return { left, top };
}
