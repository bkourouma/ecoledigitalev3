import type { FastifyInstance } from "fastify";
import { paymentPeriodsRoutes } from "../../../apps/api/src/routes/payment-periods";
import { professionalRemunerationRoutes } from "../../../apps/api/src/routes/professional-remuneration";
import { teacherPaymentsRoutes } from "../../../apps/api/src/routes/teacher-payments";
import type { PayrollStep, Scenario } from "../scenarios/types";
import { buildLegacyApp, call, type TestAuth } from "./app";
import type { ScenarioDatabase } from "./db";
import { DefectCollector } from "./defects";
import { createNormalizer, sortedBy } from "./normalize";
import { detectPayrollDefects } from "./oracle-payroll";
import { seedBase, seedPayroll, type SeedContext } from "./seeder";

/**
 * Exécution d'un scénario de PAIE sur les VRAIES routes legacy (montées par `inject`, auth de test) :
 *   - /api/v1/payment-periods (création de période, verrou « une période en attente »),
 *   - /api/v1/professional/remuneration (validation des séances, volume comptable, archivage, versement),
 *   - /api/v1/teacher-payments (calcul avec les deux collecteurs d'heures, ajustements, approbation, actions groupées).
 * Le calcul lui-même passe par `PaymentCalculator` et les collecteurs `hour-collectors/*` : rien n'est recopié.
 */
export interface PayrollRun {
  data: unknown;
  defects: DefectCollector;
}

export async function runPayrollScenario(db: ScenarioDatabase, scenario: Scenario): Promise<PayrollRun> {
  if (!scenario.payroll) throw new Error(`Le scénario ${scenario.meta.name} n'a pas de partie « payroll »`);
  const { setup, steps } = scenario.payroll;
  const ctx = await seedBase(db.pool, scenario);
  await seedPayroll(ctx, setup, scenario.teachers);

  const app: FastifyInstance = await buildLegacyApp(db.pool, async (a) => {
    await a.register(paymentPeriodsRoutes, { prefix: "/api/v1/payment-periods" });
    await a.register(teacherPaymentsRoutes, { prefix: "/api/v1/teacher-payments" });
    await a.register(professionalRemunerationRoutes, { prefix: "/api/v1/professional/remuneration" });
  });
  const auth: TestAuth = { tenantId: ctx.tenantId, userId: ctx.adminUserId, roles: ["admin"] };
  const defects = new DefectCollector();
  const runner = new PayrollRunner(app, auth, ctx, db, defects);
  const out: Record<string, unknown> = {};
  let n = 0;
  try {
    for (const step of steps) {
      n++;
      const stepKey = `${String(n).padStart(2, "0")}-${step.label ?? step.do}`;
      out[stepKey] = await runner.perform(step, stepKey);
    }
    out.final = { payments: await runner.observePayments(), seances: await runner.observeSeances() };
    runner.detectOverlappingSalaries((out.final as any).payments);
  } finally {
    await app.close();
  }

  detectPayrollDefects(defects, { scenario, ctx, payments: (out.final as any).payments, stepsPath: "final.payments" });
  const { normalize } = createNormalizer(ctx.ids);
  return { data: normalize(out), defects };
}

const BASE = "/api/v1/teacher-payments";
const REMU = "/api/v1/professional/remuneration";

class PayrollRunner {
  private readonly periodIds = new Map<string, string>();
  private readonly periodDates = new Map<string, { start: string; end: string }>();

