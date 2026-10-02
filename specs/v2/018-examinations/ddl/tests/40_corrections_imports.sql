-- Migrations 2003 (demandes de révision, correction après publication) et 2004 (formats d'import).
\set R '''a7000000-0000-4000-8000-0000000000a1'''
SELECT ddltest.make_tenant(:R::uuid, 'ex-c');

-- ---------------------------------------------------------------- session officielle publiée, résultat corrigé par révision
DO $do$
DECLARE
  R constant uuid := 'a7000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'a7100000-0000-4000-8000-000000000001';
  I constant uuid := 'a7200000-0000-4000-8000-000000000001';
  S constant uuid := 'a7300000-0000-4000-8000-000000000001';
  K constant uuid := 'a7400000-0000-4000-8000-000000000001';
  K2 constant uuid := 'a7400000-0000-4000-8000-000000000002';
  B constant uuid := 'a7500000-0000-4000-8000-000000000001';
  RES constant uuid := 'a7700000-0000-4000-8000-000000000001';
  RES2 constant uuid := 'a7700000-0000-4000-8000-000000000002';
  SC constant uuid := 'a7600000-0000-4000-8000-000000000001';
  REQ constant uuid := 'a7800000-0000-4000-8000-000000000001';
  U1 constant uuid := 'a7900000-0000-4000-8000-000000000001';
  U2 constant uuid := 'a7900000-0000-4000-8000-000000000002';
  EP1 uuid;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.cepe_type(R, T);
  PERFORM ddltest.new_session(S, R, T, I, 'CEPE-C-2027');
  PERFORM ddltest.open_session(S);
  PERFORM ddltest.new_candidate(K, R, S, I);
  PERFORM ddltest.new_candidate(K2, R, S, I);
  PERFORM ddltest.register(K, 'Corrigé', 'F');
  PERFORM ddltest.register(K2, 'Autre', 'M');
  UPDATE examinations.sessions SET status = 'REGISTRATION_CLOSED' WHERE id = S;
  UPDATE examinations.sessions SET status = 'IN_PROGRESS' WHERE id = S;
  SELECT id INTO EP1 FROM examinations.session_papers WHERE session_id = S AND code = 'EP1';
  INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, score, entered_by) VALUES (SC, R, S, K, EP1, 8, U1);
  INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, row_count, ok_count, uploaded_by, status)
    VALUES (B, R, S, 'RESULTS', 'r.csv', repeat('a', 64), 2, 2, U1, 'UPLOADED');
  INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, source, import_batch_id) VALUES
    (RES, R, S, K, 'FAILED', 9.4, 'IMPORTED', B), (RES2, R, S, K2, 'ADMITTED', 12, 'IMPORTED', B);

  -- demande sur un résultat non publié : inutile
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, result_id, proposed, reason, requested_by)
     VALUES (gen_random_uuid(), %L, %L, 'RESULT', %L, '{"toCode":"ADMITTED"}', 'Erreur de saisie constatée', %L)$q$, R, S, RES, U1),
     'revision_not_needed', 'un résultat non publié se saisit directement (pas de demande)');
  -- demande sur une note avant la saisie des résultats : inutile
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, proposed, reason, requested_by)
     VALUES (gen_random_uuid(), %L, %L, 'SCORE', %L, '{"toScore":11}', 'Erreur de report de la note', %L)$q$, R, S, SC, U1),
     'revision_not_needed', 'une note se corrige librement tant que les résultats ne sont pas saisis');

  UPDATE examinations.sessions SET status = 'RESULTS_ENTERED' WHERE id = S;
  -- note : demande puis approbation par une AUTRE personne
  INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, proposed, reason, requested_by)
    VALUES (REQ, R, S, 'SCORE', SC, '{"toStatus":"ENTERED","toScore":11}', 'Erreur de report de la note', U1);
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, proposed, reason, requested_by)
     VALUES (gen_random_uuid(), %L, %L, 'SCORE', %L, '{"toScore":12}', 'Deuxième demande concurrente', %L)$q$, R, S, SC, U1),
     '23505', 'une seule demande en attente par note');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, proposed, reason, requested_by)
     VALUES (gen_random_uuid(), %L, %L, 'SCORE', %L, '{}', 'court', %L)$q$, R, S, SC, U2), 'check', 'motif d''au moins 10 caractères');
  PERFORM ddltest.throws(format($q$UPDATE examinations.revision_requests SET status = 'APPROVED', decided_by = %L, decided_at = now(), revision_id = gen_random_uuid() WHERE id = %L$q$, U1, REQ),
     'check', 'séparation des tâches : l''approbateur n''est pas le demandeur');
  PERFORM ddltest.throws(format($q$UPDATE examinations.revision_requests SET status = 'REJECTED', decided_by = %L, decided_at = now() WHERE id = %L$q$, U2, REQ),
     'check', 'un refus cite sa raison');
  PERFORM ddltest.throws(format($q$UPDATE examinations.revision_requests SET reason = 'réécrite après coup ici' WHERE id = %L$q$, REQ), 'revision_request_identity_immutable', 'le contenu d''une demande ne change pas');
  -- l'approbation : révision + correction dans la même transaction
  INSERT INTO examinations.score_revisions (id, tenant_id, score_id, from_status, from_score, to_status, to_score, reason, requested_by, approved_by)
    VALUES ('a7a00000-0000-4000-8000-000000000001', R, SC, 'ENTERED', 8, 'ENTERED', 11, 'Erreur de report de la note', U1, U2);
  UPDATE examinations.paper_scores SET score = 11 WHERE id = SC;
  UPDATE examinations.revision_requests SET status = 'APPROVED', decided_by = U2, decided_at = now(), revision_id = 'a7a00000-0000-4000-8000-000000000001' WHERE id = REQ;
  PERFORM ddltest.throws(format($q$UPDATE examinations.revision_requests SET status = 'REJECTED', decided_by = %L, decided_at = now(), decision_note = 'Trop tard pour refuser' WHERE id = %L$q$, U2, REQ),
     'revision_request_closed', 'une demande décidée ne change plus');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, proposed, reason, requested_by)
     VALUES (gen_random_uuid(), %L, %L, 'SCORE', %L, '{"toScore":12}', 'Nouvelle demande après décision', %L)$q$, R, S, SC, U1), 'une nouvelle demande est possible une fois la précédente décidée');

  -- résultat : publier, publier la session, puis corriger par révision (session PUBLISHED)
  UPDATE examinations.candidate_results SET status = 'PUBLISHED', published_at = now(), published_by = U1 WHERE session_id = S;
  UPDATE examinations.sessions SET status = 'PUBLISHED' WHERE id = S;
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_results SET result_code = 'ADMITTED', average = 10.2 WHERE id = %L$q$, RES), 'result_revision_required', 'session publiée : un résultat ne se corrige que par révision');
  INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, result_id, proposed, reason, requested_by)
    VALUES (gen_random_uuid(), R, S, 'RESULT', RES, '{"toCode":"ADMITTED","toAverage":10.2}', 'Moyenne relevée au PV de jury', U1);
  INSERT INTO examinations.result_revisions (id, tenant_id, result_id, from_code, to_code, from_average, to_average, reason, requested_by, approved_by)
    VALUES (gen_random_uuid(), R, RES, 'FAILED', 'ADMITTED', 9.4, 10.2, 'Moyenne relevée au PV de jury', U1, U2);
  PERFORM ddltest.runs(format($q$UPDATE examinations.candidate_results SET result_code = 'ADMITTED', average = 10.2 WHERE id = %L$q$, RES), 'résultat publié corrigé par révision, session PUBLISHED');
  PERFORM ddltest.ok((SELECT outcome FROM examinations.candidates WHERE id = K) = 'ADMITTED', 'l''issue suit la correction après publication de la session');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_results SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = %L$q$, RES), 'result_published', 'dépublication toujours interdite');
  UPDATE examinations.sessions SET status = 'ARCHIVED' WHERE id = S;
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_results SET average = 11 WHERE id = %L$q$, RES2), 'results_closed', 'session archivée : plus aucune écriture de résultat');
END $do$;

