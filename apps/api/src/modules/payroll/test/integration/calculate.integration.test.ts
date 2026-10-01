/**
 * Calcul de la paie sur Postgres réel (spec 032 US2-US5, T1-T12) : bulletin, lignes, réclamations, compte rendu
 * conservé, écartés nommés, recalcul idempotent, primes préservées, périodes chevauchantes, ports en échec.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { calculatePeriod } from "../../application/calculate";
import { adjustPayslip, approvePayslips, cancelPayslip } from "../../application/workflow";
import { createPeriod, setPeriodStatus } from "../../application/periods";
import { getRun } from "../../application/queries";
import { createHourlyRate, createPayConfig } from "../../application/configs";
import { createPayrollDeps } from "../../application/deps";
import { PayrollCodes } from "../../domain/errors";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addRate, addStaff, attendance, createWorld, expectErr, payslipRows, releasePending, session, tenantRows, unwrap, type World } from "../support/world";

describeIntegration("calcul de la paie (Postgres réel)", () => {
  let db: PayrollTestDb;
  let w: World;

  beforeAll(async () => {
    db = await createPayrollTestDb(24);
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (): Promise<World> => {
    w = await createWorld({ db });
    return w;
  };
  const calc = async (periodId: string, extra: Record<string, unknown> = {}) => unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId, ...extra }));
  const item = (report: Awaited<ReturnType<typeof calc>>, staffId: string) => report.items.find((i) => i.staffId === staffId);

  it("T1 — un horaire, 6 h validées à 10 000 F/h : bulletin 60 000 F, lignes, réclamations, compte rendu conservé", async () => {
    await fresh();
    const awa = addStaff(w, "Awa Sanogo");
    await addConfig(w, { staffId: awa, defaultHourlyRate: 10_000 });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(awa, "2026-01-06", 150), session(awa, "2026-01-08", 210));

    const report = await calc(period.id);
    expect(report).toMatchObject({ dryRun: false, calculated: 1, skipped: 0, locked: 0, failed: 0 });
    const it1 = item(report, awa);
    expect(it1).toMatchObject({ outcome: "CALCULATED", staffName: "Awa Sanogo", total: expect.anything() });
    expect(it1?.total?.amount).toBe(60_000);

    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ status: "CALCULATED", payslip_kind: "HOURLY", total_amount: "60000", base_amount: "60000", overtime_amount: "0", regular_minutes: 360, overtime_minutes: 0, currency: "XOF" });
    expect(p?.calculated_by_name).toBe("Comptable Test");
    expect(await adminRows(db, "SELECT amount::int AS a, minutes FROM payroll.payslip_lines WHERE payslip_id=$1 ORDER BY position", [p?.id])).toEqual([
      { a: 25_000, minutes: 150 },
      { a: 35_000, minutes: 210 },
    ]);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE payslip_id=$1", [p?.id])).length).toBe(2);
    // la période n'est plus « en attente de calcul » et passe ACTIVE
    expect(await adminRows(db, "SELECT status, awaiting_calculation FROM payroll.pay_periods WHERE id=$1", [period.id])).toEqual([{ status: "ACTIVE", awaiting_calculation: false }]);

    // compte rendu CONSERVÉ et relisible après coup (constat 4 de la recette S17-T)
    const stored = unwrap(await getRun(w.deps, w.ctxOf(), report.runId as string));
    expect(stored.run).toMatchObject({ status: "COMPLETED", calculated: 1, skipped: 0 });
    expect(stored.items.map((i) => [i.staffName, i.outcome, i.totalAmount?.amount])).toEqual([["Awa Sanogo", "CALCULATED", 60_000]]);

    // audit et événements dans la même transaction
    expect(w.audit.actions()).toEqual(expect.arrayContaining(["payroll.period.created", "payroll.config.created", "payroll.payslip.calculated", "payroll.run.completed"]));
    const events = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE tenant_id=$1 ORDER BY occurred_at, id", [w.tenantId]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["payroll.period.created", "payroll.payslip.calculated", "payroll.run.completed"]));
  });

  it("T2 — un enseignant mixte (4 h de présences + 3 h de séances) : UN seul bulletin de 7 h, chaque ligne porte son origine", async () => {
    await fresh();
    const marc = addStaff(w, "Marc Mixte");
    await addConfig(w, { staffId: marc, type: "HOURLY", defaultHourlyRate: 10_000 });
    const period = await addPeriod(w);
    w.mem.attendance.add(attendance(marc, "2026-01-12", 240));
    w.mem.sessions.add(session(marc, "2026-01-13", 180));
    await calc(period.id);
    const slips = await payslipRows(w);
    expect(slips).toHaveLength(1);
    const lines = await adminRows<{ source_kind: string; minutes: number }>(db, "SELECT source_kind, minutes FROM payroll.payslip_lines WHERE payslip_id=$1 ORDER BY position", [slips[0]?.id]);
    expect(lines.map((l) => [l.source_kind, l.minutes])).toEqual([["ATTENDANCE", 240], ["SESSION", 180]]);
    expect(slips[0]?.regular_minutes).toBe(420);
    // T18 : Σ présences + Σ séances + hors-heures = total
    const b = await tenantRows<Record<string, string>>(w, "SELECT attendance_amount::text a, session_amount::text s, out_of_hours_amount::text o, total_amount::text t FROM payroll.v_payslip_breakdown WHERE payslip_id=$1", [slips[0]?.id]);
    expect(Number(b[0]?.a) + Number(b[0]?.s) + Number(b[0]?.o)).toBe(Number(b[0]?.t));
    expect([b[0]?.a, b[0]?.s, b[0]?.o]).toEqual(["40000", "30000", "0"]);
  });

  it("T3 — un salarié : montant inchangé par ses séances, listées à titre informatif sans ligne ni réclamation", async () => {
    await fresh();
    const diallo = addStaff(w, "Aissatou Diallo");
    await addConfig(w, { staffId: diallo, type: "SALARY", monthlySalary: 400_000, defaultHourlyRate: null });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(diallo, "2026-01-20", 120));
    await calc(period.id);
    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ payslip_kind: "SALARY", total_amount: "363636", salary_amount: "363636", base_amount: "363636" });
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslip_lines WHERE payslip_id=$1", [p?.id])).length).toBe(0);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE payslip_id=$1", [p?.id])).length).toBe(0);
    expect((await adminRows(db, "SELECT 1 FROM payroll.salary_day_claims WHERE payslip_id=$1", [p?.id])).length).toBe(20);
    expect(p?.calc_details.informationalMinutes).toBe(120);
  });

  it("T4/T8 — heures non payables, sans configuration, sans heure, sans tarif : écartés ET NOMMÉS, jamais absents en silence", async () => {
    await fresh();
    const ok = addStaff(w, "Awa Ok");
    const noConfig = addStaff(w, "Ibrahim Koné");
    const noHours = addStaff(w, "Victor Sansheure");
    const noRate = addStaff(w, "Nora Sanstarif");
    const unvalidated = addStaff(w, "Uriel Nonvalidé");
    await addConfig(w, { staffId: ok, defaultHourlyRate: 10_000 });
    await addConfig(w, { staffId: noHours, defaultHourlyRate: 7000 });
    await addConfig(w, { staffId: noRate, defaultHourlyRate: null });
    await addConfig(w, { staffId: unvalidated, defaultHourlyRate: 5000 });
    const period = await addPeriod(w);
    w.mem.sessions.add(
      session(ok, "2026-01-06", 60),
      session(ok, "2026-01-07", 60, { realized: false }), // planifiée/annulée : aucun montant
      session(ok, "2026-01-07", 60, { staffId: null }), // sans enseignant
      session(ok, "2026-01-08", 60, { startTime: null, endTime: null }), // sans durée
      session(noConfig, "2026-01-06", 60),
      session(noRate, "2026-01-06", 60),
      session(unvalidated, "2026-01-06", 60, { validated: false }),
    );
    const r = await calc(period.id);
    expect(item(r, ok)).toMatchObject({ outcome: "CALCULATED" });
    expect(item(r, ok)?.total?.amount).toBe(10_000); // une seule heure payable sur quatre
    expect(item(r, noConfig)).toMatchObject({ outcome: "SKIPPED", skipReason: "NO_CONFIG", staffName: "Ibrahim Koné" });
    expect(item(r, noHours)).toMatchObject({ outcome: "SKIPPED", skipReason: "NO_HOURS" });
    expect(item(r, noRate)).toMatchObject({ outcome: "SKIPPED", skipReason: "NO_RATE_RESOLVED" });
    expect(item(r, noRate)?.message).toMatch(/Aucun tarif applicable/);
    expect(item(r, unvalidated)).toMatchObject({ outcome: "SKIPPED", skipReason: "NO_HOURS" });
    expect(item(r, unvalidated)?.message).toMatch(/1 séance\(s\) réalisée\(s\) non validée\(s\)/); // le cas dangereux : l'oubli de validation
    // écartés = aucun bulletin
    expect(await payslipRows(w)).toHaveLength(1);
    // conservés avec leur motif
    const stored = unwrap(await getRun(w.deps, w.ctxOf(), r.runId as string));
    expect(stored.items.filter((i) => i.outcome === "SKIPPED").map((i) => i.skipReason).sort()).toEqual(["NO_CONFIG", "NO_HOURS", "NO_HOURS", "NO_RATE_RESOLVED"]);
  });

  it("T5 — recalculer deux fois donne un résultat strictement identique (mêmes montants, mêmes lignes, aucun doublon)", async () => {
    await fresh();
    const s = addStaff(w, "Idem Potent");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 90), session(s, "2026-01-07", 45));
    await calc(period.id);
    const snapshotOf = async () => ({
      payslips: await adminRows(db, "SELECT id, total_amount::text t, row_version FROM payroll.payslips WHERE tenant_id=$1", [w.tenantId]),
      lines: await adminRows(db, "SELECT source_ref_id, minutes, amount::text a, position FROM payroll.payslip_lines WHERE tenant_id=$1 ORDER BY position", [w.tenantId]),
      claims: await adminRows(db, "SELECT source_ref_id, minutes FROM payroll.hour_claims WHERE tenant_id=$1 ORDER BY source_ref_id", [w.tenantId]),
    });
    const before = await snapshotOf();
    // sans « recalculer » : rien n'est réécrit, signalé
    const again = await calc(period.id);
    expect(item(again, s)).toMatchObject({ outcome: "SKIPPED", skipReason: "ALREADY_CALCULATED" });
    expect(await snapshotOf()).toEqual(before);
    // avec « recalculer » : même résultat, aucune ligne en double
    await calc(period.id, { recalculate: true });
    await calc(period.id, { recalculate: true });
    const after = await snapshotOf();
    expect(after.payslips.map((p) => [p.id, p.t])).toEqual(before.payslips.map((p) => [p.id, p.t]));
    expect(after.lines).toEqual(before.lines);
    expect(after.claims).toEqual(before.claims);
    expect(after.payslips[0]?.row_version).toBeGreaterThan(before.payslips[0]?.row_version);
    const events = await adminRows<{ action: string }>(db, "SELECT action FROM payroll.payslip_events WHERE tenant_id=$1 ORDER BY occurred_at, id", [w.tenantId]);
    expect(events.map((e) => e.action)).toEqual(["CALCULATED", "RECALCULATED", "RECALCULATED"]);
  });

  it("bogue corrigée — le recalcul CONSERVE les primes et retenues saisies (le legacy les remettait à 0)", async () => {
    await fresh();
    const awa = addStaff(w, "Awa Sanogo");
    await addConfig(w, { staffId: awa });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(awa, "2026-01-06", 330));
    await calc(period.id);
    const [p] = await payslipRows(w);
    unwrap(await adjustPayslip(w.deps, w.ctxOf(), { payslipId: p?.id, add: [{ kind: "BONUS", amount: 5000, label: "Prime d'assiduité" }, { kind: "DEDUCTION", amount: 2000, label: "Avance", reason: "Acompte de décembre" }] }));
    expect((await payslipRows(w))[0]).toMatchObject({ bonus_amount: "5000", deduction_amount: "2000", total_amount: "58000" });
    // des heures s'ajoutent, on recalcule : le montant des heures change, primes et retenues restent
    w.mem.sessions.add(session(awa, "2026-01-08", 60));
    const r = await calc(period.id, { recalculate: true });
    expect(item(r, awa)?.total?.amount).toBe(55_000 + 10_000 + 5000 - 2000);
    expect((await payslipRows(w))[0]).toMatchObject({ bonus_amount: "5000", deduction_amount: "2000", total_amount: "68000", base_amount: "65000" });
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslip_adjustments WHERE payslip_id=$1", [p?.id])).length).toBe(2);
  });

  it("des retenues supérieures au nouveau montant : l'enseignant est signalé FAILED, jamais un total négatif ni des ajustements effacés", async () => {
    await fresh();
    const s = addStaff(w, "Retenue Forte");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    const h = session(s, "2026-01-06", 60);
    w.mem.sessions.add(h);
    await calc(period.id);
    const [p] = await payslipRows(w);
    unwrap(await adjustPayslip(w.deps, w.ctxOf(), { payslipId: p?.id, add: [{ kind: "DEDUCTION", amount: 9000, label: "Avance" }] }));
    w.mem.sessions.clear(); // plus aucune heure : le brut tomberait à 0
    w.mem.sessions.add(session(s, "2026-01-07", 6)); // 6 min = 1 000 F
    const r = await calc(period.id, { recalculate: true });
    expect(item(r, s)).toMatchObject({ outcome: "FAILED" });
    expect(item(r, s)?.message).toMatch(/retenues/);
    expect((await payslipRows(w))[0]).toMatchObject({ deduction_amount: "9000", total_amount: "1000" }); // inchangé
  });

  it("T6/T7 — un bulletin APPROUVÉ n'est jamais réécrit par un recalcul (signalé) ; changer un tarif après ne change aucun montant", async () => {
    await fresh();
    const s = addStaff(w, "Tarif Stable");
    const node = newId();
    await addConfig(w, { staffId: s, defaultHourlyRate: null });
    await addRate(w, { curriculumNodeId: node, rate: 9000 });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 120, { nodeId: node }));
    await calc(period.id);
    const [p] = await payslipRows(w);
    expect(p?.total_amount).toBe("18000");
    unwrap(await approvePayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [p?.id] }, caps: { ownerApproval: false } }));
    // le tarif change après l'arrêt
    await db.admin.query("UPDATE payroll.hourly_rates SET rate = 20000 WHERE tenant_id=$1", [w.tenantId]);
    const r = await calc(period.id, { recalculate: true });
    expect(item(r, s)).toMatchObject({ outcome: "LOCKED", skipReason: "PAYSLIP_LOCKED", payslipId: p?.id });
    expect(r.locked).toBe(1);
    const [after] = await payslipRows(w);
    expect(after).toMatchObject({ status: "APPROVED", total_amount: "18000", row_version: p?.row_version + 1 });
    // la ligne figée garde le taux du jour du calcul
    expect((await adminRows(db, "SELECT rate::int r FROM payroll.payslip_lines WHERE payslip_id=$1", [p?.id]))[0]).toEqual({ r: 9000 });
  });

  it("T9 — le tarif est résolu à la DATE DE LA SÉANCE : nominatif > générique > défaut ; une date hors validité retombe sur le défaut", async () => {
    await fresh();
    const s = addStaff(w, "Date Tarif");
    const node = newId();
    await addConfig(w, { staffId: s, defaultHourlyRate: 5000 });
    await addRate(w, { curriculumNodeId: node, rate: 9000, validFrom: "2026-01-10", validTo: "2026-01-20" });
    await addRate(w, { curriculumNodeId: node, staffId: s, rate: 12_000, validFrom: "2026-01-15", validTo: "2026-01-20" });
    const period = await addPeriod(w);
    w.mem.sessions.add(
      session(s, "2026-01-06", 60, { nodeId: node }), // avant tout tarif -> défaut 5 000
      session(s, "2026-01-12", 60, { nodeId: node }), // générique 9 000
      session(s, "2026-01-16", 60, { nodeId: node }), // nominatif 12 000
      session(s, "2026-01-26", 60, { nodeId: node }), // tarifs échus -> défaut 5 000
    );
    await calc(period.id);
    const lines = await adminRows<{ d: string; r: number; o: string }>(db, "SELECT to_char(session_date,'YYYY-MM-DD') d, rate::int r, rate_origin o FROM payroll.payslip_lines WHERE tenant_id=$1 ORDER BY session_date", [w.tenantId]);
    expect(lines.map((l) => [l.d, l.r, l.o])).toEqual([
      ["2026-01-06", 5000, "CONFIG_DEFAULT"],
      ["2026-01-12", 9000, "NODE_GENERIC"],
      ["2026-01-16", 12_000, "NODE_STAFF"],
      ["2026-01-26", 5000, "CONFIG_DEFAULT"],
    ]);
  });

  it("T10/T11/T12 — deux périodes qui se chevauchent : l'heure ne se paie qu'UNE fois ; un bulletin annulé la relâche ; un approuvé non", async () => {
    await fresh();
    const s = addStaff(w, "Chevauche Ment");
    await addConfig(w, { staffId: s });
    const pA = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
    w.mem.sessions.add(session(s, "2026-01-12", 60), session(s, "2026-01-14", 60));
    await calc(pA.id);
    await releasePending(w);
    const pB = await addPeriod(w, { startDate: "2026-01-10", endDate: "2026-02-10" }); // contient les deux séances aussi
    w.mem.sessions.add(session(s, "2026-02-03", 60)); // dans B seulement
    const rB = await calc(pB.id);
    expect(item(rB, s)?.total?.amount).toBe(10_000); // seule la séance du 3 février
    expect(item(rB, s)?.message).toMatch(/2 heure\(s\) déjà payée\(s\)/);
    expect((await adminRows(db, "SELECT DISTINCT source_ref_id FROM payroll.hour_claims WHERE tenant_id=$1", [w.tenantId])).length).toBe(3);

    // T11 : l'annulation de A relâche ses heures -> recalcul de B les reprend
    const [a] = await payslipRows(w, "period_id=$2", [pA.id]);
    unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId: a?.id, reason: "Erreur de période" }));
    const rB2 = await calc(pB.id, { recalculate: true });
    expect(item(rB2, s)?.total?.amount).toBe(30_000);

    // T12 : un bulletin APPROUVÉ ne relâche rien -> A recalculé (nouveau bulletin) n'obtient pas les heures de B approuvé
    const [b] = await payslipRows(w, "period_id=$2 AND status='CALCULATED'", [pB.id]);
    unwrap(await approvePayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [b?.id] }, caps: { ownerApproval: false } }));
    const rA2 = await calc(pA.id);
    expect(item(rA2, s)).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    // l'ancien bulletin annulé est conservé, jamais ressuscité
    expect((await payslipRows(w, "period_id=$2", [pA.id])).map((p) => p.status)).toEqual(["CANCELLED"]);
  });

  it("bogue corrigée — deux périodes chevauchantes ne versent plus DEUX salaires : la seconde ne paie que les jours restants", async () => {
    await fresh();
    const diallo = addStaff(w, "Aissatou Diallo");
    const maya = addStaff(w, "Maya Mixte");
    await addConfig(w, { staffId: diallo, type: "SALARY", monthlySalary: 400_000, defaultHourlyRate: null });
    await addConfig(w, { staffId: maya, type: "MIXED", monthlySalary: 100_000, defaultHourlyRate: 9000 });
    const p1 = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
    w.mem.sessions.add(session(maya, "2026-01-26", 120), session(maya, "2026-01-27", 120));
    const r1 = await calc(p1.id);
    expect(item(r1, diallo)?.total?.amount).toBe(363_636);
    expect(item(r1, maya)?.total?.amount).toBe(126_909); // 90 909 + 36 000
    await releasePending(w);
    const p2 = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" }); // mêmes dates
    const r2 = await calc(p2.id);
    expect(item(r2, diallo)).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    expect(item(r2, maya)).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    expect((await payslipRows(w)).length).toBe(2);
    // période partiellement chevauchante : seuls les jours NON payés sont dus (6→9 février, 4 jours)
    await releasePending(w);
    const p3 = await addPeriod(w, { startDate: "2026-01-26", endDate: "2026-02-04" });
    const r3 = await calc(p3.id, { staffIds: [diallo] });
    // janvier 26→30 déjà payé ; février 2→4 = 3 jours ouvrés / 20 = 60 000
    expect(item(r3, diallo)?.total?.amount).toBe(60_000);
    const totalPaidJanuary = await adminRows(db, "SELECT count(*)::int n FROM payroll.salary_day_claims WHERE staff_id=$1 AND work_date BETWEEN '2026-01-01' AND '2026-01-31'", [diallo]);
    expect(totalPaidJanuary[0]?.n).toBe(20); // jamais plus d'un paiement par jour ouvré
  });

  it("séance à cheval sur le seuil : le bulletin est PRODUIT avec deux lignes (le legacy n'en produisait aucun)", async () => {
    await fresh();
    const marc = addStaff(w, "Marc Mixte");
    await addConfig(w, { staffId: marc, type: "HOURLY", defaultHourlyRate: 8000, overtimeThresholdMinutes: 600, overtimeMultiplierPermille: 1500 });
    const period = await addPeriod(w);
    const h1 = session(marc, "2026-01-12", 480);
    const h2 = session(marc, "2026-01-13", 240);
    w.mem.sessions.add(h1, h2);
    const r = await calc(period.id);
    expect(item(r, marc)).toMatchObject({ outcome: "CALCULATED" });
    expect(item(r, marc)?.total?.amount).toBe(64_000 + 16_000 + 24_000);
    const lines = await adminRows<{ source_ref_id: string; minutes: number; is_overtime: boolean; multiplier_permille: number; amount: string }>(
      db,
      "SELECT source_ref_id, minutes, is_overtime, multiplier_permille, amount::text FROM payroll.payslip_lines WHERE tenant_id=$1 ORDER BY position",
      [w.tenantId],
    );
    expect(lines.filter((l) => l.source_ref_id === h2.refId).map((l) => [l.minutes, l.is_overtime, l.multiplier_permille, l.amount])).toEqual([[120, false, 1000, "16000"], [120, true, 1500, "24000"]]);
    // une seule réclamation pour la séance coupée, de 240 minutes
    expect(await adminRows(db, "SELECT minutes FROM payroll.hour_claims WHERE source_ref_id=$1", [h2.refId])).toEqual([{ minutes: 240 }]);
  });

  it("aperçu (dryRun) : calcule et détaille ligne à ligne sans RIEN persister", async () => {
    await fresh();
    const s = addStaff(w, "Aperçu");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 120));
    const r = await calc(period.id, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, runId: null, calculated: 1 });
    expect(item(r, s)?.preview?.lines).toHaveLength(1);
    expect(item(r, s)?.preview?.total.amount).toBe(20_000);
    expect(await payslipRows(w)).toHaveLength(0);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE tenant_id=$1", [w.tenantId])).length).toBe(0);
    expect((await adminRows(db, "SELECT 1 FROM payroll.calculation_runs WHERE tenant_id=$1", [w.tenantId])).length).toBe(0);
    expect((await adminRows(db, "SELECT awaiting_calculation FROM payroll.pay_periods WHERE id=$1", [period.id]))[0]).toEqual({ awaiting_calculation: true });
  });

  it("l'aperçu d'un bulletin déjà calculé montre ce que donnerait le recalcul (sans rien écrire)", async () => {
    await fresh();
    const s = addStaff(w, "Aperçu Existant");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    await calc(period.id);
    w.mem.sessions.add(session(s, "2026-01-07", 60)); // une heure validée après le calcul (risque R6)
    const preview = await calc(period.id, { dryRun: true });
    expect(item(preview, s)).toMatchObject({ outcome: "CALCULATED" });
    expect(item(preview, s)?.total?.amount).toBe(20_000);
    expect((await payslipRows(w))[0]?.total_amount).toBe("10000"); // inchangé
    // sans aperçu ni « recalculer » : rien ne bouge non plus
    expect(item(await calc(period.id), s)).toMatchObject({ skipReason: "ALREADY_CALCULATED" });
    expect((await payslipRows(w))[0]?.total_amount).toBe("10000");
  });

  it("AC2.12 — un enseignant désactivé garde ses séances validées non payées", async () => {
    await fresh();
    const gone = addStaff(w, "Parti Depuis", { active: false });
    await addConfig(w, { staffId: gone });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(gone, "2026-01-06", 60));
    const r = await calc(period.id);
    expect(item(r, gone)).toMatchObject({ outcome: "CALCULATED" });
    expect(item(r, gone)?.total?.amount).toBe(10_000);
  });

  it("période ciblée : seuls les enseignants ciblés sont calculés ; un autre demandé est OUT_OF_SCOPE (nommé)", async () => {
    await fresh();
    const a = addStaff(w, "Cible A");
    const b = addStaff(w, "Hors Cible B");
    await addConfig(w, { staffId: a });
    await addConfig(w, { staffId: b });
    const period = await addPeriod(w, { staffIds: [a] });
    w.mem.sessions.add(session(a, "2026-01-06", 60), session(b, "2026-01-06", 60));
    const r = await calc(period.id, { staffIds: [a, b] });
    expect(item(r, a)).toMatchObject({ outcome: "CALCULATED" });
    expect(item(r, b)).toMatchObject({ outcome: "SKIPPED", skipReason: "OUT_OF_SCOPE", staffName: "Hors Cible B" });
    expect(await payslipRows(w)).toHaveLength(1);
  });

  it("origines autorisées par le plan : sans la source « présences », ses heures ne sont pas lues", async () => {
    await fresh();
    const s = addStaff(w, "Deux Origines");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    w.mem.attendance.add(attendance(s, "2026-01-06", 60));
    const r = await calc(period.id, { enabledSources: ["SESSION"] });
    expect(item(r, s)?.total?.amount).toBe(10_000);
    expect(w.mem.attendance.collectCalls).toBe(0);
  });

  it("panne d'un port : calcul REFUSÉ avec un message clair, jamais un résultat partiel ; aucun compte rendu orphelin", async () => {
    await fresh();
    const s = addStaff(w, "Panne");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    w.mem.attendance.failWith = new Error("service présences injoignable");
    const err = await expectErr(calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id }), PayrollCodes.portUnavailable);
    expect(err.message).toMatch(/présences enseignants/);
    expect(await payslipRows(w)).toHaveLength(0);
    expect((await adminRows(db, "SELECT 1 FROM payroll.calculation_runs WHERE tenant_id=$1", [w.tenantId])).length).toBe(0);
    // port non branché : même refus
    w.mem.attendance.failWith = null;
    const lonely = await createWorld({ db });
    const bare = createPayrollDeps({ db: db.tenantDb, clock: lonely.clock, ports: { sessionHours: lonely.mem.sessions } });
    const p2 = await addPeriod(lonely);
    await expectErr(calculatePeriod(bare, lonely.ctxOf(), { periodId: p2.id }), PayrollCodes.portUnavailable);
  });

  it("période clôturée ou archivée : calcul refusé ; l'aperçu reste possible sur une période clôturée", async () => {
    await fresh();
    const s = addStaff(w, "Clos");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    await calc(period.id); // ACTIVE
    unwrap(await setPeriodStatus(w.deps, w.ctxOf(), { periodId: period.id, status: "CLOSED" }));
    await expectErr(calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id, recalculate: true }), PayrollCodes.periodClosed);
    const preview = await calc(period.id, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    unwrap(await setPeriodStatus(w.deps, w.ctxOf(), { periodId: period.id, status: "ARCHIVED" }));
    await expectErr(calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id, dryRun: true }), PayrollCodes.periodClosed);
  });

  it("une seule période en attente de calcul ; calcul concurrent de la même période : refusé (verrou fonctionnel)", async () => {
    await fresh();
    const s = addStaff(w, "Verrou");
    await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    const err = await expectErr(createPeriod(w.deps, w.ctxOf(), { name: "Autre", startDate: "2026-02-01", endDate: "2026-02-28", academicYearId: w.yearId }), PayrollCodes.periodPending);
    expect(err.details).toMatchObject({ periodId: period.id });
    // un calcul « RUNNING » déjà présent bloque un second calcul réel de la période
    await db.admin.query("INSERT INTO payroll.calculation_runs (id, tenant_id, period_id, scope, recalculate, dry_run, requested_by) VALUES ($1,$2,$3,'ALL',false,false,$4)", [newId(), w.tenantId, period.id, w.accountant]);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    await expectErr(calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id }), PayrollCodes.runInProgress);
    // ... mais un calcul abandonné depuis longtemps est repris
    await db.admin.query("UPDATE payroll.calculation_runs SET requested_at = now() - interval '2 hours' WHERE tenant_id=$1", [w.tenantId]);
    const r = await calc(period.id);
    expect(r.calculated).toBe(1);
    expect((await adminRows(db, "SELECT status FROM payroll.calculation_runs WHERE tenant_id=$1 ORDER BY requested_at", [w.tenantId])).map((x) => x.status)).toEqual(["FAILED", "COMPLETED"]);
  });

  it("devise et configuration : une configuration qui chevauche une autre est refusée (409) ; deux tarifs chevauchants aussi", async () => {
    await fresh();
    const s = addStaff(w, "Config Doublon");
    await addConfig(w, { staffId: s, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" });
    await expectErr(createPayConfig(w.deps, w.ctxOf(), { staffId: s, type: "HOURLY", defaultHourlyRate: 1, effectiveFrom: "2026-06-30" }), PayrollCodes.configOverlap);
    const node = newId();
    await addRate(w, { curriculumNodeId: node, rate: 100 });
    await expectErr(createHourlyRate(w.deps, w.ctxOf(), { curriculumNodeId: node, rate: 200, validFrom: "2026-01-01" }), PayrollCodes.rateOverlap);
  });

  it("une configuration qui change en cours de période : la plus récente s'applique, rappelée dans le compte rendu", async () => {
    await fresh();
    const s = addStaff(w, "Deux Configs");
    await addConfig(w, { staffId: s, defaultHourlyRate: 5000, effectiveFrom: "2025-09-01", effectiveTo: "2026-01-14" });
    await addConfig(w, { staffId: s, defaultHourlyRate: 8000, effectiveFrom: "2026-01-15" });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    const r = await calc(period.id);
    expect(item(r, s)?.total?.amount).toBe(8000); // la plus récente à TOUTE la période (limite héritée)
    expect(item(r, s)?.message).toMatch(/2 configurations couvrent la période/);
  });
});
