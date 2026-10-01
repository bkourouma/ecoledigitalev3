# Décisions techniques et questions métier — specs 011, 012, 013, 019, 032

**Statut** : Rédigé le 2026-10-01 par l'architecte du domaine évaluation/réglementation. Ce fichier est l'unique registre des décisions de conception tranchées pour les cinq specs et des questions que seul le propriétaire du produit peut trancher.

- **Partie A** — décisions techniques **tranchées** et justifiées (réversibles par un ADR si besoin).
- **Partie B** — **questions métier**, reformulées sans jargon, avec les options, la proposition retenue **par défaut** dans les specs (marquée ▶) et ce qui change si la réponse est différente.

---

## Partie A — Décisions techniques tranchées

| # | Décision | Justification | Alternatives écartées |
|---|---|---|---|
| A-01 | **Seul le module `rules` importe `@ecoledigitale/rules-engine`** ; `results`, `higher`, `reportcards` passent par `rules/index.ts`. | Frontière de module (ADR-001) ; une seule porte pour le cache, le journal d'erreurs, la résolution et le pin. Règle `dependency-cruiser` vérifiable. | Import direct du moteur par chaque module : duplication du cache et des garde-fous, chaînage non traçable. |
| A-02 | **Structure ≠ valeur** : le *chaînage* et l'ensemble des variables d'entrée sont un **contrat de règles** versionné dans le code (`credit-semester@1`, `coef-semester@1`) ; les *valeurs* (seuils, pondérations, expressions, libellés) sont des **RuleVersions** en base. | Le moteur ne chaîne pas (ADR-003, point 3). Les modules doivent construire des contextes typés ; un RuleSet qui changerait librement les variables d'entrée casserait les constructeurs de contexte. | Chaînage décrit en données (DAG dans le RuleSet) : trop de pouvoir donné aux rédacteurs, simulation et rejeu non garantis. Chaînage libre dans chaque module : incontrôlable. |
| A-03 | **Deux familles de tables** (nationales globales `rules.national_*` ; variantes `rules.*` avec RLS tenant). | `kernel.enable_tenant_rls` impose `tenant_id NOT NULL` et une policy unique ; une table à portée mixte exigerait une policy sur mesure hors du test d'isolation générique. Le patron « globale + écriture `system` » existe déjà (`rbac.permissions`). | Table unique avec `tenant_id NULL` + policy ad hoc : FK composites (tenant_id, id) inopérantes sur NULL. Tenant « plateforme » réservé : lecture croisée impossible sous RLS forcée. |
| A-04 | **Vocabulaire des règles en français** (clés de règles, variables, paramètres) ; **codes de sortie en anglais majuscule** + `label_map` français. | Les rédacteurs sont des directeurs des études (ADR-003 : « syntaxe proche du tableur, messages français ») ; les fixtures et 293 tests sont déjà en français. Les codes sont consommés par la logique (issue de décision) et par d'autres langues d'affichage. Exception assumée à ADR-007 §5 pour les identifiants de **données de règle** (les constantes TypeScript restent en anglais). | Tout en anglais : réécriture des fixtures et des tests, exige de former les rédacteurs à un anglais technique. Libellés en dur : comparaison de texte (défaut `buildAssignmentFlagsFromDecision`). |
| A-05 | **Pin de version par période** : `results` résout à la date de **début de période** et épingle `rule_version_id` sur l'état de période ; l'année a son propre pin. | Reproductibilité (bulletin explicable des années plus tard), absence d'ambiguïté en cas de réforme en cours d'année, déterminisme du recalcul. | Résolution à chaque calcul à `now()` : un recalcul d'hier donnerait un autre résultat qu'aujourd'hui ; réforme appliquée à moitié. |
| A-06 | **Valeurs exactes en base** (`numeric` sans arrondi), valeur d'**affichage** séparée (sortie de la règle `arrondi_affichage`) **jamais réinjectée** dans un calcul ni un seuil. | ADR-003 (9,995 ≠ 10) ; supprime la cascade d'arrondis du legacy. | `numeric(5,2)` : perte irréversible, seuils faux. |
| A-07 | **Résultats versionnés** : chaque recalcul qui change les entrées crée une nouvelle ligne d'en-tête (`DRAFT` ou supersession) ; `FINAL` est immuable (trigger). | Historique d'explication, aucune écriture destructive (le legacy faisait `DELETE`+`INSERT`), base du snapshot du bulletin. | Écrasement en place : perte de traçabilité. |
| A-08 | **Le verrou de période vit dans `assess`** (`assess.period_locks`), posé par `results` via l'API publique d'`assess` ; la simulation passe par événements. | Évite les cycles de dépendance `assess ↔ results` et `rules ↔ results`, tout en permettant un **trigger** SQL qui interdit l'édition d'une note d'une période verrouillée. | Lecture de `results` par `assess` (cycle) ; contrôle applicatif seul (contourné par un script). |
| A-09 | **Rejeu de reproductibilité** nocturne sur un échantillon de résultats `FINAL` et sur tout résultat de bulletin contesté. | Prouve en continu qu'un bulletin peut être reconstruit à l'identique ; détecte une altération de règle ou une régression du moteur. | Test unitaire seul : ne détecte ni corruption de données ni dérive d'environnement. |
| A-10 | **Cohorte de classement ≤ 5 000 valeurs par évaluation** (budget du moteur : 100 000 nœuds) ; au-delà, découpage par classe. | Le plafond de 300 du legacy supprimait les rangs sans le dire ; le calcul à `O(n)` par étudiant reste dans le budget jusqu'à ~30 000 valeurs, 5 000 laisse une marge. | Tri applicatif des rangs : sort de la règle (convention d'égalité hors RuleSet). |
| A-11 | **Règles optionnelles** dans un contrat (`is_optional`) pour porter les règles existantes mais inactives (`semestre_valide_par_credits`, `annee_validee_par_credits`). | Évite qu'une règle documentée mais jamais appliquée devienne active en silence, ou disparaisse. | Les supprimer (perte d'information), ou les activer (changement de comportement non décidé). |
| A-12 | **Types de règles du moteur réutilisés** : diplomation → `promotion`, capitalisation → `credit_validation` ; **aucune extension de `RULE_TYPES`**. | Le type ne fait que classer ; l'orchestration passe par la clé. Évite de modifier le package pour du vocabulaire. | Ajouter `graduation` : changement de moteur sans gain fonctionnel. |
| A-13 | **Publier ou approuver une version ne recalcule jamais** de résultat existant ; un recalcul modifiant des résultats est un acte de gestion (re-pin explicite sur période ouverte, après simulation). | Sécurité des bulletins remis ; intention explicite. | Recalcul automatique à la publication : dangereux et coûteux. |
| A-14 | **Banc d'essai (`/evaluate`) sans persistance**, budget par défaut, limité à 30 appels/min/utilisateur. | Aide à la rédaction sans créer de surface d'abus. | Pas de banc d'essai : l'éditeur perd son intérêt. |
| A-15 | **Authenticité des documents : signature Ed25519 du hash du snapshot** (clé privée plateforme, identifiant de clé stocké, clé publique publiée) + QR vers l'URL de vérification. | Vérifiable hors ligne par un tiers avec la clé publique ; rotation de clés par `key_id` ; pas de secret partagé à distribuer. | HMAC : vérifiable seulement par la plateforme ; PAdES/PDF signé : lourd, dépend d'une autorité de certification (à reconsidérer, Q-31). |
| A-16 | **Gabarits de bulletin = données versionnées par pack + options validées par tenant** ; **pas de HTML libre par tenant en V1** ; moteur de gabarit sans logique (liste blanche de composants), rendu Puppeteer **JavaScript désactivé, réseau coupé**. | Un gabarit HTML tenant exécuté dans Chromium côté serveur est un vecteur d'injection (SSRF, lecture de fichiers). Les options (colonnes, rang, logo, signatures) couvrent 90 % des besoins. | Édition libre du HTML par le tenant : à rouvrir en V1.5 avec sandbox renforcée (Q-32). |
| A-17 | **Vérification publique via un index global minimal** (`reportcards.verification_index` : code → tenant, document) lu par `SystemDb` avec raison, puis lecture RLS du tenant. | Endpoint non authentifié sans tenant connu ; aucune donnée personnelle dans l'index ; RLS inchangée. | Tenant dans l'URL : fuite de la liste des établissements, fragile. |
| A-18 | **Paie : formules en code de domaine pur** (prorata, heures supplémentaires hebdomadaires), **paramètres en données** (seuils, multiplicateurs, tarifs, mode d'arrondi) ; pas de RuleSet. | Ce ne sont pas des règles académiques (principe R2 vise l'académique) ; la parité exige exactement le comportement de la spec 031 ; golden tests purs. Si des cotisations légales variables arrivent (Q-28), un contrat `payroll-*` pourra être ajouté. | Moteur de règles pour la paie : sur-ingénierie sans besoin de variantes par tenant aujourd'hui. |
| A-19 | **Paie : montants en entiers (XOF), durées en minutes entières, arrondi demi-supérieur par ligne**, unicité d'une heure payée garantie par **contrainte** (`payroll.consumed_hours`). | ADR-007 (pas de flottants) ; la spec 031 reconnaissait la fragilité du prédicat « heure déjà payée » (période chevauchantes autorisées). | Heures décimales à 2 décimales (écart de 0,005 h × tarif par ligne) ; prédicat SQL seul. |
| A-20 | **Plages de migrations proposées** : `rules` 1000-1099, `assess` 1100-1199, `results` 1200-1299, `reportcards` 1300-1399, `higher` 1400-1499, `payroll` 1500-1599. | `module-conventions.md` : 100 numéros par module, attribution « dans l'ordre de création ». À valider et inscrire par le lead (collision possible avec les modules écrits en parallèle). | — |
| A-21 | **La spec 011 couvre deux modules** : `assess` (saisie, workflow, révisions) et `results` (calcul, décisions, clôture). | Le calcul dépend des règles et du curriculum ; la saisie des notes ne doit pas dépendre du moteur. Deux manifestes, deux schémas (comme demandé par le lead). | Un seul module : mélange saisie et calcul. |
| A-22 | **Signataires** : registre des identités dans `reportcards.signatories` (tous packs) ; association **emplacement → signataire** des documents officiels du supérieur dans `higher.official_document_slots`. | Les bulletins du primaire n'ont pas le pack Higher ; une identité de signataire unique évite deux annuaires divergents. | Deux annuaires (013 et 019) : divergence garantie. |
| A-23 | **Workflow de notes porté par l'évaluation** (une évaluation = une feuille de notes pour une classe), état répliqué sur chaque note (trigger de cohérence). | Une feuille = unité de travail de l'enseignant et du valideur ; l'immuabilité fine reste vérifiable par note ; pas de table intermédiaire inutile. | Workflow note par note : ingérable (40 notes par classe). Table `grade_sheets` distincte : une jointure de plus pour rien (évaluation et feuille sont 1:1). |
| A-24 | **Application d'une révision approuvée par un indicateur local de transaction** (`assess.apply_revision(revision_id)` pose `app.grade_revision_id`) que le trigger vérifie. | Seule voie légale pour modifier une note publiée ; `app_user` n'a pas d'autre droit ; l'application **et** le trigger imposent l'immuabilité. | Rôle SQL spécial : contourne le principe « un seul rôle applicatif ». |
| A-25 | **Résultats des rangs calculés en 2ᵉ phase par classe × période** (jeu de tâches distinct), après les calculs individuels. | Le rang d'un étudiant dépend de tous les autres ; il faut une photographie cohérente. | Rang recalculé à chaque note : tempête de recalculs. |
| A-26 | **Coalescence des recalculs** : file `results.recompute_requests` unique par `(classe, période)`, temporisation de 10 s après la dernière publication, un seul job actif par clé. | 40 notes publiées d'un coup ne doivent produire qu'un calcul de classe. | Un job par événement : tempête. |
| A-27 | **Séances et présences enseignants lues par ports** (`SessionHoursPort`, `TeacherAttendancePort`) ; la couche paie ne lit jamais les tables de `scheduling`/`attendance`. | ADR-006 (pas de jointure inter-modules) ; les événements/API publiques de 017 et 010 restent à confirmer. | Jointure SQL directe : interdit. |
| A-28 | **La sécurité du bulletin de paie reste : titulaire ou gestion**, appliquée par la **couche d'accès** (`requirePermission` + contrôle de propriété), pas par l'écran. | Le legacy n'avait aucun contrôle (corrigé le 2026-09-30, `1dbb34f`). | Contrôle d'interface seul. |
| A-29 | **Le verrou de période distingue les sessions** (`assess.period_locks.locked_sessions`) : la fenêtre de rattrapage ne libère que la session 2, la session 1 reste verrouillée. | Le rattrapage est un acte planifié, pas une « correction » : il ne doit pas rouvrir toute la période (ni exiger la permission sensible de réouverture). | Réouverture complète pour chaque rattrapage : risque de modifier les notes de session 1. |
| A-30 | **Lecture des sources de paie en direct par les ports** (pas de projection locale des séances/présences) ; agrégats calculés en mémoire sur la période (≤ quelques milliers de séances). | Autorité de la donnée (017/010) ; absence de désynchronisation entre « payable » et « tenue » ; cible 500 séances × 100 enseignants. Projection par événements envisageable si un tenant dépasse ~20 000 séances par période. | Projection locale alimentée par événements : rapide mais risque de payer une séance annulée entre-temps. |
| A-31 | **Une heure ne peut être réclamée qu'une fois : clé primaire `(origine, source, enseignant)`** dans `payroll.hour_claims`, supprimée par l'annulation du bulletin. | La garantie ne dépend plus d'un prédicat de requête ; elle tient en concurrence et avec des périodes chevauchantes (décision 0112). | Prédicat « heure déjà payée » seul (legacy). |
| A-32 | **Chaque heure est collectée par une seule origine** selon le pack de la classe (`payroll.settings.hour_source_by_pack`). | Évite le double comptage séance + présence d'un même cours dans un tenant qui a les deux sources. | Dédoublonnage a posteriori : possible mais fragile. |
| A-33 | **Les rangs et moyennes affichés viennent des résultats `FINAL`**, jamais recalculés au rendu. | Cohérence d'un document avec l'état de la classe au moment de la clôture ; pas de plafond de 300. | Calcul au rendu (legacy). |

