/**
 * Crée 10 étudiants (compte + profil + inscription) pour la classe au code J-LP-RIGLA-A-717.
 * Même logique que POST /api/v1/students/with-user (sans passer par HTTP).
 *
 * Depuis apps/api : npx tsx scripts/seed-students-lprigla-class-a.ts
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const CLASS_CODE = "J-LP-RIGLA-A-717";
const DEFAULT_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());

type SeedStudent = {
  firstName: string;
  lastName: string;
  email: string;
  gender: "masculin" | "feminin";
};

const STUDENTS: SeedStudent[] = [
  { firstName: "Fabrice", lastName: "Kouadio", email: "fabrice.kouadio.lprigla01@example.com", gender: "masculin" },
  { firstName: "Estelle", lastName: "Koné", email: "estelle.kone.lprigla02@example.com", gender: "feminin" },
  { firstName: "Jean-Marc", lastName: "Yao", email: "jeanmarc.yao.lprigla03@example.com", gender: "masculin" },
  { firstName: "Cynthia", lastName: "Assi", email: "cynthia.assi.lprigla04@example.com", gender: "feminin" },
  { firstName: "Mohamed", lastName: "Touré", email: "mohamed.toure.lprigla05@example.com", gender: "masculin" },
  { firstName: "Sandra", lastName: "N'Guessan", email: "sandra.nguessan.lprigla06@example.com", gender: "feminin" },
  { firstName: "Jaurès", lastName: "Bamba", email: "jaures.bamba.lprigla07@example.com", gender: "masculin" },
  { firstName: "Prisca", lastName: "Diabaté", email: "prisca.diabate.lprigla08@example.com", gender: "feminin" },
  { firstName: "Hugo", lastName: "Adjobi", email: "hugo.adjobi.lprigla09@example.com", gender: "masculin" },
  { firstName: "Mariame", lastName: "Ouattara", email: "mariame.ouattara.lprigla10@example.com", gender: "feminin" },
];

async function getNextEstablishmentMatricule(client: Client, tenantId: string): Promise<string> {
  const res = await client.query(
    `
      SELECT COALESCE(
        MAX(CASE WHEN establishment_matricule ~ '^[0-9]{5}$' THEN establishment_matricule::int END),
        10000
      ) + 1 AS next_value
      FROM student_profiles
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const nextValue = Number(res.rows[0]?.next_value || 10001);
  return String(nextValue).padStart(5, "0");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent. Définissez-le dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const classRes = await client.query<{
      id: string;
      tenant_id: string;
      academic_year_id: string;
      name: string;
      code: string;
      programme_name: string;
    }>(
      `
      SELECT c.id, c.tenant_id, c.academic_year_id, c.name, c.code, p.name AS programme_name
      FROM classes c
      JOIN programmes p ON p.id = c.programme_id
      WHERE c.code = $1
      LIMIT 1
    `,
      [CLASS_CODE]
    );

    if (classRes.rows.length === 0) {
      throw new Error(
        `Classe introuvable avec le code « ${CLASS_CODE} ». Vérifiez le code exact dans la base.`
      );
    }

    const classRow = classRes.rows[0];
    const tenantId = classRow.tenant_id;
    console.log(
      `Classe: ${classRow.name} (${classRow.code}) — ${classRow.programme_name}\nTenant: ${tenantId}\n`
    );

    const [{ rows: genderCol }, { rows: classIdCol }] = await Promise.all([
      client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_profiles' AND column_name = 'gender'`
      ),
      client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_profiles' AND column_name = 'class_id'`
      ),
    ]);
    const hasGenderColumn = genderCol.length > 0;
    const hasClassIdColumn = classIdCol.length > 0;

    const roleRes = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'student' LIMIT 1`,
      [tenantId]
    );
    if (roleRes.rows.length === 0) {
      throw new Error("Rôle « student » introuvable pour ce tenant. Lancez un seed de base d’abord.");
    }
    const studentRoleId = roleRes.rows[0].id;

    const defaultFees = {
      inscription: 0,
      scolarite: 0,
      annexes: 0,
      autres: 0,
      total: 0,
      currency: "XOF",
    };
    const enrollmentDate = new Date().toISOString().split("T")[0];

    let created = 0;
    let skipped = 0;

    for (const s of STUDENTS) {
      const exists = await client.query(`SELECT 1 FROM users WHERE tenant_id = $1 AND email = $2`, [
        tenantId,
        s.email,
      ]);
      if (exists.rows.length > 0) {
        console.log(`  = déjà existant (e-mail) : ${s.firstName} ${s.lastName}`);
        skipped++;
        continue;
      }

      await client.query("BEGIN");
      try {
        const establishmentMatricule = await getNextEstablishmentMatricule(client, tenantId);
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
        const fullName = `${s.firstName} ${s.lastName}`;

        const userResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [tenantId, s.email, fullName, s.firstName, s.lastName, passwordHash]
        );
        const userId = userResult.rows[0].id;

        await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
          userId,
          studentRoleId,
        ]);

        const genderColumn = hasGenderColumn ? ", gender" : "";
        const genderValue = hasGenderColumn ? ", $35" : "";
        const genderReturn = hasGenderColumn ? ", gender" : "";

        const studentInsertQuery = `
          INSERT INTO student_profiles (
            tenant_id, user_id, student_number, current_year, status, bio,
            date_of_birth, place_of_birth, nationality, address, phone, emergency_phone,
            father_name, mother_name, birth_certificate_number, birth_certificate_date,
            civil_registry_office, sub_prefecture, origin_school, is_repeating, lv2, scholarship_level,
            is_transfer, transfer_decision, affectation_status, affectation_decision, cepe_code,
            is_inscribed, inscription_date, residence, establishment_matricule, dsps_matricule, dsps_previous_matricule, initial_password${genderColumn}
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
            $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
            ${genderValue}
          )
          RETURNING id
        `;

        const studentParams: unknown[] = [
          tenantId,
          userId,
          establishmentMatricule,
          1,
          "active",
          null,
          null,
          null,
          "Ivoirienne",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          false,
          null,
          null,
          false,
          null,
          null,
          null,
          null,
          true,
          enrollmentDate,
          null,
          establishmentMatricule,
          null,
          null,
          DEFAULT_PASSWORD,
        ];
        if (hasGenderColumn) {
          studentParams.push(s.gender);
        }

        const studentResult = await client.query(studentInsertQuery, studentParams);
        const studentProfileId = studentResult.rows[0].id;

        await client.query(
          `INSERT INTO student_enrollments (
             tenant_id, student_id, class_id, academic_year_id, fees, enrollment_date, status
           ) VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
          [
            tenantId,
            studentProfileId,
            classRow.id,
            classRow.academic_year_id,
            JSON.stringify(defaultFees),
            enrollmentDate,
          ]
        );

        if (hasClassIdColumn) {
          await client.query(
            `UPDATE student_profiles SET class_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [classRow.id, studentProfileId, tenantId]
          );
        }

        await client.query("COMMIT");
        created++;
        console.log(
          `  + ${s.firstName} ${s.lastName} — ${s.email} — matricule ${establishmentMatricule}`
        );
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    console.log(`\nTerminé : ${created} étudiant(s) créé(s), ${skipped} ignoré(s).`);
    if (created > 0) {
      console.log(`Mot de passe commun (connexion) : ${DEFAULT_PASSWORD}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
