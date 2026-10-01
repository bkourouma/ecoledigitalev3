-- =============================================================================
-- 0955 — Module scheduling (spec 017, AC2.5) : réservations et journal EN LOT à l'insertion
-- =============================================================================
--
-- Mesure (test/integration/performance.integration.test.ts) : générer 40 classes × 30 patrons × 18 semaines
-- (21 600 séances) prenait ~165 s pour un objectif de < 60 s. Le coût venait des déclencheurs PAR LIGNE de 0953 :
-- chaque séance insérée recalculait ses réservations deux fois (à l'insertion de la séance, puis à l'insertion de
-- son intervenant : DELETE + 3 INSERT à chaque fois, avec vérification de la contrainte d'exclusion) et écrivait
-- deux lignes de journal par déclencheur PL/pgSQL.
--
-- Cette migration remplace, pour les seules INSERTIONS, ces déclencheurs par des déclencheurs d'INSTRUCTION à table
-- de transition (une seule requête ensembliste par INSERT multi-lignes) :
--   * séance insérée      -> réservations CLASSROOM et ROOM + journal CREATED (+ OVERRIDE) ;
--   * intervenant inséré  -> réservation STAFF seule (les deux autres existent déjà) + journal STAFF_CHANGED.
-- Les garanties sont INCHANGÉES : mêmes réservations, mêmes politiques (BLOCK/WARN, dépassement motivé), même
-- contrainte d'exclusion vérifiée par la base, même journal. Les MODIFICATIONS et SUPPRESSIONS (rares, une ligne à
-- la fois) gardent les déclencheurs par ligne de 0953 (resynchronisation complète des réservations).
-- =============================================================================

