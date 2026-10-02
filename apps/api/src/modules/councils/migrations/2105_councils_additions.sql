-- =============================================================================
-- 2105 — Module councils : compléments posés par l'implémentation
-- =============================================================================
--
-- Statut d'élève visé par une décision d'EXCLUSION : l'effet `STUDENT_STATUS_REQUEST` demande à `people` de passer l'élève à
-- `SUSPENDED` ou `EXCLUDED`. C'est une DONNÉE du type de décision (aucun statut n'est supposé par le code) ; NULL pour toute
-- famille autre que l'exclusion. Le changement de statut lui-même reste un acte HUMAIN (jamais un job).
-- =============================================================================

ALTER TABLE councils.decision_types
  ADD COLUMN student_status text CHECK (student_status IS NULL OR student_status IN ('SUSPENDED', 'EXCLUDED'));
ALTER TABLE councils.decision_types
  ADD CONSTRAINT decision_types_student_status_family CHECK (student_status IS NULL OR family = 'EXCLUSION');
