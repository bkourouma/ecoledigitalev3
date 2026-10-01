import { Client } from "pg";
import bcrypt from "bcryptjs";

// Database configuration
const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function checkParentAccount() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log("✅ Connected to database");

    // Get tenant ID for imhotepacademy
    const tenantResult = await client.query(
      "SELECT id, slug FROM tenants WHERE slug = $1",
      ["imhotepacademy"]
    );

    if (tenantResult.rows.length === 0) {
      console.error("❌ Tenant 'imhotepacademy' not found");
      return;
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`✅ Tenant found: ${tenantResult.rows[0].slug} (${tenantId})`);

    // Check if parent user exists
    const userResult = await client.query(
      "SELECT id, email, name, password_hash FROM users WHERE email = $1 AND tenant_id = $2",
      ["parent@imhotepacademy.fr", tenantId]
    );

    if (userResult.rows.length === 0) {
      console.error("❌ Parent user 'parent@imhotepacademy.fr' not found");
      console.log("💡 Run 'pnpm seed' to create the parent account");
      return;
    }

    const user = userResult.rows[0];
    console.log(`✅ Parent user found: ${user.email} (${user.id})`);

    // Check if user has parent role
    const roleResult = await client.query(
      `SELECT r.key, r.name 
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND r.tenant_id = $2`,
      [user.id, tenantId]
    );

    console.log(`\n📋 User roles:`);
    if (roleResult.rows.length === 0) {
      console.error("❌ User has no roles assigned");
      console.log("💡 The user needs the 'parent' role to authenticate");
    } else {
      roleResult.rows.forEach((row: any) => {
        console.log(`   - ${row.key} (${row.name})`);
      });
    }

    // Test password
    const testPassword = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
    const passwordValid = await bcrypt.compare(testPassword, user.password_hash);
    
    console.log(`\n🔐 Password test:`);
    if (passwordValid) {
      console.log(`✅ Password '${testPassword}' is correct`);
    } else {
      console.error(`❌ Password '${testPassword}' is incorrect`);
      console.log("💡 The password hash in database doesn't match the expected password");
    }

    console.log(`\n✅ Parent account check complete`);
    console.log(`\n📝 Summary:`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Tenant ID: ${tenantId}`);
    console.log(`   Has parent role: ${roleResult.rows.some((r: any) => r.key === 'parent')}`);
    console.log(`   Password correct: ${passwordValid}`);

  } catch (error) {
    console.error("❌ Error checking parent account:", error);
  } finally {
    await client.end();
  }
}

checkParentAccount();

