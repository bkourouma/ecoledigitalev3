-- =============================================================================
-- 0706 — Module academic : faits exigés par results (011) et higher (019) — extension ADDITIVE
-- =============================================================================
--
-- Les modules `results` et `higher` déclarent des ports (`CurriculumPort`, `CurriculumPort` de higher) que seul
-- `academic` peut servir (specs/v2/011-assessments-grades/interfaces-publiees.md §5.1). Cette migration ajoute les
-- attributs manquants, sans toucher aux fichiers précédents (checksums inchangés) et avec des valeurs par défaut qui
-- conservent le comportement actuel :
--
--   curriculum_nodes.grading_mode        COMPOSED (moyenne des évaluations) | DIRECT (note saisie directement, ex. conduite)
--   curriculum_nodes.resit_allowed       le nœud accepte une session 2 (rattrapage) — le défaut est « non »
--   curriculum_nodes.counts_in_average   le nœud compte dans la moyenne (une matière « pour information » : false)
--   curriculum_nodes.section_key         section du bulletin / type de bilan (regroupement de matières), sans lecture de libellé
--   programs.is_cycle                    le programme est un CYCLE conduisant à un diplôme (Licence — Génie logiciel : niveaux 1 à 3)
--                                        = « nœud de cycle » de higher (remplace la reconstitution par expression régulière sur le nom)
--   programs.calculation_contract        contrat de calcul des résultats du programme (`credit-semester@1`, `coef-semester@1`…)
--   education_levels.calculation_contract contrat PAR DÉFAUT des programmes du cycle d'enseignement (modèle de pack)
--   grade_levels.terminal_exam_required  le niveau se conclut par un examen terminal (donnée, plus un nom de classe)
--
-- Aucune valeur n'est devinée : un programme sans contrat (et sans contrat de cycle d'enseignement) n'a pas de structure
-- de calcul (`results` échoue fermé).
-- =============================================================================

ALTER TABLE academic.curriculum_nodes
  ADD COLUMN grading_mode text NOT NULL DEFAULT 'COMPOSED' CHECK (grading_mode IN ('COMPOSED', 'DIRECT')),
  ADD COLUMN resit_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN counts_in_average boolean NOT NULL DEFAULT true,
  ADD COLUMN section_key text CHECK (section_key IS NULL OR section_key ~ '^[A-Z][A-Z0-9_]{0,39}$');

ALTER TABLE academic.programs
  ADD COLUMN is_cycle boolean NOT NULL DEFAULT false,
  ADD COLUMN calculation_contract text CHECK (calculation_contract IS NULL OR calculation_contract ~ '^[a-z][a-z0-9-]{0,39}@[0-9]{1,3}$');

ALTER TABLE academic.education_levels
  ADD COLUMN calculation_contract text CHECK (calculation_contract IS NULL OR calculation_contract ~ '^[a-z][a-z0-9-]{0,39}@[0-9]{1,3}$');

ALTER TABLE academic.grade_levels
  ADD COLUMN terminal_exam_required boolean NOT NULL DEFAULT false;

-- Liste des cycles d'un établissement (higher : `listCycleEnrollments`).
CREATE INDEX programs_cycles ON academic.programs (tenant_id, institution_id) WHERE is_cycle;
