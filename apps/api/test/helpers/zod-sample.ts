/**
 * Générateur d'ÉCHANTILLONS VALIDES à partir d'un schéma Zod 3 (utilisé par les tests de contrat d'événements).
 *
 * Couvre : object, string (uuid, datetime, regex, email…), number, boolean, enum, nativeEnum, literal, array, tuple,
 * record, optional, nullable, default, union, discriminatedUnion, intersection, effects (refine/transform), lazy, any.
 *
 * Deux variantes :
 *  - `full`    : tous les champs facultatifs sont présents, les `nullable` portent une valeur non nulle ;
 *  - `minimal` : seuls les champs obligatoires, les `nullable` valent `null`.
 * Un échantillon est toujours revalidé contre le schéma (`sampleOf` lève sinon) : pas de faux positif silencieux.
 */
import type { ZodTypeAny } from "zod";

export type SampleVariant = "full" | "minimal";

const UUID_V4 = "0b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90";
const STRING_CANDIDATES = [
  UUID_V4,
  "2026-09-15T08:30:00.000Z",
  "2026-09-15",
  "08:30",
  "12",
  "1.5",
  "sample-value",
  "sample@example.org",
  "https://example.org/x",
  "ABC-123",
  "A",
  "a",
  "0123456789",
];

/** Compteur déterministe pour produire des UUID distincts (ex. éléments de tableaux) sans hasard. */
let uuidCounter = 0;
export function nextUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

interface Def {
  typeName?: string;
  [k: string]: any;
}
const defOf = (s: ZodTypeAny): Def => (s as unknown as { _def: Def })._def;

export function isOptionalSchema(s: ZodTypeAny): boolean {
  return s.isOptional();
}

/** Déroule optional/nullable/default/effects/branded/readonly/catch jusqu'au schéma « structurel ». */
export function unwrap(s: ZodTypeAny): ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 20; i += 1) {
    const d = defOf(cur);
    switch (d.typeName) {
      case "ZodOptional":
      case "ZodNullable":
      case "ZodDefault":
      case "ZodReadonly":
      case "ZodCatch":
        cur = d.innerType;
        break;
      case "ZodBranded":
        cur = d.type;
        break;
      case "ZodEffects":
        cur = d.schema;
        break;
      case "ZodPipeline":
        cur = d.in;
        break;
      case "ZodLazy":
        cur = d.getter();
        break;
      default:
        return cur;
    }
  }
  return cur;
}

export function isNullableSchema(s: ZodTypeAny): boolean {
  return s.safeParse(null).success;
}

// ---------------------------------------------------------------------------
// Chaîne minimale satisfaisant une expression régulière simple (classes, quantificateurs, groupes, alternances).
// Les assertions (^ $ \b), lookaheads et références arrière ne sont pas gérées : on retombe alors sur les candidats.
// ---------------------------------------------------------------------------

const CLASS_ESCAPES: Record<string, string> = { d: "0123456789", w: "aA0_", s: " " };

function parseClass(src: string, start: number): { chars: string; next: number } {
  let i = start + 1;
  const negate = src[i] === "^";
  if (negate) i += 1;
  const set: string[] = [];
  while (i < src.length && src[i] !== "]") {
    let c = src[i]!;
    if (c === "\\") {
      i += 1;
      const e = src[i]!;
      if (CLASS_ESCAPES[e]) {
        set.push(...CLASS_ESCAPES[e]!);
        i += 1;
        continue;
      }
      c = e;
    }
    if (src[i + 1] === "-" && src[i + 2] !== undefined && src[i + 2] !== "]") {
      const from = c.charCodeAt(0);
      const to = src[i + 2]!.charCodeAt(0);
      for (let code = from; code <= to; code += 1) set.push(String.fromCharCode(code));
      i += 3;
      continue;
    }
    set.push(c);
    i += 1;
  }
  if (!negate) return { chars: set.join(""), next: i + 1 };
  const candidates = "aA0_-xX9 ";
  return { chars: [...candidates].filter((ch) => !set.includes(ch)).join("") || "~", next: i + 1 };
}

