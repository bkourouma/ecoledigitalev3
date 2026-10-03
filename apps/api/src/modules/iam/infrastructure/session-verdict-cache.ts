/**
 * Cache du verdict de session, à révocation IMMÉDIATE et échec fermé.
 *
 * Problème : chaque requête authentifiée relit en base (`findSessionForRequest` : session + identité + accès +
 * tenant) pour décider si la session est encore valide. Un cache local naïf servirait un verdict périmé après une
 * révocation faite sur une AUTRE instance d'API. Ici le cache local n'est servi que si un compteur partagé (Redis)
 * prouve qu'AUCUN écrivain n'a touché au verdict depuis son remplissage : un aller-retour Redis (un script Lua)
 * remplace une transaction SQL.
 *
 * Jetons de version (valeurs aléatoires uniques, jamais des entiers réutilisables) pour TROIS portées :
 *   - session  : `(tenant, session)`             révocation, déconnexion ;
 *   - identité : `identité` (tous établissements) époque (mot de passe, déconnexion générale, MFA), statut,
 *                                                accès (statut, rôles) de l'identité ;
 *   - tenant   : `tenant`                        suspension, archivage.
 * Un verdict en cache porte les trois jetons lus AVANT la lecture SQL qui l'a produit ; il n'est resservi que si les
 * trois jetons sont inchangés ET qu'aucune écriture n'est en cours.
 *
 * Écrivains (port `invalidateSessionVerdict` du noyau) :
 *   begin (DANS la transaction, avant COMMIT) : nouveau jeton + marqueur « écriture en cours » (compteur à durée de vie
 *   courte) pour chaque portée touchée ; un lecteur voyant le marqueur ne sert ni ne remplit le cache.
 *   end (après COMMIT/ROLLBACK) : décrémente le marqueur. Si `end` est perdu, le marqueur expire seul (cache simplement
 *   contourné). Si `begin` échoue, l'appelant annule sa transaction.
 *
 * Pourquoi c'est sans fenêtre de grâce : (1) un lecteur dont les jetons précèdent `begin` voit ensuite un jeton
 * différent ; (2) un lecteur qui lit après `begin` voit le marqueur jusqu'à la fin de la transaction de l'écrivain,
 * donc lit la base (qui reflète le COMMIT) ; (3) après la fin du marqueur, la base est à jour.
 *
 * Échec fermé côté lecture : Redis lent (> délai court), injoignable, déconnecté, réponse incohérente, clé absente
 * (jeton recréé -> différent) => AUCUN verdict servi depuis le cache, lecture complète en base (comportement
 * historique). Un disjoncteur évite d'attendre Redis à chaque requête pendant une panne ; chaque erreur ou
 * déconnexion vide le cache local. Durée de vie locale absolue très courte (secondes), jamais au-delà de l'expiration
 * de la session (l'expiration est de toute façon réévaluée à CHAQUE requête sur la ligne en cache).
 */
import { randomBytes } from "node:crypto";
import type { Logger, SessionVerdictInvalidator, SessionVerdictTarget } from "@ecoledigitale/kernel";
import { noopLogger, registerSessionVerdictInvalidator } from "@ecoledigitale/kernel";
import type { SessionCheckRow } from "./session-repo";

/** Sous-ensemble d'ioredis utilisé (`Redis` de `ioredis` le satisfait). */
export interface VerdictRedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  /** Facultatif : abonnement aux événements de connexion (vidage du cache local à toute déconnexion). */
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface SessionVerdictCacheOptions {
  redis: VerdictRedisLike;
  /** Préfixe des clés Redis (partagé par toutes les instances d'un même environnement). */
  prefix?: string;
  /** Durée de vie locale ABSOLUE d'un verdict (ms). Défaut 3000, plafonné à 10000. */
  ttlMs?: number;
  /** Délai maximal d'un aller-retour Redis (ms) avant repli sur la base. Défaut 150. */
  redisTimeoutMs?: number;
  /** Durée pendant laquelle Redis n'est plus interrogé après une erreur (ms). Défaut 1000. */
  breakerMs?: number;
  /** Durée de vie du marqueur « écriture en cours » (ms) : doit dépasser la durée d'une transaction. Défaut 60000. */
  pendingTtlMs?: number;
  /** Durée de vie des jetons (ms). Un jeton expiré est recréé différent : sans danger. Défaut 600000. */
  tokenTtlMs?: number;
  maxEntries?: number;
  logger?: Logger;
  /** Horloge monotone (ms) injectable (tests). */
  now?: () => number;
}

