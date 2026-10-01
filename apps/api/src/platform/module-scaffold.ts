/**
 * Générateur de squelette de module conforme au contrat d'assemblage ACTUEL (utilisé par `pnpm module:new <key>`).
 *
 * Crée, sous `apps/api/src/modules/<key>/` : manifest, index (API publique), migration initiale dans la plage de
 * numéros réservée au module, domain / application / infrastructure / http (plugin `(app, runtime)`),
 * `subscribers.ts` et `jobs.ts` (exemples commentés), tests unitaires + intégration, README ; et, à la racine de
 * `modules/`, `isolation-allowlist.<key>.ts` (vide, justifié). Ajoute la ligne de plage au tableau de
 * `docs/architecture/module-conventions.md`.
 *
 * Le squelette est un EXEMPLE minimal (entité `item`) à remplacer ; il passe tel quel `pnpm check:boundaries`,
 * `tsc`, ses tests, `pnpm test:isolation`, et se charge par le registre. Le contenu des fichiers vit dans
 * `module-scaffold-templates.ts`. Il n'existe volontairement AUCUN `modules/_template` actif.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_MODULES_DIR } from "../modules/registry-discovery";
import {
  DEFAULT_RANGE_START,
  RANGE_WIDTH,
  renderModuleFiles,
  renderModulesRootFiles,
  type RenderOptions,
} from "./module-scaffold-templates";

export { DEFAULT_RANGE_START, RANGE_WIDTH, renderModuleFiles, renderModulesRootFiles };
export type { RenderOptions };

export const MODULE_KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
const RESERVED_KEYS = new Set(["kernel", "public", "information_schema", "test", "registry", "platform", "node_modules"]);

/** `docs/architecture/module-conventions.md` (tableau des plages de migrations). */
export const DEFAULT_CONVENTIONS_PATH = resolve(DEFAULT_MODULES_DIR, "..", "..", "..", "..", "docs", "architecture", "module-conventions.md");

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

export function validateModuleKey(key: string): void {
  if (!MODULE_KEY_RE.test(key)) {
    throw new ScaffoldError(
      `Clé de module invalide : "${key}". Attendu : minuscules, chiffres et "_", 2 à 30 caractères, commençant par une lettre ` +
        "(c'est aussi le nom du schéma Postgres).",
    );
  }
  if (RESERVED_KEYS.has(key) || key.startsWith("pg_")) {
    throw new ScaffoldError(`Clé de module réservée : "${key}".`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Plages de numéros de migrations (tableau de module-conventions.md)
// ---------------------------------------------------------------------------------------------------------------

export interface RangeRow {
  start: number;
  /** `null` pour la ligne ouverte « 1600+ ». */
  end: number | null;
  owner: string;
  /** Index de la ligne dans le fichier. */
  line: number;
}

const RANGE_ROW_RE = /^\|\s*(\d{4})(?:-(\d{4})|\+)\s*\|(.*)\|\s*$/;

/** Lit les lignes de plage du tableau (en-tête et séparateur ignorés). */
export function parseRangeTable(markdown: string): RangeRow[] {
  const rows: RangeRow[] = [];
  markdown.split(/\r?\n/).forEach((text, line) => {
    const m = RANGE_ROW_RE.exec(text.trimEnd());
    if (!m) return;
    rows.push({ start: Number(m[1]), end: m[2] === undefined ? null : Number(m[2]), owner: (m[3] ?? "").trim(), line });
  });
  return rows;
}

/** Plus grand numéro de migration déjà présent sur disque, hors du module `except` (0 si aucun). */
export function highestMigrationOnDisk(modulesDir: string, except?: string): number {
  let highest = 0;
  if (!existsSync(modulesDir)) return highest;
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === except) continue;
    const dir = join(modulesDir, entry.name, "migrations");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      const m = /^(\d{4,})_/.exec(file);
      if (m) highest = Math.max(highest, Number(m[1]));
    }
  }
  return highest;
}

function migrationVersionsOnDisk(modulesDir: string): number[] {
  const versions: number[] = [];
  if (!existsSync(modulesDir)) return versions;
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(modulesDir, entry.name, "migrations");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      const m = /^(\d{4,})_/.exec(file);
      if (m) versions.push(Number(m[1]));
    }
  }
  return versions;
}

const roundUpToRange = (n: number): number => Math.ceil(n / RANGE_WIDTH) * RANGE_WIDTH;
const pad4 = (n: number): string => String(n).padStart(4, "0");

/**
 * Prochaine plage libre : celle de la ligne ouverte « NNNN+ » du tableau (si présent), sans jamais passer sous un
 * numéro déjà utilisé sur disque ; sans tableau, le défaut 1600.
 */
