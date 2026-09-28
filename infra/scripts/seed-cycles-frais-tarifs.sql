-- Tarifs hors scolarité — inscription, frais annexes, autres frais.
--
-- Montants décidés par l'établissement le 11/09/2026, identiques pour toutes
-- les classes :
--     inscription   100 000 XOF
--     frais annexes  50 000 XOF
--     autres frais        0 XOF
--
-- Complète `seed-cycles-frais.sql`, qui crée les lignes et y pose la scolarité
-- calculée depuis les prix des UE. La scolarité n'est pas touchée ici.
--
-- ATTENTION : ce script ÉCRASE les trois colonnes sur TOUTES les classes. Il
-- répond à une consigne explicite (« pour toutes les classes ») et n'est pas à
-- rejouer une fois que des montants auront été ajustés classe par classe depuis
-- l'écran Scolarité — il effacerait ces ajustements.

BEGIN;

UPDATE cycles_frais
SET inscription = 100000,
    annexes     = 50000,
    autres      = 0,
    updated_at  = NOW()
WHERE programme_id IS NOT NULL;

COMMIT;
