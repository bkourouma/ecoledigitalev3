# Chapitre 11. Enseignement supérieur : UE, ECUE, crédits, rattrapage, dispenses, diplômes et attestations

> Écrans couverts : `/v2/higher` (redirige vers les diplômes), `/v2/higher/diplomas`, `/v2/higher/diplomas/<identifiant>`, `/v2/higher/attestations`, `/v2/higher/documents`, `/v2/higher/credits`, `/v2/higher/prerequisites`, `/v2/higher/resit`, `/v2/higher/exemptions`, `/v2/higher/annual-ues`, `/v2/higher/signatories`, `/v2/higher/me/documents`. Module serveur : `apps/api/src/modules/higher`. Établissement : **Université Horizon** (`superieur-test`), pack Supérieur (LMD), 2 semestres.
>
> **URL réelles.** Les routes de `apps/web/src/app/v2/higher/` sont servies telles quelles : `http://localhost:3000/v2/higher/...` (aucun préfixe supplémentaire, voir le chapitre 10). Connexion : `http://localhost:3000/login`.
>
> **Ce chapitre ne saisit aucune note.** La structure UE/ECUE se lit au curriculum (chapitre 03), les notes se saisissent au chapitre 08, le calcul des moyennes et la clôture du semestre se font au chapitre 09 : ici on lit leurs effets (crédits capitalisés, dettes d'UE, éligibilité) et on gère le rattrapage, les prérequis, les dispenses, les UE annuelles, les diplômes, les attestations et les documents officiels. Le relevé de notes d'un semestre est un bulletin à crédits (chapitre 10, scénario 10.13).

## Prérequis

- Chapitres 08 et 09 passés : notes du semestre 1 de "Licence 1 A" publiées, semestre clôturé avec le jeu de règles `CI-HIGHER-LMD` (lié par le seed au contrat `credit-semester@1`), crédits capitalisés par la clôture.
- Worker et Chrome actifs pour les PDF (voir chapitre 10) ; fenêtre de navigation privée pour la vérification publique.
- Comptes avec MFA : utiliser le code du moment (jamais dans les comptes rendus).
- **Ordre conseillé** : lectures 11.1 à 11.3, puis 11.4 (prérequis), 11.5 (dispense), 11.7 (rattrapage), 11.6 (UE annuelle) **après** le rattrapage (voir l'avertissement du scénario), puis la chaîne diplômes 11.8 à 11.17. Les actes durables (octroi, émission, révocation) en dernier, sur un seul compte.
- Les octrois de diplômes et les émissions de documents **ne se défont pas** : un octroi se révoque (acte terminal), un document ne se supprime jamais, une référence émise ne se réutilise pas.

## Comptes à utiliser (Université Horizon)

| Rôle | E-mail | MFA | Usage dans ce chapitre |
|---|---|---|---|
| Propriétaire | `direction.generale@superieur-test.test` | oui | tous les droits supérieurs |
| Directeur | `directeur@superieur-test.test` | oui | octroi forcé, révocation, dispenses, signataires datés |
| Directeur des études | `etudes@superieur-test.test` | oui | diplômes, octroi normal, documents, prérequis, rattrapages, crédits, UE annuelles, attestations |
| Secrétariat | `secretariat@superieur-test.test` | oui | documents émis (lecture, émission), dispenses (lecture) |
| Responsable pédagogique | `pedagogie@superieur-test.test` | oui | aucun accès (contrôle des refus) |
| Enseignant | `enseignant@superieur-test.test` | non | aucun accès (contrôle des refus) |
| Parent (DIABATE Séka) | `parent@superieur-test.test` | non | « Mes documents » des enfants |
| Élève (DIABATE Nadia) | `eleve@superieur-test.test` | non | « Mes documents » |

## Droits

| Écran / action | Permission | Rôles qui l'ont (source : `system-roles.ts`) |
|---|---|---|
| Diplômes (liste, fiche, candidats, progression), attestations (liste), UE annuelles (lecture) | `higher.diploma.read` | Propriétaire, Directeur, Directeur des études |
| Créer, modifier, synchroniser, supprimer un diplôme | `higher.diploma.manage` | Propriétaire, Directeur, Directeur des études |
| Octrois (lecture), octroyer, « Réévaluer les candidats » | `higher.award.read`, `higher.award.create` | Propriétaire, Directeur, Directeur des études |
| Octroi forcé, ré-octroi d'un diplôme révoqué | `higher.award.force` (sensible) | Propriétaire, Directeur |
| Révoquer un diplôme ou un document | `higher.award.revoke` (sensible) | Propriétaire, Directeur |
| Émettre diplôme, duplicata, attestations ; publier un document ; relancer un PDF | `higher.document.issue` (sensible) | Propriétaire, Directeur, Directeur des études, Secrétariat |
| Documents émis (liste, détail) | `higher.document.read` | Propriétaire, Directeur, Directeur des études, Secrétariat |
| Crédits et dettes ; vérifier un étudiant contre les prérequis | `higher.credits.read` | Propriétaire, Directeur, Directeur des études |
| Prérequis (modifier) | `higher.prerequisite.manage` | Propriétaire, Directeur, Directeur des études |
| Rattrapages | `higher.resit.manage` | Propriétaire, Directeur, Directeur des études |
| Durée de validité des crédits, politique de dispense | `higher.settings.manage` | Propriétaire, Directeur, Directeur des études |
| Dispenses (lecture) | `higher.exemption.read` | Propriétaire, Directeur, Directeur des études, Secrétariat |
| Accorder ou révoquer une dispense | `higher.exemption.grant` (sensible) | Propriétaire, Directeur |
| UE annuelles : déclarer, retirer | `higher.annual_ue.manage` (sensible) | Propriétaire, Directeur, Directeur des études |
| Signataires datés (`/v2/higher/signatories`) | `higher.slot.manage` | Propriétaire, Directeur |
| Mes documents (`/v2/higher/me/documents`) | `higher.self.read` ou `higher.child.read` | Élève (siens, publiés), Parent (enfants liés, publiés) |

Fonctions d'offre (pack Supérieur) : `higher.diplomas` (diplômes, documents, dispenses, UE annuelles), `higher.session2` (rattrapage), `higher.prerequisites`, `higher.attestations`. Aucun droit supérieur : Responsable pédagogique, Enseignant, Économe, Éducateur, Responsable des examens, Chargé d'admissions.

**Adresses à taper à la main qui doivent être refusées** (redirection vers `/unauthorized`, page « Accès refusé ») :

| Compte | Adresses |
|---|---|
| Enseignant, Responsable pédagogique | `/v2/higher`, `/v2/higher/diplomas`, `/v2/higher/credits`, `/v2/higher/documents`, `/v2/higher/resit` |
| Secrétariat | `/v2/higher/diplomas`, `/v2/higher/credits`, `/v2/higher/attestations`, `/v2/higher/signatories`, `/v2/higher/resit` |
| Directeur des études | `/v2/higher/signatories` (affectation des signataires réservée à la direction) |
| Élève, Parent | `/v2/higher/diplomas`, `/v2/higher/documents`, `/v2/higher/credits`, `/v2/higher/exemptions`, `/v2/higher/signatories` |
| Compte du Collège Le Baobab ou de l'École Les Palmiers (pack sans supérieur), p. ex. `direction.generale@secondaire-test.test` | `/v2/higher/diplomas`, `/v2/higher/documents` : la page peut s'ouvrir (la permission existe pour le propriétaire) mais l'API répond que la fonction n'est pas incluse dans l'offre (message du type "Cette fonctionnalité n'est pas incluse dans votre offre.") : à relever en test |

## Données de départ (seed)

Sources : `scripts/seed-v2/dataset.ts`, `scripts/seed-v2/scenario.ts`, `scripts/seed-v2/demo/index.ts` (fonction `higher`), `scripts/seed-v2/demo/results.ts`, `scripts/seed-v2/demo/reportcards.ts`.

- Programme "Informatique" (`INFO`), année scolaire courante, curriculum publié : niveau `L1` "Licence 1 A" > période `S1` "Semestre 1" > **UE 1** (`UE1`, 6 crédits : ECUE `E11` Algorithmique 3 crédits coefficient 2 ; ECUE `E12` Programmation 3 crédits coefficient 1,5) et **UE 2** (`UE2`, 6 crédits : ECUE `E21` Mathématiques 4 crédits coefficient 2 ; ECUE `E22` Statistiques 2 crédits coefficient 1). Total du semestre : 12 crédits. Le rattrapage est autorisé sur chaque ECUE.
- Classe "Licence 1 A" (`L1-A`), 8 étudiants notés (DIABATE Nadia et Salimata, BAMBA Aya et Fatou, COULIBALY Moussa et Salimata, TOURE Yao et Jean-Marc) ; DIABATE Séka est tuteur de Nadia et Salimata ; SORO Elie et Aya, N'GUESSAN Koffi et Aya n'ont pas de notes (inscriptions à confirmer).
- Semestre 1 clôturé avec `CI-HIGHER-LMD` (jeu de la plateforme, source "platform" : pas de mention de démonstration). Quels étudiants valident leurs UE dépend des notes de la graine : **à relever en 11.2**, ne pas le présumer.
- Relevés de notes du semestre 1 émis et publiés (chapitre 10). Signataire "Directeur Fictif" présent (côté bulletins).
- **Aucun** diplôme, document officiel, dispense, UE annuelle, prérequis, fenêtre de rattrapage, ni emplacement de signature n'existe au départ : "Aucun diplôme.", "Aucun document.", "Aucune dispense", "Aucune UE annuelle", « Aucune fenêtre de rattrapage. », "Aucun signataire affecté." sont normaux.
- Politique de dispense par défaut : « Enregistrer seulement » (aucun crédit inscrit). Durée de validité des crédits : sans limite.

---

## Scénarios

### A. Lectures : structure, validation du semestre, crédits

#### 11.1 Structure UE / ECUE du curriculum (lecture)
Compte : Directeur des études (`etudes@superieur-test.test`) · Où : module "Académique" > curriculum (`/v2/academic/curriculum`) · Prérequis : seed.
1. Choisir le programme "Informatique" et l'année en cours ; lire la version publiée.
2. Déplier "Licence 1 A" > "Semestre 1" > "UE 1" et "UE 2".
3. Relever pour chaque UE et chaque ECUE son code, ses crédits et son coefficient (voir "Données de départ").

Résultat attendu : 2 UE de 6 crédits, 4 ECUE (3, 3, 4, 2 crédits ; coefficients 2, 1,5, 2, 1), somme 12 ; le rattrapage est autorisé sur chaque ECUE. Cet écran est couvert en détail au chapitre 03 ; il sert ici de référence aux chiffres de 11.2 et 11.3.

- [ ] Deux UE, quatre ECUE, 12 crédits

#### 11.2 Semestre validé = toutes les UE ; relevé de notes à crédits (lecture)
Compte : Directeur des études · Où : "Résultats de classe" (`/v2/results/matrix`, chapitre 09) puis `/v2/reportcards` (chapitre 10) · Prérequis : 11.1.
1. Dans `/v2/results/matrix`, choisir "Licence 1 A" et "Semestre 1" ; relever pour chaque étudiant noté : l'état de chaque UE (colonnes de détail), le total de crédits "x / 12" et le statut du semestre. **Dresser le tableau** :

   | Étudiant | UE 1 | UE 2 | Crédits | Semestre |
   |---|---|---|---|---|
   | (à compléter en test pour les 8 étudiants) | validée / non | validée / non | x / 12 | Validé / Non validé |

2. Règle à contrôler : le semestre n'est « Validé » que si **toutes** les UE le sont ; un étudiant qui valide une seule UE a 6 / 12 crédits et un semestre non validé (à confirmer sur la ligne concernée) ; une UE sans résultat est "en attente", jamais "ajournée".
3. Ouvrir `/v2/reportcards` (classe "Licence 1 A", période "Semestre 1") puis la fiche d'un étudiant : la ligne « Crédits » affiche les mêmes "x / 12" que la matrice.

Résultat attendu : crédits de la fiche du relevé = crédits de la matrice = base de 11.3 ; le relevé reprend les valeurs figées de la version de résultats utilisée.

- [ ] Tableau des 8 étudiants dressé  - [ ] Règle "toutes les UE" confirmée  - [ ] Crédits du relevé = matrice

#### 11.3 Crédits et dettes d'un étudiant ; durée de validité des crédits
Compte : Directeur des études · Où : menu "Enseignement supérieur" > rubrique « Crédits et dettes » (`/v2/higher/credits`) · Prérequis : 11.2 (tableau des étudiants).
1. Lire le titre « Crédits et dettes d'UE » et le message « Choisissez un étudiant. »
2. Dans « Étudiant » (placeholder « Rechercher un étudiant… »), taper "DIABATE" puis choisir DIABATE Nadia.
3. Lire la « Synthèse » : « Crédits acquis », « UE acquises », « Dettes d'UE ouvertes ». Lire le « Registre des crédits » : colonnes « UE », « Crédits », « Acquisition » (par exemple "Validation directe · session 1"), « Moyenne », « État » (« Acquise »), « Valide jusqu'au » (« sans limite »). Chaque UE est désignée par un identifiant court "UE xxxxxxxx" (écart de présentation, voir plus bas) ; les crédits correspondent à ceux de 11.2.
4. Section « Dettes d'UE » : "Aucune dette d'UE." si toutes les UE sont validées ; pour un étudiant qui n'a pas validé une UE (11.2) : une ligne avec le badge « Ouverte » et "Détectée le …".
5. Choisir SORO Elie (étudiant sans note) : « Aucun crédit enregistré. » et "Aucune dette d'UE.".
6. Section « Durée de validité des crédits » (visible pour ce compte) :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Validité des crédits (mois) | 60 | non (aide : « Vide : les crédits n'expirent pas. ») |

   Cliquer « Enregistrer » (bouton inactif tant que rien n'est modifié) : « Le réglage est enregistré. »
7. Rétablir : vider le champ et « Enregistrer » → « Le réglage est enregistré. » (retour à "sans limite").

Résultat attendu : synthèse = somme des lignes du registre ; les crédits d'une UE sont figés à l'acquisition (changer la durée de validité ne modifie pas les lignes existantes : à vérifier).

Cas invalides (champ « Validité des crédits (mois) ») :

| Saisie | Message attendu |
|---|---|
| `abc` | « Saisissez un nombre de mois entier (1 à 1200), ou laissez vide. » |
| `0` ou `1201` | le même message |
| `12,5` | le même message (entier attendu) |

- [ ] Cas nominal (registre cohérent)  - [ ] État vide (étudiant sans note)  - [ ] Cas invalide  - [ ] Droit refusé pour Secrétariat (`/v2/higher/credits`)

---

### B. Règles d'accès aux UE : prérequis, dispenses, UE annuelles

#### 11.4 Prérequis entre UE
Compte : Directeur des études · Où : menu "Enseignement supérieur" > « Prérequis » (`/v2/higher/prerequisites`) · Prérequis : 11.1.
1. Titre « Prérequis entre UE ». Sans choix : « Choisissez un programme et une année pour afficher ses UE. »
2. Section « Choix du curriculum » : « Programme » = Informatique, « Année » = l'année en cours (la version publiée est choisie d'office). La liste « UE du programme » apparaît ; par défaut seuls les éléments qui portent des crédits sont proposés. Choisir la ligne "UE 2" (code `UE2`, la ligne UE, pas une ECUE).
3. Le panneau « Prérequis de UE 2 » affiche « Cette UE n'a aucun prérequis. » Cliquer « Ajouter un prérequis » et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | UE prérequise | UE1 — UE 1 | oui |
   | Condition | UE validée — l'étudiant a acquis l'UE | oui |

4. Cliquer « Enregistrer les prérequis ».

Résultat attendu (si l'identification des UE fonctionne) : « Les prérequis de UE 2 sont enregistrés. » ; si des étudiants inscrits à UE 2 ne satisfont pas la condition, un avertissement indique le nombre d'étudiants concernés avec « Leurs inscriptions à l'UE ne sont pas modifiées : à vous de les accompagner. » Les prérequis sont en logique ET.

5. Section « Un étudiant satisfait-il les prérequis ? » : choisir DIABATE Nadia : badge « Prérequis satisfaits » ou « Prérequis non satisfaits » avec la liste « Prérequis manquants » (par exemple « UE non acquise »). Refaire avec un étudiant qui n'a pas validé UE 1 (11.2).
6. Essayer la condition « Moyenne minimale » : champ « Moyenne minimale » (aide : « Une moyenne sur 20 (par exemple 10 ou 12,5). »), valeur `10`, enregistrer, contrôler le résultat pour un étudiant ; rétablir ensuite.
7. Retirer le prérequis (« Retirer ce prérequis ») et « Enregistrer les prérequis » : retour à « Cette UE n'a aucun prérequis. »

**Écart probable à vérifier d'abord** : l'écran envoie à l'API l'identifiant du nœud de curriculum de l'UE, alors que `GET`/`PUT /api/v1/higher/ue/:nodeId/prerequisites` attend l'identifiant de la **lignée** de l'UE (`lineageId`), seul identifiant que l'adaptateur `apps/api/src/platform/adapters/academic-higher.ts` sait résoudre. Si l'enregistrement de l'étape 4 est refusé avec un message du type "UE introuvable (…)", consigner le texte exact, marquer 11.4 "bloqué par l'écart" et passer au scénario suivant (voir "Écarts constatés").

Cas invalides :

| Saisie | Message attendu |
|---|---|
| Condition « Moyenne minimale » sans valeur | "Valeur invalide." sous le champ |
| « Moyenne minimale » = `25` | "La valeur doit être inférieure ou égale à 20." |
| Prérequis de "UE 1" = "UE 2" alors que "UE 2" exige "UE 1" (cycle) | refus du serveur : "Ces prérequis créeraient un cycle entre UE." |
| UE prérequise laissée vide | "Choix invalide." |
| Même UE prérequise deux fois | refus : "Un même prérequis ne peut figurer qu'une fois." (le sélecteur ne propose pas une UE déjà prise) |
| Une UE comme prérequis d'elle-même | non proposée par la liste ; serveur : "Une UE ne peut pas être son propre prérequis." |

- [ ] Cas nominal  - [ ] Cas invalide (cycle, moyenne)  - [ ] Droit : Secrétariat refusé (`/v2/higher/prerequisites`)

#### 11.5 Dispense d'UE (politique d'établissement, octroi, révocation)
Comptes : Directeur des études (lecture et politique), puis Directeur (`directeur@superieur-test.test`, octroi et révocation) · Où : menu "Enseignement supérieur" > « Dispenses d'UE » (`/v2/higher/exemptions`) · Prérequis : 11.2 ; choisir un étudiant noté qui n'est pas DIABATE Nadia (ici COULIBALY Moussa).
1. Directeur des études : lire le titre « Dispenses d'UE », la carte « Effet d'une dispense sur les crédits » (liste « Politique de crédits » avec « Enregistrer seulement » sélectionné et l'aide « La dispense est tracée mais ne change ni les crédits, ni la validation, ni l'éligibilité au diplôme. »), le filtre « Afficher » sur « Accordée » et « Aucune dispense ». Aucun bouton « Accorder une dispense » pour ce compte.
2. Directeur : cliquer « Accorder une dispense » : fenêtre « Accorder une dispense d'UE » ("Décision de la direction. Le motif est obligatoire (10 caractères au moins)…"). Remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Étudiant | COULIBALY Moussa (placeholder « Rechercher un étudiant ») | oui |
   | Inscription | la seule inscription active proposée (n° d'inscription · date) | oui |
   | UE dispensée | UE2 — UE 2 | oui |
   | Semestre de rattachement | Semestre 1 | oui |
   | Motif de la dispense | Dispense accordée pour test guide (équivalence) | oui (10 caractères au moins) |

3. Cliquer « Accorder la dispense ».

Résultat attendu : « La dispense est accordée. » ; nouvelle ligne : étudiant, UE, "Aucun effet sur les crédits", motif, date, badge « Accordée ». Sur `/v2/higher/credits`, le registre de COULIBALY Moussa n'a **pas** de ligne « Dispense » (politique "enregistrer seulement").

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Motif de la dispense » = `court` | "Au moins 10 caractères." sous le champ |
| Aucun étudiant choisi | « Choisissez un étudiant. » |
| Étudiant sans inscription active (p. ex. SORO Elie) | « Cet étudiant n'a aucune inscription active. » |
| Même étudiant, même UE une seconde fois | refus : "Cet étudiant est déjà dispensé de cette UE." |

4. **Politique « Inscrire les crédits de l'UE »** (Directeur des études ou Directeur) : choisir cette option dans « Politique de crédits » (effet immédiat ; aide « L'UE dispensée compte comme acquise : prérequis, attestation et éligibilité au diplôme. » ; rappel « Changer ce paramètre ne réécrit aucune dispense déjà accordée. »). Accorder une seconde dispense (même étudiant ou un autre, UE différente, motif "Dispense avec crédits pour test guide") : la ligne affiche "6 crédits inscrits au registre" et le registre de crédits de l'étudiant gagne une ligne « Dispense » (colonne « Acquisition »). **Rétablir ensuite** la politique « Enregistrer seulement ».
5. Révoquer : Directeur, ligne de la dispense, bouton « Révoquer » : fenêtre « Révoquer la dispense » ; « Motif » = `abc` → « Le motif doit comporter au moins 10 caractères. » ; « Motif » = `Révocation de la dispense test guide` → « La dispense est révoquée. » ; badge « Révoquée », filtre « Afficher » = « Révoquée » la liste. Si les crédits avaient été inscrits, l'écriture du registre est révoquée (sauf si un diplôme octroyé s'y appuie : refus "Un diplôme octroyé s'appuie sur les crédits de cette dispense : révoquez d'abord le diplôme.").

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Politique changée puis rétablie  - [ ] Droit : Directeur des études sans bouton « Accorder une dispense » ; Secrétariat lecture seule

#### 11.6 UE annuelle (déclarer, puis retirer)
Compte : Directeur des études · Où : menu "Enseignement supérieur" > « UE annuelles » (`/v2/higher/annual-ues`) · Prérequis : 11.7 terminé. **Avertissement : une UE annuelle change le calcul de l'UE à la prochaine clôture de semestre (les crédits ne sont inscrits qu'une fois tous les semestres reçus) ; faire ce scénario après le rattrapage, et retirer la déclaration aussitôt.**
1. Lire « UE annuelles », la note « La moyenne commune, la validation et l'état de l'UE sont calculés par les règles de calcul de l'établissement (RuleSet), jamais par cet écran. Une UE annuelle compte pour une seule exigence de diplôme. » et « Aucune UE annuelle » / « Toutes les UE sont traitées semestre par semestre. »
2. Cliquer « Déclarer une UE annuelle » et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | UE principale (semestre 1) | Programme Informatique, année en cours, nœud "UE2 — UE 2" | oui |
   | UE du second semestre (facultatif) | (laisser vide : la même UE est offerte sur les deux semestres) | non |
   | Nombre de semestres | 2 semestres | oui |
   | Motif de la déclaration | UE annuelle de test guide | oui (5 caractères au moins) |

3. Cliquer « Déclarer ».

Résultat attendu : « L'UE annuelle est déclarée. » ; une carte "UE2 — UE 2" avec le badge "2 semestres", « UE des semestres : … », "Déclarée le … — UE annuelle de test guide".

Cas invalides :

| Saisie | Message attendu |
|---|---|
| "UE principale" non choisie | « Choisissez l'UE principale. » |
| « Motif de la déclaration » vide | « Ce champ est obligatoire. » ou "Au moins 5 caractères." (à relever) |
| Déclarer deux fois la même UE | refus : "Cette UE est déjà déclarée annuelle." |

4. Retirer : bouton « Retirer » de la carte (aria "Retirer — UE2 — UE 2") : fenêtre « Retirer la déclaration » (« Possible seulement tant qu'aucun résultat de semestre n'a été reçu pour cette UE. »), « Motif » = `abc` → « Le motif doit comporter au moins 5 caractères. » ; « Motif » = `Retrait test guide` → « La déclaration est retirée. » et retour à « Aucune UE annuelle ».

- [ ] Cas nominal (déclarée puis retirée)  - [ ] Cas invalide  - [ ] Droit : Secrétariat refusé (`/v2/higher/annual-ues` : pas de `higher.diploma.read`)

---

### C. Rattrapage (session 2)

#### 11.7 Rattrapage : candidats, fenêtre, inscrits, clôture
Compte : Directeur des études · Où : menu "Enseignement supérieur" > « Rattrapages » (`/v2/higher/resit`, même écran que `/v2/results/resit`) · Prérequis : 11.2 ; fonction d'offre `higher.session2`. **Action durable : ouvrir une fenêtre rouvre la période pour la seule session 2 ; la clôturer ensuite.**
Règle métier confirmée (2026-10-01) : la note de session 2 **remplace toujours** celle de session 1, même si elle est plus faible.
1. Titre « Rattrapages (session 2) » ; description « La session 2 remplace la session 1 : ouvrir la fenêtre ne déverrouille que les notes de session 2. » ; message « Choisissez une classe et une période. »
2. Choisir « Classe » = Licence 1 A, « Période » = Semestre 1. Lire « Candidats au rattrapage » : colonnes « Étudiant », « Cours à repasser » (identifiant court "cours xxxxxxxx"), « Moyenne session 1 ». Si personne n'a d'UE non validée : « Aucun candidat. » et « Les candidats sont désignés par les résultats clôturés de la période. » ; dans ce cas ne pas ouvrir de fenêtre (le serveur répondrait "Aucune ECUE à repasser pour cette classe et cette période.") et passer à 11.8.
3. S'il y a des candidats, cliquer « Ouvrir une fenêtre » (« Ouvrir une fenêtre de rattrapage ») et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Ouverture | 2026-10-12 | oui |
   | Fermeture | 2026-10-30 | oui |

   (Décaler ces dates si la base a été créée une autre année.) La fenêtre rappelle « La période doit avoir été clôturée ; elle est rouverte pour la seule session 2. »
4. Cliquer « Ouvrir la fenêtre ».

Résultat attendu : « Fenêtre ouverte : N inscriptions créées, 0 déjà inscrits. » ; section « Fenêtres de rattrapage » : "Du … au …", badge « Ouverte », « Tous les cours à repasser » ; bouton « Inscrits » liste les étudiants avec leur statut (« Inscrit », puis « Présent », « Absent », « Dispensé », « Noté ») et "session 1 : x,xx".

5. (Bout en bout, long ; à relever) Avec `enseignant@superieur-test.test`, saisir les notes de session 2 selon le circuit du chapitre 08 (évaluation de session 2, type d'évaluation et ECUE autorisant le rattrapage), les faire relire, approuver et publier, puis reclôturer la période au chapitre 09. Dans `/v2/higher/credits`, l'UE validée par rattrapage porte « Rattrapage » en « Acquisition » ; la note de session 2 est retenue **même si elle est inférieure** à celle de session 1.
6. Fermer : bouton « Clôturer la fenêtre » : fenêtre « Clôturer la fenêtre de rattrapage » (« Les notes de session 2 sont reverrouillées ; la période pourra être reclôturée. ») ; case « Confirmer la clôture » (motif facultatif) puis « Clôturer la fenêtre » → « La fenêtre de rattrapage est clôturée. » ; badge « Clôturée ».

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Fermeture » = 2026-10-05 (avant « Ouverture ») | "La fin de la fenêtre précède son début." sous « Fermeture » |
| « Ouverture » vide | "Date attendue au format AAAA-MM-JJ." |
| Ouvrir une seconde fenêtre pour la même classe et la même période | refus : "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période." |

- [ ] Cas nominal (fenêtre ouverte puis clôturée)  - [ ] Cas invalide  - [ ] (si note saisie) session 2 remplace session 1  - [ ] Droit : Secrétariat refusé (`/v2/higher/resit`)

---

### D. Diplômes, signataires et documents officiels

> **Avertissement sur 11.8 et 11.14.** L'écran de choix du « Nœud du curriculum » envoie à l'API un identifiant de nœud de curriculum, alors que `POST /api/v1/higher/diplomas/from-curriculum` et `GET /api/v1/higher/attestations/roster` attendent l'identifiant du **programme** (voir `apps/api/src/platform/adapters/academic-higher.ts`, fonction `getNode` fondée sur `getCycleFacts(programId)`). Si la création du diplôme est refusée avec le message "Nœud du curriculum introuvable (…)", la chaîne 11.9, 11.10, 11.12, 11.13 (hors liste vide), 11.15, 11.16 (documents publiés) et 11.17 est **bloquée** : cocher "Bloqué par 11.8", consigner le message exact et passer à 11.11 et 11.18. Ne pas contourner par une requête directe.

#### 11.8 Créer, modifier, synchroniser, supprimer un diplôme
Compte : Directeur des études · Où : menu "Enseignement supérieur" > « Diplômes » (`/v2/higher/diplomas` ; `/v2/higher` y redirige) · Prérequis : 11.1.
1. Lire « Diplômes » : description « Définitions de diplômes rattachées à un cycle du curriculum. L'éligibilité est décidée par les règles de calcul. », recherche « Rechercher un diplôme », filtre « État » (« Tous les états »), « Aucun diplôme. » et « Créez un diplôme à partir d'un cycle du curriculum. »
2. Cliquer « Nouveau diplôme » (fenêtre « Nouveau diplôme »). Dans l'encadré « Cycle du curriculum » : « Programme » = Informatique, « Année académique » = l'année en cours, « Nœud du curriculum » = "L1 — Licence 1 A" (aide « Nœud représentant le cycle (par exemple la licence). »). Remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code du grade | LICENCE (aide « Majuscules, chiffres et _ (par exemple LICENCE). ») | oui |
   | Code du diplôme | TG-LIC-INFO (facultatif : déduit du cycle si vide) | non |
   | Intitulé | Licence Informatique test guide | non |
   | UV requises | 12 (vide : reprend le total des UE du cycle) | non |
   | Description | Diplôme de test guide | non |
   | Octroi automatique | décochée | non |

3. Cliquer « Créer le diplôme ».

Résultat attendu : « Le diplôme Licence Informatique test guide est créé. » ; ligne dans le tableau « Diplômes » (colonnes « Diplôme », « Grade », « UV requises », « Octroi », « État ») : "TG-LIC-INFO", LICENCE, 12, « Manuel », badge « Actif ».

Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Code du grade » vide | "Code de grade attendu : majuscules, chiffres et _ (2 à 32)." |
| « Code du grade » = `L` | le même message |
| « Code du diplôme » = `TG LIC` (espace) | "Code attendu : majuscules, chiffres, - et _ (2 à 50)." |
| « UV requises » = `0` | message du schéma (valeur positive) : à relever |
| « UV requises » = `12,345` | message du schéma (deux décimales) : à relever (risque de texte en anglais) |
| « Code du diplôme » = `TG-LIC-INFO` une seconde fois | refus : "Le code "TG-LIC-INFO" est déjà utilisé." |
| « Nœud du curriculum » non choisi | "Choix invalide."... à relever |

4. Ouvrir le diplôme (clic sur son intitulé, `/v2/higher/diplomas/<identifiant>`) : en-tête "TG-LIC-INFO · LICENCE · 12 UV requises (12 listées)" ; rubriques « Exigences » (UE 1 et UE 2, badge « Obligatoire », "6 crédits"), « Candidats », « Octrois » ; « 0 octrois, dont 0 en vigueur. »
5. « Modifier » : fenêtre « Modifier le diplôme » (champs « Intitulé », « UV requises », « État », « Octroi automatique ») ; « Intitulé » = `Licence Informatique test guide (modifié)` puis « Enregistrer » → « Le diplôme est modifié. ». Cliquer « Enregistrer » sans rien changer : message "Au moins un champ à modifier." (affichage à relever).
6. « Synchroniser avec le curriculum » : « Exigences synchronisées : 0 ajoutées, 0 retirées, 0 mises à jour. »
7. Créer un second diplôme à supprimer (mêmes gestes ; « Code du grade » = `LICENCE`, « Code du diplôme » = `TG-DEL-001`, « Intitulé » = `Diplôme à supprimer test guide`), l'ouvrir, « Supprimer » : fenêtre « Supprimer le diplôme » (« La suppression est refusée s'il existe un octroi. »), « Confirmer la suppression » (motif facultatif), « Supprimer » → « Le diplôme est supprimé. »
8. Recherche : taper `TG-LIC` dans « Rechercher un diplôme » ; filtre « État » = « Inactif » → « Aucun diplôme. ».

- [ ] Cas nominal (diplôme créé avec ses exigences)  - [ ] Cas invalide  - [ ] Modifier / synchroniser / supprimer  - [ ] Droit : Secrétariat refusé (`/v2/higher/diplomas`)

#### 11.9 Candidats, progression, éligibilité et octroi
Compte : Directeur des études · Où : fiche du diplôme > rubrique « Candidats » · Prérequis : 11.8, 11.2.
1. Cliquer « Réévaluer les candidats » (aide « Rejoue la règle d'éligibilité et octroie automatiquement les diplômes à octroi automatique. ») : message « Recalcul terminé : N évalués, 0 octroyés, 0 en échec. » (0 octroyé car « Octroi automatique » décoché).
2. Lire le tableau « Candidats au diplôme » : « Étudiant » (avec matricule), « UV validées » ("12 UV (100 %)"), « UE obligatoires manquantes », « Éligibilité » (badge « Éligible » ou « Non éligible », « Non évaluée »). Les candidats sont les étudiants du cycle ayant au moins une UE acquise. Comparer avec le tableau de 11.2 : éligible = les deux UE acquises (la règle `diplome_eligible` décide, pas l'écran).
3. Pour un candidat, « Progression » : fenêtre « Progression de DIABATE Nadia » avec "12 UV validées sur 12 (100 %)", "Éligible.", "Règle CI-HIGHER-LMD, version 1" et les listes « UE obligatoires manquantes », « UE restantes », « UE validées ».
4. **Octroi normal** : pour DIABATE Nadia **si elle est éligible** (sinon le premier candidat éligible, noté "étudiant A") : « Octroyer » (aria « Octroyer le diplôme à DIABATE Nadia »), fenêtre « Octroyer le diplôme à DIABATE Nadia » (« Un octroi est tracé et numéroté sans trou ; il fige la version de règle qui l'a décidé. » et « L'étudiant est éligible : l'octroi sera enregistré. »), « Octroyer ». Message « Diplôme octroyé à DIABATE Nadia (DIP-AAAA-NNNNNN). » (référence au format par défaut `DIP-AAAA-NNNNNN`).
5. Rubrique « Octrois » : carte avec la référence, badges « Obtenu » et « Octroi manuel » ; « Crédits » = 12, « Moyenne du cycle », « Mention (code) » (probablement PENDING tant qu'un semestre du cycle n'a pas de résultat définitif), « Date d'acquisition », « Règle appliquée » = `CI-HIGHER-LMD · v1`, « Octroyé par » (nom et date). Compteur : « 1 octrois, dont 1 en vigueur. »
6. Rejouer « Octroyer » pour le même étudiant n'est plus proposé (le bouton disparaît pour « Obtenu »).

Résultat attendu : l'éligibilité est décidée par les règles, jamais à la main ; chaque octroi est numéroté sans trou (une annulation ne consomme pas de numéro) et fige la version de règle. **Octroi irréversible** : il ne peut qu'être révoqué (acte terminal, 11.17).

Cas invalide : candidat « Non éligible » : pas de bouton « Octroyer » pour le Directeur des études (seul le Directeur peut forcer, 11.10).

- [ ] Cas nominal (octroi, référence, règle figée)  - [ ] Progression lisible  - [ ] Cas invalide  - [ ] Droit : Directeur des études sans « Octroi forcé »

#### 11.10 Octroi forcé et ré-octroi
Compte : Directeur (`directeur@superieur-test.test`, MFA) · Où : fiche du diplôme > « Candidats » · Prérequis : 11.9 et au moins un candidat « Non éligible » (sinon scénario non exécutable : noter "aucun candidat non éligible"). Acte sensible et durable.
1. Sur un candidat « Non éligible » (étudiant B, par exemple TOURE Jean-Marc), cliquer « Octroi forcé » (aria « Octroi forcé du diplôme à TOURE Jean-Marc »). Fenêtre « Octroi forcé à TOURE Jean-Marc » avec l'avertissement « L'étudiant n'est pas éligible selon la règle. Un octroi forcé exige un droit spécifique et un motif écrit d'au moins 20 caractères. », la case « Forcer l'octroi malgré l'éligibilité refusée » (aide « Action sensible, auditée. ») et « Motif de l'octroi forcé » (aide « 20 caractères au moins. »).
2. Saisir « Motif de l'octroi forcé » = `court` puis « Octroyer de force » : « Le motif doit faire au moins 20 caractères. »
3. Saisir « Motif de l'octroi forcé » = `Octroi forcé pour test guide (décision de la direction)` puis « Octroyer de force » → « Diplôme octroyé à TOURE Jean-Marc (DIP-AAAA-NNNNNN). »

Résultat attendu : rubrique « Octrois » : badge « Octroi forcé » (ton d'avertissement) et ligne "Octroi forcé : Octroi forcé pour test guide…" ; la mention reste PENDING si un semestre manque.

4. Ré-octroi : après la révocation de l'étudiant B (11.17), le bouton devient « Ré-octroyer » ; fenêtre « Ré-octroi à TOURE Jean-Marc » avec le champ « Décision écrite du directeur général » (aide « Référence de la décision autorisant ce ré-octroi (20 caractères au moins). ») : `abc` → « La décision doit faire au moins 20 caractères. » ; une décision de 20 caractères ou plus → "Diplôme octroyé…". Le ré-octroi est interdit en automatique et exige le droit de forçage.

- [ ] Cas nominal (octroi forcé tracé)  - [ ] Cas invalide (motif court)  - [ ] Ré-octroi après révocation  - [ ] Droit : Directeur des études sans « Octroi forcé »

#### 11.11 Signataires datés des documents officiels
Compte : Directeur (`directeur@superieur-test.test`, MFA) · Où : menu "Enseignement supérieur" > « Signataires » (`/v2/higher/signatories`, rubrique « Signataires datés ») · Prérequis : le signataire "Directeur Fictif" existe (seed). Pour tester le chevauchement, créer d'abord le signataire "TRAORE Mariam test guide" (qualité "Le Directeur des études") dans `/v2/reportcards/signatories` (voir chapitre 10, scénario 10.2).
1. Lire « Signataires datés des documents officiels » : quatre sections — « Diplôme — signature de gauche », « Diplôme — signature de droite », « Attestation de réussite », « Attestation d'authenticité » — chacune avec « Aucun signataire affecté. »
2. Pour chaque emplacement, cliquer « Affecter un signataire » (fenêtre « Affecter un signataire — … ») et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Signataire | Directeur Fictif — Chef d'établissement | oui |
   | Valide à partir du | 2026-09-01 | oui |
   | Valide jusqu'au | (vide) | non (aide « Facultatif. ») |

   Cliquer « Affecter » : « Le signataire est affecté. » ; ligne "Du 1 septembre 2026 au sans fin" avec le badge « En vigueur ». Répéter pour les quatre emplacements.

Cas invalides (emplacement « Attestation de réussite ») :

| Saisie | Message attendu |
|---|---|
| « Signataire » non choisi | "Choix invalide." |
| « Valide à partir du » vide | "Date attendue au format AAAA-MM-JJ." |
| « Valide jusqu'au » = 2026-08-01 avec « Valide à partir du » = 2026-09-01 | "La fin de validité précède son début." |
| Nouvelle affectation « Valide à partir du » = 2026-10-01 (sans fin) alors qu'une affectation sans fin existe | refus : "Cette période recouvre une autre affectation de l'emplacement." |
| Signataire désactivé (le désactiver dans `/v2/reportcards/signatories`) | le sélecteur ne le propose pas ; serveur : "Ce signataire est désactivé : il ne peut plus être affecté à un emplacement." |

3. Historique : fermer l'affectation actuelle (affecter "Directeur Fictif" avec une date de fin, ou affecter "TRAORE Mariam test guide" à partir d'une date postérieure à la fin de la précédente) : l'ancienne ligne reste listée (jamais de suppression), triée par date de début décroissante, avec « En vigueur » seulement sur celle qui couvre aujourd'hui.

Résultat attendu : quatre emplacements couverts à la date du jour ; l'historique est conservé ; deux périodes d'un même emplacement ne se chevauchent pas.

- [ ] Quatre emplacements affectés  - [ ] Cas invalide  - [ ] Historique conservé  - [ ] Droit refusé pour Directeur des études (`/v2/higher/signatories`)

#### 11.12 Émettre diplôme, duplicata et attestation d'authenticité ; PDF
Compte : Directeur des études (MFA) · Où : fiche du diplôme > « Octrois » · Prérequis : 11.9 (octroi de l'étudiant A) et 11.11.
1. Sur la carte de l'octroi de l'étudiant A, cliquer « Émettre le diplôme ». Message « Document émis : DIP-AAAA-NNNNNN. ». Cliquer à nouveau : "Le document existe déjà : …" (idempotent).
2. Cliquer « Documents émis » (bouton de dépliage de la carte) : une ligne « Diplôme » avec référence et "version 1", badges « Émis », « Scellé » (ou « Non scellé » un court instant), « PDF en préparation » puis « PDF prêt ». Sans signataire affecté à un emplacement requis, l'émission est refusée avec un message du type "Aucun signataire n'est en vigueur pour l'emplacement "DIPLOMA_LEFT" à la date d'émission : l'émission est refusée." (nom technique de l'emplacement : voir "Écarts constatés").
3. Cliquer « Télécharger le PDF » : pendant la préparation, le texte « Le PDF est en préparation (scellement puis mise en page). Cette page se met à jour toute seule. » s'affiche, puis le texte "Le PDF est prêt : cliquez sur Télécharger le PDF." ; recliquer ouvre le PDF dans un nouvel onglet. Contrôler : nom et date de l'étudiant, référence, mention, deux signatures datées, QR code et code de vérification (noter le code : jeu de données pour 11.15). Pas de filigrane de démonstration attendu pour un jeu de la plateforme (à vérifier).
4. Cliquer « Attestation d'authenticité » : « Document émis : AUTH/AAAA/NNN. ».
5. Cliquer « Duplicata » (aria « Émettre un duplicata du diplôme de DIABATE Nadia ») : « Document émis : DIP-AAAA-NNNNNN/D1. » ; dans « Documents émis », le duplicata est "version 2" et l'original passe « Remplacé » (son PDF n'est plus fourni si révoqué).
6. (Échec de PDF) Si un document affiche « PDF en échec » : message « La production du PDF a échoué. Vous pouvez relancer la préparation. » et bouton « Relancer » ; pour un compte sans `higher.document.issue` : « La production du PDF a échoué. Contactez le secrétariat pour la relancer. »

Résultat attendu : documents scellés, numérotés (diplôme `DIP-AAAA-NNNNNN`, authenticité `AUTH/AAAA/NNN`, duplicata suffixé `/D1`) et PDF téléchargeables.

Cas invalides : émission pour un octroi **révoqué** → boutons absents (la carte ne propose les émissions que pour « Obtenu ») ; serveur : "Ce diplôme est révoqué : aucun document ne peut être émis."

- [ ] Diplôme, attestation d'authenticité et duplicata émis  - [ ] PDF téléchargé avec QR et code  - [ ] Cas invalide  - [ ] Droit : Secrétariat peut émettre mais n'a pas accès à la fiche du diplôme

#### 11.13 Documents émis : liste, détail, publication, révocation d'un document
Compte : Secrétariat (`secretariat@superieur-test.test`, MFA) puis Directeur · Où : menu "Enseignement supérieur" > "Documents officiels" (`/v2/higher/documents`, rubrique « Documents émis ») · Prérequis : 11.12.
1. Lire « Documents officiels émis » : filtres « Nature » (« Diplôme », « Attestation de réussite », « Attestation d'authenticité ») et « État » (« Émis », « Remplacé », « Révoqué »), tableau « Documents officiels » (colonnes « Document », « Étudiant », « État », « Émission », « Actions »). Avant 11.12 : « Aucun document. » et « Les documents apparaissent ici après l'octroi d'un diplôme ou l'émission d'une attestation. »
2. Cliquer « Détail » sur une ligne : fenêtre « Détail du document » : « Référence », « Code de vérification », « Empreinte », « Page de vérification » (lien « Ouvrir la page de vérification »), « Contenu figé » (JSON, sans donnée inutile).
3. Compte Secrétariat : bouton « Publier » (aria « Publier le document … ») → « Le document DIP-AAAA-NNNNNN est publié. » ; badge « Publié » à la place de « Non publié ». Publier le diplôme et l'attestation d'authenticité de l'étudiant A (jeu de données pour 11.16). Pas de bouton « Révoquer » pour ce compte.
4. Filtres : « Nature » = « Diplôme » ; « État » = « Révoqué » → « Aucun document. ».
5. **Révocation d'un document** (Directeur, MFA) : sur l'attestation d'authenticité de l'étudiant B ou un duplicata de test, « Révoquer » : fenêtre « Révoquer le document … » (« Sa vérification publique indiquera qu'il est révoqué. Cette action est définitive. ») ; « Motif de la révocation » = `court` → « Le motif doit comporter au moins 10 caractères. » ; `Révocation document test guide` → « Le document … est révoqué. » ; badge « Révoqué » et la mention « Document révoqué : le PDF n'est plus fourni. »

Résultat attendu : seuls les documents publiés sont visibles de l'étudiant et du parent (11.16) ; un document révoqué n'est plus téléchargeable.

- [ ] Liste, filtres, détail  - [ ] Publication par le Secrétariat  - [ ] Cas invalide (motif court)  - [ ] Droit : Secrétariat sans « Révoquer »

#### 11.14 Attestations de réussite
Compte : Directeur des études (MFA) · Où : menu "Enseignement supérieur" > rubrique « Attestations » (`/v2/higher/attestations`) · Prérequis : 11.11 (emplacement « Attestation de réussite » affecté). Voir l'avertissement de la section D.
1. Titre « Attestations de réussite » ; message « Choisissez le programme concerné. » ; encadré « Programme concerné » (aide « Nœud du curriculum du programme visé par l'attestation. ») : choisir Informatique, l'année en cours et le nœud "L1 — Licence 1 A" ; champ facultatif « Classe (facultatif) » (aide « Limite la liste aux inscrits d'une classe. ») = Licence 1 A.
2. Lire le tableau « Étudiants et éligibilité aux attestations » : colonnes « Étudiant », « UE » ("2 / 2"), « Crédits », « État » (« Éligible », « Non éligible », "N UE manquantes", "Acquis le …"). Seuls les étudiants dont **toutes** les UE du programme sont acquises sont éligibles (comparer avec 11.2).
3. Pour un étudiant éligible, « Émettre » (aria « Émettre l'attestation de DIABATE Nadia ») : « Attestation émise pour DIABATE Nadia (ATT-AAAA-NNNNNN). ». Rejouer n'est plus proposé (la ligne affiche la référence) ; côté API un second appel répondrait "L'attestation de DIABATE Nadia existe déjà (…)".
4. Contrôler dans `/v2/higher/documents` : une ligne « Attestation de réussite » ; la publier (11.13) si besoin.

Cas invalide : sans emplacement « Attestation de réussite » affecté, l'émission est refusée (message du type "Aucun signataire n'est en vigueur pour l'emplacement …") ; étudiant non éligible : pas de bouton « Émettre ».

- [ ] Liste d'éligibilité cohérente avec 11.2  - [ ] Attestation émise  - [ ] Cas invalide  - [ ] Droit : Secrétariat refusé (`/v2/higher/attestations`)

#### 11.15 Vérification publique d'un diplôme ou d'une attestation
Compte : aucun (fenêtre de navigation privée) · Où : `/v2/verify` (page décrite au chapitre 10, scénarios 10.6 et 10.7) · Prérequis : code de vérification d'un diplôme (11.12 ou détail en 11.13).
1. Saisir le code dans « Code de vérification » puis « Vérifier » : badge « Authentique », « Document authentique », « Nature du document » = « Diplôme » (ou « Attestation de réussite », « Attestation d'authenticité »), « Établissement » = Université Horizon, « Émis le … ». Aucun nom d'étudiant, aucune note.
2. Document **révoqué** (11.13 ou 11.17) : badge « Révoqué », « Document révoqué », "Ce document a été révoqué le …".
3. Duplicata : le code de l'original donne « Remplacé » (si le résolveur de statut du module le reflète : à vérifier), celui du duplicata « Authentique ».
4. Comparer le PDF de l'étudiant A (« Comparer un fichier PDF ») : « Fichier identique », « Statut du document : Authentique. ».

Résultat attendu : la vérification publique d'un document du supérieur se comporte comme celle d'un bulletin, sans donnée personnelle.

- [ ] Diplôme authentique  - [ ] Document révoqué  - [ ] PDF reconnu

#### 11.16 Mes documents : étudiant et parent
Comptes : Élève (`eleve@superieur-test.test`, DIABATE Nadia) puis Parent (`parent@superieur-test.test`) · Où : `/v2/higher/me/documents` (rubrique « Mes documents ») · Prérequis : 11.13 (documents de l'étudiant A publiés ; étudiant A = DIABATE Nadia).
1. Élève : titre « Mes documents officiels », section « Mes documents » : une carte par document **publié** (nature, référence, "version 1", « Émis le … », badges « Émis », « Scellé », « PDF prêt »), lien « Page de vérification publique », aide « Partagez cette page pour prouver l'authenticité du document : elle ne montre aucune donnée personnelle. », bouton « Télécharger le PDF ».
2. Parent : sections « Documents de DIABATE Nadia » et « Documents de DIABATE Salimata » ; pour Salimata sans document publié : « Aucun document publié. » et « Les documents apparaissent ici dès que l'établissement les publie. ». Aucun autre étudiant.
3. Un document non publié (p. ex. celui de l'étudiant B) n'apparaît ni chez l'élève ni chez le parent.
4. Un document **révoqué** : « Document révoqué : … » et le PDF n'est plus fourni (« Document révoqué : le PDF n'est plus fourni. »).

Cas invalides (adresses à taper à la main) :

| Compte | Adresse | Résultat attendu |
|---|---|---|
| Élève, Parent | `/v2/higher/diplomas`, `/v2/higher/documents`, `/v2/higher/credits` | « Accès refusé » |
| Compte sans fiche étudiant (Propriétaire) | `/v2/higher/me/documents` | page sans erreur technique : message « Vous n'avez pas les droits nécessaires pour cette action. » ou liste vide (constat QA : un 401 avait été observé à la place d'un 403) : à relever |

- [ ] Élève : seuls ses documents publiés  - [ ] Parent : ses deux enfants  - [ ] Cas invalide

#### 11.17 Révoquer un diplôme (acte terminal)
Compte : Directeur (MFA) · Où : fiche du diplôme > « Octrois » · Prérequis : octroi forcé de l'étudiant B (11.10) avec au moins un document émis. **Ne pas révoquer l'octroi de l'étudiant A (DIABATE Nadia) : les chapitres des familles en dépendent.**
1. Sur l'octroi « Obtenu » de l'étudiant B, cliquer « Révoquer » : fenêtre « Révoquer le diplôme de TOURE Jean-Marc » (« La révocation est terminale ; les documents de cet octroi sont révoqués. Un ré-octroi exigera une décision écrite. »).
2. « Motif de la révocation » vide ou `court` → « Le motif doit comporter au moins 10 caractères. » ; `Révocation de test guide (octroi forcé)` → « Le diplôme est révoqué. ».

Résultat attendu : la carte indique "Révoqué par … le … : …" avec le badge « Révoqué » ; ses documents passent « Révoqué » dans `/v2/higher/documents` ; la vérification publique de leur code répond « Révoqué » ; l'étudiant B ne les voit plus ; dans « Candidats » le bouton devient « Ré-octroyer » (11.10). Un second « Révoquer » n'est plus possible (bouton absent ; serveur : "Ce diplôme est déjà révoqué.").

- [ ] Cas nominal  - [ ] Cas invalide (motif court)  - [ ] Documents et vérification « Révoqué »  - [ ] Droit : Directeur des études sans « Révoquer »

---

### E. Droits et qualité

#### 11.18 Récapitulatif des droits (à rejouer avec chaque compte)
1. Directeur des études : peut ouvrir les rubriques « Diplômes », « Attestations », « Documents émis », « Crédits et dettes », « Prérequis », « Rattrapages », « Dispenses d'UE » (lecture) et « UE annuelles » ; **pas** « Signataires datés » ; sur un candidat non éligible : pas d'« Octroi forcé » ; sur une dispense : pas de « Accorder une dispense » ni « Révoquer » ; sur un octroi : pas de « Révoquer ».
2. Secrétariat : barre de rubriques réduite à « Documents émis » et « Dispenses d'UE » ; `/v2/higher` → redirection vers `/v2/higher/diplomas` puis « Accès refusé » (le secrétariat n'a pas `higher.diploma.read`) ; peut « Publier » un document mais pas le révoquer.
3. Directeur et Propriétaire : tout, y compris « Signataires ».
4. Enseignant, Responsable pédagogique, Économe, Éducateur : toutes les adresses du tableau "Droits" → « Accès refusé ».
5. Élève et Parent : seule la rubrique « Mes documents ».
6. Isolation : un document d'un autre établissement n'est jamais visible (le détail répond "introuvable").

- [ ] Directeur des études  - [ ] Secrétariat  - [ ] Direction  - [ ] Rôles sans droit  - [ ] Élève / Parent

#### 11.19 Qualité transversale
1. États vides lisibles (« Aucun diplôme. », « Aucune dispense », « Aucun candidat. », « Aucune fenêtre de rattrapage. », « Aucun document. ») avant création.
2. Chargement : indicateur « Chargement… » puis contenu, jamais une page blanche ; erreur de l'API : bloc d'erreur avec « Réessayer ».
3. Clavier : onglets du diplôme (« Exigences », « Candidats », « Octrois ») parcourus avec Tab et activés au clavier ; fenêtres fermées avec Échap ; tableaux défilant dans leur zone.
4. Mobile 375 px : pas de défilement horizontal de la page.
5. Libellés : repérer les identifiants courts ("UE xxxxxxxx", "cours xxxxxxxx", noms techniques d'emplacement) et les consigner (écarts ci-dessous).

- [ ] États vides  - [ ] Chargement  - [ ] Clavier  - [ ] Mobile

---

## Données créées

| Enregistrement | Détail |
|---|---|
| Diplôme "Licence Informatique test guide" (code `TG-LIC-INFO`, grade `LICENCE`) | intitulé modifié en "(modifié)" ; se désactive (« Inactif »), ne se supprime pas dès qu'un octroi existe |
| Diplôme "Diplôme à supprimer test guide" (`TG-DEL-001`) | supprimé en 11.8 |
| Octroi manuel du diplôme à DIABATE Nadia (étudiant A) | référence `DIP-AAAA-NNNNNN` ; documents : diplôme, attestation d'authenticité, duplicata (/D1), attestation de réussite ; publiés. **À conserver** (portails parent et élève, chapitre 21) |
| Octroi forcé à TOURE Jean-Marc (étudiant B), puis révoqué | motif "Octroi forcé pour test guide…" ; documents révoqués |
| Dispense accordée à COULIBALY Moussa (UE 2) puis révoquée ; seconde dispense avec crédits (si exécutée) | motifs "… test guide" |
| Emplacements de signature (4) affectés à "Directeur Fictif" dès le 2026-09-01 | historique non supprimable |
| Signataire "TRAORE Mariam test guide" (Université Horizon) | créé via le chapitre 10 |
| UE annuelle UE2 déclarée puis retirée | motifs "UE annuelle de test guide", "Retrait test guide" |
| Fenêtre de rattrapage Licence 1 A / Semestre 1 (ouverte puis clôturée) | dates 2026-10-12 à 2026-10-30 |
| Réglages modifiés puis rétablis | durée de validité des crédits (60 mois puis vide), politique de dispense |

## Écarts constatés (lecture du code ; à confirmer en test)

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/higher/diplomas` (« Nouveau diplôme ») et `/v2/higher/attestations` | Le sélecteur « Nœud du curriculum » envoie l'identifiant d'un nœud du curriculum, mais l'API (`createDiplomaFromCurriculum`, `attestations/roster`) résout cet identifiant comme celui d'un **programme** (`getCycleFacts(programId)`) : la création de diplôme doit répondre "Nœud du curriculum introuvable (…)" et la liste d'attestations "Programme introuvable (…)". Les tests automatiques utilisent des API simulées et ne le voient pas. | Bloquant (probable) |
| `/v2/higher/prerequisites` | L'écran envoie l'identifiant du nœud de l'UE alors que l'API attend sa lignée (`lineageId`) : l'enregistrement doit répondre "UE introuvable (…)". Les écrans de dispenses et d'UE annuelles, eux, envoient bien la lignée. | Majeur (probable) |
| `/v2/higher/credits`, `/v2/higher/resit` | Les UE et les cours sont désignés par un identifiant court ("UE xxxxxxxx", "cours xxxxxxxx") au lieu de leur code et intitulé. | Mineur |
| `/v2/higher/diplomas/<identifiant>` (émission) | Le refus faute de signataire cite le nom technique de l'emplacement (`DIPLOMA_LEFT`, `ATTESTATION_SUCCESS`...). | Mineur |
| `/v2/higher/diplomas` (création) | Un montant d'UV non conforme (trois décimales) peut afficher le message anglais du schéma (frenchErrorMap ne traduit pas ce cas). | Mineur (à vérifier) |
| `/v2/higher/credits` | Le registre n'affiche pas le code des UE ni le nom de l'étudiant dans les dettes ; "Mon parcours" et "Parcours de mon enfant" (entrées du manifeste) n'ont pas de page. | Suggestion |
| Numérotation libre (Q-24) | Réglage du motif des références et du compteur "sans trou" : API uniquement (`/api/v1/higher/numbering`), aucun écran. | Suggestion |
| `/v2/higher/me/documents` | Un compte sans fiche étudiant a produit un 401 au lieu d'un 403 (constat QA). | Mineur |
| Offre | Hors pack Supérieur, les pages Diplômes, Documents et Crédits ne portent pas de garde d'offre : elles s'ouvrent puis affichent l'erreur de l'API, contrairement aux Dispenses, UE annuelles, Prérequis et Rattrapages (message de fonction non incluse). | Mineur |

## À vérifier en test

- Identité des étudiants qui valident leurs UE (tableau de 11.2) : conditionne l'éligibilité, les dettes, les candidats au rattrapage.
- Écarts probables de 11.4 et 11.8 (message exact du refus).
- Mention d'un octroi (code, `PENDING` si un semestre du cycle manque).
- Format réel des références (`DIP-AAAA-NNNNNN`, `AUTH/AAAA/NNN`, `ATT-AAAA-NNNNNN`) et de l'année utilisée.
- Statut « Remplacé » de l'original d'un duplicata à la vérification publique.
- Absence de filigrane de démonstration sur les documents du supérieur.
- Saisie des notes de session 2 de bout en bout (chapitres 08 et 09) et effet "remplace" sur la note retenue.
- Effet d'un changement de durée de validité sur les acquisitions existantes.
- Page `/v2/higher/me/documents` pour un compte sans fiche étudiant.

## Non couvert / limites connues

- Numérotation libre par établissement (API seule) ; durée de validité en tâche de fond (`higher.expire-credits`, 03:20) ; expiration réelle des crédits.
- Parcours et crédits côté étudiant et parent (pas d'écran dédié dans `app/v2/higher` ; voir les portails, chapitre 21).
- Émission d'un relevé cumulé de plusieurs semestres (chapitre 10, "Non couvert").
- Saisie des notes de session 2 : circuit décrit aux chapitres 08 et 09.
- `/v2/results/resit` (même écran que `/v2/higher/resit`) : couvert au chapitre 09.
- Capitalisation automatique à la clôture et reclôture avec diplôme octroyé ("revocation_blocked") : se vérifie au chapitre 09 ; ici seuls ses effets (registre, dettes) sont lus.
