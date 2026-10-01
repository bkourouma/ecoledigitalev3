import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function createKouadioUser() {
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

    // Ensure teacher role exists
    console.log("\n👥 Ensuring teacher role exists...");
    const roleResult = await client.query(
      `INSERT INTO roles (tenant_id, key, name)
       VALUES ($1, 'teacher', 'Enseignant')
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING id`,
      [tenantId]
    );
    const teacherRoleId = roleResult.rows[0].id;
    console.log(`  ✅ Teacher role exists (ID: ${teacherRoleId})`);

    // Create/update the kouadio.assi user
    console.log("\n👤 Creating/updating Kouadio ASSI user...");
    const email = "kouadio.assi@ecoledigitale.ci";
    const password = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
    const firstName = "Kouadio";
    const lastName = "ASSI";
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

    // Assign teacher role to user
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, teacherRoleId]
    );
    console.log(`  ✅ Teacher role assigned to user`);

    // Check if teacher profile exists, create if not
    console.log("\n👨‍🏫 Creating/updating teacher profile...");
    const teacherResult = await client.query(
      `INSERT INTO teachers (
        tenant_id, user_id, employee_number, first_name, last_name, 
        email, phone, specialties, bio, qualifications, 
        hire_date, contract_type, hourly_rate, status
      )
      VALUES ($1, $2, 'T002', $3, $4, $5, '+225 07 00 00 00 00', 
              ARRAY['Informatique', 'Développement Web', 'Base de données'], 
              'Enseignant expérimenté en développement logiciel', 
              ARRAY['Master en Génie Logiciel', 'Certifications professionnelles'],
              '2024-01-01', 'permanent', 45.00, 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        user_id = EXCLUDED.user_id,
        updated_at = NOW()
      RETURNING id`,
      [tenantId, userId, firstName, lastName, email]
    );

    const teacherId = teacherResult.rows[0].id;
    console.log(`  ✅ Teacher profile created/updated (ID: ${teacherId})`);

    await client.query("COMMIT");

    console.log("\n🎉 User setup completed successfully!");
    console.log("\n📝 Login Credentials:");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: teacher`);
    console.log(`Tenant: imhotepacademy`);
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
  createKouadioUser()
    .then(() => {
      console.log("\n✨ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Fatal error:", error);
      process.exit(1);
    });
}

export { createKouadioUser };












