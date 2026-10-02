# Feature Specification : Finance — extensions d'API (014-finance)

**Statut** : extensions livrées avec le module `apps/api/src/modules/finance` (migrations 0500-0504). La spécification complète de la finance (frais, barèmes, factures, paiements, caisse, reporting : PRD §20 et §30-32) reste à rédiger ; ce document fixe les ajouts du « backlog C » (`docs/ETAT_IMPLEMENTATION.md`, « Manques d'API »). Le README du module est la référence d'implémentation.

## 1. Portails famille : situation financière du parent et de l'élève

**US1** — Un parent consulte factures, échéances, paiements et reçus de SES enfants ; un élève, les siens. Un parent peut payer en ligne pour son enfant.

- **AC1.1 Permissions** : `finance.child.read`, `finance.child.pay` (modèle de rôle `parent`) ; `finance.self.read`, `finance.self.pay` (modèle `eleve`). Elles ne donnent aucun accès aux routes d'administration (`/invoices`, `/learners/:id/statement`… restent à `finance.invoice.read` etc.).
- **AC1.2 Propriété côté serveur** : en plus de la permission, l'apprenant doit être la fiche liée au compte (`persons.identity_id`, jamais l'e-mail) ou l'enfant d'un tuteur vivant (lien non clos, portail ouvert, nature `GUARDIAN`), relu à CHAQUE requête (port `GuardianshipPort`, adaptateur `people-finance`). La permission doit correspondre à la relation. Port non branché : aucun accès (échec fermé).
- **AC1.3 404 uniforme** : enfant non lié, lien clos, apprenant inconnu, facture / paiement / reçu d'un autre apprenant, brouillon, part d'un financeur : MÊME réponse (`finance.not_found`, « Ressource introuvable. », sans identifiant). Un identifiant mal formé donne un 400.
- **AC1.4 Périmètre** : factures ÉMISES et paiements/reçus à la charge de la famille (`payerKind = LEARNER`) ; jamais un brouillon ni un document de financeur (État, entreprise). DTO sans champs internes. Totaux calculés sur ce périmètre.
- **AC1.5 Routes** (`/api/v1/finance/me/…`) : `learners`, `learners/:id/statement|invoices[/:id]|installments|payments[/:id]|receipts[/:id[/pdf]]`, `POST learners/:id/payments/online`, `POST learners/:id/payments/:id/verify`.
- **AC1.6 Paiement en ligne parent** : facture visée OBLIGATOIRE ; contrôlée AVANT tout appel fournisseur (celle de l'apprenant, émise, à la charge de la famille, encaissable, même devise, montant ≤ reste dû) ; clé d'idempotence propre à l'utilisateur (aucun rejeu ni conflit croisé) ; `created_by` = le compte initiateur ; audit `finance.payment.family_initiated` ; feature `finance.online-payment` exigée.
- **AC1.7 Tests** : `finance/test/integration/family.integration.test.ts` (matrice d'autorisation, isolation entre familles et entre tenants, DTO, paiement).

## 2. Export CSV serveur

- **AC2.1** `GET /finance/exports/{invoices|payments|receivables}` : TOUTES les lignes du filtre (une requête = instantané cohérent), UTF-8 avec BOM, séparateur `;`, anti-injection de formule, montants entiers en unités mineures + `devise`.
- **AC2.2 Plafond documenté** : `FINANCE_EXPORT_MAX_ROWS` (défaut 50 000, max 500 000). Au-delà, le fichier est tronqué ET signalé : en-têtes `X-Export-Truncated`, `X-Export-Row-Count`, `X-Export-Total-Count`, `X-Export-Max-Rows` (exposés aux clients navigateur) et route JSON `…/meta` (`financeExportMetaDtoSchema`) lisible par le client typé ; `parseFinanceExportHeaders` traite un en-tête manquant comme « potentiellement tronqué ».
- **AC2.3** Permission du jeu de données (`finance.invoice.read`, `finance.payment.read`, `finance.report.read`) ; export audité (`finance.export.generated`). Tests : `exports.integration.test.ts`.

## 3. PDF des reçus

- **AC3.1** `GET /finance/receipts/:id/pdf` (gestion) et `…/me/learners/:id/receipts/:id/pdf` (famille, même propriété que AC1.2) : snapshot immuable du reçu -> document scellé par `reportcards` -> PDF rendu par le worker -> stockage -> vérification publique (QR, code et fichier). Réponses `200` / `202 + Retry-After` / `409`. Téléchargement audité. Détails et limites : README finance et `reportcards/README.md` (« Documents officiels d'autres modules »).
- **AC3.2** Le titre publié par la vérification ne porte aucune donnée personnelle ; le nom de l'apprenant est figé à la première demande.
- **AC3.3 Tests** : `reportcards/test/integration/official-documents.integration.test.ts`, `reportcards/test/integration/pdf-renderer.test.ts` (Chromium réel si présent), `apps/api/test/adapters/documents.integration.test.ts` (adaptateurs réels).

## 4. Clés libres des barèmes

- **AC4.1** `levelKey` = code du niveau, `trackKey` = code du programme, `learnerType` = type de financement de l'inscription : définis par l'adaptateur d'inscriptions d'`academic` (spec 004 AC8.1) ; finance ne les interprète pas. Le barème le plus spécifique applicable gagne ; la portée explicite d'une demande prime clé par clé. Test : `apps/api/test/adapters/fee-scope.integration.test.ts`.

## 5. Hors périmètre de ce document

Lecture du rapprochement des webhooks en échec ; saisie des charges et tableaux de bord propriétaire ; commissions de prospection ; fournisseurs de paiement réels (Phase 3).
