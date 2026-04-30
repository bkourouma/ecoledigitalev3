/**
 * One-off / maintenance: delete assignments by exact title (cascade to related rows).
 * Usage: node scripts/delete-assignments-by-title.js tttrt225 test225
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

async function main() {
  const titles = process.argv.slice(2).filter(Boolean);
  if (titles.length === 0) {
    console.error('Usage: node scripts/delete-assignments-by-title.js <title> [title2 ...]');
    process.exit(1);
  }

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: conn });
  try {
    const before = await pool.query(
      `SELECT a.id, a.title, a.status, a.type, c.name AS course_name
       FROM assignments a
       JOIN courses c ON c.id = a.course_id
       WHERE a.title = ANY($1::text[])`,
      [titles]
    );
    console.log('Matching rows before delete:', before.rows.length);
    for (const row of before.rows) {
      console.log(`  - ${row.title} | ${row.status} | ${row.type} | ${row.course_name} | ${row.id}`);
    }

    const del = await pool.query(
      `DELETE FROM assignments a
       WHERE a.title = ANY($1::text[])
       RETURNING a.id, a.title`,
      [titles]
    );
    console.log('Deleted:', del.rowCount);
    for (const row of del.rows) {
      console.log(`  removed ${row.title} (${row.id})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
