# Feature Specification: Imports Excel / CSV (031-imports)

**Feature Branch**: `031-imports`
**Created**: 2026-10-02
**Status**: Rédigée et implémentée (module backend `imports`, schéma Postgres `imports`, migrations `2400-2499`, écrans `/v2/imports/*`). DDL : `data-model.md` ; plan : `plan.md` ; parité : `parity.md` ; décisions à arbitrer : `open-questions.md`.

**Sources** : `docs/PRD_EcoleDigitale_SaaS.md` §56 (onboarding) et §57 (import Excel) ; plan §3.13 ; `docs/architecture/module-conventions.md`, `new-module-guide.md`, `platform-assembly.md` ; `apps/worker/README.md` ; specs 004 (`enrollStudentsBulk`), 008 (`createStudent` : `externalRef`, `validateOnly`), 009, 011 (API en lot des notes), 014 (`idempotencyKey` des factures).

> Le legacy n'a **aucun import** hormis `POST /enrollments/bulk` (inscriptions déjà créées). Cette spec ajoute un **cadre générique** (Upload -> Mapping -> Validation -> Erreurs -> Preview -> Import -> Rapport) et sept importeurs. Aucune donnée de production n'est reprise (décision D8) : l'import sert l'**onboarding** d'un établissement et la reprise de ses fichiers.

## 1. Objectifs

