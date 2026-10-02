-- Candidatures : cycle de vie piloté par le workflow, consentement, pièces, décisions, capacité, liste d'attente,
-- doublons, passage à l'inscription, offres, prospects, notifications, numérotation, RLS.
\set J '''a2000000-0000-4000-8000-0000000000a1'''
\set K '''a2000000-0000-4000-8000-0000000000b1'''
SELECT ddltest.make_tenant(:J::uuid, 'adm-j');
SELECT ddltest.make_tenant(:K::uuid, 'adm-k');

-- Aide : porte un dossier jusqu'à l'étude avec consentement et pièce obligatoire acceptée.
CREATE OR REPLACE FUNCTION ddltest.to_review(p_app uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a admissions.applications%ROWTYPE; g uuid := gen_random_uuid();
BEGIN
  SELECT * INTO a FROM admissions.applications WHERE id = p_app;
  INSERT INTO admissions.application_guardians (id, tenant_id, application_id, relationship_code, first_name, last_name, phone, is_primary)
    VALUES (g, a.tenant_id, a.id, 'MOTHER', 'Mère', a.applicant_last_name, '+2250102030405', true);
  INSERT INTO admissions.consents (id, tenant_id, application_id, guardian_id, kind, text_version, given_via)
    VALUES (gen_random_uuid(), a.tenant_id, a.id, g, 'DATA_PROCESSING', 'v1', 'PUBLIC_FORM');
  PERFORM ddltest.move(p_app, 'SUBMITTED');
  PERFORM ddltest.move(p_app, 'UNDER_REVIEW');
  INSERT INTO admissions.application_documents (id, tenant_id, application_id, requirement_id, status, storage_key, reviewed_by, reviewed_at, submitted_at)
    SELECT gen_random_uuid(), a.tenant_id, a.id, r.id, 'ACCEPTED', 'k/' || r.code, gen_random_uuid(), now(), now()
      FROM admissions.document_requirements r
     WHERE r.tenant_id = a.tenant_id AND r.institution_id = a.institution_id AND r.required
       AND (r.applies_to_funding IS NULL OR r.applies_to_funding = a.funding_type_requested);
END $$;

-- Aide : offre ACCEPTÉE par le tuteur principal, avec la classe visée.
CREATE OR REPLACE FUNCTION ddltest.accept_offer(p_app uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a admissions.applications%ROWTYPE; g uuid;
BEGIN
  SELECT * INTO a FROM admissions.applications WHERE id = p_app;
  SELECT id INTO g FROM admissions.application_guardians WHERE application_id = p_app ORDER BY is_primary DESC LIMIT 1;
  INSERT INTO admissions.offers (id, tenant_id, application_id, status, grade_level_code, expires_at, responded_at, responded_by_guardian_id, classroom_id)
    VALUES (gen_random_uuid(), a.tenant_id, a.id, 'ACCEPTED', a.desired_grade_level_code, now() + interval '7 days', now(), g, gen_random_uuid());
END $$;

-- ---------------------------------------------------------------- jeu de départ
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  I2 constant uuid := 'a2100000-0000-4000-8000-000000000002';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  W2 constant uuid := 'a2200000-0000-4000-8000-000000000002';
  YR constant uuid := 'a2300000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.standard_workflow(J, I, W, 'STD');
  UPDATE admissions.workflows SET status = 'PUBLISHED', published_at = now() WHERE id = W;
  PERFORM ddltest.standard_workflow(J, I2, W2, 'STD_INTERVIEW', NULL, true);
  UPDATE admissions.workflows SET status = 'PUBLISHED', published_at = now() WHERE id = W2;
  INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at, status)
  VALUES ('a2400000-0000-4000-8000-000000000001', J, I, YR, 'C1', 'Campagne 1', W, now() - interval '1 day', now() + interval '60 days', 'OPEN'),
         ('a2400000-0000-4000-8000-000000000002', J, I2, YR, 'C2', 'Campagne entretien', W2, now() - interval '1 day', now() + interval '60 days', 'OPEN'),
         ('a2400000-0000-4000-8000-000000000003', J, I, YR, 'C3', 'Campagne close', W, now() - interval '90 days', now() - interval '30 days', 'CLOSED');
  INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, seats, waitlist_limit) VALUES
    (gen_random_uuid(), J, 'a2400000-0000-4000-8000-000000000001', 'CP1', 2, NULL),
    (gen_random_uuid(), J, 'a2400000-0000-4000-8000-000000000001', 'CP2', 0, 1);
  INSERT INTO admissions.document_requirements (id, tenant_id, institution_id, code, label, applies_to_funding, required, sort_order) VALUES
    ('a2600000-0000-4000-8000-000000000001', J, I, 'ACTE_NAISSANCE', 'Acte de naissance', NULL, true, 1),
    ('a2600000-0000-4000-8000-000000000002', J, I, 'LETTRE_AFFECTATION', 'Décision d''affectation', 'STATE_ASSIGNED', true, 2),
    ('a2600000-0000-4000-8000-000000000003', J, I, 'PHOTO', 'Photo d''identité', NULL, false, 3);
  INSERT INTO admissions.priority_classes (id, tenant_id, institution_id, code, label, rank)
    VALUES (gen_random_uuid(), J, I, 'SIBLING', 'Frère ou sœur déjà scolarisé', 1);
  INSERT INTO admissions.decision_reasons (id, tenant_id, institution_id, code, kind, label)
    VALUES (gen_random_uuid(), J, I, 'FAMILY_REQUEST', 'WITHDRAW', 'Demande de la famille');
