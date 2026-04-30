-- EcoleDigitale Database Schema Migration 0047
-- Description: Increase price precision for professional training tables
-- Date: 2025-01-28
-- 
-- This migration increases the precision of all price-related DECIMAL(10,2) columns
-- to DECIMAL(15,2) to support larger price values.
-- 
-- DECIMAL(10,2) can store up to 99,999,999.99
-- DECIMAL(15,2) can store up to 999,999,999,999,999.99

BEGIN;

-- Update formations_professionnelles table
ALTER TABLE formations_professionnelles 
  ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
  ALTER COLUMN prix_ttc TYPE DECIMAL(15,2);

-- Update sessions_professionnelles table
ALTER TABLE sessions_professionnelles 
  ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
  ALTER COLUMN prix_ttc TYPE DECIMAL(15,2);

-- Update formations_professionnelles_aspci table
ALTER TABLE formations_professionnelles_aspci 
  ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
  ALTER COLUMN prix_ttc TYPE DECIMAL(15,2);

-- Update sessions_professionnelles_aspci table
ALTER TABLE sessions_professionnelles_aspci 
  ALTER COLUMN prix_ht TYPE DECIMAL(15,2),
  ALTER COLUMN prix_ttc TYPE DECIMAL(15,2);

-- Update formateurs table (tarif_journalier)
ALTER TABLE formateurs 
  ALTER COLUMN tarif_journalier TYPE DECIMAL(15,2);

-- Update formateurs_aspci table (tarif_journalier)
ALTER TABLE formateurs_aspci 
  ALTER COLUMN tarif_journalier TYPE DECIMAL(15,2);

-- Update inscriptions_professionnelles table
ALTER TABLE inscriptions_professionnelles 
  ALTER COLUMN montant_ht TYPE DECIMAL(15,2),
  ALTER COLUMN montant_ttc TYPE DECIMAL(15,2),
  ALTER COLUMN reduction_appliquee TYPE DECIMAL(15,2);

-- Update inscriptions_professionnelles_aspci table
ALTER TABLE inscriptions_professionnelles_aspci 
  ALTER COLUMN montant_ht TYPE DECIMAL(15,2),
  ALTER COLUMN montant_ttc TYPE DECIMAL(15,2),
  ALTER COLUMN reduction_appliquee TYPE DECIMAL(15,2);

-- Update paiements_professionnels table
ALTER TABLE paiements_professionnels 
  ALTER COLUMN montant TYPE DECIMAL(15,2);

-- Update paiements_professionnels_aspci table
ALTER TABLE paiements_professionnels_aspci 
  ALTER COLUMN montant TYPE DECIMAL(15,2);

-- Update codes_promo table
ALTER TABLE codes_promo 
  ALTER COLUMN valeur_reduction TYPE DECIMAL(15,2);

-- Update codes_promo_aspci table
ALTER TABLE codes_promo_aspci 
  ALTER COLUMN valeur_reduction TYPE DECIMAL(15,2);

COMMIT;

