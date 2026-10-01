#!/usr/bin/env node

/**
 * Seed Script for RSO Admin User
 * Creates a default administrator account for RSO-PFSO module
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection configuration
const databaseUrl = process.env.DATABASE_URL || 
  process.env.PG_CONNECTION_STRING ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({
  connectionString: databaseUrl,
});

async function seedRSOAdmin() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Seeding RSO Admin User...');
    console.log('');

    // Get ASPCI tenant ID
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = 'aspci' OR name ILIKE '%ASPCI%' LIMIT 1"
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('ASPCI tenant not found. Please create the tenant first.');
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`✅ Found tenant: ${tenantId}`);

    // Check if admin already exists
    const existingAdmin = await client.query(
      'SELECT id, username FROM rso_users WHERE tenant_id = $1 AND role = $2',
      [tenantId, 'administrateur']
    );

    if (existingAdmin.rows.length > 0) {
      console.log(`⚠️  Admin user already exists: ${existingAdmin.rows[0].username}`);
      console.log('   Skipping seed...');
      return;
    }

    // Default admin credentials
    const adminData = {
      username: 'admin',
      nom: 'Administrateur',
      prenoms: 'RSO',
      email: 'admin@aspci.rso',
      password: (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })()), // Change this in production!
      role: 'administrateur',
      statut: 'actif',
    };

    // Hash password
    const hashedPassword = await bcrypt.hash(adminData.password, 12);
    console.log('✅ Password hashed');

    // Insert admin user
    const result = await client.query(
      `INSERT INTO rso_users 
       (tenant_id, username, nom, prenoms, email, password, role, statut, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
       RETURNING id, username, email, role`,
      [
        tenantId,
        adminData.username,
        adminData.nom,
        adminData.prenoms,
        adminData.email,
        hashedPassword,
        adminData.role,
        adminData.statut,
      ]
    );

    const admin = result.rows[0];

    console.log('');
    console.log('✅ RSO Admin user created successfully!');
    console.log('');
    console.log('📋 Credentials:');
    console.log(`   Username: ${adminData.username}`);
    console.log(`   Email: ${adminData.email}`);
    console.log(`   Password: ${adminData.password}`);
    console.log(`   Role: ${adminData.role}`);
    console.log('');
    console.log('⚠️  IMPORTANT: Change the password after first login!');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error seeding RSO admin:');
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

// Run the seed
seedRSOAdmin().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

