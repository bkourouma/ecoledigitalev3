# Tests de caractérisation du code académique legacy (tranche 2.0)

> Plan : `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §4, tranche **2.0** (« exécuter le code actuel sur des scénarios fixes et figer les sorties en JSON »).
> Ces tests ne **corrigent** rien et ne **modifient** aucun fichier de `apps/` ni de `packages/`. Ils figent ce que le code legacy fait **aujourd'hui**, bogues compris,
> pour que le Rules Engine (tranche 2.4) et les cas d'usage v2 (2.5-2.7) aient un étalon à reproduire - ou à contredire en connaissance de cause.

Aucune donnée de production n'est utilisée : tout vient de scénarios déterministes écrits dans `scenarios/`.

## Lancer

```bash
pnpm test:characterization              # Postgres éphémère dans Docker, rejoue tout, échoue en cas de dérive (~2 min)
pnpm test:characterization -- -u        # RÉGÉNÈRE les snapshots (geste explicite, jamais automatique)
pnpm test:characterization -- tests/classique-terminale.test.ts   # un seul fichier
```

- Sans `TEST_DATABASE_URL`, `run.mjs` lance un conteneur nommé `ed-pg-it-<aléa>` (`packages/database/scripts/with-postgres.mjs`, image `postgres:17-alpine`,
  `ED_PG_IMAGE` pour en changer), l'utilise puis le supprime, même en cas d'échec. **Aucun Postgres local et aucune base existante n'est touché.**
- Avec `TEST_DATABASE_URL` (CI : service `postgres`), l'instance doit être **jetable** : le harnais crée et supprime ses propres bases `char_*` (`CREATE DATABASE` requis).
- `-u` (ou `CHARACTERIZATION_UPDATE=1`) est le seul moyen d'écrire une snapshot. Sans lui, une snapshot absente ou différente fait **échouer** le test avec le diff.
  Relire le diff avant de committer : un changement de snapshot est un changement du comportement figé.
- Le fuseau est forcé à UTC (le legacy utilise `getDay()` local pour les jours ouvrés de la paie ; la production tourne en UTC).

Durée mesurée : ~2 min (13 fichiers, 67 tests, 10 snapshots), dont ~6 s pour construire le schéma legacy une seule fois (base modèle, puis `CREATE DATABASE ... TEMPLATE` par fichier).

## Ce qui est exécuté pour de vrai

| Domaine | Code legacy réellement exécuté | Comment |
|---|---|---|
| Fonctions pures BTS/LMD | `apps/api/src/services/bulletin-calc.ts` (toutes les fonctions exportées) | import direct, aucune copie |
| Résultats, notes, rattrapage, conduite, clôture | `ProfessionalResultsService`, `professional-cloture-guard` | classes instanciées sur un `Pool` |
| Bulletins semestre/année, rangs, décisions, génération, clôture | `ProfessionalBulletinService` (`getBulletin`, `getBulletinBts`, `listRoster`, `listFullBulletins`, `generateBulletins`, `cloturerBulletins`...) | idem |
| Correction d'une copie | `ProfessionalAssignmentsService.grade` + `recomputeAfterGrade` | idem |
| Clôture des notes | `ProfessionalSemestreService.cloturerSemestre` | idem |
| Bulletin **classique** | `routes/semester-averages.ts` (`PUT/GET /matrix`, `POST /report-cards/pdf`) | plugin Fastify monté par `inject`, voir ci-dessous |
| Paie | `routes/payment-periods.ts`, `routes/teacher-payments.ts`, `routes/professional-remuneration.ts` -> `PaymentCalculator`, `hour-collectors/{academic,professional}`, `ProfessionalSeanceValidationService`, `TeacherPayrollOverviewService` | plugins Fastify montés par `inject` |

### Choix pour le bulletin classique (et pourquoi)

Les formules de `semester-averages.ts` (moyenne pondérée, `(S1+2·S2)/3`, mentions, décisions, distinctions, classement) sont des **fermetures non exportées**
du plugin de route. Trois options étaient possibles :

1. *copier les fonctions en test* (ce qu'a fait `packages/rules-engine/test/fixtures/legacy-semester-averages.ts`) : rapide, mais l'oracle n'est plus le code qui tourne en production ;
2. *modifier le legacy pour les exporter* : interdit par la mission ;
3. **appeler la route par `inject`** avec un contexte d'auth de test, et remplacer **uniquement** le dernier maillon `generateReportCardsPdfFromHtml` (Puppeteer) par une fonction qui range ses
   arguments (`harness/pdf-sink.ts`). **Choisi** : la route est exécutée en entier (SQL, classements, moyennes, mentions, décisions, formats d'absences) et ce qui est figé est exactement
   la liste de `ReportCardDocumentInput` que le rendu PDF aurait reçue.

Le contexte d'auth (`harness/app.ts`) lit `x-test-tenant`, `x-test-user` et `x-test-roles` dans des en-têtes : pas de JWT, pas de secret, aucun plugin d'auth legacy.

## Contournements du harnais (à connaître avant de se fier à une snapshot)

1. **Le schéma legacy n'est reconstructible depuis aucune chaîne seule** (`docs/inventory/README.md`). `harness/migrations.ts` applique : (a) toute la chaîne Prisma
   (`apps/api/prisma/migrations`, la baseline est un instantané du SQL ancien + 9 tables que le SQL ne crée pas), puis (b) les migrations SQL **à partir de 0029** seulement
   (ordre « préfixe numérique puis nom », hors `*_rollback.sql` et `validate_*.sql`, BOM retiré). Les migrations 0001-0028 ne sont **pas rejouées** : elles font double emploi avec la baseline,
   plusieurs sont cassées (syntaxe) et 0022 *supprime* la table `courses` de la baseline pour la recréer sans `bilan_type_id`. Une seule migration rejouée échoue encore :
   `0056_restore_pro_sessions_formateurs.sql` (Imhotep, supprimé en Phase 0) ; `tests/harness.test.ts` fige cette liste.
2. **Aucun correctif de schéma** n'est nécessaire (`LEGACY_HARNESS_PATCHES` est vide). La RLS est active mais l'utilisateur de test est super-utilisateur : elle ne filtre rien, exactement
   comme en production (l'API se connecte en propriétaire, cf. en-tête de la migration 0130).
3. **`courses.bilan_type_id` est NOT NULL** : tout cours classique doit avoir une section (« type de bilan »). Le seeder crée « Sans type de bilan » à défaut ; le libellé de repli du legacy
   (`COALESCE(bt.name, 'Sans type de bilan')`) est donc inatteignable avec ce schéma.
4. **Inscription à une cohorte** : `professional_enrollments.order_id` est NOT NULL, le seeder crée une commande `professional_orders` payée par (étudiant, promotion). La conduite n'a pas d'inscription.
5. **Dates** : `now()` de la base n'entre jamais dans une snapshot. Les horodatages deviennent `<timestamp>` ; la date de clôture d'un semestre est **réécrite à `2026-01-31T12:00:00Z`** juste après
   `cloturerBulletins` pour que le message légacy (« clôturé le 31/01/2026 ») soit stable.
6. **Identifiants** : UUID déterministes (v5) dérivés de (scénario, nature, clé) ; dans les snapshots ils deviennent des alias lisibles (`student:amina`, `cohort:bts1:UE101`). Les UUID générés par la
   base (résultats, notes) deviennent `<id>`. Un test interdit tout UUID ou horodatage résiduel.
7. **Ordres** : quand le legacy ne trie pas (liste des résultats de calcul de paie), le harnais trie ; les cartes sont indexées par clé de scénario, jamais par position.
8. `console.log` bruyant de `payment-periods.ts` coupé dans le test de paie ; `Email service not configured` (import de `email.service`) est inoffensif.

## Structure

```
tests/characterization/
  run.mjs, vitest.config.ts, tsconfig.json
  scenarios/                 DONNÉES déclaratives (types.ts, helpers.ts, index.ts, *.scenario.ts) - aucun nom de table legacy
  harness/                   migrations.ts  db.ts  seeder.ts (SEEDER LEGACY)  run-higher|run-classic|run-payroll.ts
                             oracle-*.ts (arithmétique exacte, détection des bogues)  defects.ts (catalogue)  snapshot.ts  normalize.ts
  tests/                     un fichier par scénario + harness, compare, snapshots-integrity, bulletin-calc-pure
  snapshots/                 *.snapshot.json
  compare.ts                 API de comparaison pour la Phase 2
