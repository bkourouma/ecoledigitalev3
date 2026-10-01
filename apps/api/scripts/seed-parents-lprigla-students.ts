/**
 * Crée des comptes parents (rôle parent) et lie les 10 étudiants LPRIGL classe A.
 * Un parent (Marie-Amélie Koffi) est lié à deux enfants (Fabrice + Estelle).
 *
 * Depuis apps/api : npx tsx scripts/seed-parents-lprigla-students.ts
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const TENANT_SLUG = "imhotepacademy";
const PARENT_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());

/** E-mails étudiants (seed-students-lprigla-class-a), ordre = index 0..9 */
const STUDENT_EMAILS = [
  "fabrice.kouadio.lprigla01@example.com",
  "estelle.kone.lprigla02@example.com",
  "jeanmarc.yao.lprigla03@example.com",
  "cynthia.assi.lprigla04@example.com",
  "mohamed.toure.lprigla05@example.com",
  "sandra.nguessan.lprigla06@example.com",
  "jaures.bamba.lprigla07@example.com",
  "prisca.diabate.lprigla08@example.com",
  "hugo.adjobi.lprigla09@example.com",
  "mariame.ouattara.lprigla10@example.com",
] as const;

type ParentDef = {
  email: string;
  firstName: string;
  lastName: string;
  /** indices 0..9 dans STUDENT_EMAILS */
  studentIndices: number[];
};

/** Parent 0 : deux enfants (Fabrice + Estelle) */
const PARENTS: ParentDef[] = [
  {
    email: "marie.koffi.parent.lprigla@example.com",
    firstName: "Marie-Amélie",
    lastName: "Koffi",
    studentIndices: [0, 1],
  },
  {
    email: "francois.yao.parent.lprigla@example.com",
    firstName: "François",
    lastName: "Yao",
    studentIndices: [2],
  },
  {
    email: "henri.assi.parent.lprigla@example.com",
    firstName: "Henri",
    lastName: "Assi",
    studentIndices: [3],
  },
  {
    email: "aissata.toure.parent.lprigla@example.com",
    firstName: "Aïssata",
    lastName: "Touré",
    studentIndices: [4],
  },
  {
    email: "luc.nguessan.parent.lprigla@example.com",
    firstName: "Luc",
    lastName: "N'Guessan",
    studentIndices: [5],
  },
  {
    email: "awa.bamba.parent.lprigla@example.com",
    firstName: "Awa",
    lastName: "Bamba",
    studentIndices: [6],
  },
  {
    email: "kadi.diabate.parent.lprigla@example.com",
    firstName: "Kadi",
    lastName: "Diabaté",
    studentIndices: [7],
  },
  {
    email: "noel.adjobi.parent.lprigla@example.com",
    firstName: "Noël",
    lastName: "Adjobi",
    studentIndices: [8],
  },
  {
    email: "fatoumata.ouattara.parent.lprigla@example.com",
    firstName: "Fatoumata",
    lastName: "Ouattara",
    studentIndices: [9],
  },
];

async function ensureParentRole(client: Client, tenantId: string): Promise<string> {
  const r = await client.query(`SELECT id FROM roles WHERE tenant_id = $1 AND key = 'parent'`, [tenantId]);
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await client.query(
    `INSERT INTO roles (tenant_id, key, name, created_at, updated_at)
     VALUES ($1, 'parent', 'Parent', NOW(), NOW())
     RETURNING id`,
    [tenantId]
  );
  return ins.rows[0].id;
}

