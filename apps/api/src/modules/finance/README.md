# Module `finance` — frais, facturation, paiements, caisse, reporting

Socle (pack `CORE`). Schéma Postgres `finance`, migrations **0500-0599**. Conforme à
`docs/architecture/module-conventions.md` (ADR-001/002/004/006/007). Plan §3.12, PRD §20 et §30-32.

Le module ne connaît les apprenants et les inscriptions que par **UUID**, à travers deux ports
(`LearnerDirectory`, `EnrollmentDirectory`) : il ne dépend pas du futur cœur académique.

## Ce que le module sait faire

| Domaine | Fonctions |
|---|---|
| Catalogue | frais (inscription, scolarité, cantine, transport, uniforme, documents, examens, activités, soutenance, bibliothèque, autres), **barèmes** par établissement / campus / niveau / filière / année / type d'apprenant avec dates d'effet (le plus spécifique gagne, ambiguïté = erreur), **plans d'échéancier** types, **remises** (pourcentage en points de base ou montant, plafonds, cumulables ou non) |
| Facturation | facture depuis un barème (avec aperçu), facture manuelle, brouillon → émission, numérotation `FAC-aaaa-nnnnnn`, annulation, **avoirs** `AV-aaaa-nnnnnn`, **échéanciers** (500 000 = 100 000 + 150 000 + 150 000 + 100 000, répartition sans perte), retards (`markOverdueInvoices`) |
| Financement | type de financement porté par le compte de l'apprenant (`PRIVATE`, `STATE_ASSIGNED`, `SCHOLARSHIP`, `COMPANY`, `STAFF_CHILD`, `OTHER`) ; **bourses / prises en charge** : la part de chaque financeur (État, entreprise…) devient une **facture liée** payable séparément, la famille garde sa part (somme exacte, au franc près) |
| Encaissement | paiement manuel (espèces, chèque, virement, carte, mobile money), **imputation** automatique (plus ancienne échéance d'abord, ordre configurable) ou manuelle (échéances, lignes), reçus `REC-aaaa-nnnnnn` immuables, **idempotence** par clé fournie |
| Paiement en ligne | port `PaymentProvider` + `ProviderRegistry` + `SandboxProvider` déterministe ; initiation, vérification active, **webhooks idempotents** et signés |
| Remboursement | partiel ou total, motif, **approbation à quatre yeux**, exécution par écritures inverses |
| Caisse | caisses, sessions d'ouverture/clôture par caissier, fonds de caisse, écart attendu / compté, paiements espèces rattachés à la session |
| Reporting | facturé, encaissé, restant dû, retard, taux de recouvrement, créances par classe (clé libre) et par apprenant, évolution des encaissements, **balance âgée** |

## Arborescence

```
domain/          règles PURES (aucun import pg/fastify) : types, Money du kernel, factures, échéanciers,
                 imputation, remises, bourses, machines d'états, reporting, événements
application/     cas d'usage (deps, ctx, input) => Result ; ports (audit, annuaires, fournisseurs) ; jobs
infrastructure/  dépôts SQL (via Tx de TenantDb), fournisseurs (registre, sandbox)
http/            plugin Fastify /api/v1/finance, présentateurs DTO
migrations/      0500 catalogue · 0501 facturation · 0502 paiements · 0503 gardes et invariants
test/            unit/ (purs) · integration/ (Postgres réel) · support/
```

## Modèle de données (schéma `finance`)

Toutes les tables portent `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + RLS forcée
(`kernel.enable_tenant_rls`) : **aucune table globale** (`isolation-allowlist.finance.ts` est vide).
Les clés étrangères internes sont **composites** `(tenant_id, id)` : une ligne ne peut pas pointer
la ligne d'un autre tenant, même en connaissant son UUID.

| Table | Rôle |
|---|---|
| `fees`, `fee_schedules`, `installment_plans`, `discounts` | catalogue |
| `learner_accounts` | compte financier de l'apprenant : `funding_type`, référence d'affectation |
| `scholarships` | bourses / prises en charge (part État, entreprise…) : pourcentage ou montant, plafond, catégories |
| `invoices`, `invoice_lines`, `invoice_discounts`, `installments` | facturation ; cumuls `paid_amount` / `credited_amount` entretenus et **vérifiés au COMMIT** |
| `payments`, `payment_allocations`, `allocation_reversals`, `receipts`, `refunds`, `credit_notes` | encaissements ; les trois premiers et les reçus / avoirs sont **append-only** |
| `cash_registers`, `cash_sessions` | caisses |
| `webhook_events` | journal idempotent, clé unique `(tenant_id, provider, event_id)` |
| `number_sequences` | compteurs de numérotation par `(tenant, type de document, année)` |

Montants : `bigint` (unités mineures, XOF = franc) + code devise ; **aucun flottant**. `pg` renvoie les
`bigint` en chaîne : tous les `SELECT` castent `::text` et reconstruisent un `Money`.

### Garanties portées par la base (migration 0503), valables aussi pour un superutilisateur

* reçus, avoirs, imputations, reprises, remises appliquées : `UPDATE`/`DELETE` interdits (déclencheur
  `finance.immutable`, SQLSTATE 23001) — les droits `app_user` sont déjà restreints (`SELECT, INSERT`) ;
* paiement confirmé : montant, mode, payeur, références **figés** ; seuls les cumuls imputé / remboursé et le
  passage `CONFIRMED → REFUNDED` sont possibles ; jamais de `DELETE` ;
* machines d'états en SQL (miroir de celles du domaine, vérifié par test) : factures, paiements, remboursements,
  sessions de caisse ;
* **cohérence des sommes au COMMIT** (déclencheurs de contrainte différés) : total facture = Σ lignes ;
  Σ échéances = total ; `paid`/`credited` d'une facture = Σ de ses échéances = imputations nettes / avoirs ;
  `allocated`/`refunded` d'un paiement = imputations nettes / remboursements terminés ; un paiement
  confirmé a **toujours un reçu** ;
* `CHECK` : montants ≥ 0, `imputé + remboursé ≤ montant`, un paiement espèces a une session de caisse,
  un paiement en ligne un fournisseur, une facture numérotée est une facture émise.

## Numérotation sans trou ni doublon

`finance.next_number(kind, year)` incrémente la ligne de compteur du tenant courant
(`INSERT … ON CONFLICT DO UPDATE`). La ligne reste verrouillée jusqu'au COMMIT : les transactions
concurrentes se **sérialisent** sur le compteur et un numéro pris par une transaction annulée est
rendu à la suivante. Test : 50 paiements concurrents ⇒ `REC-2025-000001 … 000050` contigus ; 40 émissions
concurrentes de factures idem. L'année est celle de `Clock` à Abidjan ; elle repart à 1 le 1er janvier.
Le numéro est pris **tard** dans la transaction (le verrou dure jusqu'au COMMIT).

Ordre de verrouillage constant, pour éviter les interblocages : **paiement → factures (par identifiant) →
compteurs → chaîne d'audit** (l'audit est écrit en dernier, cf. `EventBuffer`).

## Idempotence

| Opération | Mécanisme |
|---|---|
| Paiement manuel / en ligne | clé fournie (en-tête `Idempotency-Key` ou champ `idempotencyKey`), `UNIQUE (tenant, clé)` + `INSERT … ON CONFLICT DO NOTHING` ; empreinte SHA-256 de la demande : même clé + demande différente ⇒ `409 finance.idempotency_key_reused` |
| Facture (depuis barème / manuelle) | clé facultative ; verrou consultatif par clé (les doublons concurrents deviennent des rejeux) |
| Remboursement | clé facultative, même schéma que les paiements |
| Webhook | `UNIQUE (tenant, fournisseur, event_id)` : événement déjà traité ⇒ réponse immédiate ; livraisons concurrentes sérialisées |
| Passage en retard | un statut ne change qu'à la transition ⇒ un seul `finance.invoice.overdue` par transition |

## Fournisseurs de paiement

Port `PaymentProvider` (`application/ports/payment-provider.ts`) — contrat de l'interface historique en version
typée `Result` / `Money` : `initiate`, `verify`, `handleWebhook`, `verifySignature`, `getProviderName`.
La table de correspondance legacy ↔ port est dans l'en-tête du fichier. Les adaptateurs réels (Orange Money,
MTN MoMo, Wave, CinetPay, TresorPay) sont écrits dans `infrastructure/providers/` (voir « Adaptateurs de paiement réels »
ci-dessous et `specs/v2/015-payments/`) ; `test/support/fake-provider.ts` prouve qu'un adaptateur se branche sans
toucher au module.

**Règle de sécurité** (`ProviderRegistry`) : hors `development`/`test`, un fournisseur **non configuré est
refusé** (`finance.provider_not_configured`, seuls les *noms* des paramètres manquants sont exposés) et la
`sandbox` est refusée sauf autorisation explicite du tenant (`allowSandbox = "true"`). Aucun repli silencieux en
simulation. Un repli vers la sandbox en développement n'existe que si on le demande (`devSandboxFallback`),
il est journalisé, et un paiement simulé (`simulated = true`) **ne peut jamais être confirmé hors
développement** (`finance.simulated_payment_in_production`).

**Sandbox** (`SandboxProvider`) : déterministe. Drapeau `metadata.sandbox = success|failure|pending`, sinon d'après le
montant (se terminant par `013` ⇒ échec, par `001` ⇒ en attente, sinon succès). `settle(ref, issue)` règle un
paiement en attente ; `buildWebhook(ref)` fabrique un webhook signé HMAC-SHA256 (`x-sandbox-signature`).

**Webhooks** : `POST /api/v1/finance/webhooks/:provider/:tenantId` (public ; le tenant est dans l'URL, la
**signature fait foi**, vérifiée sur le corps *brut*). Montant et devise rapportés doivent égaler EXACTEMENT
ceux attendus ; sinon l'événement est enregistré `FAILED` et le paiement reste `PENDING` (rapprochement manuel).
Un succès tardif d'un paiement échoué est signalé de la même façon, jamais encaissé.

Configuration par tenant : port `ProviderConfigSource` (`StaticProviderConfigSource`, `EnvProviderConfigSource`
`FINANCE_PROVIDER_<NOM>_<CLÉ>`) ; clés en minuscules.

## Ports et dépendances

```ts
const deps = createFinanceDeps({
  db: tenantDb,                       // TenantDb — seul accès SQL
  clock,                              // Clock du kernel (jamais Date.now() dans le module)
  audit,                              // AuditPort — no-op par défaut
  providers,                          // ProviderRegistry — défaut : environnement "production" (aucune simulation)
  learners, enrollments,              // annuaires (défaut : passe-plat / aucune inscription)
  config: { environment, allocationOrder, maxDiscountBps, refundSelfApproval, cashVarianceTolerance, webhookBaseUrl },
});
```

**`AuditPort`** : `record(tx, ctx, { action, resourceType, resourceId, before, after, sensitive })`, appelé
dans la même transaction (écrit en dernier). Adaptateur vers le module `audit` :
`audit.record(tx, { action, entity: resourceType, entityId: resourceId, before, after, severity: sensitive ? "notice" : "info" })`
(les noms d'action `finance.<entité>.<verbe>` et `resourceType` en snake_case respectent déjà les regex d'`audit`).
Un échec d'audit annule l'opération (test dédié).

**Regroupement « créances par classe »** : `EnrollmentRef.groupKey` / `groupLabel` (clé libre) sont recopiés sur la
facture à l'émission ; le module n'interprète jamais cette clé.

## Cas d'usage (`index.ts`)

`createFee`, `createFeeSchedule`, `createInstallmentPlan`, `createDiscount`, `setLearnerFunding`, `createScholarship`,
`issueInvoiceFromSchedule` / `previewInvoiceFromSchedule` / `createInvoice` / `issueInvoice` / `cancelInvoice`,
`generateInstallmentPlan`, `issueCreditNote`, `recordManualPayment`, `allocatePayment`, `initiateOnlinePayment`,
`verifyPendingPayment`, `handleProviderWebhook`, `requestRefund` / `approveRefund` / `completeRefund` / `rejectRefund`,
`createCashRegister`, `openCashSession`, `closeCashSession`, `markOverdueInvoices` (+ `markOverdueForAllTenants(deps, systemDb)`
pour `apps/worker`), requêtes `getFinanceSummary`, `getReceivablesByGroup`, `getReceivablesByLearner`,
`getCollectionsTrend`, `getAgedBalance`, `getLearnerStatement`…

### Événements (outbox, `{ v: 1, … }`)

`finance.invoice.issued|paid|overdue|cancelled`, `finance.credit_note.issued`,
`finance.payment.initiated|completed|failed|allocated`, `finance.receipt.issued`,
`finance.refund.requested|completed|rejected`, `finance.cash_session.opened|closed`.
`finance.payment.completed` porte reçu, imputations et non-imputé ; `finance.invoice.overdue` le solde, le montant
échu, la plus ancienne échéance et les jours de retard.

## HTTP — `/api/v1/finance/*` (plugin `financePlugin`)

Contexte : `request.ctx` posé en amont (iam / authentification historique). Permissions via `requirePermission` du module
`rbac` (injectable). `isFeatureEnabled(ctx, key)` (entitlements) facultatif : sans lui, toutes les features sont actives.

| Route | Permission |
|---|---|
| `GET/POST /fees`, `PATCH /fees/:id/status`, `GET/POST /fee-schedules`, `GET /fee-schedules/resolve`, `GET/POST /installment-plans` *(feature `finance.installments`)*, `GET/POST /discounts`, `PUT /learners/:id/funding` *(`STATE_ASSIGNED` : feature `finance.state-assigned`)*, `POST /scholarships` *(`STATE` : feature `finance.state-assigned`)*, `PATCH /scholarships/:id/status`, `POST /cash-registers` | `finance.fee.read` / `finance.fee.manage` |
| `GET /invoices`, `GET /invoices/:id`, `GET /learners/:id/funding`, `GET /learners/:id/statement`, `POST /invoices/from-schedule/preview` | `finance.invoice.read` |
| `POST /invoices`, `POST /invoices/from-schedule`, `POST /invoices/:id/issue`, `POST /invoices/:id/installments` | `finance.invoice.create` |
| `POST /invoices/:id/cancel`, `POST /invoices/:id/credit-notes` | `finance.invoice.cancel` |
| `GET /payments`, `GET /payments/:id`, `GET /refunds`, `GET /refunds/:id` | `finance.payment.read` |
| `POST /payments`, `POST /payments/online` *(feature `finance.online-payment`)*, `POST /payments/:id/verify`, `POST /payments/:id/allocations` | `finance.payment.create` |
| `POST /payments/:id/refunds`, `POST /refunds/:id/approve\|complete\|reject` | `finance.payment.refund` (**sensible** : MFA) |
| `GET /cash-registers`, `POST /cash-registers/:id/sessions`, `GET /cash-sessions[/mine\|/:id]` | `finance.cashregister.open` |
| `POST /cash-sessions/:id/close` | `finance.cashregister.close` |
| `GET /reports/summary\|receivables-by-group\|receivables-by-learner\|collections-trend\|aged-balance` | `finance.report.read` |
| `GET /receipts`, `GET /receipts/:id`, `GET /payments/:id/receipt` | `finance.receipt.read` |
| `GET /exports/invoices\|payments\|receivables` (CSV complet) et `…/meta` (JSON) | `finance.invoice.read` / `finance.payment.read` / `finance.report.read` |
| `GET /me/learners`, `GET /me/learners/:learnerId/statement\|invoices[/:id]\|installments\|payments[/:id]\|receipts[/:id]` | `finance.child.read` (parent) ou `finance.self.read` (élève) + **propriété** relue côté serveur |
| `POST /me/learners/:learnerId/payments/online`, `POST /me/learners/:learnerId/payments/:id/verify` *(feature `finance.online-payment`)* | `finance.child.pay` (parent) ou `finance.self.pay` (élève) + propriété |
| `GET /receipts/:id/pdf` (PDF du reçu), `GET /me/learners/:learnerId/receipts/:id/pdf` (famille) | `finance.receipt.read` ; `finance.child.read` / `finance.self.read` + propriété |
| `POST /webhooks/:provider/:tenantId` | publique (signature) |

Contrats Zod : `packages/contracts/src/v2/finance.ts` (réexportés par `v2/index.ts`). Entrées : montants entiers ou
chaînes de chiffres, jamais de décimale ; champs inconnus refusés (`strict`).

## Routes famille `/me/*` — parent et élève

Un parent lit la situation financière de SES enfants, un élève la sienne ; le parent peut payer en ligne pour son enfant.

* **Deux couches** : (1) RBAC — `finance.child.read|pay` (modèle de rôle `parent`) ou `finance.self.read|pay` (modèle `eleve`) ; (2) **propriété** relue à
  chaque requête par le port `GuardianshipPort` (adaptateur `platform/adapters/people-finance.ts` → `people`) : l'apprenant est la fiche liée au compte
  (`persons.identity_id`, jamais l'e-mail) ou l'enfant d'un tuteur VIVANT (lien non clos, portail ouvert, nature `GUARDIAN`). La permission doit correspondre à
  la relation (un parent n'ouvre pas un enfant avec la seule `finance.self.read`). Port non branché : échec fermé (personne ne voit rien).
* **404 uniforme** : enfant non lié, lien clos, apprenant inconnu, facture / paiement / reçu d'un autre apprenant, brouillon, part d'un financeur : même
  réponse (`finance.not_found`, « Ressource introuvable. », sans identifiant). Seul un identifiant mal formé donne un 400 de validation.
* **Périmètre exposé** : factures ÉMISES (numérotées) et paiements/reçus à la charge de la FAMILLE (`payerKind = LEARNER`). Jamais un brouillon ni une facture ou
  un paiement de financeur (État, entreprise). DTO sans champs internes (`payerRef`, `cancelReason`, `providerRef`, `simulated`, `cashSessionId`).
  Totaux du relevé calculés sur ce seul périmètre.
* **Paiement en ligne** : `invoiceId` OBLIGATOIRE ; avant tout appel fournisseur, finance contrôle que la facture est celle de l'apprenant, émise, à la charge de
  la famille et encaissable, que la devise est la sienne et que le montant ne dépasse pas le reste dû. Clé d'idempotence **propre à l'utilisateur**
  (`fam:` + SHA-256 de `userId + clé`) : la clé d'un parent ne rejoue ni ne heurte le paiement d'un autre compte. Le paiement porte `created_by` = le compte
  initiateur ; l'initiation est auditée (`finance.payment.family_initiated`, relation `SELF` ou `GUARDIAN`). `verify` interroge le fournisseur pour un paiement
  en attente de l'apprenant lié.

## PDF des reçus

Le reçu est un snapshot IMMUABLE (déclencheur SQL) : `GET /receipts/:id/pdf` (gestion) et `GET /me/learners/:learnerId/receipts/:id/pdf`
(famille : même contrôle de propriété, reçu d'un financeur ou d'un autre apprenant = 404 uniforme) le confient au module `reportcards`
par le port `documents` (`platform/adapters/finance-reportcards.ts`) : contenu figé (`domain/receipt-document.ts`, nom de l'apprenant lu dans
`people` et FIGÉ à la première demande) -> scellement (hash SHA-256 du JSON canonique, code de vérification de 128 bits, signature Ed25519)
-> rendu par le worker (Chromium, JavaScript coupé, réseau coupé) depuis ce contenu seul -> stockage objet -> **page publique de
vérification** (`/v/<code>`, QR imprimé sur le PDF ; code et fichier reconnus, aucune donnée personnelle publiée : le titre ne porte que le
numéro du reçu). Réponses : `200` PDF (`Cache-Control: private, no-store`, `X-Document-Verification-Code`), `202` + `Retry-After` pendant le
rendu (1re demande : le document est scellé et le rendu publié), `409 finance.document_render_failed` si le rendu a échoué définitivement
(la demande suivante le redemande), `409 reportcards.branding_missing` sans identité d'établissement, `500 finance.port_unavailable` si le
service de documents n'est pas branché. Chaque téléchargement abouti est audité (`finance.receipt.downloaded`). Variables : voir
`reportcards/README.md` (`REPORTCARDS_SIGNING_KEY`, `REPORTCARDS_VERIFICATION_BASE_URL`, stockage objet).

## Clés libres des barèmes (`levelKey`, `trackKey`, `learnerType`)

Finance ne les interprète pas ; leur SENS est fixé par l'adaptateur d'inscriptions d'`academic` (`createEnrollmentDirectory`, branché par
`platform/adapters/directories-finance.ts`) : `levelKey` = code du niveau de la classe (ex. `L1`), `trackKey` = code du programme (ex. `INFO`),
`learnerType` = code du type de FINANCEMENT de l'inscription (`PRIVATE`, `STATE_ASSIGNED`, `SCHOLARSHIP`, `COMPANY`, `STAFF_CHILD`, `OTHER` : le
même vocabulaire des deux côtés), `groupKey` = classe, `academicYear` = code de l'année. Le barème se résout depuis l'inscription (le plus
spécifique gagne) ; une portée explicite de la demande prime clé par clé, une clé absente retombe sur l'inscription ; la sonde de frais
d'inscription d'`academic` dérive le MÊME périmètre. Test : `apps/api/test/adapters/fee-scope.integration.test.ts` (vraies inscriptions).

## Exports CSV serveur

`GET /exports/invoices|payments|receivables` (filtres des listes, sans pagination) et `GET /exports/<jeu>/meta` (JSON `financeExportMetaDtoSchema`).
Le fichier contient TOUTES les lignes du filtre (une seule requête = instantané cohérent) jusqu'au plafond **`FINANCE_EXPORT_MAX_ROWS`** (défaut **50 000**,
borné à 500 000). Au-delà, il est tronqué ET signalé : en-têtes `X-Export-Truncated` (`true|false`), `X-Export-Row-Count`, `X-Export-Total-Count`,
`X-Export-Max-Rows` (exposés par `Access-Control-Expose-Headers`) et route `/meta` — lisible par le client typé sans accès aux en-têtes
(`parseFinanceExportHeaders` du contrat ; un en-tête manquant = potentiellement tronqué, jamais « complet »). Format : UTF-8 avec BOM, séparateur `;`, CRLF,
anti-injection de formule, montants entiers en unités mineures + colonne `devise`. Chaque export est audité (`finance.export.generated`).
La colonne `apprenant` (« NOM Prénom ») est lue par LOT dans `people` (port facultatif `learners.getLearnerNames`, une lecture pour N apprenants) ; elle est
vide si le port est absent ou indisponible. Le même port alimente `displayName` de `GET /me/learners` et `learnerName` de
`GET /reports/receivables-by-learner` (décoration : un échec ne casse jamais la liste).

## Reporting — définitions

* **Facturé** = Σ total des factures émises (hors brouillon / annulée) ; **crédité** = Σ avoirs ; **encaissé** = Σ imputations nettes
  des remboursements ; **restant dû** = facturé − crédité − encaissé ; **en retard** = Σ reste dû des échéances échues (date < `asOf`)
  des factures actives ; **taux** = encaissé / (facturé − crédité), en points de base (HALF_UP), `null` si rien à recouvrer.
* **Balance âgée** : reste dû de chaque échéance par ancienneté à `asOf` (non échu, 1-30, 31-60, 61-90, > 90 jours).
* **Évolution** : paiements confirmés et remboursements exécutés par jour / semaine / mois à Abidjan, seaux sans trou.
* Les règles pures sont dans `domain/reporting.ts` ; un test compare les requêtes SQL à ce calcul de référence.

## Tests

```bash
# unitaires (sans base) — depuis la racine du dépôt
pnpm exec vitest run --config apps/api/src/modules/finance/vitest.config.ts

# + intégration sur Postgres éphémère (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs \
  --config apps/api/src/modules/finance/vitest.config.ts

# types
apps/api/node_modules/.bin/tsc -p apps/api/src/modules/finance/tsconfig.json
```

Sans `TEST_DATABASE_URL`, les tests d'intégration s'ignorent avec un message. `vitest.config.ts` porte les alias
`@ecoledigitale/kernel`, `@ecoledigitale/database`, `@ecoledigitale/contracts/src/*` (comme le module `rbac`).

Couverture mesurée (v8, `--coverage` exige `@vitest/coverage-v8`, non encore une dépendance du dépôt ; 388 tests) : domaine ≈ 99 % des lignes / 96 % des branches, module ≈ 97 % des lignes.

## Assemblage (fait — `docs/architecture/platform-assembly.md`)

1. `http/plugin.ts` exporte par défaut `(app, runtime)` : `createFinanceDeps` avec `runtime.tenantDb`, l'adaptateur d'audit (`financeAuditAdapter`, table de correspondance dans son en-tête : `resourceType` → `entity`, `resourceId` → `entityId`, `sensitive` → `severity notice`), le registre de fournisseurs (`FINANCE_ENV`, `FINANCE_PROVIDER_<NOM>_<CLÉ>`, `FINANCE_WEBHOOK_BASE_URL`) ; routes **sans préfixe** (le registre applique `/api/v1/finance`). `financePlugin` garde l'option `prefix` pour les tests.
2. Entitlements : `POST /payments/online` et `POST /payments/:id/verify` sont gardées par `requireFeature('finance.online-payment')` (403 `entitlements.feature_not_available`) ; les contrôles dépendant du corps (échéanciers, `STATE_ASSIGNED`) restent en ligne via `isFeatureEnabled`. Deux entrées de menu conditionnées par une feature (`finance.online-payments`, `finance.state-assigned`).
3. Le webhook `POST /webhooks/:provider/:tenantId` est déclaré `config: { public: true }` (la signature fait foi) : ni le registre ni le middleware legacy ne le rejettent.
4. `apps/worker` : `jobs.ts` — `finance.mark-overdue-invoices` (quotidien 01:15, `markOverdueForAllTenants`, échec d'un tenant signalé). Les consommateurs de `finance.*` (notifications de retard, reçus PDF) restent à écrire (Phase 3) ; l'audit de finance est écrit directement dans la transaction (le module audit ne s'abonne pas aux événements `finance.*`).
5. `EnvProviderConfigSource` met les clés en minuscules : `allowSandbox` s'exprime donc aussi `allowsandbox`.

## Adaptateurs de paiement réels (spec 015-payments)

Fichiers : `infrastructure/providers/{orange-money,mtn-momo,wave,cinetpay,tresorpay}.ts` (adaptateurs), `http.ts` (délais,
reprises, journalisation expurgée), `token-cache.ts` (OAuth en cache, single-flight), `common.ts` (HMAC, temps constant,
montants entiers stricts, références compactes, masquage), `catalog.ts` (champs de configuration, secrets ou non),
`definitions.ts` (enregistrement + `endpointsFromEnv`). Zones d'incertitude documentaires : `specs/v2/015-payments/open-questions.md`.

| Fournisseur | Initiation | Confirmation | Authenticité du webhook | Remboursement |
|---|---|---|---|---|
| Orange Money (`orange_money`) | `POST …/webpayment` (jeton OAuth) | `transactionstatus` | URL à jeton `?ref&t` **+ vérification active** | non |
| MTN MoMo (`mtn_momo`) | `POST requesttopay` (référence UUID v4 dérivée du paiement ; 409 = rejeu) | `GET requesttopay/{id}` | URL à jeton `?t` **+ vérification active** | oui (zone d'incertitude) |
| Wave (`wave`) | `POST checkout/sessions` (recherche par `client_reference` avant création) | `GET sessions/{id}` | `Wave-Signature` HMAC + horodatage ± 5 min, ou secret partagé | oui (total) |
| CinetPay (`cinetpay`) | `POST /v2/payment` (montant multiple de 5) | `POST /v2/payment/check` | `x-token` HMAC **+ vérification active** | non |
| TresorPay (`tresorpay`) | `POST /payments/initialize` (appel signé) | `GET /payments/{id}/verify` | `x-signature` HMAC | oui (contrat legacy, faible confiance) |

* **Indice contre preuve** : un webhook sans signature de contenu est marqué `requiresActiveVerification` ; `handleProviderWebhook`
  interroge `verify` AVANT d'ouvrir la transaction de confirmation, et refuse (409 `finance.webhook_unverified`, rien d'enregistré,
  le fournisseur réessaie) si le fournisseur ne confirme pas ou est injoignable. Aucun appel sortant pour un paiement inconnu.
* **Contrôles avant confirmation** (`applyProviderOutcome`) : montant et devise égaux, référence fournisseur identique à celle de
  l'initiation, paiement non simulé hors développement ; sinon événement `FAILED` + audit `finance.webhook.rejected`, paiement inchangé.
* **Mode explicite** : `mode = sandbox | production` sans défaut ; `sandbox` refusé en environnement `production`. Un fournisseur
  désactivé répond `finance.provider_disabled`. Aucune simulation implicite.
* **Aucun point d'accès configurable par un tenant** (SSRF) : URL de base dans le code ou `FINANCE_PROVIDER_<NOM>_[SANDBOX_]BASE_URL`.
* Ports étendus (additifs) : `verifySignature/handleWebhook(…, meta)` (paramètres d'URL), `ProviderVerifyRequest.amount`,
  `ProviderWebhookEvent.requiresActiveVerification / storedPayload`, `refund?`, `testConnection?`, `webhookUrl?`.
* La route de webhook accepte `POST` et `PUT` (rappel MTN) ; elle lit aussi `application/x-www-form-urlencoded` en corps brut
  (CinetPay). Aucun `GET` public (garde-fou d'assemblage D3b) : voir Q-PAY-27.

### Configuration par tenant et coffre des secrets

Table `finance.provider_configs` (migration 0505, RLS) : réglages non secrets en clair, secrets **scellés** AES-256-GCM
(`SecretStorePort` → `AesGcmSecretStore`, trousseau `FINANCE_SECRETS_KEYS`, AAD `tenant|fournisseur|champ`, rotation par
`POST /providers/rotate-secrets`) ; la base refuse une valeur non scellée (`finance.secrets_are_sealed`). Sans clé maître le coffre est
indisponible : saisie refusée (`finance.secrets_unavailable`). `TenantProviderConfigSource` ouvre les secrets à l'usage (cache 15 s,
ouverture auditée `finance.provider_secret.accessed`) ; `CompositeConfigSource` ne retombe sur l'environnement que si
`FINANCE_PROVIDER_ENV_FALLBACK=true` (jamais par défaut en production).

| Route (`/api/v1/finance`) | Rôle |
|---|---|
| `GET /providers` | catalogue + état du tenant (présence des secrets, jamais leur valeur), URL de webhook, dernier test |
| `PUT /providers/:provider` | mode, réglages, secrets (omis = conservés), `clearSecrets`, `regenerateWebhookSecret` |
| `PATCH /providers/:provider/status` | activer (configuration complète exigée) / désactiver |
| `POST /providers/:provider/test` | test de connexion sans paiement (espacé de 3 s) |
| `DELETE /providers/:provider/credentials` | efface les secrets et désactive |
| `POST /providers/rotate-secrets` | rechiffre avec la clé active |

Toutes : permission `finance.provider.manage` (**sensible**, MFA) ; chaque écriture est auditée (noms de champs, jamais de valeur).
Écran : `apps/web/src/app/v2/finance/providers`.

## Câblage restant (hors périmètre de ce module)

1. Annuaires : un adaptateur appelant l'API publique du module `academic` pour `LearnerDirectory` / `EnrollmentDirectory`.
2. Job planifié de rattrapage des paiements en attente (assembler le registre + coffre dans le worker et appeler `verifyPendingPayment`).
3. Branchement de `completeRefund` sur `PaymentProvider.refund` (décision métier : spec 015, Q-PAY-32).

## Décisions et limites connues

* Un remboursement n'est pas encore exécuté chez le fournisseur : le port expose `refund?` (Wave, MTN, TresorPay) mais `completeRefund`
  reste comptable ; l'envoi de l'argent est fait hors module.
* La sandbox garde son état en mémoire du processus : elle est réservée au développement et aux tests.
* Une facture d'un financeur est payée par le financeur (`payerKind = FUNDER`, `payerRef` = id de la bourse) ; un paiement ne s'impute
  jamais sur la facture d'un autre payeur.
* Un avoir porte sur le **reste dû** : pour annuler une somme déjà encaissée, rembourser d'abord (reprise d'imputation), puis créditer.
* La clé de regroupement « classe » et le type d'apprenant sont des clés libres : le sens vient de l'adaptateur `EnrollmentDirectory`.

## Faits publiés pour la plateforme

Extension additive de l'assemblage `platform/adapters` (voir `docs/architecture/platform-assembly.md` §11) :

- migration `0504_finance_line_source` : `invoice_lines.source_ref` (objet source de la ligne : sélection de cours…), exposé en `sourceRef` ;
- `finance.invoice.paid` est **enrichi** (`enrollmentId`, `containsRegistrationFee`, `sourceRefs[{ sourceRef, category }]`, schéma `financeInvoicePaidEventPayloadSchema`) : academic confirme l'inscription VISÉE après paiement des frais d'inscription (décision métier du 2026-10-01) ;
- `application/facts.ts` : `getInvoiceFacts`, `getRegistrationFeeStatus` (frais d'inscription facturés / soldés), `isRegistrationFeeDue` (un barème applicable existe ; `false` = aucun frais, confirmation immédiate), `hasOverdueBalance` (impayé exigible, **sans montant**) ;
- ports `learners` / `enrollments` : registre `registerFinancePorts` (`app.financePorts`), branchés par `platform/adapters/directories-finance.ts`. Les frais d'inscription doivent être facturés **séparément** de la scolarité (ligne de catégorie `REGISTRATION`).
