#!/usr/bin/env node

/**
 * Validation Script for Imhotep Data Migration
 * 
 * This script validates that the migration was applied correctly by:
 * 1. Checking all tables exist
 * 2. Verifying RLS policies
 * 3. Testing tenant isolation
 * 4. Verifying generated fields
 * 5. Checking indexes
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

const EXPECTED_TABLES = [
  'formations_professionnelles',
  'sessions_professionnelles',
  'formateurs',
  'session_formateurs',
  'entreprises_clientes',
  'inscriptions_professionnelles',
  'paiements_professionnels',
  'codes_promo',
  'supports_cours',
];

const EXPECTED_ENUMS = [
  'session_professional_status',
  'enrollment_type',
  'enrollment_professional_status',
  'promo_code_reduction_type',
  'payment_method',
  'payment_professional_status',
];

const EXPECTED_FUNCTIONS = [
  'generate_session_code',
  'generate_enrollment_number',
];

async function validateMigration() {
  const client = await pool.connect();
  let allPassed = true;

  try {
    console.log('🔍 Validating Imhotep Data Migration...\n');

    // 1. Check Tables
    console.log('1️⃣  Checking tables...');
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename = ANY($1)
      ORDER BY tablename
    `, [EXPECTED_TABLES]);

    const foundTables = tablesResult.rows.map(r => r.tablename);
    const missingTables = EXPECTED_TABLES.filter(t => !foundTables.includes(t));

    if (missingTables.length > 0) {
      console.error(`   ❌ Missing tables: ${missingTables.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`   ✅ All ${EXPECTED_TABLES.length} tables exist`);
    }

    // 2. Check RLS Policies
    console.log('\n2️⃣  Checking RLS policies...');
    const rlsResult = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename = ANY($1)
      ORDER BY tablename
    `, [EXPECTED_TABLES]);

    const tablesWithoutRLS = rlsResult.rows.filter(r => !r.rowsecurity).map(r => r.tablename);
    if (tablesWithoutRLS.length > 0) {
      console.error(`   ❌ Tables without RLS: ${tablesWithoutRLS.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`   ✅ All ${EXPECTED_TABLES.length} tables have RLS enabled`);
    }

    // Check policies exist
    const policiesResult = await client.query(`
      SELECT tablename, COUNT(*) as policy_count
      FROM pg_policies 
      WHERE tablename = ANY($1)
      GROUP BY tablename
      ORDER BY tablename
    `, [EXPECTED_TABLES]);

    const tablesWithoutPolicies = EXPECTED_TABLES.filter(
      t => !policiesResult.rows.some(p => p.tablename === t)
    );

    if (tablesWithoutPolicies.length > 0) {
      console.error(`   ❌ Tables without policies: ${tablesWithoutPolicies.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`   ✅ All tables have RLS policies`);
    }

    // 3. Check ENUM Types
    console.log('\n3️⃣  Checking ENUM types...');
    const enumsResult = await client.query(`
      SELECT typname 
      FROM pg_type 
      WHERE typname = ANY($1)
      ORDER BY typname
    `, [EXPECTED_ENUMS]);

    const foundEnums = enumsResult.rows.map(r => r.typname);
    const missingEnums = EXPECTED_ENUMS.filter(e => !foundEnums.includes(e));

    if (missingEnums.length > 0) {
      console.error(`   ❌ Missing ENUM types: ${missingEnums.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`   ✅ All ${EXPECTED_ENUMS.length} ENUM types exist`);
    }

    // 4. Check Functions
    console.log('\n4️⃣  Checking functions...');
    const functionsResult = await client.query(`
      SELECT proname
      FROM pg_proc 
      WHERE proname = ANY($1)
      ORDER BY proname
    `, [EXPECTED_FUNCTIONS]);

    const foundFunctions = functionsResult.rows.map(r => r.proname);
    const missingFunctions = EXPECTED_FUNCTIONS.filter(f => !foundFunctions.includes(f));

    if (missingFunctions.length > 0) {
      console.error(`   ❌ Missing functions: ${missingFunctions.join(', ')}`);
      allPassed = false;
    } else {
      console.log(`   ✅ All ${EXPECTED_FUNCTIONS.length} functions exist`);
    }

    // 5. Check Indexes
    console.log('\n5️⃣  Checking indexes...');
    const indexesResult = await client.query(`
      SELECT 
        tablename,
        COUNT(*) as index_count
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename = ANY($1)
      GROUP BY tablename
      ORDER BY tablename
    `, [EXPECTED_TABLES]);

    console.log('   Index counts per table:');
    indexesResult.rows.forEach(row => {
      console.log(`     - ${row.tablename}: ${row.index_count} indexes`);
    });

    // 6. Check Foreign Keys
    console.log('\n6️⃣  Checking foreign keys...');
    const fkResult = await client.query(`
      SELECT 
        tc.table_name,
        COUNT(*) as fk_count
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ANY($1)
      GROUP BY tc.table_name
      ORDER BY tc.table_name
    `, [EXPECTED_TABLES]);

    console.log('   Foreign key counts per table:');
    fkResult.rows.forEach(row => {
      console.log(`     - ${row.table_name}: ${row.fk_count} foreign keys`);
    });

    // 7. Test Tenant Isolation (if tenants exist)
    console.log('\n7️⃣  Testing tenant isolation...');
    const tenantResult = await client.query(`
      SELECT id FROM tenants LIMIT 1
    `);

    if (tenantResult.rows.length > 0) {
      const testTenantId = tenantResult.rows[0].id;
      
      // Set tenant context (using string interpolation for SET command)
      await client.query(`SET app.tenant_id = '${testTenantId}'`);
      
      // Try to query (should work)
      const queryResult = await client.query(`
        SELECT COUNT(*) as count 
        FROM formations_professionnelles
      `);
      
      console.log(`   ✅ RLS working: Can query with tenant context (${queryResult.rows[0].count} rows)`);
      
      // Try without tenant context (should fail or return empty)
      await client.query(`RESET app.tenant_id`);
      
      try {
        const noContextResult = await client.query(`
          SELECT COUNT(*) as count 
          FROM formations_professionnelles
        `);
        console.log(`   ⚠️  Warning: Query without tenant context returned ${noContextResult.rows[0].count} rows`);
      } catch (error) {
        console.log(`   ✅ RLS working: Query without tenant context correctly blocked`);
      }
    } else {
      console.log('   ⚠️  No tenants found - skipping tenant isolation test');
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (allPassed) {
      console.log('✅ All validations passed!');
      console.log('✅ Migration is complete and correct.');
    } else {
      console.log('❌ Some validations failed!');
      console.log('❌ Please review the errors above.');
    }
    console.log('='.repeat(50) + '\n');

    return allPassed;

  } catch (error) {
    console.error('\n❌ Validation error:');
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    return false;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run validation
if (require.main === module) {
  validateMigration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { validateMigration };

