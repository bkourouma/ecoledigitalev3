// Get teachers for imhotepacademy tenant
const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function getTeachers() {
  const pool = new Pool({ connectionString: DEFAULT_CONN });
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT t.id, t.first_name, t.last_name, t.email, u.email as user_email
      FROM teachers t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.tenant_id = (SELECT id FROM tenants WHERE slug = 'imhotepacademy' LIMIT 1)
      ORDER BY t.first_name
    `);
    
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

getTeachers();

