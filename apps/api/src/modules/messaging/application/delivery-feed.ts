/**
 * Annonce publiée, vue par les CANAUX EXTERNES (module `notifications`, spec v2/016) : titre, extrait, priorité et
 * destinataires FIGÉS à la publication (comptes). Extension ADDITIVE de `messaging`, lecture seule, sans droit d'appelant :
 * c'est un contexte système (relais d'un événement déjà publié), jamais une route. Une annonce retirée ou non publiée ne
 * se relaie pas (`null`).
 *
 * L'extrait est la première ligne du corps (300 caractères au plus) : un SMS ou une notification push ne porte jamais le
 * texte intégral ni ses pièces jointes ; le détail est lu dans l'application, derrière l'authentification.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import * as repo from "../infrastructure/announcements-repository";
import { inTx, type MessagingDeps } from "./deps";

export const DELIVERY_FEED_MAX_RECIPIENTS = 5000;

export interface AnnouncementDeliveryView {
  readonly title: string;
  readonly summary: string | null;
  readonly priority: string;
  readonly recipientUserIds: readonly string[];
}

export async function readAnnouncementForDelivery(deps: Pick<MessagingDeps, "db" | "clock" | "audit" | "ports" | "config" | "newId" | "logger">, ctx: RequestContext, announcementId: string): Promise<Result<AnnouncementDeliveryView | null, AppError>> {
  return inTx(
    deps as MessagingDeps,
    ctx,
    async (tx) => {
      const a = await repo.getAnnouncement(tx, ctx.tenantId, announcementId);
      if (!a || a.status !== "PUBLISHED") return ok(null);
      const firstLine = a.body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
      const recipients = await repo.listRecipientIds(tx, ctx.tenantId, announcementId);
      return ok({ title: a.title, summary: firstLine ? firstLine.slice(0, 300) : null, priority: a.priority, recipientUserIds: recipients.slice(0, DELIVERY_FEED_MAX_RECIPIENTS) });
    },
    { readOnly: true },
  );
}
