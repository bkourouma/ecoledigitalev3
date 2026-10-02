/**
 * Registre des canaux, construit depuis l'environnement. Règle d'or : un canal non configuré ÉCHOUE EXPLICITEMENT
 * (`channel_not_configured`, remise `FAILED` consignée) — jamais de simulation silencieuse. La seule exception est le mode
 * SIMULATION demandé explicitement (`NOTIFICATIONS_SIMULATE=1`), refusé en production, et consigné comme tel
 * (statut `SIMULATED`, jamais confondu avec un envoi).
 */
import { NOTIF_CHANNELS, type NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import type { NotificationsDeps } from "../../application/deps";
import { createPushStore } from "../../application/push";
import type { ChannelAdapter, ChannelMessage, ChannelOutcome, ChannelRegistry } from "../../application/ports";
import { createSystemContext } from "@ecoledigitale/kernel";
import { createSmtpChannel } from "./email-smtp";
import { createInAppChannel } from "./in-app";
import { createSmsChannel } from "./sms-provider";
import { createWebPushChannel } from "./web-push";
import { createWasenderChannel } from "./whatsapp-wasender";

export interface ChannelRegistryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Adaptateurs imposés (tests, déploiements particuliers). */
  readonly overrides?: Partial<Record<NotifChannel, ChannelAdapter>>;
  readonly fetch?: typeof fetch;
}

/** Enveloppe un canal non configuré : échec explicite, ou simulation EXPLICITE hors production. */
function guard(adapter: ChannelAdapter, simulate: boolean): ChannelAdapter {
  return {
    channel: adapter.channel,
    provider: adapter.provider,
    status: () => adapter.status(),
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      if (adapter.status().configured) return adapter.deliver(m);
      if (simulate) return { status: "SIMULATED", providerId: `simulation:${m.deliveryId}` };
      return {
        status: "FAILED",
        code: "channel_not_configured",
        message: `Canal ${adapter.channel} non configuré (variables manquantes : ${adapter.status().missing.join(", ") || "—"}).`,
      };
    },
    ...(adapter.close ? { close: () => adapter.close!() } : {}),
  };
}

export function createChannelRegistry(deps: NotificationsDeps, options: ChannelRegistryOptions = {}): ChannelRegistry {
  const env = options.env ?? process.env;
  const simulate = deps.config.simulate && !deps.config.production;
  const fetchImpl = options.fetch;
  const pushStore = createPushStore(deps, (tenantId) => createSystemContext(tenantId));
  const secretPresent = deps.config.unsubscribeSecret !== null;

  const built: Record<NotifChannel, ChannelAdapter> = {
    IN_APP: options.overrides?.IN_APP ?? createInAppChannel({ db: deps.db, clock: deps.clock, logger: deps.logger }),
    EMAIL: options.overrides?.EMAIL ?? createSmtpChannel({ env, requireUnsubscribeSecret: deps.config.production, unsubscribeSecretPresent: secretPresent }),
    SMS: options.overrides?.SMS ?? createSmsChannel({ env, production: deps.config.production, ...(fetchImpl ? { fetch: fetchImpl } : {}) }),
    WHATSAPP: options.overrides?.WHATSAPP ?? createWasenderChannel({ env, ...(fetchImpl ? { fetch: fetchImpl } : {}) }),
    PUSH: options.overrides?.PUSH ?? createWebPushChannel({ env, store: pushStore, ...(fetchImpl ? { fetch: fetchImpl } : {}), now: () => deps.clock.now() }),
  };
  const adapters = new Map<NotifChannel, ChannelAdapter>(NOTIF_CHANNELS.map((c) => [c, guard(built[c], simulate)]));
  return {
    get: (channel) => adapters.get(channel)!,
    all: () => [...adapters.values()],
    simulation: simulate,
  };
}

/** Ferme tous les adaptateurs qui détiennent des connexions. */
export async function closeChannelRegistry(registry: ChannelRegistry): Promise<void> {
  await Promise.all(registry.all().map((a) => a.close?.().catch(() => undefined)));
}