async function getOrCreateParentUser(
  client: Client,
  tenantId: string,
  roleId: string,
  p: ParentDef,
  usersHasInitialPassword: boolean
): Promise<string> {
  const normalizedEmail = p.email.trim().toLowerCase();
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
    [tenantId, normalizedEmail]
  );
  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id;
    const hasParent = await client.query(
      `SELECT 1 FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id AND r.tenant_id = $2
       WHERE ur.user_id = $1 AND r.key = 'parent'`,
      [userId, tenantId]
    );
    if (hasParent.rows.length === 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleId]
      );
    }
    return userId;
  }

  const passwordHash = await bcrypt.hash(PARENT_PASSWORD, 10);
  const fullName = `${p.firstName} ${p.lastName}`;
  const cols = usersHasInitialPassword
    ? `tenant_id, email, name, first_name, last_name, password_hash, initial_password, created_at, updated_at, role_updated_at`
    : `tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at, role_updated_at`;
  const vals = usersHasInitialPassword
    ? `($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())`
    : `($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())`;
  const params = usersHasInitialPassword
    ? [tenantId, normalizedEmail, fullName, p.firstName, p.lastName, passwordHash, PARENT_PASSWORD]
    : [tenantId, normalizedEmail, fullName, p.firstName, p.lastName, passwordHash];

  const ins = await client.query(`INSERT INTO users (${cols}) VALUES ${vals} RETURNING id`, params);
  const userId = ins.rows[0].id;
  await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  return userId;
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
    const t = await client.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
    if (t.rows.length === 0) throw new Error(`Tenant « ${TENANT_SLUG} » introuvable.`);
    const tenantId = t.rows[0].id;

    const studentIds: (string | null)[] = new Array(10).fill(null);
    for (let i = 0; i < STUDENT_EMAILS.length; i++) {
      const res = await client.query<{ id: string }>(
        `SELECT sp.id
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.tenant_id = $1 AND LOWER(u.email) = LOWER($2)`,
        [tenantId, STUDENT_EMAILS[i]]
      );
      if (res.rows.length === 0) {
        console.warn(`Étudiant introuvable pour ${STUDENT_EMAILS[i]} — exécutez d’abord seed-students-lprigla-class-a.`);
      } else {
        studentIds[i] = res.rows[0].id;
      }
    }

    if (studentIds.some((id) => id == null)) {
      throw new Error("Tous les étudiants LPRIGL ne sont pas en base. Lancez seed:students-lprigla-a d’abord.");
    }

    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'initial_password'`
    );
    const usersHasInitialPassword = colCheck.rows.length > 0;

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    const roleId = await ensureParentRole(client, tenantId);
    let linksCreated = 0;
    let linksSkipped = 0;

    for (const p of PARENTS) {
      const parentUserId = await getOrCreateParentUser(client, tenantId, roleId, p, usersHasInitialPassword);

      for (const idx of p.studentIndices) {
        const sid = studentIds[idx]!;
        const ins = await client.query(
          `INSERT INTO student_parents (
             tenant_id, student_id, parent_id, relationship_type,
             is_primary_contact, emergency_contact, can_pickup, notes, created_at
           )
           VALUES ($1, $2, $3, 'parent', $4, $5, true, NULL, NOW())
           ON CONFLICT (tenant_id, student_id, parent_id) DO NOTHING
           RETURNING id`,
          [
            tenantId,
            sid,
            parentUserId,
            idx === p.studentIndices[0],
            false,
          ]
        );
        if (ins.rowCount && ins.rows.length > 0) {
          linksCreated++;
          console.log(
            `  + Lien ${p.firstName} ${p.lastName} → ${STUDENT_EMAILS[idx]} (étudiant #${idx + 1})`
          );
        } else {
          linksSkipped++;
          console.log(`  = Lien déjà existant : parent ${p.email} ↔ ${STUDENT_EMAILS[idx]}`);
        }
      }
    }

    await client.query("COMMIT");

    console.log(`\nRésumé : ${linksCreated} lien(s) parent–étudiant créé(s), ${linksSkipped} déjà présent(s).`);
    console.log(`Mot de passe parent (nouveaux comptes) : ${PARENT_PASSWORD}`);
    console.log(
      `\nParent à deux enfants : Marie-Amélie Koffi (${PARENTS[0].email}) → Fabrice Kouadio + Estelle Koné.`
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