export type VerdictLookup =
  | { kind: "hit"; row: SessionCheckRow }
  /** Pas de verdict utilisable : lire la base ; `ticket` permet ensuite de le mémoriser. */
  | { kind: "miss"; ticket: VerdictTicket }
  /** Cache inutilisable (Redis indisponible, écriture en cours) : lire la base, ne rien mémoriser. */
  | { kind: "bypass" };

export interface VerdictTicket {
  readonly key: string;
  readonly tokens: string;
}

export interface VerdictCacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  stores: number;
  redisErrors: number;
  invalidations: number;
}

/**
 * KEYS = jetons (session, identité, tenant, global) puis marqueurs (session, identité, tenant) ;
 * ARGV[1..4] = jetons neufs (utilisés seulement si la clé est absente), ARGV[5] = durée de vie des jetons.
 * Réponse : les 4 jetons, puis 1 si une écriture est en cours sur l'une des trois portées, sinon 0.
 */
const LOOKUP_SCRIPT = `
local out = {}
for i = 1, 4 do
  local t = redis.call('GET', KEYS[i])
  if not t then
    t = ARGV[i]
    redis.call('SET', KEYS[i], t, 'PX', ARGV[5])
  end
  out[i] = t
end
local pending = 0
for i = 5, 7 do
  if redis.call('EXISTS', KEYS[i]) == 1 then pending = 1 end
end
out[5] = pending
return out
`;

/** KEYS = paires (jeton, marqueur) ; ARGV[1] = durée du jeton, ARGV[2] = durée du marqueur, ARGV[3..] = jetons neufs. */
const BEGIN_SCRIPT = `
local n = #KEYS / 2
for i = 1, n do
  redis.call('SET', KEYS[i], ARGV[2 + i], 'PX', ARGV[1])
  redis.call('INCR', KEYS[n + i])
  redis.call('PEXPIRE', KEYS[n + i], ARGV[2])
end
return n
`;

const END_SCRIPT = `
for i = 1, #KEYS do
  local c = redis.call('DECR', KEYS[i])
  if c <= 0 then redis.call('DEL', KEYS[i]) end
end
return #KEYS
`;

interface Entry {
  row: SessionCheckRow;
  tokens: string;
  deadline: number;
}

const cloneRow = (row: SessionCheckRow): SessionCheckRow => ({ ...row, membership_roles: [...row.membership_roles] });

export class SessionVerdictCache implements SessionVerdictInvalidator {
  private readonly redis: VerdictRedisLike;
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly redisTimeoutMs: number;
  private readonly breakerMs: number;
  private readonly pendingTtlMs: number;
  private readonly tokenTtlMs: number;
  private readonly maxEntries: number;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly local = new Map<string, Entry>();
  private readonly instance = randomBytes(6).toString("hex");
  private seq = 0;
  private breakerUntil = 0;
  readonly counters: VerdictCacheStats = { hits: 0, misses: 0, bypasses: 0, stores: 0, redisErrors: 0, invalidations: 0 };

  constructor(options: SessionVerdictCacheOptions) {
    this.redis = options.redis;
    this.prefix = options.prefix ?? "ed:iam:sv:";
    this.ttlMs = Math.min(Math.max(options.ttlMs ?? 3000, 1), 10_000);
    this.redisTimeoutMs = Math.max(options.redisTimeoutMs ?? 150, 1);
    this.breakerMs = Math.max(options.breakerMs ?? 1000, 0);
    this.pendingTtlMs = Math.max(options.pendingTtlMs ?? 60_000, 1000);
    this.tokenTtlMs = Math.max(options.tokenTtlMs ?? 600_000, this.ttlMs * 2);
    this.maxEntries = Math.max(options.maxEntries ?? 5000, 1);
    this.logger = options.logger ?? noopLogger;
    this.now = options.now ?? (() => performance.now());
    for (const event of ["close", "end", "error", "reconnecting"]) {
      options.redis.on?.(event, () => {
        this.local.clear();
      });
    }
  }

