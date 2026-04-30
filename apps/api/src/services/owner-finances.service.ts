import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerFinancesPeriod, OwnerFinancesResponse } from "@ecoledigitale/contracts";

export type OwnerFinancesQuery = {
  period: OwnerFinancesPeriod;
  /** When period is academic_year */
  academicYearId?: string;
  /** Optional cycle filter (UUID) */
  cycleId?: string;
};

function monthRange(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function quarterRange(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  const startM = q * 3;
  const start = new Date(Date.UTC(y, startM, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, startM + 3, 0, 23, 59, 59, 999));
  return { start, end };
}

function yearRange(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  return {
    start: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
  };
}

export function anonymizeStudentRef(studentId: string): string {
  const hex = studentId.replace(/-/g, "");
  return `${hex.slice(0, 6).toUpperCase()}…`;
}

export async function resolveFinancesDateRange(
  pool: Pool,
  tenantId: string,
  query: OwnerFinancesQuery,
  log?: FastifyBaseLogger
): Promise<{ start: Date; end: Date; academicYearId?: string }> {
  const now = new Date();
  if (query.period === "month") {
    const { start, end } = monthRange(now);
    return { start, end };
  }
  if (query.period === "quarter") {
    const { start, end } = quarterRange(now);
    return { start, end };
  }
  if (query.period === "year") {
    const { start, end } = yearRange(now);
    return { start, end };
  }
  if (query.period === "academic_year") {
    if (!query.academicYearId) {
      log?.warn("academic_year without academicYearId — falling back to current month");
      const { start, end } = monthRange(now);
      return { start, end };
    }
    const r = await pool.query(
      `SELECT start_date, end_date FROM academic_years
       WHERE tenant_id = $1 AND id = $2::uuid`,
      [tenantId, query.academicYearId]
    );
    if (r.rows.length === 0) {
      log?.warn({ academicYearId: query.academicYearId }, "academic year not found");
      const { start, end } = monthRange(now);
      return { start, end };
    }
    const row = r.rows[0];
    return {
      start: new Date(row.start_date),
      end: new Date(row.end_date),
      academicYearId: query.academicYearId,
    };
  }
  const { start, end } = monthRange(now);
  return { start, end };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchOwnerFinances(
  pool: Pool,
  tenantId: string,
  query: OwnerFinancesQuery,
  log?: FastifyBaseLogger
): Promise<OwnerFinancesResponse> {
  const { start, end, academicYearId } = await resolveFinancesDateRange(
    pool,
    tenantId,
    query,
    log
  );
  const startStr = toIsoDate(start);
  const endStr = toIsoDate(end);
  const cycleForSql = query.cycleId ?? null;

  const paramsBase: unknown[] = [tenantId, startStr, endStr, cycleForSql];

  const recoverySql = `
    SELECT
      c.id AS class_id,
      c.name AS class_name,
      cy.name AS cycle_name,
      COALESCE(SUM(sti.amount), 0)::float AS expected,
      COALESCE(SUM(sti.amount_paid), 0)::float AS collected
    FROM classes c
    JOIN programmes p ON p.id = c.programme_id AND p.tenant_id = c.tenant_id
    JOIN cycles cy ON cy.id = p.cycle_id AND cy.tenant_id = c.tenant_id
    LEFT JOIN student_enrollments se ON se.class_id = c.id
      AND se.tenant_id = c.tenant_id
      AND se.status = 'active'::enrollment_status
    LEFT JOIN student_tuition_installments sti ON sti.enrollment_id = se.id
      AND sti.tenant_id = se.tenant_id
      AND sti.due_date::date BETWEEN $2::date AND $3::date
    WHERE c.tenant_id = $1::uuid
      AND ($4::uuid IS NULL OR cy.id = $4::uuid)
    GROUP BY c.id, c.name, cy.name
    ORDER BY cy.name NULLS LAST, c.name
  `;

  const overdueSql = `
    SELECT
      sti.student_id,
      sti.amount - sti.amount_paid AS amount_due,
      sti.due_date,
      c.name AS class_name
    FROM student_tuition_installments sti
    JOIN student_enrollments se ON se.id = sti.enrollment_id AND se.tenant_id = sti.tenant_id
    JOIN classes c ON c.id = se.class_id AND c.tenant_id = sti.tenant_id
    JOIN programmes p ON p.id = c.programme_id AND p.tenant_id = c.tenant_id
    JOIN cycles cy ON cy.id = p.cycle_id AND cy.tenant_id = c.tenant_id
    WHERE sti.tenant_id = $1::uuid
      AND sti.status IN ('pending', 'partial', 'overdue')
      AND sti.amount > sti.amount_paid
      AND sti.due_date::date <= $3::date
      AND ($4::uuid IS NULL OR cy.id = $4::uuid)
    ORDER BY sti.due_date ASC
    LIMIT 200
  `;

  const payrollSql = `
    SELECT
      tp.id,
      tp.total_amount AS amount,
      tp.status::text AS status,
      tp.calculated_at,
      pp.name AS period_name,
      COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Enseignant') AS teacher_name
    FROM teacher_payments tp
    JOIN teachers t ON t.id = tp.teacher_id
    JOIN users u ON u.id = t.user_id
    LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
    WHERE tp.tenant_id = $1::uuid
      AND COALESCE(tp.calculated_at, tp.created_at)::date BETWEEN $2::date AND $3::date
    ORDER BY COALESCE(tp.calculated_at, tp.created_at) DESC
    LIMIT 100
  `;

  const client = await pool.connect();
  let recoveryRows: Record<string, unknown>[] = [];
  let overdueRows: Record<string, unknown>[] = [];
  let payrollRows: Record<string, unknown>[] = [];
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    try {
      const recoveryRes = await client.query(recoverySql, paramsBase);
      recoveryRows = recoveryRes.rows;
    } catch (e) {
      log?.warn({ err: e }, "owner finances recovery query failed");
    }
    try {
      const overdueRes = await client.query(overdueSql, paramsBase);
      overdueRows = overdueRes.rows;
    } catch (e) {
      log?.warn({ err: e }, "owner finances overdue query failed");
    }
    try {
      const payrollRes = await client.query(payrollSql, [tenantId, startStr, endStr]);
      payrollRows = payrollRes.rows;
    } catch (e) {
      log?.warn({ err: e }, "owner finances payroll query failed");
    }
  } finally {
    client.release();
  }

  const recoveryByClass = recoveryRows.map((row) => {
    const expected = Number(row.expected) || 0;
    const collected = Number(row.collected) || 0;
    const recoveryRate =
      expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0;
    return {
      classId: row.class_id,
      className: row.class_name,
      cycleName: row.cycle_name,
      expected,
      collected,
      recoveryRate,
    };
  });

  const expectedTuition = recoveryByClass.reduce((s, r) => s + r.expected, 0);
  const collectedTuition = recoveryByClass.reduce((s, r) => s + r.collected, 0);
  const recoveryRateTotal =
    expectedTuition > 0
      ? Math.round((collectedTuition / expectedTuition) * 1000) / 10
      : 0;

  let overdueAmount = 0;
  const overdueInstallments = overdueRows.map((row) => {
    const due = Number(row.amount_due) || 0;
    overdueAmount += due;
    return {
      studentRef: anonymizeStudentRef(String(row.student_id)),
      className: row.class_name,
      amountDue: due,
      dueDate: toIsoDate(new Date(row.due_date)),
    };
  });

  const teacherPayroll = payrollRows.map((row) => ({
    id: row.id,
    teacherName: row.teacher_name,
    periodLabel: row.period_name,
    amount: Number(row.amount) || 0,
    status: row.status,
    calculatedAt: new Date(row.calculated_at).toISOString(),
  }));
  const teacherPayrollTotal = teacherPayroll.reduce((s, p) => s + p.amount, 0);

  return {
    period: query.period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    ...(academicYearId ? { academicYearId } : {}),
    ...(query.cycleId ? { cycleId: query.cycleId } : {}),
    totals: {
      expectedTuition,
      collectedTuition,
      recoveryRate: recoveryRateTotal,
      overdueCount: overdueInstallments.length,
      overdueAmount,
      teacherPayrollTotal,
    },
    recoveryByClass,
    overdueInstallments,
    teacherPayroll,
  };
}

export function buildOwnerFinancialReportCsv(data: OwnerFinancesResponse): string {
  const lines: string[] = [];
  lines.push("Rapport financier (propriétaire)");
  lines.push(`Période;${data.period}`);
  lines.push(`Du;${data.periodStart}`);
  lines.push(`Au;${data.periodEnd}`);
  lines.push("");
  lines.push("Indicateur;Valeur");
  lines.push(`Encours attendu;${data.totals.expectedTuition}`);
  lines.push(`Encours perçu;${data.totals.collectedTuition}`);
  lines.push(`Taux de recouvrement (%);${data.totals.recoveryRate}`);
  lines.push(`Nombre d'échéances en retard;${data.totals.overdueCount}`);
  lines.push(`Montant en retard;${data.totals.overdueAmount}`);
  lines.push(`Masse salariale enseignants;${data.totals.teacherPayrollTotal}`);
  lines.push("");
  lines.push("Classe;Cycle;Attendu;Perçu;Taux (%)");
  for (const r of data.recoveryByClass) {
    lines.push(
      `${escapeCsv(r.className)};${escapeCsv(r.cycleName ?? "")};${r.expected};${r.collected};${r.recoveryRate}`
    );
  }
  lines.push("");
  lines.push("Réf. élève (anonymisée);Classe;Montant dû;Échéance");
  for (const o of data.overdueInstallments) {
    lines.push(
      `${escapeCsv(o.studentRef)};${escapeCsv(o.className ?? "")};${o.amountDue};${o.dueDate}`
    );
  }
  lines.push("");
  lines.push("ID paiement;Enseignant;Période;Montant;Statut;Calculé le");
  for (const p of data.teacherPayroll) {
    lines.push(
      `${p.id};${escapeCsv(p.teacherName)};${escapeCsv(p.periodLabel ?? "")};${p.amount};${p.status};${p.calculatedAt}`
    );
  }
  return lines.join("\n");
}

function escapeCsv(s: string): string {
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildOwnerFinancialReportHtml(data: OwnerFinancesResponse): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
  const rows = data.recoveryByClass
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.className)}</td><td>${escapeHtml(r.cycleName ?? "—")}</td><td>${fmt(r.expected)}</td><td>${fmt(r.collected)}</td><td>${r.recoveryRate}%</td></tr>`
    )
    .join("");
  const overdueRows = data.overdueInstallments
    .map(
      (o) =>
        `<tr><td>${escapeHtml(o.studentRef)}</td><td>${escapeHtml(o.className ?? "—")}</td><td>${fmt(o.amountDue)}</td><td>${o.dueDate}</td></tr>`
    )
    .join("");
  const payrollRows = data.teacherPayroll
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.teacherName)}</td><td>${escapeHtml(p.periodLabel ?? "—")}</td><td>${fmt(p.amount)}</td><td>${escapeHtml(p.status)}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><title>Rapport financier</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px}th{background:#f4f4f4}.muted{color:#666;font-size:12px}</style>
</head><body>
<h1>Rapport financier</h1>
<p class="muted">Période : ${escapeHtml(data.period)} — du ${data.periodStart.slice(0, 10)} au ${data.periodEnd.slice(0, 10)}</p>
<h2>Synthèse</h2>
<ul>
<li>Encours attendu : ${fmt(data.totals.expectedTuition)}</li>
<li>Encours perçu : ${fmt(data.totals.collectedTuition)}</li>
<li>Taux de recouvrement : ${data.totals.recoveryRate}%</li>
<li>Échéances en retard : ${data.totals.overdueCount} (${fmt(data.totals.overdueAmount)})</li>
<li>Masse salariale enseignants : ${fmt(data.totals.teacherPayrollTotal)}</li>
</ul>
<h2>Recouvrement par classe</h2>
<table><thead><tr><th>Classe</th><th>Cycle</th><th>Attendu</th><th>Perçu</th><th>Taux</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Retards (réf. élève anonymisée)</h2>
<table><thead><tr><th>Réf.</th><th>Classe</th><th>Montant dû</th><th>Échéance</th></tr></thead><tbody>${overdueRows}</tbody></table>
<h2>Rémunérations enseignants</h2>
<table><thead><tr><th>Enseignant</th><th>Période</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${payrollRows}</tbody></table>
<p class="muted">Document généré le ${new Date().toLocaleString("fr-FR")}</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
