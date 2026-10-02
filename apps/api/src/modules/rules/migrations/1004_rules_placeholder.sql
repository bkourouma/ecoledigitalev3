-- =============================================================================
-- 1004 — Module rules : jeux FICTIFS (`source_kind = 'placeholder'`) et accusé de liaison
-- =============================================================================
--
-- Phase 4-5 (specs 005, 006 et 018) : un jeu de règles de DÉMONSTRATION (mécanisme seulement, aucune valeur officielle)
-- est distingué d'un portage fidèle du legacy (`platform`), d'une règle d'établissement (`institution`) et d'un texte
-- officiel (`regulation`). Conséquences :
--   - la valeur `placeholder` est admise pour les versions nationales ET les variantes d'établissement ;
--   - une version `regulation` cite OBLIGATOIREMENT son texte (`source_reference`) — contrainte NOT VALID : elle protège
--     toute nouvelle ligne sans réécrire l'historique ;
--   - une liaison d'un jeu fictif en production exige un ACCUSÉ explicite et tracé (qui, quand, pourquoi). L'application le
--     refuse sans accusé (`rules.placeholder_requires_ack`) ; la base garantit que l'accusé est complet.
-- Aucune donnée n'est supprimée ni modifiée.
-- =============================================================================

ALTER TABLE rules.national_rule_versions DROP CONSTRAINT IF EXISTS national_rule_versions_source_kind_check;
ALTER TABLE rules.national_rule_versions ADD CONSTRAINT national_rule_versions_source_kind_check
  CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder'));
ALTER TABLE rules.national_rule_versions ADD CONSTRAINT national_rule_versions_regulation_ref_ck
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0) NOT VALID;

ALTER TABLE rules.rule_versions DROP CONSTRAINT IF EXISTS rule_versions_source_kind_check;
ALTER TABLE rules.rule_versions ADD CONSTRAINT rule_versions_source_kind_check
  CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder'));
ALTER TABLE rules.rule_versions ADD CONSTRAINT rule_versions_regulation_ref_ck
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0) NOT VALID;

-- Accusé de liaison d'un jeu fictif (production) : posé à la création/mise à jour de la liaison.
ALTER TABLE rules.rule_bindings
  ADD COLUMN placeholder_ack_by     uuid,
  ADD COLUMN placeholder_ack_at     timestamptz,
  ADD COLUMN placeholder_ack_reason text,
  ADD CONSTRAINT rule_bindings_placeholder_ack_ck CHECK (
    (placeholder_ack_by IS NULL AND placeholder_ack_at IS NULL AND placeholder_ack_reason IS NULL)
    OR (placeholder_ack_by IS NOT NULL AND placeholder_ack_at IS NOT NULL AND length(btrim(coalesce(placeholder_ack_reason, ''))) >= 10)
  );
