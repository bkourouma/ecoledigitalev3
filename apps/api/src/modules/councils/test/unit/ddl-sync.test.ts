/**
 * Synchronisation du DDL de référence : les blocs `<!-- migration: 21xx_… -->` de `specs/v2/006-secondary/data-model.md` (extraits tels quels
 * par `ddl-test/`) et les migrations du module (`migrations/21xx_*.sql`, exécutées) doivent être IDENTIQUES — le document et le code ne
 * dérivent jamais. Les migrations sont plus récentes que le document sur un seul point : aucun.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Racine du dépôt introuvable.");
}

const norm = (s: string): string => s.replace(/\r\n/g, "\n").trimEnd();

describe("DDL de référence (data-model.md) = migrations du module councils", () => {
  const md = norm(readFileSync(resolve(repoRoot(), "specs/v2/006-secondary/data-model.md"), "utf8"));
  const blocks = new Map<string, string>();
  for (const m of md.matchAll(/<!--\s*migration:\s*(21\d\d_[A-Za-z0-9_.-]+\.sql)\s*-->\s*```sql\n([\s\S]*?)\n```/g)) blocks.set(m[1] as string, norm(m[2] as string));
  const dir = resolve(__dirname, "../../migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  it("mêmes fichiers, dans la plage 2100-2199", () => {
    expect(files).toEqual([...blocks.keys()].sort());
    for (const f of files) expect(Number(f.slice(0, 4)), f).toBeGreaterThanOrEqual(2100);
    for (const f of files) expect(Number(f.slice(0, 4)), f).toBeLessThanOrEqual(2199);
  });

  it("contenu identique, bloc par bloc", () => {
    for (const f of files) expect(norm(readFileSync(resolve(dir, f), "utf8")), f).toBe(blocks.get(f));
  });
});
