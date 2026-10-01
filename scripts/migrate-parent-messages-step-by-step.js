const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: process.env.PGPASSWORD || (() => { throw new Error("PGPASSWORD est requis (mot de passe Postgres)"); })(),
  port: 5432,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: Parent Messages System');
    console.log('');
    
    const migrationPath = path.join(__dirname, '../infra/scripts/migrations/0029_parent_messages_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    
    try {
      // Step 1: Enable UUID extension
      console.log('📦 Step 1: Enabling UUID extension...');
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      console.log('   ✅ UUID extension enabled');
      
      // Step 2: Create ENUM types
      console.log('\n📦 Step 2: Creating ENUM types...');
      const enumTypes = [
        `DO $$ BEGIN
            CREATE TYPE message_priority AS ENUM ('low', 'normal', 'high', 'urgent');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE TYPE conversation_status AS ENUM ('active', 'archived', 'closed');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE TYPE notification_type AS ENUM ('message', 'announcement', 'event', 'grade', 'payment', 'other');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE TYPE rsvp_status AS ENUM ('pending', 'accepted', 'declined', 'tentative');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`
      ];
      
      for (const enumSQL of enumTypes) {
        await client.query(enumSQL);
      }
      console.log('   ✅ ENUM types created');
      
      // Step 3: Drop existing announcement_reads table if it exists (wrong structure)
      console.log('\n📦 Step 3: Checking for existing announcement_reads table...');
      const checkResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'announcement_reads'
        )
      `);
      
      if (checkResult.rows[0].exists) {
        console.log('   ⚠️  Existing announcement_reads table found, checking structure...');
        const columnsResult = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'announcement_reads'
        `);
        const hasTenantId = columnsResult.rows.some(row => row.column_name === 'tenant_id');
        
        if (!hasTenantId) {
          console.log('   🔄 Dropping existing table (wrong structure)...');
          await client.query('DROP TABLE IF EXISTS announcement_reads CASCADE');
          console.log('   ✅ Old table dropped');
        } else {
          console.log('   ✅ Table already has correct structure');
        }
      }
      
      // Step 4: Create tables
      console.log('\n📦 Step 4: Creating tables...');
      const tables = [
        `CREATE TABLE IF NOT EXISTS teacher_messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
            parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            priority_level message_priority,
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS school_announcements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            priority_level message_priority,
            posted_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS parent_teacher_conversations (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            status conversation_status DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS conversation_messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            conversation_id UUID NOT NULL REFERENCES parent_teacher_conversations(id) ON DELETE CASCADE,
            sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            notification_type notification_type NOT NULL,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            action_link TEXT,
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS event_invitations (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            event_id UUID,
            parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
            event_name VARCHAR(255) NOT NULL,
            event_description TEXT,
            event_date TIMESTAMPTZ NOT NULL,
            event_location VARCHAR(255),
            organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rsvp_status rsvp_status DEFAULT 'pending',
            rsvp_deadline DATE,
            rsvp_response_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS announcement_reads (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            announcement_id UUID NOT NULL REFERENCES school_announcements(id) ON DELETE CASCADE,
            parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            read_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(announcement_id, parent_id)
        );`
      ];
      
      for (let i = 0; i < tables.length; i++) {
        await client.query(tables[i]);
        console.log(`   ✅ Table ${i + 1} created`);
      }
      
      // Step 5: Create indexes
      console.log('\n📦 Step 5: Creating indexes...');
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_tenant_id ON teacher_messages(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_parent_id ON teacher_messages(tenant_id, parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_student_id ON teacher_messages(tenant_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_teacher_id ON teacher_messages(tenant_id, teacher_id)',
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_sent_at ON teacher_messages(tenant_id, sent_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_teacher_messages_read_at ON teacher_messages(tenant_id, read_at)',
        'CREATE INDEX IF NOT EXISTS idx_school_announcements_tenant_id ON school_announcements(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_school_announcements_posted_at ON school_announcements(tenant_id, posted_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_school_announcements_author_id ON school_announcements(tenant_id, author_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_tenant_id ON parent_teacher_conversations(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_parent_id ON parent_teacher_conversations(tenant_id, parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_teacher_id ON parent_teacher_conversations(tenant_id, teacher_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_student_id ON parent_teacher_conversations(tenant_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_teacher_conversations_updated_at ON parent_teacher_conversations(tenant_id, updated_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_conversation_messages_tenant_id ON conversation_messages(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(tenant_id, conversation_id)',
        'CREATE INDEX IF NOT EXISTS idx_conversation_messages_sent_at ON conversation_messages(tenant_id, conversation_id, sent_at ASC)',
        'CREATE INDEX IF NOT EXISTS idx_conversation_messages_read_at ON conversation_messages(tenant_id, read_at)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_parent_id ON notifications(tenant_id, parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(tenant_id, parent_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(tenant_id, parent_id, read_at)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(tenant_id, parent_id, notification_type)',
        'CREATE INDEX IF NOT EXISTS idx_event_invitations_tenant_id ON event_invitations(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_event_invitations_parent_id ON event_invitations(tenant_id, parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_event_invitations_student_id ON event_invitations(tenant_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_event_invitations_event_date ON event_invitations(tenant_id, event_date ASC)',
        'CREATE INDEX IF NOT EXISTS idx_event_invitations_rsvp_status ON event_invitations(tenant_id, parent_id, rsvp_status)',
        'CREATE INDEX IF NOT EXISTS idx_announcement_reads_tenant_id ON announcement_reads(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id ON announcement_reads(announcement_id)',
        'CREATE INDEX IF NOT EXISTS idx_announcement_reads_parent_id ON announcement_reads(parent_id)'
      ];
      
      for (let i = 0; i < indexes.length; i++) {
        try {
          await client.query(indexes[i]);
          if ((i + 1) % 5 === 0) {
            console.log(`   ✅ Created ${i + 1} indexes`);
          }
        } catch (error) {
          console.error(`   ❌ Error creating index ${i + 1}: ${indexes[i]}`);
          console.error(`   Error: ${error.message}`);
          throw error;
        }
      }
      console.log(`   ✅ All ${indexes.length} indexes created`);
      
      // Step 6: Enable RLS
      console.log('\n📦 Step 6: Enabling Row Level Security...');
      const rlsTables = [
        'teacher_messages',
        'school_announcements',
        'parent_teacher_conversations',
        'conversation_messages',
        'notifications',
        'event_invitations',
        'announcement_reads'
      ];
      
      for (const table of rlsTables) {
        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      }
      console.log('   ✅ RLS enabled on all tables');
      
      // Step 7: Create RLS policies
      console.log('\n📦 Step 7: Creating RLS policies...');
      const policies = [
        `DO $$ BEGIN
            CREATE POLICY teacher_messages_tenant_policy ON teacher_messages
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY school_announcements_tenant_policy ON school_announcements
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY parent_teacher_conversations_tenant_policy ON parent_teacher_conversations
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY conversation_messages_tenant_policy ON conversation_messages
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY notifications_tenant_policy ON notifications
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY event_invitations_tenant_policy ON event_invitations
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`,
        `DO $$ BEGIN
            CREATE POLICY announcement_reads_tenant_policy ON announcement_reads
                FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`
      ];
      
      for (let i = 0; i < policies.length; i++) {
        await client.query(policies[i]);
        console.log(`   ✅ Policy ${i + 1} created`);
      }
      
      // Step 8: Create triggers
      console.log('\n📦 Step 8: Creating triggers...');
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);
      
      await client.query(`
        CREATE TRIGGER update_teacher_messages_updated_at BEFORE UPDATE ON teacher_messages
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      await client.query(`
        CREATE TRIGGER update_school_announcements_updated_at BEFORE UPDATE ON school_announcements
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      await client.query(`
        CREATE TRIGGER update_parent_teacher_conversations_updated_at BEFORE UPDATE ON parent_teacher_conversations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      await client.query(`
        CREATE TRIGGER update_event_invitations_updated_at BEFORE UPDATE ON event_invitations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      await client.query(`
        CREATE OR REPLACE FUNCTION update_conversation_on_message()
        RETURNS TRIGGER AS $$
        BEGIN
            UPDATE parent_teacher_conversations
            SET updated_at = NOW()
            WHERE id = NEW.conversation_id;
            RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);
      
      await client.query(`
        CREATE TRIGGER update_conversation_on_message_insert AFTER INSERT ON conversation_messages
            FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();
      `);
      
      console.log('   ✅ All triggers created');
      
      await client.query('COMMIT');
      
      console.log('');
      console.log('✅ Migration completed successfully!');
      console.log('');
      console.log('📋 Created tables:');
      console.log('   - teacher_messages');
      console.log('   - school_announcements');
      console.log('   - parent_teacher_conversations');
      console.log('   - conversation_messages');
      console.log('   - notifications');
      console.log('   - event_invitations');
      console.log('   - announcement_reads');
      console.log('');
      console.log('✅ All tables, indexes, RLS policies, and triggers have been created.');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:');
    console.error(error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
    }
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

