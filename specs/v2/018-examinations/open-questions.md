# Décisions et questions ouvertes — 018-examinations

**Portée** : partie A = décisions **techniques** tranchées et justifiées ; partie B = **questions métier** non techniques (options, **valeur par défaut retenue** tant que le propriétaire n'a pas tranché ; `specs/v2/DECISIONS-METIER.md` l'emporte dès qu'une réponse y est inscrite). Les textes à obtenir sont dans `regulatory-sources-needed.md`.

Aucune règle officielle n'est inventée : une valeur par défaut est un **réglage modifiable** ou une **absence de règle**.

## A. Décisions techniques tranchées

| # | Décision | Justification | Alternative écartée |
|---|---|---|---|
| T-E01 | Un module **générique** `examinations` (schéma `examinations`, migrations `2000–2099`) ; CEPE, BEPC, BAC, BTS sont des **types** (données) | PRD §21 : « moteur générique » ; 006 et 020 réutiliseront sans code | Un module par examen |
| T-E02 | Une **session** = participation d'un établissement à une édition (ou examen blanc) ; sa **définition (séries, épreuves, coefficients) est copiée puis figée** | Une session passée doit rester reproductible même si le modèle évolue (coefficients modifiés à la rentrée suivante) ; testé | Lire la définition du type à chaque calcul |
| T-E03 | **Jamais de calcul d'admission officielle** : résultats `IMPORTED`/`ENTERED` seulement (déclencheur) ; `COMPUTED` réservé aux examens blancs | L'établissement ne prononce pas l'admission d'un examen national ; un calcul local faux serait pris pour un résultat ; les règles officielles sont inconnues | Calculer l'admission officielle « pour contrôle » |
| T-E04 | **Numéro de candidat attribué par la base** à l'inscription (compteur transactionnel par session, motif formaté par le type) ; le numéro officiel de l'autorité est un **identifiant** distinct | Sans trou, sans doublon, immuable, jamais réattribué ; deux sessions concurrentes se sérialisent (testé) ; l'autorité garde la maîtrise de son numéro | `MAX + 1` applicatif ; numéro officiel comme clé |
| T-E05 | `eligibility_status` et `outcome` sont **dérivés** par déclencheurs imbriqués (`pg_trigger_depth()`), jamais écrits directement | Aucun statut incohérent avec son journal ou son résultat, même par accès SQL direct ; testé | Colonnes libres contrôlées par l'API |
| T-E06 | Correction après résultats = **révision insérée dans la même transaction** (`xid`), approbateur ≠ demandeur | Trace avant correction, séparation des tâches, impossible à contourner par un réglage de transaction ; même patron que 005 | Journal d'audit seul |
| T-E07 | Formats d'export = **données** : colonnes citant des champs et transformations d'une **liste blanche** (`valid_export_columns`) ; **pas** de langage d'expression | Les fichiers officiels sont inconnus et changeront ; une expression libre serait un risque d'injection et de contournement | Gabarits de texte libres ; code par format |
| T-E08 | Un **lot d'import** (empreinte unique, lignes sans nom ni adresse, appliqué seulement sans erreur) ; l'**analyse** du fichier (colonnes, mapping) peut passer par 031 | Idempotence et traçabilité ; minimisation des données d'enfants | Application ligne à ligne sans lot |
| T-E09 | **Identité du candidat figée** à l'inscription (copie volontaire) | Les listes officielles transmises doivent rester reproductibles même si le dossier élève est corrigé ensuite | Lire `people` à chaque export |
| T-E10 | Contrat de règles **`exam-national@1`** (éligibilité, moyenne et issue d'un blanc, mention, rang, taux, arrondi) + RuleSet **fictif** `CI-EXAM-PLACEHOLDER` (`placeholder`) | Annoncé par 012 ; mécanisme testable sans texte ; le passage au réglementaire est une donnée | Constantes dans le module |
| T-E11 | Documents (convocation, attestation, relevé) **scellés par `reportcards`** (`requestOfficialDocument`, QR) ; ce module ne génère aucun PDF et ne signe rien | Un seul propriétaire de la signature et de la vérification publique (013) | PDF locaux |
| T-E12 | Un **candidat est un élève de l'établissement** ; pas de candidat libre en V1 | Cohérent avec `academic` / `people` (identité, tuteurs, portail) ; évite un dossier parallèle (Q-E15) | Table de candidats externes |
| T-E13 | Aucune FK inter-schémas ; les niveaux par **code** ; allowlist d'isolation **vide** | ADR-006 ; aucune table globale nécessaire | Table de types d'examens globale partagée entre tenants |
| T-E14 | Les essais de **concurrence** utilisent de vraies sessions Postgres (`dblink`) dans le banc d'essai | Une course ne se voit pas sur une seule session ; 20 inscriptions en parallèle → 20 numéros distincts | Test séquentiel |
| T-E15 | Statistiques : **compteurs en SQL**, **taux par règle** | Le dénominateur du taux est inconnu (Q-E08) ; un pourcentage stocké se désynchroniserait | Colonnes de pourcentage |
| T-E16 | `placeholder` ajouté à `source_kind` (voir 005, demande à 012) | Distingue le fictif du `platform` (portage fidèle du legacy) | Marquer par un nom |
| T-E17 | Aucun moteur de **jury / délibération nationale** | Le jury est celui de l'autorité ; l'établissement enregistre ses résultats | Table de délibérations |

## B. Questions métier (non techniques)

Format : **question** — options — **défaut retenu**.

| # | Question | Options | Défaut retenu |
|---|---|---|---|
| Q-E01 | Quelles sont les **épreuves**, leurs **barèmes** et **coefficients** du CEPE ? | à fournir (texte) | **Trois épreuves fictives** (`EP1` à `EP3`), marquées fictives, aucune valeur officielle |
| Q-E02 | Quelles sont les **conditions pour être candidat** ? (classe, âge, nombre de tentatives, pièces) | à fournir | Être **en classe d'examen** et avoir **toutes les pièces** (règle fictive) ; toute autre condition = règle à publier ; **dérogation motivée** possible |
| Q-E03 | Qui attribue le **numéro de candidat** ? quel format ? à quel moment ? | école ; autorité ; les deux | **Numéro interne** sans trou (`CEPE2027-00001`) à l'inscription **+ numéro officiel importé** comme identifiant distinct |
| Q-E04 | L'école est-elle **centre d'examen** ou rattachée à un **centre d'accueil** ? Qui répartit les candidats ? | centre propre ; centre d'accueil ; les deux | **Les deux sont supportés** ; répartition **manuelle ou automatique** selon les capacités ; aucune règle de séparation imposée |
| Q-E05 | Y a-t-il des **épreuves facultatives ou à option** ? Compensation entre épreuves ? | oui (lesquelles) ; non | Épreuve facultative **non comptée si non notée** ; **aucune compensation** |
| Q-E06 | Quel est le **seuil d'admission** ? Y a-t-il des notes éliminatoires, un repêchage, une délibération ? Qui délibère ? | à fournir | **Aucun seuil officiel** : l'admission officielle est **importée ou saisie** ; seul l'examen blanc calcule, avec un seuil **fictif** à 10 |
| Q-E07 | Existe-t-il une **session de rattrapage** (seconde session) ? | oui ; non | Prévue par `attempt_kind` (`NORMAL` / `MAKEUP`) ; **aucune règle** d'accès supposée |
| Q-E08 | Comment se **calcule le taux de réussite** officiel ? | admis ÷ présents ; admis ÷ inscrits ; autre | **Admis ÷ présents**, 2 décimales (**paramètre** de la règle `taux_reussite`) |
| Q-E09 | Y a-t-il des **mentions** au CEPE (ou au BEPC, BAC) ? lesquelles ? | oui (seuils) ; non | **Non** : règle `mention_examen` optionnelle et inactive |
| Q-E10 | Sous quelle forme l'établissement **reçoit-il les résultats** ? (fichier, papier, portail) Dans quel délai ? | à fournir (exemplaire) | **Import d'un fichier** (CSV) ou **saisie** ; format = donnée à créer à réception d'un exemplaire |
| Q-E11 | Sous quelle forme **transmet-il la liste de ses candidats** à l'autorité ? | fichier ; portail ; papier | **Export** paramétrable ; format fictif livré ; format officiel = donnée à créer |
| Q-E12 | Quels sont les **modèles officiels** de convocation, d'attestation de réussite et de relevé de notes ? Qui les signe ? | à fournir | Gabarits **génériques** (013) ; **aucun nom de signataire** par défaut |
| Q-E13 | **Frais d'examen** : l'école en perçoit-elle ? de qui ? | oui (montant, moment) ; non | **Aucun frais géré** par ce module ; un barème de frais d'examen est un barème `finance` si besoin |
| Q-E14 | Combien d'**examens blancs** et à quelles dates ? Quelle valeur pour l'école ? | libre | **Libre** : l'établissement crée autant de sessions blanches qu'il veut ; résultats **jamais officiels** |
| Q-E15 | Un **candidat libre** (non élève de l'école) peut-il être inscrit ? | oui ; non | **Non** en V1 : le candidat est un élève de l'établissement |
| Q-E16 | Combien de temps **conserver** listes, notes et résultats d'examen ? | durée ; illimitée | **Illimitée**, aucune purge ; identité des candidats d'une session **archivée** non modifiable |
| Q-E17 | Comment **corrige-t-on** un résultat déjà transmis ? Qui autorise ? | procédure à fournir | **Révision approuvée** par une personne **différente** du demandeur, motif ≥ 10 caractères ; le document émis est révoqué puis réémis |
| Q-E18 | Quelles informations du CEPE passent à l'**admission en 6e** ou à l'**affectation**, et à qui ? | résultat seul ; résultat et moyenne ; rien | **Résultat (admis / non admis) seul**, sans note ni moyenne, par événement `examinations.result.published` |
