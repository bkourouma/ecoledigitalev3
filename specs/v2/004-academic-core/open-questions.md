# Questions ouvertes et décisions — lot 004 / 008 / 009 / 010 / 017

**Portée** : ce document couvre les cinq specs du lot (cœur académique, élèves et tuteurs, personnel, présences, emploi du temps). Il distingue :

- **A. Décisions techniques tranchées** (avec justification) — l'équipe peut les contester en revue ;
- **B. Incohérences relevées dans le PRD, le plan, les ADR ou la documentation**, avec la décision prise ;
- **C. Questions métier au propriétaire du produit** — formulées sans jargon, avec les options et une proposition par défaut. Les identifiants `O-nn` sont cités dans les specs.

Aucune règle réglementaire n'a été inventée : tout ce qui en dépend est une donnée de pack ou un RuleSet, et attend les textes de référence (O-02, O-09, O-18).

---

## A. Décisions techniques tranchées

| # | Décision | Justification |
|---|---|---|
| D-01 | Les tables globales de base s'appellent `kernel.*` (`kernel.tenants`, `kernel.domain_events`, `kernel.enable_tenant_rls`), pas `platform.*` | Le code livré (`packages/database/migrations/0002_kernel.sql`, `0003_outbox.sql`) et `module-conventions.md` font foi ; l'ADR-006 et l'ADR-004 parlent de `platform` (voir B-01) |
| D-02 | Plages de migrations proposées : **academic 0700-0799, people 0800-0899, attendance 0900-0999, scheduling 1000-1099** | Le tableau de `module-conventions.md` réserve « 0700+ aux modules suivants, dans l'ordre de création » ; ces plages sont à inscrire par le lead (le périmètre de ce travail interdit de modifier ce fichier). Les autres specs de la Phase 2 (011, 012, 013, 019, 032) prendront 1100+ |
| D-03 | **Un seul module `people`** (schéma `people`) porte les specs 008 et 009 : `persons` commune, élèves, tuteurs, personnel, affectations | ADR-001 : un module = un schéma. Une personne peut être parent et enseignant (financement `STAFF_CHILD`) : une table `persons`, un rôle par ligne. Le manifeste est créé par 008, complété par 009 |
| D-04 | **L'inscription (`academic.enrollments`) est la source de vérité du type de financement**, du numéro de référence d'affectation et de l'origine ; finance en tient un reflet (compte de l'apprenant) alimenté par `academic.enrollment.funding_changed` | PRD §20 et décision du lead ; le module finance livré porte `learner_accounts.funding_type` ; deux sources de vérité sont interdites. Les montants (part État, part parent) restent dans finance (bourses) |
| D-05 | Le legacy « cohorte / session d'UE » devient une **offre** (`classroom_offerings` = classe × nœud) et la **classe** devient une entité (`classrooms`) | Le legacy n'avait pas d'entité « ouverture de classe » : le nom de classe était le préfixe du libellé de cohorte (`split_part(libelle,' — ',1)`), la portée dans `professional_classe_noms` (migrations 0117, 0128). Une entité règle regroupement, unicité, année et clôture par classe |
| D-06 | Curriculum **polymorphe, versionné par (programme, année)**, grammaire des types de nœuds en **données**, identité inter-annuelle par **`lineage_id`**, matières **mutualisables** via un catalogue | Exprime les 4 packs avec un seul moteur (plan §3.7) ; la mutualisation reproduit la décision D11 du PRD de restructuration ; les prérequis et la capitalisation survivent au clonage annuel |
| D-07 | Périodes : arbre typé (année > période > sous-période), 4 états `PLANNED → OPEN → GRADING_CLOSED → CLOSED`, **état par classe qui surcharge celui de la période** | Reproduit « clôture des notes » puis « clôture des bulletins » du legacy ; corrige le bug où la clôture d'un semestre fermait toutes les cohortes d'une UE |
| D-08 | `FULL`/`OPEN` d'une offre dérivés **par déclencheur de base** ; capacité d'offre toujours dure ; capacité de classe dure par défaut (`capacity_is_hard = true`) | Parité avec `computeSessionCapacityStatus` ; sérialisation par verrou de ligne (le legacy comptait sans verrou) |
| D-09 | Une place est réservée par toute sélection `PENDING` **non expirée** (`hold_expires_at`), expiration par job | Le legacy réservait sans fin dès la mise au panier (bug P-064) ; la durée est une donnée d'établissement (O-17) |
| D-10 | Confirmation à **deux niveaux** : inscription (`enrollment_confirmation_policy`) puis sélection (`course_confirmation_policy`), la seconde exigeant la première | Reproduit la « porte d'entrée » des frais d'inscription sans confirmer en bloc des UE non payées |
| D-11 | Présences : **un modèle d'appel unique** ; `EXCUSED` n'existe que par un justificatif accepté ; l'excuse d'un retard ou d'un départ anticipé = drapeau `excused` sans changer le statut ; exception unique de verrou : appliquer/révoquer une excuse sur un appel validé | Remplace 4 systèmes et le CHECK qui provoquait des 500 ; garde la sémantique « N heures d'absence dont M justifiées » sans calcul |
| D-12 | Récapitulatif de présence **dérivé** + surcharge tracée ; `absent_*` = total (justifiées comprises), `excused_*` = sous-ensemble | Évite la saisie manuelle du legacy ; cohérent avec le texte du bulletin |
| D-13 | **Aucun seuil ni équivalence** dans les modules : « N retards = 1 absence », alertes à 20 %/60 %, score de décrochage = RuleSets ou configurations des consommateurs (016/025) | Décision du lead (aucune constante réglementaire dans les modules) |
| D-14 | Scheduling : **patron récurrent → occurrence datée** ; conflits imposés par une table dérivée `resource_claims` à **contrainte d'exclusion différée** maintenue par déclencheurs `SECURITY DEFINER` ; politique `BLOCK`/`WARN` par ressource ; dépassement motivé | Seule façon d'interdire le double-booking sous concurrence ; le critère `[début, fin)` du legacy est conservé |
| D-15 | Le bénéficiaire de la paie est l'**intervenant réel de l'occurrence** (`occurrence_staff`) ; la paie verrouille les heures dès leur inclusion dans un bulletin non annulé (`lockHours`, exclusif et atomique) | Le legacy payait `se.enseignant_id` (réel) mais affichait le titulaire ; le verrou exclusif rend impossible le double paiement entre périodes qui se chevauchent (migration 0112 les autorise) |
| D-16 | Une occurrence validée (ou aux heures verrouillées) est **gelée en base** ; la dévalidation précède toute modification | Le legacy laissait modifier horaires, date et enseignant d'une séance validée ou payée |
| D-17 | Aucune suppression physique des dossiers, inscriptions, classes, occurrences, journaux (déclencheurs) ; le statut porte l'état | Le legacy supprimait en cascade notes, présences, paiements avec la fiche élève |
| D-18 | Registre `academic.registration_numbers` : un numéro d'inscription par (apprenant, programme, niveau), stable aux réinscriptions, unique par établissement ; motif configurable | Reproduit le matricule professionnel `IPAM-<CODE>-<NNNN>` sans préfixe en dur |
| D-19 | Numérotation `people.next_number` gapless (technique de `finance.next_number`) ; matricule immuable | Fin des six numérotations du legacy (dont une réécrite à chaque `GET /students`) |
| D-20 | Les références inter-modules sont des UUID sans FK ; les dépendances circulaires sont rompues par des **ports** injectés au câblage (`StudentDirectory`, `OfferingReadinessGuard`, `PeriodClosureGuard`, `CurriculumUsageGuard`, `CompletionLookup`, `ScheduleConflictChecker`) ; `dependsOn` ne contient que `rbac` / `tenancy` | `resolveModuleOrder` rejette les cycles ; ADR-001/006 |
| D-21 | Les référentiels (niveaux, types de périodes, statuts, motifs, types de salle, catégories de personnel…) sont des **sections de modèle de pack** par système éducatif (`templates/<section>/CI/<pack>.json`), instanciées de façon idempotente ; la structure actuelle de `PackTemplateSchema` (`levels`/`periods` réservés) doit être étendue (demande à 003) | Décision du lead ; le schéma actuel est `.strict()` |
| D-22 | La « conduite » est un nœud `is_transversal` (jamais offert, acheté, enseigné) au lieu d'une détection par libellé (`ILIKE 'conduite%'`, 10+ endroits) | Fragilité du legacy ; la notation reste en 011 |
| D-23 | Aucun `GET` n'écrit ; les effets de bord périodiques sont des jobs | Bugs legacy (`GET /ue-sessions` terminait des cohortes ; `GET /students` renumérotait) |
| D-24 | Le fuseau est celui de l'établissement (copié du `CountryProfile`) ; les dates civiles sont des `date`, les instants des `timestamptz` UTC | Fin de `Europe/Paris` en dur et des cinq dérivations « pivot au 1er septembre » |
| D-25 | Le pack Higher ne dispose pas d'un type d'inscription séparé : `mode = A_LA_CARTE` sur la même table `enrollments` | Unification (D2) ; inscription à la carte = sélections de cours dans la classe |
| D-26 | Les alias d'API du PRD §60 (`/students`, `/teachers`, `/classes`, `/grades`, `/attendance`) sont des alias de routage vers les préfixes de module (`/api/v1/people/students`…) | Convention `module-conventions.md` : un préfixe par module |
| D-27 | `STATE_ASSIGNED` (feature `academic.state-assigned`) est rattaché au pack SECONDARY comme la feature `finance.state-assigned` livrée | Cohérence avec finance ; question O-04 sur l'extension éventuelle |
| D-28 | Le sexe n'a **aucune valeur par défaut** (le legacy défaut « masculin ») ; les téléphones sont normalisés E.164 (≤ 40 caractères) | Qualité des données ; erreurs 500 du legacy à l'approbation |
| D-29 | Le moteur de règles reçoit des **faits** (`getRuleContext` : cycle, niveau, rang de période, nœuds avec coefficients et crédits en chaînes décimales), jamais des noms à analyser | Fin des regex `/licence\s*[12]\b/i`, « SEMESTRE 2 », « BTS 2 » ; ADR-003 (décimal exact) |
| D-30 | Pas de fusion automatique de dossiers en double en v1 ; détection avec avertissement humain | Risque de perte de données ; question O-07 |

