/**
 * Extraction du texte d'un PDF dans un PROCESSUS ISOLÉ (réponse métier Q-14), derrière le port `PdfTextExtractor`.
 *
 * Un PDF téléversé est une entrée hostile : l'analyseur (pdf.js, déjà présent via `pdf-parse`) ne tourne donc JAMAIS dans le
 * processus du worker ni de l'API. Chaque extraction lance un processus Node fils, SANS shell, avec :
 *
 *  - taille : le PDF est refusé AVANT le lancement au-delà de `maxBytes` (20 Mio par défaut) ;
 *  - pages  : au plus `maxPages` pages lues (200) ; au-delà, texte tronqué (`truncated`) ;
 *  - texte  : au plus `maxChars` caractères (500 000) ; sortie du fils bornée ;
 *  - durée  : `timeoutMs` (20 s) puis `SIGKILL` ; mémoire : `--max-old-space-size` (256 Mio) ;
 *  - réseau : AUCUN. Le fils remplace avant tout chargement de l'analyseur `net` (connexion, serveur, `Socket.connect`), `dns`,
 *    `dgram`, `child_process` et `worker_threads` par des fonctions qui refusent ; HTTP, HTTPS, TLS, HTTP/2 et `fetch` passent tous
 *    par `net.Socket.connect` et échouent donc aussi (vérifié par test). On ne neutralise PAS les modules `http` / `fetch` eux-mêmes :
 *    pdf.js 1.10 change de comportement quand ils sont redéfinis. Ceci est une garde de DÉFENSE EN PROFONDEUR dans le fils, pas un
 *    cloisonnement du système : l'isolation réseau réelle reste celle du conteneur du worker (voir README, « Déploiement ») ;
 *  - code   : `--disallow-code-generation-from-strings` (ni `eval` ni `new Function` : ferme la classe d'attaques de pdf.js par
 *    fontes forgées) ;
 *  - disque : modèle de permissions de Node (`--permission`) : lecture limitée au dossier de l'analyseur, AUCUNE écriture,
 *    AUCUN processus enfant, AUCUN worker. Désactivable seulement par `DOCUMENTS_PDF_SANDBOX=none` (version de Node trop ancienne) ;
 *  - environnement : le fils ne reçoit AUCUNE variable de l'application (ni secret, ni URL de base de données) ;
 *  - code source du fils : une chaîne de ce fichier passée à `node -e` (aucun fichier à déployer à côté du bundle).
 *
 * Le PDF entre par l'entrée standard, le résultat sort en JSON sur la sortie standard. Les erreurs sont des codes stables
 * (`corrupt`, `encrypted`, `too_large`, `timeout`, `memory`, `crashed`, `unavailable`) : jamais un extrait du document, jamais
 * une trace du fils dans les journaux (elle pourrait contenir du contenu).
 *
 * Variables d'environnement (toutes facultatives) :
 *   DOCUMENTS_PDF_PARSER_PATH   chemin de `pdf-parse/lib/pdf-parse.js` (indispensable quand le worker est un bundle sans node_modules)
 *   DOCUMENTS_PDF_MAX_BYTES, _MAX_PAGES, _MAX_CHARS, _TIMEOUT_MS, _MAX_MEMORY_MB   limites ci-dessus
 *   DOCUMENTS_PDF_SANDBOX       `permission` (défaut si Node >= 20) | `none`
 */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { NO_TEXT_EXTRACTOR, type PdfExtractFailure, type PdfExtractResult, type PdfTextExtractor } from "../application/ports";

export interface PdfExtractLimits {
  readonly maxBytes: number;
  readonly maxPages: number;
  readonly maxChars: number;
  readonly timeoutMs: number;
  readonly maxMemoryMb: number;
}

export const DEFAULT_PDF_LIMITS: PdfExtractLimits = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxPages: 200,
  maxChars: 500_000,
  timeoutMs: 20_000,
  maxMemoryMb: 256,
});

