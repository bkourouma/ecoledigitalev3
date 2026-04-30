import { Client } from "pg";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

async function verifyTeacherProfile() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    const email = "marie.kouame@imhotepacademy.ci";
    const tenantSlug = "imhotepacademy";

    // Get tenant ID
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = $1",
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant not found");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Tenant ID: ${tenantId}`);

    // Get user
    const userResult = await client.query(
      "SELECT id, email, name FROM users WHERE email = $1 AND tenant_id = $2",
      [email, tenantId]
    );

    if (userResult.rows.length === 0) {
      console.log("❌ User not found");
      return;
    }

    const user = userResult.rows[0];
    console.log(`👤 User found: ${user.id} - ${user.email} - ${user.name}`);

    // Check teacher profile
    const teacherResult = await client.query(
      "SELECT id, user_id, first_name, last_name, email, status FROM teachers WHERE user_id = $1 AND tenant_id = $2",
      [user.id, tenantId]
    );

    if (teacherResult.rows.length === 0) {
      console.log("❌ Teacher profile NOT found for this user");
      console.log("Creating teacher profile...");
      
      await client.query(
        `INSERT INTO teachers (tenant_id, user_id, first_name, last_name, email, contract_type, status)
         VALUES ($1, $2, $3, $4, $5, 'permanent', 'active')`,
        [tenantId, user.id, 'Marie', 'Kouamé', email]
      );
      
      console.log("✅ Teacher profile created");
    } else {
      const teacher = teacherResult.rows[0];
      console.log(`✅ Teacher profile found: ${teacher.id}`);
      console.log(`   - User ID: ${teacher.user_id}`);
      console.log(`   - Name: ${teacher.first_name} ${teacher.last_name}`);
      console.log(`   - Email: ${teacher.email}`);
      console.log(`   - Status: ${teacher.status}`);
    }

  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    await client.end();
  }
}

verifyTeacherProfile()
  .then(() => {
    console.log("\n✅ Verification completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Verification failed:", error);
    process.exit(1);
  });

