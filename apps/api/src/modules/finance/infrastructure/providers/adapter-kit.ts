/**
 * Socle partagé des adaptateurs : environnement d'exécution injecté, points d'accès, erreurs normalisées.
 */
import { err, type AppError, type Clock, type Logger, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, validation } from "../../domain/errors";
import type { ProviderSettings } from "./registry";

export type ProviderMode = "sandbox" | "production";

/** Points d'accès par fournisseur (niveau PLATEFORME : jamais configurables par un tenant → pas de SSRF). */
export interface EndpointSet {
  readonly production?: string;
  readonly sandbox?: string;
}
export type ProviderEndpoints = Readonly<Record<string, EndpointSet>>;

export interface AdapterRuntime {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retries?: number;
  /** Surcharge des points d'accès (tests : serveurs simulés ; exploitation : `FINANCE_PROVIDER_<NOM>_BASE_URL`). */
  readonly endpoints?: ProviderEndpoints;
  /** `http:` accepté (développement/test uniquement). */
  readonly allowInsecureHttp?: boolean;
}

export const modeOf = (settings: ProviderSettings): ProviderMode => (settings.mode === "sandbox" ? "sandbox" : "production");

export function endpointFor(
  runtime: AdapterRuntime,
  provider: string,
  mode: ProviderMode,
  defaults: EndpointSet,
): string {
  const override = runtime.endpoints?.[provider];
  const url = (mode === "sandbox" ? override?.sandbox ?? defaults.sandbox : override?.production ?? defaults.production) ?? defaults.production ?? "";
  return url.replace(/\/+$/, "");
}

/** Erreur de transport / de réponse : motif court, jamais de corps ni de message du fournisseur. */
export function upstreamError(provider: string, operation: string, reason: string, extra: Record<string, unknown> = {}): AppError {
  return conflict(FinanceCode.PROVIDER_FAILED, "Le fournisseur de paiement a refusé ou n'a pas pu traiter la demande.", {
    provider,
    operation,
    reason,
    ...extra,
  });
}

export const malformed = (provider: string, operation: string): Result<never, AppError> =>
  err(upstreamError(provider, operation, "malformed_response"));

export const invalidAmount = (message: string): AppError => validation(FinanceCode.INVALID_AMOUNT, message, "amount");

export const invalidInput = (message: string, path: string): AppError => validation(FinanceCode.INVALID_INPUT, message, path);

/** Code amont court et sûr (`[A-Za-z0-9_.:-]{1,40}`) tiré d'une réponse, sinon `undefined`. */
export function safeUpstreamCode(v: unknown): string | undefined {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : undefined;
  return s !== undefined && /^[A-Za-z0-9_.:-]{1,40}$/.test(s) ? s : undefined;
}
