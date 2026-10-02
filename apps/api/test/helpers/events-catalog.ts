/**
 * Catalogue des événements inter-modules, construit par ANALYSE STATIQUE + manifestes découverts.
 *
 * Sert au test global `events-catalog.test.ts` et aux tests de contrat `events-contracts/*.test.ts`.
 * Aucune base de données : on lit les manifestes (`discoverModules`), le code source des modules
 * (hors tests/migrations) et les abonnés du worker (`subscribers.ts`, importés).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverModules, type DiscoveredModule } from "../../src/modules/registry-discovery";
import { compilePattern, type TypeMatcher } from "../../../worker/src/events/pattern";

// Le module peut porter un « _ » dans sa clé (convention des modules : `primary_school`).
export const EVENT_NAME_RE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

export interface SubscriberInfo {
  module: string;
  name: string;
  pattern: string | RegExp;
  matches: TypeMatcher;
}

export interface EmissionSite {
  module: string;
  /** Chemin relatif au dossier du module. */
  file: string;
  line: number;
  name: string;
  kind: "literal" | "emission";
}

export interface EventsCatalog {
  modules: DiscoveredModule[];
  keys: string[];
  publishes: Map<string, string[]>;
  consumes: Map<string, string[]>;
  /** Nom d'événement publié -> modules déclarant le publier. */
  producers: Map<string, string[]>;
  allPublished: string[];
  subscribers: SubscriberInfo[];
  /** Littéraux de chaîne complets « <module>.<entité>.<verbe> » préfixés par la clé du module, dans son code source. */
  literals: EmissionSite[];
  /** Littéraux passés à un point d'émission (`.add(`, `.append(`, `createDomainEvent({ type: })`, `type:`). */
  emissions: EmissionSite[];
  /** Noms d'événements d'AUTRES modules déclarés dans les constantes d'événements (ex. `ConsumedEvents`). */
  foreign: EmissionSite[];
}

