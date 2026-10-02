"use client";

/**
 * Hooks typés des « webhooks en échec » (`/api/v1/finance/webhook-events`, lecture `finance.webhook.read`, rejeu
 * `finance.webhook.replay` = action sensible, authentification forte exigée et contrôlée par l'API). Schémas Zod de
 * `packages/contracts/src/v2/finance.ts`.
 *
 * Le web n'impose aucune issue : le rejeu n'envoie qu'une note facultative ; le serveur interroge le fournisseur. Aucune charge
 * brute, aucun en-tête, aucune signature n'est jamais renvoyé par l'API.
 *
 * Clés de cache : `["finance", "webhook-events", …]` (le tenant est ajouté par `platformHooks`).
 */

import {
  financeReplayWebhookEventResultDtoSchema,
  financeWebhookEventDtoSchema,
  financeWebhookEventsDtoSchema,
  type FinanceReplayWebhookEventResultDto,
  type FinanceWebhookEventDto,
} from "@ecoledigitale/contracts/v2/finance";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { useApiAction } from "./actions";
import { FINANCE_BASE } from "./finance";

export const WEBHOOK_EVENTS_BASE = `${FINANCE_BASE}/webhook-events`;
const KEY = ["finance", "webhook-events"] as const;

export interface WebhookEventsQuery {
  status: "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";
  provider?: string | undefined;
  paymentId?: string | undefined;
  limit: number;
  offset: number;
}

export function useWebhookEvents(query: WebhookEventsQuery) {
  return hooks.useApiQuery([...KEY, "list"], WEBHOOK_EVENTS_BASE, {
    schema: financeWebhookEventsDtoSchema,
    query: query as unknown as Record<string, string | number | boolean | undefined>,
    refetchOnWindowFocus: false,
  });
}

export function useWebhookEvent(id: string | null) {
  return hooks.useApiQuery([...KEY, "detail", id], `${WEBHOOK_EVENTS_BASE}/${id}`, { schema: financeWebhookEventDtoSchema, enabled: id !== null, retry: false });
}

/** Rejeu : motif facultatif seulement ; l'issue vient du fournisseur, jamais de l'utilisateur. */
export function useReplayWebhookEvent() {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${WEBHOOK_EVENTS_BASE}/${v.id}/replay`,
    body: (v) => (v.note ? { note: v.note } : {}),
    schema: financeReplayWebhookEventResultDtoSchema,
    invalidate: [KEY, ["finance", "pending"], ["finance", "payments"], ["finance", "invoices"], ["finance", "receipts"], ["finance", "statement"], ["finance", "reports"]],
  });
}

export type { FinanceReplayWebhookEventResultDto, FinanceWebhookEventDto };