-- Séance insérée : réservations de la classe (ou de l'offre à la carte) et de la salle.
CREATE FUNCTION scheduling.occurrences_claims_insert_stmt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
BEGIN
  INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
  SELECT gen_random_uuid(), w.tenant_id, w.occurrence_id, w.kind, w.resource_id, w.during,
         coalesce((SELECT cp.mode FROM scheduling.conflict_policies cp
                    WHERE cp.tenant_id = w.tenant_id AND cp.institution_id = w.institution_id AND cp.resource_kind = w.kind), 'BLOCK') = 'BLOCK'
         AND NOT w.conflict_override
    FROM (
      SELECT o.tenant_id, o.id AS occurrence_id, o.institution_id, 'CLASSROOM'::text AS kind,
             CASE WHEN o.claims_classroom THEN o.classroom_id ELSE o.offering_id END AS resource_id, o.during, o.conflict_override
        FROM new_rows o
       WHERE o.status <> 'CANCELLED' AND o.origin <> 'ACCOUNTING' AND o.kind IN ('LESSON', 'EXAM')
         AND ((o.claims_classroom AND o.classroom_id IS NOT NULL) OR (NOT o.claims_classroom AND o.offering_id IS NOT NULL))
      UNION ALL
      SELECT o.tenant_id, o.id, o.institution_id, 'ROOM'::text, o.room_id, o.during, o.conflict_override
        FROM new_rows o
       WHERE o.status <> 'CANCELLED' AND o.origin <> 'ACCOUNTING' AND o.room_id IS NOT NULL
    ) w;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION scheduling.occurrences_claims_insert_stmt() FROM PUBLIC;

DROP TRIGGER occurrences_claims ON scheduling.session_occurrences;
CREATE TRIGGER occurrences_claims AFTER UPDATE OF starts_at, ends_at, status, room_id, classroom_id, offering_id, claims_classroom, conflict_override, kind, origin
  ON scheduling.session_occurrences FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_claims_trigger();
CREATE TRIGGER occurrences_claims_insert AFTER INSERT ON scheduling.session_occurrences
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduling.occurrences_claims_insert_stmt();

-- Intervenant inséré : réservation de l'enseignant sur la plage de la séance (aucune si annulée ou comptable).
-- La table de transition est lue UNE seule fois (en tableaux) : chaque lecture évalue la politique RLS ligne par ligne,
-- et une jointure directe avec la table de transition (sans statistiques) est planifiée en boucle imbriquée qui la relit
-- une fois par ligne, soit un coût QUADRATIQUE dans la taille du lot (mesuré : 1,3 s pour 480 lignes).
CREATE FUNCTION scheduling.occurrence_staff_claims_insert_stmt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
DECLARE
  v_occurrences uuid[];
  v_staff       uuid[];
BEGIN
  SELECT array_agg(occurrence_id), array_agg(staff_id) INTO v_occurrences, v_staff FROM new_rows;
  INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
  SELECT gen_random_uuid(), o.tenant_id, o.id, 'STAFF', s.staff_id, o.during,
         coalesce((SELECT cp.mode FROM scheduling.conflict_policies cp
                    WHERE cp.tenant_id = o.tenant_id AND cp.institution_id = o.institution_id AND cp.resource_kind = 'STAFF'), 'BLOCK') = 'BLOCK'
         AND NOT o.conflict_override
    FROM unnest(v_occurrences, v_staff) AS s(occurrence_id, staff_id)
    JOIN scheduling.session_occurrences o ON o.id = s.occurrence_id
   WHERE o.status <> 'CANCELLED' AND o.origin <> 'ACCOUNTING';
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION scheduling.occurrence_staff_claims_insert_stmt() FROM PUBLIC;

DROP TRIGGER occurrence_staff_claims ON scheduling.occurrence_staff;
CREATE TRIGGER occurrence_staff_claims AFTER UPDATE OF staff_id OR DELETE
  ON scheduling.occurrence_staff FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_claims_trigger();
CREATE TRIGGER occurrence_staff_claims_insert AFTER INSERT ON scheduling.occurrence_staff
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduling.occurrence_staff_claims_insert_stmt();

-- -----------------------------------------------------------------------------
-- Journal : l'insertion devient ensembliste ; les modifications gardent le déclencheur par ligne (0953), dont la
-- branche INSERT n'est plus atteinte.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrences_journal_insert_stmt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
  SELECT gen_random_uuid(), n.tenant_id, n.id, 'CREATED',
         jsonb_build_object('startsAt', n.starts_at, 'endsAt', n.ends_at, 'roomId', n.room_id, 'origin', n.origin), v_reason, v_actor
    FROM new_rows n;
  -- Une séance créée AVEC dépassement motivé le dit dans le journal (les dérogations sont toutes tracées).
  INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
  SELECT gen_random_uuid(), n.tenant_id, n.id, 'OVERRIDE', jsonb_build_object('reason', n.conflict_override_reason), n.conflict_override_reason, n.conflict_override_by
    FROM new_rows n WHERE n.conflict_override;
  RETURN NULL;
END
$$;

DROP TRIGGER occurrences_journal ON scheduling.session_occurrences;
CREATE TRIGGER occurrences_journal AFTER UPDATE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_journal();
CREATE TRIGGER occurrences_journal_insert AFTER INSERT ON scheduling.session_occurrences
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduling.occurrences_journal_insert_stmt();

CREATE FUNCTION scheduling.occurrence_staff_journal_insert_stmt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
  SELECT gen_random_uuid(), n.tenant_id, n.occurrence_id, 'STAFF_CHANGED',
         jsonb_build_object('added', n.staff_id, 'role', n.role, 'replaces', n.replaces_staff_id), v_reason, v_actor
    FROM new_rows n;
  RETURN NULL;
END
$$;

DROP TRIGGER occurrence_staff_journal ON scheduling.occurrence_staff;
CREATE TRIGGER occurrence_staff_journal AFTER UPDATE OR DELETE ON scheduling.occurrence_staff
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_journal();
CREATE TRIGGER occurrence_staff_journal_insert AFTER INSERT ON scheduling.occurrence_staff
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduling.occurrence_staff_journal_insert_stmt();
