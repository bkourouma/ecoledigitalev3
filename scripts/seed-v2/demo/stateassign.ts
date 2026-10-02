/**
 * Élèves affectés par l'État (pack Secondary) : dossier d'affectation enregistré par le secrétariat, VÉRIFIÉ par la direction
 * (séparation des tâches), facture scindée famille / État (sans perte), rapprochement, créance sur l'État attendue.
 * La passerelle réelle vers la plateforme de l'État n'existe pas : tout est saisi à la main (référence fictive).
 */
import type { Actor } from "../actors";
import { addDays, today, type DemoKit } from "./kit";

export async function seedStateAssigned(kit: DemoKit, input: { secretariat: Actor; studentId: string; enrollmentId: string; reference: string }): Promise<void> {
  const { ctx } = kit;
  const owner = ctx.owner;
  const tuition = ctx.data.tuitionFee;
  const stateShare = Math.round(tuition * 0.6);
  const parentShare = tuition - stateShare;

  const scholarship = await owner.post(
    "/api/v1/finance/scholarships",
    { learnerId: input.studentId, academicYear: ctx.data.yearCode, funderKind: "STATE", funderName: "État (démonstration)", reference: input.reference, coverage: { kind: "PERCENT", bps: 6000 } },
    201,
  );
  await owner.put(`/api/v1/finance/learners/${input.studentId}/funding`, { fundingType: "STATE_ASSIGNED", assignmentRef: input.reference }, 200);

  const rec = await input.secretariat.post(
    "/api/v1/stateassign/assignments",
    { enrollmentId: input.enrollmentId, reference: input.reference, issuedOn: today(), declaredStateAmount: stateShare, declaredParentAmount: parentShare },
    [200, 201],
  );
  await ctx.directeur.post(`/api/v1/stateassign/assignments/${rec.body.id}/verify`, { rowVersion: rec.body.rowVersion });

  const invoices = await owner.post(
    "/api/v1/finance/invoices/from-schedule",
    { learnerId: input.studentId, enrollmentId: input.enrollmentId, academicYear: ctx.data.yearCode, items: [{ feeCode: ctx.tuitionFeeCode }], issue: true },
    [200, 201],
    { "idempotency-key": `demo-state-tuition-${ctx.data.slug}` },
  );
  const list = invoices.body.invoices as Array<{ id: string; payerKind: string }>;
  if (list.length !== 2) throw new Error(`Facture scindée attendue (famille + État), reçu ${list.length}.`);
  await ctx.directeur.post(`/api/v1/stateassign/assignments/${rec.body.id}/reconcile`, {}, [200, 201]);
  await ctx.directeur.post(
    `/api/v1/stateassign/assignments/${rec.body.id}/receivables`,
    { label: "Versement unique de l'État (démonstration)", dueOn: addDays(today(), 45), expectedAmount: stateShare },
    [200, 201],
  );
  void scholarship;
  kit.count("stateAssignments", 1);
  kit.note(`Élèves affectés par l'État : 1 dossier vérifié (${stateShare} / ${parentShare} XOF), facture scindée, créance sur l'État ouverte (versement non reçu).`);
}
