/** Processus de la démonstration (API, worker, web) : lancement détaché, journaux dans `.demo/logs/`, arrêt de l'arbre. */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { API_TSCONFIG, LOG_DIR, ROOT, TSX_CLI } from "./paths.mjs";
import { readPids, writePids } from "./state.mjs";

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

/** Lance une commande en arrière-plan ; stdout et stderr vont dans `.demo/logs/<name>.log`. Renvoie le pid. */
export function launch(name, command, args, { cwd = ROOT, env = {} } = {}) {
  const logFile = resolve(LOG_DIR, `${name}.log`);
  const fd = openSync(logFile, "w");
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", fd, fd],
    detached: true,
    windowsHide: true,
  });
  closeSync(fd);
  child.unref();
  const pids = readPids();
  pids[name] = child.pid;
  writePids(pids);
  return { pid: child.pid, alive: () => isAlive(child.pid), logFile };
}

/** Lance un script TypeScript avec tsx (pas de dépendance nouvelle : tsx est déjà un outil du dépôt). */
export function launchTs(name, file, args = [], options = {}) {
  // Configuration TypeScript de l'API : résolution de `@ecoledigitale/worker/sdk`, `contracts`, `utils` (comme vitest et le build).
  return launch(name, process.execPath, [TSX_CLI, file, ...args], { ...options, env: { TSX_TSCONFIG_PATH: API_TSCONFIG, ...(options.env ?? {}) } });
}

export function killTree(pid) {
  if (!pid || !isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* déjà arrêté */
      }
    }
  }
}

/** Arrête les processus enregistrés (API, worker, web) et vide le registre. */
export function stopAll() {
  const pids = readPids();
  const stopped = [];
  for (const [name, pid] of Object.entries(pids)) {
    if (isAlive(pid)) {
      killTree(pid);
      stopped.push(name);
    }
  }
  writePids({});
  return stopped;
}
