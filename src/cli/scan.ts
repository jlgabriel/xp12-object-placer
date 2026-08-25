/**
 * Headless catalog scanner.
 *
 *   npm run scan -- "D:/Laminar/XP12-Last-Release/X-Plane 12"
 *   npm run scan -- "<install>" --geometry --out scratch/catalog.json
 *
 * No window, no map, no Electron. The point is to be able to look at ten thousand objects as data
 * before drawing a single screen — the same order PCT went in, and the reason its data layer was
 * right before its UI existed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildCatalog, placeableObjects, type Catalog } from '../core/catalog/catalog.js';
import { looksLikeInstallation, scanLibraries } from '../node/scanLibraries.js';
import { measureObjects } from '../node/measureObjects.js';

interface Options {
  root: string;
  geometry: boolean;
  out: string | null;
  limit: number | null;
}

function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = [];
  const options: Options = { root: '', geometry: false, out: null, limit: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--geometry') options.geometry = true;
    else if (arg === '--out') options.out = argv[++i] ?? null;
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }

  const root = positional[0];
  if (!root) throw new Error('Usage: scan <x-plane-installation-path> [--geometry] [--out <file>] [--limit <n>]');
  options.root = root;
  return options;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function topCategories(catalog: Catalog, depth: number, limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const object of placeableObjects(catalog)) {
    const key = object.category.slice(0, depth).join('/') || '(root)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!looksLikeInstallation(options.root)) {
    console.error(`Not an X-Plane installation: ${options.root}`);
    console.error('Expected to find "Resources/default scenery" inside it.');
    process.exit(1);
  }

  const started = Date.now();
  const { sources, problems } = scanLibraries(options.root);
  const catalog = buildCatalog(sources);
  const placeable = placeableObjects(catalog);

  console.log(`\nX-Plane installation: ${options.root}`);
  console.log(`Libraries read:       ${sources.length}`);
  console.log(`Exports of all kinds: ${catalog.stats.totalExports.toLocaleString()}`);
  console.log(
    `  of which .obj:      ${catalog.stats.objectExports.toLocaleString()} ` +
      `(${pct(catalog.stats.objectExports, catalog.stats.totalExports)})`,
  );
  console.log(`Distinct objects:     ${catalog.stats.distinctObjects.toLocaleString()}`);
  console.log(
    `  with variants:      ${catalog.stats.withVariants.toLocaleString()} ` +
      `(${pct(catalog.stats.withVariants, catalog.stats.distinctObjects)})`,
  );
  console.log(
    `  offered to a user:  ${placeable.length.toLocaleString()} ` +
      `(${pct(placeable.length, catalog.stats.distinctObjects)} — the rest are private or deprecated)`,
  );

  console.log('\nAsset types seen (what a .obj-only catalog leaves on the table):');
  const extensions = Object.entries(catalog.stats.byExtension).sort((a, b) => b[1] - a[1]);
  for (const [extension, count] of extensions.slice(0, 8)) {
    console.log(`  ${(extension || '(none)').padEnd(8)} ${count.toLocaleString().padStart(8)}`);
  }

  console.log('\nTop categories:');
  for (const [name, count] of topCategories(catalog, 2, 12)) {
    console.log(`  ${name.padEnd(34)} ${count.toLocaleString().padStart(6)}`);
  }

  console.log('\nVisibility declared by the libraries:');
  const visibilityCounts = new Map<string, number>();
  for (const object of catalog.objects) {
    visibilityCounts.set(object.visibility, (visibilityCounts.get(object.visibility) ?? 0) + 1);
  }
  for (const [name, count] of [...visibilityCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(18)} ${count.toLocaleString().padStart(6)}`);
  }

  if (catalog.stats.unrecognizedLines > 0) {
    console.log(`\n⚠ ${catalog.stats.unrecognizedLines} library lines were not understood:`);
    let shown = 0;
    for (const source of sources) {
      for (const line of source.parsed.unrecognized) {
        if (shown++ >= 10) break;
        console.log(`  ${source.packageName}:${line.line}  ${line.text.slice(0, 90)}`);
      }
    }
  }
  for (const problem of problems) {
    console.log(`⚠ ${problem.packagePath}: ${problem.message}`);
  }

  let measured: ReturnType<typeof measureObjects> | null = null;
  if (options.geometry) {
    const subject = options.limit ? placeable.slice(0, options.limit) : placeable;
    console.log(`\nMeasuring ${subject.length.toLocaleString()} objects…`);
    const t0 = Date.now();
    measured = measureObjects(subject, (done, total) => {
      process.stdout.write(`\r  ${done.toLocaleString()} / ${total.toLocaleString()}   `);
    });
    const seconds = (Date.now() - t0) / 1000;
    console.log(
      `\r  measured ${measured.measurements.length.toLocaleString()} in ${seconds.toFixed(1)}s ` +
        `(${(measured.measurements.length / seconds).toFixed(0)}/s)`,
    );
    if (measured.failures.length > 0) {
      console.log(`  ${measured.failures.length.toLocaleString()} could not be measured:`);
      const byReason = new Map<string, number>();
      const byPackage = new Map<string, number>();
      for (const failure of measured.failures) {
        byReason.set(failure.reason, (byReason.get(failure.reason) ?? 0) + 1);
        const object = subject.find((o) => o.virtualPath === failure.virtualPath);
        const pkg = object?.variants[0]?.packageName ?? '?';
        byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
      }
      for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason.padEnd(16)} ${count.toLocaleString().padStart(6)}`);
      }
      console.log('  by package:');
      for (const [pkg, count] of [...byPackage].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`    ${pkg.slice(0, 40).padEnd(42)} ${count.toLocaleString().padStart(6)}`);
      }
    }

    const withDrape = measured.measurements.filter((m) => m.drapedSize).length;
    const animated = measured.measurements.filter((m) => m.hasAnimation).length;
    console.log(`  with draped ground decal: ${withDrape.toLocaleString()}`);
    console.log(`  animated:                 ${animated.toLocaleString()}`);
  }

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(
      options.out,
      JSON.stringify(
        {
          scannedAt: new Date().toISOString(),
          installation: options.root,
          stats: catalog.stats,
          packages: catalog.packages,
          objects: catalog.objects,
          measurements: measured?.measurements ?? null,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\nWrote ${options.out}`);
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

main();
