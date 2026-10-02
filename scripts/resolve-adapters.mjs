// Résout les conflits « chaque branche ajoute son bloc » de apps/api/src/platform/adapters/index.ts.
// Usage : node scripts/resolve-adapters.mjs  (blocs dans l'ordre : imports, interface, base, ports `{`, register…)
import { readFileSync, writeFileSync } from "node:fs";
const f = "apps/api/src/platform/adapters/index.ts";
let s = readFileSync(f, "utf8");
const re = /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> .*\r?\n/g;
s = s.replace(re, (_m, h, t) => {
  if (/const base: Omit<PlatformPorts/.test(h)) {
    // Les deux côtés déclarent `const base` : on garde les préambules des deux et la déclaration de HEAD.
    const hl = h.split(/\r?\n/).filter(Boolean), tl = t.split(/\r?\n/).filter(Boolean);
    const baseIdx = hl.findIndex((l) => l.includes("const base:"));
    const tBase = tl.findIndex((l) => l.includes("const base:"));
    return [...hl.slice(0, baseIdx), ...tl.slice(0, tBase), hl[baseIdx]].join("\n") + "\n";
  }
  if (/^\s+\w+: \{\s*$/m.test(h) && /^\s+\w+: \{\s*$/m.test(t) && !h.includes("registerr")) return h + "    },\n" + t;
  return h + t;
});
writeFileSync(f, s);