END $do$;

-- ---------------------------------------------------------------- 1. cycle de vie complet de A1
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  C1 constant uuid := 'a2400000-0000-4000-8000-000000000001';
  A1 constant uuid := 'a2500000-0000-4000-8000-0000000000a1';
  g uuid;
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.new_application(A1, J, I, C1, W, '2026-00001', 'Awa', 'Koné', DATE '2019-03-02');
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = A1) = 'DRAFT', 'une candidature naît DRAFT');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.transitions WHERE application_id = A1) = 1, 'la création est journalisée (transitions)');

  -- étape initiale obligatoire
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.applications (id, tenant_id, institution_id, campaign_id, workflow_id, stage_id, application_number,
       created_via, applicant_first_name, applicant_last_name, applicant_birth_date, desired_grade_level_code)
       VALUES (gen_random_uuid(), %L, %L, %L, %L, ddltest.sid(%L, 'ACCEPTED'), 'X1', 'STAFF', 'A', 'B', DATE '2019-01-01', 'CP1')$q$, J, I, C1, W, W),
     'application_initial_stage', 'une candidature naît à l''étape initiale');

  -- doublon : même enfant (casse, accents, espaces), même campagne
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_application(gen_random_uuid(), %L, %L, %L, %L, '2026-00099', ' AWA ', 'KONÉ', DATE '2019-03-02')$q$, J, I, C1, W),
     '23505', 'le même enfant ne dépose pas deux dossiers vivants dans une campagne (normalisation accents/casse)');
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_application(gen_random_uuid(), %L, %L, %L, %L, '2026-00001', 'Autre', 'Enfant', DATE '2018-01-01')$q$, J, I, C1, W),
     '23505', 'numéro de candidature unique par campagne');

  -- financement par l'État : référence d'affectation obligatoire
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.applications (id, tenant_id, institution_id, campaign_id, workflow_id, stage_id, application_number,
       created_via, applicant_first_name, applicant_last_name, applicant_birth_date, desired_grade_level_code, funding_type_requested)
       VALUES (gen_random_uuid(), %L, %L, %L, %L, ddltest.sid(%L, 'DRAFT'), 'X2', 'STAFF', 'Sans', 'Reference', DATE '2018-02-02', 'CP1', 'STATE_ASSIGNED')$q$, J, I, C1, W, W),
     'check', 'STATE_ASSIGNED exige la référence d''affectation');

  -- consentement parental avant le dépôt
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'SUBMITTED')$q$, A1), 'consent_missing', 'dépôt sans consentement parental refusé');
  g := gen_random_uuid();
  INSERT INTO admissions.application_guardians (id, tenant_id, application_id, relationship_code, first_name, last_name, email, is_primary, can_consent)
    VALUES (g, J, A1, 'UNCLE', 'Oncle', 'Koné', 'oncle@example.test', true, false);
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.consents (id, tenant_id, application_id, guardian_id, kind, text_version, given_via)
     VALUES (gen_random_uuid(), %L, %L, %L, 'DATA_PROCESSING', 'v1', 'PUBLIC_FORM')$q$, J, A1, g), 'consent_guardian_not_entitled', 'seul un tuteur habilité consent');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.application_guardians (id, tenant_id, application_id, relationship_code, first_name, last_name, phone, is_primary)
     VALUES (gen_random_uuid(), %L, %L, 'AUNT', 'Tante', 'Koné', '+2250707070707', true)$q$, J, A1), '23505', 'un seul tuteur principal');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.application_guardians (id, tenant_id, application_id, relationship_code, first_name, last_name)
     VALUES (gen_random_uuid(), %L, %L, 'AUNT', 'Tante', 'Koné')$q$, J, A1), 'check', 'un tuteur a un téléphone ou un e-mail');
  UPDATE admissions.application_guardians SET can_consent = true, is_primary = true WHERE id = g;
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.consents (id, tenant_id, application_id, guardian_id, kind, text_version, given_via)
     VALUES (gen_random_uuid(), %L, %L, %L, 'DATA_PROCESSING', 'v1', 'STAFF_ON_BEHALF')$q$, J, A1, g), 'check', 'un consentement par délégation exige une pièce justificative');
  INSERT INTO admissions.consents (id, tenant_id, application_id, guardian_id, kind, text_version, given_via, evidence_ref)
    VALUES ('a2700000-0000-4000-8000-000000000001', J, A1, g, 'DATA_PROCESSING', 'v1', 'PAPER', 'scan/consentement-001.pdf');
  PERFORM ddltest.throws($q$UPDATE admissions.consents SET text_version = 'v2' WHERE id = 'a2700000-0000-4000-8000-000000000001'$q$, 'consent_immutable', 'un consentement ne se réécrit pas');
  PERFORM ddltest.throws($q$DELETE FROM admissions.consents WHERE id = 'a2700000-0000-4000-8000-000000000001'$q$, 'consent_immutable', 'un consentement ne s''efface pas');

  PERFORM ddltest.move(A1, 'SUBMITTED');
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = A1) = 'SUBMITTED', 'dépôt : statut canonique dérivé de l''étape');
  PERFORM ddltest.ok((SELECT submitted_at IS NOT NULL FROM admissions.applications WHERE id = A1), 'dépôt : submitted_at posé');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.transitions WHERE application_id = A1) = 2, 'chaque changement d''étape est journalisé');
  PERFORM ddltest.ok((SELECT actor_kind FROM admissions.transitions WHERE application_id = A1 ORDER BY occurred_at DESC, id LIMIT 1) = 'SYSTEM', 'acteur SYSTEM quand aucun utilisateur n''est posé');

  -- transition non déclarée
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'ACCEPTED')$q$, A1), 'transition_not_allowed', 'SUBMITTED -> ACCEPTED n''est pas déclaré');
  PERFORM ddltest.move(A1, 'UNDER_REVIEW');

  -- décision formelle exigée, dans la même transaction
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, A1, A1),
     'ACTE_NAISSANCE', 'ACCEPTED avec pièces obligatoires non acceptées refusé (la liste est citée)');
  PERFORM ddltest.throws(format($q$SELECT ddltest.decide(%L, 'REJECT', 'ACCEPTED')$q$, A1), 'decision_kind_mismatch', 'le type de décision doit correspondre au statut visé');
  PERFORM ddltest.throws(format($q$SELECT ddltest.decide(%L, 'REJECT', 'REJECTED')$q$, A1), 'check', 'un refus cite son motif');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.decisions (id, tenant_id, application_id, kind, from_stage_id, to_stage_id, decided_by, decided_by_name)
     VALUES (gen_random_uuid(), %L, %L, 'ACCEPT', ddltest.sid(%L, 'SUBMITTED'), ddltest.sid(%L, 'ACCEPTED'), gen_random_uuid(), 'X')$q$, J, A1, W, W),
     'decision_stale', 'une décision partant d''une étape périmée est refusée');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.decisions (id, tenant_id, application_id, kind, from_stage_id, to_stage_id, decided_by, decided_by_name)
     VALUES (gen_random_uuid(), %L, %L, 'ACCEPT', ddltest.sid(%L, 'UNDER_REVIEW'), ddltest.sid(%L, 'ENROLLED'), gen_random_uuid(), 'X')$q$, J, A1, W, W),
     'transition_not_allowed', 'une décision vers une étape non atteignable est refusée');

  -- pièces : requise pour STATE_ASSIGNED seulement si le financement l'exige
  PERFORM ddltest.ok(admissions.missing_required_documents(A1) = ARRAY['ACTE_NAISSANCE'], 'pièces manquantes = acte de naissance (la photo est facultative, la lettre ne vise pas PRIVATE)');
  INSERT INTO admissions.application_documents (id, tenant_id, application_id, requirement_id, status, storage_key, reviewed_by, reviewed_at, submitted_at)
    VALUES (gen_random_uuid(), J, A1, 'a2600000-0000-4000-8000-000000000001', 'SUBMITTED', 'k/acte', NULL, NULL, now());
  PERFORM ddltest.ok(admissions.missing_required_documents(A1) = ARRAY['ACTE_NAISSANCE'], 'une pièce déposée mais non acceptée reste manquante');
  PERFORM ddltest.throws($q$UPDATE admissions.application_documents SET status = 'REJECTED' WHERE storage_key = 'k/acte'$q$, 'check', 'un rejet cite son motif et son relecteur');
  UPDATE admissions.application_documents SET status = 'ACCEPTED', reviewed_by = gen_random_uuid(), reviewed_at = now() WHERE storage_key = 'k/acte';
  PERFORM ddltest.ok(cardinality(admissions.missing_required_documents(A1)) = 0, 'toutes les pièces obligatoires acceptées');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.application_documents (id, tenant_id, application_id, requirement_id, status)
     VALUES (gen_random_uuid(), %L, %L, 'a2600000-0000-4000-8000-000000000003', 'SUBMITTED')$q$, J, A1), 'check', 'une pièce déposée référence un fichier');
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'ACCEPTED')$q$, A1), 'decision_missing', 'ACCEPTED sans décision journalisée refusé');

  PERFORM ddltest.decide(A1, 'ACCEPT', 'ACCEPTED');
  PERFORM ddltest.move(A1, 'ACCEPTED');
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = A1) = 'ACCEPTED', 'admission avec décision + pièces');
  PERFORM ddltest.ok((SELECT decided_at IS NOT NULL FROM admissions.applications WHERE id = A1), 'decided_at posé');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.decisions WHERE application_id = A1) = 1, 'la décision est au journal');
  PERFORM ddltest.throws($q$UPDATE admissions.decisions SET reason_text = 'réécrite'$q$, 'append_only', 'journal des décisions en ajout seul (UPDATE)');
  PERFORM ddltest.throws($q$DELETE FROM admissions.decisions$q$, 'append_only', 'journal des décisions en ajout seul (DELETE)');
  PERFORM ddltest.throws($q$UPDATE admissions.transitions SET to_status = 'ENROLLED'$q$, 'append_only', 'journal des transitions en ajout seul');
  PERFORM ddltest.throws(format($q$UPDATE admissions.applications SET application_number = 'AUTRE' WHERE id = %L$q$, A1), 'application_identity_immutable', 'numéro de candidature figé');
  PERFORM ddltest.ok(admissions.seats_left(C1, 'CP1') = 1, 'places restantes : 2 - 1 = 1');
