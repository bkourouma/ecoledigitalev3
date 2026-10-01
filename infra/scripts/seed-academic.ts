import { Client } from "pg";

// Database configuration
const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

// Sample academic data
const cycles = [
  {
    name: "BTS Services Informatiques",
    code: "BTS-SIO",
    type: "professional",
    durationMonths: 24,
    description: "Formation en services informatiques aux organisations",
    certificationLevel: "Bac+2"
  },
  {
    name: "Licence Informatique",
    code: "LIC-INFO",
    type: "academic",
    durationMonths: 36,
    description: "Formation universitaire en informatique",
    certificationLevel: "Bac+3"
  },
  {
    name: "Master Data Science",
    code: "MST-DS",
    type: "academic",
    durationMonths: 24,
    description: "Formation avancée en science des données",
    certificationLevel: "Bac+5"
  }
];

const programmes = [
  {
    cycleCode: "BTS-SIO",
    name: "BTS SIO Option SISR",
    code: "BTS-SIO-SISR",
    description: "Solutions d'Infrastructure, Systèmes et Réseaux",
    academicYear: "2025-2026",
    ectsCredits: 120
  },
  {
    cycleCode: "BTS-SIO",
    name: "BTS SIO Option SLAM",
    code: "BTS-SIO-SLAM",
    description: "Solutions Logicielles et Applications Métiers",
    academicYear: "2025-2026",
    ectsCredits: 120
  },
  {
    cycleCode: "LIC-INFO",
    name: "Licence Informatique Générale",
    code: "LIC-INFO-GEN",
    description: "Formation généraliste en informatique",
    academicYear: "2025-2026",
    ectsCredits: 180
  },
  {
    cycleCode: "MST-DS",
    name: "Master Data Science et IA",
    code: "MST-DS-IA",
    description: "Spécialisation en intelligence artificielle et big data",
    academicYear: "2025-2026",
    ectsCredits: 120
  }
];

/**
 * Années scolaires CONTIGUËS : chacune finit la veille du premier anniversaire
 * de son début, soit le 31 août pour une année ouverte le 1er septembre.
 *
 * Elles s'arrêtaient au 30 juin, ce qui laissait juillet et août hors de toute
 * année : un encaissement de frais d'inscription passé en juillet, une paie
 * calculée en août ou un bulletin généré après les rattrapages n'appartenaient
 * à aucune année et disparaissaient de toutes les vues annuelles. Voir la
 * migration 0118, qui répare les bases existantes ; ce jeu d'amorçage ne doit
 * pas recréer le trou derrière elle.
 */
const academicYears = [
  {
    name: "2025-2026",
    startDate: "2025-09-01",
    endDate: "2026-08-31",
    isActive: true
  },
  {
    name: "2024-2025",
    startDate: "2024-09-01",
    endDate: "2025-08-31",
    isActive: false
  }
];

async function seedAcademicData() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    // Start transaction
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

    // Set tenant context for RLS
    await client.query(`SET app.tenant_id = '${tenantId}'`);

    // Insert academic years
    console.log("\n📅 Seeding academic years...");
    const academicYearIds: Record<string, string> = {};

    for (const academicYear of academicYears) {
      const result = await client.query(
        `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, name) DO UPDATE SET
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()
         RETURNING id`,
        [tenantId, academicYear.name, academicYear.startDate, academicYear.endDate, academicYear.isActive]
      );
      academicYearIds[academicYear.name] = result.rows[0].id;
      console.log(`  ✅ ${academicYear.name} (${academicYear.isActive ? 'Active' : 'Inactive'})`);
    }

    // Insert cycles
    console.log("\n🔄 Seeding cycles...");
    const cycleIds: Record<string, string> = {};

    for (const cycle of cycles) {
      const result = await client.query(
        `INSERT INTO cycles (tenant_id, name, code, type, duration_months, description, certification_level, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         ON CONFLICT (tenant_id, code) DO UPDATE SET
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           duration_months = EXCLUDED.duration_months,
           description = EXCLUDED.description,
           certification_level = EXCLUDED.certification_level,
           updated_at = NOW()
         RETURNING id`,
        [tenantId, cycle.name, cycle.code, cycle.type, cycle.durationMonths, cycle.description, cycle.certificationLevel]
      );
      cycleIds[cycle.code] = result.rows[0].id;
      console.log(`  ✅ ${cycle.name} (${cycle.code})`);
    }

    // Insert programmes
    console.log("\n📚 Seeding programmes...");

    for (const programme of programmes) {
      const cycleId = cycleIds[programme.cycleCode];
      if (!cycleId) {
        console.log(`  ❌ Cycle ${programme.cycleCode} not found for programme ${programme.name}`);
        continue;
      }

      await client.query(
        `INSERT INTO programmes (tenant_id, cycle_id, name, code, version, description, academic_year, ects_credits, status)
         VALUES ($1, $2, $3, $4, '1.0', $5, $6, $7, 'active')
         ON CONFLICT (tenant_id, code, version) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           academic_year = EXCLUDED.academic_year,
           ects_credits = EXCLUDED.ects_credits,
           updated_at = NOW()`,
        [tenantId, cycleId, programme.name, programme.code, programme.description, programme.academicYear, programme.ectsCredits]
      );
      console.log(`  ✅ ${programme.name} (${programme.code})`);
    }

    // Commit transaction
    await client.query("COMMIT");

    console.log("\n🎉 Academic data seeding completed successfully!");
    console.log("\n📝 Created:");
    console.log(`- ${academicYears.length} academic years`);
    console.log(`- ${cycles.length} cycles`);
    console.log(`- ${programmes.length} programmes`);
    console.log("\nYou can now create classes and select programmes from the dropdown!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding academic data:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the seed script
if (require.main === module) {
  seedAcademicData()
    .then(() => {
      console.log("\n✨ Academic seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Academic seed script failed:", error);
      process.exit(1);
    });
}

export { seedAcademicData };