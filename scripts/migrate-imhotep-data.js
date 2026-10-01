#!/usr/bin/env node

/**
 * Migration Script for Imhotep Data Professional Training Schema
 * 
 * This script applies the migration 0037_imhotep_data_professional_training.sql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
// Can be overridden with DATABASE_URL environment variable
// Try multiple password options based on project configuration
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({
  connectionString: databaseUrl,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: Imhotep Data Professional Training Schema');
    console.log('');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0037_imhotep_data_professional_training.sql');
    
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
    console.log('   - 9 tables for professional training management');
    console.log('   - 6 ENUM types for status and configuration');
    console.log('   - 40 indexes for query performance');
    console.log('   - 9 RLS policies for multi-tenant isolation');
    console.log('   - 10 triggers for audit trails and auto-generated fields');
    console.log('   - 2 functions for code generation');
    console.log('');
    console.log('✅ All tables, indexes, RLS policies, triggers, and functions have been created.');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Run validation: pnpm validate:imhotep-data');
    console.log('   2. Test with data: pnpm test:imhotep-data-insert');
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
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

