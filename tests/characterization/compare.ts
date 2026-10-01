import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFECT_CATALOG, type DefectOccurrence } from "./harness/defects";
import { scenarios, type ScenarioName } from "./scenarios/index";
import type { Scenario } from "./scenarios/types";

/**
 * API de comparaison réutilisable en Phase 2 : le nouveau code (seeder v2 + Rules Engine) charge les MÊMES scénarios, produit une
 * sortie de même forme, et la compare à la snapshot du legacy.
 *
 *   const scenario = loadScenario("bts-premiere-annee");     // données déclaratives, sans schéma legacy
 *   const snapshot = loadSnapshot("bts-premiere-annee");     // sortie legacy figée + bogues connus
 *   const result = compareWithTolerance(actualV2, snapshot, { knownDefects: "bugs" });
 *   expect(result.differences).toEqual([]);                  // aucune dérive inexpliquée
 *   expect(result.stillDefective).toEqual([]);               // et la v2 ne reproduit PAS les bogues connus
 *
 * Chemins : segments séparés par `.`, indices de tableau `[n]`, clés exotiques `["a.b"]`. Les motifs de portée acceptent `*` (dans un
 * segment), `*` seul (un segment) et `**` (tout le reste).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface Snapshot {
  schemaVersion: number;
  scenario: string;
  source: "legacy";
  knownLegacyDefects: DefectOccurrence[];
  defectCatalog: Record<string, { status: string; title: string }>;
  data: unknown;
}

export function loadScenario(name: ScenarioName | (string & {})): Scenario {
  const s = (scenarios as Record<string, Scenario>)[name];
  if (!s) throw new Error(`Scénario inconnu : ${name}. Connus : ${Object.keys(scenarios).join(", ")}`);
  return s;
}

export function loadSnapshot(name: string, dir = join(dirname(fileURLToPath(import.meta.url)), "snapshots")): Snapshot {
  const file = join(dir, `${name}.snapshot.json`);
  if (!existsSync(file)) throw new Error(`Snapshot introuvable : ${file}`);
  const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  if (snap.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Version de snapshot non gérée (${snap.schemaVersion}) dans ${file}`);
  }
  return snap;
}

/* ------------------------------------------------------------------------- */
/* Chemins                                                                   */
/* ------------------------------------------------------------------------- */

const SEGMENT_RE = /\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|([^.[\]]+)/g;

export function parsePath(path: string): string[] {
  const out: string[] = [];
  for (const m of path.matchAll(SEGMENT_RE)) {
    if (m[1] !== undefined) out.push(`[${m[1]}]`);
    else if (m[2] !== undefined) out.push(m[2].replace(/\\(.)/g, "$1"));
    else out.push(m[3]);
  }
  return out;
}

