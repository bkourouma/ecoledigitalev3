# Écrans v2 : finance et paie

Routes `/v2/finance/*` et `/v2/payroll/*` (arborescence `src/app/v2/`, pages legacy intactes). Tout passe par `platform/api` (client typé, schémas Zod de
`packages/contracts/src/v2/{finance,payroll}.ts`), `usePermission` / `useFeature` et les gardes serveur. **Aucun calcul financier ni de paie côté
client** : les écrans affichent ce que l'API calcule (facturé, encaissé, reste dû, taux, écart de caisse, bulletins, écarts) et lui transmettent
des actions ; seuls le formatage et la lecture de la saisie sont locaux.

## Règles de présentation des montants (`platform/ui/money.ts`)

- Les montants XOF sont des **entiers** (unités mineures). Affichage `Intl` `fr-CI` via `useFormatter()` : « 1 234 567 F CFA », jamais de décimales.
- **Saisie** (`parseAmountInput`) : entier seulement ; une virgule ou un point (« 1.500 », « 1,5 ») est **refusé** plutôt que deviné (un franc n'a pas
  de sous-unité, une virgule mal lue changerait le montant d'un facteur 1 000). Les pourcentages (`parsePercentToBps`, 70 % -> 7000) et les
  coefficients de majoration (`parseMultiplierToPermille`, 1,5 -> 1500) sont convertis **par lecture de chaîne**, sans flottant.
- Taux de recouvrement en points de base (`bps`), durées en minutes entières : mises en forme à l'affichage seulement.
- Largeur des barres du graphique d'évolution : proportion de la plus grande valeur affichée (présentation, pas un chiffre financier).

## Idempotence des opérations financières (`platform/ui/idempotency.ts`)

`createIdempotentRunner` / `useIdempotentRunner` : une clé par **intention** (format `pay-<uuid>`, 8 à 120 caractères `A-Za-z0-9._:-`).

- même demande renvoyée (échec réseau, délai, double clic) : **même clé** (en-tête `Idempotency-Key` ET champ `idempotencyKey` du corps) ;
- demande modifiée : nouvelle clé (l'API refuse une clé réutilisée avec un autre contenu, `finance.idempotency_key_reused`) ;
- après un succès : clé abandonnée ;
- verrou **synchrone** (référence, pas état React) : deux clics dans le même cycle de rendu n'émettent qu'une requête.

Utilisé par : encaissement manuel, paiement en ligne (staff et parent), demande de remboursement, émission de facture.
L'encaissement manuel passe en plus par une **fenêtre de relecture** (apprenant, montant, mode, imputation) avant l'envoi.

## Routes

### Finance

| Route | Écran | Permission (page) |
|---|---|---|
| `/v2/finance` | indicateurs de synthèse + raccourcis | l'une de `finance.report.read`, `invoice.read`, `payment.read`, `cashregister.open`, `fee.read` |
| `/v2/finance/fees`, `/schedules`, `/plans`, `/discounts` | catalogue : frais, barèmes (établissement / campus / niveau / filière / année / type d'apprenant, résolveur « quel montant s'applique ? »), plans d'échéancier (parts fixes ou pondérées), remises | `finance.fee.read` (+ `fee.manage`) |
| `/v2/finance/funding` | financement d'un apprenant, bourses (part État / entreprise…), répartition des factures famille / financeur | `finance.invoice.read` (+ `fee.manage`) |
| `/v2/finance/invoices`, `/new`, `/[id]` | liste filtrable, émission (catalogue avec **aperçu avant émission** ou saisie libre en brouillon), fiche : lignes, échéancier, avoir, annulation motivée | `finance.invoice.read` / `.create` |
| `/v2/finance/payments`, `/new`, `/online`, `/[id]` | encaissements, encaissement manuel (espèces, chèque, virement, carte, mobile money), paiement en ligne et suivi de statut, imputation, demande de remboursement | `finance.payment.read` / `.create` |
| `/v2/finance/receipts`, `/[id]` | reçus numérotés, reçu imprimable (instantané immuable de l'API) | `finance.receipt.read` |
| `/v2/finance/refunds` | remboursements à quatre yeux : approuver (et exécuter), exécuter, refuser | `finance.payment.read` (+ `.refund`) |
| `/v2/finance/cash` | caisse : ouverture (fonds de caisse), mes mouvements, clôture avec comptage, écart, historique | `finance.cashregister.open` / `.close` |
| `/v2/finance/reports` | synthèse, créances par classe et par apprenant, balance âgée, évolution, export CSV | `finance.report.read` |
| `/v2/finance/me`, `/[learnerId]`, `/[learnerId]/receipts/[id]` | parent / élève : situation, échéances, reçus (PDF scellé), paiement en ligne ; **routes famille `/api/v1/finance/me/*`** (propriété relue côté serveur, 404 uniforme) ; mêmes écrans que `/v2/parent` et `/v2/student` (`app/v2/_family/FamilyFinance`) | `finance.child.read` ou `finance.self.read` (+ `.pay`, fonction `finance.online-payment`) |

### Paie

| Route | Écran | Permission (page) |
|---|---|---|
| `/v2/payroll` | périodes (une seule « en attente de calcul » : création bloquée sinon) | `payroll.period.manage` ou `payslip.read` |
| `/v2/payroll/periods/[id]` | **calcul** (aperçu `dryRun`, calcul, recalcul avec confirmation, origine, périmètre), compte rendu (écartés nommés + motif), bulletins de la période, arrêt / versement par sélection ou « tout » (côté serveur), historique des calculs | `payroll.period.manage` |
| `/v2/payroll/payslips`, `/[id]` | bulletins ; fiche : lignes d'heures, **primes / retenues** (préservées au recalcul), arrêt, versement, annulation, contestation motivées, document figé (empreinte, filigrane « NON VERSÉ »), historique | `payroll.payslip.read` (ou `.read_own` pour la fiche) |
| `/v2/payroll/configuration`, `/rates`, `/settings` | configurations salaire / horaire / mixte + situation d'un enseignant, **tarifs horaires** par cours (générique ou nominatif) + **simulateur de tarif**, réglages (seuil et majoration d'heures sup., séparation des tâches, seuil propriétaire) | `payroll.config.read`, `.rate.read`, `.settings.manage` |
| `/v2/payroll/history`, `/reports` | historique des paiements, rapports par statut et origine d'heures ; export CSV **produit par l'API** | `payroll.payslip.read`, `payroll.report.read` |
| `/v2/payroll/owner` | masse salariale (annulés et contestés à part) et validation du propriétaire | `payroll.report.read` + fonction `payroll.owner-validation` |
| `/v2/payroll/my`, `/[id]` | mes bulletins (montants arrêtés seulement, filtrés par l'API) | `payroll.payslip.read_own` |

Le menu tenant (`GET /rbac/me/navigation`) pointe encore vers les routes historiques des manifestes ; `platform/admin/menu.ts` les réécrit vers ces
routes (`/admin/finance/factures` -> `/v2/finance/invoices`, `/admin/paie` -> `/v2/payroll`, `/enseignant/remuneration` -> `/v2/payroll/my`…).

## Séparation des tâches et seuil propriétaire

L'arrêt d'un bulletin (`POST /payslips/approve`) renvoie un compte rendu `{ done, unchanged, rejected: [{ payslipId, code, message }] }` : les refus
sont **nommés** (enseignant) avec le message de l'API et une marche à suivre traduite (`payroll.separation_of_duties` : faire arrêter par une autre
personne ; `payroll.owner_approval_required` : seul le propriétaire, depuis « Masse salariale »). Le web ne décide jamais de qui peut arrêter : la
permission, le réglage et le déclencheur de base restent la barrière.

## Organisation

- `src/platform/ui/{money,idempotency,csv}.ts` : formatage / saisie XOF, clés d'idempotence, export CSV (BOM UTF-8, `;`, neutralisation des formules).
- `src/platform/v2/{finance,payroll}.ts` : hooks typés (`useApiAction` accepte désormais `idempotencyKey` et `responseType`).
- `src/app/v2/finance/_components`, `src/app/v2/payroll/_components` : écrans ; `page.tsx` = garde serveur ; `layout.tsx` = session + navigation.
- i18n : espaces de noms `v2Finance` et `v2Payroll` ; `src/app/v2/finance/messages-coverage.test.ts` vérifie chaque clé statique et chaque énumération.

## Tests

`pnpm --filter @ecoledigitale/web test` (Vitest + Testing Library, faux client API validant les réponses avec les vrais schémas Zod et vérifiant les corps et
en-têtes envoyés). Couvert notamment : **double clic sans double paiement**, reprise de la même clé après incident, nouvelle clé après correction,
formatage XOF entier, refus des décimales, conversions bps / permille, aperçu obligatoire avant émission, garde de tutelle (aucun appel finance pour un
enfant non rattaché), dryRun / recalcul, refus par séparation des tâches, états de chargement / erreur / vide.

Playwright : `PW_CHANNEL=msedge pnpm exec playwright test -c playwright.finance.config.ts` (Next seul) : chaque route compile, la garde serveur renvoie vers
`/login` sans session et aucun appel finance n'est émis (375 px et bureau). Les parcours authentifiés exigent NextAuth + API + Postgres : à écrire avec
l'infrastructure complète (encaisser et clôturer une caisse, calculer / arrêter / verser une période).
Le smoke est LENT en `next dev` (33 routes x 2 projets, 5 à 17 s de compilation chacune : prévoir plus de 30 minutes à froid) ; vérifié ici : les premiers tests passent (Edge, 375 px) et un balayage `curl` de 11 routes représentatives renvoie 307 vers `/login` (aucune 500) ; la série complète n'a pas été menée à terme.

## Écarts connus (API) et points à arbitrer

1. ~~Pas d'API finance « parent / élève »~~ **Levé** : `/finance/me/*` (`finance.child.read|pay`, `finance.self.read|pay`, propriété relue par `GuardianshipPort`, 404
   uniforme hors périmètre). Les écrans `/v2/finance/me` et les portails `/v2/parent`, `/v2/student` n'utilisent plus que ces routes (voir `v2-portals.md`).
2. ~~Reçus : pas de PDF serveur~~ **Levé** : `GET /finance/me/learners/:learnerId/receipts/:id/pdf` (scellé, QR de vérification publique, 202 pendant le rendu :
   `platform/ui/pdf.ts`). Le reçu reste imprimable depuis le navigateur ; le bulletin de paie a aussi son PDF (`/payroll/my/payslips/:id/pdf`).
3. **Export CSV financier côté web** : l'API finance n'a pas d'export ; les CSV de `/v2/finance/*` sérialisent les lignes déjà calculées (page affichée). Les CSV
   de paie sont ceux de l'API (audités, limités en débit). À arbitrer : export serveur complet pour les rapports finance (volumes, audit).
4. ~~Contestation par l'enseignant~~ **Levé** : `POST /payroll/my/payslips/:id/dispute` (`payroll.my.dispute`), écran `/v2/teacher/payslips/[id]` (motif de 3 à 500 caractères,
   bulletin arrêté et non versé).
