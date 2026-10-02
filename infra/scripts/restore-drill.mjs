#!/usr/bin/env node
/**
 * EXERCICE DE RESTAURATION v2 (Phase E) — prouve qu'on sait sauvegarder puis restaurer la base multi-tenant
 * sans perte ni fuite entre tenants. Tout se passe sur DEUX Postgres Docker ÉPHÉMÈRES créés puis supprimés ici :
 * aucune autre base n'est jamais touchée, aucun accès réseau externe, aucun secret réel (clés générées à l'exécution).
 *
 *   pnpm restore:drill [-- --tenants 3 --invoices 24 --report <fichier.json>]
 *
 * Déroulé :
 *   1. conteneur SOURCE ed-drill-src-<aléa> (postgres:17) ; migrations v2 complètes (baseline + worker + tous les modules) ;
 *   2. jeu de données multi-tenant par les vrais cas d'usage (factures, paiements, reçus, audit chaîné HMAC, documents
 *      signés Ed25519, secrets de fournisseurs chiffrés) -> `restore-drill/steps.ts seed` ;
 *   3. empreinte de la source (comptages par table et par tenant, sommes de contrôle, structure, RLS, ACL, séquences) ;
 *   4. `pg_dump -Fc` exécuté DANS le conteneur source (docker exec) ;
 *   5. conteneur CIBLE ed-drill-dst-<aléa> vierge : rôles recréés comme en production (baseline 0001_roles.sql :
 *      app_user/migrator NOBYPASSRLS) puis `pg_restore` ;
 *   6. comparaison source/cible ; vérifications applicatives sur la cible -> `restore-drill/steps.ts verify` ;
 *   7. mesures RTO/RPO indicatives ; suppression des conteneurs et du dossier temporaire.
 *
 * Variables : ED_PG_IMAGE (défaut postgres:17). Le script échoue (code 1) à la moindre vérification en échec.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const image = process.env.ED_PG_IMAGE ?? "postgres:17";
const suffix = randomBytes(4).toString("hex");
const srcName = `ed-drill-src-${suffix}`;
const dstName = `ed-drill-dst-${suffix}`;
const SRC_DB = "ed_drill_src_test";
const DST_DB = "ed_drill_dst_test";
const password = randomBytes(18).toString("hex");
const workdir = mkdtempSync(join(tmpdir(), "ed-restore-drill-"));

const { values: opts } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { tenants: { type: "string" }, invoices: { type: "string" }, report: { type: "string" } },
});

const docker = (...args) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const dockerOk = (what, ...args) => {
  const r = docker(...args);
  if (r.status !== 0) throw new Error(`${what} a échoué : ${(r.stderr || r.stdout || "").trim().slice(0, 800)}`);
  return r.stdout;
};

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

const started = new Set();
function cleanup() {
  for (const name of [...started]) {
    started.delete(name);
    const r = docker("rm", "-f", "-v", name);
    console.log(r.status === 0 ? `[drill] conteneur ${name} supprimé` : `[drill] ÉCHEC de suppression de ${name} : ${r.stderr}`);
  }
  try {
    rmSync(workdir, { recursive: true, force: true });
    console.log("[drill] dossier temporaire (secrets de test) supprimé");
  } catch {
    /* ignoré */
  }
}
process.on("SIGINT", () => (cleanup(), process.exit(130)));
process.on("SIGTERM", () => (cleanup(), process.exit(143)));

const timings = {};
async function timed(label, fn) {
  const t0 = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    timings[label] = Number(process.hrtime.bigint() - t0) / 1e9;
    console.log(`[drill] ${label} : ${timings[label].toFixed(2)} s`);
  }
}

async function waitPg(url) {
  const deadline = Date.now() + 90_000;
  let okInARow = 0;
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.query("SELECT 1");
      okInARow += 1;
    } catch {
      okInARow = 0;
    } finally {
      await c.end().catch(() => undefined);
    }
    if (okInARow >= 2) return; // l'image redémarre une fois après l'initialisation
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Postgres n'est pas prêt après 90 s");
}

const urlFor = (port, db) => `postgres://postgres:${password}@127.0.0.1:${port}/${db}`;

