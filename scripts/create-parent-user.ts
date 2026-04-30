import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

async function createParentUser() {
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

    // Get or create parent role
    console.log("\n👥 Getting parent role...");
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'parent'`,
      [tenantId]
    );

    let parentRoleId: string;
    if (roleResult.rows.length === 0) {
      // Create parent role if it doesn't exist
      const createRoleResult = await client.query(
        `INSERT INTO roles (tenant_id, key, name)
         VALUES ($1, 'parent', 'Parent')
         RETURNING id`,
        [tenantId]
      );
      parentRoleId = createRoleResult.rows[0].id;
      console.log(`  ✅ Parent role created`);
    } else {
      parentRoleId = roleResult.rows[0].id;
      console.log(`  ✅ Parent role found`);
    }

    // Create or update user
    console.log("\n👤 Creating/updating parent user...");
    const email = "mickael@imhotepacademy.ci";
    const password = "Passw0rd!parent";
    const firstName = "Mickael";
    const lastName = "";
    const name = firstName;
    const passwordHash = await hashPassword(password);

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, first_name, last_name, role_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         updated_at = NOW(),
         role_updated_at = NOW()
       RETURNING id`,
      [tenantId, email, name, passwordHash, firstName, lastName]
    );

    const userId = userResult.rows[0].id;
    console.log(`  ✅ User created/updated: ${email} (${userId})`);

    // Assign parent role to user
    console.log("\n🔐 Assigning parent role...");
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, parentRoleId]
    );
    // Update role_updated_at after assigning role
    await client.query(
      `UPDATE users SET role_updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    console.log(`  ✅ Role assigned`);

    await client.query("COMMIT");

    console.log("\n🎉 Parent created successfully!");
    console.log(`\n📝 Login credentials:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: parent`);
    console.log(`   Tenant: imhotepacademy`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating parent:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createParentUser()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