  /** Vide le cache local (tests, arrêt). */
  clearLocal(): void {
    this.local.clear();
  }

  get size(): number {
    return this.local.size;
  }

  /** Branche ce cache comme invalidateur du processus (écrivains : iam, tenancy, tenant-sync). */
  registerAsInvalidator(): () => void {
    registerSessionVerdictInvalidator(this);
    return () => registerSessionVerdictInvalidator(null);
  }

  // --- clés ----------------------------------------------------------------------------------------------------

  private tokenKey(t: SessionVerdictTarget): string {
    switch (t.kind) {
      case "session":
        return `${this.prefix}t:s:${t.tenantId}:${t.sessionId}`;
      case "identity":
        return `${this.prefix}t:i:${t.identityId}`;
      case "tenant":
        return `${this.prefix}t:t:${t.tenantId}`;
    }
  }

  /** Jeton GLOBAL : `DEL` de cette clé (redis-cli) invalide d'un coup TOUS les verdicts en cache (après un SQL direct, par ex.). */
  globalKey(): string {
    return `${this.prefix}t:g`;
  }

  /** Invalide tous les verdicts de toutes les instances (idem `redis-cli DEL <préfixe>t:g`). Lève si Redis est injoignable. */
  async invalidateAll(): Promise<void> {
    await this.redisEval("return redis.call('DEL', KEYS[1])", [this.globalKey()], []);
    this.local.clear();
  }

  private pendingKey(t: SessionVerdictTarget): string {
    return this.tokenKey(t).replace(`${this.prefix}t:`, `${this.prefix}p:`);
  }

  private fresh(): string {
    return `${this.instance}.${(++this.seq).toString(36)}`;
  }

  private async redisEval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.redis.eval(script, keys.length, ...keys, ...args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("redis_timeout")), this.redisTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private tripBreaker(error: unknown): void {
    this.counters.redisErrors++;
    this.local.clear();
    this.breakerUntil = this.now() + this.breakerMs;
    this.logger.warn({ event: "iam_session_cache_redis_error", err: error instanceof Error ? error.message : String(error) }, "cache de session : Redis indisponible, lecture en base");
  }

  // --- lecture -------------------------------------------------------------------------------------------------

  /**
   * UN aller-retour Redis. `hit` : verdict mémorisé ET jetons inchangés ET aucune écriture en cours. Toute autre
   * issue = lire la base (échec fermé).
   */
  async lookup(tenantId: string, identityId: string, sessionId: string): Promise<VerdictLookup> {
    const t = this.now();
    if (t < this.breakerUntil) {
      this.counters.bypasses++;
      return { kind: "bypass" };
    }
    const targets: SessionVerdictTarget[] = [
      { kind: "session", tenantId, sessionId },
      { kind: "identity", identityId },
      { kind: "tenant", tenantId },
    ];
    let reply: unknown;
    try {
      reply = await this.redisEval(
        LOOKUP_SCRIPT,
        [this.tokenKey(targets[0] as SessionVerdictTarget), this.tokenKey(targets[1] as SessionVerdictTarget), this.tokenKey(targets[2] as SessionVerdictTarget), this.globalKey(), ...targets.map((x) => this.pendingKey(x))],
        [this.fresh(), this.fresh(), this.fresh(), this.fresh(), this.tokenTtlMs],
      );
    } catch (error) {
      this.tripBreaker(error);
      this.counters.bypasses++;
      return { kind: "bypass" };
    }
    if (
      !Array.isArray(reply) ||
      reply.length !== 5 ||
      !reply.slice(0, 4).every((x) => typeof x === "string" && x.length > 0) ||
      (reply[4] !== 0 && reply[4] !== 1)
    ) {
      this.tripBreaker(new Error("réponse Redis incohérente"));
      this.counters.bypasses++;
      return { kind: "bypass" };
    }
    const tokens = reply.slice(0, 4).join("|");
    const key = `${tenantId}:${sessionId}`;
    if (reply[4] === 1) {
      // Une écriture du verdict est en cours : ni service ni remplissage.
      this.local.delete(key);
      this.counters.bypasses++;
      return { kind: "bypass" };
    }
    const entry = this.local.get(key);
    if (entry && entry.deadline > t && entry.tokens === tokens) {
      this.counters.hits++;
      return { kind: "hit", row: cloneRow(entry.row) };
    }
    if (entry) this.local.delete(key);
    this.counters.misses++;
    return { kind: "miss", ticket: { key, tokens } };
  }

