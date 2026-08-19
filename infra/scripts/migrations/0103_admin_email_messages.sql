-- 0103 — Traçabilité des emails composés depuis /admin/messages
--
-- La page « Messages » de l'administration n'ouvre plus de conversations : elle
-- compose et envoie des emails. L'application doit néanmoins garder la trace de
-- ce qui est parti, à qui, et avec quel résultat — d'où ces deux tables.
--
-- `admin_email_messages` porte le message tel qu'il a été rédigé (un seul par
-- envoi, quel que soit le nombre de destinataires) ; `admin_email_recipients`
-- porte le résultat individuel, puisqu'un envoi peut réussir pour certains et
-- échouer pour d'autres.

CREATE TABLE IF NOT EXISTS admin_email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name VARCHAR(255),
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  -- Métadonnées des pièces jointes (nom, type, taille). Le binaire n'est pas
  -- conservé : il part dans l'email, le journal n'a pas vocation à l'archiver.
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_email_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES admin_email_messages(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 'parent' | 'teacher' | 'student'
  recipient_type VARCHAR(16) NOT NULL,
  recipient_name VARCHAR(255),
  recipient_email VARCHAR(320) NOT NULL,
  -- 'sent' | 'failed'
  status VARCHAR(16) NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_email_messages_tenant_created
  ON admin_email_messages(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_email_recipients_message
  ON admin_email_recipients(message_id);

CREATE INDEX IF NOT EXISTS idx_admin_email_recipients_tenant_status
  ON admin_email_recipients(tenant_id, status);

ALTER TABLE admin_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_email_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'admin_email_messages'
       AND policyname = 'admin_email_messages_tenant_isolation'
  ) THEN
    CREATE POLICY admin_email_messages_tenant_isolation ON admin_email_messages
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'admin_email_recipients'
       AND policyname = 'admin_email_recipients_tenant_isolation'
  ) THEN
    CREATE POLICY admin_email_recipients_tenant_isolation ON admin_email_recipients
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
