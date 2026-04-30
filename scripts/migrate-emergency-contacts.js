const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: 'DevMick@2003',
  port: 5432,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: Emergency Contacts Table');
    console.log('');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0030_emergency_contacts.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Reading migration file...');
    console.log(`   Path: ${migrationPath}`);
    console.log('');
    
    // Execute the migration
    console.log('⚙️  Executing migration SQL...');
    
    // Execute the entire migration SQL in a transaction
    await client.query('BEGIN');
    try {
      await client.query(migrationSQL);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📋 Created table:');
    console.log('   - emergency_contacts');
    console.log('');
    console.log('✅ Table, indexes, RLS policies, and comments have been created.');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:');
    console.error('');
    console.error('Error details:');
    console.error(error.message);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

