/**
 * Cache de jeton OAuth d'un adaptateur.
 *
 *  - le jeton est conservé jusqu'à `skewMs` (60 s) avant son expiration (horloge injectée) ;
 *  - UN SEUL renouvellement à la fois (single-flight) : N appels concurrents partagent la même requête ;
 *  - un échec n'est jamais mis en cache ;
 *  - `invalidate()` (réponse 401) force le renouvellement au prochain appel.
 *
 * Le jeton ne sort jamais de cet objet vers un journal : seuls `get()` et l'appelant HTTP le manipulent.
 */
import type { AppError, Clock, Result } from "@ecoledigitale/kernel";
import { ok } from "@ecoledigitale/kernel";

export interface FetchedToken {
  readonly token: string;
  /** Durée de validité annoncée, en secondes (défaut prudent : 5 minutes). */
  readonly expiresInSec?: number;
}

export interface TokenCacheOptions {
  readonly clock: Clock;
  readonly fetchToken: () => Promise<Result<FetchedToken, AppError>>;
  readonly skewMs?: number;
}

const DEFAULT_TTL_SEC = 300;

export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<Result<string, AppError>> | null = null;
  private generation = 0;

  constructor(private readonly options: TokenCacheOptions) {}

  async get(): Promise<Result<string, AppError>> {
    const now = this.options.clock.now().getTime();
    if (this.token && now < this.expiresAt) return ok(this.token);
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    const flight = (async (): Promise<Result<string, AppError>> => {
      try {
        const fetched = await this.options.fetchToken();
        if (!fetched.ok) return fetched;
        // Si `invalidate()` est survenu pendant le renouvellement, le jeton obtenu reste utilisable une fois
        // mais n'est pas conservé.
        if (generation === this.generation) {
          const ttlMs = Math.max(0, (fetched.value.expiresInSec ?? DEFAULT_TTL_SEC) * 1000 - (this.options.skewMs ?? 60_000));
          this.token = fetched.value.token;
          this.expiresAt = this.options.clock.now().getTime() + ttlMs;
        }
        return ok(fetched.value.token);
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = flight;
    return flight;
  }

  invalidate(): void {
    this.generation++;
    this.token = null;
    this.expiresAt = 0;
  }
}
