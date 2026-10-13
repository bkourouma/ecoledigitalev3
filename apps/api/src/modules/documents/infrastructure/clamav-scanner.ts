/**
 * Adaptateur ClamAV du port `MalwareScanner`, configurable par l'environnement (aucun secret, aucun binaire embarqué) :
 *
 *   DOCUMENTS_SCANNER              `none` (défaut) | `clamav-tcp` | `clamav-socket` | `clamav-http` | `dev-eicar` (développement local)
 *   DOCUMENTS_CLAMAV_HOST / _PORT  clamd en TCP (défaut port 3310)
 *   DOCUMENTS_CLAMAV_SOCKET        clamd en socket Unix (chemin)
 *   DOCUMENTS_CLAMAV_URL           passerelle HTTP de type « clamav-rest » : `POST <url>` multipart (champ `file`), réponse JSON
 *                                  `{ "Status": "OK" | "FOUND", "Description": "<signature>" }`
 *   DOCUMENTS_CLAMAV_TIMEOUT_MS    délai total d'une analyse (défaut 30 000)
 *   DOCUMENTS_SCAN_FAIL_CLOSED     `true` / `false` ; défaut : vrai si NODE_ENV=production
 *
 * Protocole clamd `INSTREAM` : `zINSTREAM\0`, puis des blocs `[longueur sur 4 octets, gros-boutiste][données]`, terminés par une
 * longueur nulle ; la réponse est une ligne (`stream: OK`, `stream: <signature> FOUND`, `… ERROR`). Le serveur clamd doit
 * accepter la taille maximale d'un fichier (`StreamMaxLength` ≥ plafond de plateforme, 50 Mio par défaut), sinon la réponse est
 * `ERROR` et — en mode fail-closed — le dépôt est refusé.
 *
 * `scan` ne lève JAMAIS : toute panne (connexion, délai, réponse illisible) est un verdict `ERROR` ; la politique
 * (`ScanPolicy.failClosed`) décide alors de refuser ou de stocker `UNSCANNED`.
 */
import { connect, type Socket } from "node:net";
import type { MalwareScanner, ScanPolicy, ScanVerdict } from "../application/ports";
import { NO_SCANNER } from "../application/ports";

export type ClamavTransport =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "socket"; path: string }
  | { kind: "http"; url: string };

export interface ClamavOptions {
  transport: ClamavTransport;
  timeoutMs?: number;
  /** Taille d'un bloc INSTREAM (défaut 64 Kio). */
  chunkSize?: number;
  /** Injectable pour les tests (défaut : `fetch` global). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Interprète la réponse d'une ligne de clamd. */
export function parseClamdResponse(raw: string): ScanVerdict {
  const line = raw.replace(/\0/g, "").trim();
  if (/\bERROR$/.test(line)) return { status: "ERROR", reason: line.slice(0, 200) };
  const found = /^(?:stream:\s*)?(.+?)\s+FOUND$/.exec(line);
  if (found) return { status: "INFECTED", signature: (found[1] ?? "malware").slice(0, 200) };
  if (/\bOK$/.test(line)) return { status: "CLEAN" };
  return { status: "ERROR", reason: `réponse inattendue : ${line.slice(0, 100)}` };
}

/** Chaîne d'essai antivirus EICAR (inoffensive, reconnue par tous les antivirus) : https://www.eicar.org/download-anti-malware-testfile/ */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Analyseur de DÉVELOPPEMENT (`DOCUMENTS_SCANNER=dev-eicar`) : aucun serveur à installer. Un fichier qui contient la chaîne d'essai
 * EICAR est « infecté » (donc mis en quarantaine), tout autre fichier est « sain ». Il ne détecte AUCUN vrai programme malveillant :
 * refusé en production par `scanPolicyFromEnv`. Sert à voir l'écran « Quarantaine des documents » se remplir sans ClamAV (L-83).
 */
export class DevEicarScanner implements MalwareScanner {
  readonly engine = "dev-eicar";
  async scan(bytes: Uint8Array): Promise<ScanVerdict> {
    return Buffer.from(bytes).includes(EICAR) ? { status: "INFECTED", signature: "Eicar-Test-Signature" } : { status: "CLEAN" };
  }
}

export class ClamavScanner implements MalwareScanner {
  readonly engine: string;
  private readonly timeoutMs: number;
  private readonly chunkSize: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClamavOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.chunkSize = options.chunkSize ?? 64 * 1024;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.engine = `clamav-${options.transport.kind}`;
  }

  async scan(bytes: Uint8Array, hints: { fileName: string; mime: string }): Promise<ScanVerdict> {
    try {
      return this.options.transport.kind === "http" ? await this.scanHttp(this.options.transport.url, bytes, hints) : await this.scanStream(bytes);
    } catch (e) {
      return { status: "ERROR", reason: e instanceof Error ? e.message.slice(0, 200) : "échec de l'analyse" };
    }
  }

