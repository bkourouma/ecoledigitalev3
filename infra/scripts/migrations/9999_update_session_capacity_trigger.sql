-- T108: Trigger to automatically update session capacity when enrollments change
-- This trigger calls a function that updates places_reservees and statut

-- Create function to update session capacity
CREATE OR REPLACE FUNCTION update_session_capacity_on_enrollment_change()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_tenant_id UUID;
  v_places_reservees INTEGER;
  v_places_totales INTEGER;
  v_places_disponibles INTEGER;
  v_new_statut session_professional_status;
BEGIN
  -- Determine session_id and tenant_id based on operation
  IF TG_OP = 'DELETE' THEN
    v_session_id := OLD.session_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_session_id := NEW.session_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  -- Count confirmed enrollments
  SELECT COUNT(*)::integer
  INTO v_places_reservees
  FROM inscriptions_professionnelles
  WHERE session_id = v_session_id
    AND tenant_id = v_tenant_id
    AND statut = 'confirmee';

  -- Get session capacity
  SELECT places_totales, statut
  INTO v_places_totales, v_new_statut
  FROM sessions_professionnelles
  WHERE id = v_session_id AND tenant_id = v_tenant_id;

  -- Calculate available places
  v_places_disponibles := GREATEST(0, v_places_totales - v_places_reservees);

  -- Determine new status
  IF v_places_disponibles = 0 AND v_places_totales > 0 THEN
    -- Session is full
    IF v_new_statut = 'ouverte' THEN
      v_new_statut := 'complete';
    END IF;
  ELSIF v_places_disponibles > 0 AND v_new_statut = 'complete' THEN
    -- Session has available places again
    v_new_statut := 'ouverte';
  END IF;

  -- Update session
  UPDATE sessions_professionnelles
  SET places_reservees = v_places_reservees,
      places_disponibles = v_places_disponibles,
      statut = v_new_statut,
      updated_at = NOW()
  WHERE id = v_session_id AND tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for INSERT
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_insert ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_insert
  AFTER INSERT ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (NEW.statut = 'confirmee')
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

-- Create trigger for UPDATE
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_update ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_update
  AFTER UPDATE ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

-- Create trigger for DELETE
DROP TRIGGER IF EXISTS trigger_update_session_capacity_on_enrollment_delete ON inscriptions_professionnelles;
CREATE TRIGGER trigger_update_session_capacity_on_enrollment_delete
  AFTER DELETE ON inscriptions_professionnelles
  FOR EACH ROW
  WHEN (OLD.statut = 'confirmee')
  EXECUTE FUNCTION update_session_capacity_on_enrollment_change();

-- Add comment
COMMENT ON FUNCTION update_session_capacity_on_enrollment_change() IS 'Automatically updates session capacity (places_reservees, places_disponibles, statut) when enrollments change';

