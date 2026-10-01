/**
 * Crée 30 étudiants (compte + profil + inscription) pour la classe BTS-GERNA-1-500.
 *
 * Depuis apps/api :
 *   npx tsx scripts/seed-students-bts-gerna-1-500.ts
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const CLASS_CODE = "BTS-GERNA-1-500";
const DEFAULT_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());

type SeedStudent = {
  firstName: string;
  lastName: string;
  email: string;
  gender: "masculin" | "feminin";
};

const STUDENTS: SeedStudent[] = [
  { firstName: "Kouamé", lastName: "Kouadio", email: "kouame.kouadio.gerna01@example.com", gender: "masculin" },
  { firstName: "Aminata", lastName: "Koné", email: "aminata.kone.gerna02@example.com", gender: "feminin" },
  { firstName: "Jean-Philippe", lastName: "Yao", email: "jeanphilippe.yao.gerna03@example.com", gender: "masculin" },
  { firstName: "Nadège", lastName: "N'Guessan", email: "nadege.nguessan.gerna04@example.com", gender: "feminin" },
  { firstName: "Moussa", lastName: "Traoré", email: "moussa.traore.gerna05@example.com", gender: "masculin" },
  { firstName: "Awa", lastName: "Bamba", email: "awa.bamba.gerna06@example.com", gender: "feminin" },
  { firstName: "Yannick", lastName: "Assi", email: "yannick.assi.gerna07@example.com", gender: "masculin" },
  { firstName: "Fatoumata", lastName: "Ouattara", email: "fatoumata.ouattara.gerna08@example.com", gender: "feminin" },
  { firstName: "Landry", lastName: "Adjoua", email: "landry.adjoua.gerna09@example.com", gender: "masculin" },
  { firstName: "Mariam", lastName: "Diabaté", email: "mariam.diabate.gerna10@example.com", gender: "feminin" },
  { firstName: "Koffi", lastName: "Kouassi", email: "koffi.kouassi.gerna11@example.com", gender: "masculin" },
  { firstName: "Grâce", lastName: "Kacou", email: "grace.kacou.gerna12@example.com", gender: "feminin" },
  { firstName: "Armand", lastName: "Dago", email: "armand.dago.gerna13@example.com", gender: "masculin" },
  { firstName: "Clarisse", lastName: "Ahou", email: "clarisse.ahou.gerna14@example.com", gender: "feminin" },
  { firstName: "Wilfried", lastName: "Gohou", email: "wilfried.gohou.gerna15@example.com", gender: "masculin" },
  { firstName: "Eunice", lastName: "Tano", email: "eunice.tano.gerna16@example.com", gender: "feminin" },
  { firstName: "Franck", lastName: "Soro", email: "franck.soro.gerna17@example.com", gender: "masculin" },
  { firstName: "Ornella", lastName: "Kouamé", email: "ornella.kouame.gerna18@example.com", gender: "feminin" },
  { firstName: "Boris", lastName: "Koulibaly", email: "boris.koulibaly.gerna19@example.com", gender: "masculin" },
  { firstName: "Déborah", lastName: "Amon", email: "deborah.amon.gerna20@example.com", gender: "feminin" },
  { firstName: "Ismaël", lastName: "Fofana", email: "ismael.fofana.gerna21@example.com", gender: "masculin" },
  { firstName: "Sita", lastName: "Yapi", email: "sita.yapi.gerna22@example.com", gender: "feminin" },
  { firstName: "Joël", lastName: "N'Zi", email: "joel.nzi.gerna23@example.com", gender: "masculin" },
  { firstName: "Christelle", lastName: "Ehui", email: "christelle.ehui.gerna24@example.com", gender: "feminin" },
  { firstName: "Brice", lastName: "Aka", email: "brice.aka.gerna25@example.com", gender: "masculin" },
  { firstName: "Mireille", lastName: "Gnagne", email: "mireille.gnagne.gerna26@example.com", gender: "feminin" },
  { firstName: "Serge", lastName: "Guei", email: "serge.guei.gerna27@example.com", gender: "masculin" },
  { firstName: "Noëlla", lastName: "Kouadio", email: "noella.kouadio.gerna28@example.com", gender: "feminin" },
  { firstName: "Romaric", lastName: "Ahibo", email: "romaric.ahibo.gerna29@example.com", gender: "masculin" },
  { firstName: "Jessica", lastName: "Zan", email: "jessica.zan.gerna30@example.com", gender: "feminin" },
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
      throw new Error(`Classe introuvable avec le code « ${CLASS_CODE} ».`);
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
      throw new Error("Rôle « student » introuvable pour ce tenant.");
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
        console.log(`  + ${s.firstName} ${s.lastName} — ${s.email} — matricule ${establishmentMatricule}`);
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
