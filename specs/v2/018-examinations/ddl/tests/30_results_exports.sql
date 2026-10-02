-- Notes, résultats (officiels importés / examens blancs calculés), révisions, imports, exports, documents,
-- statistiques et numérotation concurrente.
\set R '''a6000000-0000-4000-8000-0000000000a1'''
SELECT ddltest.make_tenant(:R::uuid, 'ex-r');

-- ---------------------------------------------------------------- session officielle : 4 candidats, session en cours
DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a6100000-0000-4000-8000-000000000001';
  I constant uuid := 'a6200000-0000-4000-8000-000000000001';
  S constant uuid := 'a6300000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.cepe_type(R, T);
  PERFORM ddltest.new_session(S, R, T, I, 'CEPE-2027');
  PERFORM ddltest.open_session(S);
  PERFORM ddltest.new_candidate('a6400000-0000-4000-8000-000000000001', R, S, I);
  PERFORM ddltest.new_candidate('a6400000-0000-4000-8000-000000000002', R, S, I);
  PERFORM ddltest.new_candidate('a6400000-0000-4000-8000-000000000003', R, S, I);
  PERFORM ddltest.new_candidate('a6400000-0000-4000-8000-000000000004', R, S, I);
  PERFORM ddltest.register('a6400000-0000-4000-8000-000000000001', 'Un', 'F');
  PERFORM ddltest.register('a6400000-0000-4000-8000-000000000002', 'Deux', 'M');
  PERFORM ddltest.register('a6400000-0000-4000-8000-000000000003', 'Trois', 'F');
  PERFORM ddltest.register('a6400000-0000-4000-8000-000000000004', 'Quatre', 'M');
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = S;
END $do$;

DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a6200000-0000-4000-8000-000000000001';
  S constant uuid := 'a6300000-0000-4000-8000-000000000001';
  K1 constant uuid := 'a6400000-0000-4000-8000-000000000001';
  K2 constant uuid := 'a6400000-0000-4000-8000-000000000002';
  K3 constant uuid := 'a6400000-0000-4000-8000-000000000003';
  K4 constant uuid := 'a6400000-0000-4000-8000-000000000004';
  EP1 uuid; EP3 uuid;
  B1 constant uuid := 'a6500000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(R);
  SELECT id INTO EP1 FROM examinations.session_papers WHERE session_id = S AND code = 'EP1';
  SELECT id INTO EP3 FROM examinations.session_papers WHERE session_id = S AND code = 'EP3';

  -- notes : session pas encore en cours
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score) VALUES (gen_random_uuid(), %L, %L, %L, %L, 12)$q$, R, S, K1, EP1),
     'scores_closed', 'notes refusées tant que la session n''est pas en cours');
  UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = S;

  INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score, entered_by)
    VALUES ('a6600000-0000-4000-8000-000000000001', R, S, K1, EP1, 15.5, gen_random_uuid());
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score) VALUES (gen_random_uuid(), %L, %L, %L, %L, 11)$q$, R, S, K1, EP1),
     '23505', 'une note par candidat et par épreuve');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score) VALUES (gen_random_uuid(), %L, %L, %L, %L, 10.5)$q$, R, S, K2, EP3),
     'score_above_scale', 'la note ne dépasse pas le barème de l''épreuve (barème 10)');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, status) VALUES (gen_random_uuid(), %L, %L, %L, %L, 'ENTERED')$q$, R, S, K2, EP1),
     'check', 'une note saisie a une valeur');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, status, score) VALUES (gen_random_uuid(), %L, %L, %L, %L, 'ABSENT', 0)$q$, R, S, K2, EP1),
     'check', 'une absence n''a pas de valeur');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, status) VALUES (gen_random_uuid(), %L, %L, %L, %L, 'ABSENT')$q$, R, S, K2, EP1), 'absence enregistrée');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, source, score) VALUES (gen_random_uuid(), %L, %L, %L, %L, 'IMPORT', 9)$q$, R, S, K3, EP1),
     'check', 'une note importée cite son lot');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score) VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), 9)$q$, R, S, K3), '23503', 'l''épreuve appartient à la session');
  PERFORM ddltest.runs($q$UPDATE examinations.paper_scores SET score = 16 WHERE id = 'a6600000-0000-4000-8000-000000000001'$q$, 'correction libre tant que les résultats ne sont pas saisis');

  -- lots d'import
  INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, row_count, ok_count, error_count, uploaded_by)
    VALUES (B1, R, S, 'RESULTS', 'resultats.csv', repeat('a', 64), 3, 2, 1, gen_random_uuid());
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, uploaded_by) VALUES (gen_random_uuid(), %L, %L, 'RESULTS', 'meme.csv', repeat('a', 64), gen_random_uuid())$q$, R, S),
     '23505', 'le même fichier n''est pas importé deux fois');
  PERFORM ddltest.throws(format($q$UPDATE examinations.import_batches SET status = 'APPLIED' WHERE id = %L$q$, B1), 'batch_transition', 'UPLOADED -> APPLIED interdit');
  UPDATE examinations.import_batches SET status = 'VALIDATED' WHERE id = B1;
  PERFORM ddltest.throws(format($q$UPDATE examinations.import_batches SET status = 'APPLIED', applied_by = gen_random_uuid(), applied_at = now() WHERE id = %L$q$, B1), 'check', 'un lot en erreur ne s''applique pas');
  INSERT INTO examinations.import_rows (id, tenant_id, batch_id, line_no, status, error_code) VALUES (gen_random_uuid(), R, B1, 3, 'ERROR', 'CANDIDATE_UNKNOWN');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_rows (id, tenant_id, batch_id, line_no, status) VALUES (gen_random_uuid(), %L, %L, 4, 'ERROR')$q$, R, B1), 'check', 'une ligne en erreur cite son code');
  PERFORM ddltest.throws($q$DELETE FROM examinations.import_rows$q$, 'append_only', 'lignes d''import en ajout seul');
  -- lot sain
  INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, row_count, ok_count, error_count, uploaded_by, status)
    VALUES ('a6500000-0000-4000-8000-000000000002', R, S, 'RESULTS', 'ok.csv', repeat('b', 64), 3, 3, 0, gen_random_uuid(), 'UPLOADED');
  UPDATE examinations.import_batches SET status = 'VALIDATED' WHERE id = 'a6500000-0000-4000-8000-000000000002';
  UPDATE examinations.import_batches SET status = 'APPLIED', applied_by = gen_random_uuid(), applied_at = now() WHERE id = 'a6500000-0000-4000-8000-000000000002';
  PERFORM ddltest.throws($q$UPDATE examinations.import_batches SET row_count = 99 WHERE id = 'a6500000-0000-4000-8000-000000000002'$q$, 'batch_closed', 'un lot appliqué ne change plus');

  -- résultats officiels : importés ou saisis, jamais calculés ici
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source, rule_version_ref, inputs_hash)
     VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 'COMPUTED', gen_random_uuid(), repeat('c', 64))$q$, R, S, K1), 'official_not_computed', 'l''admission officielle n''est pas calculée par l''établissement');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source) VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 'IMPORTED')$q$, R, S, K1),
     'check', 'un résultat importé cite son lot');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source) VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 'ENTERED')$q$, R, S, K1),
     'check', 'un résultat saisi cite son auteur');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source, import_batch_id, average) VALUES (gen_random_uuid(), %L, %L, %L, 'ABSENT', 'IMPORTED', 'a6500000-0000-4000-8000-000000000002', 10)$q$, R, S, K2),
     'check', 'un absent n''a ni moyenne ni rang ni mention');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source, import_batch_id, status, published_at, published_by)
     VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 'IMPORTED', 'a6500000-0000-4000-8000-000000000002', 'PUBLISHED', now(), gen_random_uuid())$q$, R, S, K1),
     'result_initial_state', 'un résultat naît DRAFT');
  INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, import_batch_id) VALUES
    ('a6700000-0000-4000-8000-000000000001', R, S, K1, 'ADMITTED', 14.5, 'IMPORTED', 'a6500000-0000-4000-8000-000000000002'),
    ('a6700000-0000-4000-8000-000000000002', R, S, K2, 'ABSENT', NULL, 'IMPORTED', 'a6500000-0000-4000-8000-000000000002'),
    ('a6700000-0000-4000-8000-000000000003', R, S, K3, 'FAILED', 7, 'IMPORTED', 'a6500000-0000-4000-8000-000000000002');
  PERFORM ddltest.ok((SELECT outcome FROM examinations.candidates WHERE id = K1) = 'ADMITTED', 'l''issue du candidat suit son résultat');
  PERFORM ddltest.ok((SELECT outcome FROM examinations.candidates WHERE id = K2) = 'ABSENT', 'issue ABSENT');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_history WHERE candidate_id = K1 AND kind = 'OUTCOME') = 1, 'issue journalisée dans l''historique');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, source, import_batch_id) VALUES (gen_random_uuid(), %L, %L, %L, 'FAILED', 'IMPORTED', 'a6500000-0000-4000-8000-000000000002')$q$, R, S, K1),
     '23505', 'un seul résultat par candidat');

  -- publication de la session : tous les inscrits doivent avoir un résultat
  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET status = 'PUBLISHED' WHERE id = %L$q$, S), 'session_transition', 'IN_PROGRESS -> PUBLISHED interdit');
  UPDATE examinations.sessions SET status = 'RESULTS_ENTERED' WHERE id = S;
  PERFORM ddltest.throws(format($q$UPDATE examinations.sessions SET status = 'PUBLISHED' WHERE id = %L$q$, S), 'results_incomplete', 'publier avec un candidat sans résultat est refusé');
  INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, import_batch_id)
    VALUES ('a6700000-0000-4000-8000-000000000004', R, S, K4, 'ADMITTED', 12, 'IMPORTED', 'a6500000-0000-4000-8000-000000000002');
  UPDATE examinations.candidate_results SET status = 'PUBLISHED', published_at = now(), published_by = gen_random_uuid() WHERE session_id = S;
  UPDATE examinations.sessions SET status = 'PUBLISHED' WHERE id = S;
  PERFORM ddltest.ok((SELECT status FROM examinations.sessions WHERE id = S) = 'PUBLISHED', 'session publiée');

  -- après saisie des résultats : correction de note par révision seulement
  PERFORM ddltest.throws($q$UPDATE examinations.paper_scores SET score = 18 WHERE id = 'a6600000-0000-4000-8000-000000000001'$q$, 'scores_closed', 'notes closes une fois la session publiée');
