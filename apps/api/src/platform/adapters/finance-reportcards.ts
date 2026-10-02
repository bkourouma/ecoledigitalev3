/**
 * finance -> reportcards : `LearnerStandingPort` — « l'élève a-t-il un impayé exigible ? », sans montant ni détail.
 * Alimente l'option `reportcard.block-unpaid` ; sans ce port, l'option échoue FERMÉ (aucun bulletin communiqué à tort).
 *
 * reportcards -> finance : `ReceiptDocumentPort` — le PDF d'un reçu. finance fournit le CONTENU figé du reçu (immuable) ;
 * reportcards le scelle (hash, code, signature Ed25519), le fait rendre par le worker, le stocke et l'inscrit dans l'index de la
 * vérification publique. Idempotent par reçu ; un rendu définitivement échoué est redemandé à la requête suivante. Le contrôle
 * d'accès (gestion ou famille liée) est fait par finance AVANT cet appel.
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { hasOverdueBalance, type FinanceDeps, type OfficialDocumentInput, type OfficialDocumentState, type ReceiptDocumentPort } from "../../modules/finance";
import { readOfficialDocument, requestOfficialDocument, requestOfficialDocumentRender, type LearnerStandingPort, type OfficialDocumentFile, type ReportcardsDeps } from "../../modules/reportcards";

export function createReportcardsLearnerStanding(finance: FinanceDeps): LearnerStandingPort {
  return {
    async hasOutstandingBalance(ctx, studentId) {
      const r = await hasOverdueBalance(finance, ctx, studentId);
      // Une lecture impossible n'autorise rien : l'erreur remonte (échec fermé côté reportcards).
      if (!r.ok) throw r.error;
      return r.value;
    },
  };
}

const stateOf = (file: OfficialDocumentFile, statusOverride?: OfficialDocumentState["status"]): OfficialDocumentState => ({
  status: statusOverride ?? file.record.renderStatus,
  fileName: file.fileName,
  bytes: statusOverride ? null : file.bytes,
  verificationCode: file.record.verificationCode,
  pdfHash: file.record.pdfHash,
  lastError: file.record.lastError,
});

export function createFinanceReceiptDocuments(reportcards: ReportcardsDeps): ReceiptDocumentPort {
  const read = (ctx: RequestContext, sourceId: string) => readOfficialDocument(reportcards, ctx, { kind: "RECEIPT", sourceId });
  return {
    async fetchOrRequest(ctx: RequestContext, input: OfficialDocumentInput): Promise<Result<OfficialDocumentState, AppError>> {
      let file = await read(ctx, input.sourceId);
      if (!file.ok) return file;
      if (!file.value) {
        const requested = await requestOfficialDocument(reportcards, ctx, {
          kind: "RECEIPT",
          sourceId: input.sourceId,
          title: input.title,
          issuedAt: input.issuedAt,
          content: input.content,
          context: input.context,
        });
        if (!requested.ok) return requested;
        file = await read(ctx, input.sourceId);
        if (!file.ok) return file;
        if (!file.value) return err(new InternalError("Le document du reçu est introuvable après sa demande.", { code: "finance.document_missing" }));
      }
      const current = file.value;
      if (current.record.renderStatus === "FAILED") {
        // Rendu définitivement échoué : une nouvelle demande le redemande (nouveau cycle de tentatives du worker).
        const again = await requestOfficialDocumentRender(reportcards, ctx, { documentId: current.record.id });
        if (!again.ok) return again;
        return ok(stateOf(current, "PENDING"));
      }
      return ok(stateOf(current));
    },
  };
}
