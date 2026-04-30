#!/usr/bin/env node

/**
 * Drop Old RSO Phase 2 Tables
 * Removes old table structure before applying new migration
 */

const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const pool = new Pool({
  connectionString: databaseUrl,
});

async function dropOldTables() {
  const client = await pool.connect();
  
  try {
    console.log('🗑️  Dropping old RSO Phase 2 tables...');
    console.log('');
    
    // Check if old rso_installations exists
    const check = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'rso_installations'
      );
    `);
    
    if (check.rows[0].exists) {
      console.log('Dropping old rso_installations table...');
      
      // Drop foreign key constraints first
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'rso_users_installation_id_fkey'
          ) THEN
            ALTER TABLE rso_users DROP CONSTRAINT rso_users_installation_id_fkey;
          END IF;
        END $$;
      `);
      
      // Drop the table
      await client.query('DROP TABLE IF EXISTS rso_installations CASCADE;');
      console.log('✅ Old rso_installations table dropped');
    } else {
      console.log('No old rso_installations table found');
    }
    
    console.log('');
    console.log('✅ Old tables dropped. Ready for new migration.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

dropOldTables().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

