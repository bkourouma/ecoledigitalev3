-- =============================================================================
-- 2007 — Module examinations : transmission du résultat et de la MOYENNE aux admissions (décision métier Q-E18)
-- =============================================================================
--
-- Décision : pour un examen qui conditionne l'admission en classe supérieure (CEPE -> 6e), le résultat transmis aux admissions contient
-- « admis / non admis » ET la MOYENNE (et non plus le résultat seul). Minimisation et restriction d'accès :
--
--   * la transmission est un paramètre PAR TYPE D'EXAMEN, désactivé par défaut (`transmits_to_admission`) : la moyenne ne part que
--     pour les types que l'établissement désigne ;
--   * elle ne concerne que les candidats-élèves d'une session OFFICIELLE (jamais un examen blanc, jamais un candidat libre sans dossier) ;
--   * la moyenne ne voyage que dans l'événement dédié `examinations.result.transmitted`, consommé par `admissions` seul (le résultat
--     publié `examinations.result.published` reste SANS note ni moyenne) ; aucun nom ni date de naissance n'y figure.
-- =============================================================================

ALTER TABLE examinations.exam_types ADD COLUMN transmits_to_admission boolean NOT NULL DEFAULT false;
