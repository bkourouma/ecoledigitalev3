/**
 * PDF d'un bulletin de paie : snapshot immuable posé à l'arrêt du montant + versement -> document scellé et rendu par
 * `reportcards` (port `documents`) -> octets ou « en cours ».
 *
 * ACCÈS : identique à `GET /payslips/:id/data` — la gestion (`payroll.payslip.read`) ou le TITULAIRE (`payroll.payslip.read_own`,
 * propriété vérifiée par `authorizeRead` ; bulletin d'autrui : 404 uniforme). Un bulletin non versé n'a PAS de PDF officiel
 * (409 `payroll.payslip_not_paid`) : l'aperçu imprimable (`/data`, filigrane « NON VERSÉ ») reste disponible.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PayrollCodes, conflict, internalIntegrity, notFound } from "../domain/errors";
import { buildPayslipDocument } from "../domain/payslip-document";
import { type PayrollDeps } from "./deps";
import type { OfficialDocumentState } from "./ports";
import { getPayslipData, type ReadCaps } from "./queries";

export async function getPayslipPdf(deps: PayrollDeps, ctx: RequestContext, input: { payslipId: string; caps: ReadCaps }): Promise<Result<OfficialDocumentState, AppError>> {
  const data = await getPayslipData(deps, ctx, input);
  // 404 UNIFORME : le bulletin d'autrui (ou un brouillon que le titulaire ne peut pas lire) ne se distingue pas d'un bulletin
  // inexistant — aucun oracle d'existence sur la route de téléchargement.
  if (!data.ok) return data.error.kind === "forbidden" ? err(notFound("Bulletin de paie", input.payslipId)) : data;
  const d = data.value;
  if (d.status !== "PAID" || !d.final || !d.payment) {
    return err(conflict(PayrollCodes.payslipNotPaid, "Le PDF officiel n'est disponible qu'une fois le bulletin versé ; utilisez l'aperçu imprimable en attendant.", { status: d.status }));
  }
  if (d.intact === false || !d.snapshotHash) return err(internalIntegrity("Le snapshot du bulletin ne correspond plus à son empreinte : PDF refusé."));
  const documents = deps.ports.documents;
  if (!documents) {
    return err(conflict(PayrollCodes.portUnavailable, "Le rendu PDF des bulletins de paie n'est pas disponible (service de documents non branché).", { port: "documents" }));
  }
  const doc = buildPayslipDocument(d.document, d.snapshotHash, { paidAt: d.payment.paidAt, method: d.payment.method, reference: d.payment.reference });
  const state = await documents.fetchOrRequest(ctx, doc);
  if (!state.ok) return state;
  if (state.value.status === "RENDERED") {
    await deps.db.run(ctx, (tx) =>
      deps.audit.record(tx, ctx, { action: "payroll.payslip.pdf_downloaded", resourceType: "payslip", resourceId: input.payslipId, metadata: { verificationCode: state.value.verificationCode, holderAccess: input.caps.readOwn && !input.caps.readAll } }),
    );
  }
  return ok(state.value);
}
