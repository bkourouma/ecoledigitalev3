-- =============================================================================
-- 1305 — Module reportcards : natures de documents des packs (Phase 4-5)
-- =============================================================================
--
-- Nouvelles natures rendues par le service générique des documents officiels (`official_documents`), signées, inscrites dans
-- l'index de vérification publique et rendues par un gabarit de plateforme :
--   COUNCIL_MINUTES            procès-verbal de conseil (conseil de classe 006, conseil des maîtres 005) ;
--   ANNUAL_REVIEW              bilan annuel du primaire (005) ;
--   EXAM_CONVOCATION           convocation à un examen (018) ;
--   EXAM_SUCCESS_CERTIFICATE   attestation de réussite à un examen (018) ;
--   EXAM_TRANSCRIPT            relevé de notes d'examen (018).
-- Seules les listes de valeurs admises changent ; aucune donnée n'est modifiée. Les bulletins (`report_cards`) restent limités à
-- REPORT_CARD et TRANSCRIPT.
-- =============================================================================

ALTER TABLE reportcards.verification_index DROP CONSTRAINT verification_index_document_kind_check;
ALTER TABLE reportcards.verification_index ADD CONSTRAINT verification_index_document_kind_check
  CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP', 'RECEIPT',
                           'COUNCIL_MINUTES', 'ANNUAL_REVIEW', 'EXAM_CONVOCATION', 'EXAM_SUCCESS_CERTIFICATE', 'EXAM_TRANSCRIPT'));

ALTER TABLE reportcards.platform_templates DROP CONSTRAINT platform_templates_document_kind_check;
ALTER TABLE reportcards.platform_templates ADD CONSTRAINT platform_templates_document_kind_check
  CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT', 'DIPLOMA', 'ATTESTATION_SUCCESS', 'ATTESTATION_AUTHENTICITY', 'PAYSLIP', 'RECEIPT',
                           'COUNCIL_MINUTES', 'ANNUAL_REVIEW', 'EXAM_CONVOCATION', 'EXAM_SUCCESS_CERTIFICATE', 'EXAM_TRANSCRIPT'));

ALTER TABLE reportcards.official_documents DROP CONSTRAINT official_documents_document_kind_check;
ALTER TABLE reportcards.official_documents ADD CONSTRAINT official_documents_document_kind_check
  CHECK (document_kind IN ('RECEIPT', 'PAYSLIP', 'COUNCIL_MINUTES', 'ANNUAL_REVIEW', 'EXAM_CONVOCATION', 'EXAM_SUCCESS_CERTIFICATE', 'EXAM_TRANSCRIPT'));