/** Lance `tsx steps.ts <cmd>` ; renvoie le JSON de la ligne `DRILL_JSON:`. */
function runSteps(cmd, adminUrl, extra = []) {
  const tsx = require.resolve("tsx/cli");
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [tsx, join(here, "restore-drill", "steps.ts"), cmd, ...extra], {
      cwd: repoRoot,
      env: { ...process.env, ED_DRILL_ADMIN_URL: adminUrl, ED_DRILL_WORKDIR: workdir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      if (code !== 0) return rej(new Error(`steps ${cmd} : code ${code}\n${(err || out).slice(-2500)}`));
      const line = out.split("\n").find((l) => l.startsWith("DRILL_JSON:"));
      res(line ? JSON.parse(line.slice("DRILL_JSON:".length)) : {});
    });
  });
}

// ------------------------------------------------------------------------------------------------ empreinte d'une base
const q = (s) => `"${s.replace(/"/g, '""')}"`;

async function fingerprint(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const fp = { tables: {}, tenantCounts: {}, structure: [], sequences: {}, extensions: [], roles: [], partitions: [], trackingTables: {} };
    const tables = (
      await c.query(`
        SELECT n.nspname AS s, c.relname AS t, c.relkind AS k
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p') AND NOT c.relispartition
           AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
         ORDER BY 1,2`)
    ).rows;
    for (const { s, t } of tables) {
      const full = `${q(s)}.${q(t)}`;
      const r = (await c.query(`SELECT count(*)::bigint AS n, md5(COALESCE(string_agg(md5(x::text), ',' ORDER BY md5(x::text)), '')) AS sum FROM ${full} x`)).rows[0];
      fp.tables[`${s}.${t}`] = { rows: Number(r.n), checksum: r.sum };
      const hasTenant = (await c.query(`SELECT 1 FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'tenant_id' AND NOT attisdropped`, [full])).rowCount > 0;
      if (hasTenant) {
        const per = (await c.query(`SELECT tenant_id::text AS tid, count(*)::bigint AS n FROM ${full} GROUP BY 1 ORDER BY 1`)).rows;
        fp.tenantCounts[`${s}.${t}`] = Object.fromEntries(per.map((p) => [p.tid, Number(p.n)]));
      }
      if (s === "public" && t.startsWith("schema_migrations")) fp.trackingTables[t] = Number(r.n);
    }
    // Structure : RLS (activée/forcée), politiques, propriétaire, ACL, déclencheurs, contraintes, index, fonctions
    const struct = async (sql) => (await c.query(sql)).rows.map((r) => r.x);
    fp.structure.push(
      ...(await struct(`SELECT format('rls|%s.%s|%s|%s|owner=%s|acl=%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner), CASE WHEN c.relacl IS NULL OR c.relacl = acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner) THEN '' ELSE c.relacl::text END) AS x
                          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                         WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'`)),
      ...(await struct(`SELECT format('policy|%s.%s|%s|%s|%s|%s|%s', n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive, pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid)) AS x
                          FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace`)),
      ...(await struct(`SELECT format('trigger|%s.%s|%s|%s', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)) AS x
                          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal`)),
      ...(await struct(`SELECT format('constraint|%s.%s|%s|%s', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)) AS x
                          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                         WHERE n.nspname NOT IN ('pg_catalog','information_schema')`)),
      ...(await struct(`SELECT format('index|%s', indexdef) AS x FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')`)),
      ...(await struct(`SELECT format('function|%s.%s|%s|secdef=%s|owner=%s|acl=%s|md5=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, pg_get_userbyid(p.proowner), COALESCE(p.proacl::text,''), md5(p.prosrc)) AS x
                          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')`)),
      ...(await struct(`SELECT format('schema|%s|owner=%s|acl=%s', n.nspname, pg_get_userbyid(n.nspowner), CASE WHEN n.nspacl IS NULL OR n.nspacl = acldefault('n'::"char", n.nspowner) THEN '' ELSE n.nspacl::text END) AS x
                          FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`)),
    );
    fp.structure.sort();
    for (const r of (await c.query(`SELECT schemaname||'.'||sequencename AS n, last_value FROM pg_sequences ORDER BY 1`)).rows) fp.sequences[r.n] = r.last_value === null ? null : String(r.last_value);
    fp.extensions = (await c.query(`SELECT extname||' '||extversion AS x FROM pg_extension ORDER BY 1`)).rows.map((r) => r.x);
    fp.partitions = (await c.query(`SELECT c.relname AS x FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid WHERE i.inhparent='audit.audit_log'::regclass ORDER BY 1`)).rows.map((r) => r.x);
    fp.roles = (await c.query(`SELECT rolname||'|super='||rolsuper||'|bypassrls='||rolbypassrls||'|login='||rolcanlogin AS x FROM pg_roles WHERE rolname IN ('app_user','migrator') ORDER BY 1`)).rows.map((r) => r.x);
    return fp;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Compare deux empreintes ; renvoie la liste des écarts (vide = identiques). */
function diffFingerprints(a, b) {
  const out = [];
  const keys = new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]);
  for (const k of keys) {
    const x = a.tables[k];
    const y = b.tables[k];
    if (!x || !y) out.push(`table ${k} : ${x ? "absente de la cible" : "absente de la source"}`);
    else {
      if (x.rows !== y.rows) out.push(`table ${k} : ${x.rows} lignes en source, ${y.rows} en cible`);
      else if (x.checksum !== y.checksum) out.push(`table ${k} : somme de contrôle différente`);
    }
  }
  for (const k of new Set([...Object.keys(a.tenantCounts), ...Object.keys(b.tenantCounts)])) {
    const x = a.tenantCounts[k] ?? {};
    const y = b.tenantCounts[k] ?? {};
    for (const tid of new Set([...Object.keys(x), ...Object.keys(y)])) if ((x[tid] ?? 0) !== (y[tid] ?? 0)) out.push(`${k} tenant ${tid.slice(0, 8)} : ${x[tid] ?? 0} -> ${y[tid] ?? 0}`);
  }
  const sa = new Set(a.structure);
  const sb = new Set(b.structure);
  for (const s of sa) if (!sb.has(s)) out.push(`structure manquante en cible : ${s.slice(0, 160)}`);
  for (const s of sb) if (!sa.has(s)) out.push(`structure en trop en cible : ${s.slice(0, 160)}`);
  for (const k of new Set([...Object.keys(a.sequences), ...Object.keys(b.sequences)])) if (a.sequences[k] !== b.sequences[k]) out.push(`séquence ${k} : ${a.sequences[k]} -> ${b.sequences[k]}`);
  for (const f of ["extensions", "partitions", "roles"]) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) out.push(`${f} différents`);
  return out;
}