export function joinPath(base: string, segment: string | number): string {
  if (typeof segment === "number") return `${base}[${segment}]`;
  const plain = !/[.[\]"]/.test(segment) && segment.length > 0;
  const part = plain ? segment : `["${segment.replace(/(["\\])/g, "\\$1")}"]`;
  return base === "" ? (plain ? segment : part) : plain ? `${base}.${part}` : `${base}${part}`;
}

export function getAtPath(data: unknown, path: string): { found: boolean; value: unknown } {
  let cur: any = data;
  for (const seg of parsePath(path)) {
    if (cur === null || cur === undefined) return { found: false, value: undefined };
    const idx = /^\[(\d+)\]$/.exec(seg);
    const key = idx ? Number(idx[1]) : seg;
    if (typeof cur !== "object" || !(key in cur)) return { found: false, value: undefined };
    cur = cur[key as never];
  }
  return { found: true, value: cur };
}

function segmentToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`, "s");
}

/** `pattern` couvre-t-il `path` ? */
export function pathMatches(pattern: string, path: string): boolean {
  const p = parsePath(pattern);
  const s = parsePath(path);
  let i = 0;
  for (; i < p.length; i++) {
    if (p[i] === "**") return true;
    if (i >= s.length) return false;
    if (p[i] === "*") continue;
    if (p[i].includes("*")) {
      if (!segmentToRegex(p[i]).test(s[i])) return false;
    } else if (p[i] !== s[i]) return false;
  }
  return i === s.length;
}

/* ------------------------------------------------------------------------- */
/* Comparaison                                                               */
/* ------------------------------------------------------------------------- */

export interface CompareOptions {
  /**
   * Bogues connus dont la divergence est tolérée :
   *   - `"bugs"` (défaut) : statuts `bug` et `dead` ;
   *   - `"all"` : y compris les `quirk` (comportements surprenants mais conformes à la règle écrite) ;
   *   - `"none"` : aucune tolérance, tout écart est une dérive ;
   *   - une liste d'identifiants du catalogue.
   */
  knownDefects?: "bugs" | "all" | "none" | string[];
  /** Tolérance absolue sur les nombres (défaut 1e-9). */
  tolerance?: number;
  /** Tolérance relative sur les nombres (défaut 0). */
  relativeTolerance?: number;
  /** Compare aussi les chaînes décimales (`"55000.00"` vs `"55000"`) comme des nombres. Défaut true. */
  numericStrings?: boolean;
  /** Motifs de chemins à ignorer (ex. champs que la v2 ne reproduit pas volontairement). */
  ignore?: string[];
  /** Si défini, seuls les sous-arbres correspondant à ces motifs sont comparés. */
  only?: string[];
}

export interface Difference {
  path: string;
  kind: "value" | "missing" | "extra" | "type";
  expected: unknown;
  actual: unknown;
}

export interface AcceptedDivergence extends Difference {
  defect: string;
  via: "path" | "scope";
}

export interface ComparisonResult {
  /** Aucune dérive inexpliquée. Les bogues connus qui ne divergent PAS sont rapportés dans `stillDefective`, pas ici. */
  equal: boolean;
  /** Écarts non couverts par un bogue connu : à traiter comme des régressions (ou à documenter). */
  differences: Difference[];
  /** Écarts couverts par un bogue connu (chemin du défaut ou sous-arbre de portée). */
  acceptedDivergences: AcceptedDivergence[];
  /** Bogues tolérés dont la valeur au chemin est restée celle du legacy : la v2 reproduit le défaut. */
  stillDefective: DefectOccurrence[];
  /** Bogues tolérés dont la valeur au chemin est devenue la valeur correcte attendue. */
  corrected: DefectOccurrence[];
  /** Bogues tolérés dont la valeur diffère à la fois du legacy et de la valeur correcte (à examiner). */
  divergedElsewhere: DefectOccurrence[];
  /** Bogues tolérés non évalués : la valeur « correcte » est « à arbitrer » ou le chemin est absent de la sortie v2. */
  unverified: DefectOccurrence[];
}

function toleratedDefects(snapshot: Snapshot, option: CompareOptions["knownDefects"]): DefectOccurrence[] {
  const mode = option ?? "bugs";
  if (mode === "none") return [];
  return snapshot.knownLegacyDefects.filter((d) => {
    if (Array.isArray(mode)) return mode.includes(d.id);
    const status = DEFECT_CATALOG[d.id]?.status ?? snapshot.defectCatalog[d.id]?.status;
    return mode === "all" ? true : status === "bug" || status === "dead";
  });
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

function sameScalar(expected: unknown, actual: unknown, o: Required<Pick<CompareOptions, "tolerance" | "relativeTolerance" | "numericStrings">>): boolean {
  if (expected === actual) return true;
  if (typeof expected === "number" && typeof actual === "number") {
    const diff = Math.abs(expected - actual);
    return diff <= o.tolerance || diff <= o.relativeTolerance * Math.max(Math.abs(expected), Math.abs(actual));
  }
  if (o.numericStrings) {
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && DECIMAL.test(v) ? Number(v) : null);
    const a = num(expected);
    const b = num(actual);
    if (a !== null && b !== null && (typeof expected === "string" || typeof actual === "string")) {
      const diff = Math.abs(a - b);
      return diff <= o.tolerance || diff <= o.relativeTolerance * Math.max(Math.abs(a), Math.abs(b));
    }
  }
  return false;
}

function walkDiff(expected: unknown, actual: unknown, path: string, out: Difference[], o: Required<Pick<CompareOptions, "tolerance" | "relativeTolerance" | "numericStrings">>): void {
  const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  const te = typeOf(expected);
  const ta = typeOf(actual);
  if (te === "object" && ta === "object") {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    for (const k of Object.keys(e)) {
      const p = joinPath(path, k);
      if (!(k in a)) out.push({ path: p, kind: "missing", expected: e[k], actual: undefined });
      else walkDiff(e[k], a[k], p, out, o);
    }
    for (const k of Object.keys(a)) if (!(k in e)) out.push({ path: joinPath(path, k), kind: "extra", expected: undefined, actual: a[k] });
    return;
  }
  if (te === "array" && ta === "array") {
    const e = expected as unknown[];
    const a = actual as unknown[];
    const n = Math.max(e.length, a.length);
    for (let i = 0; i < n; i++) {
      const p = joinPath(path, i);
      if (i >= a.length) out.push({ path: p, kind: "missing", expected: e[i], actual: undefined });
      else if (i >= e.length) out.push({ path: p, kind: "extra", expected: undefined, actual: a[i] });
      else walkDiff(e[i], a[i], p, out, o);
    }
    return;
  }
  if (te !== ta && !(sameScalar(expected, actual, o))) {
    out.push({ path, kind: "type", expected, actual });
    return;
  }
  if (!sameScalar(expected, actual, o)) out.push({ path, kind: "value", expected, actual });
}

/**
 * Compare la sortie `actual` (même forme que `snapshot.data`) à la snapshot legacy, en tolérant :
 *   - les écarts numériques inférieurs à la tolérance ;
 *   - les divergences couvertes par un bogue connu (`knownDefects`) : au chemin du défaut et dans sa portée (`scope`).
 */
export function compareWithTolerance(actual: unknown, snapshot: Snapshot, options: CompareOptions = {}): ComparisonResult {
  const o = {
    tolerance: options.tolerance ?? 1e-9,
    relativeTolerance: options.relativeTolerance ?? 0,
    numericStrings: options.numericStrings ?? true,
  };
  const raw: Difference[] = [];
  walkDiff(snapshot.data, actual, "", raw, o);

  const ignore = options.ignore ?? [];
  const only = options.only;
  const relevant = raw.filter((d) => !ignore.some((p) => pathMatches(p, d.path)) && (!only || only.some((p) => pathMatches(p, d.path) || pathMatches(`${d.path}.**`, p))));

  const tolerated = toleratedDefects(snapshot, options.knownDefects);
  const differences: Difference[] = [];
  const acceptedDivergences: AcceptedDivergence[] = [];
  for (const d of relevant) {
    const byPath = tolerated.find((t) => pathMatches(t.path, d.path) || pathMatches(`${t.path}.**`, d.path));
    if (byPath) {
      acceptedDivergences.push({ ...d, defect: byPath.id, via: "path" });
      continue;
    }
    const byScope = tolerated.find((t) => t.scope.some((p) => pathMatches(p, d.path)));
    if (byScope) acceptedDivergences.push({ ...d, defect: byScope.id, via: "scope" });
    else differences.push(d);
  }

  const stillDefective: DefectOccurrence[] = [];
  const corrected: DefectOccurrence[] = [];
  const divergedElsewhere: DefectOccurrence[] = [];
  const unverified: DefectOccurrence[] = [];
  for (const t of tolerated) {
    const at = getAtPath(actual, t.path);
    const comparable = t.comparable !== false;
    if (!at.found || !comparable) {
      unverified.push(t);
      continue;
    }
    if (sameScalar(t.legacy, at.value, o)) stillDefective.push(t);
    else if (sameScalar(t.correct, at.value, o)) corrected.push(t);
    else divergedElsewhere.push(t);
  }

  return { equal: differences.length === 0, differences, acceptedDivergences, stillDefective, corrected, divergedElsewhere, unverified };
}