---

## B. Incohérences relevées (PRD, plan, ADR, documents)

| # | Constat | Décision |
|---|---|---|
| B-01 | ADR-006 : schéma `platform` pour tenants, plans, outbox (`platform.domain_events`, `platform.schema_migrations`) ; le code livré utilise `kernel` | Suivre le code (D-01). Une ADR de correction est à ouvrir |
| B-02 | `specs/v2/README.md` cite `docs/PRD_ScolarFlow_SaaS.md` alors que le fichier s'appelle `PRD_EcoleDigitale_SaaS.md` | Corriger la référence (hors périmètre de ce lot) |
| B-03 | PRD §50 distingue `Staff` et `Teacher`, `Subject`/`Course`, `TeachingAssignment` ; le plan §3.7 les conserve | Un seul `staff` (catégorie `can_teach`) ; `Subject` = catalogue, `Course` = nœud de curriculum ; `TeachingAssignment` conservé |
| B-04 | PRD §11 range « compositions » parmi les types de **périodes** et PRD §17 parmi les types d'**évaluations** | Les deux existent : `COMPOSITION` est un type de période (donnée) et un type d'évaluation (011) ; l'organisation de l'année primaire est la question O-03 |
| B-05 | Le plan §3.12 dit que le financement est porté par l'inscription ; le module finance livré le porte par le **compte de l'apprenant** (`learner_accounts.funding_type`) | Décision D-04 ; finance doit exposer `EnrollmentRef.fundingType` et réagir à `academic.enrollment.funding_changed` |
| B-06 | Le plan indique que le Rules Engine est P0 mais l'ordre de la Phase 2 place 2.4 après 2.1-2.3 ; or la clôture et les prérequis dépendent de « validé » | `CompletionLookup` et `PeriodClosureGuard` sont des ports ; repli sûr documenté tant que 011/012 n'existent pas |
| B-07 | Le plan §4 (tranche 2.2) remplace `professional_enrollments`, mais ce legacy contient aussi la **commande, le panier, le paiement, l'échéancier, les frais de scolarité par barème** (`cycles_frais`, `ensureBaremeOrders`) | Ces fonctions sont **finance (014/015)** ; seule la « porte d'entrée » reste ici comme politique de confirmation |
| B-08 | Les noms `filiere_id` des tables Professional désignent en réalité la **classe** (`programmes`) depuis la migration 0116 ; `filieres` est la vraie filière | Vocabulaire v2 : `programs` = filière/série ; `grade_levels` = niveau ; `classrooms` = classe de l'année |
| B-09 | `docs/module-professionnel-overview.md` décrit le modèle 028 (matières/sessions), obsolète depuis la migration 0069 (UE/ECUE/cohortes) | Parité établie sur le code (voir `parity.md`) |
| B-10 | Le plan §8 point 4 laisse ouvert le parent multi-établissements ; ADR-008 le tranche (identité globale) | Appliqué dans 008 (`persons.identity_id`, un parent voit ses enfants du tenant courant) |
| B-11 | Plusieurs composants legacy ne figurent pas dans les migrations versionnées (tables Prisma seules : `bilan_types`, `student_period_attendance_summaries`, `teaching_hours`, etc.) | Aucune reprise de données (D8) ; la parité s'appuie sur le code et les inventaires |
| B-12 | L'inventaire legacy compte le code mort (routes non enregistrées, assistant de génération sans effet, `student-dashboard`) | Écarté dans `parity.md` (statut « abandonné ») |
| B-13 | Le test d'isolation générique (ADR-002) exige, pour chaque table, `tenant_id NOT NULL`, la policy unique et un index dont la première colonne est `tenant_id` ; la clé étrangère composite `(tenant_id, id)` impose de toute façon une contrainte unique qui commence par `tenant_id` | Chaque table du lot porte `UNIQUE (tenant_id, id)` ou une clé primaire commençant par `tenant_id` (vérifié par requête sur les 80 tables du lot : structure conforme) |