  /** Salaires versés deux fois : bulletins salariaux non annulés du même enseignant sur des périodes qui se chevauchent. */
  detectOverlappingSalaries(finalPayments: Record<string, any>): void {
    const byTeacher = new Map<string, string[]>();
    for (const [key, p] of Object.entries(finalPayments)) {
      if (p.status === "cancelled" || (p.payment_type !== "salary" && p.payment_type !== "mixed")) continue;
      const teacher = key.slice(key.indexOf("/") + 1);
      byTeacher.set(teacher, [...(byTeacher.get(teacher) ?? []), key]);
    }
    for (const [teacher, keys] of byTeacher) {
      const sorted = [...keys].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = this.periodDates.get(sorted[i].split("/")[0]);
          const b = this.periodDates.get(sorted[j].split("/")[0]);
          if (a && b && a.start <= b.end && b.start <= a.end) {
            this.defects.flag("PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY", `final.payments.${sorted[j]}.base_amount`, finalPayments[sorted[j]].base_amount, "0.00", {
              note: `${teacher} : bulletins salariaux ${sorted[i]} et ${sorted[j]} sur des périodes qui se chevauchent`,
              scope: [`final.payments.${sorted[j]}.**`, "steps.**"],
            });
          }
        }
      }
    }
  }

  constructor(
    private readonly app: FastifyInstance,
    private readonly auth: TestAuth,
    private readonly ctx: SeedContext,
    private readonly db: ScenarioDatabase,
    private readonly defects: DefectCollector,
  ) {}

  /** Statut, prime et retenue de chaque bulletin, indexés par `période/enseignant`. */
  private async snapshotPayments(): Promise<Map<string, { status: string; bonus: string; deductions: string }>> {
    const rows = await this.db.pool.query(
      `SELECT payment_period_id, teacher_id, status::text AS status, bonus_amount::text AS bonus, deductions::text AS deductions
         FROM teacher_payments WHERE tenant_id = $1`,
      [this.ctx.tenantId],
    );
    const m = new Map<string, { status: string; bonus: string; deductions: string }>();
    for (const r of rows.rows) {
      m.set(`${this.ctx.ids.key(r.payment_period_id)}/${this.ctx.ids.key(r.teacher_id)}`, { status: r.status, bonus: r.bonus, deductions: r.deductions });
    }
    return m;
  }

  private pid(key: string): string {
    const id = this.periodIds.get(key);
    if (!id) throw new Error(`Période inconnue : ${key}`);
    return id;
  }

  private async paymentIds(period: string, teachers?: string[]): Promise<string[]> {
    const rows = await this.db.pool.query(
      `SELECT id, teacher_id FROM teacher_payments WHERE tenant_id = $1 AND payment_period_id = $2`,
      [this.ctx.tenantId, this.pid(period)],
    );
    const wanted = teachers?.map((t) => this.ctx.ids.id("teacher", t));
    const ids: string[] = rows.rows.filter((r) => !wanted || wanted.includes(r.teacher_id)).map((r) => r.id);
    return ids;
  }

  async perform(step: PayrollStep, stepKey: string): Promise<unknown> {
    const { ids } = this.ctx;
    switch (step.do) {
      case "create-period": {
        const r = await call(this.app, this.auth, "POST", "/api/v1/payment-periods", {
          name: step.name,
          ...(step.start ? { periodStart: step.start } : {}),
          ...(step.end ? { periodEnd: step.end } : {}),
          ...(step.teachers?.length ? { teacherIds: step.teachers.map((t) => ids.id("teacher", t)) } : {}),
        });
        const created = (r.body as any)?.data;
        if (r.status === 201 && created?.id) {
          this.periodIds.set(step.period, created.id);
          this.periodDates.set(step.period, { start: step.start!, end: step.end! });
          ids.bind("payment-period", step.period, created.id);
        }
        return r;
      }
      case "validate-seances":
        return call(this.app, this.auth, "POST", `${REMU}/seances/validate`, {
          seanceIds: step.seances.map((s) => ids.id("seance", s)),
          validated: step.validated,
        });
      case "set-paid-volume":
        return call(this.app, this.auth, "PATCH", `${REMU}/seances/${ids.id("seance", step.seance)}/duree`, { duree: step.volume });
      case "set-seance-status":
        return call(this.app, this.auth, "PATCH", `${REMU}/seances/${ids.id("seance", step.seance)}/statut`, { statut: step.status });
      case "calculate": {
        const before = await this.snapshotPayments();
        const r = await call(this.app, this.auth, "POST", `${BASE}/calculate`, {
          periodId: this.pid(step.period),
          ...(step.dryRun ? { dryRun: true } : {}),
          ...(step.recalculate ? { recalculate: true } : {}),
          ...(step.scope ? { scope: step.scope } : {}),
          ...(step.teachers?.length ? { teacherIds: step.teachers.map((t) => ids.id("teacher", t)) } : {}),
        });
        await this.bindPayments(step.period);
        const result: Record<string, unknown> = { response: this.sortResults(r) };
        const sorted = ((r.body as any)?.data?.results ?? []) as any[];
        sorted.forEach((x, i) => {
          if (x.status === "error" && /uniq_phd_payment_(seance|attendance)/.test(String(x.error))) {
            this.defects.flag("PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE", `${stepKey}.response.body.data.results[${i}].status`, "error", "calculated", {
              note: `${x.teacherName} : ${x.error}`,
              scope: [`${stepKey}.response.**`, "final.payments.**", "steps.**"],
            });
          }
        });
        if (!step.dryRun) {
          result.payments = await this.observePayments(step.period);
          if (step.recalculate) {
            const after = await this.snapshotPayments();
            for (const [k, b] of before) {
              const a = after.get(k);
              if (a && b.status === "calculated" && (Number(b.bonus) !== 0 || Number(b.deductions) !== 0) && Number(a.bonus) === 0 && Number(a.deductions) === 0) {
                this.defects.flag("PAYMENT_RECALCULATE_ERASES_ADJUSTMENTS", `${stepKey}.payments.${k}.bonus_amount`, a.bonus, b.bonus, {
                  note: `prime ${b.bonus} et retenue ${b.deductions} avant le recalcul`,
                  scope: [`${stepKey}.payments.${k}.**`, "final.payments.**", `steps.**`],
                });
              }
            }
          }
        }
        return result;
      }
      case "adjust": {
        const [paymentId] = await this.paymentIds(step.period, [step.teacher]);
        const r = await call(this.app, this.auth, "PATCH", `${BASE}/${paymentId}/adjustments`, {
          ...(step.bonus !== undefined ? { bonusAmount: step.bonus } : {}),
          ...(step.deductions !== undefined ? { deductions: step.deductions } : {}),
        });
        return r;
      }
      case "approve": {
        const paymentIds = await this.paymentIds(step.period, step.teachers);
        const r = await call(this.app, this.auth, "POST", `${BASE}/approve`, { paymentIds });
        return { response: r, payments: await this.observePayments(step.period) };
      }
      case "archive": {
        const paymentIds = step.teachers && step.period ? await this.paymentIds(step.period, step.teachers) : undefined;
        const before = await this.snapshotPayments();
        const r = await call(this.app, this.auth, "POST", `${REMU}/bulletins/archiver`, paymentIds ? { paymentIds } : { tous: true });
        const after = await this.snapshotPayments();
        for (const [k, b] of before) {
          if (b.status === "cancelled" && after.get(k)?.status === "approved") {
            this.defects.flag("PAYMENT_ARCHIVE_REVIVES_CANCELLED", `${stepKey}.payments.${k}.status`, "approved", "cancelled", {
              note: "bulletin annulé remis au statut approuvé par l'archivage collectif",
              scope: [`${stepKey}.payments.${k}.**`, "final.payments.**", "steps.**"],
            });
          }
        }
        return { response: r, payments: await this.observePayments() };
      }
      case "pay": {
        const paymentIds = await this.paymentIds(step.period, step.teachers);
        const r =
          (step.via ?? "verser") === "verser"
            ? await call(this.app, this.auth, "POST", `${REMU}/bulletins/verser`, { paymentIds })
            : await call(this.app, this.auth, "POST", `${BASE}/bulk-action`, { paymentIds, action: "mark_paid" });
        return { response: r, payments: await this.observePayments(step.period) };
      }
      case "cancel": {
        const paymentIds = await this.paymentIds(step.period, step.teachers);
        const r = await call(this.app, this.auth, "POST", `${BASE}/bulk-action`, { paymentIds, action: "cancel" });
        return { response: r, payments: await this.observePayments(step.period) };
      }
      case "force-status": {
        const [paymentId] = await this.paymentIds(step.period, [step.teacher]);
        const before = (await this.snapshotPayments()).get(`${step.period}/${step.teacher}`);
        const r = await call(this.app, this.auth, "PATCH", `${BASE}/${paymentId}/status`, { status: step.status });
        const illegal =
          (step.status === "paid" && before?.status !== "approved") || (before?.status === "cancelled" && step.status !== "cancelled");
        if (r.status === 200 && illegal) {
          this.defects.flag("PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE", `${stepKey}.payments.${step.period}/${step.teacher}.status`, step.status, "transition refusée", {
            note: `transition ${before?.status} -> ${step.status} acceptée par PATCH /:id/status (la route /approve et /bulk-action l'auraient refusée)`,
            scope: [`${stepKey}.payments.${step.period}/${step.teacher}.**`, "final.payments.**", "steps.**"],
          });
        }
        return { response: r, payments: await this.observePayments(step.period) };
      }
    }
  }

  /** Les identifiants de paiement sont créés par le legacy : on leur donne un alias lisible. */
  private async bindPayments(periodKey: string): Promise<void> {
    const rows = await this.db.pool.query(`SELECT id, teacher_id FROM teacher_payments WHERE tenant_id=$1 AND payment_period_id=$2`, [
      this.ctx.tenantId,
      this.pid(periodKey),
    ]);
    for (const r of rows.rows) {
      const tk = this.ctx.ids.key(r.teacher_id);
      if (tk) this.ctx.ids.bind("payment", `${periodKey}/${tk}`, r.id);
    }
  }

  /** L'ordre des résultats de calcul suit l'ordre de la requête SQL des enseignants (sans ORDER BY) : on le fixe. */
  private sortResults(r: { status: number; body: unknown }): unknown {
    const data = (r.body as any)?.data;
    if (data?.results) {
      data.results = sortedBy(data.results as any[], (x) => String(this.ctx.ids.alias(x.teacherId) ?? x.teacherId));
      for (const x of data.results) if (x.hourDetails) x.hourDetails = sortedBy(x.hourDetails as any[], (h) => `${h.sessionDate}|${h.seanceId ?? h.attendanceSessionId}|${h.isOvertime}`);
    }
    return r;
  }

  async observePayments(periodKey?: string): Promise<Record<string, unknown>> {
    const { ids, tenantId } = this.ctx;
    const pays = await this.db.pool.query(
      `SELECT id, payment_period_id, teacher_id, status::text AS status, payment_type::text AS payment_type,
              base_amount::text, overtime_amount::text, bonus_amount::text, deductions::text, total_amount::text, currency,
              calculation_details, (approved_at IS NOT NULL) AS approved, (paid_at IS NOT NULL) AS paid,
              (archived_at IS NOT NULL) AS archived, approved_by, paid_by, archived_by, notes
         FROM teacher_payments WHERE tenant_id = $1`,
      [tenantId],
    );
    const details = await this.db.pool.query(
      `SELECT payment_id, source, attendance_session_id, seance_id, teaching_hours_id, hours_count::text, hourly_rate::text,
              amount::text, is_overtime
         FROM payment_hour_details WHERE tenant_id = $1`,
      [tenantId],
    );
    const out: Record<string, unknown> = {};
    const periodOf = (pid: string) => ids.key(pid) ?? pid;
    for (const p of pays.rows) {
      const pk = periodOf(p.payment_period_id);
      if (periodKey && pk !== periodKey) continue;
      const tk = ids.key(p.teacher_id) ?? p.teacher_id;
      const lines = sortedBy(
        details.rows.filter((d) => d.payment_id === p.id).map((d) => ({ ...d, payment_id: undefined })),
        (d) => `${d.source}|${ids.alias(d.seance_id ?? d.attendance_session_id ?? "") ?? ""}|${d.is_overtime}`,
      );
      out[`${pk}/${tk}`] = { ...p, id: undefined, payment_period_id: undefined, teacher_id: undefined, hourDetails: lines };
    }
    return out;
  }

  async observeSeances(): Promise<Record<string, unknown>> {
    const { ids, tenantId } = this.ctx;
    const rows = await this.db.pool.query(
      `SELECT id, statut, (validated_at IS NOT NULL) AS validated, duree_payee::text, heure_debut::text, heure_fin::text,
              date::text AS date, enseignant_id
         FROM professional_ecue_seances WHERE tenant_id = $1 ORDER BY date, id`,
      [tenantId],
    );
    const out: Record<string, unknown> = {};
    for (const r of rows.rows) out[ids.key(r.id) ?? r.id] = { ...r, id: undefined };
    return out;
  }
}
