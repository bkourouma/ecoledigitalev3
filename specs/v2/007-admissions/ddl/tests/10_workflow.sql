-- Workflow personnalisable : validation à la publication, immuabilité, campagnes, capacités, lien public, paramètres, RLS.
\set G '''a1000000-0000-4000-8000-0000000000a1'''
\set H '''a1000000-0000-4000-8000-0000000000b1'''
SELECT ddltest.make_tenant(:G::uuid, 'adm-a');
SELECT ddltest.make_tenant(:H::uuid, 'adm-b');

DO $$
DECLARE
  G constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
  INST constant uuid := 'a1100000-0000-4000-8000-000000000001';
  W0 constant uuid := 'a1200000-0000-4000-8000-000000000000';
  W1 constant uuid := 'a1200000-0000-4000-8000-000000000001';
  Wa constant uuid := 'a1200000-0000-4000-8000-0000000000a1';
  Wb constant uuid := 'a1200000-0000-4000-8000-0000000000a2';
  Wc constant uuid := 'a1200000-0000-4000-8000-0000000000a3';
  Wd constant uuid := 'a1200000-0000-4000-8000-0000000000a4';
  We constant uuid := 'a1200000-0000-4000-8000-0000000000a5';
BEGIN
  PERFORM ddltest.as_tenant(G);

  -- workflow vide : refus (pas d'étape initiale)
  INSERT INTO admissions.workflows (id, tenant_id, institution_id, code, label) VALUES (W0, G, INST, 'VIDE', 'Vide');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, W0), 'workflow_initial', 'publier un workflow sans étape initiale est refusé');

  -- contraintes de forme d'une étape
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'X', 'x', 'DRAFT', 1)$q$, G, W0), 'check', 'un statut DRAFT est forcément l''étape initiale');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, is_terminal)
     VALUES (gen_random_uuid(), %L, %L, 'REF', 'x', 'REJECTED', 2, true)$q$, G, W0), 'check', 'un refus terminal précise son motif de clôture');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'ENR', 'x', 'ENROLLED', 3)$q$, G, W0), 'check', 'ENROLLED est terminal');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, holds_seat)
     VALUES (gen_random_uuid(), %L, %L, 'H', 'x', 'REJECTED', 4, true)$q$, G, W0), 'check', 'une étape de refus ne réserve pas de place');
  INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, is_initial)
    VALUES (gen_random_uuid(), G, W0, 'D1', 'x', 'DRAFT', 1, true);
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, is_initial)
     VALUES (gen_random_uuid(), %L, %L, 'D2', 'x', 'DRAFT', 2, true)$q$, G, W0), '23505', 'une seule étape initiale');

  -- variantes cassées (chacune sur son propre workflow brouillon)
  PERFORM ddltest.standard_workflow(G, INST, Wa, 'VAR_A');   -- ENROLLED inatteignable
  DELETE FROM admissions.workflow_transitions WHERE workflow_id = Wa AND to_stage_id = ddltest.sid(Wa, 'ENROLLED');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, Wa), 'workflow_unreachable', 'ENROLLED inatteignable : refusé');

  PERFORM ddltest.standard_workflow(G, INST, Wb, 'VAR_B');   -- sortie d'une étape terminale
  INSERT INTO admissions.workflow_transitions (id, tenant_id, workflow_id, from_stage_id, to_stage_id, permission_key)
    VALUES (gen_random_uuid(), G, Wb, ddltest.sid(Wb, 'ENROLLED'), ddltest.sid(Wb, 'UNDER_REVIEW'), 'admission.review');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, Wb), 'workflow_terminal_exit', 'sortie d''une étape terminale : refusé');

  PERFORM ddltest.standard_workflow(G, INST, Wc, 'VAR_C');   -- étape sans issue
  DELETE FROM admissions.workflow_transitions WHERE workflow_id = Wc AND from_stage_id = ddltest.sid(Wc, 'MISSING_DOCUMENT');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, Wc), 'workflow_dead_end', 'étape sans issue : refusé');

  PERFORM ddltest.standard_workflow(G, INST, Wd, 'VAR_D');   -- l'inscription n'est pas créée
  UPDATE admissions.workflow_stages SET creates_enrollment = false WHERE workflow_id = Wd;
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, Wd), 'workflow_creates_enrollment', 'aucune étape ne crée l''inscription : refusé');

  PERFORM ddltest.standard_workflow(G, INST, We, 'VAR_E');   -- aucune décision formelle exigée pour REJECTED
  UPDATE admissions.workflow_stages SET requires_decision = false WHERE workflow_id = We AND canonical_status = 'REJECTED';
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, We), 'workflow_decision_missing', 'aucune décision formelle pour REJECTED : refusé');

  -- ENROLLED atteint ailleurs que par l'étape qui crée l'inscription
  INSERT INTO admissions.workflow_transitions (id, tenant_id, workflow_id, from_stage_id, to_stage_id, permission_key)
    VALUES (gen_random_uuid(), G, Wd, ddltest.sid(Wd, 'ACCEPTED'), ddltest.sid(Wd, 'ENROLLED'), 'admission.enroll');
  UPDATE admissions.workflow_stages SET creates_enrollment = true WHERE id = ddltest.sid(Wd, 'AWAITING_PAYMENT');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id=%L$q$, Wd), 'workflow_enrolled_entry', 'ENROLLED hors de l''étape de création : refusé');

  -- workflow standard : publication
  PERFORM ddltest.standard_workflow(G, INST, W1, 'STANDARD');
  PERFORM ddltest.runs(format($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now(), published_by=gen_random_uuid() WHERE id=%L$q$, W1), 'publication du workflow standard');

  -- publié : figé
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal)
     VALUES (gen_random_uuid(), %L, %L, 'NEW1', 'x', 'UNDER_REVIEW', 99)$q$, G, W1), 'workflow_published_immutable', 'ajout d''une étape à un workflow publié refusé');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflow_stages SET holds_seat = true WHERE id = ddltest.sid(%L, 'UNDER_REVIEW')$q$, W1), 'workflow_published_immutable', 'modification d''une étape publiée refusée');
  PERFORM ddltest.throws(format($q$DELETE FROM admissions.workflow_transitions WHERE workflow_id = %L$q$, W1), 'workflow_published_immutable', 'suppression d''une transition publiée refusée');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET label='Autre' WHERE id=%L$q$, W1), 'workflow_published_immutable', 'modification du libellé d''un workflow publié refusée');
  PERFORM ddltest.throws(format($q$DELETE FROM admissions.workflows WHERE id=%L$q$, W1), 'workflow_delete_forbidden', 'suppression d''un workflow publié refusée');
  PERFORM ddltest.throws(format($q$UPDATE admissions.workflows SET status='DRAFT', published_at=NULL WHERE id=%L$q$, W1), 'workflow_transition', 'retour au brouillon interdit');
  PERFORM ddltest.runs(format($q$DELETE FROM admissions.workflow_transitions WHERE workflow_id = %L$q$, Wa), 'la structure d''un brouillon se modifie librement');

  -- un seul workflow publié par établissement et cycle
  PERFORM ddltest.standard_workflow(G, INST, 'a1200000-0000-4000-8000-0000000000b1', 'STANDARD_BIS');
  PERFORM ddltest.throws($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id='a1200000-0000-4000-8000-0000000000b1'$q$, '23505', 'un seul workflow publié par établissement et par cycle');
  PERFORM ddltest.standard_workflow(G, INST, 'a1200000-0000-4000-8000-0000000000b2', 'STANDARD_PRIMARY', 'PRIMARY');
  PERFORM ddltest.runs($q$UPDATE admissions.workflows SET status='PUBLISHED', published_at=now() WHERE id='a1200000-0000-4000-8000-0000000000b2'$q$, 'un workflow propre à un cycle cohabite avec le workflow général');