END $do$;

-- ---------------------------------------------------------------- 2. capacité, liste d'attente, priorités
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  C1 constant uuid := 'a2400000-0000-4000-8000-000000000001';
  A1 constant uuid := 'a2500000-0000-4000-8000-0000000000a1';
  A2 constant uuid := 'a2500000-0000-4000-8000-0000000000a2';
  A3 constant uuid := 'a2500000-0000-4000-8000-0000000000a3';
  A4 constant uuid := 'a2500000-0000-4000-8000-0000000000a4';
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.new_application(A2, J, I, C1, W, '2026-00002', 'Yao', 'Kouassi', DATE '2019-05-05');
  PERFORM ddltest.new_application(A3, J, I, C1, W, '2026-00003', 'Fatou', 'Traoré', DATE '2019-06-06');
  PERFORM ddltest.new_application(A4, J, I, C1, W, '2026-00004', 'Moussa', 'Bamba', DATE '2019-07-07');
  PERFORM ddltest.to_review(A2); PERFORM ddltest.to_review(A3); PERFORM ddltest.to_review(A4);

  PERFORM ddltest.decide(A2, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(A2, 'ACCEPTED');
  PERFORM ddltest.ok(admissions.seats_left(C1, 'CP1') = 0, 'capacité atteinte : 0 place restante');
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, A3, A3),
     'capacity_full', 'admission au-delà de la capacité refusée (politique HARD)');

  -- liste d'attente : A3 puis A4 (priorité SIBLING) -> A4 passe devant
  PERFORM ddltest.decide(A3, 'WAITLIST', 'WAITLISTED'); PERFORM ddltest.move(A3, 'WAITLISTED');
  PERFORM pg_sleep(0.05);
  UPDATE admissions.applications SET priority_class_code = 'SIBLING' WHERE id = A4;
  PERFORM ddltest.decide(A4, 'WAITLIST', 'WAITLISTED'); PERFORM ddltest.move(A4, 'WAITLISTED');
  PERFORM ddltest.ok((SELECT waitlist_entered_at IS NOT NULL FROM admissions.applications WHERE id = A3), 'liste d''attente : date d''entrée posée');
  PERFORM ddltest.ok((SELECT array_agg(application_id ORDER BY queue_position) FROM admissions.waitlist_order(C1, 'CP1')) = ARRAY[A4, A3], 'liste d''attente : la priorité SIBLING passe avant l''ancienneté');
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = A3) = 'WAITLISTED', 'statut WAITLISTED');

  -- un retrait libère la place
  PERFORM ddltest.throws(format($q$SELECT ddltest.decide(%L, 'WITHDRAW', 'WITHDRAWN')$q$, A1), 'check', 'un retrait cite son motif');
  PERFORM ddltest.decide(A1, 'WITHDRAW', 'WITHDRAWN', 'FAMILY_REQUEST', 'La famille déménage');
  PERFORM ddltest.move(A1, 'WITHDRAWN');
  PERFORM ddltest.ok((SELECT closed_at IS NOT NULL AND status = 'REJECTED' FROM admissions.applications WHERE id = A1), 'retrait : statut canonique REJECTED, clôturé');
  PERFORM ddltest.ok(admissions.seats_left(C1, 'CP1') = 1, 'la place du retrait est rendue');
  -- l'enfant retiré peut redéposer (l'index d'unicité exclut REJECTED)
  PERFORM ddltest.runs(format($q$SELECT ddltest.new_application(gen_random_uuid(), %L, %L, %L, %L, '2026-00050', 'Awa', 'Koné', DATE '2019-03-02')$q$, J, I, C1, W), 'redépôt possible après un retrait');
  -- le premier de la liste d'attente prend la place, le suivant est refusé
  PERFORM ddltest.decide(A4, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(A4, 'ACCEPTED');
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, A3, A3),
     'capacity_full', 'la place libérée n''a servi qu''une fois');
