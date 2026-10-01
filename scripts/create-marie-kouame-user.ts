import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

async function createMarieKouameUser() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    // Get tenant ID for imhotepacademy
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = 'imhotepacademy'"
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant 'imhotepacademy' not found. Please run the basic seed script first.");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Using tenant: imhotepacademy (${tenantId})`);

    // Get or create teacher role
    console.log("\n👥 Getting teacher role...");
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'teacher'`,
      [tenantId]
    );

    let teacherRoleId: string;
    if (roleResult.rows.length === 0) {
      // Create teacher role if it doesn't exist
      const createRoleResult = await client.query(
        `INSERT INTO roles (tenant_id, key, name)
         VALUES ($1, 'teacher', 'Enseignant')
         RETURNING id`,
        [tenantId]
      );
      teacherRoleId = createRoleResult.rows[0].id;
      console.log(`  ✅ Teacher role created`);
    } else {
      teacherRoleId = roleResult.rows[0].id;
      console.log(`  ✅ Teacher role found`);
    }

    // Create or update user
    console.log("\n👤 Creating/updating teacher user...");
    const email = "marie.kouame@imhotepacademy.ci";
    const password = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
    const firstName = "Marie";
    const lastName = "Kouamé";
    const name = `${firstName} ${lastName}`;
    const passwordHash = await hashPassword(password);

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         updated_at = NOW()
       RETURNING id`,
      [tenantId, email, name, passwordHash, firstName, lastName]
    );

    const userId = userResult.rows[0].id;
    console.log(`  ✅ User created/updated: ${email} (${userId})`);

    // Assign teacher role to user
    console.log("\n🔐 Assigning teacher role...");
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, teacherRoleId]
    );
    console.log(`  ✅ Role assigned`);

    // Check if user is a teacher (has teacher record)
    const teacherCheck = await client.query(
      `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    if (teacherCheck.rows.length === 0) {
      // Create teacher record
      console.log("\n👨‍🏫 Creating teacher record...");
      await client.query(
        `INSERT INTO teachers (tenant_id, user_id, first_name, last_name, email, contract_type, status)
         VALUES ($1, $2, $3, $4, $5, 'permanent', 'active')
         ON CONFLICT (tenant_id, email) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           user_id = EXCLUDED.user_id,
           updated_at = NOW()`,
        [tenantId, userId, firstName, lastName, email]
      );
      console.log(`  ✅ Teacher record created`);
    } else {
      // Update existing teacher record
      await client.query(
        `UPDATE teachers 
         SET first_name = $1, last_name = $2, email = $3, user_id = $4, updated_at = NOW()
         WHERE id = $5`,
        [firstName, lastName, email, userId, teacherCheck.rows[0].id]
      );
      console.log(`  ✅ Teacher record updated`);
    }

    await client.query("COMMIT");

    console.log("\n🎉 User created successfully!");
    console.log(`\n📝 Login credentials:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: teacher`);
    console.log(`   Tenant: imhotepacademy`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating user:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createMarieKouameUser()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

