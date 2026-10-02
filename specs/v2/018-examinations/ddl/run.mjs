#!/usr/bin/env node
/**
 * Banc d'essai du DDL de référence de la spec (aucune dépendance npm : Docker + psql du conteneur).
 *
 *   node run.mjs              lance un Postgres éphémère, applique 0001-0003 (socle) puis migrations/*.sql
 *                             sous le rôle `migrator`, exécute tests/*.sql, supprime le conteneur
 *   node run.mjs --sync-doc   réécrit les blocs ```sql de ../data-model.md depuis migrations/*.sql
 *   node run.mjs --check-doc  vérifie que data-model.md contient EXACTEMENT les migrations (sortie 1 sinon)
 *
 * Variables : ED_PG_IMAGE (défaut postgres:17-alpine). Le conteneur est nommé `ed-ddl-<aléa>` et supprimé
 * à la fin, même en cas d'échec. Les services Postgres locaux ne sont jamais touchés.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "migrations");
const testDir = join(here, "tests");
const docPath = resolve(here, "..", "data-model.md");
const baselineDir = resolve(here, "..", "..", "..", "..", "packages", "database", "migrations");

const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : []);

// ------------------------------------------------------------------ documentation
const MARK = /<!-- migration: (\S+) -->\r?\n```sql\r?\n([\s\S]*?)\r?\n```/g;
function syncDoc(check) {
  const doc = readFileSync(docPath, "utf8");
  let bad = 0;
  const next = doc.replace(MARK, (all, file, body) => {
    const src = readFileSync(join(migDir, file), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (body.replace(/\r\n/g, "\n") !== src) bad += 1;
    return `<!-- migration: ${file} -->\n\`\`\`sql\n${src}\n\`\`\``;
  });
  const referenced = [...doc.matchAll(MARK)].map((m) => m[1]);
  const missing = list(migDir).filter((f) => !referenced.includes(f));
  if (missing.length) {
    console.error(`[doc] migrations absentes de data-model.md : ${missing.join(", ")}`);
    process.exit(1);
  }
  if (check) {
    if (bad) {
      console.error(`[doc] ${bad} bloc(s) de data-model.md diffèrent des migrations (lancer --sync-doc)`);
      process.exit(1);
    }
    console.log(`[doc] data-model.md conforme aux ${referenced.length} migrations`);
    return;
  }
  writeFileSync(docPath, next);
  console.log(`[doc] ${referenced.length} bloc(s) synchronisé(s)`);
}

if (process.argv.includes("--sync-doc")) {
  syncDoc(false);
  process.exit(0);
}
if (process.argv.includes("--check-doc")) {
  syncDoc(true);
  process.exit(0);
}

// ------------------------------------------------------------------ banc d'essai
const image = process.env.ED_PG_IMAGE ?? "postgres:17-alpine";
const name = `ed-ddl-${randomBytes(4).toString("hex")}`;
const docker = (...args) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let started = false;
function cleanup() {
  if (!started) return;
  started = false;
  const r = docker("rm", "-f", "-v", name);
  console.log(r.status === 0 ? `[pg] conteneur ${name} supprimé` : `[pg] ÉCHEC de suppression de ${name} : ${r.stderr}`);
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

if (docker("info", "--format", "{{.ServerVersion}}").status !== 0) {
  console.error("[pg] Docker indisponible (démon arrêté ?).");
  process.exit(2);
}

const run = docker("run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=ddltest", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image);
if (run.status !== 0) {
  console.error(`[pg] docker run a échoué : ${run.stderr}`);
  process.exit(2);
}
started = true;

const psql = (extra, input) =>
  spawnSync("docker", ["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", ...extra], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });

let code = 1;
try {
  // attente : deux succès espacés (l'image redémarre une fois après l'initialisation)
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i += 1) {
    const r = docker("exec", name, "psql", "-U", "postgres", "-Atc", "SELECT 1");
    ok = r.status === 0 ? ok + 1 : 0;
    if (ok < 2) spawnSync(process.platform === "win32" ? "powershell" : "sleep", process.platform === "win32" ? ["-Command", "Start-Sleep -Seconds 1"] : ["1"]);
  }
  if (ok < 2) throw new Error("Postgres n'est pas prêt");
  console.log(`[pg] ${image} prêt : ${docker("exec", name, "psql", "-U", "postgres", "-Atc", "SHOW server_version").stdout.trim()}`);

  const apply = (dir, file, asMigrator) => {
    const sql = readFileSync(join(dir, file), "utf8");
    const noRole = /^-- no-role/m.test(sql);
    const input = asMigrator && !noRole ? `SET ROLE migrator;\n${sql}` : sql;
    const r = psql([], input);
    if (r.status !== 0) throw new Error(`${file} : ${r.stderr.trim() || r.stdout.trim()}`);
    console.log(`[mig] ${file}`);
  };
  for (const f of list(baselineDir)) apply(baselineDir, f, true);
  for (const f of list(migDir)) apply(migDir, f, true);

  let pass = 0;
  for (const f of list(testDir).filter((x) => !process.env.ED_ONLY || /^0/.test(x) || x.includes(process.env.ED_ONLY))) {
    const r = psql(["-v", `VERBOSITY=${process.env.ED_VERBOSE ? "default" : "terse"}`], readFileSync(join(testDir, f), "utf8"));
    const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
    const passes = lines.filter((l) => /PASS: /.test(l));
    for (const l of passes) console.log(l.replace(/^.*?(PASS: )/, "  PASS: "));
    pass += passes.length;
    if (r.status !== 0) {
      console.error(lines.filter((l) => !/PASS: /.test(l) && l.trim()).join("\n"));
      throw new Error(`${f} : ÉCHEC`);
    }
  }
  console.log(`\n[ddl] ${pass} tests de comportement réussis`);
  code = 0;
} catch (e) {
  console.error(`[ddl] ${e instanceof Error ? e.message : e}`);
} finally {
  cleanup();
}
process.exit(code);
