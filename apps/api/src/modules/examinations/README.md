# Module `examinations` — Examens nationaux (spec v2/018)

Moteur d'examens **générique** : CEPE, BEPC, BAC, BTS sont des **types** (lignes de données), pas du code. Séries, épreuves, coefficients, pièces exigées, formats d'export et d'import sont des **données** ; l'éligibilité, la moyenne et l'issue d'un examen **blanc**, le taux de réussite sont des **règles** (`rules`, contrat `exam-national@1`). **Aucune constante réglementaire dans le module** (test `module.unit.test.ts` : lint R2). L'admission d'un examen **officiel** est celle que l'autorité prononce : le module l'**enregistre** (saisie ou import), il ne la **calcule jamais** (déclencheur `official_not_computed`).

- Schéma Postgres : `examinations` — migrations **2000–2004** (plage 2000–2099).
- Packs : `PRIMARY`, `SECONDARY`, `HIGHER` ; features `examinations.core`, `.mock`, `.exports`.
- CEPE livré en **données FICTIVES** marquées `source_kind = placeholder` (3 épreuves `EP1`–`EP3`, pièce « acte de naissance », 2 formats d'export, 1 format d'import) : `POST /exam-types/instantiate-pack {"pack":"PRIMARY"}` (idempotent). Un bandeau « Règles de démonstration » (`demoRules`) et un filigrane sur les documents scellés sont reportés tant que les données ou la règle sont fictives.

## Arborescence

```
manifest.ts          permissions `exam.*`, features, menus, événements
index.ts             API publique (seul point d'import des autres modules)
migrations/          2000-2002 : DDL de référence testé (copie exacte) ; 2003 corrections ; 2004 formats d'import
domain/              règles pures : cycle de vie, numéro, listes blanches d'export/import, rendu des fichiers, analyse d'import, entrées des règles
application/         cas d'usage (deps, ctx, input) => Result ; ports.ts ; deps.ts (transaction, outbox, audit, SAVEPOINT par élément)
infrastructure/      SQL via le Tx de TenantDb (dépôts), XLSX minimal (JSZip), ports en mémoire, adaptateur d'audit
http/                plugin.ts (routes sans préfixe), guards.ts (anyOf / has)
subscribers.ts       `academic.enrollment.withdrawn` -> retrait automatique du candidat
jobs.ts              aucun (rien n'est purgé : rétention illimitée, Q-E16)
test/                unit/ (sans base), integration/ (Postgres réel), support/ (base jetable, monde en mémoire, règles FICTIVES de test)
```

## Principes tenus

| Principe | Mécanisme |
|---|---|
| Définition figée | `instantiate` copie séries et épreuves **actives** du type puis fige la session ; modifier le type n'a aucun effet rétroactif |
| Numéro sans trou | compteur transactionnel `examinations.next_number` posé par la base à l'inscription ; annulation = aucun numéro consommé ; retrait = numéro conservé, jamais réattribué ; testé à 20 inscriptions concurrentes sur 4 connexions |
| Éligibilité par règle | `eligibilite` / `motif_eligibilite` de la version **épinglée** à la session ; journal en ajout seul (version, résultat, motifs, empreinte, auteur) ; statut **dérivé** ; saisie manuelle seulement sans règle épinglée ; dérogation motivée (sensible) ; faits d'un autre module en **échec fermé** |
| Résultats officiels | `ENTERED` (auteur) ou `IMPORTED` (lot) ; brouillon puis publication (sensible) ; un résultat publié ne se dépublie pas |
| Quatre yeux | demande (`exam.result.enter`) puis approbation par une **autre** personne (`exam.result.revise`, MFA) ; révision + correction dans la même transaction ; documents dépendants révoqués |
| Examens blancs | lien exclusif épreuve ↔ évaluation `assess` (type `EXAMEN_BLANC`, même barème) ; notes **publiées** seulement ; calcul **par la règle**, tracé (version de règle + empreinte des entrées, reproductible) ; jamais importés, jamais officiels, aucun document |
| Imports | fichier unique par empreinte SHA-256 ; analyse selon un **format publié** (donnée) ; lot en erreur **refusé** ; application **tout ou rien** ; lignes sans nom ni adresse |
| Exports | format publié et figé, champs et transformations en **liste blanche** (aucune expression libre) ; injection de formule neutralisée (CSV, XLSX) ; empreinte, effectif, version tracés ; téléchargement journalisé |
| Famille | lien de tutelle relu à chaque requête ; hors périmètre = 404 ; sessions **officielles** seulement ; issue visible une fois publiée, jamais de note ni de moyenne |
| Vie privée | aucune note, moyenne ni identité d'élève dans les événements ni l'audit (testé sur tout le parcours) |

## Ajouts au DDL de référence (voir `specs/v2/018-examinations/data-model.md` §5.4)