END $do$;

-- Révisions (session repassée en RESULTS_ENTERED sur une seconde session de test)
DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a6100000-0000-4000-8000-000000000001';
  I constant uuid := 'a6200000-0000-4000-8000-000000000001';
  S2 constant uuid := 'a6300000-0000-4000-8000-000000000002';
  K constant uuid := 'a6400000-0000-4000-8000-0000000000b1';
  SC constant uuid := 'a6600000-0000-4000-8000-0000000000b1';
  RES constant uuid := 'a6700000-0000-4000-8000-0000000000b1';
  EP1 uuid;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.new_session(S2, R, T, I, 'CEPE-2028');
  PERFORM ddltest.open_session(S2);
  PERFORM ddltest.new_candidate(K, R, S2, I);
  PERFORM ddltest.register(K, 'Révision', 'F');
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = S2;
  UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = S2;
  SELECT id INTO EP1 FROM examinations.session_papers WHERE session_id = S2 AND code = 'EP1';
  INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score, entered_by) VALUES (SC, R, S2, K, EP1, 8, gen_random_uuid());
  INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, row_count, ok_count, uploaded_by, status)
    VALUES ('a6500000-0000-4000-8000-0000000000b1', R, S2, 'RESULTS', 'r2.csv', repeat('d', 64), 1, 1, gen_random_uuid(), 'UPLOADED');
  INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, import_batch_id)
    VALUES (RES, R, S2, K, 'FAILED', 9.4, 'IMPORTED', 'a6500000-0000-4000-8000-0000000000b1');
  UPDATE examinations.sessions SET status = 'RESULTS_ENTERED' WHERE id = S2;

  -- note : correction sans révision refusée ; révision approuvée par une autre personne
  PERFORM ddltest.throws(format($q$UPDATE examinations.paper_scores SET score = 11 WHERE id = %L$q$, SC), 'score_revision_required', 'correction d''une note après résultats : révision exigée');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.score_revisions (id, tenant_id, score_id, from_status, from_score, to_status, to_score, reason, requested_by, approved_by)
     VALUES (gen_random_uuid(), %L, %L, 'ENTERED', 8, 'ENTERED', 11, 'Erreur de report de la note', %L, %L)$q$, R, SC, 'a6800000-0000-4000-8000-000000000001', 'a6800000-0000-4000-8000-000000000001'),
     'check', 'séparation des tâches : demandeur ≠ approbateur');
  INSERT INTO examinations.score_revisions (id, tenant_id, score_id, from_status, from_score, to_status, to_score, reason, requested_by, approved_by)
    VALUES (gen_random_uuid(), R, SC, 'ENTERED', 8, 'ENTERED', 11, 'Erreur de report de la note', gen_random_uuid(), gen_random_uuid());
  PERFORM ddltest.throws(format($q$UPDATE examinations.paper_scores SET score = 12 WHERE id = %L$q$, SC), 'score_revision_required', 'la révision ne couvre que la valeur annoncée');
  PERFORM ddltest.runs(format($q$UPDATE examinations.paper_scores SET score = 11 WHERE id = %L$q$, SC), 'note corrigée avec sa révision dans la même transaction');
  PERFORM ddltest.throws($q$UPDATE examinations.score_revisions SET reason = 'réécrit en douce'$q$, 'append_only', 'révisions de notes en ajout seul');
  PERFORM ddltest.throws(format($q$DELETE FROM examinations.paper_scores WHERE id = %L$q$, SC), 'scores_frozen', 'une note ne se supprime plus après les résultats');

  -- résultat : publier puis corriger par révision
  UPDATE examinations.candidate_results SET status = 'PUBLISHED', published_at = now(), published_by = gen_random_uuid() WHERE id = RES;
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_results SET result_code = 'ADMITTED' WHERE id = %L$q$, RES), 'result_revision_required', 'résultat publié : révision exigée');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_results SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = %L$q$, RES), 'result_published', 'un résultat publié ne se dépublie pas');
  INSERT INTO examinations.result_revisions (id, tenant_id, result_id, from_code, to_code, from_average, to_average, reason, requested_by, approved_by)
    VALUES (gen_random_uuid(), R, RES, 'FAILED', 'ADMITTED', 9.4, 10.2, 'Erreur de saisie de la moyenne relevée au PV', gen_random_uuid(), gen_random_uuid());
  PERFORM ddltest.runs(format($q$UPDATE examinations.candidate_results SET result_code = 'ADMITTED', average = 10.2 WHERE id = %L$q$, RES), 'résultat publié corrigé avec sa révision');
  PERFORM ddltest.ok((SELECT outcome FROM examinations.candidates WHERE id = K) = 'ADMITTED', 'l''issue du candidat suit le résultat corrigé');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'WITHDRAWN', withdrawn_reason = 'Retrait tardif' WHERE id = %L$q$, K), 'withdraw_after_results', 'retrait impossible après les résultats');
