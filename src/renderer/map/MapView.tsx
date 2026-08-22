/**
 * The map.
 *
 * React owns the `<div>` and nothing else. Everything Leaflet is created inside the mount effect
 * and torn down in its cleanup, so React 19 StrictMode's setup → cleanup → setup is harmless — the
 * second mount would otherwise throw "Map container is already initialized".
 *
 * The store is read through a subscription **outside** React: a drag repaints on every mousemove
 * and must not queue a render to do it.
 */

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { editorStore, useEditor } from '../state/editorStore.js';
import type { TileProviderId } from '../state/store.js';
import { wrapLon } from '../../core/geo/geo.js';
import { tileSourceFor } from './tileProviders.js';
import { ObjectLayer } from './ObjectLayer.js';

function buildTileLayer(provider: TileProviderId): L.TileLayer {
  const source = tileSourceFor(provider);
  return L.tileLayer(source.url, {
    maxNativeZoom: source.maxNativeZoom,
    // Past the imagery's own resolution Leaflet stretches the last real tile rather than going
    // blank. Placing a bollard is a metre-scale job; the imagery runs out before the job does.
    maxZoom: 22,
    attribution: source.attribution,
  });
}

/** Typing in the search box must not delete the selected object. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function MapView(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const placing = useEditor((state) => state.placing);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const start = editorStore.getState().camera;
    const map = L.map(element, { attributionControl: true, zoomControl: true }).setView(
      [start.lat, start.lon],
      start.zoom,
    );

    let tileLayer = buildTileLayer(editorStore.getState().tiles).addTo(map);
    const unsubscribeTiles = editorStore.subscribe(
      (state) => state.tiles,
      (provider) => {
        tileLayer.remove();
        tileLayer = buildTileLayer(provider).addTo(map);
      },
    );

    // ⚠️ Leaflet measures its container once, at `setView`, and believes that number afterwards. A
    // container that has not been laid out yet measures 0 x 0, and the map then draws one tile,
    // clips every footprint away and sits there looking broken with no error anywhere.
    //
    // That is not a hypothetical: the window is created with `show: false` and only shown on
    // `ready-to-show`, so the renderer can very reasonably finish its first effects before the
    // browser has laid anything out. It reproduced first time in the preview harness, in a tab that
    // was not being composited — which is the same situation.
    //
    // Watching the container covers the whole family at once: first layout, the window being
    // restored from minimised, and any panel beside the map changing width later.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(element);

    const layer = new ObjectLayer(map, {
      onSelect: (id) => editorStore.getState().select(id),
      onMove: (id, position) => editorStore.getState().moveObject(id, position),
      onRotate: (id, rotation) => editorStore.getState().rotateObject(id, rotation),
    });

    const paint = (): void => {
      const state = editorStore.getState();
      layer.sync(state.objects, state.catalogIndex, state.selection);
    };
    paint();
    const unsubscribeObjects = editorStore.subscribe(
      (state) => [state.objects, state.catalogIndex, state.selection] as const,
      paint,
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] },
    );

    // Only a deliberate "go there" moves the camera. Panning and zooming never bump the epoch, so
    // looking around is never yanked back.
    const unsubscribeCamera = editorStore.subscribe(
      (state) => state.cameraEpoch,
      () => {
        const camera = editorStore.getState().camera;
        map.setView([camera.lat, camera.lon], camera.zoom);
      },
    );

    // A click on empty map places the armed object. A click on a footprint never reaches here —
    // that is what `bubblingMouseEvents: false` is for — so selecting is not placing.
    const onClick = (event: L.LeafletMouseEvent): void => {
      const state = editorStore.getState();
      if (state.placing !== null) {
        state.placeAt({ lon: wrapLon(event.latlng.lng), lat: event.latlng.lat });
      } else {
        state.select(null);
      }
    };
    map.on('click', onClick);

    const onMoveEnd = (): void => {
      const centre = map.getCenter();
      editorStore
        .getState()
        .setCamera({ lon: wrapLon(centre.lng), lat: centre.lat, zoom: map.getZoom() });
    };
    map.on('moveend', onMoveEnd);

    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      const state = editorStore.getState();
      if (event.key === 'Escape') state.arm(null);
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) {
        state.deleteObject(state.selection);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      resize.disconnect();
      unsubscribeObjects();
      unsubscribeCamera();
      unsubscribeTiles();
      layer.destroy();
      map.remove(); // frees the container so StrictMode's second mount can re-init it
    };
  }, []);

  // Toggled imperatively: React must NOT own this div's className. Leaflet writes its own classes
  // onto the same element after init, and re-rendering the div with a React-driven className wipes
  // them — losing `leaflet-container` drops its position/overflow and the map panes spill over the
  // panels beside it.
  useEffect(() => {
    ref.current?.classList.toggle('placing', placing !== null);
  }, [placing]);

  return <div ref={ref} className="xop-map" />;
}
