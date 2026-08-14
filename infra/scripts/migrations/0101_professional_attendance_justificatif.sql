-- 0101_professional_attendance_justificatif.sql
-- Pièce jointe (PDF) du motif de justification d'absence — module professionnel.
--
-- POURQUOI
-- 0100 a ajouté le motif, son auteur et sa date. Reste la pièce elle-même :
-- un certificat médical ou une convocation se PROUVE, elle ne se déclare pas.
-- Sans le document rattaché au pointage, le justificatif reste dans un
-- classeur du secrétariat et la justification n'est vérifiable par personne
-- au moment où le bulletin est édité.
--
-- CE QUE CETTE MIGRATION FAIT
-- Elle ajoute les métadonnées du fichier. Le fichier lui-même est stocké sur
-- disque comme les supports d'ECUE (`uploads/professional/justificatifs/…`),
-- la base ne conserve que son chemin, son nom d'origine, son type MIME et sa
-- taille — même modèle que `professional_ecue_materials`.
--
-- La contrainte de 0100 est remplacée pour couvrir aussi ces colonnes : un
-- justificatif ne peut subsister que sur un pointage 'excuse'. Le nettoyage
-- du fichier orphelin sur disque est fait par l'API quand le pointage change.
--
-- Additif et idempotent. Rollback : DROP des quatre colonnes (et la contrainte
-- revient à sa forme 0100).

BEGIN;

ALTER TABLE professional_ecue_attendance
    /** Chemin relatif du justificatif sur le stockage applicatif. */
    ADD COLUMN IF NOT EXISTS justificatif_path   TEXT,
    /** Nom d'origine du fichier, tel que déposé par l'administration. */
    ADD COLUMN IF NOT EXISTS justificatif_nom    TEXT,
    /** Type MIME (application/pdf attendu). */
    ADD COLUMN IF NOT EXISTS justificatif_mime   TEXT,
    /** Taille en octets, pour l'affichage et les quotas. */
    ADD COLUMN IF NOT EXISTS justificatif_taille BIGINT;

COMMENT ON COLUMN professional_ecue_attendance.justificatif_path IS
    'Chemin relatif du PDF justificatif (uploads/professional/justificatifs/...). NULL = aucune pièce jointe.';

-- La contrainte 0100 ne connaissait que le motif : on la remplace par une
-- version qui interdit aussi un justificatif accroché à un pointage qui n'est
-- pas une absence justifiée.
ALTER TABLE professional_ecue_attendance
    DROP CONSTRAINT IF EXISTS professional_ecue_attendance_justification_statut;

DO $$ BEGIN
    ALTER TABLE professional_ecue_attendance
        ADD CONSTRAINT professional_ecue_attendance_justification_statut
        CHECK (
            statut = 'excuse'
            OR (justification IS NULL AND justifie_par IS NULL AND justifie_le IS NULL
                AND justificatif_path IS NULL AND justificatif_nom IS NULL
                AND justificatif_mime IS NULL AND justificatif_taille IS NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
