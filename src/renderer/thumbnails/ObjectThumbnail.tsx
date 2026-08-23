/**
 * The little picture at the front of a catalog row.
 *
 * It asks for its thumbnail only once the row is near the screen. With 3 700 objects in the list
 * that is the difference between drawing a few dozen and drawing all of them, and the ones nobody
 * scrolls to are never read off the disk at all.
 *
 * Until it has one, the row keeps its height with an empty frame. A picture that appears and pushes
 * everything down is worse than no picture: the object somebody was reaching for moves out from
 * under the cursor.
 */

import { useEffect, useRef, useState } from 'react';
import { createThumbnailService, type ThumbnailService } from './service.js';

let shared: ThumbnailService | null = null;

/** One service for the whole window: one GL context, one memory cache, one queue. */
export function thumbnails(): ThumbnailService {
  return (shared ??= createThumbnailService(window.xop));
}

/** Throw away every picture. Called after a rescan, when the objects themselves may have changed. */
export function forgetThumbnails(): void {
  shared?.clear();
}

export function ObjectThumbnail({
  virtualPath,
  unavailable,
}: {
  virtualPath: string;
  /** An object X-Plane would draw as nothing. Never asked for, because there is nothing to draw. */
  unavailable?: boolean;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const frame = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setUrl(null);
    if (unavailable) return;

    const element = frame.current;
    if (!element) return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void thumbnails()
          .get(virtualPath)
          .then((result) => {
            // The row can be recycled onto a different object while its thumbnail is in flight.
            if (!cancelled) setUrl(result);
          });
      },
      // Start a screenful early, so scrolling at a normal speed meets pictures already drawn.
      { rootMargin: '400px' },
    );
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [virtualPath, unavailable]);

  return (
    <span className="thumbnail" ref={frame} data-loaded={url ? 'yes' : 'no'} aria-hidden="true">
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
}