  /** Mémorise un verdict VALIDE lu en base après `lookup` (jetons de AVANT la lecture). */
  store(ticket: VerdictTicket, row: SessionCheckRow): void {
    if (this.local.size >= this.maxEntries) {
      const oldest = this.local.keys().next().value;
      if (oldest !== undefined) this.local.delete(oldest);
    }
    this.local.delete(ticket.key);
    this.local.set(ticket.key, { row: cloneRow(row), tokens: ticket.tokens, deadline: this.now() + this.ttlMs });
    this.counters.stores++;
  }

  // --- écriture (SessionVerdictInvalidator) --------------------------------------------------------------------

  async begin(targets: readonly SessionVerdictTarget[]): Promise<void> {
    if (targets.length === 0) return;
    // Pas de disjoncteur ici : une écriture de verdict DOIT confirmer son invalidation, ou échouer.
    const keys = [...targets.map((x) => this.tokenKey(x)), ...targets.map((x) => this.pendingKey(x))];
    const reply = await this.redisEval(BEGIN_SCRIPT, keys, [this.tokenTtlMs, this.pendingTtlMs, ...targets.map(() => this.fresh())]);
    if (reply !== targets.length) throw new Error("réponse Redis incohérente (begin)");
    this.counters.invalidations++;
    // Le cache local de CETTE instance est lui aussi concerné (les jetons ont changé : il ne servirait plus de toute façon).
    this.local.clear();
  }

  async end(targets: readonly SessionVerdictTarget[]): Promise<void> {
    if (targets.length === 0) return;
    try {
      await this.redisEval(END_SCRIPT, targets.map((x) => this.pendingKey(x)), []);
    } catch (error) {
      // Le marqueur expirera seul (pendingTtlMs) : le cache est contourné d'ici là, jamais périmé.
      this.logger.warn({ event: "iam_session_cache_end_failed", err: error instanceof Error ? error.message : String(error) }, "cache de session : fin d'invalidation perdue (le marqueur expire seul)");
    }
  }
}

// -----------------------------------------------------------------------------
// Cache du processus + câblage de la plateforme
// -----------------------------------------------------------------------------

let processCache: SessionVerdictCache | null = null;

/** Cache du verdict du processus (posé par `installSessionVerdictCache`) ; `createIamService` le reprend par défaut. */
export function getProcessVerdictCache(): SessionVerdictCache | null {
  return processCache;
}

export interface InstalledVerdictCache {
  cache: SessionVerdictCache;
  /** Retire le cache et l'invalidateur du processus. */
  uninstall(): void;
}

/** Installe `cache` comme cache ET invalidateur du processus (démarrage de la plateforme, AVANT toute écriture de verdict). */
export function installSessionVerdictCache(cache: SessionVerdictCache): InstalledVerdictCache {
  processCache = cache;
  const unregister = cache.registerAsInvalidator();
  return {
    cache,
    uninstall() {
      if (processCache === cache) processCache = null;
      unregister();
    },
  };
}

export interface StartedVerdictCache extends InstalledVerdictCache {
  /** Ferme la connexion Redis dédiée et retire le cache du processus. */
  close(): Promise<void>;
}

/**
 * Crée (si l'environnement l'autorise) le cache de verdict sur une connexion Redis DÉDIÉE (sans file d'attente hors
 * ligne : une commande émise Redis coupé échoue tout de suite au lieu de s'accumuler puis de s'exécuter plus tard) et
 * l'installe comme cache + invalidateur du processus. Renvoie `null` si désactivé.
 */