export function nextFreeRangeStart(rows: readonly RangeRow[], modulesDir?: string): number {
  const open = rows.find((r) => r.end === null);
  const boundedEnd = Math.max(0, ...rows.filter((r) => r.end !== null).map((r) => r.end as number));
  const fromTable = open ? open.start : roundUpToRange(boundedEnd + 1);
  const fromDisk = modulesDir ? roundUpToRange(highestMigrationOnDisk(modulesDir) + 1) : 0;
  return Math.max(fromTable, fromDisk, rows.length === 0 ? DEFAULT_RANGE_START : 0);
}

/** Vérifie qu'une plage demandée est alignée, libre dans le tableau et sur disque. */
export function assertRangeAvailable(start: number, rows: readonly RangeRow[], modulesDir: string | undefined): void {
  if (!Number.isInteger(start) || start < DEFAULT_RANGE_START || start % RANGE_WIDTH !== 0) {
    throw new ScaffoldError(
      `Plage invalide : ${start}. Attendu : multiple de ${RANGE_WIDTH}, au moins ${DEFAULT_RANGE_START} (ex. --range ${DEFAULT_RANGE_START}). ` +
        "Les plages inférieures sont réservées aux modules de la fondation.",
    );
  }
  const end = start + RANGE_WIDTH - 1;
  for (const row of rows) {
    const rowEnd = row.end ?? Number.POSITIVE_INFINITY;
    if (row.end === null) {
      if (start < row.start) {
        throw new ScaffoldError(`Plage ${pad4(start)}-${pad4(end)} : la ligne ouverte du tableau commence à ${pad4(row.start)}.`);
      }
      continue;
    }
    if (start <= rowEnd && end >= row.start) {
      throw new ScaffoldError(
        `Plage ${pad4(start)}-${pad4(end)} déjà attribuée à ${row.owner} (${pad4(row.start)}-${pad4(row.end)}). ` +
          `Prochaine plage libre : ${pad4(nextFreeRangeStart(rows, modulesDir))}.`,
      );
    }
  }
  if (modulesDir) {
    const clash = migrationVersionsOnDisk(modulesDir).find((v) => v >= start && v <= end);
    if (clash !== undefined) {
      throw new ScaffoldError(
        `Plage ${pad4(start)}-${pad4(end)} : une migration ${pad4(clash)} existe déjà dans un autre module (les versions sont globales).`,
      );
    }
  }
}

/**
 * Insère la ligne `| NNNN-MMMM | ¤key¤ |` avant la ligne ouverte et décale celle-ci. Conserve les fins de ligne du
 * fichier. Lève si le tableau est introuvable ou si la clé y figure déjà.
 */
export function addRangeRow(markdown: string, key: string, start: number): string {
  const rows = parseRangeTable(markdown);
  const open = rows.find((r) => r.end === null);
  if (!open) {
    throw new ScaffoldError(
      "Tableau des plages introuvable dans module-conventions.md (ligne « 1600+ | modules suivants… » attendue) : ajoutez la ligne à la main.",
    );
  }
  if (rows.some((r) => new RegExp(`\`${key}\``).test(r.owner))) {
    throw new ScaffoldError(`Le module "${key}" figure déjà dans le tableau des plages de module-conventions.md.`);
  }
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const end = start + RANGE_WIDTH - 1;
  const newRow = `| ${pad4(start)}-${pad4(end)} | \`${key}\` |`;
  const openText = lines[open.line] ?? "";
  const shifted = openText.replace(/^\|\s*\d{4}\+/, `| ${pad4(end + 1)}+`);
  lines.splice(open.line, 1, newRow, shifted);
  return lines.join(eol);
}

// ---------------------------------------------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------------------------------------------

export interface ScaffoldOptions {
  key: string;
  /**
   * Dossier des modules. Défaut : `apps/api/src/modules`. Si fourni (tests, arbre temporaire), le tableau de
   * `module-conventions.md` N'EST PAS modifié sauf si `conventionsPath` est aussi fourni.
   */
  modulesDir?: string;
  /** Premier numéro de la plage de migrations (ex. 1600). Défaut : prochaine plage libre. */
  range?: number;
  /** Fichier de conventions à mettre à jour ; `null` = ne pas y toucher. */
  conventionsPath?: string | null;
}

export interface ScaffoldResult {
  dir: string;
  /** Fichiers du dossier du module (relatifs à `dir`), triés. */
  files: string[];
  /** Fichiers créés à la racine de modules/ (relatifs à `modulesDir`). */
  rootFiles: string[];
  range: { start: number; end: number };
  /** Chemin du fichier de conventions mis à jour, ou `null`. */
  conventionsUpdated: string | null;
  warnings: string[];
}