---

## Partie B — Questions métier pour le propriétaire du produit

Chaque question décrit la **situation actuelle** (observée dans le fonctionnement existant), les **options**, la **proposition retenue par défaut** (▶) sur laquelle les specs sont écrites, et la **conséquence** d'une réponse différente. Aucune n'est technique : une réponse en une phrase suffit.

### Bloc 1 — Résultats du supérieur (spec 019 / 012)

**Q-01 — Quand un semestre est-il « validé » ? Quand passe-t-on en année supérieure ?**
Aujourd'hui, le relevé considère un semestre validé quand **toutes les UE** sont validées. Le code contient aussi deux règles écrites mais jamais utilisées : « semestre validé à 20 crédits » et « passage en année supérieure à plus de 48 crédits ».
Options : (1) ▶ toutes les UE validées (comportement réel) ; (2) 20 crédits par semestre ; (3) toutes les UE **ou** 20 crédits ; (4) autre règle officielle (à fournir). Pour le passage en année : (a) pas de règle automatique, décision du jury ; (b) plus de 48 crédits ; (c) autre.
Si différent : on active la règle optionnelle correspondante (déjà prévue) ; les décisions de passage changent pour certains étudiants (la simulation le montrera avant).

**Q-02 — Note de rattrapage (session 2) : laquelle compte ?**
Aujourd'hui, la note de session 2 **remplace** toujours celle de session 1, même si elle est plus basse.
Options : (1) ▶ elle remplace ; (2) on garde la **meilleure** des deux ; (3) la note de rattrapage est **plafonnée** (par exemple à 10) ; (4) autre.
Si différent : changement d'une seule règle (`note_examen_retenue`).