END $do$;

-- ---------------------------------------------------------------- 3. politique SOFT : dépassement motivé
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  A3 constant uuid := 'a2500000-0000-4000-8000-0000000000a3';
  C1 constant uuid := 'a2400000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(J);
  INSERT INTO admissions.settings (tenant_id, institution_id, capacity_policy, duplicate_policy) VALUES (J, I, 'SOFT', 'WARN');
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, A3, A3),
     'capacity_override_reason', 'SOFT : le dépassement exige un motif sur la candidature');
  PERFORM ddltest.throws(format($q$SELECT ddltest.decide(%L, 'ACCEPT', 'ACCEPTED', NULL, 'court', true)$q$, A3), 'check', 'SOFT : la décision de dépassement cite un motif d''au moins 10 caractères');
  UPDATE admissions.applications SET capacity_override_reason = 'Fratrie de deux élèves déjà admis' WHERE id = A3;
  PERFORM ddltest.decide(A3, 'ACCEPT', 'ACCEPTED', NULL, 'Fratrie de deux élèves déjà admis', true);
  PERFORM ddltest.move(A3, 'ACCEPTED');
  PERFORM ddltest.ok(admissions.seats_left(C1, 'CP1') = -1, 'SOFT : dépassement de capacité enregistré (-1)');
  UPDATE admissions.settings SET capacity_policy = 'HARD' WHERE tenant_id = J AND institution_id = I;
