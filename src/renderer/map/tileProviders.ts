/**
 * The map imagery underneath the objects.
 *
 * Pure — no Leaflet import — so the switcher, the map and any test share one table.
 *
 * `maxNativeZoom` below `maxZoom` means Leaflet keeps stretching the last real tile instead of
 * going blank. Placing a bollard is a metre-scale job, and the imagery runs out before the job does.
 */

import type { TileProviderId } from '../state/store.js';

export interface TileSource {
  readonly url: string;
  readonly attribution: string;
  readonly maxNativeZoom: number;
}

export const PROVIDER_LABEL: Readonly<Record<TileProviderId, string>> = {
  esri: 'Satellite',
  osm: 'Streets',
};

export const ESRI: TileSource = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxNativeZoom: 19,
};

export const OSM: TileSource = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxNativeZoom: 19,
};

export function tileSourceFor(provider: TileProviderId): TileSource {
  return provider === 'osm' ? OSM : ESRI;
}
