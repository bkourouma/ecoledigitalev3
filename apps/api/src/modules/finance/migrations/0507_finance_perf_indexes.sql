-- =============================================================================
-- 0507 — Module finance : deux index de PERFORMANCE (extension ADDITIVE, aucune donnée ni contrainte modifiée)
-- =============================================================================
--
-- Issus du rapport de charge (docs/architecture/perf-report.md, mesures sur Postgres 17 éphémère avec jeux de données
-- synthétiques de 120 000 factures par tenant et 336 000 paiements). Aucun comportement fonctionnel ne change : ce sont des
-- index, créés en transaction (les tables `finance.*` sont courtes à indexer ; sur une très grosse table existante on préférera
-- les créer hors migration avec CREATE INDEX CONCURRENTLY puis laisser IF NOT EXISTS les ignorer).
--
-- 1. `payments_pending_by_age` — jauge « paiements en attente » du worker (apps/worker/src/observability/business-gauges.ts) :
--    `WHERE status = 'PENDING'` puis `count(*)`, `min(created_at)` et un filtre sur `created_at`, une fois par tenant à chaque
--    passage. L'index partiel existant `payments_pending_online_idx` exige AUSSI `method = 'ONLINE'` : il ne peut pas servir cette
--    requête, qui parcourait donc toute la table (53 ms sur 336 000 lignes, 45 000 pages lues) ; avec cet index : 1,5 ms, index de
--    quelques ko (les paiements PENDING sont rares). La note du runbook (« à ajouter côté finance si la table devient grande »)
--    est ainsi levée.
-- 2. `invoices_by_created` — liste des factures (`GET /finance/invoices`, billing-repository.listInvoices) :
--    `ORDER BY created_at DESC, id DESC LIMIT/OFFSET` sans autre filtre sélectif ; sans index d'ordre, Postgres lit toutes les
--    factures du tenant satisfaisant le filtre puis les trie (73 ms pour une page à 120 000 factures et 20 000 émises) ; avec cet
--    index il lit les 50 premières lignes de l'index (0,4 ms ; 4,5 ms pour la page 9). Coût : ~20 Mo pour 360 000 factures et une
--    écriture d'index par facture créée.
--
-- Les deux sont tenant-d'abord (RLS : chaque requête porte `tenant_id = <tenant courant>`).
-- =============================================================================

CREATE INDEX IF NOT EXISTS payments_pending_by_age ON finance.payments (tenant_id, created_at) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS invoices_by_created ON finance.invoices (tenant_id, created_at DESC, id DESC);
