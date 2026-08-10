-- 0089_authenticite_reference.sql
-- Numéro de référence de l'attestation d'authenticité (diplômes), persistant
-- et séquentiel : AUTH/{année}/{NNN}.
--
-- Jusqu'ici ce numéro n'était pas stocké : il était recalculé côté client à
-- partir de la fin du matricule / de la référence du diplôme (non
-- séquentiel, non garanti unique — cf. `authenticiteReference()` dans
-- diplome-format.ts, désormais retirée). On le fige à la première
-- génération sur `student_professional_diplomas` (1 ligne par octroi de
-- diplôme) : régénérer le PDF pour le même étudiant renvoie toujours le même
-- numéro.
--
-- Le compteur est scopé par tenant + année de GÉNÉRATION (pas l'année
-- d'obtention du diplôme, qui peut différer). Pour reprendre le décompte
-- après des numéros déjà remis à des étudiants avant la mise en place de ce
-- compteur, le nombre de diplômes déjà `obtenu` (tous cycles/années
-- confondus) sert de base : pas de réglage manuel, le compteur suit
-- simplement les octrois déjà enregistrés (cf. professional-diplomas.service.ts).
--
-- Additif et idempotent.

ALTER TABLE student_professional_diplomas
    ADD COLUMN IF NOT EXISTS authenticite_reference TEXT,
    ADD COLUMN IF NOT EXISTS authenticite_numero INTEGER,
    ADD COLUMN IF NOT EXISTS authenticite_annee INTEGER;

-- Un seul numéro par (tenant, année) : empêche toute collision, y compris en
-- cas de génération concurrente (retry applicatif sur violation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_diplomas_authenticite_numero
    ON student_professional_diplomas (tenant_id, authenticite_annee, authenticite_numero)
    WHERE authenticite_reference IS NOT NULL;

-- Fin de la migration 0089_authenticite_reference.sql
