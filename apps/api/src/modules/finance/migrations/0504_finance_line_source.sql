-- =============================================================================
-- 0504 — Module finance : référence de source d'une ligne de facture (extension ADDITIVE)
-- =============================================================================
--
-- Le module `academic` confirme une sélection de cours à la carte quand SA ligne est soldée
-- (spec 004 §7.4b : « la ligne de facture issue d'une sélection à la carte porte `sourceRef =
-- enrollmentCourseId` »). `source_ref` est un UUID SANS clé étrangère (convention n° 1 : aucune FK vers le
-- schéma d'un autre module) ; NULL pour toute ligne qui ne vient pas d'un objet d'un autre module.
-- =============================================================================

ALTER TABLE finance.invoice_lines ADD COLUMN source_ref uuid;
CREATE INDEX invoice_lines_by_source_ref ON finance.invoice_lines (tenant_id, source_ref) WHERE source_ref IS NOT NULL;