END $do$;

-- ---------------------------------------------------------------- 4. passage à l'inscription
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  A2 constant uuid := 'a2500000-0000-4000-8000-0000000000a2';
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'AWAITING_PAYMENT')$q$, A2), 'offer_not_accepted', 'l''inscription exige une offre acceptée portant la classe visée');
  PERFORM ddltest.accept_offer(A2);
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'AWAITING_PAYMENT')$q$, A2), 'enrollment_missing', 'l''étape de paiement exige l''élève et l''inscription créés');
  UPDATE admissions.applications SET student_id = gen_random_uuid(), enrollment_id = gen_random_uuid(), invoice_id = gen_random_uuid(),
         stage_id = ddltest.sid(workflow_id, 'AWAITING_PAYMENT') WHERE id = A2;
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = A2) = 'ACCEPTED', 'attente de paiement : statut canonique ACCEPTED');
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'ENROLLED')$q$, A2), 'check', 'ENROLLED exige la confirmation de l''inscription');
  UPDATE admissions.applications SET enrollment_confirmed_at = now(), stage_id = ddltest.sid(workflow_id, 'ENROLLED') WHERE id = A2;
  PERFORM ddltest.ok((SELECT status = 'ENROLLED' AND enrolled_at IS NOT NULL AND closed_at IS NOT NULL FROM admissions.applications WHERE id = A2), 'ENROLLED : enrolled_at et closed_at posés');
  PERFORM ddltest.throws(format($q$UPDATE admissions.applications SET applicant_last_name = 'Autre' WHERE id = %L$q$, A2), 'application_frozen_after_enrollment', 'identité figée après la création de l''élève');
  PERFORM ddltest.throws(format($q$SELECT ddltest.move(%L, 'WITHDRAWN')$q$, A2), 'transition_not_allowed', 'plus de sortie de ENROLLED');
END $do$;

-- ---------------------------------------------------------------- 5. doublons BLOCK
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  A4 constant uuid := 'a2500000-0000-4000-8000-0000000000a4';
  d uuid := gen_random_uuid();
BEGIN
  PERFORM ddltest.as_tenant(J);
  UPDATE admissions.settings SET duplicate_policy = 'BLOCK' WHERE tenant_id = J AND institution_id = I;
  PERFORM ddltest.accept_offer(A4);
  INSERT INTO admissions.duplicate_candidates (id, tenant_id, application_id, matched_kind, matched_id, score, reasons)
    VALUES (d, J, A4, 'STUDENT', gen_random_uuid(), 92, ARRAY['NAME_AND_BIRTHDATE']);
  PERFORM ddltest.throws(format($q$UPDATE admissions.applications SET student_id = gen_random_uuid(), enrollment_id = gen_random_uuid(),
       stage_id = ddltest.sid(workflow_id, 'AWAITING_PAYMENT') WHERE id = %L$q$, A4), 'duplicates_pending', 'BLOCK : un doublon non tranché empêche l''inscription');
  PERFORM ddltest.throws(format($q$UPDATE admissions.duplicate_candidates SET status = 'DISMISSED' WHERE id = %L$q$, d), 'check', 'trancher un doublon exige un relecteur');
  UPDATE admissions.duplicate_candidates SET status = 'DISMISSED', reviewed_by = gen_random_uuid(), reviewed_at = now() WHERE id = d;
  PERFORM ddltest.runs(format($q$UPDATE admissions.applications SET student_id = gen_random_uuid(), enrollment_id = gen_random_uuid(),
       stage_id = ddltest.sid(workflow_id, 'AWAITING_PAYMENT') WHERE id = %L$q$, A4), 'doublon écarté : l''inscription passe');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.duplicate_candidates (id, tenant_id, application_id, matched_kind, matched_id, score)
     VALUES (gen_random_uuid(), %L, %L, 'STUDENT', (SELECT matched_id FROM admissions.duplicate_candidates WHERE id = %L), 50)$q$, J, A4, d), '23505', 'un même rapprochement n''est enregistré qu''une fois');
END $do$;

