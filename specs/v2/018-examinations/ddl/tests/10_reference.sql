-- Référentiels : types d'examens, séries, épreuves, formats d'export, centres, motif de numéro, RLS.
\set N '''a4000000-0000-4000-8000-0000000000a1'''
\set O '''a4000000-0000-4000-8000-0000000000b1'''
SELECT ddltest.make_tenant(:N::uuid, 'ex-n');
SELECT ddltest.make_tenant(:O::uuid, 'ex-o');

DO $do$
DECLARE
  N constant uuid := 'a4000000-0000-4000-8000-0000000000a1';
  T1 constant uuid := 'a4100000-0000-4000-8000-000000000001';
  T2 constant uuid := 'a4100000-0000-4000-8000-000000000002';
BEGIN
  PERFORM ddltest.as_tenant(N);
  PERFORM ddltest.cepe_type(N, T1);

  -- types : unicité, origine, motif de numéro
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code)
     VALUES (gen_random_uuid(), %L, 'CEPE', 'doublon', 'PRIMARY')$q$, N), '23505', 'code de type unique par tenant');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code, source_kind)
     VALUES (gen_random_uuid(), %L, 'BEPC', 'x', 'SECONDARY', 'regulation')$q$, N), 'check', 'un type « réglementaire » cite son texte');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code, candidate_number_pattern)
     VALUES (gen_random_uuid(), %L, 'BAC', 'x', 'SECONDARY', 'SANS-COMPTEUR')$q$, N), 'check', 'le motif de numéro contient un compteur {SEQ}');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code, source_kind)
     VALUES (%L, %L, 'BAC', 'BAC (donnée fictive)', 'SECONDARY', 'placeholder')$q$, T2, N), 'second type d''examen (données)');

  -- séries et épreuves
  INSERT INTO examinations.exam_tracks (id, tenant_id, exam_type_id, code, label, source_kind) VALUES
    (gen_random_uuid(), N, T2, 'A', 'Série A (fictive)', 'placeholder'), (gen_random_uuid(), N, T2, 'C', 'Série C (fictive)', 'placeholder');
  INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, track_code, code, label, ordinal, source_kind) VALUES
    (gen_random_uuid(), N, T2, NULL, 'COMMUN', 'Épreuve commune fictive', 1, 'placeholder'),
    (gen_random_uuid(), N, T2, 'A', 'SPEC', 'Épreuve spécifique A fictive', 2, 'placeholder');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, track_code, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, %L, NULL, 'COMMUN', 'doublon', 3)$q$, N, T2), '23505', 'épreuve commune unique par type (NULL traité comme valeur)');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, track_code, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'C', 'COMMUN', 'même code, autre série', 3)$q$, N, T2), 'même code d''épreuve dans une autre série');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, track_code, code, label, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'Z', 'X', 'x', 9)$q$, N, T2), '23503', 'une épreuve ne vise qu''une série du même type');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, code, label, ordinal, coefficient)
     VALUES (gen_random_uuid(), %L, %L, 'ZERO', 'x', 9, 0)$q$, N, T2), 'check', 'coefficient strictement positif');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_tracks (id, tenant_id, exam_type_id, code, label)
     VALUES (gen_random_uuid(), %L, 'a4100000-0000-4000-8000-0000000000ff', 'Q', 'x')$q$, N), '23503', 'une série vise un type existant');

  -- motif de numéro de candidat
  PERFORM ddltest.ok(examinations.format_number('{TYPE}{YEAR}-{SEQ:5}', 'CEPE', 2027, 42) = 'CEPE2027-00042', 'motif de numéro {TYPE}{YEAR}-{SEQ:5}');
  PERFORM ddltest.ok(examinations.format_number('{YEAR}/{SEQ}', 'CEPE', 2027, 7) = '2027/7', 'motif de numéro {SEQ} sans largeur');
  PERFORM ddltest.ok(examinations.format_number('{SEQ:3}', 'BAC', 2030, 1234) = '1234', 'un numéro plus long que la largeur n''est pas tronqué');

  -- compteur sans trou
  PERFORM ddltest.ok(examinations.next_number('t:a') = 1 AND examinations.next_number('t:a') = 2 AND examinations.next_number('t:b') = 1, 'compteurs indépendants par portée');
END $do$;

-- Formats d'export : liste blanche de champs, versionnement, publication
DO $do$
DECLARE
  N constant uuid := 'a4000000-0000-4000-8000-0000000000a1';
  cols constant jsonb := '[{"header":"NUMERO","source":"candidate.number"},{"header":"NOM","source":"candidate.last_name","transform":"upper"},{"header":"NOTE_EP1","source":"paper.score","paper":"EP1","transform":"decimal_comma"}]';
