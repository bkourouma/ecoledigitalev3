// Résout un conflit de fusion git sur apps/web/messages/fr-CI.json par union profonde des clés (HEAD ∪ MERGE_HEAD).
// Usage (pendant une fusion en conflit) : node scripts/merge-i18n.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const file = "apps/web/messages/fr-CI.json";
const show = (ref) => JSON.parse(execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 1 << 28 }).toString("utf8").replace(/^﻿/, ""));
const merge = (a, b, path = "") => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k in out && out[k] && typeof out[k] === "object" && v && typeof v === "object") out[k] = merge(out[k], v, `${path}/${k}`);
    else if (k in out && JSON.stringify(out[k]) !== JSON.stringify(v)) console.warn(`divergence (HEAD conservé) : ${path}/${k}`);
    else if (!(k in out)) out[k] = v;
  }
  return out;
};
const merged = merge(show("HEAD"), show("MERGE_HEAD"));
const crlf = readFileSync(file).includes("\r\n");
const text = JSON.stringify(merged, null, 2) + "\n";
writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
console.log(`fr-CI.json fusionné : ${Object.keys(merged).length} espaces de noms`);
