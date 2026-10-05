/**
 * Convertisseur ISOLÉ des classeurs .xls / .ods (O-11, INV-S1 à S8 étendus).
 *
 * La bibliothèque de lecture (`xlsx` 0.18.5, sans correctif publié pour ses avis connus : pollution de prototype,
 * ReDoS) n'est JAMAIS chargée dans le processus de l'API ni du worker : elle tourne dans un PROCESSUS ENFANT jetable
 * (`child_process.spawn` de `process.execPath`) qui :
 *  - n'hérite d'AUCUNE variable d'environnement (secrets, URL de base, jetons : rien) ;
 *  - reçoit le fichier sur son entrée standard et répond sur sa sortie standard (pas de fichier temporaire) ;
 *  - tourne sous le modèle de permissions de Node quand il existe (`--permission` : aucune écriture disque, lecture
 *    limitée au dossier des dépendances, ni processus, ni thread, ni addon natif) ;
 *  - n'a aucun module réseau chargeable (voir `child-source.ts`) ;
 *  - est borné en tas (`--max-old-space-size`), en durée (tué par SIGKILL au délai), en volume de sortie ;
 *  - lit une seule feuille, plafonnée en lignes, sans évaluer de formule ni suivre de lien.
 * Le résultat est une table normalisée (texte, comme les lecteurs .xlsx / .csv) ; le parent la revalide avant usage.
 *
 * Garantie réseau : au niveau OS, aucun processus Node ne peut être coupé du réseau sans conteneur ou espace de noms
 * réseau dédié ; ici l'enfant n'importe aucun module réseau (refus au chargement) et ne contient aucun code qui en
 * utilise. Pour une garantie dure en production, exécuter l'API dans un conteneur sans accès sortant superflu.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRejectedError, conversionUnavailable } from "../../../domain/errors";
import { DEFAULT_LEGACY_LIMITS, type FileLimits, type LegacyLimits } from "../types";
import { LEGACY_CHILD_SOURCE } from "./child-source";

export type LegacyKind = "XLS" | "ODS";

export interface ConvertedTable {
  readonly sheetNames: readonly string[];
  readonly sheetName: string;
  /** Lignes non vides (numéro de ligne du tableur, cellules en texte, creuses comblées par ""). */
  readonly rows: ReadonlyArray<readonly [number, string[]]>;
  /** Cellules à formule (valeur enregistrée lue, jamais recalculée), liens ignorés, cellules en erreur. */
  readonly formulas: number;
  readonly links: number;
  readonly errors: number;
}

/** Marge de lignes lues au-delà de `maxRows` (lignes vides avant l'en-tête, détection de dépassement). */
const HEADER_SLACK = 50;

export function legacyLimitsOf(limits: FileLimits): LegacyLimits {
  return { ...DEFAULT_LEGACY_LIMITS, ...(limits.legacy ?? {}) };
}

// --------------------------------------------------------------------------------------------------------------------
// Localisation de la bibliothèque et des drapeaux de l'enfant
// --------------------------------------------------------------------------------------------------------------------

interface XlsxLocation {
  readonly entry: string;
  /** Dossier `node_modules` le plus externe : seul endroit que l'enfant peut LIRE (pnpm : liens vers `.pnpm`). */
  readonly readRoot: string;
}

let located: XlsxLocation | undefined;

function locateXlsx(): XlsxLocation {
  if (located) return located;
  const anchors = [path.join(process.cwd(), "__imports_converter__.cjs"), path.join(__dirname, "__imports_converter__.cjs")];
  let entry: string | undefined;
  for (const anchor of anchors) {
    try {
      entry = createRequire(anchor).resolve("xlsx");
      break;
    } catch {
      /* ancre suivante */
    }
  }
  if (!entry) throw conversionUnavailable("La bibliothèque de conversion des classeurs .xls / .ods est introuvable.");
  const real = realpathSync(entry);
  const segments = real.split(path.sep);
  const first = segments.indexOf("node_modules");
  const readRoot = first < 0 ? path.dirname(real) : segments.slice(0, first + 1).join(path.sep);
  located = { entry: real, readRoot };
  return located;
}

