import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

async function createAspciAdmin() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    // Use the specific tenant ID for ASPCI
    const tenantId = "52da6ca7-81ad-47ad-b5c3-6f437f64ba37";
    
    // Verify tenant exists
    const tenantResult = await client.query(
      "SELECT id, slug, name FROM tenants WHERE id = $1",
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error(`Tenant with ID ${tenantId} not found. Please verify the tenant exists.`);
    }

    const tenant = tenantResult.rows[0];
    console.log(`📋 Using tenant: ${tenant.name} (${tenant.slug}) - ${tenantId}`);

    // Ensure admin role exists
    console.log("\n👥 Ensuring admin role exists...");
    const roleResult = await client.query(
      `INSERT INTO roles (tenant_id, key, name)
       VALUES ($1, 'admin', 'Administrateur')
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING id`,
      [tenantId]
    );
    const adminRoleId = roleResult.rows[0].id;
    console.log(`  ✅ Admin role exists (ID: ${adminRoleId})`);

    // Create/update the admin user
    console.log("\n👤 Creating/updating admin user...");
    const email = "admin@aspci.fr";
    const password = "Passw0rd!admin";
    const firstName = "Admin";
    const lastName = "ASPCI";
    const name = `${firstName} ${lastName}`;
    const passwordHash = await bcrypt.hash(password, 12);

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
    console.log(`  ✅ User created/updated: ${email} (ID: ${userId})`);

    // Assign admin role to user
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, adminRoleId]
    );
    console.log(`  ✅ Admin role assigned to user`);

    await client.query("COMMIT");

    console.log("\n🎉 User setup completed successfully!");
    console.log("\n📝 Login Credentials:");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: admin`);
    console.log(`Tenant: ${tenant.slug} (${tenant.name})`);
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`\n✨ You can now login at http://localhost:3000/login`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating user:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
if (require.main === module) {
  createAspciAdmin()
    .then(() => {
      console.log("\n✨ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Fatal error:", error);
      process.exit(1);
    });
}

export { createAspciAdmin };

