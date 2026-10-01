# Plan d'implémentation — 032-payroll-port

**Statut** : Rédigé. Tranches du plan : **2.7** (« les collecteurs d'heures lisent le nouveau modèle ») pour les sources, puis **Phase 3** pour la suppression des tables `teacher_payments*` (plan §6 : « ne PAS migrer les tables `teacher_payments*` en 2.7, seulement les sources d'heures »). Dépend de 017 (séances), 010 (présences enseignants), 009 (personnel), 004 (nœuds de curriculum, libellés), 013 (rendu). Le plan L0-L8 de la portabilité (§14) est conservé : **ne pas commencer par les écrans**.

## 1. Ordre et dépendances

```
Prérequis : kernel, TenantDb, outbox, worker, rbac, audit (Phase 1) ; 013 DocumentRenderer ; ports 017/010/009 (ou faux)
                          │
 ┌─────────────┬──────────┴───────────┬─────────────────┐
 ▼             ▼                      ▼                 ▼
T-P-CHAR    T-P-DOMAIN             T-P-DB            T-P-PORTS
(figer le   (moteur PUR :          (DDL, contraintes, (interfaces + faux +
 legacy)     salaire/horaire/mixte, déclencheurs)      contract tests)
             heures sup, tarif)
 │             │                      │                 │
 └─────┬───────┴──────────┬───────────┴─────────────────┘
       ▼                  ▼
  T-P-COLLECT         T-P-RATES-CONF
  (collecteurs,       (configurations, tarifs, résolution,
   payabilité unique,  état à 4 valeurs, simulateur)
   validation séances)
       │                  │
       └────────┬─────────┘
                ▼
          T-P-CALC (cas d'usage de calcul : aperçu, recalcul, réclamations, compte rendu)
                │
                ▼
          T-P-WORKFLOW (approbation, versement, annulation, contestation, ajustements, journal, owner)
                │
 ┌──────────────┼──────────────┐
 ▼              ▼              ▼
T-P-PDF      T-P-REPORTS    T-P-HTTP ─► T-P-WEB ─► T-P-E2E ─► T-P-CLEAN
(snapshot +  (ventilation à  (+ /my, /owner,
 rendu 013)   trois postes)   accès titulaire)
```

## 2. Tâches

### T-P-CHAR — Caractérisation du legacy (S) — **premier**
- **Fichiers** : `tests/characterization/payroll/*`.
- **Contenu** : porter `verify-remuneration-031.js` (25 invariants), `seed-remuneration-professionnelle.js` et le scénario S17-T ; figer les montants de bulletins (salaire, horaire, mixte, heures sup à cheval sur le seuil, multi-origines, deux périodes chevauchantes, annulation, recalcul) en JSON ; **durées multiples de 0,25 h** pour la comparaison exacte avec le moteur v2.
- **Fin** : JSON rejouables ; liste signée des écarts attendus (arrondis, prorata multi-mois, tarifs académiques datés, inactifs).

### T-P-DOMAIN — Moteur de calcul pur (M) — *chemin critique*
- **Fichiers** : `modules/payroll/domain/{calculation,payability,rates,calendar,money}.ts` (aucun import `pg`/`fastify`).
- **Contenu** : `computePayslip(input)` ; `isPayable`, `retainedMinutes` ; `resolveRate` ; calendrier sur dates (semaines lundi, jours ouvrés) ; arithmétique `bigint` avec arrondi demi-supérieur ; ordre total des heures ; `calc_details`.
- **Fin** : tests unitaires sans base (T1-T4, T9, T10 en pur) ; différentiel contre `payment-calculator.ts` sur durées multiples de 0,25 h = écart 0 ; tests de propriété (permutation des heures ⇒ même résultat).

