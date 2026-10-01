/**
 * Diffusion d'événements de domaine du worker vers les instances de l'API (Redis pub/sub).
 *
 * Pourquoi : les caches de l'API (droits RBAC, entitlements, arbre des périmètres) vivent en mémoire de
 * CHAQUE instance. Les use cases invalident le cache de LEUR processus après commit, mais un changement
 * fait par une autre instance ou par le worker (réactivation d'un tenant, abonnement modifié ailleurs) ne
 * le voit qu'à l'expiration du TTL (30 s). Les abonnés du worker (`rbac.invalidate-permission-cache`,
 * `entitlements.invalidate-cache`) publient donc l'événement relayé sur ce canal ; chaque instance de l'API
 * s'y abonne (`subscribeEventFanout`) et le rejoue sur son bus en mémoire, auquel les caches sont branchés
 * (`subscribeCacheInvalidation` du rbac, `CachedEntitlementsReader.bindToBus`).
 *
 * Le canal est préfixé par `WORKER_QUEUE_PREFIX` (défaut `ed`) : plusieurs environnements peuvent partager
 * un Redis. Un message perdu n'est pas grave (le TTL borne la péremption) : la diffusion est « au mieux ».
 * Sans `REDIS_URL`, `publishEventFanout` ne fait rien et renvoie `false`.
 */
import { Redis } from "ioredis";
import { isValidEventType, type DomainEvent, type Logger } from "@ecoledigitale/kernel";

export function fanoutChannel(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return `${env.WORKER_QUEUE_PREFIX?.trim() || "ed"}:event-fanout`;
}

let publisher: Redis | null = null;
let publisherUrl: string | null = null;

function getPublisher(url: string): Redis {
  if (publisher && publisherUrl === url) return publisher;
  void publisher?.quit().catch(() => undefined);
  publisherUrl = url;
  publisher = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  publisher.on("error", () => undefined); // l'échec d'une publication est signalé à l'appelant, pas par l'émetteur d'événements
  return publisher;
}

/** Publie l'événement aux instances de l'API. `false` si aucun Redis n'est configuré. Lève si Redis refuse. */
export async function publishEventFanout(
  event: DomainEvent,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  const url = env.REDIS_URL?.trim();
  if (!url) return false;
  await getPublisher(url).publish(fanoutChannel(env), JSON.stringify(event));
  return true;
}

export async function closeEventFanoutPublisher(): Promise<void> {
  const current = publisher;
  publisher = null;
  publisherUrl = null;
  await current?.quit().catch(() => undefined);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit un message du canal ; `null` s'il n'a pas la forme d'un événement de domaine. */
export function parseFanoutMessage(raw: string): DomainEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.type !== "string" || !isValidEventType(e.type)) return null;
  if (typeof e.tenantId !== "string" || !UUID_RE.test(e.tenantId)) return null;
  return e as unknown as DomainEvent;
}

export interface EventFanoutSubscription {
  close(): Promise<void>;
}

/** Abonne `onEvent` (bus en mémoire de l'API) au canal. Connexion dédiée (mode abonné). */
export async function subscribeEventFanout(options: {
  url: string;
  env?: Readonly<Record<string, string | undefined>>;
  onEvent: (event: DomainEvent) => void | Promise<void>;
  logger?: Pick<Logger, "warn" | "info">;
}): Promise<EventFanoutSubscription> {
  const channel = fanoutChannel(options.env ?? process.env);
  const redis = new Redis(options.url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  redis.on("error", (err) => options.logger?.warn({ err: err.message }, "event-fanout : erreur Redis (reconnexion automatique)"));
  redis.on("message", (_channel: string, raw: string) => {
    const event = parseFanoutMessage(raw);
    if (!event) return;
    Promise.resolve(options.onEvent(event)).catch((err: unknown) =>
      options.logger?.warn({ err: err instanceof Error ? err.message : String(err), eventType: event.type }, "event-fanout : handler en échec"),
    );
  });
  await redis.subscribe(channel);
  options.logger?.info({ channel }, "event-fanout : abonné");
  return {
    async close() {
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}
