/**
 * Import vers `finance` : soldes financiers d'OUVERTURE — factures de reprise et avoirs de reprise, montants ENTIERS en
 * francs CFA (XOF). Écriture EXCLUSIVEMENT par `finance.createInvoice` (émise, avec clé d'idempotence dérivée de la
 * référence) et `finance.issueCreditNote`, donc avec la numérotation, les contrôles, l'audit et les événements de `finance`.
 *
 * Les montants arrivent en entiers (le fichier refuse les décimales dès la lecture) : aucun arrondi, aucune conversion.
 * Un document financier ne se modifie pas : la politique « mettre à jour » n'existe pas pour cet importeur ; un rejeu du même
 * fichier est neutre (clé d'idempotence de la facture ; référence d'idempotence de l'import pour les avoirs).
 */
import { createHash } from "node:crypto";
import { Money, type RequestContext } from "@ecoledigitale/kernel";
import { createInvoice, issueCreditNote } from "../../modules/finance";
import type { ApplyItem, ApplyResult, BalanceRow, ImportTargetPort, PlanItem, PlanResult, PlanRun } from "../../modules/imports";
import { resolveStudentRefs } from "../../modules/people";
import { issue, issuesFromError, type ImportWriteEnv } from "./imports-support";

const norm = (s: string): string => s.trim().toUpperCase();
/** Clé d'idempotence d'une facture de reprise : stable pour un tenant, une référence et un contenu (8 à 100 caractères). */
const invoiceKey = (reference: string): string => `imp-ob-${createHash("sha256").update(norm(reference)).digest("hex").slice(0, 40)}`;

export function createOpeningBalancesImportPort(env: ImportWriteEnv): ImportTargetPort<BalanceRow> {
  async function students(ctx: RequestContext, refs: readonly string[]) {
    const r = await resolveStudentRefs(env.people, ctx, refs);
    return new Map((r.ok ? r.value : []).map((m) => [norm(m.ref), m.studentId]));
  }
  const academicYearOf = (row: BalanceRow, run: PlanRun): string => row.academicYear ?? String(run.options["academicYear"]).trim();

  return {
    async plan(ctx, items: readonly PlanItem<BalanceRow>[], run: PlanRun): Promise<PlanResult[]> {
      const ids = await students(ctx, items.map((i) => i.row.studentRef));
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const issues = [];
        if (!ids.has(norm(row.studentRef))) issues.push(issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} » (importez d'abord les élèves).`));
        if ((row.kind ?? "INVOICE") === "CREDIT_NOTE") {
          const target = Object.values(item.related)[0];
          const inFile = item.inFileDependencies.size > 0;
          if (!target && !inFile) issues.push(issue("invoiceRef", "imports.reference_unknown", `La facture de reprise « ${row.invoiceRef} » est inconnue : importez-la avant (ou plus haut dans ce fichier).`));
        }
        if (issues.length > 0) out.push({ rowNo: item.rowNo, action: "ERROR", issues });
        else if (item.knownEntityId) out.push({ rowNo: item.rowNo, action: "SKIP", entityId: item.knownEntityId, issues: [issue(null, "imports.already_imported", "Cette référence a déjà été importée : ligne ignorée.", "WARNING")] });
        else {
          void run;
          out.push({ rowNo: item.rowNo, action: "CREATE", issues });
        }
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<BalanceRow>, run: PlanRun): Promise<ApplyResult> {
      const row = item.row;
      const ids = await students(ctx, [row.studentRef]);
      const learnerId = ids.get(norm(row.studentRef));
      if (!learnerId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ».`)] };
      const amount = Money.of(row.amount, "XOF");
      if ((row.kind ?? "INVOICE") === "CREDIT_NOTE") {
        const invoiceId = Object.values(item.related)[0];
        if (!invoiceId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("invoiceRef", "imports.reference_unknown", `La facture de reprise « ${row.invoiceRef} » est introuvable.`)] };
        const r = await issueCreditNote(env.finance, ctx, { invoiceId, amount, reason: row.reason ?? "Avoir de reprise" });
        return r.ok ? { rowNo: item.rowNo, outcome: "CREATED", entityId: r.value.creditNote.id, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
      }
      const r = await createInvoice(env.finance, ctx, {
        learnerId,
        academicYear: academicYearOf(row, run),
        lines: [{ category: "OTHER", description: row.description ?? "Reprise du solde d'ouverture", quantity: 1, unitAmount: amount }],
        ...(row.dueDate ? { dueDate: row.dueDate } : {}),
        issue: true,
        idempotencyKey: invoiceKey(row.reference),
      });
      if (!r.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
      const invoice = r.value.invoices[0];
      if (!invoice) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "imports.write_failed", "Aucune facture produite.")] };
      return { rowNo: item.rowNo, outcome: r.value.replayed ? "SKIPPED" : "CREATED", entityId: invoice.invoice.id, issues: [] };
    },
  };
}
