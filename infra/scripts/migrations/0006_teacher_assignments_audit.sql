-- Teacher Assignments Audit History
-- Logs INSERT/UPDATE/DELETE to keep an audit trail

CREATE TABLE IF NOT EXISTS teacher_assignments_audit (
  id BIGSERIAL PRIMARY KEY,
  teacher_assignment_id UUID,
  tenant_id UUID NOT NULL,
  action TEXT NOT NULL, -- INSERT, UPDATE, DELETE
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by UUID NULL, -- optional: user id if available via app.user_id
  old_row JSONB,
  new_row JSONB
);

-- RLS
ALTER TABLE teacher_assignments_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY teacher_assignments_audit_tenant_policy ON teacher_assignments_audit
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Trigger function
CREATE OR REPLACE FUNCTION log_teacher_assignments_audit() RETURNS TRIGGER AS $$
DECLARE
  actor UUID;
BEGIN
  BEGIN
    actor := current_setting('app.user_id', true)::UUID;
  EXCEPTION WHEN OTHERS THEN
    actor := NULL;
  END;

  IF (TG_OP = 'DELETE') THEN
    INSERT INTO teacher_assignments_audit (teacher_assignment_id, tenant_id, action, changed_by, old_row, new_row)
    VALUES (OLD.id, OLD.tenant_id, TG_OP, actor, to_jsonb(OLD), NULL);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO teacher_assignments_audit (teacher_assignment_id, tenant_id, action, changed_by, old_row, new_row)
    VALUES (NEW.id, NEW.tenant_id, TG_OP, actor, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO teacher_assignments_audit (teacher_assignment_id, tenant_id, action, changed_by, old_row, new_row)
    VALUES (NEW.id, NEW.tenant_id, TG_OP, actor, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_teacher_assignments_audit ON teacher_assignments;
CREATE TRIGGER trg_teacher_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION log_teacher_assignments_audit();

