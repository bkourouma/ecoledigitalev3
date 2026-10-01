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

async function assignSessionsToTeacher() {
  const client = await pool.connect();
  try {
    console.log('🔍 Assigning scheduled sessions to teacher...');

    // Update all scheduled sessions for the Master Data Science class to assign the teacher
    const result = await client.query(
      `UPDATE scheduled_sessions
       SET teacher_id = $1, updated_at = NOW()
       WHERE class_id = $2 AND tenant_id = $3 AND teacher_id IS NULL`,
      [TEACHER_ID, CLASS_ID, TENANT_ID]
    );

    console.log(`✅ Updated ${result.rowCount} sessions with teacher assignment`);

    // Verify the update
    const verifyResult = await client.query(
      `SELECT COUNT(*) as total, COUNT(CASE WHEN teacher_id IS NOT NULL THEN 1 END) as with_teacher
       FROM scheduled_sessions
       WHERE class_id = $1 AND tenant_id = $2`,
      [CLASS_ID, TENANT_ID]
    );

    const row = verifyResult.rows[0];
    console.log(`📊 Sessions: ${row.total} total, ${row.with_teacher} with teacher assigned`);

    console.log('\n✅ Teacher assignment to sessions completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

assignSessionsToTeacher();