END $do$;

-- ---------------------------------------------------------------- documents, exports, statistiques
DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  S constant uuid := 'a6300000-0000-4000-8000-000000000001';
  K1 constant uuid := 'a6400000-0000-4000-8000-000000000001';   -- ADMIS publié
  K3 constant uuid := 'a6400000-0000-4000-8000-000000000003';   -- ÉCHOUÉ
  F uuid := gen_random_uuid();
  FD uuid := gen_random_uuid();
  run1 uuid := gen_random_uuid();
  v record;
BEGIN
  PERFORM ddltest.as_tenant(R);
  -- documents
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, requested_by) VALUES (gen_random_uuid(), %L, %L, %L, 'ATTESTATION_REUSSITE', gen_random_uuid())$q$, R, S, K3),
     'attestation_requires_admission', 'pas d''attestation de réussite pour un candidat non admis');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, requested_by) VALUES (gen_random_uuid(), %L, %L, %L, 'CONVOCATION', gen_random_uuid())$q$, R, S, K1),
     'convocation_requires_assignment', 'la convocation exige une place attribuée');
  INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, requested_by) VALUES ('a6900000-0000-4000-8000-000000000001', R, S, K1, 'ATTESTATION_REUSSITE', gen_random_uuid());
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, version, requested_by) VALUES (gen_random_uuid(), %L, %L, %L, 'ATTESTATION_REUSSITE', 2, gen_random_uuid())$q$, R, S, K1),
     '23505', 'un seul document vivant par candidat et nature');
  PERFORM ddltest.throws($q$UPDATE examinations.issued_documents SET status = 'ISSUED' WHERE id = 'a6900000-0000-4000-8000-000000000001'$q$, 'check', 'ISSUED exige la date et le document scellé');
  UPDATE examinations.issued_documents SET status = 'ISSUED', issued_at = now(), official_document_id = gen_random_uuid() WHERE id = 'a6900000-0000-4000-8000-000000000001';
  PERFORM ddltest.throws($q$UPDATE examinations.issued_documents SET official_document_id = gen_random_uuid() WHERE id = 'a6900000-0000-4000-8000-000000000001'$q$, 'document_issued', 'un document émis ne change plus');
  PERFORM ddltest.throws($q$UPDATE examinations.issued_documents SET status = 'REVOKED' WHERE id = 'a6900000-0000-4000-8000-000000000001'$q$, 'check', 'une révocation cite son motif');
  UPDATE examinations.issued_documents SET status = 'REVOKED', revoked_reason = 'Erreur d''état civil constatée' WHERE id = 'a6900000-0000-4000-8000-000000000001';
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, version, requested_by) VALUES (gen_random_uuid(), %L, %L, %L, 'ATTESTATION_REUSSITE', 2, gen_random_uuid())$q$, R, S, K1), 'après révocation, une nouvelle version peut être demandée');

  -- exports : seul un format PUBLIÉ s'exécute ; un export terminé est immuable
  INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, delimiter, columns, source_kind)
    VALUES (F, R, 'RESULTATS_FICTIFS', 'Résultats (fictif)', 'RESULTS', 'CSV', ';', '[{"header":"NUMERO","source":"candidate.number"},{"header":"RESULTAT","source":"result.code"}]', 'placeholder'),
           (FD, R, 'BROUILLON', 'Brouillon', 'RESULTS', 'JSON', NULL, '[{"header":"N","source":"candidate.number"}]', 'placeholder');
  UPDATE examinations.export_formats SET status = 'PUBLISHED', published_at = now() WHERE id = F;
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.export_runs (id, tenant_id, session_id, format_id, format_version, requested_by) VALUES (gen_random_uuid(), %L, %L, %L, 1, gen_random_uuid())$q$, R, S, FD),
     'format_not_published', 'un export exige un format publié');
  INSERT INTO examinations.export_runs (id, tenant_id, session_id, format_id, format_version, requested_by) VALUES (run1, R, S, F, 99, gen_random_uuid());
  PERFORM ddltest.ok((SELECT format_version FROM examinations.export_runs WHERE id = run1) = 1, 'la version du format est celle du format publié (valeur fournie ignorée)');
  PERFORM ddltest.throws(format($q$UPDATE examinations.export_runs SET status = 'DONE' WHERE id = %L$q$, run1), 'check', 'DONE exige empreinte, stockage, effectif et date');
  UPDATE examinations.export_runs SET status = 'DONE', row_count = 4, file_sha256 = repeat('e', 64), storage_key = 'exports/x.csv', completed_at = now() WHERE id = run1;
  PERFORM ddltest.throws(format($q$UPDATE examinations.export_runs SET row_count = 5 WHERE id = %L$q$, run1), 'export_closed', 'un export terminé ne change plus');

  -- statistiques : compteurs par sexe et globaux
  SELECT * INTO v FROM examinations.result_counts(S, 'SEX') WHERE group_key = 'F';
  PERFORM ddltest.ok(v.registered = 2 AND v.admitted = 1 AND v.failed = 1 AND v.present = 2, 'statistiques par sexe F : 2 inscrites, 1 admise, 1 échouée');
  SELECT * INTO v FROM examinations.result_counts(S, 'SEX') WHERE group_key = 'M';
  PERFORM ddltest.ok(v.registered = 2 AND v.absent = 1 AND v.admitted = 1 AND v.present = 1, 'statistiques par sexe M : 1 absent, 1 admis, 1 présent');
  SELECT * INTO v FROM examinations.result_counts(S, 'ALL');
  PERFORM ddltest.ok(v.registered = 4 AND v.admitted = 2 AND v.failed = 1 AND v.absent = 1, 'statistiques globales');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.result_counts(S, 'INJECTION; DROP TABLE x')) = 0, 'regroupement inconnu : aucune ligne (liste blanche)');
