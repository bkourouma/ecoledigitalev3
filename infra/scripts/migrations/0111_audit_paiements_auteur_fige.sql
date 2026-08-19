-- =============================================================================
-- 0111 — Le journal d'audit fige l'identité de l'auteur
-- Feature: 031-remuneration-professionnelle
-- =============================================================================
--
-- POURQUOI
-- La 0110 a retiré la clé étrangère sur `changed_by` pour que le journal
-- survive à la suppression d'un compte. La trace survit désormais, mais elle ne
-- conserve qu'un UUID : une fois le compte parti, on sait QU'UN compte a agi,
-- plus LEQUEL. Un journal d'audit qui dépend d'une jointure pour rester lisible
-- devient illisible au moment précis où il compte le plus.
--
-- On fige donc le nom et le courriel AU MOMENT DE L'ACTION. C'est une
-- dénormalisation assumée : la valeur d'un audit tient à ce qu'il dise ce qui
-- était vrai alors, pas ce qui l'est aujourd'hui. Un utilisateur qui change de
-- nom ne réécrit pas l'histoire de ce qu'il a signé.
--
-- CE QUI CHANGE POUR LE DÉCLENCHEUR
-- `audit_teacher_payments()` est réécrite. Les trois branches partageaient un
-- INSERT quasi identique ; elles calculent maintenant leurs valeurs puis
-- écrivent une seule fois. Le comportement enregistré est INCHANGÉ — mêmes
-- actions, mêmes auteurs, mêmes payloads — seules s'ajoutent les deux colonnes.
--
-- Le déclencheur est AFTER : sa valeur de retour est ignorée par PostgreSQL.
-- =============================================================================

BEGIN;

ALTER TABLE payment_audit_log
    ADD COLUMN IF NOT EXISTS changed_by_nom   text NULL,
    ADD COLUMN IF NOT EXISTS changed_by_email text NULL;

COMMENT ON COLUMN payment_audit_log.changed_by_nom IS
    'Nom de l''auteur AU MOMENT de l''action. Figé volontairement : le journal '
    'doit rester lisible après la suppression ou le renommage du compte.';
COMMENT ON COLUMN payment_audit_log.changed_by_email IS
    'Courriel de l''auteur au moment de l''action. Figé, même raison.';

-- Reprise de l'existant : les comptes encore présents laissent leur identité
-- actuelle. C'est une approximation — on ignore ce qu'ils s'appelaient alors —
-- mais elle vaut mieux qu'un historique vide, et les lignes futures seront
-- exactes.
UPDATE payment_audit_log a
   SET changed_by_nom = COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                                 NULLIF(TRIM(u.name), ''), u.email),
       changed_by_email = u.email
  FROM users u
 WHERE u.id = a.changed_by
   AND a.changed_by_nom IS NULL;

CREATE OR REPLACE FUNCTION audit_teacher_payments()
RETURNS TRIGGER AS $$
DECLARE
    v_action   varchar;
    v_tenant   uuid;
    v_paiement uuid;
    v_auteur   uuid;
    v_old      jsonb;
    v_new      jsonb;
    v_nom      text;
    v_email    text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'created';
        v_tenant := NEW.tenant_id; v_paiement := NEW.id;
        v_auteur := NEW.created_by;
        v_new := to_jsonb(NEW);

    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'updated';
        v_tenant := NEW.tenant_id; v_paiement := NEW.id;
        -- L'approbateur prime quand il existe : c'est lui qui a posé l'acte.
        v_auteur := COALESCE(NEW.approved_by, OLD.created_by);
        v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);

    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'deleted';
        v_tenant := OLD.tenant_id; v_paiement := OLD.id;
        v_auteur := OLD.created_by;
        v_old := to_jsonb(OLD);

    ELSE
        RETURN NULL;
    END IF;

    -- Identité figée. Un compte introuvable ne bloque rien : les colonnes
    -- restent NULL, l'UUID demeure, et l'action est quand même journalisée.
    SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                    NULLIF(TRIM(u.name), ''), u.email),
           u.email
      INTO v_nom, v_email
      FROM users u
     WHERE u.id = v_auteur;

    INSERT INTO payment_audit_log (tenant_id, payment_id, action, old_values, new_values,
                                   changed_by, changed_by_nom, changed_by_email)
    VALUES (v_tenant, v_paiement, v_action, v_old, v_new, v_auteur, v_nom, v_email);

    -- Déclencheur AFTER : la valeur de retour n'est pas exploitée.
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