// ------------------------------------------------------------------------------------------------------------- scénario
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "OK  " : "ÉCHEC"} ${name}${detail ? ` — ${detail}` : ""}`);
};

let exitCode = 1;
const report = { image, timings: {}, sizes: {}, counts: {}, checks: [] };
try {
  const info = docker("info", "--format", "{{.ServerVersion}}");
  if (info.status !== 0) {
    console.error("[drill] Docker indisponible : l'exercice exige Docker (Postgres éphémères).");
    process.exit(2);
  }
  const srcPort = await freePort();
  const dstPort = await freePort();

  await timed("démarrage des deux Postgres éphémères", async () => {
    for (const [name, port, db] of [[srcName, srcPort, SRC_DB], [dstName, dstPort, DST_DB]]) {
      dockerOk(`docker run ${name}`, "run", "-d", "--name", name, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${db === DST_DB ? "postgres" : db}`, "-p", `127.0.0.1:${port}:5432`, image);
      started.add(name);
    }
    await Promise.all([waitPg(urlFor(srcPort, SRC_DB)), waitPg(urlFor(dstPort, "postgres"))]);
  });
  const version = dockerOk("version", "exec", srcName, "psql", "-U", "postgres", "-Atc", "SHOW server_version").trim();
  console.log(`[drill] ${image} (${version}) ; source ${srcName}:${srcPort} ; cible ${dstName}:${dstPort} (jamais d'autre base)`);
  report.postgres = version;

  const srcUrl = urlFor(srcPort, SRC_DB);

  // 1-2. migrations + données
  const mig = await timed("migrations v2 (source)", () => runSteps("migrate", srcUrl));
  report.migrations = mig.steps;
  console.log(`[drill] migrations : ${mig.steps.length} dossiers, ${mig.steps.reduce((s, x) => s + x.applied, 0)} fichiers appliqués`);
  const seed = await timed("génération du jeu de données multi-tenant", () =>
    runSteps("seed", srcUrl, ["--tenants", opts.tenants ?? "3", "--invoices", opts.invoices ?? "24"]),
  );
  report.seed = seed;

  // 3. empreinte source
  const fpSrc = await timed("empreinte de la source", () => fingerprint(srcUrl));
  const totalRows = Object.values(fpSrc.tables).reduce((s, t) => s + t.rows, 0);
  report.counts = { tables: Object.keys(fpSrc.tables).length, rows: totalRows, trackingTables: fpSrc.trackingTables };
  console.log(`[drill] source : ${report.counts.tables} tables, ${totalRows} lignes, ${Object.keys(fpSrc.trackingTables).length} tables schema_migrations_*`);

  // 4. sauvegarde
  const lastWrite = (await (async () => {
    const c = new Client({ connectionString: srcUrl });
    await c.connect();
    const r = await c.query(`SELECT max(recorded_at) AS t FROM audit.audit_log`);
    await c.end();
    return r.rows[0].t;
  })());
  const dumpStart = new Date();
  await timed("pg_dump -Fc (docker exec, conteneur source)", async () => {
    dockerOk("pg_dump", "exec", srcName, "pg_dump", "-U", "postgres", "-d", SRC_DB, "-Fc", "-f", "/tmp/drill.dump");
  });
  const dumpBytes = Number(dockerOk("stat", "exec", srcName, "stat", "-c", "%s", "/tmp/drill.dump").trim());
  const dbBytes = Number(dockerOk("size", "exec", srcName, "psql", "-U", "postgres", "-d", SRC_DB, "-Atc", "SELECT pg_database_size(current_database())").trim());
  report.sizes = { databaseBytes: dbBytes, dumpBytes };
  const toc = dockerOk("pg_restore --list", "exec", srcName, "pg_restore", "-l", "/tmp/drill.dump").split("\n").filter((l) => l && !l.startsWith(";")).length;
  console.log(`[drill] sauvegarde : ${(dumpBytes / 1048576).toFixed(2)} Mio (base ${(dbBytes / 1048576).toFixed(1)} Mio), ${toc} objets au sommaire`);
  // Les lignes \restrict/\unrestrict portent un jeton aléatoire propre à chaque pg_dump (correctif de sécurité 17.x) : ignorées.
  const stripTokens = (sql) =>
    sql
      .split("\n")
      .filter((l) => !/^\\(un)?restrict /.test(l))
      .join("\n");
  const schemaSrc = stripTokens(dockerOk("pg_dump -s", "exec", srcName, "pg_dump", "-U", "postgres", "-d", SRC_DB, "-s", "--no-comments"));

  // 5. restauration dans la cible vierge
  dockerOk("docker cp (source)", "cp", `${srcName}:/tmp/drill.dump`, join(workdir, "drill.dump"));
  dockerOk("docker cp (cible)", "cp", join(workdir, "drill.dump"), `${dstName}:/tmp/drill.dump`);
  dockerOk("docker cp roles", "cp", join(repoRoot, "packages", "database", "migrations", "0001_roles.sql"), `${dstName}:/tmp/0001_roles.sql`);
  const restoreStart = Date.now();
  await timed("cible : CREATE DATABASE + rôles (baseline 0001_roles.sql)", async () => {
    dockerOk("createdb", "exec", dstName, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${DST_DB}`);
    dockerOk("roles", "exec", dstName, "psql", "-U", "postgres", "-d", DST_DB, "-v", "ON_ERROR_STOP=1", "-f", "/tmp/0001_roles.sql");
  });
  const pre = docker("exec", dstName, "psql", "-U", "postgres", "-d", DST_DB, "-Atc", "SELECT count(*) FROM pg_namespace WHERE nspname IN ('kernel','finance','audit')");
  check("cible vierge avant restauration (aucun schéma applicatif)", pre.stdout.trim() === "0", `schémas applicatifs=${pre.stdout.trim()}`);
  let restoreStderr = "";
  await timed("pg_restore (cible)", async () => {
    const r = docker("exec", dstName, "pg_restore", "-U", "postgres", "-d", DST_DB, "--exit-on-error", "--no-comments", "/tmp/drill.dump");
    restoreStderr = r.stderr.trim();
    if (r.status !== 0) throw new Error(`pg_restore a échoué : ${restoreStderr.slice(0, 1500)}`);
  });
  check("pg_restore sans aucune erreur", restoreStderr === "", restoreStderr.slice(0, 200));
  await timed("ANALYZE (statistiques non sauvegardées)", async () => {
    dockerOk("analyze", "exec", dstName, "psql", "-U", "postgres", "-d", DST_DB, "-c", "ANALYZE");
  });
  const restoreSeconds = (Date.now() - restoreStart) / 1000;
  const dstUrl = urlFor(dstPort, DST_DB);

  // 6a. comparaison source / cible
  const fpDst = await timed("empreinte de la cible", () => fingerprint(dstUrl));
  const diffs = diffFingerprints(fpSrc, fpDst);
  if (process.env.ED_DRILL_VERBOSE) for (const d of diffs.filter((x) => /structure/.test(x))) console.log(`    diff: ${d}`);
  const cmpTables = Object.keys(fpSrc.tables).length;
  check(`comptages et sommes de contrôle identiques sur ${cmpTables} tables (${totalRows} lignes)`, !diffs.some((d) => /lignes|somme|absente/.test(d)), diffs.filter((d) => /lignes|somme|absente/.test(d)).slice(0, 3).join(" ; "));
  const tenantTables = Object.keys(fpSrc.tenantCounts).length;
  check(`comptages par tenant identiques sur ${tenantTables} tables à tenant_id`, !diffs.some((d) => /tenant /.test(d)), diffs.filter((d) => /tenant /.test(d)).slice(0, 3).join(" ; "));
  check(
    `structure identique (RLS activée+forcée, politiques, ACL, propriétaires, déclencheurs, contraintes, index, fonctions : ${fpSrc.structure.length} éléments)`,
    !diffs.some((d) => /structure/.test(d)),
    diffs.filter((d) => /structure/.test(d)).slice(0, 3).join(" ; "),
  );
  check(`séquences PostgreSQL identiques (${Object.keys(fpSrc.sequences).length})`, !diffs.some((d) => /^séquence/.test(d)), diffs.filter((d) => /^séquence/.test(d)).join(" ; "));
  check(`partitions d'audit identiques (${fpSrc.partitions.length})`, JSON.stringify(fpSrc.partitions) === JSON.stringify(fpDst.partitions) && fpDst.partitions.length >= 14, `${fpDst.partitions.length} partitions`);
  check(`extensions identiques (${fpDst.extensions.join(", ")})`, JSON.stringify(fpSrc.extensions) === JSON.stringify(fpDst.extensions));
  check("rôles app_user / migrator : NOLOGIN NOSUPERUSER NOBYPASSRLS (comme en production)", fpDst.roles.every((r) => r.includes("super=false") && r.includes("bypassrls=false")) && fpDst.roles.length === 2, fpDst.roles.join(" ; "));
  const schemaDst = stripTokens(dockerOk("pg_dump -s dst", "exec", dstName, "pg_dump", "-U", "postgres", "-d", DST_DB, "-s", "--no-comments"));
  const lineDiff = () => {
    const A = schemaSrc.split("\n");
    const D = schemaDst.split("\n");
    const B = new Set(D);
    const onlySrc = A.filter((l) => !B.has(l));
    const Aset = new Set(A);
    const onlyDst = D.filter((l) => !Aset.has(l));
    return `${onlySrc.length} lignes seulement en source (ex. ${onlySrc.slice(0, 4).join(" | ")}) ; ${onlyDst.length} seulement en cible (ex. ${onlyDst.slice(0, 4).join(" | ")})`;
  };
  check("pg_dump --schema-only de la cible identique à celui de la source", schemaSrc === schemaDst, schemaSrc === schemaDst ? `${schemaSrc.length} octets` : lineDiff());
  check(`inventaire des tables schema_migrations_* restauré (${Object.keys(fpDst.trackingTables).length})`, JSON.stringify(fpSrc.trackingTables) === JSON.stringify(fpDst.trackingTables) && Object.keys(fpDst.trackingTables).length > 20, Object.keys(fpDst.trackingTables).slice(0, 4).join(","));
  // Témoin négatif : le comparateur DOIT détecter une perte (sinon les « OK » ci-dessus ne prouveraient rien)
  const tampered = JSON.parse(JSON.stringify(fpDst));
  const victim = Object.keys(tampered.tables).find((k) => tampered.tables[k].rows > 0);
  tampered.tables[victim].rows -= 1;
  const tenantTable = Object.keys(tampered.tenantCounts)[0];
  const tid = Object.keys(tampered.tenantCounts[tenantTable])[0];
  tampered.tenantCounts[tenantTable][tid] += 1;
  check("témoin négatif : le comparateur détecte une ligne perdue et une fuite de tenant simulées", diffFingerprints(fpSrc, tampered).length >= 2, `${diffFingerprints(fpSrc, tampered).length} écarts détectés`);

  // 6b. vérifications applicatives sur la cible (grand livre, audit, signatures, coffre, RLS, compteurs)
  const verify = await timed("vérifications applicatives (cible)", () => runSteps("verify", dstUrl));
  for (const c of verify.checks) check(c.name, c.ok, c.detail);

  // 7. RTO / RPO indicatifs
  const rtoSeconds = restoreSeconds + timings["empreinte de la cible"] + timings["vérifications applicatives (cible)"];
  report.timings = timings;
  report.rto = {
    restoreSeconds: Number(restoreSeconds.toFixed(2)),
    withVerificationSeconds: Number(rtoSeconds.toFixed(2)),
    note: "Indicatif : petite base, conteneur local, sans réseau ni stockage d'objets ; la durée croît avec le volume.",
  };
  report.rpo = {
    lastCommittedAuditWrite: lastWrite ? new Date(lastWrite).toISOString() : null,
    dumpStartedAt: dumpStart.toISOString(),
    dataLossSecondsBetweenLastWriteAndDump: lastWrite ? Number(((dumpStart.getTime() - new Date(lastWrite).getTime()) / 1000).toFixed(1)) : null,
    note: "Le RPO réel = intervalle entre sauvegardes (logique) ; l'archivage WAL/PITR n'est pas testé ici.",
  };
  report.throughput = { dumpMiBPerSecond: Number((dumpBytes / 1048576 / timings["pg_dump -Fc (docker exec, conteneur source)"]).toFixed(2)), restoreMiBPerSecond: Number((dumpBytes / 1048576 / timings["pg_restore (cible)"]).toFixed(2)) };
  report.checks = results;

  const failed = results.filter((r) => !r.ok);
  console.log("\n=========== RÉSUMÉ ===========");
  console.log(`Postgres ${version} · ${report.counts.tables} tables · ${totalRows} lignes · base ${(dbBytes / 1048576).toFixed(1)} Mio · dump ${(dumpBytes / 1048576).toFixed(2)} Mio`);
  console.log(`Durées : dump ${timings["pg_dump -Fc (docker exec, conteneur source)"].toFixed(2)} s · restauration (db+rôles+pg_restore+ANALYZE) ${restoreSeconds.toFixed(2)} s · vérifications ${timings["vérifications applicatives (cible)"].toFixed(2)} s`);
  console.log(`RTO indicatif (restauration + vérification) : ${rtoSeconds.toFixed(1)} s · RPO mesuré entre dernière écriture et début du dump : ${report.rpo.dataLossSecondsBetweenLastWriteAndDump} s`);
  console.log(`Vérifications : ${results.length - failed.length}/${results.length} OK`);
  for (const f of failed) console.log(`  ÉCHEC : ${f.name} — ${f.detail}`);
  if (opts.report) writeFileSync(resolve(opts.report), JSON.stringify(report, null, 2));
  exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error(`[drill] ÉCHEC : ${e instanceof Error ? (e.stack ?? e.message) : e}`);
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);