---

## C. Questions métier au propriétaire du produit

Pour chaque question : l'enjeu en une phrase, les options, notre proposition par défaut (appliquée tant qu'aucune réponse n'est donnée).

### Textes officiels et calendrier

**O-02 — Programmes officiels de la Côte d'Ivoire.** Pour livrer des écoles « prêtes à l'emploi », il nous faut les listes officielles : matières et coefficients par niveau du primaire et du secondaire, liste des séries du lycée (et options, langues), maquettes des licences/masters/BTS si vous souhaitez des modèles pré-remplis. *Proposition* : livrer les niveaux (CP1…CM2, 6e…Tle) et laisser chaque école saisir ses matières et ses coefficients, sans en inventer. *À nous fournir* : les arrêtés ou programmes du ministère, et la personne qui validera nos modèles.

**O-03 — Découpage de l'année du primaire et du secondaire.** Combien de périodes et de quel type : trois trimestres, deux semestres, des « compositions » à des dates précises ? Est-ce identique pour la maternelle, le primaire, le collège et le lycée ? *Options* : (a) trois trimestres partout ; (b) deux semestres au lycée ; (c) libre par école. *Proposition* : (c) avec les deux modèles (trois trimestres, deux semestres) proposés à la création de l'année.

**O-10 — Jours fériés et calendrier scolaire.** Voulez-vous que la plateforme fournisse les jours fériés et le calendrier scolaire officiel de chaque pays (mis à jour chaque année), ou que chaque école les saisisse ? *Proposition* : saisie par l'école en v1, calendrier officiel livré plus tard comme référentiel par pays.

