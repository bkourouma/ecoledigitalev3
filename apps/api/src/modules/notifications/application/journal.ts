/**
 * Journal des envois (lecture) : une ligne par remise, destinataire MASQUÉ, statut, tentatives, erreur, identifiant du
 * fournisseur, coût si connu ; filtres ; pagination par curseur ; statistiques. Aucun contenu de message n'est restitué.
 */
import { ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { NotifDeliveryListQuery, NotifDeliveryView } from "@ecoledigitale/contracts/src/v2/notifications";
import { scrubAddresses } from "../domain/addresses";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import { inTx, type NotificationsDeps } from "./deps";

function encodeCursor(c: { t: string; id: string }): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | undefined): { t: string; id: string } | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof c.t === "string" && typeof c.id === "string" && !Number.isNaN(Date.parse(c.t)) && /^[0-9a-f-]{36}$/i.test(c.id)) return { t: c.t, id: c.id };
  } catch {
    /* curseur invalide */
  }
  throw new ValidationError("Curseur invalide.", [{ path: ["cursor"], message: "Curseur invalide." }]);
}

const view = (r: deliveriesRepo.JournalRow): NotifDeliveryView => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  channel: r.channel,
  category: r.category,
  templateCode: r.templateCode,
  templateVersion: r.templateVersion,
  sourceKind: r.sourceKind,
  ruleKey: r.ruleKey,
  status: r.status,
  skipReason: r.skipReason,
  urgent: r.urgent,
  recipient: r.recipientMasked,
  recipientUserId: r.recipientUserId,
  attempts: r.attempts,
  maxAttempts: r.maxAttempts,
  availableAt: r.availableAt.toISOString(),
  sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  errorCode: r.lastErrorCode,
  // Défense en profondeur : même un message d'erreur de fournisseur n'expose jamais une adresse complète.
  errorMessage: r.lastError ? scrubAddresses(r.lastError) : null,
  providerId: r.providerId,
  cost: r.costAmount !== null && r.costCurrency ? { amount: Number(r.costAmount), currency: r.costCurrency } : null,
  eventId: r.sourceEventId,
});

export async function listDeliveries(deps: NotificationsDeps, ctx: RequestContext, q: NotifDeliveryListQuery): Promise<Result<{ items: NotifDeliveryView[]; nextCursor: string | null }, AppError>> {
  const cursor = decodeCursor(q.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await deliveriesRepo.listJournal(tx, ctx.tenantId, {
        channel: q.channel,
        status: q.status,
        category: q.category,
        templateCode: q.templateCode,
        sourceKind: q.sourceKind,
        ruleKey: q.ruleKey,
        userId: q.userId,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        cursor,
        limit: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return ok({ items: page.map(view), nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null });
    },
    { readOnly: true },
  );
}

export async function deliveryStats(deps: NotificationsDeps, ctx: RequestContext, input: { days: number }) {
  const since = new Date(deps.clock.now().getTime() - input.days * 86_400_000);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await deliveriesRepo.statsSince(tx, ctx.tenantId, since);
      return ok({ since: since.toISOString(), byStatus: s.byStatus, byChannel: s.byChannel });
    },
    { readOnly: true },
  );
}