END $do$;

-- ---------------------------------------------------------------- examen blanc : résultats calculés, liens avec assess
DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a6100000-0000-4000-8000-000000000001';
  I constant uuid := 'a6200000-0000-4000-8000-000000000001';
  S constant uuid := 'a6300000-0000-4000-8000-000000000001';
  M constant uuid := 'a6300000-0000-4000-8000-0000000000e1';
  KM constant uuid := 'a6400000-0000-4000-8000-0000000000e1';
  EPM uuid; EPO uuid;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.new_session(M, R, T, I, 'CEPE-BLANC-2027', 'MOCK', S);
  PERFORM ddltest.open_session(M);
  PERFORM ddltest.new_candidate(KM, R, M, I);
  PERFORM ddltest.register(KM, 'Blanc', 'F');
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = M;
  UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = M;
  SELECT id INTO EPM FROM examinations.session_papers WHERE session_id = M AND code = 'EP1';
  SELECT id INTO EPO FROM examinations.session_papers WHERE session_id = S AND code = 'EP1';

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_assessment_links (id, tenant_id, session_id, paper_id, classroom_id, assessment_id) VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), gen_random_uuid())$q$, R, S, EPO),
     'links_mock_only', 'les liens avec assess ne concernent que les examens blancs');
  INSERT INTO examinations.paper_assessment_links (id, tenant_id, session_id, paper_id, classroom_id, assessment_id)
    VALUES (gen_random_uuid(), R, M, EPM, 'a6a00000-0000-4000-8000-000000000001', 'a6b00000-0000-4000-8000-000000000001');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.paper_assessment_links (id, tenant_id, session_id, paper_id, classroom_id, assessment_id) VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), 'a6b00000-0000-4000-8000-000000000001')$q$, R, M, EPM),
     '23505', 'une évaluation ne alimente qu''une épreuve');
  INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score, source, source_ref)
    VALUES (gen_random_uuid(), R, M, KM, EPM, 13, 'ASSESS', 'a6b00000-0000-4000-8000-000000000001');

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, import_batch_id)
     VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 12, 'IMPORTED', gen_random_uuid())$q$, R, M, KM), 'mock_not_imported', 'examen blanc : un résultat importé est refusé (il est calculé)');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source) VALUES (gen_random_uuid(), %L, %L, %L, 'ADMITTED', 12, 'COMPUTED')$q$, R, M, KM),
     'check', 'un résultat calculé cite la version de règle et l''empreinte des entrées');
  INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, rule_version_ref, inputs_hash)
    VALUES (gen_random_uuid(), R, M, KM, 'ADMITTED', 12.5, 'COMPUTED', gen_random_uuid(), repeat('f', 64));
  PERFORM ddltest.ok((SELECT outcome FROM examinations.candidates WHERE id = KM) = 'ADMITTED', 'examen blanc : résultat calculé tracé (règle + empreinte)');
