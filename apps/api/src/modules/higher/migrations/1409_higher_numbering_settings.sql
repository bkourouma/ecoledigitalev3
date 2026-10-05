-- =============================================================================
-- 1409 — Module higher : numérotation LIBRE par établissement (Q-24)
-- =============================================================================
-- Décision du propriétaire : le format des références de diplômes / attestations est choisi par chaque établissement
-- (préfixe, année, séquence) ; la garantie « sans trou » devient un RÉGLAGE, activé par défaut pour les trois natures déjà
-- livrées (DIPLOMA, AUTHENTICITY, ATTESTATION) afin de ne rien régresser. Additif : sans ligne de réglage, le motif
-- historique (DIP-AAAA-NNNNNN, AUTH/AAAA/NNN, ATT-AAAA-NNNNNN) et la garantie sans trou s'appliquent.
--
-- Ce qui reste garanti PAR CONTRAINTE, quel que soit le motif : aucun doublon (UNIQUE (tenant, référence) sur les octrois,
-- UNIQUE (tenant, nature, référence) sur les documents, UNIQUE (tenant, année, séquence) sur les octrois), un compteur ne
-- recule jamais, une référence émise ne change jamais (1408).
--
-- Année de compteur 0 = séquence CONTINUE (motif sans année) : elle ne repart pas à 1 chaque janvier.

CREATE TABLE higher.numbering_settings (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  counter_key  text NOT NULL CHECK (counter_key IN ('DIPLOMA', 'AUTHENTICITY', 'ATTESTATION')),
  -- jalons {YYYY} | {YY} | {SEQ} | {SEQ:n} + texte fixe (validés par l'application ; ici, un filet minimal)
  pattern      text NOT NULL CHECK (length(pattern) BETWEEN 3 AND 60 AND pattern LIKE '%{SEQ%}%' AND pattern ~ '^[A-Za-z0-9._/#{}:-]+$'),
  -- TRUE : numérotation consécutive sans saut (aucun saut de compteur admis). FALSE : l'établissement peut avancer le
  -- compteur (reprise d'un registre papier, numéros réservés) ; les trous ainsi créés sont voulus et audités.
  gapless      boolean NOT NULL DEFAULT true,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, counter_key)
);
SELECT kernel.enable_tenant_rls('higher.numbering_settings');
GRANT SELECT, INSERT, UPDATE ON higher.numbering_settings TO app_user;

-- Les références ne sont plus limitées aux formats historiques.
ALTER TABLE higher.diploma_awards DROP CONSTRAINT diploma_awards_reference_check;
ALTER TABLE higher.diploma_awards ADD CONSTRAINT diploma_awards_reference_check CHECK (length(btrim(reference)) BETWEEN 1 AND 100);
ALTER TABLE higher.official_documents ADD CONSTRAINT official_documents_reference_check CHECK (length(btrim(reference)) BETWEEN 1 AND 110);

-- Année 0 = séquence continue.
ALTER TABLE higher.number_counters DROP CONSTRAINT number_counters_year_check;
ALTER TABLE higher.number_counters ADD CONSTRAINT number_counters_year_check CHECK (year = 0 OR year BETWEEN 2000 AND 2200);

-- Garde du compteur : ne recule jamais, avance de 1 ; un SAUT n'est admis que si l'établissement a désactivé la garantie
-- « sans trou » pour cette nature (réglage ci-dessus, lu sous RLS du même tenant). Jamais de DELETE.
CREATE OR REPLACE FUNCTION higher.number_counters_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_relaxed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'higher.immutable: number_counters ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT NOT s.gapless INTO v_relaxed FROM higher.numbering_settings s WHERE s.tenant_id = NEW.tenant_id AND s.counter_key = NEW.counter_key;
  v_relaxed := coalesce(v_relaxed, false);
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_value > 1 AND NOT v_relaxed THEN
      RAISE EXCEPTION 'higher.counter_monotonic: un compteur démarre à 1 (numérotation sans trou)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.counter_key <> OLD.counter_key OR NEW.year <> OLD.year THEN
    RAISE EXCEPTION 'higher.counter_monotonic: l''identité d''un compteur ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.last_value <= OLD.last_value OR (NEW.last_value <> OLD.last_value + 1 AND NOT v_relaxed) THEN
    RAISE EXCEPTION 'higher.counter_monotonic: un compteur n''avance que de 1 (% -> %), sauf numérotation sans garantie « sans trou »', OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER number_counters_guard ON higher.number_counters;
CREATE TRIGGER number_counters_guard BEFORE INSERT OR UPDATE OR DELETE ON higher.number_counters
  FOR EACH ROW EXECUTE FUNCTION higher.number_counters_guard();
