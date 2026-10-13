# Plan d'implémentation des modules restants

Établi le 2026-10-12. Point de départ : `specs/v2/README.md` (index 000-033), `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`, `docs/guide-test-primary/LIMITES_A_TRAITER.md` (103 limites repérées), et l'état du code (`apps/api/src/modules/*`, `apps/web/src/app/v2/*`).

## 1. État de départ (résumé)

| Domaine | État |
|---|---|
| Socle (iam, rbac, tenancy, entitlements, audit, academic, people, attendance, scheduling, assess, results, rules, reportcards, finance, documents, messaging, notifications, analytics, payroll, admissions, examinations, imports) | Implémenté ; specs 000-003, 030, 031, 033 « à écrire » alors que du code existe |
| Pack Primaire | Implémenté et exercé de bout en bout (école La Réussite, année 2025-2026) |
| Pack Secondaire (councils, schoollife, stateassign) | Implémenté, **jamais exercé de bout en bout** comme le Primaire |
| Pack Supérieur (higher) | Cœur implémenté (UE/ECUE, crédits, diplômes) ; BTS complet et stages/soutenances absents |
| Pack Virtuel, LMS | Non implémentés (specs 022, 023 à écrire) |
| IA (026), facturation SaaS (027), intégrations (028), mobile hors-ligne (029) | Non implémentés |
| Limites connues | `LIMITES_A_TRAITER.md` : écrans manquants (matières, modification d'échelle ou de phrase, grille horaire…), comptes de test, entrées de menu sans écran |

## 2. Lots

Un lot = un superviseur (agent Sonnet 5.5, effort élevé) qui orchestre ses propres agents Sonnet 5.5 (effort moyen). Chaque lot travaille dans **son propre worktree git** et sa propre branche.

| Lot | Contenu | Specs | Dépend de | Décisions métier ? |
|---|---|---|---|---|
| **A. Fondations et sécurité** | Écrire/compléter les specs 000-003, 030, 033 ; durcissement sécurité et audit (rétention, export, révocation) ; comptes de développement (rôles instituteur, parent, élève… dans `add-account`, e-mails de dev), liaison compte ↔ fiche de personnel (L-01 à L-04) | 000-003, 030, 033 | — | Non |
| **B. Imports et mobile** | Imports (031) : modèles par entité, rapport d'erreurs, reprise ; PWA et hors-ligne (029) : appel, emploi du temps, notes | 031, 029 | — | Non |
| **C. Écrans manquants et limites** | Traiter `LIMITES_A_TRAITER.md` : écran Matières, modification d'échelle et de phrase, grille horaire, calendrier de l'établissement, paramètres de présence, menus sans écran, messages trompeurs | 004, 010, 017, 005 | — | Non (sauf arbitrages signalés) |
| **D. Validation Secondaire et Supérieur** | Exercer le Secondaire et le Supérieur comme le Primaire : école réelle, année complète, correction des défauts trouvés, guide de parcours (`WORKFLOW_SECONDARY.md`, `WORKFLOW_HIGHER.md`) | 006, 019 | A (comptes de dev) | Non |
| **E. Finance (spec 014 complète)** | Spec et complétion : barèmes, remises, échéanciers, relances, rapprochement, tableaux de bord ; données réelles sur l'école de test | 014 | — | Éventuel |
| **F. BTS et stages/soutenances** | BTS complet (règles d'examen, filières), stages et soutenances | 020, 021 | D | **Oui** : textes officiels, périmètre |
| **G. Pack Virtuel et LMS** | Classes virtuelles, supports de cours, devoirs, quiz | 022, 023 | A | **Oui** : périmètre du MVP |
| **H. Intelligence artificielle** | Usages retenus, garde-fous (données personnelles, traçabilité) | 026 | A | **Oui** : usages, politique de données |
| **I. Facturation SaaS et intégrations** | Facturation de l'abonnement (027) ; intégrations et webhooks sortants (028) | 027, 028 | A | **Oui** (027) : fournisseur de paiement, tarifs |
| **J. Intégration et recette** | Fusion des branches, résolution de conflits, exécution complète des tests, guides de test à jour | tous | A-I | Non |

Ordre : A, B, C, E démarrent tout de suite (aucune décision métier bloquante). D démarre dès que A a livré les comptes de développement ; il peut commencer par l'audit en attendant. F, G, H, I attendent les réponses métier. J clôt.

## 3. Décisions techniques (prises par le superviseur général)

1. **Isolation** : un worktree par lot (`isolation: worktree`), branche `feat/v2-lot-<lettre>-<nom>`. Aucun lot ne modifie le répertoire principal ni les autres branches.
2. **Bases de données** : les tests et essais n'utilisent **jamais** `ecoledigitale_v2` (qui contient l'école La Réussite) ni `dbecoledigitale`. Chaque lot crée sa base jetable `ed_lot_<lettre>_test` ; vérification du nom avant toute commande destructrice.
3. **Migrations** : les migrations propres à un module restent dans le dossier du module. Toute migration partagée (`infra/scripts/migrations`) réserve une plage par lot : A 5000-5099, B 5100-5199, C 5200-5299, D 5300-5399, E 5400-5499, F 5500-5599, G 5600-5699, H 5700-5799, I 5800-5899.
4. **Fichiers partagés** (registre des modules, `fr-CI.json`, `system-roles.ts`, `menu.ts`) : modifications minimales, groupées par bloc, avec en-tête de commentaire du lot ; la fusion finale (lot J) les réconcilie.
5. **Qualité** (définition de terminé) : specs à jour dans `specs/v2/<NNN-nom>/`, tests unitaires et d'intégration verts sur la base du lot, accessibilité des écrans (`axe`), messages en français dans `fr-CI.json`, permissions et isolation par tenant (RLS) testées, aucune règle officielle inventée (sources citées ou jeu marqué fictif).
6. **Sécurité** : aucune clé ni mot de passe dans le dépôt ; aucun envoi externe réel (e-mail, SMS, paiement) en développement.
7. **Données de test** : jamais de suppression de données existantes ; création d'écoles de test avec des slugs préfixés `lot-<lettre>-`.
8. **Sous-agents** : modèle Sonnet 5.5 effort moyen, une tâche bornée chacun ; le superviseur de lot répartit les fichiers pour éviter les écritures concurrentes.
9. **Commits** : sur la branche du lot uniquement, messages en français au format du dépôt ; aucun push.

## 4. Règle d'escalade

- **Décision technique** : le superviseur de lot décide, consigne le choix dans `specs/v2/<spec>/decisions.md`, et le mentionne dans son rapport.
- **Décision métier** (règle de gestion, texte réglementaire, tarifs, périmètre fonctionnel, libellé destiné aux utilisateurs) : le superviseur de lot **ne décide pas** ; il arrête la partie concernée, avance sur le reste, et renvoie une rubrique `QUESTIONS_METIER` avec options et recommandation.

## 5. Suivi

Chaque superviseur rend un rapport structuré : livré, en cours, bloqué, décisions techniques, questions métier, tests exécutés (nombre et résultat), branche et derniers commits. Le superviseur général consolide l'avancement dans la conversation.