### T-P-DB — Schéma et contraintes (M)
- **Fichiers** : `modules/payroll/migrations/1500-1507_*.sql`.
- **Fin** : `data-model.md` ; isolation générique ; tests : `hour_claims` PK, `CHECK` de formule de ligne, `EXCLUDE` tarifs/configurations, transitions de statut (y compris `PAID ⇒ approved_at`), totaux différés, `DELETE` refusés, annulation relâche les heures, journal append-only.

### T-P-PORTS — Ports (S)
- `SessionHoursPort`, `TeacherAttendancePort`, `StaffDirectoryPort`, `CurriculumLabelPort`, `DocumentRenderer` + faux en mémoire alimentés par T-P-CHAR ; contract tests que 017/010/009 doivent passer ; gestion d'erreur : panne d'un port ⇒ calcul refusé (jamais partiel silencieux).
- **Fin** : `payroll` testable sans 017/010/009.

### T-P-COLLECT — Collecteurs et validation des séances (M)
- **Fichiers** : `modules/payroll/{application,infrastructure}/collectors/*`, `application/sessions/*`.
- **Contenu** : `SessionHourCollector`, `AttendanceHourCollector` (une lecture par origine pour la période) ; filtrage selon `hour_source_by_pack` ; validation en lot partielle ; dérogation de durée ; séance comptable (via 017) ; séances manquantes ; chevauchements ; compteurs serveur ; tri passé-d'abord.
- **Fin** : AC1.* ; 300 séances paginées à 10 ⇒ compteurs 300 ; lot 199/1.

### T-P-RATES-CONF — Configurations et tarifs (S)
- CRUD, `EXCLUDE`, état calculé `ACTIVE|EXPIRED|FUTURE|ABSENT`, simulateur de résolution, préchargement en index mémoire.
- **Fin** : AC5.* ; un enseignant à configuration expirée est signalé « expirée ».

### T-P-CALC — Cas d'usage de calcul (L)
- **Contenu** : collecte → réclamations → calcul pur → persistance transactionnelle (bulletin, lignes, réclamations) ; aperçu sans persistance ; recalcul idempotent (suppression/réinsertion dans une transaction) ; verrouillage (`APPROVED/PAID` non réécrits, signalés) ; compte rendu conservé ; concurrence (verrou fonctionnel par période) ; périodes ciblées ; enseignants inactifs avec heures validées.
- **Fin** : T1-T12, T17 (500 × 100 ≤ 30 s) ; deux calculs concurrents sur périodes chevauchantes ne paient jamais deux fois.

### T-P-WORKFLOW — Workflow, ajustements, journal, owner (M)
- **Contenu** : `approvePayslips`, `payPayslips`, `cancelPayslip`, `disputePayslip`, `adjustPayslip` ; `{ all: true, periodId }` ; séparation des tâches et seuil propriétaire ; journal à auteur figé ; audit ; événements ; `/owner/*`.
- **Fin** : T14, T15, T20 ; matrice de transitions ; `expectAudited`.

### T-P-PDF — Snapshot et bulletin PDF (M)
- **Contenu** : snapshot figé à l'arrêt du montant (identité, période, configuration en vigueur, base de calcul, totaux, option de lignes détaillées) ; gabarit `payslip` plateforme (013) ; filigrane « NON VERSÉ » ; accès enseignant à `PAID` seulement.
- **Fin** : le PDF ne calcule rien ; branding par tenant ; pas d'identité en dur.

### T-P-REPORTS — Rapports et historique (S)
- Vue `v_payslip_breakdown`, filtre d'origine, ventilation à trois postes, export CSV, historique, masse salariale owner.
- **Fin** : T18 ; export = colonnes de l'écran.

### T-P-HTTP — Plugin Fastify (M)
- Routes statiques avant paramétrées ; contrôle de propriété **dans le cas d'usage** ; `/my/*` sans identité en paramètre ; rate limiting ; aucune route de purge.
- **Fin** : matrice d'accès complète (T16) ; aucune SQL dans `http/`.

