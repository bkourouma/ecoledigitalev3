const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection string
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const pool = new Pool({ connectionString: databaseUrl });

async function runRollback() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting Phase 6 rollback migration...');
    
    // Read the rollback SQL file
    const rollbackPath = path.join(__dirname, '../infra/scripts/migrations/0026_rso_phase6_rollback.sql');
    const rollbackSQL = fs.readFileSync(rollbackPath, 'utf8');
    
    console.log('📄 Executing rollback SQL...');
    
    // Execute in a transaction
    await client.query('BEGIN');
    try {
      await client.query(rollbackSQL);
      await client.query('COMMIT');
      console.log('✅ Phase 6 rollback completed successfully!');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('❌ Error during Phase 6 rollback:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runRollback().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

