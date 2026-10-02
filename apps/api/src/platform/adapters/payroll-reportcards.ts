/**
 * reportcards -> payroll : `PayslipDocumentPort` — le PDF d'un bulletin de paie VERSÉ. payroll fournit le contenu figé (snapshot
 * posé à l'arrêt du montant + versement) ; reportcards le scelle (hash, code, signature Ed25519), le fait rendre par le worker,
 * le stocke et l'inscrit dans l'index de la vérification publique. Idempotent par bulletin ; un rendu définitivement échoué est
 * redemandé à la requête suivante. Le contrôle d'accès (titulaire ou gestion) est fait par payroll AVANT cet appel.
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { OfficialDocumentInput, OfficialDocumentState, PayslipDocumentPort } from "../../modules/payroll";
import { readOfficialDocument, requestOfficialDocument, requestOfficialDocumentRender, type OfficialDocumentFile, type ReportcardsDeps } from "../../modules/reportcards";

const stateOf = (file: OfficialDocumentFile, statusOverride?: OfficialDocumentState["status"]): OfficialDocumentState => ({
  status: statusOverride ?? file.record.renderStatus,
  fileName: file.fileName,
  bytes: statusOverride ? null : file.bytes,
  verificationCode: file.record.verificationCode,
  pdfHash: file.record.pdfHash,
  lastError: file.record.lastError,
});

export function createPayrollPayslipDocuments(reportcards: ReportcardsDeps): PayslipDocumentPort {
  const read = (ctx: RequestContext, sourceId: string) => readOfficialDocument(reportcards, ctx, { kind: "PAYSLIP", sourceId });
  return {
    async fetchOrRequest(ctx: RequestContext, input: OfficialDocumentInput): Promise<Result<OfficialDocumentState, AppError>> {
      let file = await read(ctx, input.sourceId);
      if (!file.ok) return file;
      if (!file.value) {
        const requested = await requestOfficialDocument(reportcards, ctx, {
          kind: "PAYSLIP",
          sourceId: input.sourceId,
          title: input.title,
          issuedAt: input.issuedAt,
          content: input.content,
          context: input.context,
        });
        if (!requested.ok) return requested;
        file = await read(ctx, input.sourceId);
        if (!file.ok) return file;
        if (!file.value) return err(new InternalError("Le document du bulletin de paie est introuvable après sa demande.", { code: "payroll.document_missing" }));
      }
      const current = file.value;
      if (current.record.renderStatus === "FAILED") {
        const again = await requestOfficialDocumentRender(reportcards, ctx, { documentId: current.record.id });
        if (!again.ok) return again;
        return ok(stateOf(current, "PENDING"));
      }
      return ok(stateOf(current));
    },
  };
}
