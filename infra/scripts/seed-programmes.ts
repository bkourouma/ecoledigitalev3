import { Client } from "pg";

// Database configuration
const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function seedProgrammes() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    // Get all cycles and their tenants
    const cyclesResult = await client.query(`
      SELECT c.id as cycle_id, c.code as cycle_code, c.name as cycle_name,
             t.id as tenant_id, t.slug as tenant_slug
      FROM cycles c
      JOIN tenants t ON c.tenant_id = t.id
      ORDER BY t.slug, c.name
    `);

    if (cyclesResult.rows.length === 0) {
      console.log("⚠️  No cycles found. Please seed cycles first.");
      await client.query("ROLLBACK");
      return;
    }

    console.log(`\n📚 Found ${cyclesResult.rows.length} cycles`);
    console.log("\n📋 Seeding programmes...");

    // Sample programmes for each cycle type
    const programmesTemplate = {
      'BTS': [
        {
          name: 'BTS SIO - Services Informatiques aux Organisations',
          code: 'BTS-SIO',
          description: 'Formation BTS en services informatiques (SISR et SLAM)',
          objectives: ['Maîtriser les bases de données', 'Développer des applications', 'Administrer des réseaux'],
          ects_credits: 120
        }
      ],
      'LICENCE': [
        {
          name: 'Licence Pro - Développement Web',
          code: 'LP-DEVWEB',
          description: 'Licence professionnelle spécialisée en développement web',
          objectives: ['Maîtriser les frameworks web', 'Concevoir des architectures', 'Déployer des applications'],
          ects_credits: 60
        }
      ]
    };

    let programmeCount = 0;

    for (const cycle of cyclesResult.rows) {
      // Find matching programme templates
      const templates = programmesTemplate[cycle.cycle_code] || [];
      
      if (templates.length === 0) {
        // Create a default programme if no template found
        templates.push({
          name: `Programme ${cycle.cycle_name}`,
          code: `PROG-${cycle.cycle_code}`,
          description: `Programme académique pour ${cycle.cycle_name}`,
          objectives: ['Acquisition des compétences fondamentales', 'Développement professionnel'],
          ects_credits: 60
        });
      }

      for (const template of templates) {
        // Check if programme already exists
        const existingResult = await client.query(
          `SELECT id FROM programmes 
           WHERE tenant_id = $1 AND code = $2`,
          [cycle.tenant_id, template.code]
        );

        if (existingResult.rows.length > 0) {
          console.log(`  ⏭️  Programme ${template.code} already exists for ${cycle.tenant_slug}`);
          continue;
        }

        // Insert programme
        const result = await client.query(
          `INSERT INTO programmes (
            tenant_id, cycle_id, name, code, version,
            description, objectives, ects_credits, 
            academic_year, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, name, code`,
          [
            cycle.tenant_id,
            cycle.cycle_id,
            template.name,
            template.code,
            '1.0',
            template.description,
            template.objectives,
            template.ects_credits,
            '2024-2025',
            'active'
          ]
        );

        programmeCount++;
        console.log(`  ✅ ${result.rows[0].name} (${result.rows[0].code}) for ${cycle.tenant_slug}`);
      }
    }

    await client.query("COMMIT");

    console.log(`\n🎉 Successfully seeded ${programmeCount} programmes!`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding programmes:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the seed script
if (require.main === module) {
  seedProgrammes()
    .then(() => {
      console.log("\n✨ Programme seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Programme seed script failed:", error);
      process.exit(1);
    });
}

export { seedProgrammes };

