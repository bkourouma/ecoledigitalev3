/**
 * Isolation multi-tenant du module (ADR-002) : test générique `assertTenantIsolation` sur les 13 tables du schéma,
 * puis isolation de bout en bout avec de VRAIES lignes (bulletins, lignes, réclamations, journal, comptes rendus).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId } from "@ecoledigitale/kernel";
import { calculatePeriod } from "../../application/calculate";
import { approvePayslips, cancelPayslip, payPayslips } from "../../application/workflow";
import { getPayslipData, getPayslipDetail, getRun, listHistory, listPayslips, ownerMass } from "../../application/queries";
import { listPayConfigs, listHourlyRates } from "../../application/configs";
import { listPeriods } from "../../application/periods";
import { PayrollCodes } from "../../domain/errors";
import { fixtures, payrollTenantTables } from "../../../isolation-allowlist.payroll";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addRate, addStaff, createWorld, expectErr, payslipRows, session, unwrap } from "../support/world";

describeIntegration("isolation multi-tenant", () => {
  let db: PayrollTestDb;
  beforeAll(async () => {
    db = await createPayrollTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("assertTenantIsolation : RLS forcée, policy unique, index tenant_id sur les 13 tables ; aucune table globale", async () => {
    const report = await checkTenantIsolation({ pool: db.appPool, schemas: ["kernel", "payroll"], allowlist: ["kernel.tenants"], fixtures });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    const covered = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].filter((t) => t.startsWith("payroll."));
    expect(covered.sort()).toEqual([...payrollTenantTables].sort());
    console.info(`[isolation] payroll : comportement=${report.behavioural.filter((t) => t.startsWith("payroll.")).join(", ")} ; structure seule=${report.structuralOnly.filter((s) => s.table.startsWith("payroll.")).map((s) => s.table).join(", ")}`);
    await assertTenantIsolation({ pool: db.appPool, schemas: ["kernel", "payroll"], allowlist: ["kernel.tenants"], fixtures });
  });

  it("à travers les cas d'usage et le SQL applicatif : B ne lit, n'agit ni n'écrit rien chez A (13 tables)", async () => {
    const a = await createWorld({ db });
    const b = await createWorld({ db });
    const staff = addStaff(a, "Prof A");
    await addConfig(a, { staffId: staff });
    await addRate(a, { curriculumNodeId: newId(), rate: 9000 });
    const period = await addPeriod(a);
    a.mem.sessions.add(session(staff, "2026-01-06", 120));
    const report = unwrap(await calculatePeriod(a.deps, a.ctxOf(), { periodId: period.id }));
    const [slip] = await payslipRows(a);
    unwrap(await approvePayslips(a.deps, a.ctxOf(), { selection: { payslipIds: [slip?.id] }, caps: { ownerApproval: false } }));
    unwrap(await payPayslips(a.deps, a.ctxOf(), { selection: { payslipIds: [slip?.id] }, method: "CASH" }));

    // B ne voit rien
    expect(unwrap(await listPayslips(b.deps, b.ctxOf(), {})).items).toEqual([]);
    expect(unwrap(await listHistory(b.deps, b.ctxOf(), {})).items).toEqual([]);
    expect(unwrap(await listPeriods(b.deps, b.ctxOf(), {})).items).toEqual([]);
    expect(unwrap(await listPayConfigs(b.deps, b.ctxOf(), {})).items).toEqual([]);
    expect(unwrap(await listHourlyRates(b.deps, b.ctxOf(), {})).items).toEqual([]);
    expect(unwrap(await ownerMass(b.deps, b.ctxOf(), {})).periods).toEqual([]);
    const caps = { readAll: true, readOwn: false };
    await expectErr(getPayslipDetail(b.deps, b.ctxOf(), { payslipId: slip?.id, caps }), PayrollCodes.notFound);
    await expectErr(getPayslipData(b.deps, b.ctxOf(), { payslipId: slip?.id, caps }), PayrollCodes.notFound);
    await expectErr(getRun(b.deps, b.ctxOf(), report.runId as string), PayrollCodes.notFound);
    // B n'agit sur rien : annuler / calculer la période d'A
    await expectErr(cancelPayslip(b.deps, b.ctxOf(), { payslipId: slip?.id, reason: "Tentative inter-tenant" }), PayrollCodes.notFound);
    await expectErr(calculatePeriod(b.deps, b.ctxOf(), { periodId: period.id }), PayrollCodes.notFound);
    const attempt = unwrap(await approvePayslips(b.deps, b.ctxOf(), { selection: { payslipIds: [slip?.id] }, caps: { ownerApproval: false } }));
    expect(attempt).toMatchObject({ done: [], rejected: [{ code: PayrollCodes.notFound }] });
    expect((await payslipRows(a))[0]?.status).toBe("PAID");

    // SQL brut sous le contexte de B : zéro ligne dans chacune des 13 tables, et aucune écriture avec le tenant d'A
    const counts = await b.deps.db.run(b.ctxOf(), async (tx) => {
      const out: Record<string, number> = {};
      for (const t of ["settings", "pay_periods", "pay_period_targets", "pay_configs", "hourly_rates", "payslips", "payslip_lines", "hour_claims", "salary_day_claims", "payslip_adjustments", "payslip_events", "calculation_runs", "calculation_run_items"]) {
        out[t] = Number((await tx.queryOne<{ n: string }>(`SELECT count(*) n FROM payroll.${t}`))?.n);
      }
      return out;
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    // A en a bien (les lignes existent)
    const aCounts = await adminRows<{ n: string }>(db, "SELECT count(*) n FROM payroll.payslip_lines WHERE tenant_id=$1", [a.tenantId]);
    expect(Number(aCounts[0]?.n)).toBeGreaterThan(0);
    // écrire avec le tenant d'A depuis le contexte de B : refusé par la RLS (WITH CHECK)
    await expect(
      b.deps.db.run(b.ctxOf(), (tx) =>
        tx.query("INSERT INTO payroll.payslip_events (id, tenant_id, payslip_id, action, actor_name) VALUES ($1,$2,$3,'CALCULATED','Intrus')", [newId(), a.tenantId, slip?.id]),
      ),
    ).rejects.toThrow(/row-level security|sécurité/i);
    // et les réclamations/lignes d'A ne sont pas atteignables non plus (le déclencheur ne voit pas le bulletin d'A)
    await expect(
      b.deps.db.run(b.ctxOf(), (tx) =>
        tx.query("INSERT INTO payroll.hour_claims (tenant_id, source_kind, source_ref_id, staff_id, payslip_id, minutes) VALUES ($1,'SESSION',$2,$3,$4,60)", [a.tenantId, newId(), newId(), slip?.id]),
      ),
    ).rejects.toThrow();
    // sans contexte de tenant : rien n'est visible ni insérable
    const raw = await db.appPool.query("SELECT count(*) n FROM payroll.payslips");
    expect(Number(raw.rows[0].n)).toBe(0);
  });

  it("un même identifiant d'heure peut être payé une fois PAR TENANT (la clé primaire inclut le tenant)", async () => {
    const a = await createWorld({ db });
    const b = await createWorld({ db });
    const shared = session(newId(), "2026-01-06", 60);
    const staff = shared.staffId as string;
    for (const w of [a, b]) {
      w.mem.staff.add({ staffId: staff, displayName: "Même personne" });
      await addConfig(w, { staffId: staff });
      const p = await addPeriod(w);
      w.mem.sessions.add(shared);
      const r = unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
      expect(r.calculated).toBe(1);
    }
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE source_ref_id=$1", [shared.refId])).length).toBe(2);
  });
});