END $do$;

-- ---------------------------------------------------------------- concurrence : numéros de candidat
DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a6100000-0000-4000-8000-000000000001';
  I constant uuid := 'a6200000-0000-4000-8000-000000000001';
  S3 constant uuid := 'a6300000-0000-4000-8000-0000000000c3';
  k int;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.new_session(S3, R, T, I, 'CEPE-CONC');
  PERFORM ddltest.open_session(S3);
  FOR k IN 1..20 LOOP
    PERFORM ddltest.new_candidate(('a6c00000-0000-4000-8000-0000000000' || lpad(k::text, 2, '0'))::uuid, R, S3, I);
    INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result)
      VALUES (gen_random_uuid(), R, ('a6c00000-0000-4000-8000-0000000000' || lpad(k::text, 2, '0'))::uuid, gen_random_uuid(), 'ELIGIBLE');
  END LOOP;
END $do$;

DO $do$
DECLARE
  R constant uuid := 'a6000000-0000-4000-8000-0000000000a1';
  S3 constant uuid := 'a6300000-0000-4000-8000-0000000000c3';
  conn text[] := ARRAY['n1', 'n2', 'n3', 'n4'];
  i int; rnd int; k int;
  numbers text[];
BEGIN
  FOR i IN 1..4 LOOP
    PERFORM dblink_connect(conn[i], 'dbname=postgres');
    PERFORM dblink_exec(conn[i], format($s$SET app.tenant_id = %L$s$, R));
  END LOOP;
  -- 5 tours : chaque session inscrit un candidat par tour, en parallèle
  FOR rnd IN 1..5 LOOP
    FOR i IN 1..4 LOOP
      k := (rnd - 1) * 4 + i;
      PERFORM dblink_send_query(conn[i], format(
        $s$UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = 'C%s', first_name = 'P', birth_date = DATE '2016-01-01', sex = 'F'
            WHERE id = 'a6c00000-0000-4000-8000-0000000000%s'$s$, k, lpad(k::text, 2, '0')));
    END LOOP;
    FOR i IN 1..4 LOOP
      PERFORM 1 FROM dblink_get_result(conn[i]) AS t(x text);
      PERFORM 1 FROM dblink_get_result(conn[i]) AS t(x text);
    END LOOP;
  END LOOP;
  FOR i IN 1..4 LOOP PERFORM dblink_disconnect(conn[i]); END LOOP;
  SELECT array_agg(candidate_number ORDER BY candidate_seq) INTO numbers FROM examinations.candidates WHERE session_id = S3 AND registration_status = 'REGISTERED';
  PERFORM ddltest.ok(cardinality(numbers) = 20, 'concurrence : 20 inscriptions réussies sur 4 sessions parallèles');
  PERFORM ddltest.ok((SELECT count(DISTINCT x) FROM unnest(numbers) x) = 20, 'concurrence : 20 numéros de candidat distincts');
  PERFORM ddltest.ok(numbers[1] = 'CEPE2027-00001' AND numbers[20] = 'CEPE2027-00020', 'concurrence : numérotation sans trou (00001 à 00020)');
EXCEPTION WHEN OTHERS THEN
  FOR i IN 1..4 LOOP
    BEGIN PERFORM dblink_disconnect(conn[i]); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  RAISE;
END $do$;

-- ---------------------------------------------------------------- isolation
SET ROLE app_user;
SELECT ddltest.as_tenant('a6000000-0000-4000-8000-0000000000ff');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.paper_scores) = 0, 'RLS : un autre tenant ne voit aucune note');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_results) = 0, 'RLS : un autre tenant ne voit aucun résultat');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.result_counts('a6300000-0000-4000-8000-000000000001', 'ALL')) = 0, 'RLS : les statistiques ignorent les données d''un autre tenant');
  PERFORM ddltest.throws($q$UPDATE examinations.score_revisions SET reason = 'x'$q$, '42501', 'GRANT : les révisions ne se modifient jamais');
  PERFORM ddltest.throws($q$DELETE FROM examinations.candidate_results$q$, '42501', 'GRANT : un résultat ne se supprime jamais');
END $do$;
RESET ROLE;
