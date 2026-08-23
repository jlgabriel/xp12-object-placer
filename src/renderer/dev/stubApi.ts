import type {
  CatalogEntry,
  CatalogSnapshot,
  ExportResult,
  Installation,
  InstalledPack,
  DocumentState,
  XopApi,
} from '../../shared/api.js';
import type { Project } from '../../core/project/project.js';
import type { GroundBox } from '../../core/model.js';
import { DEFAULT_PACK_NAME } from '../../core/export/packName.js';

/**
 * A believable `window.xop` for the browser harness.
 *
 * The data is shaped after a real scan rather than invented: the same categories, the same size
 * range, and — deliberately — every awkward case the real catalog contains, because those are the
 * ones a layout gets wrong. An object with no measurement, one that is nothing but a ground
 * marking, one that is 1.1 km across, one with five variants, and one whose files are not installed.
 *
 * ★ Including the origin's real position. A ground box centred on the anchor is the easy case, and
 * only 55% of the real catalog is that case — so three entries here are deliberately off-centre the
 * way the measured objects are: a hangar anchored at its door, an airliner anchored at its nose
 * gear, a jetway segment anchored at one end. If the map draws those right, it draws the library
 * right.
 */

/**
 * A ground box centred on the origin, which is what a little over half the real catalog looks like.
 * The entries that are *not* centred pass their own `ground` — see the note on ENTRIES.
 */
function centred(width: number, depth: number): GroundBox {
  return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 };
}

function entry(
  virtualPath: string,
  size: [number, number, number] | null,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  const segments = virtualPath.replace(/\.obj$/, '').split('/');
  const name = segments.pop() ?? virtualPath;
  const category = segments[0] === 'lib' ? segments.slice(1) : segments;
  return {
    virtualPath,
    name,
    category,
    variantCount: 1,
    animated: false,
    grounded: false,
    ...(size ? { size: { width: size[0], height: size[1], depth: size[2] } } : {}),
    ...(size ? { ground: centred(size[0], size[2]) } : {}),
    ...extra,
  };
}

