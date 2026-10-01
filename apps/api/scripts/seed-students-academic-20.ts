/**
 * Crée 20 étudiants (compte + profil permanent) pour le tenant « ecoledigitale ».
 * Reproduit exactement la logique de POST /api/v1/students/with-user, telle
 * qu'appelée par la page /academic/students/new (profil permanent uniquement :
 * aucune inscription en classe, celle-ci se fait depuis Année académique).
 *
 * Depuis apps/api : npx tsx scripts/seed-students-academic-20.ts
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const TENANT_SLUG = "ecoledigitale";
const DEFAULT_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
const EMAIL_DOMAIN = "etudiant.ecoledigitale.ci";

type SeedStudent = {
  firstName: string;
  lastName: string;
  /** Matricule saisi (colonne student_matricule) — obligatoire depuis la migration 0088. */
  matricule: string;
  gender: "masculin" | "feminin";
  dateOfBirth: string;
  placeOfBirth: string;
  residence: string;
  phone: string;
  bacObtentionDate: string;
  bacSeries: string;
};

const STUDENTS: SeedStudent[] = [
  { firstName: "Adama", lastName: "Coulibaly", matricule: "ED-2026-001", gender: "masculin", dateOfBirth: "2005-03-14", placeOfBirth: "Abidjan, Côte d'Ivoire", residence: "Abidjan - Cocody", phone: "0701020304", bacObtentionDate: "2023-07-20", bacSeries: "D" },
  { firstName: "Aminata", lastName: "Bakayoko", matricule: "ED-2026-002", gender: "feminin", dateOfBirth: "2005-06-02", placeOfBirth: "Bouaké, Côte d'Ivoire", residence: "Abidjan - Yopougon", phone: "0701020305", bacObtentionDate: "2023-07-20", bacSeries: "C" },
  { firstName: "Serge", lastName: "Gbagbo", matricule: "ED-2026-003", gender: "masculin", dateOfBirth: "2004-11-23", placeOfBirth: "Gagnoa, Côte d'Ivoire", residence: "Abidjan - Abobo", phone: "0701020306", bacObtentionDate: "2022-07-22", bacSeries: "G2" },
  { firstName: "Awa", lastName: "Traoré", matricule: "ED-2026-004", gender: "feminin", dateOfBirth: "2005-01-09", placeOfBirth: "Korhogo, Côte d'Ivoire", residence: "Abidjan - Adjamé", phone: "0701020307", bacObtentionDate: "2023-07-20", bacSeries: "D" },
  { firstName: "Yannick", lastName: "Kouassi", matricule: "ED-2026-005", gender: "masculin", dateOfBirth: "2005-08-17", placeOfBirth: "Yamoussoukro, Côte d'Ivoire", residence: "Abidjan - Marcory", phone: "0701020308", bacObtentionDate: "2023-07-20", bacSeries: "C" },
  { firstName: "Rachelle", lastName: "Aka", matricule: "ED-2026-006", gender: "feminin", dateOfBirth: "2004-09-30", placeOfBirth: "Abidjan, Côte d'Ivoire", residence: "Abidjan - Treichville", phone: "0701020309", bacObtentionDate: "2022-07-22", bacSeries: "A2" },
  { firstName: "Ibrahim", lastName: "Cissé", matricule: "ED-2026-007", gender: "masculin", dateOfBirth: "2005-04-05", placeOfBirth: "Man, Côte d'Ivoire", residence: "Abidjan - Koumassi", phone: "0701020310", bacObtentionDate: "2023-07-20", bacSeries: "D" },
  { firstName: "Nadège", lastName: "Boni", matricule: "ED-2026-008", gender: "feminin", dateOfBirth: "2005-12-11", placeOfBirth: "Daloa, Côte d'Ivoire", residence: "Abidjan - Cocody", phone: "0701020311", bacObtentionDate: "2023-07-20", bacSeries: "G2" },
  { firstName: "Cédric", lastName: "Anoh", matricule: "ED-2026-009", gender: "masculin", dateOfBirth: "2004-07-19", placeOfBirth: "Abengourou, Côte d'Ivoire", residence: "Abidjan - Plateau", phone: "0701020312", bacObtentionDate: "2022-07-22", bacSeries: "C" },
  { firstName: "Fatoumata", lastName: "Sangaré", matricule: "ED-2026-010", gender: "feminin", dateOfBirth: "2005-02-27", placeOfBirth: "Odienné, Côte d'Ivoire", residence: "Abidjan - Yopougon", phone: "0701020313", bacObtentionDate: "2023-07-20", bacSeries: "D" },
  { firstName: "Olivier", lastName: "Zadi", matricule: "ED-2026-011", gender: "masculin", dateOfBirth: "2005-05-21", placeOfBirth: "San-Pédro, Côte d'Ivoire", residence: "Abidjan - Port-Bouët", phone: "0701020314", bacObtentionDate: "2023-07-20", bacSeries: "A1" },
  { firstName: "Grâce", lastName: "Tanoh", matricule: "ED-2026-012", gender: "feminin", dateOfBirth: "2004-10-08", placeOfBirth: "Aboisso, Côte d'Ivoire", residence: "Abidjan - Bingerville", phone: "0701020315", bacObtentionDate: "2022-07-22", bacSeries: "D" },
  { firstName: "Moussa", lastName: "Diallo", matricule: "ED-2026-013", gender: "masculin", dateOfBirth: "2005-09-13", placeOfBirth: "Ferkessédougou, Côte d'Ivoire", residence: "Abidjan - Abobo", phone: "0701020316", bacObtentionDate: "2023-07-20", bacSeries: "G2" },
  { firstName: "Léa", lastName: "Guédé", matricule: "ED-2026-014", gender: "feminin", dateOfBirth: "2005-07-04", placeOfBirth: "Divo, Côte d'Ivoire", residence: "Abidjan - Cocody", phone: "0701020317", bacObtentionDate: "2023-07-20", bacSeries: "C" },
  { firstName: "Emmanuel", lastName: "Brou", matricule: "ED-2026-015", gender: "masculin", dateOfBirth: "2004-12-29", placeOfBirth: "Dimbokro, Côte d'Ivoire", residence: "Abidjan - Adjamé", phone: "0701020318", bacObtentionDate: "2022-07-22", bacSeries: "D" },
  { firstName: "Mariam", lastName: "Fofana", matricule: "ED-2026-016", gender: "feminin", dateOfBirth: "2005-03-25", placeOfBirth: "Séguéla, Côte d'Ivoire", residence: "Abidjan - Marcory", phone: "0701020319", bacObtentionDate: "2023-07-20", bacSeries: "A2" },
  { firstName: "Franck", lastName: "Ekra", matricule: "ED-2026-017", gender: "masculin", dateOfBirth: "2005-10-16", placeOfBirth: "Bondoukou, Côte d'Ivoire", residence: "Abidjan - Koumassi", phone: "0701020320", bacObtentionDate: "2023-07-20", bacSeries: "C" },
  { firstName: "Chantal", lastName: "Djédjé", matricule: "ED-2026-018", gender: "feminin", dateOfBirth: "2004-08-07", placeOfBirth: "Soubré, Côte d'Ivoire", residence: "Abidjan - Treichville", phone: "0701020321", bacObtentionDate: "2022-07-22", bacSeries: "G2" },
  { firstName: "Arnaud", lastName: "Konan", matricule: "ED-2026-019", gender: "masculin", dateOfBirth: "2005-01-31", placeOfBirth: "Bouaflé, Côte d'Ivoire", residence: "Abidjan - Cocody", phone: "0701020322", bacObtentionDate: "2023-07-20", bacSeries: "D" },
  { firstName: "Sylvie", lastName: "Ouedraogo", matricule: "ED-2026-020", gender: "feminin", dateOfBirth: "2005-11-18", placeOfBirth: "Katiola, Côte d'Ivoire", residence: "Abidjan - Anyama", phone: "0701020323", bacObtentionDate: "2023-07-20", bacSeries: "C" },
];