const SKIP_DIRS = new Set(["node_modules", "test", "tests", "__tests__", "migrations", "testing", "dist", "coverage"]);

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSources(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts") && entry.name !== "vitest.config.ts") {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Retire commentaires `//` et blocs, en conservant les numéros de ligne (remplacés par des espaces). */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i]!;
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

function scanModule(mod: DiscoveredModule, nonEvents: Set<string>, allKeys: readonly string[]): { literals: EmissionSite[]; emissions: EmissionSite[]; foreign: EmissionSite[] } {
  const foreign: EmissionSite[] = [];
  const others = allKeys.filter((k) => k !== mod.key).join("|");
  const foreignRe = new RegExp(`(["'\`])((?:${others})\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*)\\1`, "g");
  const literals: EmissionSite[] = [];
  const emissions: EmissionSite[] = [];
  const own = new RegExp(`(["'\`])(${mod.key}\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*)\\1`, "g");
  const anyEvent = `(["'\`])([a-z][a-z0-9]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*)\\2`;
  const emission = [
    new RegExp(`\\.(?:add|append|publish|emit)\\(\\s*${anyEvent}`, "g"),
    new RegExp(`createDomainEvent\\(\\s*\\{[^}]*?\\btype:\\s*${anyEvent}`, "g"),
    new RegExp(`\\btype:\\s*${anyEvent}`, "g"),
  ];
  for (const file of walkSources(mod.dir)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const rel = relative(mod.dir, file).replace(/\\/g, "/");
    // Les chaînes « <module>.<x>.<y> » du code applicatif sont aussi des ACTIONS D'AUDIT (`audit.record`) : seuls les
    // fichiers de constantes d'événements (`events.ts`) comptent comme déclarations ; le reste passe par les points d'émission.
    const isEventsFile = /(^|\/)events\.ts$/.test(rel) || /export const \w*(_EVENTS?|Events?|EVENTS?)\w*\s*(:[^=]+)?=\s*\{/.test(source);
    for (const m of isEventsFile ? source.matchAll(own) : []) {
      literals.push({ module: mod.key, file: rel, line: lineOf(source, m.index ?? 0), name: m[2]!, kind: "literal" });
    }
    for (const m of isEventsFile ? source.matchAll(foreignRe) : []) {
      foreign.push({ module: mod.key, file: rel, line: lineOf(source, m.index ?? 0), name: m[2]!, kind: "literal" });
    }
    const seen = new Set<string>();
    for (const re of emission) {
      for (const m of source.matchAll(re)) {
        const name = m[2]!;
        if (nonEvents.has(name)) continue;
        const key = `${m.index}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        emissions.push({ module: mod.key, file: rel, line: lineOf(source, m.index ?? 0), name, kind: "emission" });
      }
    }
  }
  return { literals, emissions, foreign };
}

async function loadSubscribers(mod: DiscoveredModule): Promise<SubscriberInfo[]> {
  const file = join(mod.dir, "subscribers.ts");
  if (!existsSync(file) || !statSync(file).isFile()) return [];
  const imported = (await import(pathToFileURL(file).href)) as { default?: unknown };
  let value: unknown = imported.default;
  if (value && !Array.isArray(value) && typeof value === "object" && "default" in value) value = (value as { default?: unknown }).default;
  const list = (Array.isArray(value) ? value.flat() : value ? [value] : []) as Array<{ name: string; pattern: string | RegExp }>;
  return list.map((s) => ({ module: mod.key, name: s.name, pattern: s.pattern, matches: compilePattern(s.pattern) }));
}

let cached: Promise<EventsCatalog> | undefined;

export function loadEventsCatalog(): Promise<EventsCatalog> {
  cached ??= buildCatalog();
  return cached;
}

async function buildCatalog(): Promise<EventsCatalog> {
  const modules = await discoverModules();
  const publishes = new Map<string, string[]>();
  const consumes = new Map<string, string[]>();
  const producers = new Map<string, string[]>();
  for (const m of modules) {
    const pub = [...(m.manifest.events?.publishes ?? [])];
    publishes.set(m.key, pub);
    consumes.set(m.key, [...(m.manifest.events?.consumes ?? [])]);
    for (const name of pub) producers.set(name, [...(producers.get(name) ?? []), m.key]);
  }
  const literals: EmissionSite[] = [];
  const emissions: EmissionSite[] = [];
  const foreign: EmissionSite[] = [];
  const subscribers: SubscriberInfo[] = [];
  for (const m of modules) {
    // Les clés de permission et de fonctionnalité ont la même forme `<module>.<x>.<y>` : ce ne sont pas des événements.
    const nonEvents = new Set<string>([
      ...(m.manifest.permissions ?? []).map((p) => p.key),
      ...(m.manifest.features ?? []).map((f) => (typeof f === "string" ? f : (f as { key: string }).key)),
    ]);
    const scanned = scanModule(m, nonEvents, modules.map((x) => x.key));
    foreign.push(...scanned.foreign);
    literals.push(...scanned.literals);
    emissions.push(...scanned.emissions);
    subscribers.push(...(await loadSubscribers(m)));
  }
  return {
    modules,
    keys: modules.map((m) => m.key),
    publishes,
    consumes,
    producers,
    allPublished: [...producers.keys()],
    subscribers,
    literals,
    emissions,
    foreign,
  };
}

/** Vrai si `entry` (nom exact ou motif `a.*` / `a.**`) couvre l'événement `name`. */
export function entryCovers(entry: string, name: string): boolean {
  return compilePattern(entry)(name);
}

export const isPatternEntry = (entry: string): boolean => entry.split(".").some((s) => s === "*" || s === "**");

/** Un événement consommé précis : consommateur, nom exact et producteurs déclarés. */
export interface ConsumedEdge {
  consumer: string;
  /** Entrée du manifeste (nom ou motif). */
  entry: string;
  /** Événements publiés couverts par l'entrée. */
  events: string[];
}

export function consumedEdges(catalog: EventsCatalog): ConsumedEdge[] {
  const edges: ConsumedEdge[] = [];
  for (const [consumer, entries] of catalog.consumes) {
    for (const entry of entries) {
      edges.push({ consumer, entry, events: catalog.allPublished.filter((n) => entryCovers(entry, n)) });
    }
  }
  return edges;
}
