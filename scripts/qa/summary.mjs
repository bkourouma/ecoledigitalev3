#!/usr/bin/env node
/** Synthese rapide des resultats bruts : node scripts/qa/summary.mjs [tenant] [--min] : constats regroupes par type et message. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { demoDir } from "./lib.mjs";

const tenant = process.argv.slice(2).find((a) => !a.startsWith("--"));
const withMinor = process.argv.includes("--min");
const dir = join(demoDir(), "qa");
const groups = new Map();
let pages = 0;
for (const f of readdirSync(dir).filter((n) => /^acct-/.test(n) && (!tenant || n.includes(tenant)))) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8")).result;
  for (const p of r.pages) {
    pages += 1;
    for (const x of p.findings ?? []) {
      if (!withMinor && x.severity === "mineur") continue;
      const msg = x.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").replace(/\?\S*/g, "");
      const key = `${x.severity}|${x.code}|${msg}`;
      const g = groups.get(key) ?? { n: 0, roles: new Set(), urls: new Set(), ev: x.evidence };
      g.n += 1;
      g.roles.add(r.account.role);
      g.urls.add(p.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id"));
      groups.set(key, g);
    }
  }
}
console.log(`${pages} pages`);
for (const [k, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`\n[${k.split("|").slice(0, 2).join(" ")}] ${k.split("|").slice(2).join("|").slice(0, 170)}  x${g.n}, ${g.roles.size} role(s): ${[...g.roles].slice(0, 5).join(",")}`);
  console.log(`    pages: ${[...g.urls].slice(0, 4).join(", ")}${g.urls.size > 4 ? ` (+${g.urls.size - 4})` : ""}`);
  console.log(`    preuve: ${String(g.ev).replace(/\s+/g, " ").slice(0, 200)}`);
}