**Q-03 — Compensation entre UE d'un même semestre ?**
Aujourd'hui : compensation seulement **entre les ECUE d'une même UE**. Pas de compensation entre UE.
Options : (1) ▶ rien de plus ; (2) compensation entre UE si la moyenne du semestre est ≥ 10 et aucune note éliminatoire ; (3) autre.
Si différent : ajout d'une règle optionnelle de compensation ; incidence forte sur les validations.

**Q-04 — Note éliminatoire (inférieure à 5/20) : confirmer, et peut-on la rattraper en session 2 ?**
Aujourd'hui : une ECUE à moins de 5 bloque la validation de toute l'UE, sauf validation manuelle du jury ; elle peut être repassée en session 2.
Options : (1) ▶ conserver ; (2) seuil différent ; (3) élimination définitive (pas de rattrapage).

**Q-05 — Échelles de mention : une seule ou plusieurs ?**
Aujourd'hui : le relevé et le diplôme du supérieur utilisent **10 / 12 / 14 / 16 / 18** (Passable, Assez Bien, Bien, Très Bien, Excellent) ; la pile classique utilise **8 / 10 / 12 / 14 / 16** (Passable, Assez bien, Bien, Très bien, Excellent). Les deux ne disent pas la même chose pour une moyenne de 10,5.
Options : (1) ▶ conserver chaque échelle dans son jeu de règles ; (2) unifier sur l'échelle du supérieur ; (3) unifier sur l'échelle classique ; (4) échelle officielle à fournir. Faut-il une échelle **différente pour le diplôme** ?

