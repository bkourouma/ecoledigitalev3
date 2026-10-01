import { Client } from "pg";
import bcrypt from "bcryptjs";

// Database configuration
const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function seedTeacherUser() {
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

    // Insert teacher role if it doesn't exist
    console.log("\n👥 Creating teacher role...");
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
    console.log(`  ✅ Teacher role created/updated`);

    // Insert teacher user
    console.log("\n👤 Creating teacher user...");
    const email = "teacher@imhotepacademy.fr";
    const password = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
    const firstName = "Prof";
    const lastName = "Martin";
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
    console.log(`  ✅ User created: ${email}`);

    // Assign teacher role to user
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, teacherRoleId]
    );
    console.log(`  ✅ Role assigned to user`);

    // Create teacher profile
    console.log("\n👨‍🏫 Creating teacher profile...");
    const teacherResult = await client.query(
      `INSERT INTO teachers (
        tenant_id, user_id, employee_number, first_name, last_name, 
        email, phone, specialties, bio, qualifications, 
        hire_date, contract_type, hourly_rate, status
      )
      VALUES ($1, $2, 'T001', $3, $4, $5, '+33 1 23 45 67 89', 
              ARRAY['Informatique', 'Programmation', 'Data Science'], 
              'Enseignant expérimenté en informatique et développement', 
              ARRAY['Master en Informatique', 'Doctorat en Data Science'],
              '2024-09-01', 'permanent', 50.00, 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        user_id = EXCLUDED.user_id,
        updated_at = NOW()
      RETURNING id`,
      [tenantId, userId, firstName, lastName, email]
    );

    const teacherId = teacherResult.rows[0].id;
    console.log(`  ✅ Teacher profile created (ID: ${teacherId})`);

    await client.query("COMMIT");

    console.log("\n🎉 Teacher user seeding completed successfully!");
    console.log("\n📝 Teacher account created:");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: teacher`);
    console.log(`Tenant: imhotepacademy`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding teacher user:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the seed script
if (require.main === module) {
  seedTeacherUser()
    .then(() => {
      console.log("\n✨ Teacher seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Fatal error:", error);
      process.exit(1);
    });
}

export { seedTeacherUser };

