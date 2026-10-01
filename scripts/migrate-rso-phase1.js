#!/usr/bin/env node

/**
 * Migration Script for RSO-PFSO Phase 1
 * 
 * This script applies the migration 0021_rso_phase1.sql
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
    console.log('🚀 Starting migration: RSO-PFSO Phase 1 - Infrastructure et Authentification');
    console.log('');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0021_rso_phase1.sql');
    
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
    console.log('   - rso_users table (user accounts with authentication)');
    console.log('   - rso_user_sessions table (active sessions tracking)');
    console.log('   - rso_activity_logs table (ISPS compliance audit trail)');
    console.log('   - rso_permissions table (role-based permissions)');
    console.log('   - Indexes for performance optimization');
    console.log('   - RLS policies for tenant isolation (ASPCI tenant)');
    console.log('   - Default permissions seeded for all roles');
    console.log('   - Auto-update trigger for updated_at timestamp');
    console.log('');
    console.log('✅ All RSO-PFSO Phase 1 database structures are ready!');
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

