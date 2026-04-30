const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';
const client = new Client({ connectionString: databaseUrl });

async function applyMigration() {
  await client.connect();
  console.log('🔗 Connected to database.');
  console.log('\n🔧 Applying ASPCI Dedicated Tables Migration\n');
  console.log('==================================================\n');

  try {
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0046_create_aspci_professional_training_tables.sql');
    console.log(`📄 Reading migration file: 0046_create_aspci_professional_training_tables.sql...`);
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('  🚀 Applying migration...');
    await client.query(migrationSQL);
    
    console.log('  ✅ Migration applied successfully!');
    
    // Verify tables were created
    console.log('\n📋 Verifying ASPCI tables were created...');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%_aspci'
      ORDER BY table_name
    `);
    
    console.log(`  ✅ Found ${tablesResult.rows.length} ASPCI-specific tables:`);
    tablesResult.rows.forEach(row => {
      console.log(`     - ${row.table_name}`);
    });
    
    console.log('\n✅ ASPCI Dedicated Tables Migration Complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Services need to be updated to use getTableName() helper');
    console.log('   2. All SQL queries must use tenant-specific table names');
    console.log('   3. Test with admin@aspci.fr account');
    
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    throw error;
  } finally {
    await client.end();
  }
}

applyMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