/** Garde réseau / processus du fils, exportée pour être testée seule. Doit s'exécuter AVANT le chargement de l'analyseur. */
export const CHILD_GUARD_SOURCE = String.raw`
const deny = (what) => function () { throw new Error("denied:" + what); };
const hardened = [];
const lock = (mod, names) => {
  let m;
  try { m = require(mod); } catch (e) { return; }
  for (const n of names) { try { Object.defineProperty(m, n, { value: deny(mod + "." + n), configurable: false, writable: false }); hardened.push(mod + "." + n); } catch (e) { /* propriété non redéfinissable */ } }
};
lock("net", ["connect", "createConnection", "createServer"]);
{ const net = require("net"); net.Socket.prototype.connect = deny("net.Socket.connect"); net.Server.prototype.listen = deny("net.Server.listen"); }
lock("dns", ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "reverse"]);
lock("dgram", ["createSocket"]);
lock("child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
lock("worker_threads", ["Worker"]);
`;

/** Code du fils (CommonJS) : garde, lecture bornée de stdin, extraction page par page, JSON sur stdout. */
export const CHILD_SOURCE = String.raw`
"use strict";
${CHILD_GUARD_SOURCE}
const MAX_BYTES = Number(process.env.ED_PDF_MAX_BYTES);
const MAX_PAGES = Number(process.env.ED_PDF_MAX_PAGES);
const MAX_CHARS = Number(process.env.ED_PDF_MAX_CHARS);
const PARSER = process.env.ED_PDF_PARSER;
const out = process.stdout;
const log = console.log; // pdf.js écrit ses avertissements sur la sortie standard : on la réserve au résultat
console.log = console.info = console.warn = console.debug = function () {};
const done = (obj) => { out.write(JSON.stringify(obj), () => process.exit(0)); };
const fail = (code) => done({ ok: false, code });

const chunks = [];
let size = 0;
process.stdin.on("data", (c) => {
  size += c.length;
  if (size > MAX_BYTES) { fail("too_large"); return; }
  chunks.push(c);
});
process.stdin.on("end", () => { run(Buffer.concat(chunks)).catch(() => fail("corrupt")); });

const clean = (s) => s
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, " ")
  .split(String.fromCharCode(0x2028)).join(" ")
  .split(String.fromCharCode(0x2029)).join(" ")
  .replace(/[ \t]+/g, " ")
  .replace(/ ?\n ?/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

async function run(buffer) {
  const pdf = require(PARSER);
  let budget = MAX_CHARS;
  let capped = false;
  const pagerender = (pageData) => pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
    if (budget <= 0) { capped = true; return ""; }
    let lastY; let text = "";
    for (const item of tc.items) {
      if (lastY === undefined || lastY === item.transform[5]) text += item.str; else text += "\n" + item.str;
      lastY = item.transform[5];
      if (text.length > budget) break;
    }
    if (text.length > budget) { text = text.slice(0, budget); capped = true; }
    budget -= text.length;
    return text;
  });
  let data;
  try {
    data = await pdf(buffer, { max: MAX_PAGES, pagerender });
  } catch (e) {
    const name = e && (e.name || (e.constructor && e.constructor.name)) || "";
    if (/Password/i.test(name)) return fail("encrypted");
    return fail("corrupt");
  }
  let text = clean(data.text || "");
  if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); capped = true; }
  done({ ok: true, text, pagesRead: data.numrender, pageCount: data.numpages, truncated: capped || data.numpages > data.numrender });
}
`;

type SpawnResult = { stdout: Buffer; stderr: string; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; overflow: boolean; spawnError: boolean };

export interface PdfExtractorOptions {
  readonly parserPath: string;
  readonly limits?: Partial<PdfExtractLimits>;
  /** `permission` (défaut) ou `none`. */
  readonly sandbox?: "permission" | "none";
  readonly nodePath?: string;
}

