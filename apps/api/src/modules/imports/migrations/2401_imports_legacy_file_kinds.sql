-- =============================================================================
-- 2401 — Module imports : formats .xls et .ods (O-11), lus par un convertisseur isolé
-- =============================================================================
-- Le type de fichier d'origine est conservé tel quel dans le travail d'import (`XLS`, `ODS`) ; les lignes sont
-- normalisées comme celles d'un .xlsx / .csv. Aucune autre colonne ne change.
-- =============================================================================

ALTER TABLE imports.jobs DROP CONSTRAINT IF EXISTS jobs_file_kind_check;
ALTER TABLE imports.jobs ADD CONSTRAINT jobs_file_kind_check CHECK (file_kind IN ('XLSX', 'CSV', 'XLS', 'ODS'));