-- ---------------------------------------------------------------- 6. entretien exigé (autre établissement)
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I2 constant uuid := 'a2100000-0000-4000-8000-000000000002';
  W2 constant uuid := 'a2200000-0000-4000-8000-000000000002';
  C2 constant uuid := 'a2400000-0000-4000-8000-000000000002';
  B1 constant uuid := 'a2500000-0000-4000-8000-0000000000b1';
  iv uuid := gen_random_uuid();
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.new_application(B1, J, I2, C2, W2, '2026-B-00001', 'Kofi', 'Mensah', DATE '2018-08-08');
  PERFORM ddltest.to_review(B1);
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, B1, B1),
     'interview_missing', 'un entretien terminé est exigé par ce workflow');
  INSERT INTO admissions.interviews (id, tenant_id, application_id, kind, scheduled_at) VALUES (iv, J, B1, 'INTERVIEW', now());
  PERFORM ddltest.throws(format($q$UPDATE admissions.interviews SET status = 'DONE' WHERE id = %L$q$, iv), 'check', 'un entretien terminé a un résultat');
  PERFORM ddltest.throws(format($q$UPDATE admissions.interviews SET status = 'DONE', result_code = 'PASSED', score = 25 WHERE id = %L$q$, iv), 'check', 'une note exige un barème et ne le dépasse pas');
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'ACCEPT', 'ACCEPTED'); PERFORM ddltest.move(%L, 'ACCEPTED'); END $$$q$, B1, B1),
     'interview_missing', 'un entretien seulement planifié ne suffit pas');
  UPDATE admissions.interviews SET status = 'DONE', result_code = 'PASSED', score = 14.5, scale_max = 20 WHERE id = iv;
  PERFORM ddltest.decide(B1, 'ACCEPT', 'ACCEPTED');
  PERFORM ddltest.move(B1, 'ACCEPTED');
  PERFORM ddltest.ok((SELECT status FROM admissions.applications WHERE id = B1) = 'ACCEPTED', 'entretien terminé : admission possible');
END $do$;

-- ---------------------------------------------------------------- 7. plafond de la liste d'attente
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  C1 constant uuid := 'a2400000-0000-4000-8000-000000000001';
  W1 constant uuid := 'a2500000-0000-4000-8000-0000000000c1';
  W2 constant uuid := 'a2500000-0000-4000-8000-0000000000c2';
BEGIN
  PERFORM ddltest.as_tenant(J);
  PERFORM ddltest.new_application(W1, J, I, C1, W, '2026-00061', 'Aya', 'Diallo', DATE '2018-01-11', 'CP2');
  PERFORM ddltest.new_application(W2, J, I, C1, W, '2026-00062', 'Ali', 'Sylla', DATE '2018-02-12', 'CP2');
  PERFORM ddltest.to_review(W1); PERFORM ddltest.to_review(W2);
  PERFORM ddltest.decide(W1, 'WAITLIST', 'WAITLISTED'); PERFORM ddltest.move(W1, 'WAITLISTED');
  PERFORM ddltest.throws(format($q$DO $$ BEGIN PERFORM ddltest.decide(%L, 'WAITLIST', 'WAITLISTED'); PERFORM ddltest.move(%L, 'WAITLISTED'); END $$$q$, W2, W2),
     'waitlist_full', 'plafond de la liste d''attente atteint');
END $do$;

-- ---------------------------------------------------------------- 8. offres, prospects, notifications, campagne close, numérotation
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  C3 constant uuid := 'a2400000-0000-4000-8000-000000000003';
  A3 constant uuid := 'a2500000-0000-4000-8000-0000000000a3';
  n1 bigint; n3 bigint;
