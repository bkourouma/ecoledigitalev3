#!/usr/bin/env node

/**
 * Migration Script for RSO Activities Table
 * 
 * This script applies the migration 0022_rso_activities.sql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
// Can be overridden with DATABASE_URL environment variable
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({
  connectionString: databaseUrl,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: RSO Activities Table');
    console.log('');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0022_rso_activities.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
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
    console.log('📋 Created:');
    console.log('   - rso_installations table (port facility installations)');
    console.log('   - rso_activities table (activity management)');
    console.log('   - Indexes for query performance');
    console.log('   - Triggers for updated_at timestamp');
    console.log('   - RLS policies for tenant isolation');
    console.log('');
    console.log('✅ Tables, indexes, triggers, and RLS policies have been created.');
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

