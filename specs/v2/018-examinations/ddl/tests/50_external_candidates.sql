-- Migration 2005 : candidat libre (Q-E15) — régime du candidat, profil restreint, pièce vue sur place, anonymisation, RLS.
\set R '''a8000000-0000-4000-8000-0000000000a1'''
\set R2 '''a8000000-0000-4000-8000-0000000000a2'''
SELECT ddltest.make_tenant(:R::uuid, 'ex-ext-a');
SELECT ddltest.make_tenant(:R2::uuid, 'ex-ext-b');

DO $do$
DECLARE
  R  constant uuid := 'a8000000-0000-4000-8000-0000000000a1';
  R2 constant uuid := 'a8000000-0000-4000-8000-0000000000a2';
  T  constant uuid := 'a8100000-0000-4000-8000-000000000001';
  T2 constant uuid := 'a8100000-0000-4000-8000-000000000002';
  I  constant uuid := 'a8200000-0000-4000-8000-000000000001';
  S  constant uuid := 'a8300000-0000-4000-8000-000000000001';
  SM constant uuid := 'a8300000-0000-4000-8000-000000000002';
  S2 constant uuid := 'a8300000-0000-4000-8000-000000000003';
  K  constant uuid := 'a8400000-0000-4000-8000-000000000001';
  KS constant uuid := 'a8400000-0000-4000-8000-000000000002';
  K3 constant uuid := 'a8400000-0000-4000-8000-000000000003';
  K4 constant uuid := 'a8400000-0000-4000-8000-000000000004';
  KB constant uuid := 'a8400000-0000-4000-8000-000000000005';
  P  constant uuid := 'a8500000-0000-4000-8000-000000000001';
  PB constant uuid := 'a8500000-0000-4000-8000-000000000005';
  REQ uuid;
  v_num text;
  v_n integer;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.cepe_type(R, T, true);
  PERFORM ddltest.new_session(S, R, T, I, 'CEPE-EXT-2027');
  PERFORM ddltest.new_session(SM, R, T, I, 'CEPE-EXT-BLANC', 'MOCK', S);
  PERFORM ddltest.open_session(S);
  PERFORM ddltest.open_session(SM);
  PERFORM ddltest.as_tenant(R);

  -- ---------------------------------------------------------------- régime du candidat
  INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, birth_place, sex)
    VALUES (K, R, S, I, NULL, 'EXTERNAL', 'LIBRE', 'Premier', DATE '2015-03-04', 'Bouaké', 'M');
  PERFORM ddltest.pass('un candidat libre se crée SANS élève (student_id NULL), identité posée dès la création');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind)
     VALUES (gen_random_uuid(), %L, %L, %L, NULL, 'STUDENT')$q$, R, S, I), 'candidates_kind_student', 'un candidat élève exige un student_id');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, sex)
     VALUES (gen_random_uuid(), %L, %L, %L, gen_random_uuid(), 'EXTERNAL', 'X', 'Y', DATE '2015-01-01', 'F')$q$, R, S, I), 'candidates_kind_student', 'un candidat libre n''a pas de student_id');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name)
     VALUES (gen_random_uuid(), %L, %L, %L, NULL, 'EXTERNAL', 'SANS-IDENTITE')$q$, R, S, I), 'candidates_external_identity', 'un candidat libre porte nom, prénoms, naissance et sexe dès la création');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, sex)
     VALUES (gen_random_uuid(), %L, %L, %L, NULL, 'EXTERNAL', ' libre ', 'PREMIER', DATE '2015-03-04', 'M')$q$, R, S, I), 'candidates_one_live_external', 'même nom, mêmes prénoms, même naissance : un seul libre vivant par session');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, sex)
     VALUES (gen_random_uuid(), %L, %L, %L, NULL, 'EXTERNAL', 'LIBRE', 'Blanc', DATE '2015-03-04', 'M')$q$, R, SM, I), 'external_official_only', 'un libre n''existe pas dans un examen blanc');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET candidate_kind = 'STUDENT' WHERE id = %L$q$, K), 'candidate_identity_immutable', 'le régime d''un candidat ne change pas');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET student_id = gen_random_uuid() WHERE id = %L$q$, K), 'candidate_identity_immutable', 'un libre ne se rattache pas à un élève après coup');

  -- ---------------------------------------------------------------- profil restreint
  INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, grade_level_code) VALUES (KS, R, S, I, gen_random_uuid(), 'CM2');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, declared_in_exam_grade)
     VALUES (gen_random_uuid(), %L, %L, %L, '+2250700000001', true)$q$, R, S, KS), 'external_only', 'un profil ne se rattache qu''à un candidat libre');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, declared_in_exam_grade)
     VALUES (gen_random_uuid(), %L, %L, %L, true)$q$, R, S, K), 'external_candidate_profiles_check', 'au moins un moyen de contact');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, id_piece_kind, declared_in_exam_grade)
     VALUES (gen_random_uuid(), %L, %L, %L, '+2250700000001', 'NATIONAL_ID', true)$q$, R, S, K), 'external_candidate_profiles_check', 'type et numéro de pièce vont ensemble');
  INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, id_piece_kind, id_piece_number, guardian_name, declared_in_exam_grade)
    VALUES (P, R, S, K, '+2250700000001', 'NATIONAL_ID', 'CNI-001', 'Tuteur', true);
  PERFORM ddltest.pass('profil du libre créé (contact, pièce, tuteur, fait d''éligibilité déclaré)');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, declared_in_exam_grade)
     VALUES (gen_random_uuid(), %L, %L, %L, '+2250700000002', true)$q$, R, S, K), 'external_candidate_profiles_tenant_id_candidate_id_key', 'un seul profil par candidat');
  INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, sex)
    VALUES (K3, R, S, I, NULL, 'EXTERNAL', 'AUTRE', 'Libre', DATE '2014-02-02', 'F');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, id_piece_kind, id_piece_number, declared_in_exam_grade)
     VALUES (gen_random_uuid(), %L, %L, %L, '+2250700000003', 'NATIONAL_ID', 'CNI-001', true)$q$, R, S, K3), 'external_candidate_profiles_piece', 'une pièce d''identité désigne un seul libre par session');

  -- ---------------------------------------------------------------- pièce « vue sur place »
  SELECT id INTO REQ FROM examinations.document_requirements WHERE exam_type_id = T AND code = 'ACTE_NAISSANCE';
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status) VALUES (gen_random_uuid(), %L, %L, %L, 'SUBMITTED')$q$, R, K, REQ),
     'candidate_documents_has_proof', 'une pièce déposée sans preuve est refusée');
  INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, presentation_kind, sighted_note)
    VALUES (gen_random_uuid(), R, K, REQ, 'SUBMITTED', 'SIGHTED', 'original vu');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, presentation_kind, document_ref) VALUES (gen_random_uuid(), %L, %L, %L, 'SUBMITTED', 'SIGHTED', gen_random_uuid())$q$, R, K3, REQ),
     'candidate_documents_sighted_shape', 'une pièce vue sur place ne porte pas de document');
  UPDATE examinations.candidate_documents SET status = 'ACCEPTED', reviewed_by = gen_random_uuid(), reviewed_at = now() WHERE candidate_id = K AND requirement_id = REQ;
  PERFORM ddltest.pass('pièce vue sur place relue et acceptée');

  -- ---------------------------------------------------------------- inscription : même compteur sans trou que les élèves
  INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, document_ref, reviewed_by, reviewed_at)
    VALUES (gen_random_uuid(), R, KS, REQ, 'ACCEPTED', gen_random_uuid(), gen_random_uuid(), now());
  PERFORM ddltest.register(KS, 'ELEVE', 'F');
  SELECT candidate_number INTO v_num FROM examinations.candidates WHERE id = KS;
  PERFORM ddltest.ok(v_num = 'CEPE2027-00001', 'l''élève prend le numéro 00001');
  INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result) VALUES (gen_random_uuid(), R, K, gen_random_uuid(), 'ELIGIBLE');
  UPDATE examinations.candidates SET registration_status = 'REGISTERED' WHERE id = K;
  SELECT candidate_number INTO v_num FROM examinations.candidates WHERE id = K;
  PERFORM ddltest.ok(v_num = 'CEPE2027-00002', 'le libre prend le numéro suivant du MÊME compteur (00002), sans trou');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET last_name = 'MODIFIE' WHERE id = %L$q$, K), 'candidate_snapshot_frozen', 'l''identité d''un libre inscrit est figée');
  -- un libre qui n'a pas de pièce acceptée ne s''inscrit pas (session officielle)
  INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result) VALUES (gen_random_uuid(), R, K3, gen_random_uuid(), 'ELIGIBLE');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET registration_status = 'REGISTERED' WHERE id = %L$q$, K3), 'documents_incomplete', 'pièces exigées acceptées avant inscription, comme pour un élève');

  -- ---------------------------------------------------------------- anonymisation
  INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value) VALUES
    (gen_random_uuid(), R, S, K, 'OFFICIAL_NUMBER', 'OFF-77'), (gen_random_uuid(), R, S, K, 'NATIONAL_ID', 'NAT-77');
  PERFORM ddltest.throws(format($q$SELECT examinations.anonymize_external_candidate(%L, 'court')$q$, K), 'invalid_input', 'motif de 10 caractères au moins');
  PERFORM ddltest.throws(format($q$SELECT examinations.anonymize_external_candidate(%L, 'Tentative sur un élève inscrit')$q$, KS), 'external_only', 'un élève ne s''anonymise pas par cette voie');
  PERFORM examinations.anonymize_external_candidate(K, 'Demande écrite de la personne');
  SELECT count(*) INTO v_n FROM examinations.candidates WHERE id = K AND last_name = 'ANONYME' AND first_name = 'ANONYME' AND birth_place IS NULL
     AND birth_date = DATE '2015-01-01' AND anonymized_at IS NOT NULL AND candidate_number = 'CEPE2027-00002' AND registration_status = 'REGISTERED';
  PERFORM ddltest.ok(v_n = 1, 'identité neutre (année de naissance seule), numéro et statut conservés');
  SELECT count(*) INTO v_n FROM examinations.external_candidate_profiles WHERE candidate_id = K AND contact_phone IS NULL AND id_piece_number IS NULL AND guardian_name IS NULL AND anonymized_at IS NOT NULL;
  PERFORM ddltest.ok(v_n = 1, 'profil effacé');
  SELECT count(*) INTO v_n FROM examinations.candidate_identifiers WHERE candidate_id = K AND ((kind = 'NATIONAL_ID' AND value LIKE 'ANONYME-%') OR (kind = 'OFFICIAL_NUMBER' AND value = 'OFF-77'));
  PERFORM ddltest.ok(v_n = 2, 'identifiant personnel rendu neutre, numéro officiel conservé');
  PERFORM ddltest.throws(format($q$SELECT examinations.anonymize_external_candidate(%L, 'Deuxième demande identique')$q$, K), 'candidate_anonymized', 'irréversible et non rejouable');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidates SET last_name = 'LIBRE' WHERE id = %L$q$, K), 'candidate_anonymized', 'l''identité ne se rétablit pas');
  PERFORM ddltest.throws(format($q$UPDATE examinations.external_candidate_profiles SET contact_phone = '+2250700000009' WHERE candidate_id = %L$q$, K), 'candidate_anonymized', 'le profil anonymisé ne se réécrit pas');
  SELECT count(*) INTO v_n FROM examinations.candidate_history WHERE candidate_id = K AND kind = 'NOTE' AND reason LIKE 'Anonymisation%';
  PERFORM ddltest.ok(v_n = 1, 'l''anonymisation est tracée dans l''historique (ajout seul)');
  -- le libre anonymisé libère l'index d'unicité : une nouvelle personne de même identité apparente peut être saisie
  INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, candidate_kind, last_name, first_name, birth_date, sex)
    VALUES (K4, R, S, I, NULL, 'EXTERNAL', 'LIBRE', 'Premier', DATE '2015-03-04', 'M');
  PERFORM ddltest.pass('après anonymisation, l''identité libérée peut être saisie à nouveau');

END
$do$;

-- ---------------------------------------------------------------- isolation (un autre tenant ne voit ni le libre, ni son profil)
SET ROLE app_user;
SELECT ddltest.as_tenant('a8000000-0000-4000-8000-0000000000a2');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.external_candidate_profiles) = 0, 'RLS : le tenant B ne voit aucun profil de candidat libre de A');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidates WHERE candidate_kind = 'EXTERNAL') = 0, 'RLS : le tenant B ne voit aucun candidat libre de A');
  PERFORM ddltest.throws($q$INSERT INTO examinations.external_candidate_profiles (id, tenant_id, session_id, candidate_id, contact_phone, declared_in_exam_grade)
     VALUES (gen_random_uuid(), 'a8000000-0000-4000-8000-0000000000a1', 'a8300000-0000-4000-8000-000000000001', 'a8400000-0000-4000-8000-000000000001', '+2250700000099', true)$q$, 'external_only', 'RLS : profil rattaché au candidat d''un autre tenant refusé (candidat invisible)');
  PERFORM ddltest.throws($q$DELETE FROM examinations.external_candidate_profiles$q$, '42501', 'GRANT : un profil ne se supprime jamais (anonymisation seulement)');
END $do$;
RESET ROLE;
