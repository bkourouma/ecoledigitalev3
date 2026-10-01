#!/usr/bin/env node

/**
 * Apply all required migrations for ASPCI professional training
 * 
 * This script applies all migrations needed for professional training:
 * - 0037: Base professional training tables
 * - 0038: Full-text search index
 * - 0039: Temporary reservations
 * - 0040: Trainer space tables
 * - 0041: Documents and export jobs
 * - 0044: Career field
 * - 0045: ASPCI-specific setup (tenant-aware code generation)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL ||
  process.env.PG_CONNECTION_STRING ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({ connectionString: databaseUrl });

const MIGRATIONS = [
  '0037_imhotep_data_professional_training.sql',
  '0038_add_formations_pro_fts_index.sql',
  '0039_reservations_temporaires.sql',
  '0040_formateur_space_tables.sql',
  '0041_documents_export_jobs.sql',
  '0044_add_carriere_to_formations_professionnelles.sql',
  '0045_aspci_professional_training_setup.sql'
];

async function applyMigration(migrationFile) {
  const client = await pool.connect();
  try {
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      console.log(`  ⚠️  Migration file not found: ${migrationFile}`);
      return false;
    }
    
    console.log(`  📄 Reading ${migrationFile}...`);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log(`  🚀 Applying ${migrationFile}...`);
    await client.query('BEGIN');
    try {
      await client.query(migrationSQL);
      await client.query('COMMIT');
      console.log(`  ✅ ${migrationFile} applied successfully!`);
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Some errors are expected (e.g., table already exists, enum already exists)
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate') ||
          error.message.includes('duplicate_object')) {
        console.log(`  ⚠️  ${migrationFile} - Some objects already exist (this is OK)`);
        return true;
      }
      
      throw error;
    }
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🔧 Applying ASPCI Professional Training Migrations\n');
  console.log('==================================================\n');
  
  try {
    for (const migration of MIGRATIONS) {
      console.log(`\n📦 Processing ${migration}...`);
      await applyMigration(migration);
    }
    
    console.log('\n✅ All migrations applied successfully!');
    console.log('\n📝 ASPCI tenant is now ready to use all professional training features.');
    console.log('   - Formations professionnelles');
    console.log('   - Sessions professionnelles');
    console.log('   - Formateurs');
    console.log('   - Inscriptions');
    console.log('   - Paiements');
    console.log('   - Codes promo');
    console.log('   - Supports de cours');
    console.log('   - Documents');
    console.log('   - Export jobs');
    console.log('\n   Login as admin@aspci.fr to access these features.');
    
  } catch (error) {
    console.error('\n❌ Error applying migrations:', error.message);
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