/** Drapeaux du modèle de permissions de Node (Node 20 : expérimental ; 22.13 / 23.5+ : stable), sinon aucun. */
function permissionFlags(readRoot: string): string[] {
  const known = process.allowedNodeEnvironmentFlags;
  if (known.has("--permission")) return ["--permission", `--allow-fs-read=${readRoot}`];
  if (known.has("--experimental-permission")) return ["--experimental-permission", `--allow-fs-read=${readRoot}`];
  return [];
}

/** Environnement de l'enfant : VIDE (sur Windows, la seule racine système, sans secret, que le runtime exige). */
function childEnv(): NodeJS.ProcessEnv {
  return process.platform === "win32" && process.env["SystemRoot"] ? { SystemRoot: process.env["SystemRoot"] } : {};
}

// --------------------------------------------------------------------------------------------------------------------
// Exécution bornée
// --------------------------------------------------------------------------------------------------------------------

type Reply = Record<string, unknown> & { ok: boolean };

/** Conversions simultanées plafonnées (les autres attendent leur tour) : un envoi massif ne sature pas le serveur. */
class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  async run<T>(max: number, fn: () => Promise<T>): Promise<T> {
    if (this.active >= max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
const gate = new Gate();

async function runChild(header: Record<string, unknown>, payload: Uint8Array, limits: LegacyLimits): Promise<Reply> {
  const { entry, readRoot } = locateXlsx();
  const args = [...permissionFlags(readRoot), `--max-old-space-size=${limits.maxHeapMb}`, "--disable-proto=delete", "--no-warnings", "--eval", LEGACY_CHILD_SOURCE];
  const input = Buffer.concat([Buffer.from(`${JSON.stringify({ ...header, xlsxPath: entry })}\n`, "utf8"), Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)]);

  return gate.run(limits.maxConcurrent, () =>
    new Promise<Reply>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(process.execPath, args, { env: childEnv(), cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false });
      } catch {
        reject(conversionUnavailable("Le convertisseur de classeurs n'a pas pu démarrer."));
        return;
      }
      const out: Buffer[] = [];
      let outBytes = 0;
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const kill = (): void => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* déjà terminé */
        }
      };
      const timer = setTimeout(() => {
        kill();
        finish(() => reject(new FileRejectedError("imports.file_unsafe", "La conversion du classeur a pris trop de temps : fichier refusé.", { reason: "timeout", timeoutMs: limits.timeoutMs })));
      }, limits.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        outBytes += chunk.length;
        if (outBytes > limits.maxOutputBytes) {
          kill();
          finish(() => reject(new FileRejectedError("imports.file_unsafe", "Le contenu converti du classeur est trop volumineux : fichier refusé.", { reason: "output" })));
          return;
        }
        out.push(chunk);
      });
      child.on("error", () => finish(() => reject(conversionUnavailable("Le convertisseur de classeurs n'a pas pu démarrer."))));
      child.on("close", (code, signal) =>
        finish(() => {
          const text = Buffer.concat(out).toString("utf8");
          let reply: Reply | undefined;
          try {
            reply = text === "" ? undefined : (JSON.parse(text) as Reply);
          } catch {
            reply = undefined;
          }
          if (reply && typeof reply.ok === "boolean") {
            resolve(reply);
            return;
          }
          // Pas de réponse : mémoire dépassée, plantage ou arrêt par signal -> fichier refusé (jamais d'erreur interne).
          reject(new FileRejectedError("imports.file_unsafe", "Le classeur n'a pas pu être converti (mémoire ou ressources dépassées) : fichier refusé.", { reason: "crash", code, signal }));
        }),
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }),
  );
}

const REPLY_CODES: Readonly<Record<string, "imports.file_corrupt" | "imports.file_unsafe" | "imports.too_many_rows" | "imports.sheet_unknown">> = {
  corrupt: "imports.file_corrupt",
  encrypted: "imports.file_corrupt",
  unsafe: "imports.file_unsafe",
  too_many_rows: "imports.too_many_rows",
  sheet_unknown: "imports.sheet_unknown",
};

