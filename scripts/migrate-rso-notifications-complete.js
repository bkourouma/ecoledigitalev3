#!/usr/bin/env node

/**
 * Complete Migration Script for RSO Notifications
 * 
 * Creates the rso_notifications table with RLS policies and triggers
 */

const { Pool } = require('pg');

// Database connection configuration
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  'postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale';

const pool = new Pool({
  connectionString: databaseUrl,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Setting up complete rso_notifications table...');
    console.log('');
    
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'rso_notifications'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('📄 Creating rso_notifications table...');
      
      const createTableSQL = `
CREATE TABLE IF NOT EXISTS rso_notifications (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('recommandation_nouvelle', 'recommandation_echeance', 'recommandation_retard', 'activite_nouvelle', 'activite_modifiee', 'commentaire', 'validation', 'autre')),
    titre VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    entite_type VARCHAR(50),
    entite_id INT,
    url VARCHAR(500),
    lue BOOLEAN NOT NULL DEFAULT FALSE,
    lue_le TIMESTAMP WITH TIME ZONE,
    priorite VARCHAR(20) NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute', 'urgente')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expire_le TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT rso_notifications_titre_length CHECK (LENGTH(TRIM(titre)) > 0),
    CONSTRAINT rso_notifications_message_length CHECK (LENGTH(TRIM(message)) > 0)
);
      `;
      
      await client.query(createTableSQL);
      console.log('   ✅ Table created');
    } else {
      console.log('   ✅ Table already exists');
    }
    
    // Create indexes
    console.log('📄 Creating indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_rso_notifications_user_lue ON rso_notifications(user_id, lue)',
      'CREATE INDEX IF NOT EXISTS idx_rso_notifications_type ON rso_notifications(type)',
      'CREATE INDEX IF NOT EXISTS idx_rso_notifications_priorite ON rso_notifications(priorite)',
      'CREATE INDEX IF NOT EXISTS idx_rso_notifications_created_at ON rso_notifications(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_rso_notifications_expire_le ON rso_notifications(expire_le) WHERE expire_le IS NOT NULL'
    ];
    
    for (const indexSQL of indexes) {
      await client.query(indexSQL);
    }
    console.log('   ✅ Indexes created');
    
    // Create triggers
    console.log('📄 Creating triggers...');
    
    // Trigger to update notification read timestamp
    await client.query(`
CREATE OR REPLACE FUNCTION update_rso_notifications_lue_le()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lue = TRUE AND OLD.lue = FALSE THEN
        NEW.lue_le = CURRENT_TIMESTAMP;
    ELSIF NEW.lue = FALSE THEN
        NEW.lue_le = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
DROP TRIGGER IF EXISTS trigger_rso_notifications_lue_le ON rso_notifications;
CREATE TRIGGER trigger_rso_notifications_lue_le
    BEFORE UPDATE ON rso_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_rso_notifications_lue_le();
    `);
    
    // Trigger to set notification expiration (30 days default)
    await client.query(`
CREATE OR REPLACE FUNCTION set_rso_notifications_expire_le()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expire_le IS NULL THEN
        NEW.expire_le = NEW.created_at + INTERVAL '30 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
DROP TRIGGER IF EXISTS trigger_rso_notifications_expire_le ON rso_notifications;
CREATE TRIGGER trigger_rso_notifications_expire_le
    BEFORE INSERT ON rso_notifications
    FOR EACH ROW
    EXECUTE FUNCTION set_rso_notifications_expire_le();
    `);
    
    console.log('   ✅ Triggers created');
    
    // Enable RLS
    console.log('📄 Setting up Row Level Security...');
    await client.query('ALTER TABLE rso_notifications ENABLE ROW LEVEL SECURITY');
    
    // Create RLS policy for tenant isolation
    await client.query(`
DROP POLICY IF EXISTS rso_notifications_tenant_isolation ON rso_notifications;
CREATE POLICY rso_notifications_tenant_isolation ON rso_notifications
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_users u
            WHERE u.id = rso_notifications.user_id
            AND u.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM rso_users u
            WHERE u.id = rso_notifications.user_id
            AND u.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );
    `);
    
    console.log('   ✅ RLS policies created');
    
    console.log('');
    console.log('✅ Complete migration finished successfully!');
    console.log('');
    console.log('📋 Created/Updated:');
    console.log('   - rso_notifications table');
    console.log('   - Indexes for query performance');
    console.log('   - Triggers for automatic timestamp updates');
    console.log('   - RLS policies for tenant and user isolation');
    console.log('');
    console.log('🎉 Notifications system is ready!');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
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

// Run the migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

