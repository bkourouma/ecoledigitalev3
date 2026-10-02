/**
 * PDF d'un reçu : snapshot immuable du reçu -> document scellé et rendu par `reportcards` (port `documents`) -> octets ou
 * « en cours ». L'appelant a DÉJÀ contrôlé l'accès au reçu (gestion : `finance.receipt.read` ; famille : propriété de
 * l'apprenant) : ces fonctions ne décident de rien.
 *
 * Réponses : `RENDERED` (octets), `PENDING` / `RENDERING` (le worker travaille : réessayer), `FAILED` (le rendu a échoué
 * définitivement : la demande suivante le redemande). Chaque téléchargement abouti est audité.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { buildReceiptDocument } from "../domain/receipt-document";
import type { ReceiptRecord } from "../domain/records";
import type { OfficialDocumentState } from "./ports/documents";
import type { FinanceDeps } from "./deps";

export type ReceiptPdfAudience = "STAFF" | "GUARDIAN" | "SELF";

export async function getReceiptPdf(deps: FinanceDeps, ctx: RequestContext, receipt: ReceiptRecord, audience: ReceiptPdfAudience): Promise<Result<OfficialDocumentState, AppError>> {
  const learner = await deps.learners.getLearner(ctx, receipt.learnerId);
  const doc = buildReceiptDocument(receipt, learner);
  const state = await deps.documents.fetchOrRequest(ctx, doc);
  if (!state.ok) return state;
  if (state.value.status === "RENDERED") {
    await deps.db.run(ctx, (tx) =>
      deps.audit.record(tx, ctx, {
        action: "finance.receipt.downloaded",
        resourceType: "receipt",
        resourceId: receipt.id,
        after: { number: receipt.number, learnerId: receipt.learnerId, audience, verificationCode: state.value.verificationCode },
      }),
    );
  }
  return ok(state.value);
}
