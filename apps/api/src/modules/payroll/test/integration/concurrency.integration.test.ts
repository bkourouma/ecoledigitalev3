/**
 * Concurrence (spec 032 §11, critère de sortie 2) : deux calculs simultanés de deux périodes qui se
 * chevauchent ne paient JAMAIS deux fois la même heure (ni le même jour de salaire) ; recalcul concurrent d'un
 * même bulletin ; double approbation ; double versement.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculatePeriod } from "../../application/calculate";
import { approvePayslips, payPayslips } from "../../application/workflow";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addStaff, createWorld, payslipRows, releasePending, session, unwrap, type World } from "../support/world";
import { PayrollCodes } from "../../domain/errors";

describeIntegration("concurrence (Postgres réel)", () => {
  let db: PayrollTestDb;
  beforeAll(async () => {
    db = await createPayrollTestDb(32);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("deux calculs SIMULTANÉS de deux périodes qui se chevauchent : chaque heure est portée par un seul bulletin, aucune n'est perdue", async () => {
    for (let round = 0; round < 3; round++) {
      const w: World = await createWorld({ db });
      const staffIds = Array.from({ length: 12 }, (_, i) => addStaff(w, `Prof ${round}-${i}`));
      for (const s of staffIds) await addConfig(w, { staffId: s, defaultHourlyRate: 6000 });
      const a = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
      await db.admin.query("UPDATE payroll.pay_periods SET awaiting_calculation = false WHERE id = $1", [a.id]);
      const b = await addPeriod(w, { startDate: "2026-01-15", endDate: "2026-02-15" }); // chevauche A du 15 au 31
      let totalMinutes = 0;
      const refs = new Set<string>();
      for (const s of staffIds) {
        for (let d = 5; d <= 28; d++) {
          // séances dans A seul, dans A∩B, dans B seul : janvier 5-14 (A), 15-31 (A∩B), février 1-15 (B)
          const date = d <= 26 ? `2026-01-${String(d).padStart(2, "0")}` : `2026-02-${String(d - 26).padStart(2, "0")}`;
          const h = session(s, date, 45 + (d % 4) * 15);
          w.mem.sessions.add(h);
          refs.add(h.refId);
          totalMinutes += 45 + (d % 4) * 15;
        }
      }
      const [ra, rb] = await Promise.all([calculatePeriod(w.deps, w.ctxOf(), { periodId: a.id }), calculatePeriod(w.deps, w.ctxOf(), { periodId: b.id })]);
      expect(ra.ok && rb.ok).toBe(true);

      // 1. chaque heure a EXACTEMENT une réclamation (clé primaire) ET une seule ligne par bulletin vivant
      const claims = await adminRows<{ source_ref_id: string; n: number }>(db, "SELECT source_ref_id, count(*)::int n FROM payroll.hour_claims WHERE tenant_id=$1 GROUP BY source_ref_id", [w.tenantId]);
      expect(claims.every((c) => c.n === 1)).toBe(true);
      // 2. aucune heure payée deux fois, quelle que soit la répartition entre A et B
      const lines = await adminRows<{ source_ref_id: string; payslips: number; minutes: number }>(
        db,
        `SELECT l.source_ref_id, count(DISTINCT l.payslip_id)::int payslips, sum(l.minutes)::int minutes
           FROM payroll.payslip_lines l JOIN payroll.payslips p ON p.id = l.payslip_id AND p.tenant_id = l.tenant_id
          WHERE l.tenant_id=$1 AND p.status <> 'CANCELLED' GROUP BY l.source_ref_id`,
        [w.tenantId],
      );
      expect(lines.every((l) => l.payslips === 1)).toBe(true);
      // 3. rien n'est perdu : toutes les heures des périodes (A ∪ B) sont payées par l'une ou l'autre
      expect(new Set(lines.map((l) => l.source_ref_id))).toEqual(refs);
      expect(lines.reduce((s, l) => s + l.minutes, 0)).toBe(totalMinutes);
      // 4. les montants suivent : 6 000 F/h, hors seuil (40 h/semaine non atteint)
      const paid = await adminRows<{ t: string }>(db, "SELECT sum(total_amount)::text t FROM payroll.payslips WHERE tenant_id=$1", [w.tenantId]);
      expect(Number(paid[0]?.t)).toBe(totalMinutes * 100);
    }
  });

  it("salaire : deux calculs simultanés de périodes chevauchantes ne versent jamais deux fois le même jour ouvré", async () => {
    const w = await createWorld({ db });
    const staffIds = Array.from({ length: 8 }, (_, i) => addStaff(w, `Salarié ${i}`));
    for (const s of staffIds) await addConfig(w, { staffId: s, type: "SALARY", monthlySalary: 440_000, defaultHourlyRate: null });
    const a = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
    await releasePending(w);
    const b = await addPeriod(w, { startDate: "2026-01-12", endDate: "2026-02-13" });
    const [ra, rb] = await Promise.all([calculatePeriod(w.deps, w.ctxOf(), { periodId: a.id }), calculatePeriod(w.deps, w.ctxOf(), { periodId: b.id })]);
    expect(ra.ok && rb.ok).toBe(true);
    const days = await adminRows<{ n: number }>(db, "SELECT count(*)::int n FROM payroll.salary_day_claims WHERE tenant_id=$1 GROUP BY staff_id, work_date HAVING count(*) > 1", [w.tenantId]);
    expect(days).toEqual([]);
    // chaque enseignant : tous les jours ouvrés de A ∪ B (5 janvier → 13 février = 30 jours) réclamés une fois
    const perStaff = await adminRows<{ n: number }>(db, "SELECT count(*)::int n FROM payroll.salary_day_claims WHERE tenant_id=$1 GROUP BY staff_id", [w.tenantId]);
    expect(perStaff.map((r) => r.n)).toEqual(new Array(8).fill(30));
  });

  it("recalcul concurrent d'une même période : le verrou fonctionnel en refuse un, le résultat reste cohérent", async () => {
    const w = await createWorld({ db });
    const staff = Array.from({ length: 6 }, (_, i) => addStaff(w, `Recalc ${i}`));
    for (const s of staff) await addConfig(w, { staffId: s });
    const p = await addPeriod(w);
    for (const s of staff) w.mem.sessions.add(session(s, "2026-01-06", 60), session(s, "2026-01-07", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
    const results = await Promise.all([1, 2, 3].map(() => calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id, recalculate: true })));
    const okCount = results.filter((r) => r.ok).length;
    const refused = results.filter((r) => !r.ok);
    expect(okCount).toBeGreaterThanOrEqual(1);
    for (const r of refused) expect(!r.ok && r.error.code).toBe(PayrollCodes.runInProgress);
    const slips = await payslipRows(w);
    expect(slips).toHaveLength(6);
    expect(slips.every((s) => s.total_amount === "20000" && s.status === "CALCULATED")).toBe(true);
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE tenant_id=$1", [w.tenantId])).length).toBe(12);
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslip_lines WHERE tenant_id=$1", [w.tenantId])).length).toBe(12);
  });

  it("double approbation et double versement simultanés : un seul acte, un seul événement, une seule date", async () => {
    const w = await createWorld({ db });
    const s = addStaff(w, "Double Clic", { userId: undefined });
    await addConfig(w, { staffId: s });
    const p = await addPeriod(w);
    w.mem.sessions.add(session(s, "2026-01-06", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
    const [slip] = await payslipRows(w);
    const approvals = await Promise.all([1, 2, 3, 4].map(() => approvePayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [slip?.id] }, caps: { ownerApproval: false } })));
    const results = approvals.map((r) => unwrap(r));
    expect(results.reduce((n, r) => n + r.done.length, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.unchanged.length, 0)).toBe(3);
    expect((await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.approved'", [w.tenantId])).length).toBe(1);
    const pays = await Promise.all([1, 2, 3].map(() => payPayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [slip?.id] }, method: "CASH" })));
    const pr = pays.map((r) => unwrap(r));
    expect(pr.reduce((n, r) => n + r.done.length, 0)).toBe(1);
    expect((await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.paid'", [w.tenantId])).length).toBe(1);
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslip_events WHERE payslip_id=$1 AND action IN ('APPROVED','PAID')", [slip?.id])).length).toBe(2);
  });
});
