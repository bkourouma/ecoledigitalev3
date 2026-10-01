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
MTN MoMo, Wave, CinetPay, TresorPay) ne sont **pas** écrits ici (Phase 3) ; `test/support/fake-provider.ts` prouve
qu'un adaptateur se branche sans toucher au module.

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
| `POST /webhooks/:provider/:tenantId` | publique (signature) |

Contrats Zod : `packages/contracts/src/v2/finance.ts` (réexportés par `v2/index.ts`). Entrées : montants entiers ou
chaînes de chiffres, jamais de décimale ; champs inconnus refusés (`strict`).

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

## Câblage restant (hors périmètre de ce module)

1. Annuaires : un adaptateur appelant l'API publique du module `academic` pour `LearnerDirectory` / `EnrollmentDirectory`.
2. Enregistrer les adaptateurs de paiement réels dans le `ProviderRegistry` (`register({ name, requiredSettings, create })`) et fournir la
   configuration par tenant (`ProviderConfigSource`).

## Décisions et limites connues

* Un paiement en ligne n'est jamais remboursé *via* le fournisseur (le port n'a pas de `refund`) : le remboursement est comptable ; l'envoi
  de l'argent est fait hors module (Phase 3 : méthode optionnelle `refund`).
* La sandbox garde son état en mémoire du processus : elle est réservée au développement et aux tests.
* Une facture d'un financeur est payée par le financeur (`payerKind = FUNDER`, `payerRef` = id de la bourse) ; un paiement ne s'impute
  jamais sur la facture d'un autre payeur.
* Un avoir porte sur le **reste dû** : pour annuler une somme déjà encaissée, rembourser d'abord (reprise d'imputation), puis créditer.
* La clé de regroupement « classe » et le type d'apprenant sont des clés libres : le sens vient de l'adaptateur `EnrollmentDirectory`.
