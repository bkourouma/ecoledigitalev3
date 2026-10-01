/**
 * Écoute LISTEN/NOTIFY du canal `ed_domain_events` (trigger posé par la migration
 * `0002_domain_events_notify.sql`). La notification porte le `tenant_id` du lot inséré :
 * le relais sait quel tenant interroger, sans balayer tous les tenants.
 *
 * LISTEN/NOTIFY n'est pas durable : c'est un ACCÉLÉRATEUR de latence. Le balayage
 * périodique du relais reste le filet de sécurité (signal perdu, reconnexion, retries).
 */
import { Client } from "pg";
import { isUuid } from "@ecoledigitale/kernel";
import type { Logger } from "../logger";

export const NOTIFY_CHANNEL = "ed_domain_events";

export interface NotificationSource {
  /** Démarre l'écoute. `onTenant` est appelé pour chaque tenant ayant de nouveaux événements. */
  start(onTenant: (tenantId: string) => void, onReconnect: () => void): Promise<void>;
  stop(): Promise<void>;
  /** `true` tant que la connexion LISTEN est vivante. */
  readonly connected: boolean;
}

export class PgNotificationListener implements NotificationSource {
  private client: Client | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private onTenant: (tenantId: string) => void = () => undefined;
  private onReconnect: () => void = () => undefined;
  connected = false;

  constructor(
    private readonly connectionString: string,
    private readonly logger: Logger,
  ) {}

  async start(onTenant: (tenantId: string) => void, onReconnect: () => void): Promise<void> {
    this.onTenant = onTenant;
    this.onReconnect = onReconnect;
    this.stopped = false;
    await this.connect().catch((err: unknown) => {
      // Pas fatal : le relais fonctionne en polling, on retente en arrière-plan.
      this.logger.warn({ err: errMessage(err) }, "LISTEN indisponible : le relais fonctionne en polling");
      this.scheduleReconnect();
    });
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString, application_name: "ecoledigitale-worker-listen" });
    client.on("notification", (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL) return;
      if (msg.payload && isUuid(msg.payload)) this.onTenant(msg.payload.toLowerCase());
    });
    const lost = (err?: unknown): void => {
      if (this.client !== client) return;
      this.client = null;
      this.connected = false;
      client.removeAllListeners();
      client.on("error", () => undefined);
      client.end().catch(() => undefined);
      if (!this.stopped) {
        this.logger.warn({ err: err ? errMessage(err) : undefined }, "connexion LISTEN perdue : retour au polling");
        this.scheduleReconnect();
      }
    };
    client.on("error", lost);
    client.on("end", () => lost());
    await client.connect();
    this.client = client;
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.connected = true;
    const reconnected = this.attempt > 0;
    this.attempt = 0;
    if (reconnected) {
      this.logger.info({}, "connexion LISTEN rétablie");
      // Des signaux ont pu être perdus pendant la coupure : balayage complet.
      this.onReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    this.attempt += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect().catch((err: unknown) => {
        this.logger.debug({ err: errMessage(err) }, "reconnexion LISTEN échouée");
        this.scheduleReconnect();
      });
    }, delay);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (client) {
      client.removeAllListeners();
      client.on("error", () => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