function regexSample(source: string): string | null {
  let pos = 0;
  const parseAlternation = (): string => {
    const branches: string[] = [parseSequence()];
    while (source[pos] === "|") {
      pos += 1;
      branches.push(parseSequence());
    }
    return branches[0]!;
  };
  const parseSequence = (): string => {
    let out = "";
    while (pos < source.length && source[pos] !== "|" && source[pos] !== ")") {
      let atom: string;
      const c = source[pos]!;
      if (c === "^" || c === "$") {
        pos += 1;
        continue;
      }
      if (c === "(") {
        pos += 1;
        if (source.startsWith("?:", pos)) pos += 2;
        else if (source[pos] === "?") throw new Error("regex non gérée (assertion)");
        atom = parseAlternation();
        pos += 1; // ")"
      } else if (c === "[") {
        const cls = parseClass(source, pos);
        atom = cls.chars[0] ?? "a";
        pos = cls.next;
      } else if (c === "\\") {
        const e = source[pos + 1]!;
        if (e === "b" || e === "B") throw new Error("regex non gérée (frontière)");
        atom = CLASS_ESCAPES[e] ? CLASS_ESCAPES[e]![0]! : e;
        pos += 2;
      } else if (c === ".") {
        atom = "a";
        pos += 1;
      } else {
        atom = c;
        pos += 1;
      }
      // Quantificateur
      let min = 1;
      const q = source[pos];
      if (q === "*" || q === "?") {
        min = 0;
        pos += 1;
      } else if (q === "+") {
        pos += 1;
      } else if (q === "{") {
        const end = source.indexOf("}", pos);
        min = Number.parseInt(source.slice(pos + 1, end).split(",")[0]!, 10);
        pos = end + 1;
      }
      if (source[pos] === "?" || source[pos] === "+") pos += 1; // paresseux / possessif
      out += atom.repeat(min);
    }
    return out;
  };
  try {
    return parseAlternation();
  } catch {
    return null;
  }
}

function stringSample(s: ZodTypeAny, key: string | undefined): string {
  const d = defOf(unwrap(s));
  const kinds: string[] = (d.checks ?? []).map((c: { kind: string }) => c.kind);
  const wantsUuid = kinds.includes("uuid") || (key !== undefined && /(^|[a-z])Ids?$/.test(key));
  const ordered = wantsUuid ? [UUID_V4, ...STRING_CANDIDATES] : kinds.includes("datetime") ? ["2026-09-15T08:30:00.000Z", ...STRING_CANDIDATES] : STRING_CANDIDATES;
  for (const candidate of ordered) if (s.safeParse(candidate).success) return candidate;
  // Expressions régulières : chaîne minimale construite depuis la source de la regex.
  for (const check of (d.checks ?? []) as Array<{ kind: string; regex?: RegExp }>) {
    if (check.kind !== "regex" || !check.regex) continue;
    const candidate = regexSample(check.regex.source);
    if (candidate !== null && s.safeParse(candidate).success) return candidate;
  }
  // Dernier recours : contraintes de longueur.
  const min = (d.checks ?? []).find((c: { kind: string }) => c.kind === "min")?.value ?? 1;
  const filler = "x".repeat(Math.max(1, Math.min(min, 200)));
  if (s.safeParse(filler).success) return filler;
  throw new Error(`zod-sample : aucune chaîne valide trouvée pour la clé « ${key ?? "?"} » (contrôles : ${kinds.join(",")}).`);
}

function numberSample(s: ZodTypeAny): number {
  const d = defOf(unwrap(s));
  const checks: Array<{ kind: string; value?: number; inclusive?: boolean }> = d.checks ?? [];
  const isInt = checks.some((c) => c.kind === "int");
  let lo = -Infinity;
  let hi = Infinity;
  for (const c of checks) {
    if (c.kind === "min" && c.value !== undefined) lo = Math.max(lo, c.inclusive === false ? c.value + 1 : c.value);
    if (c.kind === "max" && c.value !== undefined) hi = Math.min(hi, c.inclusive === false ? c.value - 1 : c.value);
  }
  const candidates = [1, 0, 2, 10, 100, lo, hi, 1.5].filter((n) => Number.isFinite(n) && n >= lo && n <= hi && (!isInt || Number.isInteger(n)));
  for (const n of candidates) if (s.safeParse(n).success) return n;
  throw new Error("zod-sample : aucun nombre valide trouvé.");
}