/** Version majeure de Node : le drapeau de permissions s'appelle `--experimental-permission` en 20-21 et `--permission` ensuite. */
export function permissionFlag(nodeVersion: string = process.versions.node): string | null {
  const major = Number(nodeVersion.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) return null;
  return major >= 22 ? "--permission" : "--experimental-permission";
}

/** Dossier `node_modules` le plus externe du chemin réel de l'analyseur ; à défaut, le dossier du paquet (lib/..). */
export function readRootOf(realParserPath: string): string {
  const parts = realParserPath.split(/[\\/]/);
  const i = parts.indexOf("node_modules");
  if (i > 0) return parts.slice(0, i + 1).join(sep);
  return dirname(dirname(realParserPath));
}

export class IsolatedPdfExtractor implements PdfTextExtractor {
  private readonly limits: PdfExtractLimits;
  private readonly readRoots: string[];
  constructor(private readonly options: PdfExtractorOptions) {
    this.limits = { ...DEFAULT_PDF_LIMITS, ...options.limits };
    // Racine à autoriser en lecture SEULE : le dossier `node_modules` (le plus externe) qui contient le paquet de l'analyseur, liens
    // symboliques de pnpm résolus. Avec pnpm, les dépendances de pdf-parse sont des paquets FRÈRES dans le magasin `.pnpm`, et
    // Node lit les `package.json` des dossiers parents pour résoudre un module : le seul dossier du paquet ne suffit pas.
    // Seul du code de dépendances est lisible ; ni le dépôt, ni les fichiers `.env`, ni les documents.
    this.readRoots = [readRootOf(realpathSync(options.parserPath))];
  }

  get effectiveLimits(): PdfExtractLimits {
    return this.limits;
  }

  async extract(bytes: Uint8Array): Promise<PdfExtractResult> {
    const l = this.limits;
    if (bytes.byteLength > l.maxBytes) return { ok: false, code: "too_large", retryable: false };
    const sandbox = this.options.sandbox ?? "permission";
    const flag = sandbox === "permission" ? permissionFlag() : null;
    const args = [
      "--disallow-code-generation-from-strings",
      `--max-old-space-size=${l.maxMemoryMb}`,
      ...(flag ? [flag, ...this.readRoots.map((r) => `--allow-fs-read=${r}`)] : []),
      "-e",
      CHILD_SOURCE,
    ];
    const env: Record<string, string> = {
      ED_PDF_MAX_BYTES: String(l.maxBytes),
      ED_PDF_MAX_PAGES: String(l.maxPages),
      ED_PDF_MAX_CHARS: String(l.maxChars),
      ED_PDF_PARSER: this.options.parserPath,
      ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    };
    const r = await runChild(this.options.nodePath ?? process.execPath, args, env, bytes, l.timeoutMs, l.maxChars * 6 + 4096);
    return interpret(r);
  }
}

function runChild(file: string, args: readonly string[], env: Record<string, string>, input: Uint8Array, timeoutMs: number, maxOut: number): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const res: SpawnResult = { stdout: Buffer.alloc(0), stderr: "", code: null, signal: null, timedOut: false, overflow: false, spawnError: false };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, [...args], { stdio: ["pipe", "pipe", "pipe"], env, shell: false, windowsHide: true });
    } catch {
      res.spawnError = true;
      resolvePromise(res);
      return;
    }
    const out: Buffer[] = [];
    let outSize = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.stdout = Buffer.concat(out);
      resolvePromise(res);
    };
    const timer = setTimeout(() => {
      res.timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => {
      outSize += c.length;
      if (outSize > maxOut) {
        res.overflow = true;
        child.kill("SIGKILL");
        return;
      }
      out.push(c);
    });
    // stderr borné et jamais journalisé tel quel (il peut citer du contenu) : on ne cherche que la marque d'une mémoire épuisée.
    child.stderr?.on("data", (c: Buffer) => {
      if (res.stderr.length < 4096) res.stderr += c.toString("latin1").slice(0, 4096);
    });
    child.on("error", () => {
      res.spawnError = true;
      finish();
    });
    child.on("close", (code, signal) => {
      res.code = code;
      res.signal = signal;
      finish();
    });
    child.stdin?.on("error", () => undefined); // EPIPE si le fils meurt avant d'avoir tout lu
    child.stdin?.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  });
}