### Inscriptions et financement

**O-01 — Quand une inscription est-elle « confirmée » ?** Les écoles veulent-elles confirmer (a) tout de suite, (b) quand les frais d'inscription sont payés, (c) quand tout est payé, (d) à la main ? Et pour les cours à la carte, la confirmation se fait-elle cours par cours dès que **ce** cours est payé (proposition) ? *Proposition* : (a) pour les écoles classiques, (b) pour le supérieur, réglable par établissement.

**O-04 — Élèves « affectés par l'État » et autres prises en charge.** Un élève peut-il cumuler plusieurs financements (par exemple boursier **et** affecté) avec des parts différentes, ou n'en a-t-il qu'un seul par année ? Les affectations existent-elles aussi au primaire et dans le supérieur ? *Proposition* : un seul type par inscription (le principal) avec une note libre ; le détail des parts est dans la facturation. *À nous dire* : si le cumul est fréquent chez vos clients.

**O-12 — Changement de classe en cours d'année.** Quand un élève change de classe, le bulletin doit-il (a) regrouper ses notes des deux classes, (b) rester séparé par classe, (c) ne présenter que la classe actuelle ? *Proposition* : (a) avec la mention des deux classes ; ses notes passées restent attachées à son inscription de l'année.

**O-13 — Numéro d'élève et numéro national.** Quel format voulez-vous pour le matricule (préfixe de l'école, année, longueur) ? Existe-t-il un numéro national obligatoire (matricule du ministère) que l'on doit pouvoir saisir et contrôler ? *Proposition* : format réglable par école (par défaut cinq chiffres), numéro national facultatif et unique.

