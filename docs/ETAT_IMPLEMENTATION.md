# État de l'implémentation EcoleDigitale v2

Mis à jour le 2026-10-05 sur la branche `feat/v2-phase-0` (environ 680 commits, locale, rien n’est poussé). Référence de pilotage : `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`.
Décisions métier validées : `specs/v2/DECISIONS-METIER.md`. Questions encore ouvertes (valeur par défaut appliquée) : `specs/v2/QUESTIONS-A-VALIDER.md`. Décisions d'architecture : `docs/adr/`. Contrat des modules : `docs/architecture/module-conventions.md`, `platform-assembly.md`, `new-module-guide.md`.

## Terminé et fusionné

| Domaine | Contenu |
|---------|---------|
| Phase 0 | Renommage EcoleDigitale, ADR 001-009, `specs/v2/`, CI de base, scan de secrets, inventaire d'impact, code Imhotep retiré (aucune table supprimée) |
| Packages | `kernel`, `database` (TenantDb, SystemDb, migrations, RLS, test d'isolation), `rules-engine` (DSL sandboxé), `contracts` (29 fichiers Zod v2) |
| Plateforme | Registre de modules auto-découvert, `ModuleRuntime`, frontières `dependency-cruiser`, générateur `pnpm module:new`, test d'isolation global, `apps/worker` (BullMQ, outbox), adaptateurs entre modules (`platform/adapters`), observabilité (ADR-009 : pino avec redaction, OTel, métriques, `/health` `/ready`) |
| Modules backend (28) | `tenancy`, `entitlements`, `iam`, `rbac` (14 rôles système), `audit`, `finance` (paiements réels, rapprochement, remboursements), `academic`, `people`, `attendance`, `scheduling`, `rules`, `assess`, `results`, `reportcards`, `higher`, `payroll`, `analytics`, `messaging`, `documents`, `notifications` (e-mail, SMS dont Orange, WhatsApp, push), `imports`. **Pack Primary** : `primary_school`, `admissions`, `examinations`. **Pack Secondary** : `schoollife`, `stateassign`, `councils` |
| Authentification | Passerelle IAM <-> legacy, import des utilisateurs (`pnpm iam:import-legacy`), pages web derrière `NEXT_PUBLIC_AUTH_V2`, plan de bascule `docs/architecture/auth-cutover.md` |
| Web `/v2` | 285 pages : fondation, administration, cœur académique et personnes, authentification V2, portails parent/élève/enseignant, finance, paie, supérieur, documents, messagerie, imports, admissions (dont pages publiques), primaire, vie scolaire, élèves affectés par l'État, examens, conseils de classe |
| Qualité | 113 migrations de modules, 442 fichiers de test API, 155 côté web ; caractérisation du legacy ; audit d'accessibilité axe (0 violation serious/critical sur 1127 écrans testés) |

Mesures de contrôle de cette session : `check:boundaries` (1902 modules, 0 violation), `check:secrets` propre, `type-check:v2` 0 erreur, web 127 fichiers / 1613 tests verts, tests de bout en bout Primary et Secondary (`pnpm test:phase3`) 74/74, `test:isolation` vert, RBAC 292 tests (+60 d'intégration sur base éphémère, verts selon l'agent). Suite complète de `apps/api` rejouée d'un seul bloc le 2026-10-05 : 452 fichiers, 6778 tests verts ; phases 1/2/3 : 81/91/75 ; web 1832/1832 ; démo `demo:smoke` 191/191.

## Phase par phase du prompt « phases restantes »

| Phase | État |
|-------|------|
| A — assemblage Phase 2 | Terminé : année scolaire simulée, critères de sortie Phase 1, adaptateurs, RBAC complet |
| B — Phase 3 (paiements, notifications, documents, imports) | Terminé côté code ; fournisseurs réels en sandbox/désactivé par défaut |
| C — Pack Primary | Livré : `primary_school`, `admissions`, `examinations` + extensions de `rules`, `results`, `reportcards`, `academic`, `people`, `finance` ; règles officielles = jeux `placeholder` marqués |
| D — Pack Secondary | Livré : `schoollife`, `stateassign`, `councils` ; BEPC/BAC/passage = mécanisme + paramètres vides, aucune règle officielle inventée |
| E — qualité et exploitation | Terminé : accessibilité (axe), revue de sécurité (36 constats, critiques et élevés corrigés, `security-review-v2.md`), correctifs de dépendances (263 -> 36 avis, 0 critique), tests de charge et optimisations (`perf-report.md`), tableaux de bord de direction et alertes (spec 025 B), hors-ligne avancé (emploi du temps, notes), exercice de restauration (32/32 contrôles, `runbook-exploitation.md` §12) |

## En cours

Rien : tous les agents de la passe autonome sont terminés et fusionnés.

## Décisions métier (2026-10-05)

Les 29 écarts demandés sont implémentés (liste : fin de `specs/v2/REPONSES-METIER.md`), dont les cinq à risque cadrés (Q-P18, Q-PAY-30, Q-13, O-11 imports, Q-PAY-38), le générateur d'emploi du temps (O-05) et la recherche dans les PDF (Q-14). Points ouverts : reversement des fonds partagés (Q-PAY-30) non modélisé ; `pdf-parse` à embarquer dans l'image du worker ; `xlsx` (avis sans correctif) confiné à un processus enfant ; `GRANT DELETE` accordé sur `documents.text_index` seulement ; générateur limité à une semaine type.

## Démonstration locale

`pnpm demo:up` démarre toute la pile v2 sur la machine (Postgres 17 et Redis 7 dans Docker `ed-demo-*`, migrations, trois établissements de démonstration Secondaire / Primaire / Supérieur, API, worker, web), avec un compte par rôle et des secrets générés à l'exécution (`.demo/`, ignoré par git) ; `demo:down`, `demo:reset`, `demo:totp`, `demo:smoke` (191 contrôles). Guide : `docs/DEMO_TEST_GUIDE.md`. Règles de calcul : jeux de démonstration, aucun envoi réel, paiements en fournisseur sandbox.

## Reste à faire

1. **Restes techniques** : voisin bruyant en lecture (x3,5 pour un objectif x3), test de charge à pleine échelle, avis de dépendances restants (27 : `nodemailer`, `xlsx`, `sharp`, `extract-zip`, `next-intl`...), exercice de restauration sur serveur réel, écran d’appel non balayé par le QA, 89 états vides de démo à confronter à la graine (voir le rapport QA), 401 sur `/me/*` sans profil lié, `/unauthorized` dans l’ancienne coque.
2. **Compléments connus des packs** (additifs, voir les README de modules) :
   - `admissions` : édition d'une candidature existante côté web. *(Fait le 2026-10-02 : événements `admissions.interview.scheduled|rescheduled|cancelled` ; rattachement des pièces à la GED différé et confirmé par un humain, sans acteur système — voir le README du module.)*
   - `councils` : sélecteur de participant externe et formulaire de vœux d'orientation (web). *(Fait le 2026-10-02 : retrait unitaire d'une décision/distinction dans `results`, PV remplacé marqué par `reportcards` à la réouverture, accès `label_map` de `rules` pour libeller les propositions ; restent hors périmètre les échecs préexistants de `test/events-catalog.test.ts` et de la couverture des contrats d'événements, voir le README de `councils`.)*
   - `schoollife` : consommation par `attendance` de `schoollife.measure.validated` (dépend de la question métier Q6-19, toujours ouverte). *(Fait le 2026-10-02 : jobs `remind-convocations` et `exclusion-boundaries` éteints par défaut, clé d'idempotence serveur de la saisie rapide d'incidents.)*
   - `stateassign` : passerelle réelle vers la plateforme de l'État (spécification officielle inconnue).
   - `finance` : écran web de lecture des événements webhook en échec (la route et le rejeu sûr existent depuis le 2026-10-02, permissions `finance.webhook.read|replay` à accorder aux rôles), saisie des charges et tableaux de bord propriétaire (trésorerie, scolarité), commandes/lots du parcours professionnel, commissions de prospection.
   - Menus des portails : harmonisation des href.
3. **Mise en service** : actions à fort impact, à faire par un humain (ci-dessous).

## À faire par un humain (hors du périmètre autonome)

- **Sécurité en production** : corriger `/auth/social-login` du legacy (le correctif existe, il nécessite `AUTH_SOCIAL_SHARED_SECRET`) ; **faire tourner les secrets qui ont été exposés** ; sauvegarde complète de la production avant tout reset.
- **Bascule** : reset de la base et archivage des migrations legacy, suppression du code legacy et de Prisma, image du worker (Chromium), variables d'environnement et rôles de base de production, bascule de l'authentification (`docs/architecture/auth-cutover.md`), nettoyage du serveur Imhotep. Rien de cela n'a été fait.
- **Fournisseurs externes** : contrat et identifiants Orange SMS (adaptateur livré en mode `disabled`/`sandbox` ; ses chemins d'API sont à confirmer avec la documentation Orange), comptes Orange Money, MTN MoMo, Wave, CinetPay, TresorPay.
- **Textes officiels ivoiriens** : MGA, CEPE, BEPC, BAC, passage, barèmes, modèles de bulletin et de procès-verbal. Les jeux de règles livrés sont des `placeholder` avec bandeau « règles de démonstration ».
- **Validations visuelles et manuelles** : couleur « destructive » éclaircie pour le contraste (changement visuel global), passe lecteur d'écran, reflow 320 px.
- **Questions métier** : `specs/v2/QUESTIONS-A-VALIDER.md` (244 questions avec défaut appliqué).

## Décisions métier prises par l'utilisateur (2026-10-02)

Conduite non notée : semestre « en attente » ; précision des notes : 3 décimales sans arrondi intermédiaire ; paie : francs entiers ; fournisseur SMS : Orange SMS API.

## Dette connue

- tsc legacy : 365 erreurs (API), 412 (web) ; ne doivent pas augmenter. Jest legacy : 8 suites en échec historiques.
- Tests de performance (payroll, attendance, scheduling, rules, reportcards) sensibles à la charge de la machine : à relancer isolément (`ED_PERF_FACTOR`).
- Les parcours authentifiés des écrans `/v2` ne sont couverts que par Vitest (pas de Playwright avec infra complète).
- Orange SMS : livraison « au moins une fois » (pas de clé d'idempotence côté API).
- Le lien de réponse à une offre d'admission figure dans le contenu mis en file du journal de `notifications` (purgé par le ménage du module).

## Questions métier ouvertes

Voir `specs/v2/QUESTIONS-A-VALIDER.md` (consolidation) et les `open-questions.md` par spec. Les valeurs par défaut sont appliquées tant qu'elles ne sont pas tranchées.