- **2003** `revision_requests` (quatre yeux réels : demandeur ≠ approbateur, une demande en attente par cible) ; garde `candidate_results_guard` : un résultat **publié** se corrige par révision même une fois la session `PUBLISHED` (R-EXA-08) ; `valid_export_columns` gagne les compteurs `stat.*`.
- **2004** `import_formats` : formats d'import de l'autorité en données (clé unique, colonne utile par nature, table de correspondance des codes), versionnés, figés une fois publiés.

Les migrations sont rejouées par `specs/v2/018-examinations/ddl/run.mjs` (195 tests de comportement) : `ED_DDL_MIGRATIONS=apps/api/src/modules/examinations/migrations node specs/v2/018-examinations/ddl/run.mjs`.

## Routes (`/api/v1/examinations`, sans préfixe dans le plugin)

| Domaine | Routes | Permission |
|---|---|---|
| Types | `GET/POST /exam-types`, `GET/PATCH /exam-types/:id`, `POST /exam-types/instantiate-pack`, `/:id/tracks`, `/:id/papers`, `/:id/document-requirements` | `exam.type.read` / `.manage` |
| Centres | `GET/POST /centers`, `PATCH /centers/:id`, `POST/PATCH /centers/:id/rooms` | `exam.center.manage` (lecture : aussi `exam.session.read`) |
| Sessions | `GET/POST /sessions`, `GET/PATCH /sessions/:id`, `POST /sessions/:id/instantiate`, `POST /sessions/:id/transition` | `exam.session.read` / `.manage` ; `PUBLISHED` exige aussi `exam.result.publish` |
| Candidats | `GET/POST /sessions/:id/candidates`, `POST …/from-classroom`, `POST …/register-batch`, `GET/PATCH /candidates/:id`, `POST /candidates/:id/register`, `/withdraw`, `/eligibility`, `GET/PUT /candidates/:id/documents[/:reqId]`, `PUT /candidates/:id/identifiers`, `POST /sessions/:id/eligibility/evaluate-all` | `exam.candidate.read` / `.manage`, `exam.eligibility.evaluate` ; `OVERRIDE` exige `exam.eligibility.override` |
| Répartition | `GET/PUT /sessions/:id/centers`, `POST /sessions/:id/assignments/auto`, `PUT/DELETE /assignments/:candidateId` | `exam.center.manage` |
| Notes, résultats | `GET /sessions/:id/scores`, `PUT …/scores/bulk`, `GET/PUT /sessions/:id/results`, `POST /results/:id/publish` | `exam.score.enter`, `exam.result.read/enter`, `exam.result.publish` |
| Révisions | `POST /results/:id/revisions`, `POST /scores/:id/revisions` (demandes), `GET /sessions/:id/revision-requests`, `POST /revision-requests/:id/approve|reject` | `exam.result.enter` ou `.revise` (demande) ; `exam.result.revise` (décision) |
| Imports | `GET/POST /import-formats`, `GET/PATCH /import-formats/:id`, `POST …/publish`, `GET/POST /sessions/:id/imports`, `GET /imports/:id`, `POST /imports/:id/validate`, `POST /imports/:id/apply` | `exam.import.manage` ; `/apply` : `exam.result.release` |
| Examens blancs | `GET /sessions/:id/mock/links`, `POST …/mock/link`, `DELETE …/mock/links/:linkId`, `POST …/mock/import-from-assess`, `POST …/mock/compute` | `exam.mock.manage` |
| Statistiques | `GET /sessions/:id/statistics?groupBy=ALL|INSTITUTION|TRACK|SEX|GRADE&compare=previous_year|mock` | `exam.statistics.read` |
| Exports | `GET/POST /export-formats`, `GET/PATCH /export-formats/:id`, `POST …/publish`, `POST …/new-version`, `GET/POST /sessions/:id/exports`, `GET /exports/:id`, `GET /exports/:id/download` | `exam.export.manage` / `.run` |
| Documents | `POST /candidates/:id/documents/issue`, `POST /sessions/:id/documents/issue-batch`, `GET /sessions/:id/issued-documents`, `POST /issued-documents/:id/revoke`, `GET /issued-documents/:id/file` | `exam.document.issue` |
| Famille | `GET /me/exams`, `/me/exam-documents`, `/family/exams`, `/children/:studentId/exams`, `/children/:studentId/exam-documents`, `GET /family/exam-documents/:id/file` | `exam.document.self.read` / `.child.read` |

