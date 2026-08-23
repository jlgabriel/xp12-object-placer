/**
 * Build probe H8: two scenery packs, one written by XOP and one by DSFTool.
 *
 *   npx tsx probes/H8/make.ts
 *
 * Committed rather than just its output, because the output is binary. A DSF nobody can regenerate
 * is a fact nobody can re-check.
 *
 * The control pack needs DSFTool. Point XOP_DSFTOOL at it; on a machine with Ortho4XP installed it
 * is at <Ortho4XP>/Utils/DSFTool.exe. Without it, only the XOP pack is built — and a run of this
 * probe with no control is not worth flying, so it says so and stops.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeDsfBinary } from '../../src/core/dsf/writeDsfBinary.js';
import { writeDsfText } from '../../src/core/dsf/writeDsfText.js';
import { tilePath, type DsfTile } from '../../src/core/dsf/tile.js';
import type { PlacedObject } from '../../src/core/model.js';

const TILE: DsfTile = { lat: -34, lon: -71 };
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const TOWER = 'lib/airport/control_towers/small/14m_Sweden.obj';
const HANGAR = 'lib/airport/hangars/arched/16x16/rusted_1.obj';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

/**
 * Three control towers, 18 m tall, in an east–west row about 46 m apart, at the spot probe H0 used.
 *
 * Towers because they are tall enough to see from the runway without taxiing anywhere, and because
 * three of them in a row is a shape that cannot be confused with anything the base scenery puts at
 * SCEL. The rotations are the same 0 / 90 / 180 that H0b read, so if the file loads at all this
 * also re-confirms that our own encoder puts the rotation where the text writer did.
 */
const OURS: PlacedObject[] = [
  { id: 'tower-0', libraryPath: TOWER, position: { lon: -70.7860, lat: -33.3758 }, rotation: 0 },
  { id: 'tower-90', libraryPath: TOWER, position: { lon: -70.7855, lat: -33.3758 }, rotation: 90 },
  { id: 'tower-180', libraryPath: TOWER, position: { lon: -70.7850, lat: -33.3758 }, rotation: 180 },
];

/**
 * The positive control: one hangar, about 78 m north of the towers, in its own pack, compiled by
 * DSFTool exactly as probes H0 and H0b were.
 *
 * ★ This is the whole point of the sheet. Without it the probe reads by ABSENCE — "no towers"
 * would mean either "X-Plane rejected our bytes" or "the pack was never found", and those have
 * completely different fixes. The hangar is a signal that must appear whatever our encoder does.
 * It is a different object from the towers on purpose: nobody is being asked to tell two identical
 * objects apart by position.
 */
const CONTROL: PlacedObject[] = [
  { id: 'hangar', libraryPath: HANGAR, position: { lon: -70.7855, lat: -33.3751 }, rotation: 0 },
];

function writePack(packName: string, bytes: Uint8Array): string {
  const root = join(HERE, packName);
  rmSync(root, { recursive: true, force: true });
  const file = join(root, tilePath(TILE));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

// ── the pack under test: XOP writes the binary itself, nothing else touches it ─────────────────

const ours = writeDsfBinary({
  tile: TILE,
  objects: OURS,
  creationAgent: 'XOP-H8-own-encoder',
  md5,
});
const oursFile = writePack('XOP_H8_Ours', ours);
console.log(`XOP_H8_Ours     ${ours.length} bytes, written by src/core/dsf/writeDsfBinary.ts`);

// ── the control: the same route H0 and H0b took, which the simulator has already accepted ──────

const dsfTool = process.env['XOP_DSFTOOL'];
if (!dsfTool || !existsSync(dsfTool)) {
  console.error(
    '\nXOP_DSFTOOL is not set, so the control pack was not built.\n' +
      'Flying this probe without its control would answer nothing: with no towers visible there\n' +
      'would be no way to tell a rejected file from a pack X-Plane never found.\n',
  );
  process.exit(1);
}

const controlText = writeDsfText({
  tile: TILE,
  objects: CONTROL,
  creationAgent: 'XOP-H8-control',
});
const textFile = join(HERE, 'control.txt');
writeFileSync(textFile, controlText, 'utf8');

const controlFile = writePack('XOP_H8_Control', new Uint8Array(0));
execFileSync(dsfTool, ['--text2dsf', textFile, controlFile], { stdio: 'ignore' });
console.log(`XOP_H8_Control  compiled by DSFTool from control.txt`);

console.log(`\nBoth packs are in ${HERE}.`);
console.log(`Read ${join(HERE, 'FLIGHT.md')} before installing them.`);
console.log(`\nOur pack:     ${oursFile}`);
console.log(`Control pack: ${controlFile}`);
