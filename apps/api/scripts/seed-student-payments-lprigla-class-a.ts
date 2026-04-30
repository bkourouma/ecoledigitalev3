/**
 * Enregistre en base des encaissements (payment_transactions completed) pour tous les étudiants
 * de la classe LP RIGL A (code J-LP-RIGLA-A-717), avec des profils variés :
 *   - certains : paiement complet (inscription, annexes, toutes les échéances scolarité)
 *   - d'autres : moitié sur inscription+annexes, ou scolarité partielle, etc.
 *
 * Prérequis : avoir exécuté seed:finances-lprigla (échéances + frais sur les inscriptions).
 *
 * Depuis apps/api : pnpm exec tsx scripts/seed-student-payments-lprigla-class-a.ts
 * Option : --append  → ne supprime pas les transactions existantes (sinon reset + réécriture).
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { Client } from "pg";

const TENANT_SLUG = "imhotepacademy";
/** Même code que seed-students / seed-finances LP RIGL A */
const CLASS_CODE = "J-LP-RIGLA-A-717";

type FeeBundle = {
  inscription: number;
  scolarite: number;
  annexes: number;
  autres: number;
};

function parseFees(raw: unknown): FeeBundle {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (k: string) => {
    const v = o[k] ?? o[k === "scolarite" ? "scolarité" : k] ?? o[k.toUpperCase()];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    inscription: num("inscription"),
    scolarite: num("scolarite"),
    annexes: num("annexes"),
    autres: num("autres"),
  };
}

async function insertPayment(
  client: Client,
  args: {
    tenantId: string;
    studentId: string;
    enrollmentId: string;
    feeType: "inscription" | "scolarite" | "annexes" | "autres";
    amount: number;
    tuitionInstallmentId: string | null;
    createdBy: string;
  }
) {
  if (args.amount <= 0) return;
  const id = randomUUID();
  await client.query(
    `INSERT INTO payment_transactions (
       id, tenant_id, student_id, enrollment_id, tuition_installment_id,
       fee_type, amount, currency, payment_method, status, processed_at, created_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6::payment_fee_type, $7, 'XOF', 'especes'::payment_method_type,
       'completed'::transaction_status, NOW(), $8
     )`,
    [
      id,
      args.tenantId,
      args.studentId,
      args.enrollmentId,
      args.tuitionInstallmentId,
      args.feeType,
      Math.round(args.amount * 100) / 100,
      args.createdBy,
    ]
  );
}

async function main() {
  const append = process.argv.includes("--append");
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

    const cl = await client.query<{ id: string }>(
      `SELECT id FROM classes WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
      [tenantId, CLASS_CODE]
    );
    if (cl.rows.length === 0) {
      throw new Error(`Classe ${CLASS_CODE} introuvable (créer la classe ou vérifier le code).`);
    }
    const classId = cl.rows[0].id;

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

    const enrRes = await client.query<{
      id: string;
      student_id: string;
      fees: unknown;
    }>(
      `SELECT id, student_id, fees FROM student_enrollments
       WHERE tenant_id = $1 AND class_id = $2 AND status = 'active'
       ORDER BY created_at ASC`,
      [tenantId, classId]
    );

    if (enrRes.rows.length === 0) {
      throw new Error("Aucune inscription active pour cette classe.");
    }

    const enrollmentIds = enrRes.rows.map((r) => r.id);

    if (!append) {
      await client.query(
        `DELETE FROM payment_notifications
         WHERE transaction_id IN (
           SELECT id FROM payment_transactions WHERE tenant_id = $1 AND enrollment_id = ANY($2::uuid[])
         )`,
        [tenantId, enrollmentIds]
      );
      await client.query(
        `DELETE FROM payment_transactions WHERE tenant_id = $1 AND enrollment_id = ANY($2::uuid[])`,
        [tenantId, enrollmentIds]
      );
      await client.query(
        `UPDATE student_tuition_installments
         SET amount_paid = 0, status = 'pending'::installment_status, updated_at = NOW()
         WHERE tenant_id = $1 AND enrollment_id = ANY($2::uuid[])`,
        [tenantId, enrollmentIds]
      );
      console.log(
        `Transactions existantes supprimées + échéances remises à zéro (${enrollmentIds.length} inscription(s)).`
      );
    }

    let txCount = 0;

    for (let i = 0; i < enrRes.rows.length; i++) {
      const enr = enrRes.rows[i];
      const fees = parseFees(enr.fees);
      const instRes = await client.query<{ id: string; installment_number: number; amount: string }>(
        `SELECT id, installment_number, amount::text
         FROM student_tuition_installments
         WHERE tenant_id = $1 AND enrollment_id = $2
         ORDER BY installment_number ASC`,
        [tenantId, enr.id]
      );
      const installments = instRes.rows.map((r) => ({
        id: r.id,
        number: r.installment_number,
        amount: Number(r.amount),
      }));

      const pattern = i % 4;
      const label = ["complet", "50% inscription+annexes (sans scolarité)", "complet sauf 1ère échéance à 50%", "complet sauf chaque échéance à 50%"][pattern];

      console.log(`\nÉtudiant #${i + 1} (inscription ${enr.id.slice(0, 8)}…) — profil : ${label}`);

      const pay = async (
        feeType: "inscription" | "scolarite" | "annexes" | "autres",
        amount: number,
        tuitionInstallmentId: string | null = null
      ) => {
        await insertPayment(client, {
          tenantId,
          studentId: enr.student_id,
          enrollmentId: enr.id,
          feeType,
          amount,
          tuitionInstallmentId,
          createdBy,
        });
        txCount++;
      };

      if (pattern === 0) {
        await pay("inscription", fees.inscription, null);
        await pay("annexes", fees.annexes, null);
        if (fees.autres > 0) await pay("autres", fees.autres, null);
        for (const inst of installments) {
          await pay("scolarite", inst.amount, inst.id);
        }
      } else if (pattern === 1) {
        await pay("inscription", Math.round((fees.inscription * 0.5 * 100) / 100), null);
        await pay("annexes", Math.round((fees.annexes * 0.5 * 100) / 100), null);
        if (fees.autres > 0) await pay("autres", Math.round((fees.autres * 0.5 * 100) / 100), null);
      } else if (pattern === 2) {
        await pay("inscription", fees.inscription, null);
        await pay("annexes", fees.annexes, null);
        if (fees.autres > 0) await pay("autres", fees.autres, null);
        if (installments.length > 0) {
          const first = installments[0];
          await pay("scolarite", Math.round(first.amount * 0.5 * 100) / 100, first.id);
        } else {
          console.warn("  (pas d’échéances scolarité — lancer pnpm seed:finances-lprigla)");
        }
      } else {
        await pay("inscription", fees.inscription, null);
        await pay("annexes", fees.annexes, null);
        if (fees.autres > 0) await pay("autres", fees.autres, null);
        if (installments.length === 0) {
          console.warn("  (pas d’échéances scolarité — lancer pnpm seed:finances-lprigla)");
        } else {
          for (const inst of installments) {
            await pay("scolarite", Math.round(inst.amount * 0.5 * 100) / 100, inst.id);
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`\nTerminé : ${txCount} transaction(s) enregistrée(s) (statut completed).`);
    console.log("Page : /admin/finances/student-payments");
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