BEGIN
  PERFORM ddltest.as_tenant(J);
  -- offres
  INSERT INTO admissions.offers (id, tenant_id, application_id, grade_level_code, expires_at) VALUES (gen_random_uuid(), J, A3, 'CP1', now() + interval '14 days');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.offers (id, tenant_id, application_id, grade_level_code, expires_at) VALUES (gen_random_uuid(), %L, %L, 'CP1', now() + interval '7 days')$q$, J, A3),
     '23505', 'une seule offre en attente par candidature');
  PERFORM ddltest.throws($q$UPDATE admissions.offers SET status = 'ACCEPTED'$q$, 'check', 'accepter une offre exige la date et le tuteur répondant');
  PERFORM ddltest.throws(format($q$UPDATE admissions.offers SET status = 'ACCEPTED', responded_at = now(), responded_by_guardian_id = gen_random_uuid() WHERE application_id = %L AND status = 'PENDING'$q$, A3),
     'check', 'accepter une offre exige la classe visée');
  UPDATE admissions.offers SET response_token_hash = repeat('7', 64) WHERE application_id = A3 AND status = 'PENDING';
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.offers (id, tenant_id, application_id, status, grade_level_code, expires_at, response_token_hash)
     VALUES (gen_random_uuid(), %L, %L, 'EXPIRED', 'CP1', now() + interval '1 day', repeat('7', 64))$q$, J, A3), '23505', 'un lien de réponse désigne une seule offre');
  PERFORM ddltest.throws($q$UPDATE admissions.offers SET response_token_hash = 'pas-une-empreinte'$q$, 'check', 'seule l''empreinte du lien de réponse est stockée');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.offers (id, tenant_id, application_id, grade_level_code, issued_at, expires_at) VALUES (gen_random_uuid(), %L, %L, 'CP1', now(), now() - interval '1 day')$q$, J, A3),
     'check', 'une offre expire après son émission');

  -- prospects
  INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name, contact_email) VALUES ('a2800000-0000-4000-8000-000000000001', J, I, 'Paul', 'Yapi', 'Paul.Yapi@example.test');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name, contact_email) VALUES (gen_random_uuid(), %L, %L, 'P', 'Y', 'paul.yapi@EXAMPLE.test')$q$, J, I),
     '23505', 'un seul prospect actif par e-mail (casse ignorée)');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name) VALUES (gen_random_uuid(), %L, %L, 'P', 'Y')$q$, J, I), 'check', 'un prospect a un moyen de contact');
  PERFORM ddltest.throws($q$UPDATE admissions.prospects SET status = 'CONVERTED' WHERE id = 'a2800000-0000-4000-8000-000000000001'$q$, 'check', 'CONVERTED exige la candidature créée');
  PERFORM ddltest.throws($q$UPDATE admissions.prospects SET status = 'LOST' WHERE id = 'a2800000-0000-4000-8000-000000000001'$q$, 'check', 'LOST exige un motif');
  UPDATE admissions.prospects SET status = 'CONVERTED', converted_application_id = A3 WHERE id = 'a2800000-0000-4000-8000-000000000001';
  PERFORM ddltest.runs(format($q$INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name, contact_email) VALUES (gen_random_uuid(), %L, %L, 'Paul', 'Yapi', 'paul.yapi@example.test')$q$, J, I),
     'un prospect converti libère l''e-mail');

  -- notifications : idempotence
  INSERT INTO admissions.notification_log (id, tenant_id, application_id, channel, template_code, dedupe_key) VALUES (gen_random_uuid(), J, A3, 'EMAIL', 'APPLICATION_RECEIVED', 'v1');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.notification_log (id, tenant_id, application_id, channel, template_code, dedupe_key) VALUES (gen_random_uuid(), %L, %L, 'EMAIL', 'APPLICATION_RECEIVED', 'v1')$q$, J, A3),
     '23505', 'une notification identique n''est mise en file qu''une fois');
  PERFORM ddltest.throws($q$UPDATE admissions.notification_log SET status = 'SENT'$q$, 'check', 'SENT exige la date d''envoi');

  -- campagne close
  PERFORM ddltest.throws(format($q$SELECT ddltest.new_application(gen_random_uuid(), %L, %L, %L, %L, '2026-C-1', 'Tard', 'Venu', DATE '2018-09-09')$q$, J, I, C3, W),
     'campaign_closed', 'aucun dossier dans une campagne close');

  -- numérotation sans trou : une annulation ne consomme aucun numéro
  n1 := admissions.next_number('app:test');
  BEGIN
    PERFORM admissions.next_number('app:test');
    RAISE EXCEPTION 'annulation volontaire';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  n3 := admissions.next_number('app:test');
  PERFORM ddltest.ok(n3 = n1 + 1, 'numérotation sans trou : un numéro annulé est rendu');
END $do$;

-- ---------------------------------------------------------------- 8 bis. textes de consentement, anonymisation, paramètres
DO $do$
DECLARE
  J constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  I constant uuid := 'a2100000-0000-4000-8000-000000000001';
  W constant uuid := 'a2200000-0000-4000-8000-000000000001';
  C1 constant uuid := 'a2400000-0000-4000-8000-000000000001';
  R1 constant uuid := 'a2500000-0000-4000-8000-0000000000d1';
  R2 constant uuid := 'a2500000-0000-4000-8000-0000000000d2';