```

### Scénarios (`scenarios/*.scenario.ts`)

Un scénario est un objet JSON (types dans `scenarios/types.ts`) : étudiants, enseignants, filières/programmes, UE et ECUE (crédits, coefficients), promotions, **notes** (devoirs/examen,
barème, session 1/2, saisie directe ou évaluation), présences, périodes, classes, moyennes saisies, configurations et tarifs de paie, séances, puis des **étapes** (`recompute`, `enter-grade`,
`generate-bulletins`, `close-bulletins`, `calculate`, `approve`, `pay`, ...). Le **seeder legacy** (`harness/seeder.ts`) les charge en SQL dans les tables legacy sans appeler de code legacy ; un futur
seeder v2 chargera les mêmes fichiers.

| Scénario | Couvre |
|---|---|
| `bts-premiere-annee` | (a) BTS 1re année, 2 semestres (20 et 36 crédits, année de 56) : compensation intra-UE, ECUE éliminatoire < 5, validation à exactement 10 et 9,99, UE incomplète, validation du jury, ex æquo au rang, 30/28/24 crédits en S2 (règle 20 crédits), année 50/48/44/56 crédits (règle > 48), bulletin BTS et bilan annuel |
| `licence-rattrapage` | (b) session 2 qui remplace la session 1, dette d'UE, décisions admis / rattrapage / ajourné, bulletin indisponible en attente de session 2, validation du jury, évaluations sur barèmes 10/20/40, liste des rattrapages |
| `classique-terminale` | (c)+(d) coefficients, sections, `(S1+2·S2)/3` (bornes 12, 15, 17, 18 exactes), ex æquo, mentions 16/14/12/10/8 et juste en dessous, appréciation du conseil, distinctions, décision de fin d'année, récapitulatif d'absences (« 00 », « 2,5 », « 100,5 »), refus de saisie (400) |
| `classique-flottants` | (g) 12 élèves dont 8 ont une moyenne pondérée exactement égale à 8/10/12/14/16 : le flottant les classe dessous ; coefficients décimaux 1,5 et 2,5 ; témoins exacts |
| `classique-nommage-periodes` | détection du 2e semestre et du BTS 2 par le **nom** (« S2 », « Deuxième semestre », « BTS2 Info ») |
| `conduite-absences` | (d) conduite (note unique comptée dans le semestre, validée à ≥ 10), absences justifiées / non justifiées du bulletin BTS, grille de saisie des conduites |
| `cloture-semestre` | (e) clôture des bulletins : saisie / modification / suppression / recalcul / correction de copie refusés, idempotence, rattachement par l'UE et par la cohorte, clôture des notes sans effet |
| `paie-enseignants` | (f) S17-T (Awa 55 000, Koné écarté), permanents salariés et mixtes, vacataires, séances académiques et professionnelles, heures supplémentaires, heures consommées, calculé → approuvé → payé, annulation, archivage |
| `notes-limites` | (g) 47 étudiants / 87 notes aux limites sur l'ECUE testée : les **24 couples** flottants à 10 (dont devoirs 0,4 / examen 16,4), les **8 couples** à 5, 0/20/4,99/5/5,01/9,99/10/10,01, devoirs sans examen, arrondi des devoirs, évaluation sur 10, UE à moyenne exactement 10 |
| `bulletin-calc-pure` (sans scénario) | toutes les fonctions pures de `bulletin-calc.ts` sur la grille de limites, `arrondi`, `normaliserNote`, `semestreValide`, `peutPasserAnneeSuperieure` |

### Ajouter un scénario

1. Créer `scenarios/<nom>.scenario.ts` : `export default defineScenario({ meta, tenant, students, teachers, higher | classic | payroll })` (aides dans `helpers.ts`). Pas de logique, pas de `Date` : de la donnée JSON.
   Les libellés d'étapes ne doivent contenir ni `.` ni `[` (ils servent de clés de chemin).
2. L'enregistrer dans `scenarios/index.ts`.
3. Créer `tests/<nom>.test.ts` en trois lignes (voir `tests/bts-premiere-annee.test.ts` ; pour la pile classique, recopier les deux `vi.mock` de `tests/classique-terminale.test.ts`).
4. `pnpm test:characterization -- -u tests/<nom>.test.ts`, **relire** `snapshots/<nom>.snapshot.json` et `knownLegacyDefects`, puis committer.

Les bogues sont détectés automatiquement par les oracles (`harness/oracle-*.ts`) : ils recalculent en arithmétique exacte (rationnels `BigInt`, `harness/exact.ts`) ce que la règle documentée impose, à partir
des seules notes déclarées, et signalent tout écart du legacy.

## Format des snapshots et bogues connus

```jsonc
{
  "schemaVersion": 1, "scenario": "notes-limites", "source": "legacy",
  "knownLegacyDefects": [ { "id": "FLOAT_ECUE_VALIDATION_10", "path": "observations.final.ecueResults.lim:UELIM.ten04/LIM.validee",
                            "legacy": false, "correct": true, "scope": ["observations.final.bulletins.SL.ten04.**", "..."], "note": "note exacte 10 ; flottant 9.999999999999998" } ],
  "defectCatalog": { "FLOAT_ECUE_VALIDATION_10": { "status": "bug", "title": "..." } },
  "data": { /* sortie normalisée, clés triées, cartes indexées par clé de scénario */ }
}
```

- `path` : valeur fausse (`a.b[2].c`, clés exotiques `["x.y"]`) ; `legacy` / `correct` : valeur observée / valeur imposée par la règle (ou « à arbitrer ... » quand la règle n'est pas tranchée) ;
  `scope` : sous-arbres où la v2 peut légitimement bouger **par conséquence** (crédits, décision, rang des autres, totaux...). Statuts : `bug`, `quirk` (voulu mais surprenant), `dead` (règle écrite jamais appliquée).
- Le catalogue complet (description, exemple chiffré, source) est dans `harness/defects.ts`.

### API de comparaison pour la Phase 2 (`compare.ts`)

```ts
import { loadScenario, loadSnapshot, compareWithTolerance } from "../../tests/characterization/compare";