function interpret(r: SpawnResult): PdfExtractResult {
  const failure = (code: PdfExtractFailure, retryable: boolean): PdfExtractResult => ({ ok: false, code, retryable });
  if (r.spawnError) return failure("unavailable", true);
  if (r.timedOut) return failure("timeout", true);
  if (r.overflow) return failure("crashed", false);
  if (/heap out of memory|Reached heap limit|allocation failed/i.test(r.stderr)) return failure("memory", false);
  if (/ERR_ACCESS_DENIED|Cannot find module|MODULE_NOT_FOUND/.test(r.stderr) && r.stdout.length === 0) return failure("unavailable", true);
  if (r.stdout.length === 0) return failure("crashed", true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout.toString("utf8"));
  } catch {
    return failure("crashed", true);
  }
  const p = parsed as { ok?: unknown; code?: unknown; text?: unknown; pagesRead?: unknown; pageCount?: unknown; truncated?: unknown };
  if (p.ok === true && typeof p.text === "string" && Number.isInteger(p.pagesRead) && Number.isInteger(p.pageCount)) {
    return { ok: true, text: p.text, pagesRead: p.pagesRead as number, pageCount: p.pageCount as number, truncated: p.truncated === true };
  }
  if (p.code === "encrypted") return failure("encrypted", false);
  if (p.code === "too_large") return failure("too_large", false);
  if (p.code === "corrupt") return failure("corrupt", false);
  return failure("crashed", true);
}

/** Chemin de `pdf-parse/lib/pdf-parse.js` : variable d'environnement, sinon résolution depuis ce fichier, sinon depuis le dossier courant. */
export function resolvePdfParserPath(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const fromEnv = env.DOCUMENTS_PDF_PARSER_PATH?.trim();
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const bases: string[] = [];
  try {
    if (typeof __filename === "string" && __filename) bases.push(__filename);
  } catch {
    /* module ES : pas de __filename */
  }
  bases.push(join(process.cwd(), "__resolve__.cjs"));
  for (const base of bases) {
    try {
      return createRequire(base).resolve("pdf-parse/lib/pdf-parse.js");
    } catch {
      /* essai suivant */
    }
  }
  return null;
}

const numberFrom = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};

/** Extracteur demandé par l'environnement ; sans analyseur installé, le port « indisponible » (la file d'indexation attend). */
export function pdfTextExtractorFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PdfTextExtractor {
  const parserPath = resolvePdfParserPath(env);
  if (!parserPath) return NO_TEXT_EXTRACTOR;
  const sandbox = (env.DOCUMENTS_PDF_SANDBOX ?? "permission").trim().toLowerCase();
  if (sandbox !== "permission" && sandbox !== "none") throw new Error(`DOCUMENTS_PDF_SANDBOX inconnu : « ${sandbox} » (permission, none).`);
  const limits: Partial<PdfExtractLimits> = {};
  const set = (key: keyof PdfExtractLimits, v: number | undefined): void => {
    if (v !== undefined) (limits as Record<string, number>)[key] = v;
  };
  set("maxBytes", numberFrom(env.DOCUMENTS_PDF_MAX_BYTES));
  set("maxPages", numberFrom(env.DOCUMENTS_PDF_MAX_PAGES));
  set("maxChars", numberFrom(env.DOCUMENTS_PDF_MAX_CHARS));
  set("timeoutMs", numberFrom(env.DOCUMENTS_PDF_TIMEOUT_MS));
  set("maxMemoryMb", numberFrom(env.DOCUMENTS_PDF_MAX_MEMORY_MB));
  return new IsolatedPdfExtractor({ parserPath, limits, sandbox });
}
