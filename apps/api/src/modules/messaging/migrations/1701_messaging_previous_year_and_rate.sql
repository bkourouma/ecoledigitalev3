-- =============================================================================
-- 1701 — Module messaging : fenêtre « année précédente » (Q-05) et plafond par défaut 120 messages/h (Q-06)
-- =============================================================================
--
-- Q-05  Un parent peut écrire aux enseignants de l'ANNÉE PRÉCÉDENTE de ses enfants pendant une fenêtre configurable :
--       `previous_year_window_days` jours à compter du DÉBUT de l'année suivante (ou de la fin de l'année précédente tant que
--       l'année suivante n'est pas créée). Défaut 90 jours (les 3 premiers mois) ; 0 = fenêtre fermée.
-- Q-06  Le plafond d'envois par heure passe de 60 à 120 par défaut. Les lignes qui portent encore l'ancienne valeur par défaut (60)
--       passent à 120 ; un autre choix de l'établissement n'est pas touché. Les autres plafonds sont inchangés.
-- =============================================================================

ALTER TABLE messaging.settings
  ADD COLUMN previous_year_window_days integer NOT NULL DEFAULT 90 CHECK (previous_year_window_days BETWEEN 0 AND 366);

ALTER TABLE messaging.settings ALTER COLUMN max_messages_per_hour SET DEFAULT 120;
UPDATE messaging.settings SET max_messages_per_hour = 120 WHERE max_messages_per_hour = 60;
