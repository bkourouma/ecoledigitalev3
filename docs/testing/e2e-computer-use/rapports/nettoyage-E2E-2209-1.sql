-- Nettoyage des données de la campagne E2E-2209-1.
-- Lancé avec -v commit=0 : répétition à blanc (ROLLBACK). Avec -v commit=1 : COMMIT.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Photographie des volumes, pour mesurer ce que le nettoyage retire.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE avant (tbl text PRIMARY KEY, n bigint);
DO $$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.tablename) INTO c;
    INSERT INTO avant VALUES (r.tablename, c);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Racines : uniquement ce qui porte le tag, ou s'y rattache sans ambiguïté.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE r_users    AS SELECT id FROM users WHERE email ILIKE '%e2e22091%';
CREATE TEMP TABLE r_students AS SELECT id FROM student_profiles WHERE user_id IN (SELECT id FROM r_users);
CREATE TEMP TABLE r_teachers AS SELECT id FROM teachers WHERE user_id IN (SELECT id FROM r_users);
CREATE TEMP TABLE r_progs    AS SELECT id FROM programmes WHERE name ILIKE '%E2E-2209-1%';
CREATE TEMP TABLE r_ue       AS SELECT id FROM professional_ue WHERE filiere_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_ecue     AS SELECT id FROM professional_ecue WHERE code ILIKE '%E2E-2209-1%' OR libelle ILIKE '%E2E-2209-1%';
CREATE TEMP TABLE r_sem      AS SELECT id FROM professional_semestres WHERE filiere_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_sess     AS SELECT id FROM professional_ue_sessions WHERE ue_id IN (SELECT id FROM r_ue);
CREATE TEMP TABLE r_seances  AS SELECT id FROM professional_ecue_seances WHERE ue_session_id IN (SELECT id FROM r_sess);
CREATE TEMP TABLE r_dip      AS SELECT id FROM professional_diplomas WHERE filiere_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_orders   AS SELECT id FROM professional_orders
                                 WHERE student_id IN (SELECT id FROM r_students)
                                    OR programme_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_payments AS SELECT id FROM professional_payments WHERE order_id IN (SELECT id FROM r_orders);
CREATE TEMP TABLE r_coms     AS SELECT id FROM commerciaux WHERE nom ILIKE '%E2E-2209-1%';
CREATE TEMP TABLE r_classes  AS SELECT id FROM classes WHERE name ILIKE '%E2E-2209-1%' OR code ILIKE '%E2E-2209-1%';
CREATE TEMP TABLE r_courses  AS SELECT id FROM courses WHERE name ILIKE '%E2E-2209-1%';
CREATE TEMP TABLE r_rooms    AS SELECT id FROM classrooms WHERE name ILIKE '%E2E-2209-1%';

-- Garde-fou : aucune racine ne doit toucher un compte qui n'est pas de test.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id IN (SELECT id FROM r_users) AND email NOT ILIKE '%e2e22091%') THEN
    RAISE EXCEPTION 'Garde-fou : un compte hors test figure parmi les racines';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Prospection : règlements de test, puis provenances, puis le commercial.
-- ---------------------------------------------------------------------------
DELETE FROM commissions_versements WHERE commercial_id IN (SELECT id FROM r_coms)
                                      OR payment_id IN (SELECT id FROM r_payments);
DELETE FROM student_provenances WHERE student_id IN (SELECT id FROM r_students)
                                   OR commercial_id IN (SELECT id FROM r_coms);
DELETE FROM commerciaux WHERE id IN (SELECT id FROM r_coms);

-- ---------------------------------------------------------------------------
-- 3. Scolarité professionnelle : du plus dépendant au plus central.
-- ---------------------------------------------------------------------------
DELETE FROM student_professional_diplomas WHERE student_id IN (SELECT id FROM r_students)
                                             OR diploma_id IN (SELECT id FROM r_dip);
DELETE FROM professional_diplomas WHERE id IN (SELECT id FROM r_dip);
DELETE FROM professional_ecue_attendance WHERE seance_id IN (SELECT id FROM r_seances)
                                            OR student_id IN (SELECT id FROM r_students);
DELETE FROM professional_ecue_seances WHERE id IN (SELECT id FROM r_seances);
DELETE FROM professional_payments WHERE id IN (SELECT id FROM r_payments);
DELETE FROM professional_enrollments WHERE student_id IN (SELECT id FROM r_students)
                                        OR ue_session_id IN (SELECT id FROM r_sess);
DELETE FROM professional_orders WHERE id IN (SELECT id FROM r_orders);
DELETE FROM professional_ue_sessions WHERE id IN (SELECT id FROM r_sess);
DELETE FROM professional_semestres WHERE id IN (SELECT id FROM r_sem);
DELETE FROM professional_ue WHERE id IN (SELECT id FROM r_ue);
DELETE FROM professional_ecue WHERE id IN (SELECT id FROM r_ecue);
DELETE FROM professional_classe_noms WHERE nom ILIKE '%E2E-2209-1%';

-- ---------------------------------------------------------------------------
-- 4. Académique (passe 6).
-- ---------------------------------------------------------------------------
DELETE FROM teacher_assignments WHERE teacher_id IN (SELECT id FROM r_teachers)
                                   OR class_course_id IN (SELECT id FROM class_courses
                                                           WHERE class_id IN (SELECT id FROM r_classes)
                                                              OR course_id IN (SELECT id FROM r_courses));
DELETE FROM class_courses WHERE class_id IN (SELECT id FROM r_classes)
                             OR course_id IN (SELECT id FROM r_courses);
DELETE FROM attendance_reports WHERE student_id IN (SELECT id FROM r_students);
DELETE FROM academic_year_periods WHERE name ILIKE '%E2E-2209-1%';
DELETE FROM classes WHERE id IN (SELECT id FROM r_classes);
DELETE FROM courses WHERE id IN (SELECT id FROM r_courses);
DELETE FROM programmes WHERE id IN (SELECT id FROM r_progs);
DELETE FROM bilan_types WHERE name ILIKE '%E2E-2209-1%';
DELETE FROM filieres WHERE name ILIKE '%E2E-2209-1%';
DELETE FROM cycles WHERE name ILIKE '%E2E-2209-1%';
DELETE FROM classrooms WHERE id IN (SELECT id FROM r_rooms);

-- ---------------------------------------------------------------------------
-- 5. Personnes : enseignante, étudiants, puis les comptes.
-- ---------------------------------------------------------------------------
DELETE FROM teachers WHERE id IN (SELECT id FROM r_teachers);
DELETE FROM student_profiles WHERE id IN (SELECT id FROM r_students);
DELETE FROM users WHERE id IN (SELECT id FROM r_users);

-- ---------------------------------------------------------------------------
-- 6. Bilan : ce qui a disparu, table par table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT tbl, n FROM avant ORDER BY tbl LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO c;
    IF c <> r.n THEN
      RAISE NOTICE 'DELTA|%|%', r.tbl, c - r.n;
    END IF;
  END LOOP;
END $$;

\if :commit
COMMIT;
\echo '>>> NETTOYAGE VALIDE (COMMIT)'
\else
ROLLBACK;
\echo '>>> REPETITION A BLANC : rien n a ete modifie (ROLLBACK)'
\endif
