const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const connectionString = process.env.DATABASE_URL ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const migrationFile = path.join(__dirname, '../infra/scripts/migrations/0047_increase_price_precision.sql');

console.log('📋 Applying price precision migration...');
console.log(`   Migration file: ${migrationFile}`);

if (!fs.existsSync(migrationFile)) {
  console.error(`❌ Migration file not found: ${migrationFile}`);
  process.exit(1);
}

async function applyMigration() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('🔗 Connected to database\n');
    
    // Read the SQL file
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    // Remove BEGIN/COMMIT if present (we'll handle transactions)
    const cleanSql = sql.replace(/^BEGIN;?\s*/i, '').replace(/COMMIT;?\s*$/i, '');
    
    console.log('🔧 Executing migration...\n');
    
    // Execute the migration
    await client.query('BEGIN');
    
    try {
      // Update formations_professionnelles table
      console.log('   Updating formations_professionnelles...');
      await client.query(`
        ALTER TABLE formations_professionnelles 
          ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
          ALTER COLUMN prix_ttc TYPE DECIMAL(15,2)
      `);
      
      // Update sessions_professionnelles table
      console.log('   Updating sessions_professionnelles...');
      await client.query(`
        ALTER TABLE sessions_professionnelles 
          ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
          ALTER COLUMN prix_ttc TYPE DECIMAL(15,2)
      `);
      
      // Update formations_professionnelles_aspci table
      console.log('   Updating formations_professionnelles_aspci...');
      await client.query(`
        ALTER TABLE formations_professionnelles_aspci 
          ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
          ALTER COLUMN prix_ttc TYPE DECIMAL(15,2)
      `);
      
      // Update sessions_professionnelles_aspci table
      console.log('   Updating sessions_professionnelles_aspci...');
      await client.query(`
        ALTER TABLE sessions_professionnelles_aspci 
          ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
          ALTER COLUMN prix_ttc TYPE DECIMAL(15,2)
      `);
      
      // Update formateurs table
      console.log('   Updating formateurs...');
      await client.query(`
        ALTER TABLE formateurs 
          ALTER COLUMN tarif_journalier TYPE DECIMAL(15,2)
      `);
      
      // Update formateurs_aspci table
      console.log('   Updating formateurs_aspci...');
      await client.query(`
        ALTER TABLE formateurs_aspci 
          ALTER COLUMN tarif_journalier TYPE DECIMAL(15,2)
      `);
      
      // Update inscriptions_professionnelles table
      console.log('   Updating inscriptions_professionnelles...');
      await client.query(`
        ALTER TABLE inscriptions_professionnelles 
          ALTER COLUMN montant_ht TYPE DECIMAL(15,2),
          ALTER COLUMN montant_ttc TYPE DECIMAL(15,2),
          ALTER COLUMN reduction_appliquee TYPE DECIMAL(15,2)
      `);
      
      // Update inscriptions_professionnelles_aspci table
      console.log('   Updating inscriptions_professionnelles_aspci...');
      await client.query(`
        ALTER TABLE inscriptions_professionnelles_aspci 
          ALTER COLUMN montant_ht TYPE DECIMAL(15,2),
          ALTER COLUMN montant_ttc TYPE DECIMAL(15,2),
          ALTER COLUMN reduction_appliquee TYPE DECIMAL(15,2)
      `);
      
      // Update paiements_professionnels table
      console.log('   Updating paiements_professionnels...');
      await client.query(`
        ALTER TABLE paiements_professionnels 
          ALTER COLUMN montant TYPE DECIMAL(15,2)
      `);
      
      // Update paiements_professionnels_aspci table
      console.log('   Updating paiements_professionnels_aspci...');
      await client.query(`
        ALTER TABLE paiements_professionnels_aspci 
          ALTER COLUMN montant TYPE DECIMAL(15,2)
      `);
      
      // Update codes_promo table
      console.log('   Updating codes_promo...');
      await client.query(`
        ALTER TABLE codes_promo 
          ALTER COLUMN valeur_reduction TYPE DECIMAL(15,2)
      `);
      
      // Update codes_promo_aspci table
      console.log('   Updating codes_promo_aspci...');
      await client.query(`
        ALTER TABLE codes_promo_aspci 
          ALTER COLUMN valeur_reduction TYPE DECIMAL(15,2)
      `);
      
      await client.query('COMMIT');
      
      console.log('\n✅ Migration applied successfully!');
      console.log('\n📊 All price columns updated to DECIMAL(15,2):');
      console.log('   - formations_professionnelles: prix_ht, prix_ttc');
      console.log('   - sessions_professionnelles: prix_ht, prix_ttc');
      console.log('   - formations_professionnelles_aspci: prix_ht, prix_ttc');
      console.log('   - sessions_professionnelles_aspci: prix_ht, prix_ttc');
      console.log('   - formateurs: tarif_journalier');
      console.log('   - formateurs_aspci: tarif_journalier');
      console.log('   - inscriptions_professionnelles: montant_ht, montant_ttc, reduction_appliquee');
      console.log('   - inscriptions_professionnelles_aspci: montant_ht, montant_ttc, reduction_appliquee');
      console.log('   - paiements_professionnels: montant');
      console.log('   - paiements_professionnels_aspci: montant');
      console.log('   - codes_promo: valeur_reduction');
      console.log('   - codes_promo_aspci: valeur_reduction');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('\n❌ Error applying migration:', error.message);
    if (error.detail) console.error('   Detail:', error.detail);
    if (error.hint) console.error('   Hint:', error.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();