1. Un établissement est opérationnel en moins d'une journée : il importe ses élèves, parents, enseignants, classes, matières, notes et soldes d'ouverture depuis Excel / CSV.
2. **Un seul assistant** pour tous les importeurs : même parcours, mêmes rapports, mêmes garanties.
3. **Aucune écriture hors des règles du métier** : chaque importeur écrit EXCLUSIVEMENT par l'API publique (`index.ts`) des modules cibles, via des **ports** branchés dans `apps/api/src/platform/adapters/` (jamais de SQL vers leurs schémas). Les règles, l'audit et les événements de ces modules s'appliquent donc à chaque ligne.
4. **Idempotence** : rejouer le même fichier ne crée aucun doublon (empreinte du fichier + clé naturelle par entité, et `externalRef` / clé d'idempotence quand le module cible en offre une).
5. **Robustesse** : exécution dans le **worker**, par lots transactionnels, reprise après interruption, annulation, plafonds de lignes, mémoire bornée.
6. **Sécurité des fichiers** : type réel contrôlé sur les octets, anti zip-bomb, formules jamais évaluées, macros ignorées, injection de formule neutralisée à l'export du rapport.

## 2. Périmètre

### Inclus

- Fichiers `.xlsx` et `.csv` (UTF-8 avec ou sans BOM, windows-1252 ; séparateurs `,` `;` tabulation détectés). Première feuille par défaut (la feuille se choisit à l'upload) ; première ligne non vide = en-têtes.
- Sept importeurs enregistrés : `students`, `guardians`, `staff`, `classrooms`, `curriculum`, `grades`, `opening_balances` (§5). Modèle de fichier téléchargeable (CSV et XLSX) pour chacun.
- Mapping de colonnes : détection automatique par en-têtes (sans accents, fr / en), **modèles de mapping enregistrés par tenant**, correction manuelle, colonnes ignorées.
- Validation : schéma Zod par importeur, règles métier par ligne, doublons **dans le fichier** et **contre les données existantes** (par le module cible), références résolues par le module cible (classe, programme, évaluation, élève...).
- Rapport d'erreurs par ligne et par colonne, filtrable, téléchargeable (CSV et XLSX, valeurs **neutralisées** contre l'injection de formule).
- Preview : ce qui sera créé / mis à jour / ignoré / refusé, **sans aucune écriture**.
- Import : worker, lots transactionnels, deux modes (`ALL_OR_NOTHING`, `VALID_ONLY`), politique « existant » (`SKIP` / `UPDATE`), progression en direct, annulation, reprise.
- Rapport final : créés, mis à jour, ignorés, en erreur, durée, auteur ; historique des imports.
- Intégration à l'onboarding de `tenancy` : `imports.run.completed` (élèves, enseignants) complète les étapes `STUDENT_IMPORT` et `TEACHERS`.
- Quotas anti-abus, limiteur de débit, audit de chaque étape, isolation tenant (RLS), MFA pour les soldes financiers.

### Exclu (renvoyé)

| Sujet | Renvoi |
|---|---|
| Reprise de données legacy / import des tables Imhotep | aucune reprise (D8) |
| Fusion de doublons d'élèves | pas de fusion en v1 (spec 008) : le doublon est signalé, jamais fusionné |
| Calcul de moyennes, de rangs, de décisions à partir des notes importées | 012 / 013 : l'import **ne calcule rien** |
| Inscription de masse sans fichier (`enrollStudentsBulk` par API) | 004 |
| Import de photos, de pièces jointes, de justificatifs | hors V1 |
| `.xls` (OLE2), `.xlsm` exécuté, `.ods` | refusés (le type réel est contrôlé) |
| Planification d'imports récurrents, import par URL / SFTP | hors V1 |

## 3. Parcours en sept étapes

| # | Étape | Où | Détail |
|---|---|---|---|
| 1 | **Upload** | API (synchrone) | type réel (octets), taille, ouverture sûre, stockage (`StoragePort`), mise en table des lignes brutes (plafond de lignes), empreinte SHA-256 du fichier (avertissement si déjà importé) |
| 2 | **Mapping** | API | détection automatique, modèle enregistré proposé, confirmation (`PUT /jobs/:id/mapping`) |
| 3 | **Validation** | worker | schéma Zod + règles par ligne, doublons internes (clé naturelle), vérifications contre l'existant (`port.plan`, lecture seule) |
| 4 | **Erreurs** | API | rapport par ligne / colonne (`GET /jobs/:id/rows?status=INVALID`), téléchargeable |
| 5 | **Preview** | API | décompte et échantillon par action (`CREATE` / `UPDATE` / `SKIP` / `ERROR`), aucune écriture |
| 6 | **Import** | worker | `POST /jobs/:id/run` : mode, politique « existant », lots transactionnels ; reprise ; annulation |
| 7 | **Rapport** | API | décomptes, durée, auteur, erreurs de l'exécution, téléchargement |

États d'un import (`jobs.status`) : `UPLOADED` -> `MAPPED` -> `VALIDATING` -> `VALIDATED` -> `QUEUED` -> `RUNNING` -> `COMPLETED` | `COMPLETED_WITH_ERRORS` | `FAILED` | `CANCELLED`. Revalider après un changement de mapping ou d'options est toujours possible avant `QUEUED`.

## 4. Règles transverses

### 4.1 Sécurité des fichiers (INV-S)

- **S1 Type réel** : `.xlsx` = archive ZIP (`PK\x03\x04`) contenant `[Content_Types].xml` et `xl/workbook.xml` ; `.csv` = texte (aucun octet NUL, décodage valide). Le nom, l'extension et le `Content-Type` annoncés ne font jamais foi ; une incohérence est refusée (`imports.file_type_mismatch`). `.xls` (OLE2), `.xlsb`, PDF, exécutables, etc. : refusés.
- **S2 Taille** : plafond configurable (5 Mio par défaut, 20 Mio maximum), vérifié avant tout traitement (corps de requête borné par Fastify).
- **S3 Zip-bomb** : avant toute décompression, l'annuaire du ZIP est lu : nombre d'entrées (<= 500), taille déclarée décompressée par entrée et totale (<= 50 Mio par défaut), ratio de compression (<= 100). La décompression est ensuite **comptée octet par octet** (les tailles déclarées peuvent mentir) et interrompue au plafond. Aucune entrée avec chemin absolu ou `..` n'est lue ; seules les parties nécessaires (`workbook.xml`, `sharedStrings.xml`, la feuille choisie) sont décompressées.
- **S4 XML** : lecteur XML linéaire maison, en flux ; `<!DOCTYPE` et `<!ENTITY` refusés (expansion d'entités impossible) ; profondeur et longueur de jeton bornées.
- **S5 Formules non évaluées** : une cellule à formule est lue par sa **valeur mise en cache** (jamais recalculée) ; si la valeur manque, la cellule est vide. Le nombre de cellules à formule est signalé dans le rapport du fichier (avertissement `imports.formulas_ignored`). Les liens externes, objets OLE et macros (`vbaProject.bin`) ne sont jamais lus (avertissement `imports.macros_ignored`).
- **S6 Plafonds** : lignes (5 000 par défaut, 20 000 au maximum), colonnes (100 par défaut, 200 au maximum), longueur d'une cellule (2 000 caractères).
- **S7 Export du rapport** : toute valeur textuelle écrite dans un CSV / XLSX de rapport qui commence par `=`, `+`, `-`, `@`, tabulation ou retour chariot est précédée d'une apostrophe (`'`) ; les cellules XLSX sont écrites en **texte** (`t="inlineStr"`), jamais en formule.
- **S8 Aucune donnée sensible dans les journaux** : les lignes brutes ne sortent ni dans les logs ni dans les événements ; l'audit ne porte que des identifiants, décomptes et noms de colonnes.

### 4.2 Mapping

- Normalisation des en-têtes : minuscules, sans accents ni ponctuation, espaces réduits.
- Chaque champ cible déclare des **alias** (français et anglais). Appariement : égalité exacte normalisée, puis inclusion de jetons, puis distance d'édition <= 1 pour les mots de plus de 5 lettres. Un en-tête n'est jamais affecté à deux champs ; en cas de conflit, le meilleur score gagne.
- Un **modèle de mapping** (`mapping_templates`) est propre au tenant et à l'importeur ; il est proposé automatiquement si au moins 80 % de ses en-têtes sont présents. Il se crée, se renomme et se supprime (`imports.template.manage`).
- Le mapping est **complet** quand tous les champs obligatoires sont affectés à une colonne existante.

### 4.3 Validation et clés naturelles

- Chaque importeur définit `rowSchema` (Zod, coercions : dates `JJ/MM/AAAA` ou `AAAA-MM-JJ` ou numéro de série Excel, booléens `oui/non/1/0`, nombres), des règles métier pures et une **clé naturelle** normalisée (`naturalKey`). Deux lignes de même clé dans un fichier : la première est valide, les suivantes sont refusées (`imports.duplicate_in_file`, avec le numéro de la première).
- Contre l'existant, le **module cible** répond (`port.plan`) : l'entité existe-t-elle (-> `UPDATE` ou `SKIP` selon la politique) ? un doublon probable existe-t-il ? la référence (classe, programme, évaluation, élève) est-elle connue ? Le port ne fait **aucune écriture**.
- Les codes d'erreur sont stables (`imports.*` pour le cadre ; ceux du module cible, `people.*`, `academic.*`, `assess.*`, `finance.*`, sont repris tels quels dans `issues[].code`).

### 4.4 Exécution

- **Lots transactionnels** : `VALID_ONLY` traite les lignes par lots (200 par défaut) ; chaque lot est UNE transaction qui contient les écritures des modules cibles (en SAVEPOINT par ligne : une ligne refusée n'annule pas les autres), les résultats par ligne, les références d'idempotence et le curseur. Un crash revient au dernier lot validé.
- **ALL_OR_NOTHING** : le fichier doit être **entièrement valide** (sinon `imports.has_errors`, rien n'est lancé) puis il est écrit dans UNE transaction (plafond configurable, 5 000 lignes par défaut). Toute erreur à l'écriture annule tout ; un crash annule tout (reprise depuis le début). Contrepartie documentée : une longue transaction retient les verrous des modules cibles (numérotation sans trou des élèves) ; préférer `VALID_ONLY` pour les gros fichiers.
- **Idempotence** : `imports.entity_refs` (tenant, importeur, clé naturelle) -> entité créée ; les modules cibles reçoivent `externalRef` / `idempotencyKey` quand ils le permettent. Un rejeu d'un fichier déjà importé : lignes `SKIPPED` (déjà importées) ou `UPDATED` si `UPDATE` et si des champs changent.
- **Reprise** : un bail (`lease_until`, battement de coeur) désigne l'exécutant ; un exécutant mort est remplacé après l'expiration du bail (abonné relancé par BullMQ **et** job de filet `imports.resume-stalled`). Les lignes déjà traitées ne sont jamais rejouées (`rows.outcome`).
- **Annulation** : `POST /jobs/:id/cancel` ; honorée entre deux lignes ; les lots déjà validés restent en `VALID_ONLY` (rapport honnête : `CANCELLED` avec décomptes), tout est annulé en `ALL_OR_NOTHING`.
- **Limites** : lignes, colonnes, taille, lots de 1 à 500, quotas par tenant (imports actifs simultanés, imports par jour), limiteur de débit par utilisateur.

## 5. Importeurs

Un importeur = un fichier `modules/imports/importers/<clé>.ts` (colonnes, alias, schéma, clé naturelle, options, permissions, modèle de fichier), enregistré dans `importers/registry.ts`. L'écriture est portée par un **port** de `application/ports.ts`, branché par `platform/adapters/imports-*.ts`.

| Clé | Contenu | Module cible (API publique) | Permissions requises (en plus de `imports.import.<clé>`) | Clé naturelle | Idempotence cible |
|---|---|---|---|---|---|
| `students` | identité, sexe, naissance, matricule d'origine, n° national, contacts, adresse, nationalité ; **option** : classe + financement (inscription) | `people` (`createStudent`, `updateStudent`), `academic` (`enrollStudent`) | `student.create` (+ `student.update` si `UPDATE`, + `enrollment.create` si une classe est mappée) | matricule d'origine, sinon n° national, sinon nom + prénom + naissance | `externalRef` |
| `guardians` | tuteur (identité, contacts, profession) + lien avec un élève (matricule d'origine), relation, drapeaux | `people` (`createGuardian`, `linkGuardian`) | `guardian.manage` | téléphone, sinon e-mail, sinon nom + prénom ; lien = élève + tuteur | table `entity_refs` + refus `link_exists` |
| `staff` | enseignants et personnel (identité, catégorie, poste, embauche) | `people` (`createStaff`, `updateStaff`) | `staff.create` (+ `staff.update`) | matricule d'origine, sinon e-mail, sinon nom + prénom + naissance | `externalRef` |
| `classrooms` | classes (code, nom, programme, niveau, effectif) pour une année | `academic` (`createClassroom`, `updateClassroom`) | `academic.classroom.manage` | année + code | unicité du code (module cible) + `entity_refs` |
| `curriculum` | matières et noeuds de curriculum (type, coefficient, crédits, période) d'une version brouillon | `academic` (`createSubject`, `addCurriculumNode`, `updateCurriculumNode`) | `curriculum.manage` (+ `academic.program.manage` si des matières sont créées) | version + code du noeud (matière : code) | unicité (module cible) + `entity_refs` |
| `grades` | notes d'**une évaluation** par élève : nombre ou code `ABS` / `ABJ` / `DISP` ; commentaire | `assess` (`saveGrades`) | `grade.enter` | évaluation + élève | `saveGrades` (upsert par inscription) |
| `opening_balances` | soldes d'ouverture : factures de reprise et avoirs de reprise, montants **entiers XOF** | `finance` (`createInvoice`, `issueCreditNote`) | `finance.invoice.create` ; **MFA** (`imports.import.opening_balances` est sensible) | référence de la ligne | `idempotencyKey` de la facture |

Règles propres : pas de décimales pour les montants XOF (`imports.amount_not_integer`) ; une note n'est jamais calculée ni arrondie par l'import ; un code d'absence ne porte pas de note ; l'élève d'une note est identifié par son matricule d'origine ou son matricule de la plateforme (`people.resolveStudentRefs`), dans la classe de l'évaluation ; un lien tuteur-élève référence un élève par son matricule d'origine.

## 6. Permissions, features, menus

Permissions déclarées dans `manifest.ts` :

| Permission | Effet |
|---|---|
| `imports.read` | voir l'historique, les rapports, les modèles de fichier |
| `imports.create` | téléverser, mapper, valider, prévisualiser (aucune écriture dans les modules cibles) |
| `imports.import.students`, `.guardians`, `.staff`, `.classrooms`, `.curriculum`, `.grades` (celui-ci exige aussi `assessment.manage`) | **lancer** l'import (ET détenir les permissions du module cible, tableau §5) |
| `imports.import.opening_balances` | idem, **sensible** : MFA exigée, audit renforcé |
| `imports.cancel` | annuler un import en cours (le sien, ou tout import avec `imports.manage`) |
| `imports.template.manage` | gérer les modèles de mapping du tenant |
| `imports.manage` | voir et annuler les imports des autres ; paramètres du module (plafonds, rétention) |

L'accès à un importeur exige `imports.create` **et** les permissions d'écriture du module cible dès l'upload (un utilisateur ne peut pas prévisualiser ce qu'il ne pourrait pas créer). Les permissions du module cible sont vérifiées **à la création** et **au lancement** de l'import ; la décision d'accès (rôles, MFA) est figée avec le contexte de l'auteur pour l'exécution dans le worker.

Module du socle (`CORE`) : pas de feature commerciale en v1 ; menu `/v2/imports`. Aucune permission n'est accordée à un rôle système par ce module (`owner` et `directeur` ont `*`) : l'attribution aux autres rôles est une demande de changement du module `rbac`.

## 7. Événements

Publiés (payload `{ v: 1, ... }`, jamais de donnée personnelle) : `imports.job.created`, `imports.job.validation_requested`, `imports.job.validated`, `imports.run.requested`, `imports.run.started`, `imports.run.completed`, `imports.run.failed`, `imports.run.cancelled`. Consommé par `tenancy` : `imports.run.completed` (`importerKey` `students` -> `STUDENT_IMPORT`, `staff` -> `TEACHERS`).

## 8. Critères d'acceptation

- **AC1** Un fichier de 5 000 lignes (élèves) est importé en `VALID_ONLY` avec une mémoire bornée (pas de montée linéaire du tas) ; le débit mesuré figure dans le README.
- **AC2** Le rejeu du même fichier n'ajoute aucune ligne dans `people.students` (idempotence), pour les importeurs à clé naturelle.
- **AC3** Un worker tué (`SIGKILL`) en cours d'import est remplacé ; l'import se termine sans doublon ni ligne manquante.
- **AC4** Une ligne invalide est rapportée avec son numéro, sa colonne, un code stable et un message en français ; `ALL_OR_NOTHING` n'écrit rien tant qu'une erreur subsiste.
- **AC5** Un utilisateur sans la permission du module cible reçoit 403 à l'upload comme au lancement ; sans MFA, les soldes financiers sont refusés.
- **AC6** Un tenant ne voit, ne modifie ni n'annule jamais les imports d'un autre tenant (RLS ; test A/B).
- **AC7** Zip-bomb, fichier corrompu, mauvais type, formule, macro : refus ou neutralisation conformes à §4.1, prouvés par des tests.
- **AC8** Le rapport d'erreurs téléchargé ne contient aucune valeur interprétable comme formule.
- **AC9** L'assistant `/v2/imports` est utilisable au clavier, avec libellés et erreurs associés aux champs, et le rapport se consulte sur mobile.
