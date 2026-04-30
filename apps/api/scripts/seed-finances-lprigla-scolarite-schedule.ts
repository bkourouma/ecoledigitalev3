/**
 * 1) Barème Scolarité (cycles_frais) : cycle LICENCE + filière LP RIGL
 * 2) Échéancier (tuition_payment_schedules) pour l'année de la classe J-LP-RIGLA-A-717
 * 3) Mise à jour des frais sur les inscriptions de cette classe (scolarité > 0)
 * 4) Génération des lignes student_tuition_installments (comme « Générer les échéances »)
 *
 * Depuis apps/api : npx tsx scripts/seed-finances-lprigla-scolarite-schedule.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "imhotepacademy";
const CLASS_CODE = "J-LP-RIGLA-A-717";
const SCHEDULE_NAME = "LPRIGL - Echeancier officiel";

/** Montants par défaut (XOF) — typiques pour une LP au CI */
const BAR = {
  inscription: 200_000,
  scolarite: 1_200_000,
  annexes: 75_000,
  autres: 0,
  currency: "XOF",
};

const INSTALLMENTS: { percentage: number; dueDate: string; label: string }[] = [
  { percentage: 40, dueDate: "2025-10-15", label: "1ère échéance (40 %)" },
  { percentage: 35, dueDate: "2026-01-15", label: "2ème échéance (35 %)" },
  { percentage: 25, dueDate: "2026-04-15", label: "3ème échéance (25 %)" },
];

function assertPct100() {
  const t = INSTALLMENTS.reduce((s, i) => s + i.percentage, 0);
  if (Math.abs(t - 100) > 0.01) throw new Error(`Installments doivent totaliser 100 % (actuel ${t})`);
}