/** Slug e-mail sans accents ni caractères spéciaux. */
const emailSlug = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

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
  return String(Number(res.rows[0]?.next_value || 10001)).padStart(5, "0");
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
    const tenantRes = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [TENANT_SLUG]
    );
    if (tenantRes.rows.length === 0) {
      throw new Error(`Tenant « ${TENANT_SLUG} » introuvable.`);
    }
    const tenantId = tenantRes.rows[0].id;

    const roleRes = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE key = 'student' AND COALESCE(is_active, true) = true LIMIT 1`
    );
    if (roleRes.rows.length === 0) {
      throw new Error("Rôle « student » introuvable.");
    }
    const studentRoleId = roleRes.rows[0].id;

    const genderCol = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'student_profiles' AND column_name = 'gender'`
    );
    const hasGenderColumn = genderCol.rows.length > 0;

    let created = 0;
    let skipped = 0;

    for (const s of STUDENTS) {
      const email = `${emailSlug(s.firstName)}.${emailSlug(s.lastName)}@${EMAIL_DOMAIN}`;

      const exists = await client.query(
        `SELECT 1 FROM users WHERE tenant_id = $1 AND LOWER(email) = $2`,
        [tenantId, email]
      );
      if (exists.rows.length > 0) {
        console.log(`  = déjà existant : ${s.firstName} ${s.lastName} (${email})`);
        skipped++;
        continue;
      }

      await client.query("BEGIN");
      try {
        const establishmentMatricule = await getNextEstablishmentMatricule(client, tenantId);
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
        const fullName = `${s.firstName} ${s.lastName}`;

        const userResult = await client.query<{ id: string }>(
          `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [tenantId, email, fullName, s.firstName, s.lastName, passwordHash]
        );
        const userId = userResult.rows[0].id;

        await client.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
          [tenantId, userId, studentRoleId]
        );

        const fields = [
          "tenant_id",
          "user_id",
          "student_number",
          "current_year",
          "status",
          "date_of_birth",
          "place_of_birth",
          "nationality",
          "phone",
          "residence",
          "student_matricule",
          "establishment_matricule",
          "bac_obtention_date",
          "bac_series",
          "initial_password",
        ];
        const params: unknown[] = [
          tenantId,
          userId,
          establishmentMatricule,
          1,
          "active",
          s.dateOfBirth,
          s.placeOfBirth,
          "Ivoirienne",
          s.phone,
          s.residence,
          s.matricule,
          establishmentMatricule,
          s.bacObtentionDate,
          s.bacSeries,
          DEFAULT_PASSWORD,
        ];
        if (hasGenderColumn) {
          fields.push("gender");
          params.push(s.gender);
        }

        await client.query(
          `INSERT INTO student_profiles (${fields.join(", ")})
           VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")})`,
          params
        );

        await client.query("COMMIT");
        created++;
        console.log(
          `  + ${fullName} — ${email} — matricule ${s.matricule} — n° établissement ${establishmentMatricule}`
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
