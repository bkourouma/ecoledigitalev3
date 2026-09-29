-- ===========================================================================
-- Nettoyage d'un run du PARCOURS-COMPLET-MODULE-PRO.md
-- ===========================================================================
--
-- Supprime tout ce qu'un run a créé, et RIEN d'autre. Il s'appuie sur deux
-- marqueurs que le parcours pose partout :
--   - le tag (ex. E2E-2909-1), présent dans les libellés ;
--   - le code JJMMN (ex. 29091), présent dans les e-mails `…<JJMMN>@example.test`.
--
-- Usage — TOUJOURS une répétition à blanc d'abord (commit=0 : ROLLBACK) :
--
--   psql "$DATABASE_URL" -v tag=E2E-2909-1 -v code=29091 -v commit=0 \
--        -f docs/testing/e2e-computer-use/nettoyage-parcours-pro.sql
--
-- Lire le bilan « DELTA|table|-n » : chaque ligne doit correspondre à des
-- données du run. Puis, seulement si tout est conforme :
--
--   psql "$DATABASE_URL" -v tag=E2E-2909-1 -v code=29091 -v commit=1 \
--        -f docs/testing/e2e-computer-use/nettoyage-parcours-pro.sql
--
-- Faire une sauvegarde de la base avant le passage avec commit=1.
--
-- Ce qui ne se rattrape pas : les numéros de reçu (REC-PRO-…) et de diplôme
-- (DIP-…) consommés par le run. Les séquences ne reculent pas : les prochains
-- documents réels sauteront ces numéros.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE p AS SELECT :'tag'::text AS tag, :'code'::text AS code;

-- Garde-fou de format : un tag vide ou trop court ferait correspondre des
-- données réelles.
DO $$
BEGIN
  IF (SELECT length(tag) < 8 OR tag NOT ILIKE 'E2E-%' OR length(code) < 4 FROM p) THEN
    RAISE EXCEPTION 'Paramètres refusés : tag attendu « E2E-JJMM-N », code « JJMMN ».';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 0. Photographie des volumes.
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
-- 1. Racines du run.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE r_users    AS SELECT id FROM users
                                 WHERE email ILIKE '%.' || (SELECT code FROM p) || '@example.test';
CREATE TEMP TABLE r_students AS SELECT id FROM student_profiles WHERE user_id IN (SELECT id FROM r_users);
CREATE TEMP TABLE r_teachers AS SELECT id FROM teachers WHERE user_id IN (SELECT id FROM r_users);
CREATE TEMP TABLE r_progs    AS SELECT id FROM programmes
                                 WHERE name ILIKE '%' || (SELECT tag FROM p) || '%';
CREATE TEMP TABLE r_ue       AS SELECT id FROM professional_ue WHERE filiere_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_ecue     AS SELECT id FROM professional_ecue
                                 WHERE libelle ILIKE '%' || (SELECT tag FROM p) || '%';
CREATE TEMP TABLE r_sem      AS SELECT id FROM professional_semestres WHERE filiere_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_sess     AS SELECT id FROM professional_ue_sessions WHERE ue_id IN (SELECT id FROM r_ue);
CREATE TEMP TABLE r_seances  AS SELECT id FROM professional_ecue_seances
                                 WHERE ue_session_id IN (SELECT id FROM r_sess)
                                    OR ecue_id IN (SELECT id FROM r_ecue);
CREATE TEMP TABLE r_assign   AS SELECT id FROM professional_assignments
                                 WHERE ue_session_id IN (SELECT id FROM r_sess)
                                    OR ecue_id IN (SELECT id FROM r_ecue);
CREATE TEMP TABLE r_dip      AS SELECT id FROM professional_diplomas
                                 WHERE filiere_id IN (SELECT id FROM r_progs)
                                    OR programme_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_orders   AS SELECT id FROM professional_orders
                                 WHERE student_id IN (SELECT id FROM r_students)
                                    OR programme_id IN (SELECT id FROM r_progs);
CREATE TEMP TABLE r_payments AS SELECT id FROM professional_payments WHERE order_id IN (SELECT id FROM r_orders);
CREATE TEMP TABLE r_coms     AS SELECT id FROM commerciaux WHERE nom ILIKE '%' || (SELECT tag FROM p) || '%';
CREATE TEMP TABLE r_rooms    AS SELECT id FROM classrooms WHERE name ILIKE '%' || (SELECT tag FROM p) || '%';

