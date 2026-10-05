/**
 * FRAIS D'EXAMEN intégrés à l'inscription (Q-E13) sur base réelle : barème VIDE par défaut, obligation créée avec l'inscription, facture
 * demandée à `finance` par le port (idempotente, rejouable), statut de paiement relu en direct, candidat libre sans compte famille,
 * désinscription (annulation / remboursement manuel), isolation A/B. Le « finance » du test est le monde en mémoire (aucun montant réel).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { registerCandidate, withdrawCandidate } from "../../application/candidates";
import { onEnrollmentWithdrawn } from "../../application/consumers";
import { createExternalCandidate, type CreateExternalInput } from "../../application/external-candidates";
import { confirmRefund, getCandidateFee, listFeeItems, setFeeItems, syncCandidateFee, syncSessionFees } from "../../application/fees";
import { actOnPiece, listPieces } from "../../application/pieces";
import { evaluateEligibility } from "../../application/eligibility";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, prepareCandidate, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

const FEE_EXAM = "0192f0a4-7b1e-7c3a-8d2e-00000000f001";
const FEE_STUDENT_ONLY = "0192f0a4-7b1e-7c3a-8d2e-00000000f002";
const FEE_UNKNOWN = "0192f0a4-7b1e-7c3a-8d2e-00000000f099";

const free = (n: number): CreateExternalInput => ({
  identity: { lastName: `PAYEUR${n}`, firstName: "Libre", birthDate: "2015-03-04", birthPlace: "Bouaké", sex: "F" },
  profile: { contactPhone: `+22507010${String(n).padStart(4, "0")}`, guardianName: "Tuteur Fictif", declaredInExamGrade: true, declaredPriorAttempts: 0 },
});

describeIntegration("examinations : frais d'examen intégrés à l'inscription (Q-E13)", () => {
  let env: Env;
  let typeId: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    await seedPack(env, env.ctxB());
    typeId = (await env.db.admin.query("SELECT id FROM examinations.exam_types WHERE tenant_id = $1 AND code = 'CEPE'", [env.tenantA])).rows[0].id as string;
    // Catalogue EXAMS de la finance de test (libellés et montants FICTIFS ; en production : catalogue et barèmes de `finance`).
    env.world.feeCatalog.set(FEE_EXAM, { feeId: FEE_EXAM, code: "EXAM-FICTIF", label: "Frais d'examen (fictif)", currency: "XOF", active: true, amountMinor: 10_000 });
    env.world.feeCatalog.set(FEE_STUDENT_ONLY, { feeId: FEE_STUDENT_ONLY, code: "DOSSIER-FICTIF", label: "Frais de dossier élève (fictif)", currency: "XOF", active: true, amountMinor: 2_500 });
  });
  afterAll(async () => {
    await env?.drop();
  });

  const feeRow = async (candidateId: string) => (await env.db.admin.query("SELECT status, invoice_id, last_error_code, total_minor::int AS total, lines FROM examinations.candidate_fees WHERE candidate_id = $1", [candidateId])).rows[0];

  it("le barème est VIDE par défaut : l'inscription crée une obligation sans objet et ne demande aucune facture", async () => {
    expect(unwrap(await listFeeItems(env.deps(), env.ctxA(), typeId))).toEqual([]);
    const session = await openSession(env, "CEPE-FRAIS-0");
    const { pupils } = addPupils(env, 1);
    const reg = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    expect(await feeRow(reg.candidateId)).toMatchObject({ status: "NOT_APPLICABLE", invoice_id: null });
    expect(env.world.issueCalls).toEqual([]);
    const dto = unwrap(await getCandidateFee(env.deps(), env.ctxA(), reg.candidateId));
    expect(dto).toMatchObject({ status: "NOT_APPLICABLE", payment: { status: "NONE", paidMinor: null }, totalMinor: null, lines: [] });
  });

  it("barème : seuls les frais du catalogue EXAMS de la finance sont acceptés (échec fermé sans finance), un frais ne figure qu'une fois", async () => {
    const unknown = await setFeeItems(env.deps(), env.ctxA(), typeId, { items: [{ feeId: FEE_UNKNOWN, appliesTo: "ALL", active: true }] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("examinations.fee_item_invalid");
    const dup = await setFeeItems(env.deps(), env.ctxA(), typeId, { items: [{ feeId: FEE_EXAM, appliesTo: "ALL", active: true }, { feeId: FEE_EXAM, appliesTo: "STUDENT", active: true }] });
    expect(dup.ok).toBe(false);
    env.world.feesFailure = "finance indisponible";
    const down = await setFeeItems(env.deps(), env.ctxA(), typeId, { items: [{ feeId: FEE_EXAM, appliesTo: "ALL", active: true }] });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error.code).toBe("examinations.port_unavailable");
    env.world.feesFailure = null;
    const items = unwrap(await setFeeItems(env.deps(), env.ctxA(), typeId, { items: [{ feeId: FEE_EXAM, appliesTo: "ALL", active: true }, { feeId: FEE_STUDENT_ONLY, appliesTo: "STUDENT", active: true }] }));
    expect(items.map((i) => [i.feeId, i.appliesTo, i.label])).toEqual([[FEE_EXAM, "ALL", "Frais d'examen (fictif)"], [FEE_STUDENT_ONLY, "STUDENT", "Frais de dossier élève (fictif)"]]);
    const audit = env.audit.entries.find((e) => e.entry.action === "examinations.fee_items.set")!;
    expect(audit.entry.sensitive).toBe(true);
  });

  it("à l'inscription d'un ÉLÈVE : obligation créée dans la transaction, facture demandée à finance (clé d'idempotence), instantané des lignes et du total", async () => {
    const session = await openSession(env, "CEPE-FRAIS-1");
    const { pupils } = addPupils(env, 2);
    const before = env.world.issueCalls.length;
    const reg = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    expect(env.world.issueCalls.length).toBe(before + 1);
    expect(env.world.issueCalls.at(-1)).toEqual({ candidateId: reg.candidateId, payerKind: "STUDENT", feeIds: [FEE_EXAM, FEE_STUDENT_ONLY], idempotencyKey: `exam-fee-${reg.candidateId}` });
    const row = await feeRow(reg.candidateId);
    expect(row).toMatchObject({ status: "INVOICED", total: 12_500, last_error_code: null });
    expect(row.lines).toEqual([
      { feeId: FEE_EXAM, label: "Frais d'examen (fictif)", amountMinor: 10_000 },
      { feeId: FEE_STUDENT_ONLY, label: "Frais de dossier élève (fictif)", amountMinor: 2_500 },
    ]);
    // statut de paiement RELU EN DIRECT (jamais copié)
    const dto = unwrap(await getCandidateFee(env.deps(), env.ctxA(), reg.candidateId));
    expect(dto).toMatchObject({ status: "INVOICED", totalMinor: 12_500, currency: "XOF", payment: { status: "UNPAID", paidMinor: 0 } });
    expect(dto.invoiceNumber).toMatch(/^FAC-/);
    const invoice = env.world.invoices.get(dto.invoiceId as string)!;
    invoice.paidMinor = 5_000;
    expect(unwrap(await getCandidateFee(env.deps(), env.ctxA(), reg.candidateId)).payment).toEqual({ status: "PARTIAL", paidMinor: 5_000 });
    invoice.paidMinor = 12_500;
    expect(unwrap(await getCandidateFee(env.deps(), env.ctxA(), reg.candidateId)).payment).toEqual({ status: "PAID", paidMinor: 12_500 });
    // finance injoignable à la lecture : « inconnu », jamais « payé » par défaut
    env.world.feesFailure = "finance indisponible";
    expect(unwrap(await getCandidateFee(env.deps(), env.ctxA(), reg.candidateId)).payment).toEqual({ status: "UNKNOWN", paidMinor: null });
    env.world.feesFailure = null;
    // la colonne de paiement n'existe pas en base : rien à désynchroniser
    const cols = await env.db.admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'examinations' AND table_name = 'candidate_fees' AND column_name ~ 'paid|payment'");
    expect(cols.rows).toEqual([]);
  });

  it("IDEMPOTENCE et reprise : finance indisponible à l'inscription -> inscription maintenue, obligation à facturer avec son code ; la reprise facture UNE fois", async () => {
    const session = await openSession(env, "CEPE-FRAIS-2");
    const { pupils } = addPupils(env, 1);
    env.world.feesFailure = "finance indisponible";
    const c = await prepareCandidate(env, env.ctxA(), session.id, pupils[0]!);
    const registered = unwrap(await registerCandidate(env.deps(), env.ctxA(), c));
    expect(registered.registrationStatus).toBe("REGISTERED");
    expect(registered.candidateNumber).toMatch(/^CEPE2027-/);
    expect(await feeRow(c)).toMatchObject({ status: "PENDING_INVOICE", invoice_id: null, last_error_code: "examinations.port_unavailable" });
    // la reprise échoue tant que finance est indisponible, l'obligation reste intacte
    const still = await syncCandidateFee(env.deps(), env.ctxA(), c);
    expect(still.ok).toBe(false);
    env.world.feesFailure = null;
    const calls = env.world.issueCalls.length;
    const synced = unwrap(await syncCandidateFee(env.deps(), env.ctxA(), c));
    expect(synced.status).toBe("INVOICED");
    // rejouer ne refacture pas : un seul appel de plus, une seule facture pour ce candidat
    unwrap(await syncCandidateFee(env.deps(), env.ctxA(), c));
    unwrap(await syncCandidateFee(env.deps(), env.ctxA(), c));
    expect(env.world.issueCalls.length).toBe(calls + 1);
    expect([...env.world.invoices.values()].filter((i) => i.idempotencyKey === `exam-fee-${c}`)).toHaveLength(1);
    // et un rejeu direct du port avec la même clé rend la même facture
    const again = unwrap(await env.deps().ports.fees.issueInvoice(env.ctxA(), { candidateId: c, payer: { kind: "STUDENT", studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }, feeIds: [FEE_EXAM, FEE_STUDENT_ONLY], idempotencyKey: `exam-fee-${c}` }));
    expect(again).toMatchObject({ mode: "INVOICED", invoiceId: synced.invoiceId });
  });

  it("CANDIDAT LIBRE : frais applicables à son régime seulement ; sans compte famille, facture à établir (aucune donnée personnelle transmise)", async () => {
    const session = await openSession(env, "CEPE-FRAIS-3");
    const dto = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), session.id, free(1)));
    const pieces = unwrap(await listPieces(env.deps(), env.ctxA(), dto.id));
    for (const p of pieces.pieces.filter((x) => x.required)) {
      unwrap(await actOnPiece(env.deps(), env.ctxA(), dto.id, p.requirementId, { action: "SIGHT" }));
      unwrap(await actOnPiece(env.deps(), env.ctxA(), dto.id, p.requirementId, { action: "ACCEPT" }));
    }
    unwrap(await evaluateEligibility(env.deps(), env.ctxA(), dto.id, { mode: "EVALUATE" }));
    unwrap(await registerCandidate(env.deps(), env.ctxA(), dto.id));
    const row = await feeRow(dto.id);
    // FEE_STUDENT_ONLY ne s'applique pas à un libre ; FEE_EXAM (ALL) oui
    expect(row.status).toBe("AWAITING_MANUAL_INVOICE");
    expect(row.lines).toEqual([{ feeId: FEE_EXAM, label: "Frais d'examen (fictif)", amountMinor: null }]);
    expect(env.world.issueCalls.at(-1)).toEqual({ candidateId: dto.id, payerKind: "EXTERNAL", feeIds: [FEE_EXAM], idempotencyKey: `exam-fee-${dto.id}` });
    expect(JSON.stringify(env.world.issueCalls.at(-1))).not.toMatch(/PAYEUR|Tuteur|\+225|Libre|Bouaké/);
    const view = unwrap(await getCandidateFee(env.deps(), env.ctxA(), dto.id));
    expect(view).toMatchObject({ status: "AWAITING_MANUAL_INVOICE", payerKind: "EXTERNAL", invoiceId: null, totalMinor: null, payment: { status: "NONE" } });
    expect(view.note).toMatch(/comptabilité/);
    // désinscription avant facturation réelle : rien à rembourser
    unwrap(await withdrawCandidate(env.deps(), env.ctxA(), dto.id, "Désistement du candidat"));
    expect(await feeRow(dto.id)).toMatchObject({ status: "CANCELLED" });
  });

  it("DÉSINSCRIPTION : facture non encaissée annulée ; facture ENCAISSÉE -> remboursement manuel signalé puis confirmé (sensible, audité)", async () => {
    const session = await openSession(env, "CEPE-FRAIS-4");
    const { pupils } = addPupils(env, 2);
    const unpaid = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const paid = await registerPupil(env, env.ctxA(), session.id, pupils[1]!);
    const invoiceOf = async (candidateId: string) => env.world.invoices.get((await feeRow(candidateId)).invoice_id as string)!;
    (await invoiceOf(paid.candidateId)).paidMinor = 12_500;

    unwrap(await withdrawCandidate(env.deps(), env.ctxA(), unpaid.candidateId, "Départ de l'établissement"));
    expect(await feeRow(unpaid.candidateId)).toMatchObject({ status: "CANCELLED" });
    expect((await invoiceOf(unpaid.candidateId)).status).toBe("CANCELLED");

    unwrap(await withdrawCandidate(env.deps(), env.ctxA(), paid.candidateId, "Départ de l'établissement"));
    expect(await feeRow(paid.candidateId)).toMatchObject({ status: "REFUND_DUE" });
    expect((await invoiceOf(paid.candidateId)).status).not.toBe("CANCELLED"); // une facture encaissée n'est JAMAIS annulée
    const due = unwrap(await getCandidateFee(env.deps(), env.ctxA(), paid.candidateId));
    expect(due).toMatchObject({ status: "REFUND_DUE", payment: { status: "PAID" } });
    expect(due.note).toMatch(/remboursement manuel/i);

    const early = await confirmRefund(env.deps(), env.ctxA(), unpaid.candidateId, "Remboursé en caisse");
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.code).toBe("examinations.fee_state");
    expect((await confirmRefund(env.deps(), env.ctxA(), paid.candidateId, "ok")).ok).toBe(false); // note de 5 caractères au moins
    expect(await feeRow(paid.candidateId)).toMatchObject({ status: "REFUND_DUE" });
    const done = unwrap(await confirmRefund(env.deps(), env.ctxA(), paid.candidateId, "Remboursé en caisse le jour même"));
    expect(done.status).toBe("REFUND_DONE");
    expect(done.refundConfirmedAt).not.toBeNull();
    const audits = env.audit.entries.filter((e) => e.entry.action === "examinations.fee.refund_done" || e.entry.action === "examinations.fee.refund_due");
    expect(audits.map((a) => a.entry.sensitive)).toEqual([true, true]);
    for (const a of env.audit.entries.filter((e) => e.entry.action.startsWith("examinations.fee"))) expect(JSON.stringify(a.entry)).not.toMatch(/ELEVE|Prénom/);
  });

  it("retrait automatique (inscription scolaire retirée) : le candidat est retiré et sa facture non encaissée est annulée", async () => {
    const session = await openSession(env, "CEPE-FRAIS-5");
    const { pupils } = addPupils(env, 1);
    const reg = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const r = unwrap(await onEnrollmentWithdrawn(env.deps(), env.tenantA, { enrollmentId: pupils[0]!.enrollmentId, studentId: pupils[0]!.studentId }));
    expect(r.affected).toBe(1);
    expect(await feeRow(reg.candidateId)).toMatchObject({ status: "CANCELLED" });
  });

  it("reprise en lot d'une session : les obligations en attente sont facturées, un candidat retiré encore facturé est soldé", async () => {
    const session = await openSession(env, "CEPE-FRAIS-6");
    const { pupils } = addPupils(env, 2);
    env.world.feesFailure = "finance indisponible";
    const a = await registerPupil(env, env.ctxA(), session.id, pupils[0]!);
    const b = await registerPupil(env, env.ctxA(), session.id, pupils[1]!);
    expect((await feeRow(a.candidateId)).status).toBe("PENDING_INVOICE");
    const failed = unwrap(await syncSessionFees(env.deps(), env.ctxA(), session.id));
    expect(failed).toMatchObject({ settled: 0, stillPending: 2 });
    env.world.feesFailure = null;
    unwrap(await withdrawCandidate(env.deps(), env.ctxA(), b.candidateId, "Départ de l'établissement"));
    expect((await feeRow(b.candidateId)).status).toBe("CANCELLED"); // jamais facturé : annulé sans appel à finance
    const ok = unwrap(await syncSessionFees(env.deps(), env.ctxA(), session.id));
    expect(ok).toMatchObject({ settled: 1, stillPending: 0, failed: [] });
    expect((await feeRow(a.candidateId)).status).toBe("INVOICED");
  });

  it("session blanche : aucune obligation ; ISOLATION A/B : le tenant B ne voit ni le barème, ni les obligations de A", async () => {
    const mock = await openSession(env, "CEPE-FRAIS-BLANC", { kind: "MOCK" });
    const { pupils } = addPupils(env, 1);
    const m = await registerPupil(env, env.ctxA(), mock.id, pupils[0]!, { official: false });
    expect(await feeRow(m.candidateId)).toBeUndefined();
    const nofee = await getCandidateFee(env.deps(), env.ctxA(), m.candidateId);
    expect(nofee.ok).toBe(false);
    if (!nofee.ok) expect(nofee.error.code).toBe("examinations.fee_not_found");

    const some = (await env.db.admin.query("SELECT candidate_id FROM examinations.candidate_fees WHERE tenant_id = $1 AND status = 'INVOICED' LIMIT 1", [env.tenantA])).rows[0].candidate_id as string;
    const asB = await getCandidateFee(env.deps(), env.ctxB(), some);
    expect(asB.ok).toBe(false);
    if (!asB.ok) expect(asB.error.code).toBe("examinations.candidate_not_found");
    const itemsB = await listFeeItems(env.deps(), env.ctxB(), typeId);
    expect(itemsB.ok).toBe(false);
    const setB = await setFeeItems(env.deps(), env.ctxB(), typeId, { items: [] });
    expect(setB.ok).toBe(false);
    const rowsB = await env.deps().db.run(env.ctxB(), (tx) => tx.many("SELECT candidate_id FROM examinations.candidate_fees"), { readOnly: true });
    expect(rowsB).toEqual([]);
    const itemsRowsB = await env.deps().db.run(env.ctxB(), (tx) => tx.many("SELECT id FROM examinations.exam_fee_items"), { readOnly: true });
    expect(itemsRowsB).toEqual([]);
    void newId;
  });
});
