-- =============================================================================
-- 1205 — Module results : retrait tracé d'une décision ou d'une distinction de conseil
-- =============================================================================
--
-- ADDITIVE. Le statut `WITHDRAWN` existe depuis 1202 (réouverture de période : les décisions confirmées sont retirées en
-- masse). Un retrait UNITAIRE, demandé par un conseil, doit en plus dire QUI, QUAND et POURQUOI, et laisser la référence
-- OPAQUE de l'acte source. Les lignes déjà retirées par une réouverture gardent ces colonnes vides (cause = réouverture).
-- Les gardes existantes restent valables : une décision PUBLIÉE ou une période CLÔTURÉE ne change plus (déclencheur
-- `decisions_guard`), un retrait est définitif (`WITHDRAWN` ne change plus).
-- =============================================================================

ALTER TABLE results.decisions
  ADD COLUMN withdrawn_at        timestamptz,
  ADD COLUMN withdrawn_by        uuid,
  ADD COLUMN withdrawn_by_name   text,
  ADD COLUMN withdrawal_reason   text CHECK (withdrawal_reason IS NULL OR length(btrim(withdrawal_reason)) >= 10),
  ADD COLUMN withdrawal_ref      text CHECK (withdrawal_ref IS NULL OR length(withdrawal_ref) BETWEEN 1 AND 100),
  ADD CONSTRAINT decisions_withdrawal_ck CHECK (
    (withdrawn_by IS NULL AND withdrawal_reason IS NULL) OR (status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL)
  );
