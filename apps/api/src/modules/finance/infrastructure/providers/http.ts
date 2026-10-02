/**
 * Client HTTP des adaptateurs de paiement.
 *
 *  - un DÉLAI par tentative (`AbortController`) ;
 *  - des REPRISES bornées avec attente exponentielle, uniquement pour les appels dont la répétition est sans danger
 *    (`safeToRetry` : lectures, jetons, appels idempotents côté fournisseur). Un POST non idempotent n'est répété que
 *    si la requête n'a certainement pas été traitée (connexion refusée, DNS) ;
 *  - une taille de réponse bornée ;
 *  - une JOURNALISATION expurgée : opération, code HTTP, tentative, durée. Jamais d'URL (elle peut porter un jeton),
 *    d'en-tête, de corps ni de numéro.
 *
 * Les erreurs de transport deviennent `finance.provider_failed` avec un motif court ; les réponses 4xx sont rendues à
 * l'adaptateur, qui sait les interpréter (401 ⇒ jeton périmé, 409 ⇒ rejeu…).
 */
import { err, noopLogger, ok, type AppError, type Logger, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict } from "../../domain/errors";

export interface ProviderHttpOptions {
  /** Nom du fournisseur (journaux, erreurs). */
  readonly provider: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: Logger;
  /** `http:` n'est accepté qu'en développement/test (serveurs simulés locaux). */
  readonly allowInsecureHttp?: boolean;
  readonly maxResponseBytes?: number;
}

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Libellé court de l'opération (journaux). */
  readonly operation: string;
  /** Vrai si répéter l'appel ne peut pas dupliquer d'effet. */
  readonly safeToRetry: boolean;
  readonly timeoutMs?: number;
}

export interface HttpResult {
  readonly status: number;
  readonly text: string;
  /** Corps JSON analysé ; `undefined` si le corps est vide ou n'est pas du JSON. */
  readonly json: unknown;
  readonly jsonValid: boolean;
  readonly headers: { get(name: string): string | null };
}

export const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;
const MAX_RETRY_AFTER_MS = 5_000;
const PRE_SEND_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

type Failure = "timeout" | "network" | "upstream_5xx" | "upstream_429";

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ProviderHttp {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Logger;
  private readonly maxBytes: number;

  constructor(private readonly options: ProviderHttpOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? noopLogger;
    this.maxBytes = options.maxResponseBytes ?? 1_048_576;
  }

  get provider(): string {
    return this.options.provider;
  }

  async request(req: HttpRequest): Promise<Result<HttpResult, AppError>> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return err(conflict(FinanceCode.PROVIDER_CONFIG_INVALID, "Point d'accès du fournisseur invalide.", { provider: this.provider }));
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && this.options.allowInsecureHttp)) {
      return err(
        conflict(FinanceCode.PROVIDER_CONFIG_INVALID, "Le point d'accès du fournisseur doit être en HTTPS.", { provider: this.provider }),
      );
    }

    const maxAttempts = 1 + this.retries;
    let lastFailure: Failure = "network";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      let preSend = false;
      let retryAfterMs: number | null = null;
      try {
        const result = await this.once(req, url);
        const ms = Date.now() - started;
        if (result.status >= 500 || result.status === 429) {
          lastFailure = result.status === 429 ? "upstream_429" : "upstream_5xx";
          retryAfterMs = parseRetryAfter(result.headers.get("retry-after"));
          this.logger.warn({ provider: this.provider, operation: req.operation, status: result.status, attempt, durationMs: ms }, "fournisseur : réponse en erreur");
          // 5xx : le traitement a pu avoir lieu ; 429 : la requête a été refusée avant traitement.
          if (!(req.safeToRetry || result.status === 429) || attempt === maxAttempts) {
            return result.status === 429 || req.safeToRetry ? err(this.failure(req, lastFailure, result.status)) : ok(result);
          }
        } else {
          this.logger.info({ provider: this.provider, operation: req.operation, status: result.status, attempt, durationMs: ms }, "fournisseur : appel");
          return ok(result);
        }
      } catch (e) {
        const reason = classify(e);
        lastFailure = reason.failure;
        preSend = reason.preSend;
        this.logger.warn({ provider: this.provider, operation: req.operation, failure: reason.failure, attempt, durationMs: Date.now() - started }, "fournisseur : échec de transport");
        if (!(req.safeToRetry || preSend) || attempt === maxAttempts) return err(this.failure(req, lastFailure));
      }
      await this.sleep(retryAfterMs ?? this.baseDelayMs * 2 ** (attempt - 1));
    }
    return err(this.failure(req, lastFailure));
  }

  private failure(req: HttpRequest, reason: Failure, status?: number): AppError {
    return conflict(FinanceCode.PROVIDER_FAILED, "Le fournisseur de paiement est indisponible ou a répondu en erreur.", {
      provider: this.provider,
      operation: req.operation,
      reason,
      ...(status !== undefined ? { httpStatus: status } : {}),
    });
  }

  private async once(req: HttpRequest, url: URL): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: req.method,
        headers: { accept: "application/json", ...req.headers },
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: controller.signal,
        redirect: "error",
      });
      const text = await response.text();
      if (text.length > this.maxBytes) throw new MalformedResponse();
      let json: unknown;
      let jsonValid = true;
      if (text.trim().length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          jsonValid = false;
        }
      }
      return { status: response.status, text, json, jsonValid, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  }
}

class MalformedResponse extends Error {}

function classify(e: unknown): { failure: Failure; preSend: boolean } {
  const name = (e as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return { failure: "timeout", preSend: false };
  const cause = (e as { cause?: { code?: string } } | null)?.cause;
  const code = cause?.code ?? (e as { code?: string } | null)?.code;
  return { failure: "network", preSend: typeof code === "string" && PRE_SEND_ERROR_CODES.has(code) };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const s = Number(value);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_RETRY_AFTER_MS) : null;
}
