/**
 * T17 — 500 séances × 100 enseignants (50 000 heures) se calculent en ≤ 30 s : UNE lecture par origine pour toute
 * la période, tarifs préchargés, insertions en lot. Le résultat reste exact (somme des lignes = total, une heure
 * une seule fois).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { calculatePeriod } from "../../application/calculate";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addRate, addStaff, createWorld, session, unwrap } from "../support/world";

describeIntegration("performance du calcul (T17)", () => {
  let db: PayrollTestDb;
  beforeAll(async () => {
    db = await createPayrollTestDb(16);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("500 séances × 100 enseignants : calcul réel ≤ 30 s, une seule lecture de la source, résultat exact", async () => {
    const w = await createWorld({ db });
    const node = newId();
    await addRate(w, { curriculumNodeId: node, rate: 6000 });
    const teachers = Array.from({ length: 100 }, (_, i) => addStaff(w, `Enseignant ${i}`));
    for (const t of teachers) await addConfig(w, { staffId: t, defaultHourlyRate: 5000 });
    const period = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
    let minutes = 0;
    for (const t of teachers) {
      for (let k = 0; k < 500; k++) {
        const day = 5 + (k % 27); // 5 → 31 janvier
        const m = 30 + (k % 4) * 15;
        minutes += m;
        w.mem.sessions.add(session(t, `2026-01-${String(day).padStart(2, "0")}`, m, { nodeId: node }));
      }
    }
    const facts = w.mem.sessions.facts;

    const preview = Date.now();
    const dry = unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id, dryRun: true }));
    const dryMs = Date.now() - preview;
    expect(dry.calculated).toBe(100);

    const started = Date.now();
    const report = unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id }));
    const elapsed = Date.now() - started;
    console.info(`[perf] 100 enseignants × 500 séances = ${facts.length} heures : aperçu ${dryMs} ms, calcul réel ${elapsed} ms (durée rapportée ${report.durationMs} ms)`);
    expect(report.calculated).toBe(100);
    expect(report.failed).toBe(0);
    expect(w.mem.sessions.collectCalls).toBe(2); // UNE lecture par appel (aperçu + réel), pas une par enseignant
    expect(elapsed).toBeLessThanOrEqual(30_000);

    // exactitude : toutes les heures payées une fois ; Σ lignes = Σ totaux
    const claims = await adminRows<{ n: string; m: string }>(db, "SELECT count(*) n, sum(minutes) m FROM payroll.hour_claims WHERE tenant_id=$1", [w.tenantId]);
    expect(Number(claims[0]?.n)).toBe(facts.length);
    expect(Number(claims[0]?.m)).toBe(minutes);
    const totals = await adminRows<{ lines: string; slips: string }>(
      db,
      `SELECT (SELECT sum(amount) FROM payroll.payslip_lines WHERE tenant_id=$1)::text lines, (SELECT sum(total_amount) FROM payroll.payslips WHERE tenant_id=$1)::text slips`,
      [w.tenantId],
    );
    expect(totals[0]?.lines).toBe(totals[0]?.slips);
  });
});
