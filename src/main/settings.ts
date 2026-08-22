/**
 * Settings, persisted in userData.
 *
 * Small on purpose. Anything that can be derived is derived; the only thing XOP genuinely cannot
 * work out for itself is which installation the user meant when they have more than one.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const SettingsSchema = z.object({
  /** Absolute path of the chosen X-Plane installation, or null on a first run. */
  installation: z.string().nullable().default(null),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULTS: Settings = { installation: null };

function settingsPath(userData: string): string {
  return join(userData, 'settings.json');
}

export function readSettings(userData: string): Settings {
  try {
    const parsed = SettingsSchema.safeParse(JSON.parse(readFileSync(settingsPath(userData), 'utf8')));
    // A settings file that has drifted is not worth crashing over, and it is not worth silently
    // half-applying either. Fall back whole.
    return parsed.success ? parsed.data : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(userData: string, patch: Partial<Settings>): Settings {
  const next = { ...readSettings(userData), ...patch };
  const target = settingsPath(userData);
  mkdirSync(dirname(target), { recursive: true });
  // Write-then-rename: a settings file truncated by a crash mid-write would lose the installation
  // and send the user back through first-run for no reason.
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
  renameSync(temporary, target);
  return next;
}
