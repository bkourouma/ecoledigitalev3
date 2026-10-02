/** Lecture/écriture des fichiers d'état locaux (`.demo/`). Les secrets ne quittent jamais ce dossier. */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEMO_DIR, LOG_DIR, OBJECTS_DIR, PIDS_FILE, STATE_FILE } from "./paths.mjs";

export function ensureDirs() {
  for (const dir of [DEMO_DIR, LOG_DIR, OBJECTS_DIR]) mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value, { secret = false } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: secret ? 0o600 : 0o644 });
  if (secret) {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Windows : les droits POSIX ne s'appliquent pas */
    }
  }
}

export const readState = () => readJson(STATE_FILE, {});
export const writeState = (patch) => writeJson(STATE_FILE, { ...readState(), ...patch });
export const readPids = () => readJson(PIDS_FILE, {});
export const writePids = (pids) => writeJson(PIDS_FILE, pids);

/** Supprime TOUT `.demo/` (secrets, identifiants, journaux, objets). */
export function wipeDemoDir() {
  if (existsSync(DEMO_DIR)) rmSync(DEMO_DIR, { recursive: true, force: true });
}
