const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: process.env.PGPASSWORD || (() => { throw new Error("PGPASSWORD est requis (mot de passe Postgres)"); })(),
  port: 5432,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: Parent Messages System');
    console.log('');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0029_parent_messages_system.sql');
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
    console.log('📋 Created tables:');
    console.log('   - teacher_messages');
    console.log('   - school_announcements');
    console.log('   - parent_teacher_conversations');
    console.log('   - conversation_messages');
    console.log('   - notifications');
    console.log('   - event_invitations');
    console.log('   - announcement_reads');
    console.log('');
    console.log('✅ All tables, indexes, RLS policies, and triggers have been created.');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:');
    console.error(error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