END $$;

-- Campagnes et capacités
DO $$
DECLARE
  G constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
  INST constant uuid := 'a1100000-0000-4000-8000-000000000001';
  W1 constant uuid := 'a1200000-0000-4000-8000-000000000001';
  Wdraft constant uuid := 'a1200000-0000-4000-8000-0000000000b1';
  YR constant uuid := 'a1300000-0000-4000-8000-000000000001';
BEGIN
  PERFORM ddltest.as_tenant(G);
  INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at)
  VALUES ('a1400000-0000-4000-8000-000000000001', G, INST, YR, 'RENTREE', 'Rentrée', W1, now() - interval '1 day', now() + interval '60 days'),
         ('a1400000-0000-4000-8000-000000000002', G, INST, YR, 'AVEC_BROUILLON', 'Brouillon', Wdraft, now(), now() + interval '30 days');
  PERFORM ddltest.throws($q$UPDATE admissions.campaigns SET status='OPEN' WHERE id='a1400000-0000-4000-8000-000000000002'$q$, 'campaign_workflow_not_published', 'ouvrir une campagne avec un workflow non publié est refusé');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at)
     VALUES (gen_random_uuid(), %L, %L, %L, 'BAD', 'x', %L, now(), now() - interval '1 day')$q$, G, INST, YR, W1), 'check', 'la clôture suit l''ouverture');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at)
     VALUES (gen_random_uuid(), %L, 'a1100000-0000-4000-8000-0000000000ff', %L, 'AUTRE', 'x', %L, now(), now() + interval '1 day')$q$, G, YR, W1),
     'campaign_workflow_institution', 'le workflow d''une campagne est celui de son établissement');
  PERFORM ddltest.runs($q$UPDATE admissions.campaigns SET status='OPEN' WHERE id='a1400000-0000-4000-8000-000000000001'$q$, 'ouverture de la campagne');
  PERFORM ddltest.throws($q$UPDATE admissions.campaigns SET workflow_id='a1200000-0000-4000-8000-0000000000b2' WHERE id='a1400000-0000-4000-8000-000000000001'$q$, 'campaign_workflow_frozen', 'le workflow d''une campagne ouverte est figé');
  PERFORM ddltest.throws($q$UPDATE admissions.campaigns SET status='ARCHIVED' WHERE id='a1400000-0000-4000-8000-000000000001'$q$, 'campaign_transition', 'OPEN -> ARCHIVED interdit');

  INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, seats)
  VALUES (gen_random_uuid(), G, 'a1400000-0000-4000-8000-000000000001', 'CP1', 30);
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, seats)
     VALUES (gen_random_uuid(), %L, 'a1400000-0000-4000-8000-000000000001', 'CP1', 25)$q$, G), '23505', 'une seule capacité par niveau et campagne');
  PERFORM ddltest.runs(format($q$INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, seats, program_id)
     VALUES (gen_random_uuid(), %L, 'a1400000-0000-4000-8000-000000000001', 'CP1', 10, gen_random_uuid())$q$, G), 'une capacité par programme cohabite avec la capacité du niveau');