async function main() {
  assertPct100();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL manquant dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    const tRes = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [TENANT_SLUG]
    );
    if (tRes.rows.length === 0) throw new Error(`Tenant ${TENANT_SLUG} introuvable`);
    const tenantId = tRes.rows[0].id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    const cycleRes = await client.query<{ id: string }>(
      `SELECT id FROM cycles
       WHERE tenant_id = $1 AND (UPPER(code) = 'LICENCE' OR UPPER(code) = 'LICENSE')
       ORDER BY code
       LIMIT 1`,
      [tenantId]
    );
    if (cycleRes.rows.length === 0) {
      throw new Error("Cycle LICENCE introuvable pour ce tenant.");
    }
    const cycleId = cycleRes.rows[0].id;

    const progRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM programmes
       WHERE tenant_id = $1 AND cycle_id = $2
         AND (
           UPPER(code) LIKE '%LPRIGL%'
           OR name ILIKE '%Réseaux Informatiques%'
           OR name ILIKE '%Genie Logiciel%'
           OR name ILIKE '%Génie Logiciel%'
         )
       ORDER BY name
       LIMIT 1`,
      [tenantId, cycleId]
    );
    if (progRes.rows.length === 0) {
      throw new Error("Filière LP RIGL introuvable pour le cycle LICENCE.");
    }
    const programmeId = progRes.rows[0].id;
    console.log(`Filière : ${progRes.rows[0].name} (${programmeId})`);

    await client.query(
      `INSERT INTO cycles_frais (tenant_id, cycle_id, programme_id, inscription, scolarite, annexes, autres, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, cycle_id, programme_id)
       DO UPDATE SET inscription = EXCLUDED.inscription, scolarite = EXCLUDED.scolarite,
                     annexes = EXCLUDED.annexes, autres = EXCLUDED.autres, currency = EXCLUDED.currency,
                     updated_at = NOW()`,
      [
        tenantId,
        cycleId,
        programmeId,
        BAR.inscription,
        BAR.scolarite,
        BAR.annexes,
        BAR.autres,
        BAR.currency,
      ]
    );
    console.log(
      `Barème cycles_frais enregistré : inscription ${BAR.inscription}, scolarité ${BAR.scolarite}, annexes ${BAR.annexes} ${BAR.currency}`
    );

    const cl = await client.query<{
      id: string;
      academic_year_id: string;
    }>(
      `SELECT id, academic_year_id FROM classes WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
      [tenantId, CLASS_CODE]
    );
    if (cl.rows.length === 0) throw new Error(`Classe ${CLASS_CODE} introuvable`);
    const classId = cl.rows[0].id;
    const academicYearId = cl.rows[0].academic_year_id;

    const admin = await client.query<{ id: string }>(
      `SELECT u.id FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id AND r.tenant_id = u.tenant_id
       WHERE u.tenant_id = $1 AND r.key IN ('admin', 'super_admin')
       LIMIT 1`,
      [tenantId]
    );
    if (admin.rows.length === 0) throw new Error("Aucun utilisateur admin pour created_by.");
    const createdBy = admin.rows[0].id;

    const existingSch = await client.query<{ id: string }>(
      `SELECT id FROM tuition_payment_schedules
       WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND schedule_name = $4`,
      [tenantId, academicYearId, classId, SCHEDULE_NAME]
    );
    for (const row of existingSch.rows) {
      await client.query(`DELETE FROM student_tuition_installments WHERE schedule_id = $1`, [row.id]);
      await client.query(`DELETE FROM tuition_payment_schedules WHERE id = $1`, [row.id]);
      console.log(`Ancien échéancier supprimé : ${row.id}`);
    }

    const insSch = await client.query<{ id: string }>(
      `INSERT INTO tuition_payment_schedules (
         tenant_id, academic_year_id, class_id, schedule_name, installments, is_active, created_by
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, true, $6)
       RETURNING id`,
      [
        tenantId,
        academicYearId,
        classId,
        SCHEDULE_NAME,
        JSON.stringify(INSTALLMENTS),
        createdBy,
      ]
    );
    const scheduleId = insSch.rows[0].id;
    console.log(`Échéancier créé : ${scheduleId} — ${SCHEDULE_NAME}`);

    const totalFees =
      Number(BAR.inscription) + Number(BAR.scolarite) + Number(BAR.annexes) + Number(BAR.autres);
    const feesJson = {
      inscription: BAR.inscription,
      scolarite: BAR.scolarite,
      annexes: BAR.annexes,
      autres: BAR.autres,
      total: totalFees,
      currency: BAR.currency,
    };

    const updEnr = await client.query(
      `UPDATE student_enrollments
       SET fees = $1::jsonb, updated_at = NOW()
       WHERE tenant_id = $2 AND class_id = $3`,
      [JSON.stringify(feesJson), tenantId, classId]
    );
    console.log(`Inscriptions mises à jour (frais) : ${updEnr.rowCount ?? 0} ligne(s)`);

    const enrRes = await client.query<{ id: string; student_id: string; fees: Record<string, unknown> }>(
      `SELECT id, student_id, fees FROM student_enrollments
       WHERE tenant_id = $1 AND class_id = $2 AND status = 'active'`,
      [tenantId, classId]
    );

    let createdInst = 0;
    for (const enr of enrRes.rows) {
      const fees = enr.fees as { scolarite?: number };
      const scolarite = Number(fees?.scolarite ?? 0);
      if (!scolarite || scolarite <= 0) continue;

      for (let idx = 0; idx < INSTALLMENTS.length; idx++) {
        const inst = INSTALLMENTS[idx];
        const installmentNumber = idx + 1;
        const rawAmount = (scolarite * inst.percentage) / 100;
        const amount = Math.round(rawAmount * 100) / 100;
        await client.query(
          `INSERT INTO student_tuition_installments (
             tenant_id, student_id, enrollment_id, schedule_id,
             installment_number, installment_label, amount, due_date
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
           ON CONFLICT (tenant_id, enrollment_id, installment_number)
           DO UPDATE SET
             schedule_id = EXCLUDED.schedule_id,
             installment_label = EXCLUDED.installment_label,
             amount = EXCLUDED.amount,
             due_date = EXCLUDED.due_date,
             updated_at = NOW()`,
          [
            tenantId,
            enr.student_id,
            enr.id,
            scheduleId,
            installmentNumber,
            inst.label,
            amount,
            inst.dueDate,
          ]
        );
        createdInst++;
      }
    }

    await client.query("COMMIT");
    console.log(`\nÉchéances générées : ${createdInst} ligne(s) (student_tuition_installments).`);
    console.log(`Pages : /admin/finances/scolarite | /admin/finances/tuition-schedules`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