-- Garde-fous de volume : le parcours crée 6 comptes, 1 classe, 7 UE, 8 ECUE,
-- 3 semestres. Un volume supérieur trahit une correspondance trop large.
DO $$
DECLARE nu int; np int; nue int; ne int; nd int;
BEGIN
  SELECT count(*) INTO nu FROM r_users;
  SELECT count(*) INTO np FROM r_progs;
  SELECT count(*) INTO nue FROM r_ue;
  SELECT count(*) INTO ne FROM r_ecue;
  SELECT count(*) INTO nd FROM r_dip;
  RAISE NOTICE 'RACINES|comptes=%|classes=%|ue=%|ecue=%|diplomes=%', nu, np, nue, ne, nd;
  IF nu > 10 OR np > 1 OR nue > 10 OR ne > 12 OR nd > 1 THEN
    RAISE EXCEPTION 'Garde-fou : volume inattendu, rien n''est supprimé. Vérifier le tag et le code.';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id IN (SELECT id FROM r_users)
             AND email NOT ILIKE '%@example.test') THEN
    RAISE EXCEPTION 'Garde-fou : un compte hors @example.test figure parmi les racines.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Prospection : règlements, provenances, commercial.
-- ---------------------------------------------------------------------------
DELETE FROM commissions_versements WHERE commercial_id IN (SELECT id FROM r_coms)
                                      OR payment_id IN (SELECT id FROM r_payments);
DELETE FROM student_provenances WHERE student_id IN (SELECT id FROM r_students)
                                   OR commercial_id IN (SELECT id FROM r_coms);
DELETE FROM commerciaux WHERE id IN (SELECT id FROM r_coms);

-- ---------------------------------------------------------------------------
-- 3. Scolarité professionnelle, du plus dépendant au plus central.
-- ---------------------------------------------------------------------------
DELETE FROM student_professional_diplomas WHERE student_id IN (SELECT id FROM r_students)
                                             OR diploma_id IN (SELECT id FROM r_dip);
DELETE FROM professional_diplomas WHERE id IN (SELECT id FROM r_dip);   -- exigences en cascade
DELETE FROM professional_assignments WHERE id IN (SELECT id FROM r_assign); -- copies en cascade
DELETE FROM professional_ecue_seances WHERE id IN (SELECT id FROM r_seances); -- appels en cascade
DELETE FROM professional_payments WHERE id IN (SELECT id FROM r_payments);
DELETE FROM professional_enrollments WHERE student_id IN (SELECT id FROM r_students)
                                        OR ue_session_id IN (SELECT id FROM r_sess);
DELETE FROM professional_orders WHERE id IN (SELECT id FROM r_orders);
-- Sessions : notes, résultats, emploi du temps, affectations, plannings en cascade.
DELETE FROM professional_ue_sessions WHERE id IN (SELECT id FROM r_sess);
-- Semestres : bulletins et liens semestre-UE en cascade.
DELETE FROM professional_semestres WHERE id IN (SELECT id FROM r_sem);
DELETE FROM professional_ue WHERE id IN (SELECT id FROM r_ue);
DELETE FROM professional_ecue WHERE id IN (SELECT id FROM r_ecue);
DELETE FROM professional_classe_noms WHERE nom ILIKE '%' || (SELECT tag FROM p) || '%'
                                        OR classe_id IN (SELECT id FROM r_progs);

-- ---------------------------------------------------------------------------
-- 4. Structure : barème, classe, filière, cycle, salles.
-- ---------------------------------------------------------------------------
DELETE FROM cycles_frais WHERE programme_id IN (SELECT id FROM r_progs);
DELETE FROM programmes WHERE id IN (SELECT id FROM r_progs);
DELETE FROM filieres WHERE name ILIKE '%' || (SELECT tag FROM p) || '%';
DELETE FROM cycles WHERE name ILIKE '%' || (SELECT tag FROM p) || '%';
DELETE FROM classrooms WHERE id IN (SELECT id FROM r_rooms);

-- ---------------------------------------------------------------------------
-- 5. Personnes : enseignants, étudiants, puis les comptes (parent compris :
--    ses liens student_parents partent en cascade).
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

-- Restes : toute ligne de texte qui porte encore le tag, dans n'importe quelle
-- table. Une ligne ici veut dire qu'un objet du run a échappé au nettoyage.
DO $$
DECLARE r record; c bigint; t text := (SELECT tag FROM p);
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I ILIKE %L', r.table_name, r.column_name, '%' || t || '%') INTO c;
    IF c > 0 THEN
      RAISE NOTICE 'RESTE|%.%|%', r.table_name, r.column_name, c;
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