const ENTRIES: CatalogEntry[] = [
  // Anchored at the middle of its front wall: the box reaches away from the anchor, not around it.
  entry('lib/airport/hangars/arched/16x16/rusted_1.obj', [16.4, 6.0, 16.1], {
    ground: { minX: -8.2, maxX: 8.2, minZ: -16.1, maxZ: 0 },
  }),
  entry('lib/airport/hangars/arched/16x16/gray_1.obj', [16.4, 6.0, 16.1], { variantCount: 3 }),
  entry('lib/airport/hangars/modern/40x40/white.obj', [40.2, 12.5, 39.8]),
  entry('lib/airport/control_towers/small/14m_Sweden.obj', [8.8, 18.0, 8.1]),
  entry('lib/airport/control_towers/small/5m_Germany.obj', [6.2, 9.4, 6.0]),
  entry('lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj', [2.5, 2.4, 5.2]),
  entry('lib/airport/Common_Elements/Vehicles/Pushback.obj', [2.2, 1.6, 4.1], { animated: true }),
  entry('lib/airport/Common_Elements/Barriers/concrete/red_1_5m.obj', [1.5, 1.0, 0.4]),
  entry('lib/airport/aircraft/general/Cessna_172.obj', [11.0, 2.7, 8.3]),
  // Anchored at the nose gear, which is a long way from the centre of an airliner.
  entry('lib/airport/aircraft/airliners/A320_generic.obj', [34.1, 11.8, 37.6], {
    variantCount: 5,
    ground: { minX: -17.05, maxX: 17.05, minZ: -5.2, maxZ: 32.4 },
  }),
  // Anchored at one end, the way a segment meant to be laid end to end has to be.
  entry('lib/airport/markings/taxi/centreline_yellow.obj', [0.3, 0, 12.0], {
    grounded: true,
    ground: { minX: -0.15, maxX: 0.15, minZ: 0, maxZ: 12 },
  }),
  entry('lib/airport/markings/apron/stand_number_12.obj', [4.0, 0, 4.0], { grounded: true }),
  entry('lib/airport/lights/approach/PAPI_4_box.obj', [4.8, 1.1, 1.2]),
  entry('lib/airport/radars/ASR/red_white_antenna.obj', [7.4, 22.6, 7.4], { animated: true }),
  entry('lib/airport/fire_department/truck_large.obj', [3.0, 3.4, 9.8]),
  entry('lib/constructions/antennas/comm_tower_10m_1.obj', [2.1, 10.4, 2.1]),
  entry('lib/constructions/cranes/tower_crane_60m.obj', [51.9, 60.2, 6.4], { animated: true }),
  entry('lib/vehicles/static/car_sedan_blue.obj', [1.8, 1.5, 4.4], { variantCount: 8 }),
  entry('lib/street/streetlights/ResidentialLight_03.obj', [0.6, 6.2, 0.6]),
  entry('lib/garden/furniture/GardenChair_03.obj', [0.6, 0.9, 0.6]),
  entry('lib/ships/container_carriers/ContainerCarrier_155A.obj', [22.4, 34.1, 188.6]),
  entry('lib/g10/EU/suburban/carport1_6x3.obj', [6.1, 2.6, 3.0]),
  entry('lib/g10/EU/suburban/gar1_6x12.obj', [6.0, 3.1, 12.2]),
  entry('lib/g10/US/urban_high/0448A0448R512.obj', [1123.4, 54.0, 517.2]),
  entry('lib/industrial_area/tanks/tank_medium.obj', [11.8, 9.2, 11.8]),
  entry('lib/public_area/benches/bench_wood.obj', [1.8, 0.9, 0.6]),
  entry('lib/legacy/radio_tower.obj', null, {
    unavailable: 'an empty placeholder — it draws nothing',
  }),
  entry('XCDL/Facades/Gate_Segment.obj', null, {
    unavailable: 'the library exports it, but the file is not there',
  }),
  entry('XCDL/Facades/Personnel_Gate.obj', null, {
    unavailable: 'the library exports it, but the file is not there',
  }),
  entry('XCDL/Objects/Details/Drain_Pavement.obj', [2.0, 0, 2.0], { grounded: true }),
  entry('XCDL/Objects/Barriers/Plastic_Barrier_Orange.obj', [2.1, 1.0, 0.6]),
  entry('XCDL/Objects/Details/Basic_Ladder.obj', [0.8, 3.1, 0.7]),
];

const INSTALLATION: Installation = {
  path: 'D:/Laminar/XP12-Last-Release/X-Plane 12',
  version: '12.4.3-r2-15ff1e4d',
  usable: true,
};

const SNAPSHOT: CatalogSnapshot = {
  version: 2,
  installation: INSTALLATION.path,
  scannedAt: '2026-08-22T20:38:07.000Z',
  entries: ENTRIES,
  stats: {
    libraries: 23,
    totalExports: 49233,
    objectExports: 13100,
    distinctObjects: 6293,
    offered: 3837,
    measured: 3706,
    unmeasured: 131,
  },
};

/**
 * What the harness pretends the application state is. Change it from the URL to reach a screen
 * without clicking through to it:
 *
 *   ?state=first-run   the installation picker, with one good entry and three stale ones
 *   ?state=no-catalog  chosen installation, nothing scanned yet
 *   ?state=scanning    mid-scan
 *   ?state=placed      the editor with objects already on the map (see preview.tsx)
 *   (default)          the catalog
 */
export type StubState = 'first-run' | 'no-catalog' | 'scanning' | 'catalog' | 'placed';

/** The same entries the preview seeds placements from, so the two never drift apart. */
export const STUB_ENTRIES: readonly CatalogEntry[] = ENTRIES;

/**
 * Packs the stubbed installation already has. Stateful on purpose: uninstalling one in the harness
 * has to actually make it disappear, or the list is a picture rather than a control.
 */
