/**
 * Choix du fournisseur SMS par configuration : `NOTIFICATIONS_SMS_PROVIDER`.
 *
 *   (absent) | http   adaptateur HTTP GÉNÉRIQUE (`sms-http.ts`, `SMS_HTTP_*`) — comportement historique ;
 *   orange             adaptateur dédié Orange SMS API (`sms-orange.ts`, `ORANGE_SMS_*`) — désactivé tant que
 *                      `ORANGE_SMS_MODE` n'est pas `sandbox` ou `live` ;
 *   none | disabled    aucun fournisseur : le canal échoue explicitement ;
 *   autre valeur       configuration invalide : le canal échoue explicitement (jamais de repli silencieux).
 */
import type { ChannelAdapter } from "../../application/ports";
import { createOrangeSmsChannel } from "./sms-orange";
import { createSmsHttpChannel } from "./sms-http";

export const SMS_PROVIDERS = ["http", "orange", "none"] as const;

export interface SmsChannelOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly production?: boolean;
  readonly now?: () => number;
}

function unavailable(provider: string, missing: string): ChannelAdapter {
  return {
    channel: "SMS",
    provider,
    status: () => ({ configured: false, missing: [missing] }),
    async deliver() {
      return { status: "FAILED", code: "channel_not_configured", message: `Canal SMS non configuré (${missing}).` };
    },
  };
}

export function createSmsChannel(options: SmsChannelOptions): ChannelAdapter {
  const choice = (options.env.NOTIFICATIONS_SMS_PROVIDER ?? "").trim().toLowerCase();
  const passFetch = options.fetch ? { fetch: options.fetch } : {};
  switch (choice) {
    case "":
    case "http":
      return createSmsHttpChannel({ env: options.env, ...passFetch });
    case "orange":
      return createOrangeSmsChannel({ env: options.env, ...passFetch, ...(options.production !== undefined ? { production: options.production } : {}), ...(options.now ? { now: options.now } : {}) });
    case "none":
    case "disabled":
      return unavailable("none", "NOTIFICATIONS_SMS_PROVIDER (aucun fournisseur SMS)");
    default:
      return unavailable("none", `NOTIFICATIONS_SMS_PROVIDER inconnu (${SMS_PROVIDERS.join(", ")})`);
  }
}
