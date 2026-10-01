#!/usr/bin/env node

/**
 * Script pour appliquer la migration 0043_update_teacher_attendance_time_slots.sql
 * Usage: node scripts/apply-migration-0043.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'dbecoledigitale',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || (() => { throw new Error("DB_PASSWORD (ou POSTGRES_PASSWORD) est requis"); })(),
};

const DATABASE_URL = process.env.DATABASE_URL;

async function applyMigration() {
  console.log('🔄 Application de la migration 0043_update_teacher_attendance_time_slots.sql');
  console.log('='.repeat(60));
  
  // Lire le fichier de migration
  const migrationPath = path.join(__dirname, '..', 'infra', 'scripts', 'migrations', '0043_update_teacher_attendance_time_slots.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Fichier de migration non trouvé: ${migrationPath}`);
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  // Utiliser DATABASE_URL si disponible, sinon DB_CONFIG
  const client = DATABASE_URL ? new Client({ connectionString: DATABASE_URL }) : new Client(DB_CONFIG);
  
  try {
    await client.connect();
    console.log('✅ Connecté à la base de données');
    if (DATABASE_URL) {
      console.log('   (via DATABASE_URL)');
    } else {
      console.log(`   (${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database})`);
    }
    console.log('');
    
    // Exécuter la migration
    console.log('📝 Exécution de la migration...');
    await client.query(migrationSQL);
    
    console.log('');
    console.log('✅ Migration appliquée avec succès !');
    console.log('');
    console.log('📋 Résumé des changements:');
    console.log('   - Contrainte CHECK mise à jour pour time_slot');
    console.log('   - Nouveaux créneaux horaires supportés:');
    console.log('     • 08:00-10:00 (2h)');
    console.log('     • 10:00-12:00 (2h)');
    console.log('     • 14:00-16:00 (2h)');
    console.log('     • 16:00-18:00 (2h)');
    console.log('     • 08:00-12:00 (4h)');
    console.log('     • 13:00-17:00 (4h)');
    console.log('     • 18:00-20:00 (2h)');
    
  } catch (error) {
    console.error('');
    console.error('❌ Erreur lors de l\'application de la migration:');
    console.error(error.message);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Exécuter la migration
if (require.main === module) {
  applyMigration().catch(console.error);
}

module.exports = { applyMigration };