const installed: InstalledPack[] = [
  { packName: 'SCEL apron detail', writtenAt: '2026-08-21T18:04:00.000Z', fileCount: 1, xop: '0.1.0' },
  { packName: 'Valparaiso docks', writtenAt: '2026-08-19T22:41:00.000Z', fileCount: 3, xop: '0.1.0' },
];

/**
 * The harness's stand-in for a disk.
 *
 * Open answers with a believable project rather than nothing, because the screen worth checking is
 * the one *after* a project is open — a stub that always cancels can only ever show the empty case.
 */
let savedTo: string | null = null;
const doc = (name: string, path: string | null): DocumentState => ({ name, path, dirty: false });

const STUB_PROJECT: Project = {
  schemaVersion: 1,
  app: 'xop',
  name: 'Valparaiso docks',
  createdAt: '2026-08-19T22:41:00.000Z',
  modifiedAt: '2026-08-21T18:04:00.000Z',
  camera: { lon: -71.6127, lat: -33.0392, zoom: 16 },
  objects: [
    {
      id: 'obj-1',
      libraryPath: 'lib/airport/hangars/arched/16x16/rusted_1.obj',
      position: { lon: -71.6127, lat: -33.0392 },
      rotation: 0,
      label: 'rusted_1',
    },
    {
      id: 'obj-2',
      libraryPath: 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj',
      position: { lon: -71.6125, lat: -33.0394 },
      rotation: 45,
      label: 'Large_Fuel_Truck',
    },
  ],
};