/** Convertit un classeur .xls / .ods en table normalisée, dans le processus enfant isolé. */
export async function convertLegacyWorkbook(bytes: Uint8Array, kind: LegacyKind, limits: FileLimits, sheet?: string): Promise<ConvertedTable> {
  const legacy = legacyLimitsOf(limits);
  const reply = await runChild(
    {
      mode: "convert",
      kind,
      sheet: sheet ?? null,
      limits: { maxRows: limits.maxRows, maxColumns: limits.maxColumns, maxCellChars: limits.maxCellChars, maxSheets: legacy.maxSheets, headerSlack: HEADER_SLACK, maxOutputChars: Math.floor(legacy.maxOutputBytes / 4) },
    },
    bytes,
    legacy,
  );
  if (!reply.ok) {
    const code = REPLY_CODES[String(reply["code"])] ?? "imports.file_corrupt";
    const message = typeof reply["message"] === "string" ? reply["message"] : "Classeur illisible.";
    throw new FileRejectedError(code, message, code === "imports.too_many_rows" ? { maxRows: limits.maxRows } : undefined);
  }
  return validateReply(reply, limits);
}

/** Le parent ne fait pas confiance à l'enfant : forme et plafonds de la réponse revérifiés. */
function validateReply(reply: Reply, limits: FileLimits): ConvertedTable {
  const bad = (): FileRejectedError => new FileRejectedError("imports.file_corrupt", "Réponse du convertisseur invalide : fichier refusé.");
  const { sheetNames, sheetName, rows, formulas, links, errors } = reply as Record<string, unknown>;
  if (!Array.isArray(sheetNames) || typeof sheetName !== "string" || !Array.isArray(rows)) throw bad();
  if (rows.length > limits.maxRows + HEADER_SLACK + 1) throw new FileRejectedError("imports.too_many_rows", `Le fichier dépasse ${limits.maxRows} lignes de données.`, { maxRows: limits.maxRows });
  const checked: Array<readonly [number, string[]]> = [];
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || !Array.isArray(row[1])) throw bad();
    const cells = row[1] as unknown[];
    if (cells.length > limits.maxColumns + 1 || !cells.every((c) => typeof c === "string")) throw bad();
    checked.push([row[0], cells as string[]]);
  }
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return { sheetNames: sheetNames.map(String), sheetName, rows: checked, formulas: num(formulas), links: num(links), errors: num(errors) };
}

// --------------------------------------------------------------------------------------------------------------------
// Auto-diagnostic (tests et exploitation) : que PEUT faire l'enfant ?
// --------------------------------------------------------------------------------------------------------------------

export interface SandboxReport {
  readonly envKeys: readonly string[];
  /** Modules refusés au chargement dans l'enfant (`true` = refusé). */
  readonly blockedModules: Readonly<Record<string, boolean>>;
  readonly canWriteFile: boolean;
  readonly canReadOutsideDependencies: boolean;
  readonly permissionModel: boolean;
}

export async function probeConverterSandbox(options: { limits?: Partial<LegacyLimits>; readProbePath?: string } = {}): Promise<SandboxReport> {
  const limits = { ...DEFAULT_LEGACY_LIMITS, ...(options.limits ?? {}) };
  const modules = ["net", "tls", "dns", "dgram", "http", "https", "child_process", "worker_threads", "vm"];
  const reply = await runChild(
    { mode: "selftest", probeModules: modules, probeWritePath: path.join(tmpdir(), `imports-converter-probe-${process.pid}.tmp`), probeReadPath: options.readProbePath ?? __filename },
    new Uint8Array(0),
    limits,
  );
  const fs = (reply["fs"] ?? {}) as Record<string, boolean>;
  return {
    envKeys: (reply["envKeys"] as string[]) ?? [],
    blockedModules: (reply["blocked"] as Record<string, boolean>) ?? {},
    canWriteFile: fs["write"] === true,
    canReadOutsideDependencies: fs["readOutside"] === true,
    permissionModel: reply["permissionModel"] === true,
  };
}
