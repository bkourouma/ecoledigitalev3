import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

async function createAmelieKouadioUser() {
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

    // Get or create student role
    console.log("\n👥 Getting student role...");
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'student'`,
      [tenantId]
    );

    let studentRoleId: string;
    if (roleResult.rows.length === 0) {
      // Create student role if it doesn't exist
      const createRoleResult = await client.query(
        `INSERT INTO roles (tenant_id, key, name)
         VALUES ($1, 'student', 'Étudiant')
         RETURNING id`,
        [tenantId]
      );
      studentRoleId = createRoleResult.rows[0].id;
      console.log(`  ✅ Student role created`);
    } else {
      studentRoleId = roleResult.rows[0].id;
      console.log(`  ✅ Student role found`);
    }

    // Create or update user
    console.log("\n👤 Creating/updating student user...");
    const email = "amelie.kouadio@imhotepacademy.ci";
    const password = "5L2kepwfnaitRéessayer";
    const firstName = "Amélie";
    const lastName = "Kouadio";
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

    // Assign student role to user
    console.log("\n🔐 Assigning student role...");
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, studentRoleId]
    );
    console.log(`  ✅ Role assigned`);

    // Optionally create student profile if it doesn't exist
    const studentProfileCheck = await client.query(
      `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    if (studentProfileCheck.rows.length === 0) {
      // Generate student number
      const studentNumber = `STU${Math.floor(100000 + Math.random() * 900000)}`;
      
      console.log("\n🎓 Creating student profile...");
      await client.query(
        `INSERT INTO student_profiles (tenant_id, user_id, student_number, current_year, status)
         VALUES ($1, $2, $3, 1, 'active')
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET
           student_number = EXCLUDED.student_number,
           updated_at = NOW()`,
        [tenantId, userId, studentNumber]
      );
      console.log(`  ✅ Student profile created with number: ${studentNumber}`);
    } else {
      console.log(`  ✅ Student profile already exists`);
    }

    await client.query("COMMIT");

    console.log("\n🎉 User created successfully!");
    console.log(`\n📝 Login credentials:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: student`);
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
createAmelieKouadioUser()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

