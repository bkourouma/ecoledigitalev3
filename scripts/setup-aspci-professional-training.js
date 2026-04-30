#!/usr/bin/env node

/**
 * Setup Script for ASPCI Professional Training Module
 * 
 * This script ensures that all professional training tables and functions
 * are properly set up for the ASPCI tenant. It verifies that:
 * 1. All required migrations have been applied
 * 2. All tables exist and have RLS policies
 * 3. Code generation functions are tenant-aware
 * 
 * The tables are already multi-tenant and work for all tenants.
 * This script just verifies everything is in place.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL ||
  process.env.PG_CONNECTION_STRING ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const pool = new Pool({ connectionString: databaseUrl });

// Required tables for professional training
const REQUIRED_TABLES = [
  'formations_professionnelles',
  'sessions_professionnelles',
  'formateurs',
  'session_formateurs',
  'entreprises_clientes',
  'inscriptions_professionnelles',
  'paiements_professionnels',
  'codes_promo',
  'supports_cours',
  'reservations_temporaires',
  'session_attendance',
  'support_session_associations',
  'support_telechargements',
  'formateur_indisponibilites',
  'notifications_formateurs',
  'documents',
  'export_jobs'
];

async function checkTables() {
  const client = await pool.connect();
  try {
    console.log('📋 Checking required tables...\n');
    
    const missingTables = [];
    
    for (const table of REQUIRED_TABLES) {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM pg_tables 
          WHERE schemaname = 'public' 
          AND tablename = $1
        )
      `, [table]);
      
      if (result.rows[0].exists) {
        console.log(`  ✅ ${table}`);
      } else {
        console.log(`  ❌ ${table} - MISSING`);
        missingTables.push(table);
      }
    }
    
    if (missingTables.length > 0) {
      console.log(`\n⚠️  Missing tables: ${missingTables.join(', ')}`);
      console.log('   Please run migrations 0037, 0038, 0039, 0040, 0041, and 0044 first.');
      return false;
    }
    
    console.log('\n✅ All required tables exist!\n');
    return true;
  } finally {
    client.release();
  }
}

async function checkRLSPolicies() {
  const client = await pool.connect();
  try {
    console.log('🔒 Checking RLS policies...\n');
    
    for (const table of REQUIRED_TABLES) {
      const result = await client.query(`
        SELECT 
          tablename,
          rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = $1
      `, [table]);
      
      if (result.rows.length > 0) {
        const rowsecurity = result.rows[0].rowsecurity;
        if (rowsecurity) {
          console.log(`  ✅ ${table} - RLS enabled`);
        } else {
          console.log(`  ⚠️  ${table} - RLS not enabled`);
        }
      }
    }
    
    console.log('\n✅ RLS policies checked!\n');
    return true;
  } finally {
    client.release();
  }
}

async function checkFunctions() {
  const client = await pool.connect();
  try {
    console.log('⚙️  Checking code generation functions...\n');
    
    // Check generate_session_code
    const sessionCodeResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'generate_session_code'
      )
    `);
    
    if (sessionCodeResult.rows[0].exists) {
      console.log('  ✅ generate_session_code function exists');
    } else {
      console.log('  ❌ generate_session_code function missing');
      return false;
    }
    
    // Check generate_enrollment_number
    const enrollmentResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'generate_enrollment_number'
      )
    `);
    
    if (enrollmentResult.rows[0].exists) {
      console.log('  ✅ generate_enrollment_number function exists');
    } else {
      console.log('  ❌ generate_enrollment_number function missing');
      return false;
    }
    
    console.log('\n✅ All functions exist!\n');
    return true;
  } finally {
    client.release();
  }
}

async function checkASPCITenant() {
  const client = await pool.connect();
  try {
    console.log('🏢 Checking ASPCI tenant...\n');
    
    const result = await client.query(`
      SELECT id, slug, name
      FROM tenants
      WHERE slug = 'aspci' OR id = '52da6ca7-81ad-47ad-b5c3-6f437f64ba37'
    `);
    
    if (result.rows.length === 0) {
      console.log('  ❌ ASPCI tenant not found');
      console.log('   Please create the ASPCI tenant first.');
      return false;
    }
    
    const tenant = result.rows[0];
    console.log(`  ✅ ASPCI tenant found:`);
    console.log(`     ID: ${tenant.id}`);
    console.log(`     Slug: ${tenant.slug}`);
    console.log(`     Name: ${tenant.name}`);
    console.log('\n✅ ASPCI tenant verified!\n');
    return true;
  } finally {
    client.release();
  }
}

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🚀 Running migration 0045_aspci_professional_training_setup.sql...\n');
    
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0045_aspci_professional_training_setup.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.log('  ❌ Migration file not found:', migrationPath);
      return false;
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    try {
      await client.query(migrationSQL);
      await client.query('COMMIT');
      console.log('  ✅ Migration 0045 applied successfully!\n');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🔧 ASPCI Professional Training Setup\n');
  console.log('=====================================\n');
  
  try {
    // Check ASPCI tenant exists
    const tenantOk = await checkASPCITenant();
    if (!tenantOk) {
      process.exit(1);
    }
    
    // Check all tables exist
    const tablesOk = await checkTables();
    if (!tablesOk) {
      console.log('\n❌ Setup incomplete. Please run the required migrations first.');
      process.exit(1);
    }
    
    // Check RLS policies
    await checkRLSPolicies();
    
    // Check functions
    const functionsOk = await checkFunctions();
    if (!functionsOk) {
      console.log('\n⚠️  Some functions are missing. Running migration 0045...\n');
      await runMigration();
    } else {
      // Run migration anyway to ensure functions are tenant-aware
      console.log('🔄 Updating functions to be tenant-aware...\n');
      await runMigration();
    }
    
    console.log('✅ ASPCI Professional Training setup complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Login as admin@aspci.fr');
    console.log('   2. Access the Administration menu');
    console.log('   3. You should see all professional training features');
    console.log('   4. Create formations, sessions, and manage enrollments');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