5. **Clés libres des barèmes** (`levelKey`, `trackKey`, `learnerType`) : leur sens vient de l'adaptateur `EnrollmentDirectory` (non écrit) ; les écrans proposent
   une saisie libre avec suggestions (codes de niveaux). Idem `academicYear` (chaîne libre côté finance) : on utilise le **code** de l'année académique.
6. **Tarifs horaires** : le contrat porte `curriculumNodeId` ; le sélecteur propose les nœuds feuilles / rattachés à une matière des versions **publiées**
   (au plus 20 versions chargées). À confirmer : identifiant de nœud de version ou de lignée.
7. **Journal d'audit / jetons** : aucune route de lecture d'audit finance dédiée ; l'audit transversal est dans `/v2/audit`.
8. Noms d'apprenants dans les listes (factures, paiements, reçus) : une lecture `GET /people/students/:id` par apprenant distinct de la page (cache partagé),
   faute de route par lots ; sans `student.read`, un identifiant court est affiché.

## Parité legacy manquante

- Espace propriétaire : **saisie des charges** (`owner/economie`), tableaux de bord trésorerie / scolarité / rapport (`owner/finances/*`, `owner/scolarite`) :
  pas d'API v2 équivalente (charges d'exploitation absentes du module finance).
- Professionnel : commandes, lots et remboursements du parcours « professionnel » (`professionnel/admin`) ; commissions de prospection : hors module finance v2.
- Paie : écrans de **validation des séances** (séances manquantes, chevauchements, saisie comptable) : acte de `scheduling` (spec 032 §écart 1), pas de
  `/payroll/sessions*` ; relevé PDF de paie (`teacher/payments/:id/pdf`, `statement`) : remplacé par le document figé imprimable ; notification au
  titulaire : bouton « Envoyer au titulaire » (événement `payroll.payslip.notification_requested`).
- Finance : rapprochement manuel des webhooks en échec (`FAILED`) : aucune route de lecture du journal `webhook_events`.
