import fs from "fs";
import path from "path";
import { Client } from "pg";
import bcrypt from "bcryptjs";

/** Charge `apps/api/.env` si présent, pour aligner DATABASE_URL sur `npm run dev` dans apps/api. */
function loadApiEnv(): void {
  const envPath = path.resolve(__dirname, "../../apps/api/.env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadApiEnv();

// Database configuration — DATABASE_URL prioritaire (souvent depuis apps/api/.env)
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale";

// Reference tenant used by the unified multi-tenant model
const tenants = [
  { slug: "ecoledigitale", name: "ecoledigitale" },
];

// Global roles (assignments are tenant-scoped through user_roles)
const roles = [
  { key: "admin", name: "Administrateur" },
  { key: "owner", name: "Propriétaire" },
  { key: "student", name: "Étudiant" },
  { key: "parent", name: "Parent" },
  { key: "teacher", name: "Enseignant" },
];

type SeedUser = {
  tenantSlug: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  roleKey: string;
};

// Comptes affichés sur apps/web/src/app/login/page.tsx (section démonstration)
const usersToSeed: SeedUser[] = [
  {
    tenantSlug: "ecoledigitale",
    email: "admin@imhotepdata.fr",
    firstName: "Admin",
    lastName: "Imhotep Data",
    password: "Passw0rd!admin",
    roleKey: "admin",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "admin@aspci.fr",
    firstName: "Admin",
    lastName: "ASPCI",
    password: "Passw0rd!admin",
    roleKey: "admin",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "admin@imhotepacademy.fr",
    firstName: "Admin",
    lastName: "Imhotep Academy",
    password: "Passw0rd!admin",
    roleKey: "admin",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "owner@imhotepacademy.fr",
    firstName: "Propriétaire",
    lastName: "Démo",
    password: "Passw0rd!owner",
    roleKey: "owner",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "marie.kouame@imhotepacademy.ci",
    firstName: "Marie",
    lastName: "Kouamé",
    password: "Enseignant2025!",
    roleKey: "teacher",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "mickael.andjui.21@gmail.com",
    firstName: "Mickaël",
    lastName: "Andjui",
    password: "M!zPChP6YQ4E",
    roleKey: "student",
  },
  {
    tenantSlug: "ecoledigitale",
    email: "mickael.andjui.221@gmail.com",
    firstName: "Ange",
    lastName: "Andjui",
    password: "V!5mUFDZy$HJ",
    roleKey: "parent",
  },
];

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function seedDatabase() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    console.log("\n📋 Seeding tenants...");
    const tenantIds: Record<string, string> = {};

    for (const tenant of tenants) {
      // Aligné sur 0001_init.sql : slug, name, settings_json (pas subdomain/metadata)
      const result = await client.query(
        `INSERT INTO tenants (slug, name, settings_json)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           settings_json = EXCLUDED.settings_json,
           updated_at = NOW()
         RETURNING id`,
        [tenant.slug, tenant.name, JSON.stringify({ subdomain: tenant.slug })]
      );
      tenantIds[tenant.slug] = result.rows[0].id;
      console.log(`  ✅ ${tenant.name} (${tenant.slug})`);
    }

    console.log("\n👥 Seeding roles...");
    const roleIds: Record<string, string> = {};

    for (const role of roles) {
      const result = await client.query(
        `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
         VALUES ($1, $2, true, true, NOW(), NOW())
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name,
           is_active = true,
           updated_at = NOW()
         RETURNING id`,
        [role.key, role.name]
      );
      roleIds[role.key] = result.rows[0].id;
      console.log(`  ✅ ${role.key}: ${role.name}`);
    }

    console.log("\n👤 Seeding users (comptes démo login)...");

    for (const userTemplate of usersToSeed) {
      const tenantId = tenantIds[userTemplate.tenantSlug];
      if (!tenantId) {
        console.log(`  ⚠️ Tenant introuvable pour ${userTemplate.email}: ${userTemplate.tenantSlug}`);
        continue;
      }

      const fullName = `${userTemplate.firstName} ${userTemplate.lastName}`.trim();
      const passwordHash = await hashPassword(userTemplate.password);

      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash, active_role_key, created_at, updated_at, role_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           password_hash = EXCLUDED.password_hash,
           active_role_key = EXCLUDED.active_role_key,
           updated_at = NOW()
         RETURNING id`,
        [
          tenantId,
          userTemplate.email,
          fullName,
          userTemplate.firstName,
          userTemplate.lastName,
          passwordHash,
          userTemplate.roleKey,
        ]
      );

      const userId = userResult.rows[0].id;
      const roleId = roleIds[userTemplate.roleKey];
      if (!roleId) {
        console.log(`  ⚠️ Rôle introuvable pour ${userTemplate.email}: ${userTemplate.roleKey}`);
        continue;
      }

      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
        [tenantId, userId, roleId]
      );

      console.log(`  ✅ ${userTemplate.email} (${userTemplate.roleKey} @ ${userTemplate.tenantSlug})`);
    }

    await client.query("COMMIT");

    console.log("\n🎉 Database seeding completed successfully!");
    console.log("\n📝 Comptes démo (page /login) :");
    for (const u of usersToSeed) {
      console.log(`   - ${u.email} / ${u.password} → tenant ${u.tenantSlug}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding database:", error);
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log("\n✨ Seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Seed script failed:", error);
      process.exit(1);
    });
}

export { seedDatabase };
