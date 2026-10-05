-- =============================================================================
-- 1903 — Module admissions : liste d'attente en DÉCISION MANUELLE de la direction (réponse métier Q-A03)
-- =============================================================================
--
-- Avant : l'ordre était CALCULÉ (rang de la classe de priorité, puis ancienneté d'entrée, puis identifiant).
-- Désormais le rang est une DÉCISION HUMAINE :
--   * `applications.waitlist_rank` = rang défini par la direction (1 = premier). NULL = « à classer » : le dossier est entré
--     en liste d'attente mais personne n'a encore décidé de sa place. Il est affiché APRÈS les dossiers classés (par date
--     d'entrée, pour l'affichage seulement) et n'est JAMAIS proposé automatiquement en tête.
--   * l'ancienneté (`waitlist_entered_at`) et la classe de priorité restent des INFORMATIONS affichées, plus des clés de tri.
--   * chaque classement / déplacement / retrait de rang est tracé dans `waitlist_rank_changes` (append-only, acteur, motif).
-- Le rang est remis à NULL dès que le dossier quitte la liste (promotion, retrait, refus) ou y ré-entre.
-- =============================================================================

ALTER TABLE admissions.applications
  ADD COLUMN waitlist_rank integer CHECK (waitlist_rank IS NULL OR waitlist_rank >= 1);

CREATE TABLE admissions.waitlist_rank_changes (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id      uuid NOT NULL,
  campaign_id         uuid NOT NULL,
  grade_level_code    text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('RANKED', 'MOVED')),
  from_rank           integer CHECK (from_rank IS NULL OR from_rank >= 1),
  to_rank             integer CHECK (to_rank IS NULL OR to_rank >= 1),
  reason              text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id            uuid,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.waitlist_rank_changes');
CREATE INDEX waitlist_rank_changes_by_application ON admissions.waitlist_rank_changes (tenant_id, application_id, occurred_at);
CREATE INDEX waitlist_rank_changes_by_list ON admissions.waitlist_rank_changes (tenant_id, campaign_id, grade_level_code, occurred_at);
GRANT SELECT, INSERT ON admissions.waitlist_rank_changes TO app_user;
CREATE TRIGGER waitlist_rank_changes_append_only BEFORE UPDATE OR DELETE ON admissions.waitlist_rank_changes
  FOR EACH ROW EXECUTE FUNCTION admissions.forbid_mutation();

-- Le rang n'a de sens que pour un dossier en liste d'attente : il est remis à zéro à l'entrée comme à la sortie.
CREATE FUNCTION admissions.applications_waitlist_rank_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'WAITLISTED' THEN
    NEW.waitlist_rank := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.status <> 'WAITLISTED' THEN
    NEW.waitlist_rank := NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_waitlist_rank_guard BEFORE INSERT OR UPDATE ON admissions.applications
  FOR EACH ROW EXECUTE FUNCTION admissions.applications_waitlist_rank_guard();

-- Ordre d'AFFICHAGE et de promotion : rang décidé (croissant), puis les dossiers « à classer » par date d'entrée, puis identifiant.
-- Lue sous la RLS de l'appelant. `manual_rank` NULL = à classer. `priority_rank` n'est qu'une information.
DROP FUNCTION admissions.waitlist_order(uuid, text);
CREATE FUNCTION admissions.waitlist_order(p_campaign uuid, p_grade text)
RETURNS TABLE (queue_position integer, application_id uuid, priority_rank integer, waitlist_entered_at timestamptz, manual_rank integer)
LANGUAGE sql STABLE AS $$
  SELECT (row_number() OVER (ORDER BY (a.waitlist_rank IS NULL), a.waitlist_rank, a.waitlist_entered_at, a.id))::integer,
         a.id, coalesce(pc.rank, 2147483647), a.waitlist_entered_at, a.waitlist_rank
    FROM admissions.applications a
    LEFT JOIN admissions.priority_classes pc
      ON pc.tenant_id = a.tenant_id AND pc.institution_id = a.institution_id AND pc.code = a.priority_class_code AND pc.active
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.campaign_id = p_campaign
     AND a.desired_grade_level_code = p_grade AND a.status = 'WAITLISTED'
   ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION admissions.waitlist_order(uuid, text) TO app_user;