const scenario = loadScenario("bts-premiere-annee");      // le même fichier de données que le legacy
// ... le seeder v2 charge `scenario`, l'exécution produit `actual` de même forme que `snapshot.data` ...
const snapshot = loadSnapshot("bts-premiere-annee");
const r = compareWithTolerance(actual, snapshot, { knownDefects: "bugs", tolerance: 1e-9 });
expect(r.differences).toEqual([]);      // aucune dérive inexpliquée
expect(r.stillDefective).toEqual([]);   // la v2 NE reproduit PAS les bogues connus
// r.corrected = bogues désormais corrects ; r.acceptedDivergences = écarts couverts par un bogue (chemin ou portée) ; r.unverified = « à arbitrer »
```

`knownDefects` : `"bugs"` (défaut : statuts `bug` et `dead`), `"all"` (y compris `quirk`), `"none"`, ou une liste d'identifiants. Les chaînes décimales (`"55000.00"`) se comparent comme des nombres.

## Bogues connus du legacy découverts (avec chiffres)

| Id | Statut | Constat chiffré | Où le voir |
|---|---|---|---|
| `FLOAT_ECUE_VALIDATION_10` | bug | **24 couples** (devoirs, examen) au centième donnent exactement 10 mais `0.4*d + 0.6*e < 10` : l'ECUE n'est ni validée ni compensée. Ex. 0,40 / 16,40 -> `9.999999999999998` | `notes-limites`, `bulletin-calc-pure`, `bts-premiere-annee` (fatou) |
| `FLOAT_ECUE_ELIMINATOIRE_5` | bug | **8 couples** valent exactement 5 mais `< 5` : ECUE éliminatoire à tort, **UE verrouillée**. Ex. 0,20 / 8,20 -> `4.999999999999999` | idem (ibrahim : UE à 11,5 bloquée) |
| `FLOAT_UE_VALIDATION_10` | bug | moyenne d'UE exactement 10 jugée < 10 : `(6.4×1 + 11.2×3)/4` et `(7.15×1 + 10.95×3)/4` -> `9.999999999999998` | `notes-limites`, `bulletin-calc-pure` |
| `ROUNDED_INPUTS_ECUE_RECOMPUTE` | bug | `moyenne_devoirs`, `note_examen`, `moyenne` sont stockés en `numeric(6,2)` puis le bulletin et la validation d'UE recalculent depuis ces valeurs arrondies : devoirs 9,99 et 10,00 (moyenne 9,995 -> 10,00), examen 10 : note exacte 9,998 (non validée) mais **UE validée** | `notes-limites` (devoirs-arrondis) |
| `DIVERGENT_ECUE_VALIDITY` | bug | le même cas : `professional_ecue_results.validee = false` (l'étudiant figure dans la liste des **rattrapages**) alors que le **bulletin** valide l'ECUE | `notes-limites` |
| `DISPLAY_ROUNDING_NOT_HALF_UP` | bug | `arrondi(x) = Math.round(x*100)/100` : 1,005 -> **1** (et non 1,01), 1,255 -> **1,25**, 9,995 -> **9,99** (PostgreSQL arrondirait 1,01 / 1,26 / 10,00) ; 3 valeurs sur 15 testées | `bulletin-calc-pure` |
| `DISPLAYED_AVERAGE_10_NOT_VALIDATED` | quirk | validation sur la valeur non arrondie (voulu, ADR-003) mais affichage arrondi : 9,996 s'affiche **10** avec une UE « en dette » | `licence-rattrapage` (rita), `bulletin-calc-pure` |
| `SESSION2_REPLACES_EVEN_IF_LOWER` | quirk | l'examen de session 2 remplace celui de session 1 même plus bas : 12 -> 4, l'UE passe de validée à **dette** (9,6) | `licence-rattrapage` (omar) |
| `RULES_NOT_WIRED_SEMESTER_20_CREDITS` | dead | `semestreValide(credits ≥ 20)` n'est appelée nulle part ; le bulletin applique « toutes les UE validées » : 30 / 28 / 24 crédits acquis sur 36 -> `true` selon la fonction, **ajourné** selon le bulletin (et l'inverse sur un semestre de 6 crédits) | `bts-premiere-annee` (bako, kofi, jade), `conduite-absences` |
| `RULES_NOT_WIRED_YEAR_48_CREDITS` | dead | `peutPasserAnneeSuperieure(> 48)` n'est appelée nulle part : aucune décision de passage annuel n'existe (56 -> true, **48 -> false**, 50 -> true, 44 -> false pour les 4 étudiants du bilan annuel) | `bts-premiere-annee` |
| `CLASSIC_FLOAT_WEIGHTED_MEAN` | bug | moyenne pondérée classique en double : 8 élèves sur 12 (5 avec coefficients 1 et 3, 3 avec 1,5 et 2,5) ont une moyenne exactement sur un seuil 8/10/12/14/16 et sont classés dessous, **60 occurrences** (mention, décision, appréciation, distinction, redoublement). Ex. 6,40 (coef 1) + 11,20 (coef 3) = 10 -> `9.999999999999998` : « Passable », « Renforcement recommande », **Redoublement** ; coefficients 1,5/2,5 : 6,10 + 15,54 = 12 -> `11.999999999999998` | `classique-flottants` |
| `CLASSIC_SEMESTER_DETECTED_BY_NAME` | quirk | 2e semestre reconnu par le nom : « S2 » -> moyenne annuelle 16 au lieu de 15,33 ((14+2×16)/3) ; « Deuxième semestre » sans « Semestre 1 » -> le S1 pris est la période **précédente** (« S2 ») : 13,33 au lieu de 12,67 ; « BTS2 Info » non reconnue BTS 2 ; **28 occurrences** | `classique-nommage-periodes` |
| `CLASSIC_REPEATING_FROM_DECISION_TEXT` | quirk | `repeating` déduit de la présence de « REDOUBL » dans le texte de la décision : « Redouble en cas d'échec au BTS » rend un élève à 12,67 de moyenne *redoublant* | `classique-nommage-periodes` |
| `PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE` | **bug** | une séance qui franchit le seuil hebdomadaire est coupée en 2 lignes de même `seance_id` ; `uniq_phd_payment_seance` refuse la 2e : **aucun bulletin** (compté dans `errors`), alors que l'aperçu affiche 344 818,18. Vu 5 fois (un calcul par étape) | `paie-enseignants` (Marc Mixte) |
| `PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY` | bug | deux périodes qui se chevauchent (autorisé depuis 0112) : 2 bulletins salariaux de 363 636,36 (permanent) et 2 de 126 909,09 / 90 909,09 (mixte) ; les heures, elles, ne sont pas repayées | `paie-enseignants` |
| `PAYMENT_ARCHIVE_REVIVES_CANCELLED` | bug | « Tout archiver » remet **approved** des bulletins `cancelled` (2 sur 8 archivés) ; leurs heures redeviennent « payées » | `paie-enseignants` |
| `PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE` | bug | `PATCH /:id/status` accepte annulé -> payé et calculé -> payé, et écrit `approved_by` avec un UUID codé en dur | `paie-enseignants` |
| `PAYSLIP_LINES_ROUNDING` | bug | tarif 3 333,33 × 1,5 = 4 999,995 enregistré 5 000,00, ligne de 4 h : 4 × 5 000,00 = 20 000,00 mais montant enregistré **19 999,98** | `paie-enseignants` (Cédric Centime) |
| `PAYMENT_RECALCULATE_ERASES_ADJUSTMENTS` | quirk | recalculer un bulletin `calculated` remet prime (5 000) et retenue (2 000) à 0 | `paie-enseignants` |

Comportements **voulus** à reproduire (non marqués comme bogues) : un étudiant dont une UE est à repasser n'a ni bulletin consultable ni bulletin généré (`SESSION2_PENDING`) ; une conduite < 10 rend le semestre non
validé sans rattrapage possible (« ajourné » d'emblée) ; clôturer les notes (cohortes terminées) ne bloque aucune saisie, seule la clôture des **bulletins** le fait ; une heure ne se paie qu'une fois (bulletin non annulé
d'une autre période) ; un enseignant sans configuration (`NO_CONFIG`), sans heure (`NO_HOURS`) ou sans tarif (`NO_RATE_RESOLVED`) est écarté du calcul avec son motif.

## Couverture par tranche 2.1 - 2.8

| Tranche | Couvert | Non couvert (à ajouter avant de supprimer l'ancien code) |
|---|---|---|
| **2.1** années, périodes, programmes, curriculum, classes | années et périodes classiques, rôle des noms de période ; filière / UE / ECUE / semestre / cohorte (deux chemins de rattachement) ; coefficients décimaux | CRUD `cycles` / `filieres` / `classes`, `annees_scolaires_sans_trou` (0118), `classe_noms_portee`, périodes typées |
| **2.2** élèves, tuteurs, personnel, inscriptions | inscriptions (classique et cohorte), matricule professionnel de filière, affectation enseignant -> ECUE, rattrapages vus par l'élève | tuteurs / `listChildRattrapages`, historique de statut, inscription publique, frais d'inscription |
| **2.3** présences, emploi du temps | absences justifiées / non justifiées du bulletin BTS, récapitulatif d'absences classique, séances d'ECUE et séances de présence enseignant (source des heures) | workflow de justification, détection de conflits, emploi du temps, `findSeancesManquantes` |
| **2.4** Rules Engine | **toutes** les formules : `bulletin-calc.ts`, moyennes pondérées, `(S1+2·S2)/3`, mentions, décisions, distinctions, classement, ex æquo, seuils, arrondi, bogues flottants | doublons web `bulletin-format.ts` (non exécutés ici) |
| **2.5** évaluations, notes, résultats, clôture, rattrapage | notes manuelles et d'évaluation, session 1/2, validation par le jury, résultats d'ECUE et d'UE, liste des rattrapages, clôture et ses gardes | workflow d'évaluations en ligne / IA, `submissions`, LMS |
| **2.6** bulletins, relevés, diplômes | JSON des bulletins (`professional_bulletins.data`, dont `decision`, `statut_etudiant`, `moyenne_session` lus par `owner-pedagogie` : **contrat figé** dans `generated`), documents du bulletin classique | rendu PDF, diplômes, attestations, transcripts, signataires |
| **2.7** rémunération | collecteurs académique et professionnel, calcul (horaire, salaire, mixte, heures supplémentaires cumulées), tarifs ECUE / cours, validation des séances, périodes, ajustements, états, heures consommées, S17-T | `owner-payroll-mass`, bulletins PDF, notifications, `course_assignments` / `teaching_hours` |
| **2.8** portails | lecture des rattrapages par l'élève, contrat `professional_bulletins.data` consommé par le tableau de bord owner | `parent-*`, `student-*`, `owner-*` (lecteurs) |

## Limites connues

- Les snapshots font ~1,9 Mo au total (le bulletin BTS est volumineux) : ils sont volontairement exhaustifs.
- Seules les 3 routes classiques/paie listées sont montées ; le reste de l'API (auth, middleware tenant, RLS par rôle) n'est pas exercé.
- `professional-bulletin` n'est caractérisé que sur des promotions de moins de 300 étudiants (garde-fou de performance du legacy, `rang = null` au-delà).
- Le rendu PDF (Puppeteer, jsPDF côté web) et les doublons de seuils de `apps/web` ne sont pas exécutés : le web ne doit plus calculer en 2.4, mais ses libellés restent à vérifier à part.