BEGIN
  PERFORM ddltest.as_tenant(N);
  PERFORM ddltest.ok(examinations.valid_export_columns(cols), 'colonnes d''export valides');
  PERFORM ddltest.ok(NOT examinations.valid_export_columns('[]'::jsonb), 'un format sans colonne est invalide');
  PERFORM ddltest.ok(NOT examinations.valid_export_columns('[{"header":"X","source":"candidate.password"}]'::jsonb), 'champ hors liste blanche refusé');
  PERFORM ddltest.ok(NOT examinations.valid_export_columns('[{"header":"X","source":"paper.score"}]'::jsonb), 'une colonne de note désigne son épreuve');
  PERFORM ddltest.ok(NOT examinations.valid_export_columns('[{"header":"X","source":"candidate.number","transform":"eval(1)"}]'::jsonb), 'transformation hors liste blanche refusée');
  PERFORM ddltest.ok(NOT examinations.valid_export_columns('[{"source":"candidate.number"}]'::jsonb), 'en-tête obligatoire');

  PERFORM ddltest.throws(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, delimiter, columns)
     VALUES (gen_random_uuid(), %L, 'LISTE', 'x', 'CANDIDATE_LIST', 'CSV', ';', '[{"header":"X","source":"candidate.token"}]')$q$, N), 'check', 'colonnes invalides refusées à l''insertion');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, columns)
     VALUES (gen_random_uuid(), %L, 'LISTE', 'x', 'CANDIDATE_LIST', 'CSV', %L::jsonb)$q$, N, cols), 'check', 'un CSV précise son séparateur');
  INSERT INTO examinations.export_formats (id, tenant_id, code, label, kind, file_format, delimiter, columns, source_kind)
    VALUES ('a4200000-0000-4000-8000-000000000001', N, 'LISTE_CANDIDATS', 'Liste (fictive)', 'CANDIDATE_LIST', 'CSV', ';', cols, 'placeholder');
  PERFORM ddltest.runs($q$UPDATE examinations.export_formats SET columns = '[{"header":"N","source":"candidate.number"}]'::jsonb WHERE code = 'LISTE_CANDIDATS'$q$, 'un brouillon de format se modifie');
  PERFORM ddltest.runs($q$UPDATE examinations.export_formats SET status = 'PUBLISHED', published_at = now() WHERE code = 'LISTE_CANDIDATS'$q$, 'publication d''un format');
  PERFORM ddltest.throws($q$UPDATE examinations.export_formats SET columns = '[{"header":"N","source":"candidate.last_name"}]'::jsonb WHERE code = 'LISTE_CANDIDATS'$q$, 'format_published_immutable', 'un format publié ne se modifie pas');
  PERFORM ddltest.throws($q$UPDATE examinations.export_formats SET version = 2 WHERE code = 'LISTE_CANDIDATS'$q$, 'format_identity_immutable', 'version figée');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, version, label, kind, file_format, delimiter, columns, status, published_at)
     VALUES (gen_random_uuid(), %L, 'LISTE_CANDIDATS', 2, 'v2', 'CANDIDATE_LIST', 'CSV', ';', %L::jsonb, 'PUBLISHED', now())$q$, N, cols), '23505', 'une seule version publiée par code');
  PERFORM ddltest.runs(format($q$INSERT INTO examinations.export_formats (id, tenant_id, code, version, label, kind, file_format, delimiter, columns)
     VALUES (gen_random_uuid(), %L, 'LISTE_CANDIDATS', 2, 'v2 brouillon', 'CANDIDATE_LIST', 'CSV', ';', %L::jsonb)$q$, N, cols), 'version suivante en brouillon');
  PERFORM ddltest.throws($q$UPDATE examinations.export_formats SET status = 'DRAFT', published_at = NULL WHERE version = 1$q$, 'format_transition', 'retour au brouillon interdit');
END $do$;

-- Centres et salles
DO $do$
DECLARE N constant uuid := 'a4000000-0000-4000-8000-0000000000a1';
BEGIN
  PERFORM ddltest.as_tenant(N);
  INSERT INTO examinations.centers (id, tenant_id, code, name, kind) VALUES ('a4300000-0000-4000-8000-000000000001', N, 'CTR1', 'Centre propre', 'OWN');
  INSERT INTO examinations.rooms (id, tenant_id, center_id, code, capacity) VALUES (gen_random_uuid(), N, 'a4300000-0000-4000-8000-000000000001', 'S1', 30);
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.rooms (id, tenant_id, center_id, code, capacity) VALUES (gen_random_uuid(), %L, 'a4300000-0000-4000-8000-000000000001', 'S1', 20)$q$, N), '23505', 'code de salle unique par centre');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.rooms (id, tenant_id, center_id, code, capacity) VALUES (gen_random_uuid(), %L, 'a4300000-0000-4000-8000-000000000001', 'S2', 0)$q$, N), 'check', 'capacité de salle strictement positive');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.centers (id, tenant_id, code, name, kind) VALUES (gen_random_uuid(), %L, 'CTR2', 'x', 'FOREIGN')$q$, N), 'check', 'nature de centre : OWN ou HOST');
END $do$;

-- Isolation
SET ROLE app_user;
SELECT ddltest.as_tenant('a4000000-0000-4000-8000-0000000000b1');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.exam_types) = 0, 'RLS : le tenant O ne voit aucun type d''examen de N');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.export_formats) = 0, 'RLS : le tenant O ne voit aucun format de N');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.centers) = 0, 'RLS : le tenant O ne voit aucun centre de N');
  PERFORM ddltest.ok(examinations.next_number('t:a') = 1, 'RLS : les compteurs de O sont indépendants de ceux de N');
  PERFORM ddltest.throws($q$INSERT INTO examinations.centers (id, tenant_id, code, name, kind)
     VALUES (gen_random_uuid(), 'a4000000-0000-4000-8000-0000000000a1', 'INTRUS', 'x', 'OWN')$q$, '42501', 'RLS : centre écrit pour un autre tenant refusé');
  PERFORM ddltest.throws($q$INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, code, label, ordinal)
     VALUES (gen_random_uuid(), 'a4000000-0000-4000-8000-0000000000b1', 'a4100000-0000-4000-8000-000000000001', 'X', 'x', 1)$q$, '23503', 'FK composite : épreuve rattachée à un type d''un autre tenant refusée');
  PERFORM ddltest.throws($q$DELETE FROM examinations.exam_types$q$, '42501', 'GRANT : pas de DELETE sur les types d''examens');
END $do$;
RESET ROLE;