/** Écrit le squelette ; refuse d'écraser un module existant. Aucune écriture n'a lieu si une validation échoue. */
export function scaffoldModule(options: ScaffoldOptions): ScaffoldResult {
  validateModuleKey(options.key);
  const modulesDir = resolve(options.modulesDir ?? DEFAULT_MODULES_DIR);
  const dir = join(modulesDir, options.key);
  if (existsSync(dir)) {
    throw new ScaffoldError(`Le module "${options.key}" existe déjà (${dir}) : rien n'a été écrit.`);
  }
  for (const name of Object.keys(renderModulesRootFiles(options.key))) {
    if (existsSync(join(modulesDir, name))) {
      throw new ScaffoldError(`${name} existe déjà dans ${modulesDir} : rien n'a été écrit.`);
    }
  }

  const conventionsPath = options.conventionsPath === undefined ? (options.modulesDir ? null : DEFAULT_CONVENTIONS_PATH) : options.conventionsPath;
  let conventions: string | null = null;
  let rows: RangeRow[] = [];
  if (conventionsPath) {
    if (!existsSync(conventionsPath)) throw new ScaffoldError(`Fichier de conventions introuvable : ${conventionsPath}.`);
    conventions = readFileSync(conventionsPath, "utf8");
    rows = parseRangeTable(conventions);
  }

  const warnings: string[] = [];
  const defaultStart = nextFreeRangeStart(rows, modulesDir);
  const start = options.range ?? defaultStart;
  assertRangeAvailable(start, rows, modulesDir);
  if (options.range !== undefined && start > defaultStart) {
    warnings.push(
      `La plage demandée (${pad4(start)}) saute ${pad4(defaultStart)}-${pad4(start - 1)} : ces numéros ne seront plus attribués. ` +
        "Les plages s'attribuent dans l'ordre de création.",
    );
  }
  const updatedConventions = conventions === null ? null : addRangeRow(conventions, options.key, start);

  const files = renderModuleFiles(options.key, { rangeStart: start });
  const rootFiles = renderModulesRootFiles(options.key);
  const written: string[] = [];
  try {
    for (const [relative, content] of Object.entries(files)) {
      const target = join(dir, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
      written.push(target);
    }
    for (const [relative, content] of Object.entries(rootFiles)) {
      const target = join(modulesDir, relative);
      writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
      written.push(target);
    }
    if (conventionsPath && updatedConventions !== null) writeFileSync(conventionsPath, updatedConventions, "utf8");
  } catch (e) {
    // Écriture interrompue : on ne laisse pas un module à moitié généré (le registre refuserait de démarrer).
    rmSync(dir, { recursive: true, force: true });
    for (const target of written) rmSync(target, { force: true });
    throw e;
  }

  return {
    dir,
    files: Object.keys(files).sort(),
    rootFiles: Object.keys(rootFiles).sort(),
    range: { start, end: start + RANGE_WIDTH - 1 },
    conventionsUpdated: conventionsPath && updatedConventions !== null ? conventionsPath : null,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------------------------------------------

export const MODULE_NEW_USAGE =
  "Usage : pnpm module:new <cle> [--range 1600]   (clé : minuscules, chiffres et _ ; --range : première migration de la plage, défaut = prochaine plage libre)";

export interface ModuleNewArgs {
  key: string;
  range?: number;
}

/** Analyse les arguments de `pnpm module:new` ; lève `ScaffoldError` (message d'usage) si invalides. */
export function parseModuleNewArgs(argv: readonly string[]): ModuleNewArgs {
  const args = argv.filter((a) => a !== "--");
  let key: string | undefined;
  let range: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    let raw: string | undefined;
    if (arg === "--range") {
      raw = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--range=")) {
      raw = arg.slice("--range=".length);
    } else if (arg.startsWith("-")) {
      throw new ScaffoldError(`Option inconnue : ${arg}.\n${MODULE_NEW_USAGE}`);
    } else if (key === undefined) {
      key = arg;
      continue;
    } else {
      throw new ScaffoldError(`Argument en trop : ${arg}.\n${MODULE_NEW_USAGE}`);
    }
    if (raw === undefined || !/^\d{4,}$/.test(raw)) {
      throw new ScaffoldError(`--range attend un numéro de migration (ex. 1600), reçu : ${raw ?? "(rien)"}.\n${MODULE_NEW_USAGE}`);
    }
    range = Number(raw);
  }
  if (key === undefined) throw new ScaffoldError(MODULE_NEW_USAGE);
  return { key, ...(range !== undefined ? { range } : {}) };
}