export async function startSessionVerdictCacheFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { logger?: Logger } = {},
): Promise<StartedVerdictCache | null> {
  const logger = options.logger ?? noopLogger;
  const cfg = readVerdictCacheEnv(env);
  if (!cfg.enabled) {
    logger.info({ sessionCache: "off", reason: cfg.reason }, "iam : cache de verdict de session désactivé");
    return null;
  }
  const { Redis } = await import("ioredis");
  const redis = new Redis((env.REDIS_URL as string).trim(), {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    commandTimeout: cfg.redisTimeoutMs * 4,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
  redis.on("error", (err: Error) => logger.warn({ err: err.message }, "iam : cache de verdict, erreur Redis"));
  await new Promise<void>((resolve) => {
    if (redis.status === "ready") return resolve();
    const timer = setTimeout(resolve, 2000);
    redis.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const prefix = `${env.WORKER_QUEUE_PREFIX?.trim() || "ed"}:iam:sv:`;
  const cache = new SessionVerdictCache({ redis: redis as unknown as VerdictRedisLike, prefix, ttlMs: cfg.ttlMs, redisTimeoutMs: cfg.redisTimeoutMs, logger });
  const installed = installSessionVerdictCache(cache);
  logger.info({ sessionCache: "on", ttlMs: cfg.ttlMs, redisTimeoutMs: cfg.redisTimeoutMs, reason: cfg.reason }, "iam : cache de verdict de session ACTIF (révocation immédiate via Redis, échec fermé)");
  return {
    ...installed,
    async close() {
      installed.uninstall();
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

// -----------------------------------------------------------------------------
// Configuration par l'environnement
// -----------------------------------------------------------------------------

export interface VerdictCacheEnv {
  enabled: boolean;
  ttlMs: number;
  redisTimeoutMs: number;
  reason: string;
}

/**
 * `V2_SESSION_CACHE=on|off` ; absent : ACTIVÉ si `REDIS_URL` est défini hors tests (`NODE_ENV=test`, Vitest, Jest), sinon
 * désactivé. `V2_SESSION_CACHE_TTL_MS` (défaut 3000, max 10000), `V2_SESSION_CACHE_REDIS_TIMEOUT_MS` (défaut 150).
 * TOUTES les instances d'un même environnement doivent partager la même valeur (les écrivains n'invalident que si le
 * cache est actif sur leur instance).
 */
export function readVerdictCacheEnv(env: Readonly<Record<string, string | undefined>>): VerdictCacheEnv {
  const flag = (env.V2_SESSION_CACHE ?? "").trim().toLowerCase();
  const num = (name: string, def: number, min: number, max: number): number => {
    const raw = (env[name] ?? "").trim();
    if (raw === "") return def;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${name} doit être un nombre.`);
    return Math.min(Math.max(Math.trunc(n), min), max);
  };
  const ttlMs = num("V2_SESSION_CACHE_TTL_MS", 3000, 1, 10_000);
  const redisTimeoutMs = num("V2_SESSION_CACHE_REDIS_TIMEOUT_MS", 150, 10, 2000);
  if (/^(off|false|0|no)$/.test(flag)) return { enabled: false, ttlMs, redisTimeoutMs, reason: "V2_SESSION_CACHE=off" };
  const hasRedis = Boolean(env.REDIS_URL?.trim());
  if (/^(on|true|1|yes)$/.test(flag)) {
    return hasRedis
      ? { enabled: true, ttlMs, redisTimeoutMs, reason: "V2_SESSION_CACHE=on" }
      : { enabled: false, ttlMs, redisTimeoutMs, reason: "V2_SESSION_CACHE=on mais REDIS_URL absent : désactivé (échec fermé)" };
  }
  const inTest = env.NODE_ENV === "test" || Boolean(env.VITEST) || Boolean(env.JEST_WORKER_ID);
  if (inTest) return { enabled: false, ttlMs, redisTimeoutMs, reason: "désactivé par défaut en test" };
  if (!hasRedis) return { enabled: false, ttlMs, redisTimeoutMs, reason: "REDIS_URL absent" };
  return { enabled: true, ttlMs, redisTimeoutMs, reason: "activé par défaut (REDIS_URL défini)" };
}
