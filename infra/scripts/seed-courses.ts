import { Client } from "pg";

// Database configuration
const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale";

// Sample teaching units and courses for each programme
const teachingUnitsAndCourses = [
  {
    programmeCode: "BTS-SIO-SISR",
    teachingUnits: [
      {
        name: "Culture générale et expression",
        code: "CGE",
        ectsCredits: 4,
        semester: 1,
        courses: [
          {
            name: "Expression française",
            code: "CGE-01",
            hoursTotal: 60,
            hoursTheory: 40,
            hoursPractical: 20,
            deliveryMode: "presential"
          }
        ]
      },
      {
        name: "Mathématiques pour l'informatique",
        code: "MATH",
        ectsCredits: 6,
        semester: 1,
        courses: [
          {
            name: "Mathématiques appliquées",
            code: "MATH-01",
            hoursTotal: 80,
            hoursTheory: 60,
            hoursPractical: 20,
            deliveryMode: "presential"
          }
        ]
      },
      {
        name: "Support et mise à disposition de services informatiques",
        code: "SISR-1",
        ectsCredits: 12,
        semester: 1,
        courses: [
          {
            name: "Administration des systèmes",
            code: "SISR-01",
            hoursTotal: 120,
            hoursTheory: 60,
            hoursPractical: 60,
            deliveryMode: "hybrid"
          },
          {
            name: "Réseaux informatiques",
            code: "SISR-02",
            hoursTotal: 100,
            hoursTheory: 50,
            hoursPractical: 50,
            deliveryMode: "hybrid"
          }
        ]
      }
    ]
  },
  {
    programmeCode: "BTS-SIO-SLAM",
    teachingUnits: [
      {
        name: "Culture générale et expression",
        code: "CGE",
        ectsCredits: 4,
        semester: 1,
        courses: [
          {
            name: "Expression française",
            code: "CGE-01",
            hoursTotal: 60,
            hoursTheory: 40,
            hoursPractical: 20,
            deliveryMode: "presential"
          }
        ]
      },
      {
        name: "Solutions logicielles et applications métiers",
        code: "SLAM-1",
        ectsCredits: 12,
        semester: 1,
        courses: [
          {
            name: "Programmation orientée objet",
            code: "SLAM-01",
            hoursTotal: 120,
            hoursTheory: 60,
            hoursPractical: 60,
            deliveryMode: "hybrid"
          },
          {
            name: "Base de données",
            code: "SLAM-02",
            hoursTotal: 100,
            hoursTheory: 50,
            hoursPractical: 50,
            deliveryMode: "hybrid"
          },
          {
            name: "Développement web",
            code: "SLAM-03",
            hoursTotal: 80,
            hoursTheory: 30,
            hoursPractical: 50,
            deliveryMode: "hybrid"
          }
        ]
      }
    ]
  },
  {
    programmeCode: "LIC-INFO-GEN",
    teachingUnits: [
      {
        name: "Algorithmique et programmation",
        code: "ALGO",
        ectsCredits: 8,
        semester: 1,
        courses: [
          {
            name: "Algorithmique fondamentale",
            code: "ALGO-01",
            hoursTotal: 80,
            hoursTheory: 50,
            hoursPractical: 30,
            deliveryMode: "presential"
          },
          {
            name: "Programmation en C",
            code: "ALGO-02",
            hoursTotal: 60,
            hoursTheory: 30,
            hoursPractical: 30,
            deliveryMode: "hybrid"
          }
        ]
      },
      {
        name: "Systèmes et réseaux",
        code: "SYS",
        ectsCredits: 6,
        semester: 1,
        courses: [
          {
            name: "Systèmes d'exploitation",
            code: "SYS-01",
            hoursTotal: 70,
            hoursTheory: 40,
            hoursPractical: 30,
            deliveryMode: "hybrid"
          }
        ]
      }
    ]
  },
  {
    programmeCode: "MST-DS-IA",
    teachingUnits: [
      {
        name: "Intelligence artificielle",
        code: "IA",
        ectsCredits: 10,
        semester: 1,
        courses: [
          {
            name: "Machine Learning",
            code: "IA-01",
            hoursTotal: 100,
            hoursTheory: 60,
            hoursPractical: 40,
            deliveryMode: "hybrid"
          },
          {
            name: "Deep Learning",
            code: "IA-02",
            hoursTotal: 80,
            hoursTheory: 40,
            hoursPractical: 40,
            deliveryMode: "hybrid"
          }
        ]
      },
      {
        name: "Big Data",
        code: "BD",
        ectsCredits: 8,
        semester: 1,
        courses: [
          {
            name: "Traitement de données massives",
            code: "BD-01",
            hoursTotal: 90,
            hoursTheory: 50,
            hoursPractical: 40,
            deliveryMode: "hybrid"
          }
        ]
      }
    ]
  }
];

async function seedCoursesData() {
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

    // Get programme IDs
    const programmesResult = await client.query(
      "SELECT id, code FROM programmes WHERE tenant_id = $1",
      [tenantId]
    );

    const programmeMap = new Map();
    programmesResult.rows.forEach(row => {
      programmeMap.set(row.code, row.id);
    });

    console.log("\n📚 Seeding teaching units and courses...");

    for (const programmeData of teachingUnitsAndCourses) {
      const programmeId = programmeMap.get(programmeData.programmeCode);
      if (!programmeId) {
        console.log(`  ❌ Programme ${programmeData.programmeCode} not found`);
        continue;
      }

      console.log(`\n  📖 Programme: ${programmeData.programmeCode}`);

      for (const tuData of programmeData.teachingUnits) {
        // Insert teaching unit
        const tuResult = await client.query(
          `INSERT INTO teaching_units (tenant_id, programme_id, name, code, ects_credits, semester, is_mandatory)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (tenant_id, programme_id, code) DO UPDATE SET
             name = EXCLUDED.name,
             ects_credits = EXCLUDED.ects_credits,
             semester = EXCLUDED.semester,
             updated_at = NOW()
           RETURNING id`,
          [tenantId, programmeId, tuData.name, tuData.code, tuData.ectsCredits, tuData.semester]
        );

        const teachingUnitId = tuResult.rows[0].id;
        console.log(`    ✅ Teaching Unit: ${tuData.name} (${tuData.code})`);

        // Insert courses for this teaching unit
        for (const courseData of tuData.courses) {
          await client.query(
            `INSERT INTO courses (tenant_id, teaching_unit_id, name, code, hours_total, hours_theory, hours_practical, delivery_mode, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
             ON CONFLICT (tenant_id, teaching_unit_id, code) DO UPDATE SET
               name = EXCLUDED.name,
               hours_total = EXCLUDED.hours_total,
               hours_theory = EXCLUDED.hours_theory,
               hours_practical = EXCLUDED.hours_practical,
               delivery_mode = EXCLUDED.delivery_mode,
               updated_at = NOW()`,
            [
              tenantId,
              teachingUnitId,
              courseData.name,
              courseData.code,
              courseData.hoursTotal,
              courseData.hoursTheory,
              courseData.hoursPractical,
              courseData.deliveryMode
            ]
          );
          console.log(`      ✅ Course: ${courseData.name} (${courseData.code})`);
        }
      }
    }

    // Commit transaction
    await client.query("COMMIT");

    console.log("\n🎉 Courses data seeding completed successfully!");
    console.log("\nNow you can select programmes and see available courses when creating classes!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding courses data:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the seed script
if (require.main === module) {
  seedCoursesData()
    .then(() => {
      console.log("\n✨ Courses seed script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Courses seed script failed:", error);
      process.exit(1);
    });
}

export { seedCoursesData };