**Q-06 — Arrondis : on calcule exactement et on arrondit à la fin ?**
Aujourd'hui, la moyenne du semestre est calculée à partir de moyennes d'UE **déjà arrondies** à deux décimales. Conséquence : l'affichage peut différer de 0,01 point par rapport à un calcul exact.
Options : (1) ▶ calcul exact, arrondi **uniquement** à l'affichage (deux décimales, demi supérieur) ; (2) conserver l'arrondi intermédiaire à deux décimales ; (3) autre.
Si différent : les moyennes affichées de certains étudiants changent de ±0,01 ; un seuil peut être franchi dans de très rares cas.

**Q-07 — Une moyenne de 9,995 est-elle « 10 » ?**
Aujourd'hui, les seuils (validé, éliminatoire…) sont testés sur la valeur **non arrondie** : 9,995 s'affiche 10,00 mais n'est **pas** validée.
Options : (1) ▶ conserver (la décision suit la valeur exacte) ; (2) la décision suit la valeur affichée (arrondie à deux décimales).
Si (2) : un étudiant à 9,995 est admis ; il faut aligner tous les documents.

**Q-25 — Un crédit (UE) acquis le reste-t-il toujours ?**
Options : (1) ▶ oui, définitivement ; (2) pendant N années ; (3) selon le programme (fiche à fournir).