### T-P-WEB — Écrans (L) — *après 033-web-foundation*
- Configuration, validation des séances, bulletin de paiement, historique, rapports, espace enseignant, masse salariale owner.
- **Fin** : Playwright par portail ; S17-T rejoué ; aucun calcul dans le web.

### T-P-E2E — Cycle mensuel complet (M)
- Période → configurations → séances (017) → validation → calcul → contrôle des écartés → arrêt → versement → PDF → historique ; comparaison aux sorties figées de T-P-CHAR.

### T-P-CLEAN — Suppression du legacy (M)
- Supprimer les services, routes, collecteurs et tables listés en tête de `parity.md` (en conservant le journal comme filet) ; mettre à jour l'inventaire ; vérifier en base que `teaching_hours` est vide avant de la supprimer.

## 3. Risques

| # | Risque | P / I | Atténuation |
|---|---|---|---|
| R1 | **Identifiants de séances instables** en 017 (changement d'id ⇒ heures repayées) | moyenne / **forte** | Exigence explicite (spec §13) ; `hour_claims` portant l'identifiant stable ; test de non-régression « renumérotation » ; alerte `payroll.claim.source_changed`. |
| R2 | 017/010 non prêts : ports sans fournisseur réel | **forte** / forte | Faux fournisseurs et contract tests ; le calcul est testable sans eux ; le branchement réel est la dernière brique avant T-P-E2E. |
| R3 | Écarts de centimes entre v1 et v2 interprétés comme des erreurs de paie | moyenne / moyenne | Durées en minutes, arrondi documenté, liste des écarts signée avant bascule, comparaison en parallèle sur une période test. |
| R4 | Contradiction spec ↔ code sur les enseignants inactifs | moyenne / moyenne | Q-40 ; comportement de la spec 031 retenu. |
| R5 | Tarifs académiques : le legacy ignorait la date de séance ; la v2 la respecte ⇒ montants différents | moyenne / moyenne | Signalé dans T-P-CHAR ; revue avec le comptable ; pas de rétroactivité (aucune donnée de prod à migrer, D8). |
| R6 | Perte de la confiance dans « calculé » si des heures arrivent après le calcul | moyenne / moyenne | Bandeau « séance validée après le calcul n'y figure pas : relancez le calcul » (libellé corrigé le 2026-09-30) ; aperçu avant arrêt. |
| R7 | Dépendance cachée au module Imhotep (formateurs) | faible / faible | Hors périmètre (D7) ; `formateurs` supprimés avec Imhotep. |
| R8 | Montants sensibles dans les journaux ou les exports | moyenne / forte | Exclusion des journaux applicatifs ; exports audités ; permissions sensibles + MFA. |
| R9 | Calcul concurrent sur la même période (double clic, deux gestionnaires) | moyenne / moyenne | Index d'unicité `calculation_runs_running_uq` ; verrou de période ; idempotence. |
| R10 | Volumétrie de `payslip_lines` pour de gros vacataires | faible / faible | Index ciblés ; PDF sans détail par défaut ; pagination du détail. |

## 4. Estimation relative

S ≈ 1-2 sem., M ≈ 3-5, L ≈ 6-10. Cumul : **XL** (S+M+M+S+M+S+L+M+M+S+M+L+M+M). Chemin critique : T-P-CHAR → T-P-DOMAIN → T-P-CALC → T-P-WORKFLOW → T-P-E2E → T-P-CLEAN.

## 5. Définition de fini

CI verte (unitaires purs, intégration, isolation, `dependency-cruiser`, lint) ; T1-T20 verts ; 25 invariants de `verify-remuneration-031` portés en tests ; matrice d'accès verte ; audit présent ; manifeste (permissions, features, événements) à jour ; migrations sur base vide et incrémentale ; documentation d'exploitation (cycle mensuel, reprise d'un calcul, annulation, rotation des configurations) ; anciens artefacts supprimés pour la tranche.
