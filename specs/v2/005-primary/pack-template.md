# Modèle de pack Primary (en données) — 005-primary

**Statut** : Rédigée — référence du contenu instancié à l'activation du pack `PRIMARY` pour le système éducatif `CI`. Mécanisme commun à tous les packs : `tenancy.getPackTemplateSection(pack, educationSystem, section)` (003), instanciation idempotente par `(établissement, système, version de modèle)` (`template_applications`), jamais d'écrasement d'une ligne que le tenant a modifiée, jamais de suppression.

> **Rien n'est réglementaire ici.** Les libellés de niveaux viennent du PRD §12. Tout le reste est **fictif** (`placeholder`) ou **neutre**. Un modèle qui contiendrait une valeur sans `sourceKind` est refusé par le test de cohérence des modèles (AC1.2).

## 1. Sections et propriétaires

| Section | Fichier (cible) | Propriétaire | Statut du contenu |
|---|---|---|---|
| `academic` | `apps/api/src/modules/academic/templates/CI/primary.json` (existant) | 004 | À compléter : `calculationContract` (voir §2) |
| `assess` | `assess/domain/pack.ts` (`PACK_TYPE_TEMPLATES.classic`) | 011 | Réutilisé tel quel (types d'évaluation) |
| `attendance` | `attendance/templates/CI/primary.json` | 010 | Politique d'appel `DAILY` (§3) |
| `rules` | `rules` : liaisons par défaut posées à `tenancy.tenant.provisioned` | 012 | Liaisons vers `CI-PRIMARY-PLACEHOLDER` (§4) |
| `primary_school` | `apps/api/src/modules/primary_school/templates/CI/primary.json` | 005 | Échelle, référentiels, phrases : **placeholder** (§5) |
| `reportcards` | gabarits de plateforme (013) | 013 | Gabarits génériques (§6) |
| `rbac` | `rbac/templates/system-roles.ts` | 002 | Rôle `instituteur` (§7) |
| `finance` | modèle de pack finance | 014 | Catégories de frais, **aucun montant** (§8) |

## 2. `academic` (rappel et compléments à demander à 004)

Contenu existant : cycles `PRESCHOOL`/`PRIMARY` ; niveaux `PS, MS, GS, CP1, CP2, CE1, CE2, CM1, CM2` avec `next` et `isFinal` pour `CM2` ; types de périodes `TRIMESTER`, `SEMESTER`, `COMPOSITION`, `MODULE`, sessions ; plans `THREE_TERMS` et `TWO_SEMESTERS` ; types de financement ; issues `PROMOTED`, `REPEATED`, `ORIENTED`, `REORIENTED`, `EXCLUDED`, `GRADUATED` ; programmes `MATERNELLE` et `PRIMAIRE`.

Compléments (demande de changement) :

```json
{ "educationLevels": [
    { "code": "PRESCHOOL", "label": "Maternelle", "ordinal": 1, "calculationContract": "competency-period@1" },
    { "code": "PRIMARY",   "label": "Primaire",   "ordinal": 2, "calculationContract": "coef-period@1" } ],
  "periodPlans": [
    { "code": "THREE_TERMS", "label": "Trois trimestres", "slots": [
        { "type": "TRIMESTER", "ordinal": 1, "label": "Trimestre 1", "weight": "1" },
        { "type": "TRIMESTER", "ordinal": 2, "label": "Trimestre 2", "weight": "1" },
        { "type": "TRIMESTER", "ordinal": 3, "label": "Trimestre 3", "weight": "1" } ] } ] }
```

Le `weight` d'un créneau de période est la **donnée** que lit la règle `moyenne_generale_annuelle`. Les poids 1-1-1 sont **neutres** (aucune pondération supposée) ; la pondération officielle éventuelle est la question Q-P03. Le niveau `CM2` reste `terminal_exam_required = false` tant que la question Q-P09 n'est pas tranchée (le CEPE relève de 018, pas de la décision de passage).

## 3. `attendance` (010)

```json
{ "callPolicies": [ { "code": "PRIMARY_DAILY", "label": "Appel journalier", "scope": "DAILY", "educationLevels": ["PRESCHOOL", "PRIMARY"], "dailyMinutes": null } ] }
```

`dailyMinutes = null` : la conversion d'une absence journalière en minutes n'est pas supposée (les récapitulatifs ne comptent que des jours, AC2.2 de 010).

## 4. `rules` : liaisons par défaut (012)

| Contrat | RuleSet | Périmètre | Effet |
|---|---|---|---|
| `coef-period@1` | `CI-PRIMARY-PLACEHOLDER` | `level_code = PRIMARY`, institution du pack | Moyennes, rangs, MGA, proposition de décision |
| `competency-period@1` | `CI-PRIMARY-PLACEHOLDER` | `level_code = PRESCHOOL` | Proposition `PENDING` / `COUNCIL_REVIEW` |

Les liaisons sont posées avec `effective_from` = début de l'année courante ; en production, elles ne se posent qu'après accusé de l'usage d'un jeu fictif (`rules.placeholder_requires_ack`). Quand le RuleSet officiel est publié, la liaison est **remplacée** (nouvelle liaison datée) : aucune donnée antérieure n'est recalculée (les périodes closes gardent leur version épinglée).

## 5. `primary_school` (référentiels de démonstration)

```json
{
  "section": "primary_school",
  "schemaVersion": 1,
  "templateVersion": 1,
  "educationSystem": "CI",
  "pack": "PRIMARY",
  "ratingScales": [
    {
      "code": "MASTERY_4",
      "label": "Niveaux de maîtrise (échelle de démonstration)",
      "sourceKind": "placeholder",
      "levels": [
        { "code": "N1", "label": "Non acquis",             "ordinal": 1, "meetsExpectation": false },
        { "code": "N2", "label": "En cours d'acquisition", "ordinal": 2, "meetsExpectation": false },
        { "code": "N3", "label": "Acquis",                 "ordinal": 3, "meetsExpectation": true },
        { "code": "N4", "label": "Acquis avec aisance",    "ordinal": 4, "meetsExpectation": true }
      ]
    }
  ],
  "competencyFrameworks": [
    {
      "code": "PRESCHOOL_DEMO", "label": "Compétences de la maternelle (démonstration)",
      "scale": "MASTERY_4", "sourceKind": "placeholder", "gradeLevels": ["PS", "MS", "GS"],
      "domains": [
        { "code": "D1", "label": "Domaine 1 (démonstration)", "competencies": [
            { "code": "D1.1", "label": "Compétence 1.1 (démonstration)" }, { "code": "D1.2", "label": "Compétence 1.2 (démonstration)" } ] },
        { "code": "D2", "label": "Domaine 2 (démonstration)", "competencies": [
            { "code": "D2.1", "label": "Compétence 2.1 (démonstration)" } ] }
      ]
    },
    {
      "code": "PRIMARY_DEMO", "label": "Compétences du primaire (démonstration)",
      "scale": "MASTERY_4", "sourceKind": "placeholder", "gradeLevels": ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"],
      "domains": [
        { "code": "D1", "label": "Domaine 1 (démonstration)", "competencies": [
            { "code": "D1.1", "label": "Compétence 1.1 (démonstration)" } ] }
      ]
    }
  ],
  "appreciationPhrases": [
    { "code": "PERIOD_N1", "scope": "PERIOD", "body": "Des difficultés persistent ; un soutien est conseillé. (phrase de démonstration)", "ratingLevelCode": "N1", "sourceKind": "placeholder" },
    { "code": "PERIOD_N3", "scope": "PERIOD", "body": "Le travail est satisfaisant. (phrase de démonstration)", "ratingLevelCode": "N3", "sourceKind": "placeholder" },
    { "code": "YEAR_GENERIC", "scope": "YEAR", "body": "Appréciation de fin d'année à compléter par l'instituteur. (phrase de démonstration)", "sourceKind": "placeholder" }
  ],
  "settings": { "requireHomeroomForActivation": true, "councilRequiredForBilan": true, "phraseBankEnabled": true, "archiveRetentionYears": null }
}
```

Les **vrais** référentiels de compétences et la **vraie** échelle d'appréciation seront saisis (ou importés) par l'établissement ou fournis comme modèle une fois le texte officiel obtenu (`regulatory-sources-needed.md` §2.5) : un référentiel officiel est une nouvelle ligne `source_kind = regulation` avec sa référence, pas une modification du code.

`instantiatePrimaryReferenceData(ctx, institutionId)` : valide le JSON (schéma Zod `PrimarySchoolPackTemplateSchema`, propriété du module), crée échelles, niveaux, référentiels **publiés** (ils sont de démonstration : directement utilisables), phrases, paramètres, enregistre `template_applications` et publie `primary_school.template.applied`. Idempotent par `code` ; ne modifie jamais une ligne dont `updated_at` est postérieur à l'application.

## 6. `reportcards` (013)

Trois gabarits de plateforme **génériques**, versionnés, sans HTML libre :

| Gabarit | Contenu |
|---|---|
| `report-primary` | Identité de l'établissement (branding du tenant), élève et classe, période, tableau des matières (note, rang selon réglage, appréciation), bloc compétences par domaine (compteurs de niveaux), assiduité, appréciation générale, décision de fin d'année (dernière période), signatures (emplacements, jamais de nom par défaut), filigrane conditionnel « Règles de démonstration » |
| `annual-review-primary` | Bilan annuel : résultat d'année, synthèse des compétences, assiduité, décision du conseil, mention de version |
| `council-minutes` | PV du conseil : date réelle, participants (présence et signatures), décisions, justifications |

Les rubriques officielles (en-tête, devise, mentions) sont à fournir (`regulatory-sources-needed.md` §2.6) ; elles s'ajouteront comme **nouvelles versions de gabarit**, sans livraison de code.

## 7. `rbac` : rôle système `instituteur` (002)

Permissions du modèle (une liste de **permissions**, jamais un contrôle de rôle codé) : `attendance.take`, `attendance.read`, `assessment.create`, `assessment.update`, `grade.enter`, `primary.competency.read`, `primary.competency.record`, `primary.competency.validate`, `primary.phrase.read`, `primary.council.read`, `primary.council.prepare`, `student.class.read`, `messaging.read`, `messaging.send`, `messaging.announcement.publish_class`, `reportcard.read`. Absentes volontairement : `grade.validate`, `grade.publish`, `grade.revise.approve`, `primary.competency.revise`, `primary.bilan.seal`, `period.close`, toute permission `finance.*`. Le directeur reçoit l'ensemble ; le rôle `parent` reçoit `primary.competency.child.read` et `primary.bilan.child.read`.

## 8. `finance` (014)

Catégories de frais (libellés uniquement) : `REGISTRATION` (frais d'inscription, séparés de la scolarité, décision 2026-10-01 de `DECISIONS-METIER.md`), `TUITION` (scolarité). **Aucun montant** : barèmes et échéanciers sont saisis par l'établissement ; `finance` reste le seul propriétaire des montants (`Money`, entiers).

## 9. Jeu de démonstration (seeds, hors production)

Seeds déterministes (UUID fixes) pour tests de caractérisation, e2e et démos :

| Objet | Contenu |
|---|---|
| Établissement | `demo-primary` (pack `PRIMARY`, `CI`) |
| Disciplines | « Matière 1 (fictive) » à « Matière 5 (fictive) », coefficients 1 (neutres) ; une matière transversale « Conduite (fictive) » |
| Curriculum | un par niveau, publié, 5 matières + 1 transversale |
| Classes | « CE1 A », « CM2 A » ; 1 classe de maternelle « GS A » |
| Personnes | 2 instituteurs (titulaires `HOMEROOM`, `covers_all_subjects`), 40 élèves, tuteurs liés |
| Règles | `CI-PRIMARY-PLACEHOLDER` lié |
| Année | `2026-2027`, trois trimestres, deux périodes closes, une ouverte |
