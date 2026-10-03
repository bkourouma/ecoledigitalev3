#!/usr/bin/env node
/** Affiche les constats bloquants/majeurs d'un resultat brut en cours ou termine : node scripts/qa/peek.mjs <tenant> <role> [--all] */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoDir } from "./lib.mjs";

const [tenant, role] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");
const data = JSON.parse(readFileSync(join(demoDir(), "qa", `acct-${tenant}-${role}.json`), "utf8"));
const r = data.result;
console.log(`${r.account.tenant}/${r.account.role} : ${r.pages.length} pages, done=${data.done}, landing=${r.landing}`);
for (const p of r.pages) {
  const f = (p.findings ?? []).filter((x) => all || x.severity !== "mineur");
  if (!f.length) continue;
  console.log(`\n${p.url} (${p.navStatus}) -> ${p.finalUrl}`);
  for (const x of f) console.log(`   ${x.severity} ${x.code}: ${x.message.slice(0, 140)} | ${x.evidence.slice(0, 220).replace(/\s+/g, " ")}`);
}
