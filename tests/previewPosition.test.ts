import { describe, expect, it } from 'vitest';
import { computePreviewPosition, type Rect } from '../src/renderer/catalog/previewPosition.js';

/** A catalog row, at the left of a 1400 × 900 window — the panel is 360 wide. */
function row(top: number, height = 71, left = 0, width = 360): Rect {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

const VIEWPORT = { width: 1400, height: 900 };
const PREVIEW = { width: 258, height: 300 };

describe('computePreviewPosition', () => {
  it('opens to the right of the row, clear of the panel', () => {
    const at = computePreviewPosition(row(200), PREVIEW, VIEWPORT);
    expect(at.left).toBe(370); // the row's right edge plus the gap
  });

  it('centres on the row', () => {
    const at = computePreviewPosition(row(200), PREVIEW, VIEWPORT);
    expect(at.top).toBe(200 + 71 / 2 - 300 / 2);
  });

  it('flips to the left when the right would not fit', () => {
    // The placed-objects panel is on the right, and its rows are anchors too.
    const at = computePreviewPosition(row(200, 40, 1100, 300), PREVIEW, VIEWPORT);
    expect(at.left).toBe(1100 - 10 - 258);
  });

  it('keeps the whole box on screen at the top', () => {
    const at = computePreviewPosition(row(4), PREVIEW, VIEWPORT);
    expect(at.top).toBe(8);
  });

  it('keeps the whole box on screen at the bottom', () => {
    const at = computePreviewPosition(row(880), PREVIEW, VIEWPORT);
    expect(at.top).toBe(900 - 300 - 8);
  });

  it('pins rather than goes negative when the box is taller than the window', () => {
    // A very long virtual path wraps to a taller box; a short window makes this ordinary rather
    // than exotic. Half a preview at the top margin beats one placed off the top of the screen.
    const at = computePreviewPosition(row(100), { width: 258, height: 700 }, { width: 1400, height: 500 });
    expect(at.top).toBe(8);
    expect(at.left).toBe(370);
  });

  it('pins to the left margin when it fits on neither side', () => {
    const narrow = { width: 300, height: 900 };
    const at = computePreviewPosition(row(100, 71, 0, 300), PREVIEW, narrow);
    expect(at.left).toBe(8);
  });
});
