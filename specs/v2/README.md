# Specs v2 — EcoleDigitale SaaS

## Objectif

Ce dossier contient les spécifications Spec Kit de la **plateforme EcoleDigitale SaaS** (socle multi-tenant, packs Primary / Secondary / Higher / Virtual). Elles découlent du PRD `docs/PRD_EcoleDigitale_SaaS.md` (§67) et du plan `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` (§6), qui fait foi.

`specs/001..031` à la racine de `specs/` est l'**historique** de l'application actuelle : il reste intact et n'est plus alimenté.

## Configuration Spec Kit

Les scripts `.specify/scripts/powershell/*.ps1` (et le script bash de l'extension git) lisent le dossier de specs dans cet ordre :

1. variable d'environnement `SPECIFY_SPECS_DIR` (relatif à la racine du dépôt, ou absolu) ;
2. clé `specs_dir` de `.specify/init-options.json` (ici `specs/v2`) ;
3. à défaut, `specs`.

La commande suivante, sans effet de bord, donne le prochain numéro et le chemin de la spec :

```powershell
pwsh -File .specify/scripts/powershell/create-new-feature.ps1 -DryRun -Json -ShortName exemple "Exemple"
```

## Règle de numérotation

- Les numéros de `specs/v2/` sont **propres à ce dossier** : `000` à `033`, indépendants de `specs/001..031`.
- Format : `NNN-nom-court` (3 chiffres minimum, minuscules, tirets), identique au nom de la branche de travail.
- Les numéros `000` et `031` à `033` sont des ajouts du plan (le PRD s'arrête à `030`).
- Le numéro suivant est calculé par Spec Kit (`max(sous-dossiers de specs/v2, branches git numérotées) + 1`). Pour une spec prévue au plan, on **force** le numéro du plan avec `-Number N`, afin que le dossier corresponde à l'index ci-dessous.
- Une spec = un dossier contenant `spec.md`, puis `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `tasks.md`.
- Chaque spec suit le gabarit du plan : objectifs, périmètre, acteurs, user stories, règles métier, critères d'acceptation, modèle de données, endpoints, écrans, permissions, événements, tests, cas limites, dépendances.
- Un dossier n'est créé que lorsque la spec est écrite : l'index ci-dessous est la seule trace des specs « À écrire ».

## Index des specs

Phases du plan §4 : 0 = cadrage, 1 = socle SaaS, 2 = cœur académique et migration Higher, 3 = finance migrée / communications / documents / imports, 4 = Primary, 5 = Secondary, 6 = durcissement V1.

| N° | Spec | Phase | Statut |
|----|------|-------|--------|
| 000 | platform-foundation | 1 | Squelette (`000-platform-foundation/spec.md`) |
| 001 | saas-core | 1 | À écrire |
| 002 | auth-rbac | 1 | À écrire |
| 003 | organization-campus | 1 | À écrire |
| 004 | academic-core | 2 | Rédigée (`004-academic-core/`) |
| 005 | primary | 4 | À écrire |
| 006 | secondary | 5 | À écrire |
| 007 | admissions | 4 | À écrire |
| 008 | students-guardians | 2 | Rédigée (`008-students-guardians/`) |
| 009 | teachers-staff | 2 | Rédigée (`009-teachers-staff/`) |
| 010 | attendance | 2 | Rédigée (`010-attendance/`) |
| 011 | assessments-grades | 2 | Rédigée (`011-assessments-grades/` : spec, data-model, plan, parity, interfaces-publiees ; modules `assess` + `results`) |
| 012 | rules-engine | 2 (spike en phase 0) | Rédigée (`012-rules-engine/` : spec, data-model, plan, parity, rule-contracts, rulesets-de-depart, regulatory-sources-needed, open-questions) |
| 013 | report-cards | 2 | Rédigée (`013-report-cards/` : spec, data-model, plan, parity) |
| 014 | finance | 1 puis 3 | Extensions d'API rédigées (`014-finance/` : routes famille, exports, PDF, clés de barèmes) ; spec complète à écrire |
| 015 | payments | 1 puis 3 | À écrire |
| 016 | communications | 3 | À écrire |
| 017 | scheduling | 2 | Rédigée (`017-scheduling/`) |
| 018 | examinations | 4 | À écrire |
| 019 | higher-education | 2 | Rédigée (`019-higher-education/` : spec, data-model, plan, parity) |
| 020 | bts | Après V1 | À écrire |
| 021 | internships-defenses | Après V1 | À écrire |
| 022 | lms | Après V1 | À écrire |
| 023 | virtual-school | Après V1 | À écrire |
| 024 | documents | 3 | À écrire |
| 025 | analytics | 6 | Écrite et implémentée (partie direction / propriétaire : `025-analytics/`) |
| 026 | ai | Après V1 | À écrire |
| 027 | subscriptions-billing | Après V1 | À écrire |
| 028 | integrations | Après V1 | À écrire |
| 029 | mobile-offline | 1 (squelette), 6 | À écrire |
| 030 | security-audit | 1, 6 | À écrire |
| 031 | imports | 3 | À écrire |
| 032 | payroll-port | 2.7 / 3 | Rédigée (`032-payroll-port/` : spec, data-model, plan, parity) |
| 033 | web-foundation | 1 | À écrire |

Les noms complets des dossiers seront `NNN-<nom>` (par exemple `001-saas-core`).
