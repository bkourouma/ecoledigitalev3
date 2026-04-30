#!/usr/bin/env node

/**
 * Rollback Script for RSO-PFSO Phase 4
 * 
 * This script executes the rollback migration 0024_rso_phase4_rollback.sql
 * to remove all Phase 4 tables and extensions.
 * 
 * WARNING: This will delete all data in RSO Phase 4 tables:
 * - rso_documents_exports
 * - rso_quotas_utilisateurs
 * - Phase 4 columns from rso_activites_medias (if table exists)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
// Can be overridden with DATABASE_URL environment variable
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const pool = new Pool({
  connectionString: databaseUrl,
});

async function runRollback() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting rollback: RSO-PFSO Phase 4 - Gestion des Médias et Documents');
    console.log('');
    console.log('⚠️  WARNING: This will delete all data in RSO Phase 4 tables!');
    console.log('   - rso_documents_exports');
    console.log('   - rso_quotas_utilisateurs');
    console.log('   - Phase 4 columns from rso_activites_medias (if table exists)');
    console.log('');
    
    // Read the rollback migration file
    const rollbackPath = path.join(__dirname, '../infra/scripts/migrations/0024_rso_phase4_rollback.sql');
    
    if (!fs.existsSync(rollbackPath)) {
      throw new Error(`Rollback file not found: ${rollbackPath}`);
    }
    
    const rollbackSQL = fs.readFileSync(rollbackPath, 'utf8');
    
    console.log('📄 Reading rollback file...');
    console.log(`   Path: ${rollbackPath}`);
    console.log('');
    
    // Execute the rollback
    console.log('⚙️  Executing rollback SQL...');
    
    // Execute the entire rollback SQL in a transaction
    await client.query('BEGIN');
    try {
      await client.query(rollbackSQL);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
    console.log('');
    console.log('✅ Rollback completed successfully!');
    console.log('');
    console.log('📋 Removed:');
    console.log('   - rso_documents_exports table and all related objects');
    console.log('   - rso_quotas_utilisateurs table and all related objects');
    console.log('   - Phase 4 columns from rso_activites_medias (if table exists)');
    console.log('   - All indexes, triggers, and RLS policies');
    console.log('');
    console.log('🎉 Phase 4 rollback complete!');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Rollback failed:', error.message);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the rollback
runRollback().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