function build(s: ZodTypeAny, variant: SampleVariant, key?: string, depth = 0): unknown {
  if (depth > 12) throw new Error("zod-sample : schéma trop profond ou récursif.");
  const d = defOf(s);
  switch (d.typeName) {
    case "ZodOptional":
      return build(d.innerType, variant, key, depth + 1);
    case "ZodNullable":
      return variant === "minimal" ? null : build(d.innerType, variant, key, depth + 1);
    case "ZodDefault":
    case "ZodReadonly":
    case "ZodCatch":
      return build(d.innerType, variant, key, depth + 1);
    case "ZodBranded":
      return build(d.type, variant, key, depth + 1);
    case "ZodEffects": {
      // Un `transform` accepte l'entrée du schéma interne ; un `refine` se vérifie sur l'échantillon final.
      return build(d.schema, variant, key, depth + 1);
    }
    case "ZodPipeline":
      return build(d.in, variant, key, depth + 1);
    case "ZodLazy":
      return build(d.getter(), variant, key, depth + 1);
    case "ZodString":
      return stringSample(s, key);
    case "ZodNumber":
      return numberSample(s);
    case "ZodBigInt":
      return 1n;
    case "ZodBoolean":
      return true;
    case "ZodDate":
      return new Date("2026-09-15T08:30:00.000Z");
    case "ZodNull":
      return null;
    case "ZodUndefined":
      return undefined;
    case "ZodAny":
    case "ZodUnknown":
      return {};
    case "ZodLiteral":
      return d.value;
    case "ZodEnum":
      return d.values[0];
    case "ZodNativeEnum": {
      const values = d.values as Record<string, string | number>;
      const vals = Object.values(values).filter((v) => typeof v === "string" ? values[v] === undefined || typeof values[v] !== "number" : true);
      return vals[0];
    }
    case "ZodArray": {
      const min = d.minLength?.value ?? 0;
      const count = Math.max(min, variant === "full" ? 1 : 0);
      return Array.from({ length: count }, () => build(d.type, variant, key, depth + 1));
    }
    case "ZodTuple":
      return (d.items as ZodTypeAny[]).map((item, i) => build(item, variant, `${key ?? ""}${i}`, depth + 1));
    case "ZodRecord":
      return variant === "full" ? { sample: build(d.valueType, variant, "sample", depth + 1) } : {};
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(shape)) {
        if (variant === "minimal" && child.isOptional()) continue;
        const value = build(child, variant, k, depth + 1);
        if (value !== undefined) out[k] = value;
      }
      return out;
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options: ZodTypeAny[] = d.options as ZodTypeAny[];
      let lastError: unknown;
      for (const option of options) {
        try {
          const candidate = build(option, variant, key, depth + 1);
          if (s.safeParse(candidate).success) return candidate;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError ?? new Error("zod-sample : aucune branche d'union exploitable.");
    }
    case "ZodIntersection": {
      const left = build(d.left, variant, key, depth + 1);
      const right = build(d.right, variant, key, depth + 1);
      return typeof left === "object" && typeof right === "object" && left && right ? { ...(left as object), ...(right as object) } : left;
    }
    default:
      throw new Error(`zod-sample : type Zod non géré « ${String(d.typeName)} » (clé ${key ?? "?"}).`);
  }
}

/** Échantillon valide (revalidé) pour `schema`. Lève si le générateur ne sait pas en produire un. */
export function sampleOf(schema: ZodTypeAny, variant: SampleVariant = "full"): unknown {
  const value = build(schema, variant);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`zod-sample : l'échantillon ${variant} produit n'est pas valide : ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  }
  return value;
}

/** Forme d'un objet (champ -> schéma) après avoir déroulé les enveloppes d'effets ; `null` si ce n'est pas un objet. */
export function objectShapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> | null {
  const inner = unwrap(schema);
  const d = defOf(inner);
  if (d.typeName === "ZodObject") return (d.shape as () => Record<string, ZodTypeAny>)();
  if (d.typeName === "ZodIntersection") {
    const l = objectShapeOf(d.left);
    const r = objectShapeOf(d.right);
    return l && r ? { ...l, ...r } : (l ?? r);
  }
  return null;
}

export type ZodKind = "string" | "uuid" | "number" | "boolean" | "array" | "object" | "other";

/** Nature d'un champ (après déroulage des enveloppes) : sert à comparer au type lu par le consommateur. */
export function kindOf(schema: ZodTypeAny): ZodKind {
  const inner = unwrap(schema);
  const d = defOf(inner);
  switch (d.typeName) {
    case "ZodString": {
      const kinds: string[] = (d.checks ?? []).map((c: { kind: string }) => c.kind);
      return kinds.includes("uuid") ? "uuid" : "string";
    }
    case "ZodEnum":
    case "ZodNativeEnum":
      return "string";
    case "ZodLiteral":
      return typeof d.value === "string" ? "string" : typeof d.value === "number" ? "number" : typeof d.value === "boolean" ? "boolean" : "other";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
    case "ZodRecord":
      return "object";
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const kinds = new Set((d.options as ZodTypeAny[]).map((o) => kindOf(o)));
      return kinds.size === 1 ? [...kinds][0]! : "other";
    }
    default:
      return "other";
  }
}