**Q-26 — Prérequis entre UE : qu'est-ce qui les satisfait ?**
Aujourd'hui (module à la carte) : l'UE prérequise doit être **terminée/validée**. Une note minimale n'est pas exigée.
Options : (1) ▶ UE validée ; (2) UE suivie ; (3) note minimale à définir.

### Bloc 2 — Notes et évaluations (spec 011)

**Q-08 — La moyenne des devoirs tient-elle compte du poids de chaque évaluation ?**
Aujourd'hui : moyenne simple de tous les devoirs, le coefficient saisi sur chaque évaluation n'est pas utilisé.
Options : (1) ▶ moyenne simple (identique à aujourd'hui) ; (2) moyenne pondérée par le poids de chaque évaluation ou de chaque type d'évaluation.

**Q-09 — Sans examen, sans devoirs : que fait-on ?**
Aujourd'hui : sans note d'examen, l'ECUE n'a pas de note (« en attente ») ; sans devoir, le contrôle continu compte pour **0** (la note vaut 60 % de l'examen).
Options : (1) ▶ conserver ; (2) sans devoir, l'examen compte pour 100 % ; (3) autre.

**Q-10 — Une absence à une évaluation : zéro ou ignorée ?**
Aujourd'hui, il n'y a pas de règle : une note non saisie n'existe pas, il n'y a pas de zéro automatique.
Options : (1) ▶ absence justifiée **ignorée** ; absence injustifiée = 0 (règle paramétrable) ; (2) toujours ignorée ; (3) toujours 0.

**Q-11 — Dans un petit établissement, la même personne peut-elle saisir, valider et publier ?**
La procédure prévue est : l'enseignant saisit, un responsable relit et approuve, puis publie.
Options : (1) ▶ **deux personnes** différentes par défaut, avec une option d'établissement « tâches cumulables » (tracée dans l'historique) ; (2) toujours deux personnes ; (3) jamais d'obligation.

**Q-12 — Corriger une note après publication ou après clôture de période.**
Les corrections créent un historique (ancienne/nouvelle valeur, motif, approbateur).
Options pour une période **clôturée** : (1) ▶ correction possible avec approbation du directeur ; le bulletin est réédité en **nouvelle version** (l'ancienne reste consultable, marquée remplacée) ; (2) interdite : il faut rouvrir la période ; (3) délai maximal à définir. Faut-il **prévenir** automatiquement les parents d'un bulletin corrigé ?

**Q-23 — Comment calculer la moyenne d'une matière (pile classique) ?**
Aujourd'hui, les moyennes de matière sont **saisies à la main** : le système n'a aucune formule. Pour les calculer à partir des notes, quelle règle est pratiquée dans vos établissements ?
Options : (1) ▶ moyenne simple des notes ramenées sur 20 ; (2) moyenne pondérée par type d'évaluation (par exemple devoirs et composition avec des poids différents) — à préciser ; (3) l'établissement continue de saisir directement la moyenne de matière.

**Q-35 — Des établissements souhaitent-ils continuer à saisir directement les moyennes ?**
Options : (1) ▶ oui, via un type d'évaluation « moyenne saisie » (traçable, soumis au même circuit de validation) ; (2) non, calcul obligatoire.

**Q-38 — Barèmes autres que /20 ?** (notes sur 10, appréciations par compétences en maternelle, lettres)
Options : (1) ▶ barème libre par évaluation, ramené sur 20 par la règle ; (2) échelles de notation configurables par niveau (à définir avec les textes officiels).

**Q-18 — Classement : ex æquo.**
Aujourd'hui : deux élèves à égalité ont le même rang et le suivant saute (1er, 1er, 3ᵉ). Les moyennes sont considérées égales à quatre décimales.
Options : (1) ▶ conserver ; (2) égalité jugée sur la valeur affichée (deux décimales) ; (3) départage par une règle (ex. note de la matière principale).

**Q-19 — Distinctions et alertes (tableau d'honneur, encouragements, félicitations, avertissement).**
Aujourd'hui : tableau d'honneur dès 12, encouragements dès 15, félicitations dès 17 (classique) ; avertissement sous 10 sur le bulletin du supérieur.
Options : (1) ▶ conserver ; (2) supprimer des bulletins ; (3) seuils à fournir.

**Q-20 — Libellés officiels des décisions.** Les décisions actuelles (Admis, Rattrapage, Ajourné, Période validée, Renforcement recommandé, Redouble en cas d'échec au BTS…) sont-elles les bonnes ? Merci de fournir la nomenclature officielle si elle existe.

### Bloc 3 — Règles par ordre d'enseignement (spec 012, 005, 006, 018)

**Q-14 — Primaire et secondaire : quels textes officiels, et qui valide ?**
Voir `regulatory-sources-needed.md` §2 à §4. Merci de désigner **une personne de référence** (inspection, directeur d'un établissement pilote) pour valider chaque RuleSet avant publication, et de fournir les textes et des bulletins réels annotés. **Sans cela, aucun RuleSet primaire/secondaire officiel n'est publié.**

**Q-15 — BTS : quelles règles s'appliquent vraiment ?**
Aujourd'hui, les BTS sont traités par la pile « classique » (matières à coefficients, deux semestres, formule annuelle (S1 + 2 × S2)/3, décision « redouble en cas d'échec au BTS » en 2ᵉ année) alors que la mise en page « BTS » sert aux Licences 1 et 2 du module professionnel.
Options : (1) ▶ BTS = coefficients/semestres comme aujourd'hui, en attendant les textes ; (2) BTS = UE/ECUE à crédits ; (3) règles officielles du BTS à fournir.

**Q-16 — Une réforme en cours d'année : à partir de quand s'applique-t-elle ?**
Options : (1) ▶ à partir de la **période suivante** (une période déjà commencée garde ses règles) ; (2) seulement l'année scolaire suivante ; (3) rétroactive sur demande, avec nouvelle édition des bulletins.

**Q-17 — Quelle liberté pour les établissements sur leurs règles ?**
Options : (1) ▶ **V1** : un établissement ne modifie que des **paramètres** (seuils, pondérations) dans des bornes ; la modification de **formules** est réservée à une option payante avec validation de la plateforme ; (2) formules libres pour tous (après simulation) ; (3) aucune modification (règles nationales uniquement).
Dans tous les cas : simulation sur les données de l'établissement, puis validation par la plateforme avant activation.

**Q-34 — Date de délibération.** Le relevé indique aujourd'hui « le jury, vu le procès-verbal de délibération en date du… » en y mettant la **date du jour** de l'impression. Faut-il enregistrer la vraie date de délibération (avec le procès-verbal) et refuser le relevé définitif sans délibération ?
Options : (1) ▶ oui, date de délibération saisie, relevé définitif seulement après ; (2) non, comme aujourd'hui.

### Bloc 4 — Documents officiels (spec 013 / 019)

**Q-13 — Bulletins et impayés.** Doit-on pouvoir bloquer la remise du bulletin si les frais ne sont pas soldés ? Options : (1) ▶ non par défaut, **option d'établissement** activable ; (2) oui, toujours ; (3) jamais. (Aujourd'hui, une inscription non soldée est invisible de toute la scolarité.)

**Q-21 — Signataires par défaut.** Aujourd'hui, si un établissement n'a pas configuré ses signataires, les diplômes et attestations sortent avec **des noms de personnes réelles** inscrits en dur dans le code. Options : (1) ▶ **aucun signataire par défaut** : un document ne peut pas être imprimé tant que les signataires ne sont pas renseignés ; (2) signataire générique « Le Directeur ».

**Q-22 — Un diplôme révoqué peut-il être attribué de nouveau ?** Le code l'interdit (définitif) ; la documentation de la fonction dit « possible ensuite ». Options : (1) ▶ **définitif** sauf décision écrite du directeur général (nouvel octroi avec référence à la révocation) ; (2) toujours possible ; (3) jamais.

**Q-24 — Numérotation des diplômes et des attestations d'authenticité.** Format actuel : DIP-AAAA-NNNNNN et AUTH/AAAA/NNN, calculés en comptant les lignes existantes (risque de doublon ou de trou). Options : (1) ▶ séquences **sans trou ni doublon** par établissement et par année, démarrant à 1 sur une base neuve (aucune donnée actuelle à reprendre) ; (2) reprise d'un numéro de départ fourni par l'établissement ; (3) autre format officiel.

**Q-31 — Vérification publique d'un document (QR code).** Que doit voir une personne qui scanne le QR (employeur, administration) ? Options : (1) ▶ « Document authentique », nom, nature du document, date, établissement, mention ; **sans** notes ni date de naissance ; (2) uniquement « authentique / non authentique » ; (3) accès détaillé avec code remis par l'étudiant. Combien de temps un document reste-t-il vérifiable ? (▶ illimité pour un diplôme, 5 ans pour un bulletin.) À valider avec votre conseil juridique (protection des données personnelles).

**Q-32 — Personnalisation des modèles de bulletin.** Options : (1) ▶ V1 : choix du modèle de la plateforme + options (logo, couleurs, rubriques affichées, signatures, pied de page) ; (2) modèle entièrement dessiné par l'établissement (plus tard, avec contrôle).

**Q-33 — Langues des documents.** Options : (1) ▶ français uniquement en V1 ; (2) français + anglais pour les diplômes et relevés du supérieur.

### Bloc 5 — Paie des enseignants (spec 032)

**Q-27 — Règles de calcul de la paie : confirmer.** (a) Les heures sont comptées à la **minute** et les montants arrondis au **franc** (aujourd'hui deux décimales d'heure) ; (b) la semaine commence le **lundi** pour les heures supplémentaires ; (c) le salaire mensuel est proratisé sur les **jours ouvrés (lundi-vendredi)** sans jours fériés ; (d) pour une période de plus d'un mois, le prorata est aujourd'hui mal borné. Options pour (c) : (1) ▶ lundi-vendredi sans jours fériés, comme aujourd'hui ; (2) calendrier des jours fériés de l'établissement. Pour (d) : (1) ▶ calcul **mois par mois** ; (2) interdire les périodes de plus d'un mois pour les salariés.

**Q-28 — Retenues et cotisations légales.** Le module actuel ne calcule **aucune** retenue légale (seulement des primes et retenues saisies à la main). Souhaitez-vous les calculer ? Options : (1) ▶ non pour l'instant ; (2) oui (barèmes à fournir, voir `regulatory-sources-needed.md` §7).

**Q-29 — L'administrateur peut-il consulter le bulletin de paie d'un enseignant tant qu'il est impayé ?** Aujourd'hui : l'écran le bloque mais l'administrateur y accède par l'adresse du document. Options : (1) ▶ oui pour la gestion (constat du 2026-09-30) ; (2) non, bloqué pour tous jusqu'au versement.

**Q-30 — Validation par le propriétaire.** Aujourd'hui le propriétaire peut valider un bulletin (« calculé » → « arrêté »), l'administrateur aussi. Options : (1) ▶ les deux, selon les droits attribués ; (2) **obligatoirement** le propriétaire au-dessus d'un montant à définir ; (3) la personne qui calcule ne peut pas valider (séparation des tâches).

**Q-36 — D'où viennent les heures payables ?** Deux sources existent : les **présences** de l'enseignant (classes classiques) et les **séances validées** par la comptabilité (supérieur). Options : (1) ▶ conserver les deux, au choix de chaque établissement ; (2) une seule source (présences) ; (3) une seule source (séances validées).

**Q-37 — Deux périodes de paie peuvent-elles se chevaucher ?** Aujourd'hui oui, une heure n'est payée qu'une fois. Options : (1) ▶ oui (garanti par contrainte) ; (2) non.

**Q-40 — Un enseignant désactivé est-il encore payé de ses heures validées ?** La spécification de la paie dit oui (« ses séances validées avant la désactivation restent dues et sont payées ») ; le fonctionnement actuel ne paie que les enseignants actifs. Options : (1) ▶ oui, les heures validées non payées d'un enseignant désactivé sont payées et signalées dans le compte rendu ; (2) non, il faut réactiver l'enseignant avant de calculer (comportement actuel).

### Bloc 6 — Cas des élèves en mouvement (spec 011 / 013)

**Q-39 — Un élève change de classe en cours de période, ou arrive après le début.**
Aujourd'hui rien n'est défini : les notes suivent l'inscription d'origine, le bulletin se calcule sur la classe où l'élève est inscrit.
Options : (1) ▶ chaque classe calcule uniquement avec les notes qui lui appartiennent (l'élève reçoit un bulletin par classe pour la période) ; (2) reprise automatique des notes de l'ancienne classe pour les mêmes matières ; (3) l'évaluation passée avant l'arrivée de l'élève ne compte pas pour lui (aucune note requise), les matières absentes de sa classe d'origine sont ignorées. Une règle de transfert de notes devrait alors être décrite avec les textes officiels.