**O-16 — Plusieurs établissements du même groupe.** Un élève peut-il être inscrit en même temps dans deux établissements du groupe (collège le jour, cours du soir) ? *Proposition* : oui, autorisé, avec une inscription par établissement.

**O-17 — Réservation d'une place avant paiement.** Quand un étudiant choisit un cours à la carte, la place est-elle réservée avant le paiement, et pendant combien de temps (30 minutes, 24 heures, sans limite) ? *Proposition* : réservée pendant une durée réglable par école ; sans limite par défaut serait un risque (places bloquées).

**O-22 — Se réinscrire à une UE déjà validée.** Autoriser (avec avertissement), interdire, ou autoriser seulement pour amélioration de note ? *Proposition* : autorisé avec avertissement et motif.

### Enseignement supérieur

**O-14 — Dispenses et équivalences.** Faut-il gérer les dispenses d'UE (validation des acquis, équivalence entre programmes) ? *Proposition* : hors v1.

**O-18 — Crédits et compensation.** Les « 20 crédits par semestre » et « 48 crédits pour passer en année supérieure » sont-ils bien vos règles générales ? Existe-t-il une compensation entre unités d'enseignement (le code actuel n'en fait aucune, seulement à l'intérieur d'une unité) ? *Proposition* : ces valeurs deviennent des paramètres de règles modifiables, sans compensation entre UE par défaut.

**O-11 — Une même unité d'enseignement dans deux semestres.** Cela existe-t-il chez vos clients ? *Proposition* : non géré (on duplique l'unité).

### Présences

**O-09 — Règles d'absence.** Quelles règles appliquez-vous : combien de retards valent une absence, à partir de combien d'absences prévient-on les parents ou convoque-t-on, dans quel délai un parent peut-il justifier une absence, une absence justifiée compte-t-elle dans les moyennes de conduite ? Elles seront écrites comme des règles modifiables, jamais figées. *Proposition* : aucune équivalence ni seuil par défaut ; chaque école configure les siens. *À nous fournir* : les règlements types.

**O-20 — Qui peut justifier une absence et avec quelles pièces ?** Parents seulement, ou aussi l'élève majeur et l'école ? Pièces acceptées (PDF, photo), taille maximale, pièce obligatoire pour la maladie ? *Proposition* : parent, élève majeur et école ; PDF/photo jusqu'à 5 Mo ; pièce obligatoire pour la maladie seulement.

**O-19 — Disponibilités des enseignants par défaut.** Si un enseignant n'a rien déclaré, est-il considéré disponible (proposition) ou indisponible ?

### Paie et validation des heures

**O-06 — Heures de surveillance et co-enseignement.** Les surveillants d'examen et le deuxième enseignant d'une séance partagée sont-ils payés, au même taux ? *Proposition* : enseignant responsable, co-enseignant et remplaçant rémunérés ; surveillant non rémunéré par défaut (réglable).

**O-21 — Validation « à quatre yeux ».** Faut-il interdire à celui qui saisit des heures « comptables » de les valider lui-même ? *Proposition* : oui, réglable par établissement.

### Dossiers et données personnelles

**O-07 — Fusion de dossiers en double.** Faut-il pouvoir fusionner deux dossiers d'un même élève ? *Proposition* : v1 sans fusion (avertissement à la création) ; fusion assistée par le support plus tard.

**O-08 — Informations de santé.** Voulez-vous des champs santé (allergies, maladies, vaccinations, contact médical) sur le dossier de l'élève ? C'est une donnée très sensible. *Proposition* : non en v1.

**O-15 — Durée de conservation.** Combien de temps garde-t-on le dossier d'un élève parti ou diplômé avant anonymisation (droit à l'effacement) ? *À nous fournir* : la durée légale applicable.

### Emploi du temps

**O-05 — Génération automatique de l'emploi du temps.** L'assistant actuel ne fonctionne pas. Voulez-vous (a) une **aide au placement** (suggestions de créneaux libres, détection de conflits — proposition pour la v1), (b) à terme un **générateur complet** qui construit l'emploi du temps à partir de contraintes et de préférences ? Si (b), quelles contraintes passent en premier (disponibilité des enseignants, salles, répartition des matières dans la semaine, pas plus de N heures d'affilée) ?

**O-23 — Qui peut déclarer ou modifier une séance ?** Les enseignants peuvent-ils créer une séance ponctuelle (rattrapage) pour leurs classes, réserver une salle ? *Proposition* : séance ponctuelle de leurs classes oui, réservation de salle selon permission.