BEGIN
  PERFORM ddltest.as_tenant(J);
  -- paramètres
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.settings (tenant_id, institution_id, waitlist_promotion) VALUES (%L, gen_random_uuid(), 'SOMETIMES')$q$, J), 'check', 'promotion de la liste d''attente : MANUAL ou AUTO');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.settings (tenant_id, institution_id, payment_deadline_days) VALUES (%L, gen_random_uuid(), 0)$q$, J), 'check', 'délai de paiement strictement positif (ou absent)');

  -- textes de consentement : publiés une fois, jamais modifiés
  INSERT INTO admissions.consent_texts (id, tenant_id, institution_id, kind, version, body)
    VALUES ('a2900000-0000-4000-8000-000000000001', J, I, 'DATA_PROCESSING', 'v1', 'Texte de démonstration du consentement au traitement des données de l''enfant.');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.consent_texts (id, tenant_id, institution_id, kind, version, body) VALUES (gen_random_uuid(), %L, %L, 'DATA_PROCESSING', 'v1', 'Un autre texte pour la même version, de longueur suffisante.')$q$, J, I), '23505', 'une version de texte par nature et établissement');
  PERFORM ddltest.throws($q$UPDATE admissions.consent_texts SET body = 'Texte réécrit après coup, de longueur suffisante pour passer le contrôle.'$q$, 'consent_text_immutable', 'un texte publié ne change pas');
  PERFORM ddltest.throws($q$DELETE FROM admissions.consent_texts$q$, 'consent_text_immutable', 'un texte de consentement ne se supprime pas');
  PERFORM ddltest.runs($q$UPDATE admissions.consent_texts SET retired_at = now()$q$, 'un texte se retire (une fois)');
  PERFORM ddltest.throws($q$UPDATE admissions.consent_texts SET retired_at = now() + interval '1 day'$q$, 'consent_text_retired', 'un texte retiré est figé');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.consent_texts (id, tenant_id, institution_id, kind, version, body) VALUES (gen_random_uuid(), %L, %L, 'PHOTO', 'v 2', 'Texte suffisamment long pour le contrôle de longueur.')$q$, J, I), 'check', 'identifiant de version sans espace');

  -- anonymisation : réservée aux dossiers clos sans inscription
  PERFORM ddltest.new_application(R1, J, I, C1, W, '2026-00071', 'Marie', 'Dupont', DATE '2018-04-20');
  PERFORM ddltest.to_review(R1);
  PERFORM ddltest.throws(format($q$SELECT admissions.anonymize_application(%L)$q$, R1), 'anonymize_forbidden', 'un dossier en cours ne s''anonymise pas');
  PERFORM ddltest.decide(R1, 'REJECT', 'REJECTED', 'NO_PLACE', 'Aucune place disponible dans le niveau demandé');
  PERFORM ddltest.move(R1, 'REJECTED');
  PERFORM admissions.anonymize_application(R1);
  PERFORM ddltest.ok((SELECT applicant_last_name = 'ANONYMISÉ' AND anonymized_at IS NOT NULL AND extract(month FROM applicant_birth_date) = 1 FROM admissions.applications WHERE id = R1), 'anonymisation : identité remplacée, naissance généralisée à l''année');
  PERFORM ddltest.ok((SELECT bool_and(first_name = 'ANONYMISÉ' AND email IS NULL) FROM admissions.application_guardians WHERE application_id = R1), 'anonymisation : tuteurs neutralisés');
  PERFORM ddltest.ok((SELECT bool_and(storage_key IS NULL AND status = 'MISSING') FROM admissions.application_documents WHERE application_id = R1), 'anonymisation : références de pièces effacées');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.decisions WHERE application_id = R1) = 1, 'anonymisation : la décision (sans nom) reste au journal');
  PERFORM admissions.anonymize_application(R1);   -- idempotent
  PERFORM ddltest.throws(format($q$SELECT admissions.anonymize_application(%L)$q$, 'a2500000-0000-4000-8000-0000000000a2'), 'anonymize_forbidden', 'un dossier inscrit ne s''anonymise jamais');
END $do$;

-- ---------------------------------------------------------------- 9. isolation et privilèges
SET ROLE app_user;
SELECT ddltest.as_tenant('a2000000-0000-4000-8000-0000000000b1');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.applications) = 0, 'RLS : le tenant K ne voit aucune candidature de J');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.decisions) = 0, 'RLS : le tenant K ne voit aucune décision de J');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.consents) = 0, 'RLS : le tenant K ne voit aucun consentement de J');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.prospects) = 0, 'RLS : le tenant K ne voit aucun prospect de J');
  PERFORM ddltest.ok(admissions.seats_left('a2400000-0000-4000-8000-000000000001', 'CP1') IS NULL, 'RLS : les fonctions de lecture ignorent les données de J');
  PERFORM ddltest.ok(admissions.missing_required_documents('a2500000-0000-4000-8000-0000000000a1') = ARRAY[]::text[], 'RLS : pièces manquantes d''un dossier invisible = {}');
  PERFORM ddltest.throws($q$INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name, contact_phone)
     VALUES (gen_random_uuid(), 'a2000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'x', 'y', '+2250101010101')$q$, '42501', 'RLS : prospect écrit pour un autre tenant refusé');
END $do$;
SELECT ddltest.as_tenant('a2000000-0000-4000-8000-0000000000a1');
DO $do$
BEGIN
  PERFORM ddltest.throws($q$UPDATE admissions.decisions SET reason_text = 'x'$q$, '42501', 'GRANT : app_user ne modifie jamais une décision');
  PERFORM ddltest.throws($q$DELETE FROM admissions.transitions$q$, '42501', 'GRANT : app_user ne supprime jamais une transition');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.applications) >= 8, 'J voit ses candidatures');
  -- une application créée par app_user : le journal des transitions se remplit malgré l'absence de droit d'UPDATE
  PERFORM ddltest.runs(format($q$SELECT ddltest.new_application(gen_random_uuid(), 'a2000000-0000-4000-8000-0000000000a1', 'a2100000-0000-4000-8000-000000000001',
      'a2400000-0000-4000-8000-000000000001', 'a2200000-0000-4000-8000-000000000001', '2026-00077', 'Nina', 'Soro', DATE '2019-10-10')$q$), 'app_user crée une candidature');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.transitions t JOIN admissions.applications a ON a.id = t.application_id WHERE a.application_number = '2026-00077') = 1, 'transition de création journalisée sous app_user');
END $do$;
RESET ROLE;
