-- =============================================================================
-- 0710 — Module academic : mode de confirmation d'une inscription (décision O-01)
-- =============================================================================
--
-- Une inscription est confirmée soit AUTOMATIQUEMENT (paiement des frais d'inscription, comportement historique),
-- soit MANUELLEMENT. Une confirmation manuelle qui DÉROGE à une politique liée au paiement est une dérogation :
-- elle exige une permission dédiée (`enrollment.confirm.override`) et un motif, conservés sur l'inscription, dans
-- l'historique (immuable) et dans l'audit.
--
--   confirmation_mode    NULL       inscription pas encore confirmée, ou confirmée avant cette migration (inconnu)
--                        'AUTO'     politique AUTO (active dès la création)
--                        'PAYMENT'  confirmée par le paiement (événement finance.invoice.paid)
--                        'MANUAL'   confirmée par une personne habilitée, sans dérogation (politique MANUAL)
--                        'OVERRIDE' confirmée par dérogation à une politique liée au paiement (motif obligatoire)
--
-- Migration ADDITIVE : aucune ligne existante n'est modifiée, aucune contrainte existante n'est affaiblie.
-- =============================================================================

ALTER TABLE academic.enrollments
  ADD COLUMN confirmation_mode   text CHECK (confirmation_mode IS NULL OR confirmation_mode IN ('AUTO', 'PAYMENT', 'MANUAL', 'OVERRIDE')),
  ADD COLUMN confirmation_reason text,
  ADD COLUMN confirmed_by        uuid;                      -- iam.users.id de la personne qui a confirmé (sans FK)

ALTER TABLE academic.enrollments
  ADD CONSTRAINT enrollments_override_needs_reason
  CHECK (confirmation_mode IS DISTINCT FROM 'OVERRIDE' OR (length(btrim(coalesce(confirmation_reason, ''))) >= 5 AND confirmed_by IS NOT NULL));
