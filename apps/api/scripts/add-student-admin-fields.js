// Add administrative student fields to student_profiles table
// Usage: node apps/api/scripts/add-student-admin-fields.js

const { Pool } = require("pg");

const DEFAULT_CONN =
  process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function run() {
  const pool = new Pool({ connectionString: DEFAULT_CONN });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE student_profiles
      ADD COLUMN IF NOT EXISTS father_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS birth_certificate_number VARCHAR(100),
      ADD COLUMN IF NOT EXISTS birth_certificate_date DATE,
      ADD COLUMN IF NOT EXISTS civil_registry_office VARCHAR(255),
      ADD COLUMN IF NOT EXISTS sub_prefecture VARCHAR(255),
      ADD COLUMN IF NOT EXISTS origin_school VARCHAR(255),
      ADD COLUMN IF NOT EXISTS is_repeating BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS lv2 VARCHAR(100),
      ADD COLUMN IF NOT EXISTS scholarship_level VARCHAR(100),
      ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS transfer_decision VARCHAR(255),
      ADD COLUMN IF NOT EXISTS affectation_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS affectation_decision VARCHAR(255),
      ADD COLUMN IF NOT EXISTS cepe_code VARCHAR(100),
      ADD COLUMN IF NOT EXISTS is_inscribed BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS inscription_date DATE,
      ADD COLUMN IF NOT EXISTS residence VARCHAR(255),
      ADD COLUMN IF NOT EXISTS establishment_matricule VARCHAR(100),
      ADD COLUMN IF NOT EXISTS dsps_matricule VARCHAR(100),
      ADD COLUMN IF NOT EXISTS dsps_previous_matricule VARCHAR(100),
      ADD COLUMN IF NOT EXISTS initial_password VARCHAR(255)
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'student_profiles_affectation_status_check'
        ) THEN
          ALTER TABLE student_profiles
          ADD CONSTRAINT student_profiles_affectation_status_check
          CHECK (affectation_status IN ('affecte', 'non_affecte', 'prise_en_charge') OR affectation_status IS NULL);
        END IF;
      END $$;
    `);

    await client.query("COMMIT");
    console.log("✅ student_profiles updated with new administrative fields.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to update student_profiles:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { run };