  private scanStream(bytes: Uint8Array): Promise<ScanVerdict> {
    const t = this.options.transport;
    return new Promise<ScanVerdict>((resolve) => {
      let settled = false;
      let socket: Socket | undefined;
      const done = (v: ScanVerdict): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket?.destroy();
        resolve(v);
      };
      const timer = setTimeout(() => done({ status: "ERROR", reason: "délai d'analyse dépassé" }), this.timeoutMs);
      const chunks: Buffer[] = [];
      let sock: Socket;
      try {
        sock = t.kind === "socket" ? connect({ path: t.path }) : connect({ host: (t as { host: string }).host, port: (t as { port: number }).port });
      } catch (e) {
        done({ status: "ERROR", reason: e instanceof Error ? e.message : "connexion impossible" });
        return;
      }
      socket = sock;
      socket.on("error", (e) => done({ status: "ERROR", reason: `connexion à l'antivirus impossible : ${e.message}`.slice(0, 200) }));
      socket.on("data", (d: Buffer) => chunks.push(d));
      socket.on("end", () => done(parseClamdResponse(Buffer.concat(chunks).toString("utf8"))));
      socket.on("close", () => done(parseClamdResponse(Buffer.concat(chunks).toString("utf8"))));
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += this.chunkSize) {
          const part = bytes.subarray(offset, Math.min(offset + this.chunkSize, bytes.length));
          const header = Buffer.alloc(4);
          header.writeUInt32BE(part.length, 0);
          socket.write(header);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // longueur nulle : fin du flux
      });
    });
  }

  private async scanHttp(url: string, bytes: Uint8Array, hints: { fileName: string; mime: string }): Promise<ScanVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), "upload.bin");
      const res = await this.fetchImpl(url, { method: "POST", body: form, signal: controller.signal });
      if (!res.ok) return { status: "ERROR", reason: `passerelle antivirus : HTTP ${res.status}` };
      const body = (await res.json()) as { Status?: unknown; status?: unknown; Description?: unknown; description?: unknown };
      const status = String(body.Status ?? body.status ?? "").toUpperCase();
      const description = String(body.Description ?? body.description ?? "malware");
      if (status === "OK") return { status: "CLEAN" };
      if (status === "FOUND") return { status: "INFECTED", signature: description.replace(/\s*FOUND$/i, "").slice(0, 200) || "malware" };
      return { status: "ERROR", reason: `réponse inattendue de la passerelle (${status || "vide"})` };
    } finally {
      clearTimeout(timer);
      void hints;
    }
  }
}

const truthy = (v: string | undefined): boolean | undefined => (v === undefined || v.trim() === "" ? undefined : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

/** Scanner demandé par l'environnement, ou `null` (`DOCUMENTS_SCANNER` absent / `none`). Lève si la configuration est incomplète. */
export function clamavScannerFromEnv(env: Readonly<Record<string, string | undefined>>): ClamavScanner | null {
  const mode = (env.DOCUMENTS_SCANNER ?? "none").trim().toLowerCase();
  if (mode === "" || mode === "none") return null;
  const timeoutMs = Number(env.DOCUMENTS_CLAMAV_TIMEOUT_MS) > 0 ? Number(env.DOCUMENTS_CLAMAV_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (mode === "clamav-tcp") {
    const host = env.DOCUMENTS_CLAMAV_HOST?.trim();
    if (!host) throw new Error("DOCUMENTS_SCANNER=clamav-tcp exige DOCUMENTS_CLAMAV_HOST.");
    const port = Number(env.DOCUMENTS_CLAMAV_PORT ?? 3310);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("DOCUMENTS_CLAMAV_PORT invalide.");
    return new ClamavScanner({ transport: { kind: "tcp", host, port }, timeoutMs });
  }
  if (mode === "clamav-socket") {
    const path = env.DOCUMENTS_CLAMAV_SOCKET?.trim();
    if (!path) throw new Error("DOCUMENTS_SCANNER=clamav-socket exige DOCUMENTS_CLAMAV_SOCKET.");
    return new ClamavScanner({ transport: { kind: "socket", path }, timeoutMs });
  }
  if (mode === "clamav-http") {
    const url = env.DOCUMENTS_CLAMAV_URL?.trim();
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("DOCUMENTS_SCANNER=clamav-http exige DOCUMENTS_CLAMAV_URL (http ou https).");
    return new ClamavScanner({ transport: { kind: "http", url }, timeoutMs });
  }
  throw new Error(`DOCUMENTS_SCANNER inconnu : « ${mode} » (none, clamav-tcp, clamav-socket, clamav-http).`);
}

/**
 * Politique d'analyse de la plateforme : scanner de l'environnement + mode d'échec. `failClosed` vaut vrai par défaut en
 * production (un antivirus injoignable refuse le dépôt) ; sans scanner, aucune analyse (fichiers `UNSCANNED`).
 */
export function scanPolicyFromEnv(env: Readonly<Record<string, string | undefined>>, options: { warn?: (message: string) => void } = {}): ScanPolicy {
  const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  if ((env.DOCUMENTS_SCANNER ?? "").trim().toLowerCase() === "dev-eicar") {
    if (production) throw new Error("DOCUMENTS_SCANNER=dev-eicar est réservé au développement : il ne détecte aucun vrai programme malveillant.");
    return { scanner: new DevEicarScanner(), failClosed: false };
  }
  const scanner = clamavScannerFromEnv(env);
  if (!scanner) {
    if (production) options.warn?.("documents : aucun antivirus configuré (DOCUMENTS_SCANNER) — les fichiers déposés sont enregistrés sans analyse (UNSCANNED).");
    return NO_SCANNER;
  }
  return { scanner, failClosed: truthy(env.DOCUMENTS_SCAN_FAIL_CLOSED) ?? production };
}
