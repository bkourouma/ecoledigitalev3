-- 0124 — Un canal « autre » pour la provenance des étudiants
--
-- Deux ajustements sur la liste ouverte en 0120 :
--
--   * `autre_media` s'appelle désormais « Radio / Télé / Journal » côté écran.
--     La valeur stockée ne bouge PAS : renommer la clé aurait cassé les lignes
--     déjà saisies pour un simple libellé, qui vit dans les contrats.
--
--   * `autre` est ajouté, pour ce qui n'entre dans aucune des cases. Il n'a de
--     sens qu'accompagné d'une précision : l'écran impose la saisie du détail,
--     conservé dans `media_detail` comme pour les autres canaux à préciser.
--
-- Idempotent : la contrainte est reposée telle quelle si elle existe déjà.

BEGIN;

ALTER TABLE student_provenances
    DROP CONSTRAINT IF EXISTS student_provenances_canal_check;

ALTER TABLE student_provenances
    ADD CONSTRAINT student_provenances_canal_check CHECK (
        canal IN (
            'google',
            'facebook',
            'autre_media',
            'commercial',
            'connaissance',
            'etudiant',
            'autre'
        )
    );

COMMIT;
