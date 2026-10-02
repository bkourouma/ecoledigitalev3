-- =============================================================================
-- 1204 — Module results : contrats par périodes pondérées / compétences et écriture par les conseils
-- =============================================================================
--
-- Phase 4-5 (specs 005, 006) :
--   - le code de proposition `COUNCIL_REVIEW` (« la règle ne tranche pas, le conseil décide ») est une issue valide d'un résultat ;
--   - une décision écrite par un CONSEIL (module councils / primary_school, via l'API publique de results) n'a pas de
--     proposition de règle : `origin = 'COUNCIL'`, `proposed_code` NULL. Elle n'exige pas de justification « d'écart » (il n'y a
--     rien à qui s'écarter) ; une décision issue d'une règle conserve la contrainte historique (R-RES-05) ;
--   - `council_ref` : référence OPAQUE (séance, décision du conseil) pour retrouver l'acte source ; jamais un nom ni un texte libre.
-- Aucune donnée existante n'est modifiée.
-- =============================================================================

DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'results.period_results'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%decision_outcome%'
  LOOP
    EXECUTE format('ALTER TABLE results.period_results DROP CONSTRAINT %I', c);
  END LOOP;
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'results.decisions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%justification%'
  LOOP
    EXECUTE format('ALTER TABLE results.decisions DROP CONSTRAINT %I', c);
  END LOOP;
END
$$;

ALTER TABLE results.period_results ADD CONSTRAINT period_results_decision_outcome_ck CHECK (
  decision_outcome IS NULL OR decision_outcome IN
    ('PROMOTED', 'REPEAT', 'PENDING', 'EXAM_REFERRAL', 'ADMITTED', 'RESIT', 'ADJOURNED', 'COUNCIL_REVIEW', 'OTHER'));

ALTER TABLE results.decisions
  ADD COLUMN origin      text NOT NULL DEFAULT 'RULE' CHECK (origin IN ('RULE', 'COUNCIL')),
  ADD COLUMN council_ref text CHECK (council_ref IS NULL OR length(council_ref) BETWEEN 1 AND 100);

-- R-RES-05 conservée pour les décisions issues d'une règle ; une décision de conseil sans proposition n'a pas d'écart à justifier,
-- et trancher une proposition `COUNCIL_REVIEW` (« la règle ne tranche pas ») n'est pas un écart.
ALTER TABLE results.decisions ADD CONSTRAINT decisions_final_justified_ck CHECK (
  final_code IS NULL OR proposed_code IS NULL OR final_code = proposed_code OR proposed_code = 'COUNCIL_REVIEW'
  OR length(btrim(coalesce(justification, ''))) >= 20);
-- Une décision d'origine « conseil » ne porte jamais de proposition de règle ; une décision de règle en porte toujours une.
ALTER TABLE results.decisions ADD CONSTRAINT decisions_origin_ck CHECK (
  (origin = 'COUNCIL' AND proposed_code IS NULL) OR (origin = 'RULE' AND proposed_code IS NOT NULL));
