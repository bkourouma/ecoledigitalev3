/**
 * Crée ou met à jour le compte démo propriétaire sur le tenant imhotepacademy.
 * À lancer depuis apps/api : npm run seed:owner
 * (utilise DATABASE_URL de apps/api/.env — la même base que npm run dev)
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const TENANT_SLUG = "imhotepacademy";
const DEMO_EMAIL = "owner@imhotepacademy.fr";
const DEMO_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent. Définissez-le dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    let tenantId: string;
    const tenantRes = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [TENANT_SLUG]
    );
    if (tenantRes.rows.length === 0) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, settings_json)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id`,
        [TENANT_SLUG, "Imhotep Academy", JSON.stringify({ subdomain: TENANT_SLUG })]
      );
      tenantId = ins.rows[0].id;
      console.log("Tenant créé:", TENANT_SLUG, tenantId);
    } else {
      tenantId = tenantRes.rows[0].id;
      console.log("Tenant existant:", TENANT_SLUG, tenantId);
    }

    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (tenant_id, key, name)
       VALUES ($1, 'owner', 'Propriétaire')
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING id`,
      [tenantId]
    );
    const roleId = roleRes.rows[0].id;
    console.log("Rôle owner:", roleId);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const firstName = "Propriétaire";
    const lastName = "Démo";
    const fullName = `${firstName} ${lastName}`.trim();

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         password_hash = EXCLUDED.password_hash,
         updated_at = NOW()
       RETURNING id`,
      [tenantId, DEMO_EMAIL, fullName, firstName, lastName, passwordHash]
    );
    const userId = userRes.rows[0].id;
    console.log("Utilisateur:", DEMO_EMAIL, userId);

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId]
    );

    await client.query("COMMIT");
    console.log("\nTerminé. Connexion web :", DEMO_EMAIL, "/", DEMO_PASSWORD);
    console.log("Tenant (header / carte démo) :", TENANT_SLUG);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Échec :", e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
