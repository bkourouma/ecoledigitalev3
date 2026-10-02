-- Fixtures du module admissions : workflow standard et aides de décision (superutilisateur : la RLS n'est pas l'objet).
CREATE EXTENSION IF NOT EXISTS dblink;   -- essais de concurrence (plusieurs sessions réelles)

-- Identifiant déterministe d'une étape : md5(workflow || code) -> uuid.
CREATE OR REPLACE FUNCTION ddltest.sid(p_workflow uuid, p_code text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT md5(p_workflow::text || ':' || p_code)::uuid $$;

-- Workflow standard : DRAFT > SUBMITTED > UNDER_REVIEW <> MISSING_DOCUMENT > {ACCEPTED, WAITLISTED, REJECTED}
--   ACCEPTED > AWAITING_PAYMENT (crée l'inscription) > ENROLLED ; ACCEPTED|AWAITING_PAYMENT > WITHDRAWN
-- p_interview : l'étape ACCEPTED exige un entretien terminé.
CREATE OR REPLACE FUNCTION ddltest.standard_workflow(p_tenant uuid, p_inst uuid, p_wf uuid, p_code text,
                                                     p_level text DEFAULT NULL, p_interview boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO admissions.workflows (id, tenant_id, institution_id, code, label, education_level_code)
  VALUES (p_wf, p_tenant, p_inst, p_code, 'Workflow ' || p_code, p_level);
  INSERT INTO admissions.workflow_stages
    (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, is_initial, is_terminal, holds_seat,
     requires_consent, requires_documents_complete, requires_interview_done, requires_decision, creates_enrollment, closure_kind)
  VALUES
    (ddltest.sid(p_wf, 'DRAFT'),            p_tenant, p_wf, 'DRAFT',            'Brouillon',            'DRAFT',            1, true,  false, false, false, false, false,       false, false, NULL),
    (ddltest.sid(p_wf, 'SUBMITTED'),        p_tenant, p_wf, 'SUBMITTED',        'Déposée',              'SUBMITTED',        2, false, false, false, true,  false, false,       false, false, NULL),
    (ddltest.sid(p_wf, 'UNDER_REVIEW'),     p_tenant, p_wf, 'UNDER_REVIEW',     'En étude',             'UNDER_REVIEW',     3, false, false, false, false, false, false,       false, false, NULL),
    (ddltest.sid(p_wf, 'MISSING_DOCUMENT'), p_tenant, p_wf, 'MISSING_DOCUMENT', 'Pièces manquantes',    'MISSING_DOCUMENT', 4, false, false, false, false, false, false,       false, false, NULL),
    (ddltest.sid(p_wf, 'ACCEPTED'),         p_tenant, p_wf, 'ACCEPTED',         'Admis',                'ACCEPTED',         5, false, false, true,  false, true,  p_interview, true,  false, NULL),
    (ddltest.sid(p_wf, 'AWAITING_PAYMENT'), p_tenant, p_wf, 'AWAITING_PAYMENT', 'En attente de paiement','ACCEPTED',        6, false, false, true,  false, false, false,       false, true,  NULL),
    (ddltest.sid(p_wf, 'WAITLISTED'),       p_tenant, p_wf, 'WAITLISTED',       'Liste d''attente',     'WAITLISTED',       7, false, false, false, false, false, false,       true,  false, NULL),
    (ddltest.sid(p_wf, 'REJECTED'),         p_tenant, p_wf, 'REJECTED',         'Refusée',              'REJECTED',         8, false, true,  false, false, false, false,       true,  false, 'REJECTED_BY_SCHOOL'),
    (ddltest.sid(p_wf, 'WITHDRAWN'),        p_tenant, p_wf, 'WITHDRAWN',        'Retirée par la famille','REJECTED',        9, false, true,  false, false, false, false,       true,  false, 'WITHDRAWN_BY_FAMILY'),
    (ddltest.sid(p_wf, 'ENROLLED'),         p_tenant, p_wf, 'ENROLLED',         'Inscrit',              'ENROLLED',        10, false, true,  true,  false, false, false,       false, false, NULL);
  INSERT INTO admissions.workflow_transitions (id, tenant_id, workflow_id, from_stage_id, to_stage_id, permission_key)
  SELECT gen_random_uuid(), p_tenant, p_wf, ddltest.sid(p_wf, f), ddltest.sid(p_wf, t), perm
    FROM (VALUES
      ('DRAFT', 'SUBMITTED', 'admission.submit'),
      ('SUBMITTED', 'UNDER_REVIEW', 'admission.review'),
      ('UNDER_REVIEW', 'MISSING_DOCUMENT', 'admission.review'),
      ('MISSING_DOCUMENT', 'UNDER_REVIEW', 'admission.review'),
      ('UNDER_REVIEW', 'ACCEPTED', 'admission.decide'),
      ('UNDER_REVIEW', 'WAITLISTED', 'admission.decide'),
      ('UNDER_REVIEW', 'REJECTED', 'admission.decide'),
      ('WAITLISTED', 'ACCEPTED', 'admission.decide'),
      ('WAITLISTED', 'REJECTED', 'admission.decide'),
      ('ACCEPTED', 'AWAITING_PAYMENT', 'admission.enroll'),
      ('ACCEPTED', 'WITHDRAWN', 'admission.decide'),
      ('AWAITING_PAYMENT', 'ENROLLED', 'admission.enroll'),
      ('AWAITING_PAYMENT', 'WITHDRAWN', 'admission.decide')) AS x(f, t, perm);
END $$;

-- Décision formelle (insérée AVANT le changement d'étape, dans la même transaction).
CREATE OR REPLACE FUNCTION ddltest.decide(p_app uuid, p_kind text, p_to_code text, p_reason_code text DEFAULT NULL,
                                          p_text text DEFAULT NULL, p_override boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE a admissions.applications%ROWTYPE;
BEGIN
  SELECT * INTO a FROM admissions.applications WHERE id = p_app;
  INSERT INTO admissions.decisions (id, tenant_id, application_id, kind, from_stage_id, to_stage_id, reason_code, reason_text,
                                    override_capacity, decided_by, decided_by_name)
  VALUES (gen_random_uuid(), a.tenant_id, a.id, p_kind, a.stage_id, ddltest.sid(a.workflow_id, p_to_code), p_reason_code, p_text,
          p_override, gen_random_uuid(), 'Directrice des admissions (test)');
END $$;

-- Passage d'étape sans élément supplémentaire.
CREATE OR REPLACE FUNCTION ddltest.move(p_app uuid, p_to_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE admissions.applications SET stage_id = ddltest.sid(workflow_id, p_to_code) WHERE id = p_app;
END $$;

-- Candidature minimale à l'étape initiale.
CREATE OR REPLACE FUNCTION ddltest.new_application(p_id uuid, p_tenant uuid, p_inst uuid, p_campaign uuid, p_wf uuid,
                                                   p_number text, p_first text, p_last text, p_birth date,
                                                   p_grade text DEFAULT 'CP1') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO admissions.applications (id, tenant_id, institution_id, campaign_id, workflow_id, stage_id, application_number,
                                       created_via, applicant_first_name, applicant_last_name, applicant_birth_date, desired_grade_level_code)
  VALUES (p_id, p_tenant, p_inst, p_campaign, p_wf, ddltest.sid(p_wf, 'DRAFT'), p_number, 'STAFF', p_first, p_last, p_birth, p_grade);
END $$;