Permissions ajoutées à la liste de la spec (additives) : `exam.candidate.read` (consultation par l'enseignant), `exam.result.read` (consultation des résultats et des demandes de révision).

## Événements

Publiés (`{ v: 1, … }`, **sans note ni identité**) : `examinations.session.opened|registration_closed|results_published|archived`, `candidate.registered|withdrawn`, `eligibility.evaluated`, `result.published` (issue seule ; **jamais** émis pour un examen blanc), `result.revised`, `revision.requested|rejected`, `import.applied`, `document.issued|revoked`, `export.completed`. Consommé : `academic.enrollment.withdrawn`.

## Ports et INTERFACES ATTENDUES des autres modules (non branchées tant qu'elles manquent : échec fermé `examinations.port_unavailable`)

**État en phase 3** (parcours Secondary, `apps/api/test/phase3/secondary.integration.test.ts`) : `exam-national@1` et le jeu `CI-EXAM-PLACEHOLDER` existent et sont **liés** à l'établissement SECONDARY par le modèle de pack (abonné `rules.apply-pack-bindings`) ; les natures `EXAM_*` de `reportcards` existent ; `academic.getEligibilityFacts` existe. Un défaut d'adaptateur a été corrigé : `getEligibilityFacts(deps, ctx, enrollmentId)` prend l'**identifiant** de l'inscription (l'adaptateur passait un objet `{ enrollmentId }` et rendait donc `port_unavailable` en permanence ; les tests ne le voyaient pas car ils injectaient un faux `academic`). Aucun `port_unavailable` ne subsiste dans le parcours : éligibilité évaluée (faits + règle), examen blanc calculé par la règle de démonstration (`demoRules: true`). Les documents officiels d'un examen dont le type ou la session est `placeholder` transmettent désormais `ruleSourceKind: "placeholder"` à `reportcards` (filigrane imposé, vérification publique « démonstration »). Reste non branché : le stockage sans bucket (`STORAGE_*`), comme pour tous les modules.

Le module n'importe aucun autre module. Les adaptateurs `apps/api/src/platform/adapters/examinations-*.ts` traduisent leurs API publiques ; **s'ils ne trouvent pas l'interface attendue, le port échoue fermé** (aucun module fournisseur n'est modifié) :

| Port | Fournisseur | Interface attendue | Repli |
|---|---|---|---|
| `RulesPort` | `rules` | contrat **`exam-national@1`** : règles `eligibilite`, `motif_eligibilite`, `moyenne_candidat`, `resultat_candidat`, `rang_candidat`, `taux_reussite` (et facultativement `mention_examen`) ; `resolve` + `loadVersion` + `evaluateMany` de `RulesApi` (déjà présents) | pas d'éligibilité automatique ni de calcul d'examen blanc ; saisie manuelle de l'éligibilité avec auteur |
| `EligibilityFactsPort` | `academic` | `getEligibilityFacts(deps, ctx, { enrollmentId, examGradeLevelCode, referenceDate }) -> Result<{ inExamGrade: boolean; ageYears: number \| null }>` ; **à défaut**, l'adaptateur n'invente rien : `port_unavailable` | aucune évaluation sans faits |
| `OfficialDocumentPort` | `reportcards` | natures `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` acceptées par `requestOfficialDocument` (gabarits génériques) ; un refus `reportcards.unknown_document_kind` devient `port_unavailable` | documents indisponibles |
| `AssessPort` | `assess` | `getAssessmentView` + `listPublishedGrades` (présents) ; type d'évaluation `EXAMEN_BLANC` | saisie manuelle des notes |
| `PieceDocumentPort` | `documents` | lecture d'un document (propriétaire = élève) via `getDocument` | refus des dépôts |
| `StudentDirectory`, `FamilyLinks`, `InstitutionDirectory` | `academic` + `people`, `iam` | `getRoster`, `getEnrollment`, `getStudent`, tutelle (`isGuardianOfStudent`, `listChildrenOfIdentity`, `resolveStudentForIdentity`) (présents) | échec fermé ; famille : aucun accès |
| `StoragePort` | plateforme | vue `asDocumentsStorage` du stockage d'objets | refus |

Rôles système côté `rbac` (**faits**, voir `rbac/README.md` : `responsable_examens` porte toutes les `exam.*` non sensibles ; `directeur_etudes` : consultation ; `exam.candidate.read` n'est pas accordé aux enseignants, la consultation n'étant pas bornée à leurs classes) — spécification initiale : `responsable_examens` (toutes les permissions `exam.*` sauf les sensibles de publication/approbation) ; `directeur`/`owner` : `*` ; `parent` : `exam.document.child.read` ; `élève` : `exam.document.self.read`.

## Hypothèses documentées (aucune règle officielle inventée)

- Âge d'éligibilité : date de référence = `starts_on` de la session (donnée) ; absente, l'âge n'est pas fourni (`age_annees = null`, jamais 0).
- Une épreuve sans note publiée est transmise à la règle `absent = true`, `note = null` ; le modèle ne porte pas d'épreuve **éliminatoire** : le compteur transmis vaut 0 tant que le texte officiel (Q-E06) n'a pas ajouté cette donnée.
- Un examen blanc ne produit aucun document officiel (convocation comprise) : jamais confondu avec un document de l'autorité.
- Moyennes stockées en `numeric(7,3)` (arrondi de stockage de Postgres) ; le calcul exact est celui de la règle.

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/examinations            # unitaires (intégration ignorée sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/examinations/test   # intégration réelle
ED_PG_IMAGE=postgres:17-alpine node specs/v2/018-examinations/ddl/run.mjs                                                          # DDL (195 tests)
pnpm check:boundaries && pnpm --filter @ecoledigitale/api type-check:v2 && pnpm test:isolation
```