END $$;

-- Paramètres
DO $$
DECLARE G constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
BEGIN
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.settings (tenant_id, institution_id, public_form_enabled, consent_required)
    VALUES (%L, gen_random_uuid(), true, true)$q$, G), 'check', 'formulaire public + consentement exigé : la version du texte est obligatoire');
  PERFORM ddltest.runs(format($q$INSERT INTO admissions.settings (tenant_id, institution_id, public_form_enabled, consent_required, consent_text_version)
    VALUES (%L, 'a1100000-0000-4000-8000-000000000001', true, true, 'v1')$q$, G), 'paramètres avec version du texte de consentement');
  PERFORM ddltest.throws(format($q$INSERT INTO admissions.settings (tenant_id, institution_id, capacity_policy)
    VALUES (%L, gen_random_uuid(), 'MAYBE')$q$, G), 'check', 'politique de capacité inconnue refusée');
  PERFORM ddltest.ok(admissions.normalize_name('  Éloïse-Marie  N''Guessan ') = 'eloise marie n guessan', 'normalisation de nom : accents, ponctuation, espaces');
END $$;

-- Lien public : lecture ouverte, écriture limitée au tenant courant ; isolation des tables de tenant
SET ROLE app_user;
SELECT ddltest.as_tenant('a1000000-0000-4000-8000-0000000000a1');
INSERT INTO admissions.public_form_index (slug, tenant_id, institution_id) VALUES ('k3x9q2m7v5b1n8c4d6f0', 'a1000000-0000-4000-8000-0000000000a1', 'a1100000-0000-4000-8000-000000000001');
SELECT ddltest.as_tenant('a1000000-0000-4000-8000-0000000000b1');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.public_form_index WHERE slug = 'k3x9q2m7v5b1n8c4d6f0') = 1, 'résolution de lien : tout appelant lit l''index (jeton opaque, aucune donnée personnelle)');
  PERFORM ddltest.throws($q$INSERT INTO admissions.public_form_index (slug, tenant_id, institution_id)
     VALUES ('z9z9z9z9z9z9z9z9z9z9', 'a1000000-0000-4000-8000-0000000000a1', gen_random_uuid())$q$, '42501', 'un tenant ne publie pas un lien au nom d''un autre');
  PERFORM ddltest.runs($q$UPDATE admissions.public_form_index SET enabled = false WHERE slug = 'k3x9q2m7v5b1n8c4d6f0'$q$, 'UPDATE du lien d''un autre : exécuté mais sans effet');
  PERFORM ddltest.throws($q$INSERT INTO admissions.public_form_index (slug, tenant_id, institution_id)
     VALUES ('court', 'a1000000-0000-4000-8000-0000000000b1', gen_random_uuid())$q$, 'check', 'slug trop court (énumérable) refusé');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.workflows) = 0, 'RLS : le tenant H ne voit aucun workflow de G');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.campaigns) = 0, 'RLS : le tenant H ne voit aucune campagne de G');
  PERFORM ddltest.ok((SELECT count(*) FROM admissions.settings) = 0, 'RLS : le tenant H ne voit aucun paramétrage de G');
  PERFORM ddltest.throws($q$INSERT INTO admissions.workflows (id, tenant_id, institution_id, code, label)
     VALUES (gen_random_uuid(), 'a1000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'INTRUS', 'x')$q$, '42501', 'RLS : workflow écrit pour un autre tenant refusé');
  -- clé étrangère composite : une campagne de H ne peut pas viser un workflow de G
  PERFORM ddltest.throws($q$INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at)
     VALUES (gen_random_uuid(), 'a1000000-0000-4000-8000-0000000000b1', gen_random_uuid(), gen_random_uuid(), 'X', 'x',
             'a1200000-0000-4000-8000-000000000001', now(), now() + interval '1 day')$q$, '23503', 'FK composite : workflow d''un autre tenant refusé');
END $$;
SELECT ddltest.as_tenant('a1000000-0000-4000-8000-0000000000a1');
DO $$
BEGIN
  PERFORM ddltest.ok((SELECT enabled FROM admissions.public_form_index WHERE slug = 'k3x9q2m7v5b1n8c4d6f0'), 'le lien de G est resté actif');
END $$;
RESET ROLE;