export function installStubApi(state: StubState): void {
  const api: XopApi = {
    getVersion: async () => '0.0.0-preview',

    newProject: async () => {
      savedTo = null;
      return doc('Untitled', null);
    },
    openProject: async () => ({
      document: doc('Valparaiso docks', 'C:/Users/you/Documents/Valparaiso docks.xop'),
      project: STUB_PROJECT,
    }),
    saveProject: async () => {
      savedTo ??= 'C:/Users/you/Documents/apron.xop';
      return doc('apron', savedTo);
    },
    saveProjectAs: async () => {
      savedTo = 'C:/Users/you/Documents/apron.xop';
      return doc('apron', savedTo);
    },
    markDirty: async (dirty) => ({ name: 'apron', path: savedTo, dirty }),

    /**
     * Thumbnails, stubbed as a plain box the size of the real object.
     *
     * Deliberately not a picture of the actual model: the harness has no installation to read one
     * from, and a stub that invented convincing thumbnails would be the kind of lie this harness
     * exists to avoid. A box with the object's own proportions is enough to check the layout — the
     * row height, the alignment, what a very wide object does to a square frame — and it is
     * obviously a stand-in. The real thing is checked in dev/thumbnails.html against real geometry.
     */
    getThumbnail: async () => null,
    putThumbnail: async () => true,
    getObjectGeometry: async (virtualPath) => {
      const entry = STUB_ENTRIES.find((e) => e.virtualPath === virtualPath);
      const size = entry?.size ?? { width: 4, height: 3, depth: 4 };
      return {
        mesh: boxMesh(size.width, size.height, size.depth),
        bounds: {
          min: { x: -size.width / 2, y: 0, z: -size.depth / 2 },
          max: { x: size.width / 2, y: size.height, z: size.depth / 2 },
        },
        textureProblem: 'the harness has no installation to read a texture from',
      };
    },
    closeWindow: async () => {},
    onSaveBeforeClose: () => () => {},

    listInstallations: async () => [
      INSTALLATION,
      { path: 'D:/SteamLibrary/steamapps/common/X-Plane 12', usable: false, problem: 'the folder is gone' },
      {
        path: 'C:/Program Files (x86)/Steam/steamapps/common/X-Plane 12',
        usable: false,
        problem: 'the folder is gone',
      },
      { path: 'D:/Laminar/XP12-Beta/X-Plane 12', usable: false, problem: 'the folder is gone' },
    ],
    currentInstallation: async () => (state === 'first-run' ? null : INSTALLATION),
    selectInstallation: async () => INSTALLATION,
    browseForInstallation: async () => INSTALLATION,

    getCatalog: async () => (state === 'catalog' || state === 'placed' ? SNAPSHOT : null),
    rescanCatalog: async () => SNAPSHOT,

    exportPack: async (request) => {
      // One name fails, so the harness can reach the error path without a real installation. It is
      // the refusal that matters most in this dialog: a folder XOP did not make is never overwritten.
      if (/paris/i.test(request.packName)) {
        throw new Error(
          '"X-Plane Landmarks - Paris" already exists in Custom Scenery and was not made by XP Object Placer. ' +
            'Choose another name, or move that folder out of the way first.',
        );
      }
      const packFolder = request.packName.trim() || DEFAULT_PACK_NAME;
      // Counted from what was actually asked for, not hard-coded. A stub that contradicts itself
      // teaches the wrong thing about the screen it is standing in for, and this harness has
      // already caught one piece of text that lied.
      const tiles = new Set(
        request.project.objects.map(
          (object) => `${Math.floor(object.position.lat)},${Math.floor(object.position.lon)}`,
        ),
      );
      const result: ExportResult = {
        packFolder,
        packRoot: `${INSTALLATION.path}/Custom Scenery/${packFolder}`,
        fileCount: tiles.size,
        tileCount: tiles.size,
        line: `SCENERY_PACK Custom Scenery/${packFolder}/`,
        lineWritten: true,
        placement: 'below-global-airports',
        iniBackup: `${INSTALLATION.path}/Custom Scenery/scenery_packs.ini.before_XOP_${packFolder}.bak`,
        warnings: [
          ...(tiles.size >= 3
            ? [`These objects span ${tiles.size} one-degree tiles, so the pack contains ${tiles.size} files.`]
            : []),
          ...(request.project.objects.some((object) => object.libraryPath.startsWith('lib/some_library'))
            ? [
                'This installation has no lib/some_library_you_do_not_have/shed.obj — X-Plane will draw nothing there, and will not say so.',
              ]
            : []),
        ],
      };
      if (!installed.some((pack) => pack.packName === packFolder)) {
        installed.unshift({
          packName: packFolder,
          writtenAt: '2026-08-22T20:30:00.000Z',
          fileCount: result.fileCount,
          xop: '0.0.0-preview',
        });
      }
      return result;
    },

    listInstalledPacks: async () => [...installed],

    uninstallPack: async (packName) => {
      const at = installed.findIndex((pack) => pack.packName === packName);
      if (at >= 0) installed.splice(at, 1);
      return {
        folderRemoved: at >= 0,
        linesRemoved: at >= 0 ? [`SCENERY_PACK Custom Scenery/${packName}/`] : [],
      };
    },

    onScanProgress: (listener) => {
      if (state === 'scanning') {
        listener({ phase: 'measuring', done: 1750, total: 3837 });
      }
      return () => undefined;
    },
  };

  Object.defineProperty(window, 'xop', { value: api, configurable: true });
}

/** A box with its faces' normals right, so the stubbed thumbnails are lit rather than flat. */
function boxMesh(width: number, height: number, depth: number) {
  const x = width / 2;
  const z = depth / 2;
  const faces: Array<[number[], number[]]> = [
    [[-x, 0, z, x, 0, z, x, height, z, -x, height, z], [0, 0, 1]],
    [[x, 0, -z, -x, 0, -z, -x, height, -z, x, height, -z], [0, 0, -1]],
    [[x, 0, z, x, 0, -z, x, height, -z, x, height, z], [1, 0, 0]],
    [[-x, 0, -z, -x, 0, z, -x, height, z, -x, height, -z], [-1, 0, 0]],
    [[-x, height, z, x, height, z, x, height, -z, -x, height, -z], [0, 1, 0]],
    [[-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], [0, -1, 0]],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [corners, normal] of faces) {
    const base = positions.length / 3;
    positions.push(...corners);
    for (let i = 0; i < 4; i += 1) normals.push(...normal);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}
