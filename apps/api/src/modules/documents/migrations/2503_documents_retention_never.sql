-- =============================================================================
-- 2503 — Module documents : pièces JAMAIS purgées par défaut (réponse métier Q-03)
-- =============================================================================
--
-- Aucune rétention légale n'impose de détruire les pièces : `archive_retention_days` vaut 0 par défaut, et 0 signifie « jamais »
-- (`purge_after` reste NULL à l'archivage, la purge de rétention ne les voit pas). Un établissement ou une catégorie peut toujours
-- choisir un délai (`archive_retention_days`, `categories.retention_days`) : ce choix explicite prime.
--
-- Reprise : les réglages qui portent encore l'ancien défaut (365 jours) passent à 0, et les documents archivés d'un tel
-- établissement dont la catégorie ne fixe pas son propre délai perdent la date de purge calculée avec l'ancien défaut. Un autre délai
-- choisi par l'établissement, ou une rétention fixée par catégorie, n'est jamais touché.
-- =============================================================================

UPDATE documents.documents d
   SET purge_after = NULL
  FROM documents.settings s
 WHERE s.tenant_id = d.tenant_id
   AND s.archive_retention_days = 365
   AND d.status = 'ARCHIVED' AND d.purged_at IS NULL AND d.purge_after IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM documents.categories c WHERE c.tenant_id = d.tenant_id AND c.id = d.category_id AND c.retention_days IS NOT NULL);

UPDATE documents.settings SET archive_retention_days = 0 WHERE archive_retention_days = 365;

ALTER TABLE documents.settings ALTER COLUMN archive_retention_days SET DEFAULT 0;
