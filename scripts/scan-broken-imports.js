// One-shot: find unresolved "@/..." imports under apps/web/src.
// Run from repo root: node scripts/scan-broken-imports.js
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "apps", "web", "src");
const broken = new Map();

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(p);
  }
  return files;
}

function resolveImport(importPath) {
  const sub = importPath.replace(/^@\//, "");
  const candidates = [
    path.join(SRC, sub),
    path.join(SRC, sub + ".ts"),
    path.join(SRC, sub + ".tsx"),
    path.join(SRC, sub + ".js"),
    path.join(SRC, sub + ".jsx"),
    path.join(SRC, sub, "index.ts"),
    path.join(SRC, sub, "index.tsx"),
    path.join(SRC, sub, "index.js"),
    path.join(SRC, sub, "index.jsx"),
  ];
  for (const c of candidates) {
    try {
      const s = fs.statSync(c);
      if (s.isFile() || s.isDirectory()) return true;
    } catch {}
  }
  return false;
}

const importRe = /(?:import|require)\s*(?:\([^)]*?["']([^"']+)["']|[^"']*?from\s+["']([^"']+)["'])/g;

for (const f of walk(SRC)) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = importRe.exec(src))) {
    const imp = m[1] || m[2];
    if (!imp || !imp.startsWith("@/")) continue;
    if (!resolveImport(imp)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      if (!broken.has(imp)) broken.set(imp, []);
      broken.get(imp).push(rel);
    }
  }
}

const sorted = [...broken.entries()].sort();
console.log("UNRESOLVED @/ IMPORTS: " + sorted.length);
for (const [imp, files] of sorted) {
  console.log("  " + imp);
  for (const f of files.slice(0, 8)) console.log("    <- " + f);
  if (files.length > 8) console.log("    <- ... and " + (files.length - 8) + " more");
}
