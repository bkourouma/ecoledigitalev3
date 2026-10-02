/**
 * Convertisseur Office -> PDF (prévisualisation), derrière le port `DocumentConverter`. DÉSACTIVÉ par défaut.
 *
 *   DOCUMENTS_OFFICE_CONVERTER   `off` (défaut) | `libreoffice`
 *   DOCUMENTS_SOFFICE_PATH       exécutable LibreOffice (défaut `soffice`)
 *   DOCUMENTS_OFFICE_TIMEOUT_MS  délai d'une conversion (défaut 60 000)
 *
 * SÉCURITÉ : ouvrir un document non fiable dans un moteur bureautique est risqué. À n'activer que dans un conteneur isolé, sans
 * réseau, sans secret, utilisateur non privilégié. Garde-fous du code : processus fils SANS shell, environnement minimal (aucune
 * variable d'application héritée), profil et dossier de travail jetables supprimés ensuite, délai impérieux (processus tué),
 * extension validée, sortie bornée. Les macros sont de toute façon refusées au dépôt (`macro_content`).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CONVERTER, type DocumentConverter } from "../application/ports";

const ALLOWED = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"]);

export interface ExecResult {
  code: number | null;
}

export type ExecFn = (file: string, args: readonly string[], options: { cwd: string; timeoutMs: number; env: Record<string, string> }) => Promise<ExecResult>;

const defaultExec: ExecFn = (file, args, options) =>
  new Promise<ExecResult>((resolve) => {
    execFile(file, [...args], { cwd: options.cwd, timeout: options.timeoutMs, env: options.env, windowsHide: true, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" }, (error) => {
      resolve({ code: error ? 1 : 0 });
    });
  });

export interface OfficeConverterOptions {
  sofficePath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Injectable pour les tests. */
  exec?: ExecFn;
  tmpRoot?: string;
}

export class OfficeConverter implements DocumentConverter {
  readonly enabled = true;
  constructor(private readonly options: OfficeConverterOptions = {}) {}

  async toPdf(bytes: Uint8Array, hints: { extension: string; mime: string }): Promise<Uint8Array | null> {
    const ext = hints.extension.toLowerCase();
    if (!ALLOWED.has(ext)) return null;
    const dir = await mkdtemp(join(this.options.tmpRoot ?? tmpdir(), "ed-office-"));
    try {
      const input = join(dir, `in.${ext}`);
      await writeFile(input, bytes);
      const profile = join(dir, "profile").replace(/\\/g, "/");
      const exec = this.options.exec ?? defaultExec;
      const result = await exec(
        this.options.sofficePath ?? "soffice",
        ["--headless", "--norestore", "--nolockcheck", "--nofirststartwizard", `-env:UserInstallation=file:///${profile.replace(/^\//, "")}`, "--convert-to", "pdf", "--outdir", dir, input],
        { cwd: dir, timeoutMs: this.options.timeoutMs ?? 60_000, env: { HOME: dir, TMPDIR: dir, TEMP: dir, TMP: dir, ...(process.env.PATH ? { PATH: process.env.PATH } : {}), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } },
      );
      if (result.code !== 0) return null;
      const pdf = await readFile(join(dir, "in.pdf")).catch(() => null);
      if (!pdf || pdf.length === 0 || pdf.length > (this.options.maxOutputBytes ?? 100 * 1024 * 1024)) return null;
      if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
      return new Uint8Array(pdf);
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Convertisseur demandé par l'environnement ; sinon le convertisseur désactivé. */
export function officeConverterFromEnv(env: Readonly<Record<string, string | undefined>>): DocumentConverter {
  const mode = (env.DOCUMENTS_OFFICE_CONVERTER ?? "off").trim().toLowerCase();
  if (mode === "" || mode === "off") return NO_CONVERTER;
  if (mode !== "libreoffice") throw new Error(`DOCUMENTS_OFFICE_CONVERTER inconnu : « ${mode} » (off, libreoffice).`);
  const timeout = Number(env.DOCUMENTS_OFFICE_TIMEOUT_MS);
  return new OfficeConverter({ sofficePath: env.DOCUMENTS_SOFFICE_PATH?.trim() || "soffice", ...(timeout > 0 ? { timeoutMs: timeout } : {}) });
}
