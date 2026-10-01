#!/usr/bin/env node

/**
 * Migration Script for RSO Notifications Table Only
 * 
 * Creates only the rso_notifications table if it doesn't exist
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({
  connectionString: databaseUrl,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Checking and creating rso_notifications table...');
    console.log('');
    
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'rso_notifications'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ Table rso_notifications already exists');
      console.log('');
      
      // Verify structure
      const columnsCheck = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'rso_notifications'
        ORDER BY ordinal_position
      `);
      
      console.log(`   Found ${columnsCheck.rows.length} columns:`);
      columnsCheck.rows.forEach(row => {
        console.log(`      - ${row.column_name} (${row.data_type})`);
      });
      console.log('');
      console.log('✅ Migration not needed - table already exists');
      return;
    }
    
    console.log('📄 Creating rso_notifications table...');
    
    // Create only the notifications table
    const createTableSQL = `
-- =================================================================
-- TABLE: rso_notifications
-- =================================================================
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

-- Indexes for rso_notifications
CREATE INDEX IF NOT EXISTS idx_rso_notifications_user_lue ON rso_notifications(user_id, lue);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_type ON rso_notifications(type);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_priorite ON rso_notifications(priorite);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_created_at ON rso_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_rso_notifications_expire_le ON rso_notifications(expire_le) WHERE expire_le IS NOT NULL;
    `;
    
    // Execute in a transaction
    await client.query('BEGIN');
    try {
      await client.query(createTableSQL);
      await client.query('COMMIT');
      console.log('   ✅ Table rso_notifications created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📋 Created:');
    console.log('   - rso_notifications table');
    console.log('   - Indexes for query performance');
    console.log('');
    console.log('🎉 Notifications table is ready!');
    
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

