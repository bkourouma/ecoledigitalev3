-- =============================================================================
-- 0709 — academic : poids d'une période dans la moyenne annuelle (`average_weight`)
-- =============================================================================
--
-- Spec 005 (`coef-period@1`) et 006 (`secondary-annual@1`) : la moyenne générale annuelle pondère les périodes NOTÉES par un poids
-- qui est une DONNÉE du calendrier (jamais une constante de règle). Le poids d'un CRÉNEAU de plan (`slots[].weight`) répartit les
-- DATES de l'année (durée proportionnelle) : ce n'est pas un poids de moyenne ; les deux notions sont donc distinctes.
-- `average_weight` est copié du créneau (`slots[].averageWeight`, défaut 1) à l'application du plan, modifiable ensuite.
-- Valeur par défaut 1 : aucune pondération n'est supposée (poids égaux). Aucune donnée existante n'est modifiée.
-- =============================================================================

ALTER TABLE academic.academic_periods
  ADD COLUMN average_weight integer NOT NULL DEFAULT 1 CHECK (average_weight BETWEEN 1 AND 1000);