-- ---------------------------------------------------------------- formats d'import
DO $do$
DECLARE
  R constant uuid := 'a7000000-0000-4000-8000-0000000000a1';
  F constant uuid := 'a7b00000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(R);
  -- liste blanche d'export : compteurs de statistiques (2003)
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, delimiter, columns, source_kind)
     VALUES (gen_random_uuid(), %L, 'STAT_FICTIVE', 'Statistiques (fictif)', 'STATISTICS', 'CSV', ';',
     '[{"header":"GROUPE","source":"stat.group"},{"header":"ADMIS","source":"stat.admitted"},{"header":"TAUX","source":"stat.rate","transform":"decimal_comma"}]', 'placeholder')$q$, R),
     'les compteurs de statistiques sont des champs de la liste blanche');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, delimiter, columns, source_kind)
     VALUES (gen_random_uuid(), %L, 'STAT_MAUVAISE', 'x', 'STATISTICS', 'CSV', ';', '[{"header":"X","source":"stat.password"}]', 'placeholder')$q$, R),
     'check', 'un champ de statistique hors liste est refusé');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns) VALUES (gen_random_uuid(), %L, 'X1', 'x', 'RESULTS',
     '[{"header":"NUM","target":"key.candidate_number"}]')$q$, R), 'check', 'un format de résultats exige la colonne du résultat');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns) VALUES (gen_random_uuid(), %L, 'X2', 'x', 'RESULTS',
     '[{"header":"NUM","target":"key.candidate_number"},{"header":"R","target":"result.code"},{"header":"N2","target":"key.official_number"}]')$q$, R), 'check', 'une seule colonne clé');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns) VALUES (gen_random_uuid(), %L, 'X3', 'x', 'RESULTS',
     '[{"header":"NUM","target":"key.candidate_number"},{"header":"R","target":"candidate.last_name"}]')$q$, R), 'check', 'cible hors liste blanche refusée');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns) VALUES (gen_random_uuid(), %L, 'X4', 'x', 'SCORES',
     '[{"header":"NUM","target":"key.candidate_number"},{"header":"N","target":"paper.score"}]')$q$, R), 'check', 'une colonne de note désigne son épreuve');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns, value_map) VALUES (gen_random_uuid(), %L, 'X5', 'x', 'RESULTS',
     '[{"header":"NUM","target":"key.candidate_number"},{"header":"R","target":"result.code"}]', '{"result.code":{"OK":"PASSED"}}')$q$, R), 'check', 'la table de correspondance ne vise que des codes connus');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns, value_map) VALUES (gen_random_uuid(), %L, 'X6', 'x', 'RESULTS',
     '[{"header":"NUM","target":"key.candidate_number"},{"header":"R","target":"result.code"}]', '{"candidate.sex":{"F":"M"}}')$q$, R), 'check', 'table de correspondance : clés en liste blanche');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns) VALUES (gen_random_uuid(), %L, 'X7', 'x', 'RESULTS', '"pas un tableau"')$q$, R), 'check', 'colonnes : tableau attendu');
  INSERT INTO examinations.import_formats (id, tenant_id, code, label, kind, columns, value_map, source_kind) VALUES
    (F, R, 'RESULTATS_FICTIFS', 'Résultats (fictif)', 'RESULTS',
     '[{"header":"NUMERO","target":"key.candidate_number"},{"header":"DECISION","target":"result.code"},{"header":"MOYENNE","target":"result.average"}]',
     '{"result.code":{"ADMIS":"ADMITTED","AJOURNE":"FAILED","ABSENT":"ABSENT"}}', 'placeholder');
  UPDATE examinations.import_formats SET status = 'PUBLISHED', published_at = now() WHERE id = F;
  PERFORM ddltest.throws(format($q$UPDATE examinations.import_formats SET delimiter = ',' WHERE id = %L$q$, F), 'format_published_immutable', 'un format d''import publié est figé');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.import_formats (id, tenant_id, code, version, label, kind, columns, status, published_at) VALUES (gen_random_uuid(), %L, 'RESULTATS_FICTIFS', 2, 'v2', 'RESULTS',
     '[{"header":"N","target":"key.candidate_number"},{"header":"R","target":"result.code"}]', 'PUBLISHED', now())$q$, R), '23505', 'un seul format publié par code');
  PERFORM ddltest.throws(format($q$UPDATE examinations.import_formats SET status = 'DRAFT', published_at = NULL WHERE id = %L$q$, F), 'format_transition', 'PUBLISHED -> DRAFT interdit');
  UPDATE examinations.import_formats SET status = 'RETIRED' WHERE id = F;
END $do$;

-- ---------------------------------------------------------------- isolation
SET ROLE app_user;
SELECT ddltest.as_tenant('a7000000-0000-4000-8000-0000000000ff');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.revision_requests) = 0, 'RLS : un autre tenant ne voit aucune demande de révision');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.import_formats) = 0, 'RLS : un autre tenant ne voit aucun format d''import');
  PERFORM ddltest.throws($q$DELETE FROM examinations.revision_requests$q$, '42501', 'GRANT : une demande ne se supprime jamais');
END $do$;
RESET ROLE;
