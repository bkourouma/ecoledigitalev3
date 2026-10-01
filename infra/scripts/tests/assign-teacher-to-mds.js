const { Pool } = require('pg');

const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba'; // imhotepacademy
const CLASS_ID = '4b8caca3-f867-47ea-ab6d-221275f104d2'; // Master Data Science - Promotion 2025
const TEACHER_ID = '6f49850a-13bc-427a-93e0-38d894e12a5d'; // kouadio.assi@ecoledigitale.ci

const pool = new Pool({
  user: 'postgres',
  password: process.env.PGPASSWORD || (() => { throw new Error("PGPASSWORD est requis (mot de passe Postgres)"); })(),
  host: 'localhost',
  port: 5432,
  database: 'dbecoledigitale',
});

async function assignTeacherToMDS() {
  const client = await pool.connect();
  try {
    console.log('🔍 Finding class courses for Master Data Science...');

    // Get the class courses for the Master Data Science class
    const classCoursesResult = await client.query(
      `SELECT cc.id, cc.course_id, c.name, c.code
       FROM class_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.class_id = $1 AND cc.tenant_id = $2`,
      [CLASS_ID, TENANT_ID]
    );

    console.log(`Found ${classCoursesResult.rows.length} courses in the class`);

    // For each course, create a teacher assignment
    for (const row of classCoursesResult.rows) {
      console.log(`\n📚 Assigning teacher to: ${row.name} (${row.code})`);

      const assignmentResult = await client.query(
        `INSERT INTO teacher_assignments (
          tenant_id, class_course_id, teacher_id, contract_type, datebut, datefin, status
        ) VALUES ($1, $2, $3, 'salarie', '2025-10-01', '2026-06-30', 'active')
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [TENANT_ID, row.id, TEACHER_ID]
      );

      if (assignmentResult.rows.length > 0) {
        console.log(`✅ Created assignment: ${assignmentResult.rows[0].id}`);
      } else {
        console.log(`⚠️ Assignment already exists for this course`);
      }
    }

    console.log('\n✅ Teacher assignments completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

assignTeacherToMDS();

