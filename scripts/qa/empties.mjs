#!/usr/bin/env node
/** Liste des etats vides releves, par page et role : node scripts/qa/empties.mjs [tenant] */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { demoDir } from "./lib.mjs";

const tenant = process.argv[2];
const dir = join(demoDir(), "qa");
const rows = new Map();
for (const f of readdirSync(dir).filter((n) => /^acct-/.test(n) && (!tenant || n.includes(tenant)))) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8")).result;
  for (const p of r.pages) {
    for (const x of p.findings ?? []) {
      if (x.code !== "empty-state") continue;
      const url = p.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id");
      const key = `${url} | ${x.evidence.replace(/\s+/g, " ").slice(0, 90)}`;
      const set = rows.get(key) ?? new Set();
      set.add(`${r.account.tenant.replace("demo-", "")}/${r.account.role}${p.isMenuLink ? "" : "(hm)"}`);
      rows.set(key, set);
    }
  }
}
for (const [k, v] of [...rows].sort()) console.log(`${k}  <- ${[...v].slice(0, 5).join(", ")}${v.size > 5 ? ` +${v.size - 5}` : ""}`);
