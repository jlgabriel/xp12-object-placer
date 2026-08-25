/**
 * The picture the catalog shows when the mouse rests on a row.
 *
 * A row is 44 pixels tall, which is enough to tell a hangar from an aeroplane and not nearly
 * enough to tell one hangar from the next one. The whole catalog is 3 800 objects whose names are
 * `hangar_2b`, so the choice is either open the object in the simulator or look at it here.
 *
 * The idea is PCT's (its forum thread #170 asked for exactly this, and its `HoverPreview` does the
 * same job for a user-supplied photo). What crossed is the shape — a delayed, portalled, pointer-
 * transparent popup — and `previewPosition.ts`. The content did not: XOP has no photographs to
 * enlarge, it has geometry, so this asks the thumbnail service to draw the object again at four
 * times the size.
 *
 * Two things it does that the row cannot:
 *   • the object, drawn large enough to recognise;
 *   • its whole virtual path, in monospace — the string that ends up in the DSF, which the row can
 *     only show truncated. It used to live in a `title` tooltip, which is unreliable on macOS and
 *     is why PCT stopped using one.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CatalogEntry } from '../../shared/api.js';
import { thumbnails } from '../thumbnails/ObjectThumbnail.js';
import { computePreviewPosition, type Position } from './previewPosition.js';

export function ObjectPreview({
  entry,
  anchor,
}: {
  entry: CatalogEntry;
  /** The hovered row, in viewport coordinates. */
  anchor: DOMRect;
}): React.JSX.Element {
  const unavailable = entry.unavailable !== undefined;
  // Opens on whatever the row is already showing, so there is a picture in the frame from the
  // first frame; the sharp one replaces it a moment later. Never asked for at all when there is
  // nothing to draw.
  const [url, setUrl] = useState<string | null>(
    unavailable ? null : (thumbnails().peek(entry.virtualPath) ?? null),
  );
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (unavailable) return;
    let live = true;
    void thumbnails()
      .getLarge(entry.virtualPath)
      .then((large) => {
        // A large draw that fails leaves the small one up rather than blanking the frame.
        if (live && large) setUrl(large);
      });
    return () => {
      live = false;
    };
  }, [entry.virtualPath, unavailable]);

  // Measured, then placed: how tall the box is depends on how many lines the path wraps to, so
  // there is no arithmetic that could work this out in advance. useLayoutEffect runs before paint,
  // and until it has run the box is hidden — otherwise it would appear once in the wrong place.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setPosition(
      computePreviewPosition(
        anchor,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, url]);

  return createPortal(
    <div
      ref={box}
      className="object-preview"
      role="tooltip"
      style={{
        left: position?.left ?? anchor.right + 10,
        top: position?.top ?? anchor.top,
        visibility: position === null ? 'hidden' : 'visible',
      }}
    >
      {/* An object X-Plane would draw as nothing gets no frame at all. An empty square is not a
          picture of anything, and the reason is more useful than the space it would take. */}
      {!unavailable && (
        <span className="object-preview-frame">
          {url && <img src={url} alt="" draggable={false} />}
        </span>
      )}
      <span className="object-preview-path">{entry.virtualPath}</span>
      {entry.unavailable !== undefined && (
        <span className="object-preview-missing">{entry.unavailable}</span>
      )}
    </div>,
    document.body,
  );
}
