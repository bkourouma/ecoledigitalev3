#!/usr/bin/env node
/**
 * Second passage des pages en defaut « possiblement transitoire » (5xx, ecran blanc, erreur d'hydratation, exception JS) :
 * pour chaque compte concerne, relance `demo-sweep.mjs --only=<pages>` (resultats `recheck-<tenant>-<role>.json`, lus par
 * `report.mjs` pour marquer un constat reproductible ou transitoire). Sequentiel, lecture seule.
 *
 *   node scripts/qa/recheck.mjs [--tenant=demo-secondaire]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoDir } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.find((a) => a.startsWith("--tenant="))?.slice("--tenant=".length);
const dir = join(demoDir(), "qa");
const CODES = new Set(["http-5xx", "dev-toast", "dev-overlay", "blank-page", "console-js", "page-error", "nav-error"]);

for (const f of readdirSync(dir).filter((n) => /^acct-/.test(n) && (!only || n.includes(only))).sort()) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8")).result;
  const urls = r.pages.filter((p) => (p.findings ?? []).some((x) => CODES.has(x.code))).map((p) => p.url);
  if (!urls.length) continue;
  console.log(`\n>>> ${r.account.tenant}/${r.account.role} : ${urls.length} page(s) a revisiter`);
  const res = spawnSync(process.execPath, [join(here, "demo-sweep.mjs"), `--tenant=${r.account.tenant}`, `--role=${r.account.role}`, `--only=${urls.join(",")}`], { stdio: "inherit" });
  if (res.status !== 0) console.log(`    (code de sortie ${res.status})`);
}
