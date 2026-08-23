/**
 * Build the thumbnail harness's sample data from a real installation.
 *
 * The browser cannot read the disk, so the only way to check a thumbnail renderer against real
 * geometry outside Electron is to hand it real geometry. This writes what a handful of objects look
 * like — mesh, bounds, one mip of the albedo — into a JSON file the harness fetches.
 *
 * ⚠️ The output is Laminar's content and never goes near the repository: it is written as
 * `samples.local.json`, which .gitignore excludes. Same rule as everywhere else — XOP reads the
 * user's installation and ships nothing from it.
 *
 *   npm run samples
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { parseObj8 } from '../core/obj8/parse.js';
import { readDdsMip, textureCandidates } from '../core/dds/dds.js';

const CATALOG = 'scratch/catalog.json';
const OUT = 'src/renderer/dev/samples.local.json';
const MIP_SIZE = 256;

/**
 * Chosen to be awkward on purpose, the way the stub catalog is.
 *
 * A hangar and a truck prove the ordinary case. The two shipping containers are the same mesh and
 * differ only in paint, which is the pair that proves textures matter at all. The fence and the
 * antenna are mostly transparent texture, which is what the alpha cutout is for. The airliner is
 * the heavy one, and the boulder has no texture worth speaking of.
 */
const WANTED = [
  'rusted_1',
  'Large_Fuel_Truck',
  'Shipping_Container_Blue',
  'Shipping_Container_Red',
  'Cessna_172',
  'A320_generic',
  '14m_Sweden',
  'tower_crane_60m',
  'GardenChair_03',
  'red_white_antenna',
  'bench_wood',
  'Plastic_Barrier_Orange',
];

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const samples: unknown[] = [];

for (const wanted of WANTED) {
  const measurement = catalog.measurements.find(
    (m: { virtualPath: string }) => basename(m.virtualPath, '.obj') === wanted,
  );
  if (!measurement) {
    console.log(`  (no ${wanted} in this installation)`);
    continue;
  }

  const geometry = parseObj8(readFileSync(measurement.measuredFile, 'utf8'), { mesh: true });
  if (!geometry.mesh || !geometry.bounds) {
    console.log(`  (${wanted} has no drawable geometry)`);
    continue;
  }

  let texture: unknown = null;
  const named = geometry.textures.albedo;
  if (named) {
    for (const candidate of textureCandidates(named)) {
      const file = resolve(dirname(measurement.measuredFile), candidate);
      if (!existsSync(file)) continue;
      try {
        const mip = readDdsMip(new Uint8Array(readFileSync(file)), MIP_SIZE);
        texture = {
          format: mip.format,
          width: mip.width,
          height: mip.height,
          data: Buffer.from(mip.data).toString('base64'),
          from: basename(file),
        };
      } catch (error) {
        console.log(`  (${wanted}: ${(error as Error).message})`);
      }
      break;
    }
  }

  samples.push({
    name: wanted,
    virtualPath: measurement.virtualPath,
    triangles: geometry.triangleCount,
    bounds: geometry.bounds,
    mesh: {
      positions: Buffer.from(new Float32Array(geometry.mesh.positions).buffer).toString('base64'),
      normals: Buffer.from(new Float32Array(geometry.mesh.normals).buffer).toString('base64'),
      uvs: Buffer.from(new Float32Array(geometry.mesh.uvs).buffer).toString('base64'),
      indices: Buffer.from(new Uint32Array(geometry.mesh.indices).buffer).toString('base64'),
    },
    texture,
  });

  const size = geometry.bounds;
  console.log(
    `${wanted.padEnd(24)} ${String(geometry.triangleCount).padStart(7)} tris  ` +
      `${(size.max.x - size.min.x).toFixed(1)}×${(size.max.y - size.min.y).toFixed(1)}×${(size.max.z - size.min.z).toFixed(1)} m  ` +
      `${texture ? (texture as { format: string; from: string }).format + ' ' + (texture as { from: string }).from : 'no texture'}`,
  );
}

writeFileSync(OUT, JSON.stringify(samples));
const megabytes = (readFileSync(OUT).byteLength / 1e6).toFixed(1);
console.log(`\n${samples.length} samples -> ${OUT} (${megabytes} MB, gitignored)`);
