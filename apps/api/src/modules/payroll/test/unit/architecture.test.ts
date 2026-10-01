/**
 * Garde-fous d'architecture (spec 032 AC1.2, critère de sortie 5, conventions n° 3, 5, 7, 11) — tests de TEXTE sur
 * le code du module : ils échouent si quelqu'un redéfinit le prédicat de payabilité, introduit un flottant monétaire,
 * une constante de seuil, une horloge système, un SQL hors infrastructure ou un contrôle de rôle codé en dur.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (f: string): string => relative(moduleDir, f).replace(/\\/g, "/");
const all = walk(moduleDir).filter((f) => f.endsWith(".ts") && !rel(f).startsWith("test/"));
const read = (f: string): string => readFileSync(f, "utf8");
/** Code sans commentaires de ligne ni de bloc (les commentaires peuvent citer les valeurs du legacy). */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const byPrefix = (prefix: string): string[] => all.filter((f) => rel(f).startsWith(prefix));

describe("prédicat de payabilité : UNE définition, UN endroit (AC1.2, R-PAY-03)", () => {
  it("isPayable / retainedMinutes / payabilityBlockers ne sont définis que dans domain/payability.ts", () => {
    const definers = all.filter((f) => /function\s+(isPayable|retainedMinutes|payabilityBlockers|toPayable)\b|const\s+(isPayable|retainedMinutes|payabilityBlockers|toPayable)\s*=/.test(code(f))).map(rel);
    expect(definers).toEqual(["domain/payability.ts"]);
  });

  it("aucun autre fichier ne recompose la condition (réalisée ∧ validée ∧ durée) : seuls payability.ts, types.ts et les ports/doublures touchent à ces champs", () => {
    const allowed = new Set(["domain/payability.ts", "domain/types.ts", "application/ports.ts", "infrastructure/in-memory-ports.ts"]);
    const offenders = all
      .filter((f) => !allowed.has(rel(f)))
      .filter((f) => /\.(realized|validated|paidMinutesOverride|durationMinutes)\b/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("la durée n'est jamais recalculée ailleurs (fin − début) : timeToMinutes n'est utilisé que par payability et par l'ordre des heures", () => {
    const users = all.filter((f) => /\btimeToMinutes\(/.test(code(f))).map(rel).sort();
    expect(users).toEqual(["domain/calculation.ts", "domain/calendar.ts", "domain/payability.ts"]);
  });
});

describe("montants entiers, durées en minutes, aucun flottant monétaire (ADR-007, R-PAY-07)", () => {
  it("aucun parseFloat / toFixed / Math.round(x * 100) / décimal SQL dans le module", () => {
    const offenders = all.filter((f) => /\bparseFloat\b|\.toFixed\(|Math\.round\([^)]*\*\s*100\)|Math\.floor\([^)]*\/\s*100\)/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("l'arrondi d'une ligne passe par Money.multiplyRatio (demi-supérieur), jamais par Math.round sur un montant", () => {
    const calc = code(join(moduleDir, "domain", "calculation.ts"));
    expect(calc).toMatch(/multiplyRatio\(/);
    expect(calc).toMatch(/"HALF_UP"/);
    expect(calc).not.toMatch(/Math\.round|Math\.floor|Math\.ceil|\.toFixed/);
    // (calendar.ts convertit des JOURS : Math.round y arrondit un nombre de jours, jamais un montant)
    const domainFiles = byPrefix("domain/").filter((f) => rel(f) !== "domain/calendar.ts");
    expect(domainFiles.filter((f) => /Math\.round|Math\.floor|Math\.ceil/.test(code(f))).map(rel)).toEqual([]);
  });
});

describe("aucune constante de seuil, de taux ou de majoration dans le code (conventions n° 11)", () => {
  it("40 h / ×1,5 / 2400 / 1500 n'apparaissent que dans les migrations (valeurs par défaut des réglages)", () => {
    const offenders = all.filter((f) => /\b(2400|1500|2_400|1_500|40\s*\*\s*60)\b|overtimeMultiplier\s*[:=]\s*1\.5|\b1\.5\b/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
    const migrations = walk(join(moduleDir, "migrations")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(migrations).toMatch(/default_overtime_threshold_minutes\s+integer NOT NULL DEFAULT 2400/);
    expect(migrations).toMatch(/default_overtime_multiplier_permille\s+integer NOT NULL DEFAULT 1500/);
  });

  it("aucun taux horaire ni salaire littéral (le tarif vient de la table des tarifs / de la configuration)", () => {
    const offenders = all.filter((f) => /(hourlyRate|rate|salary)\s*[:=]\s*[1-9]\d{2,}\b/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("horloge, identifiants, accès aux données (conventions n° 3, 5)", () => {
  it("aucun new Date() sans argument ni Date.now() : l'horloge est injectée", () => {
    const offenders = all.filter((f) => /new Date\(\)|Date\.now\(\)/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("aucun accès SQL hors infrastructure/ (hors plomberie de verrous de deps.ts)", () => {
    const offenders = all
      .filter((f) => !rel(f).startsWith("infrastructure/") && rel(f) !== "application/deps.ts")
      .filter((f) => /\btx\.(query|queryOne|many)\(|\bpool\.query\(|\bnew Pool\b|from "pg"/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("aucun SQL construit à partir de l'entrée : les gabarits n'interpolent que des constantes, des clauses assemblées et des numéros de paramètre", () => {
    const SAFE = [
      /^[A-Z][A-Z_]+$/, // PAYSLIP_COLUMNS, SETTINGS_COLUMNS…
      /^(clause|from|order|table)$/,
      /^(sets|clauses|tuples|where)\.join\(/,
      /^columns\.join\(/,
      /^push\(/, // pousse la valeur dans les paramètres et renvoie `$n`
      /^params\.length( [-+] \d)?$/,
      /^opts\.forUpdate \?/,
      /^clauses\.length \?/,
      /^cast \?/,
      /^pending\b/,
    ];
    const offenders: string[] = [];
    for (const f of byPrefix("infrastructure/")) {
      for (const m of read(f).matchAll(/`([^`]*)`/g)) {
        const body = m[1] as string;
        if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(body)) continue;
        for (const e of body.matchAll(/\$\{([^}]+)\}/g)) {
          const expr = (e[1] as string).trim();
          if (!SAFE.some((re) => re.test(expr))) offenders.push(`${rel(f)} : \${${expr}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("domain/ est pur : ni pg, ni fastify, ni database, ni infrastructure/application/http", () => {
    const offenders = byPrefix("domain/").filter((f) => /from "(pg|fastify|@ecoledigitale\/database)|from "\.\.\/(infrastructure|application|http)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("HTTP : permissions, ordre des routes, routes supprimées (R-PAY-16/17)", () => {
  const plugin = code(join(moduleDir, "http", "plugin.ts"));
  const routes = [...plugin.matchAll(/scope\.(get|post|put|patch|delete)\(\s*"([^"]+)"([^]*?)\n\s{6}(?:\}\);|\},)/g)].map((m) => ({ method: (m[1] as string).toUpperCase(), path: m[2] as string, body: m[3] as string }));

  it("aucun contrôle de rôle codé en dur", () => {
    expect(plugin).not.toMatch(/ctx\.roles|\.roles\.includes|activeRole|"owner"|"admin"|'admin'/);
  });

  it("toute route déclare un preHandler de permission (aucune route publique)", () => {
    const declared = [...plugin.matchAll(/scope\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*\{([^}]*)\}/g)];
    expect(declared.length).toBeGreaterThanOrEqual(35);
    for (const m of declared) expect(m[3], `${m[1]} ${m[2]}`).toMatch(/preHandler:\s*guard\(/);
    expect(plugin).not.toMatch(/public:\s*true/);
  });

  it("chaque permission utilisée existe dans le manifeste", () => {
    const manifestText = readFileSync(join(moduleDir, "manifest.ts"), "utf8");
    const used = new Set([...plugin.matchAll(/"(payroll\.[a-z_]+\.[a-z_]+)"/g)].map((m) => m[1] as string));
    expect(used.size).toBeGreaterThan(10);
    for (const p of used) expect(manifestText, p).toContain(`"${p}"`);
  });

  it("chemins statiques déclarés AVANT les chemins paramétrés (piège n°10)", () => {
    const paths = [...plugin.matchAll(/scope\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1] as string, path: m[2] as string }));
    paths.forEach((p, i) => {
      const segs = p.path.split("/");
      const last = segs[segs.length - 1] as string;
      if (last.startsWith(":")) return;
      // une route statique `X/<mot>` ne doit pas suivre une route `X/:param` de même méthode
      const parent = segs.slice(0, -1).join("/");
      const shadow = paths.findIndex((q, j) => j < i && q.method === p.method && q.path.split("/").slice(0, -1).join("/") === parent && (q.path.split("/").pop() as string).startsWith(":") && q.path.split("/").length === segs.length);
      expect(shadow, `${p.method} ${p.path} masquée par une route paramétrée`).toBe(-1);
    });
  });

  it("aucune route de purge, de statut libre ni de création manuelle de bulletin", () => {
    expect(plugin).not.toMatch(/purge|\/status"|\/payslips"\s*,\s*\{[^}]*\}\s*,\s*async[^]{0,80}create/i);
    const post = [...plugin.matchAll(/scope\.post\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(post).not.toContain("/payslips");
    expect(routes.length).toBeGreaterThan(0);
    // le seul contrôle d'identité d'un enseignant est dérivé du compte (/my/* sans paramètre)
    expect(plugin).not.toMatch(/\/my\/[^"]*:teacherId|teacherId/);
  });

  it("le plugin importe ses schémas depuis packages/contracts (conventions n° 9)", () => {
    expect(plugin).toMatch(/@ecoledigitale\/contracts\/src\/v2\/payroll/);
  });
});

describe("messages et identifiants", () => {
  it("codes d'erreur stables préfixés `payroll.` et uniques", () => {
    const text = read(join(moduleDir, "domain", "errors.ts"));
    const codes = [...text.matchAll(/:\s*"(payroll\.[a-z_]+)"/g)].map((m) => m[1] as string);
    expect(codes.length).toBeGreaterThan(15);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
