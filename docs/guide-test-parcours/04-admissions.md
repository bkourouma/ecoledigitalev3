[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](03b-personnes-imports-suite.md) · [Suivant →](05-finance.md)

# Phase 4 — Admissions : de la candidature à l'élève inscrit

Cette phase fait vivre une candidature de bout en bout au Collège Le Baobab : campagne `TG-2027` ouverte par le directeur, candidature d'**Awa COULIBALY test guide** instruite par le chargé d'admissions, décision d'admission prise par le directeur seul, réponse publique de la famille, puis paiement des frais d'inscription par l'économe, qui fait passer le dossier à « Inscrit ».

Précondition : base de démonstration fraîche (graine `pnpm dev:v2:seed`) ; la campagne `RENTREE-6E` et ses neuf dossiers existent déjà. Aucun message réel n'est envoyé (les notifications sont seulement mises en file).

---

## Étape 54 — Lire le pipeline de départ
👤 **chargé d'admissions** (`admissions@secondaire-test.test`, sans MFA) · fenêtre **A** · 📂 Menu **« Admissions »** (`/v2/admissions`)

1. Se connecter (clic sur le compte dans le panneau de `/v2/login`, puis **« Se connecter »**), ouvrir le menu **« Admissions »**.
2. Lire le titre **« Pipeline des candidatures »**, la barre d'onglets (**« Pipeline »**, **« Candidatures »**, **« Listes d'attente »**, **« Prospects »**, **« Campagnes »**, **« Rapports »**) et le bouton **« Nouvelle candidature »**.
3. Dans la liste **« Campagne d'admission »**, la campagne `RENTREE-6E` est présélectionnée.

✅ 12 colonnes (une par étape du workflow) : "Brouillon", "Candidature reçue", "En étude", "Pièces manquantes", "Liste d'attente", "Admis", "Inscription en attente de paiement", "Inscrit", "Refusé", "Retiré par la famille", "Offre expirée", "Dossier en double". Les 9 dossiers de la graine sont répartis un par colonne (Aïcha ADOU "Inscrit", Brice ASSI "Inscription en attente de paiement", Chantal DAGO "Admis", Désiré EKRA "En étude"…). Les onglets « Paramètres » et « Workflow » sont absents pour ce rôle.

☐ OK ☐ KO

---

## Étape 55 — Créer la campagne TG-2027
👤 **directeur** (`directeur@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **« Campagnes d'admission »** (`/v2/admissions/campaigns`)

Attendu au départ : une seule campagne, `RENTREE-6E` (pastille « Ouverte », niveau 6E, 13 places).

1. Se déconnecter du chargé, se connecter en directeur (le code MFA du moment est proposé sur la page de connexion).
2. Cliquer **« Nouvelle campagne »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Année scolaire | `2026-2027` (l'année en cours) |
| Workflow publié | "Parcours d'admission standard (v1)" (la seule proposition) |
| Code | `TG-2027` |
| Libellé | `Campagne test guide 2027` |
| Ouverture | `2026-10-08T08:00` |
| Clôture | `2027-03-31T17:00` |

3. Cliquer **« Créer »**.

✅ La campagne apparaît en « Brouillon » avec le texte « Aucune capacité définie. ».

⚠️ *Test d'erreur* : refaire avec Code `TG-2027` → `Ce code de campagne existe déjà dans l'établissement.` ; avec une Clôture au `2026-10-01T08:00` → « La clôture doit suivre l'ouverture. »

☐ OK ☐ KO

---

## Étape 56 — Fixer la capacité (2 places en 6e) et ouvrir la campagne
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/campaigns`

1. Sur la ligne `TG-2027`, cliquer **« Capacités »**.
2. Dans **« Ajouter un niveau »** choisir "6e" puis **« Ajouter »** ; saisir :

| Champ | Valeur |
| :--- | :--- |
| Places | `2` |
| Limite de la liste | `5` |

3. Cliquer **« Enregistrer »**, puis **« Ouvrir »** sur la campagne.

✅ Tableau de capacité : 6E, 2 places, 2 libres, liste d'attente 0 / 5. La pastille de la campagne passe à « Ouverte ».

⚠️ *Test d'erreur* : « Places » = `abc` → « Valeurs invalides pour le niveau 6E. »

⚠️ *Écart connu* : une campagne ouverte plus récente peut devenir la campagne présélectionnée dans les écrans. **Choisir toujours `TG-2027` dans « Campagne d'admission »** pour la suite de la phase.

☐ OK ☐ KO

---

## Étape 57 — Publier le texte de consentement et créer le lien public
👤 **directeur** · fenêtre **A** · 📂 Menu **"Paramètres des admissions"** (`/v2/admissions/settings`)

Attendu au départ : l'alerte « Aucun texte de traitement des données n'est désigné : le formulaire public est fermé. » (le texte `v1` de la graine existe mais n'est pas désigné).

1. Section **« Textes de consentement parental »**, sous **« Publier un nouveau texte »**, saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Traitement des données » |
| Version | `tg1` |
| Texte | `Je consens au traitement des données de ma candidature pour la seule gestion des admissions (texte de test guide).` |
| Désigner comme texte en vigueur | cochée |

2. Cliquer **« Publier »**.
3. Section **« Formulaire public »**, cliquer **« Créer le lien public »**. Noter le `<lien>` des deux champs en lecture seule (**« Lien du formulaire »** : `http://localhost:3000/v2/apply/<lien>`, **« Lien de suivi des familles »** : `.../track`).

✅ « Texte publié. » ; pastille « Texte en vigueur » sur la version `tg1` (affichée `vtg1`, préfixe doublé : défaut mineur) ; l'alerte disparaît. Puis « Lien public créé. » et pastille « Lien actif ».

⚠️ *Test d'erreur* : « Texte » de 10 caractères → "Le texte doit comporter au moins 20 caractères."

⚠️ *Écart connu (Majeur, à confirmer)* : en fenêtre privée sans compte, ouvrir `http://localhost:3000/v2/apply/<lien>` : attendu **"Ce formulaire n'est pas disponible."**, malgré le lien actif et le texte désigné. Aucun écran ne pose le réglage d'ouverture du formulaire public : le dépôt par la famille et le suivi par code ne sont donc pas testables ici. Consigner ce que l'on voit, puis continuer : la candidature d'Awa sera saisie par le personnel, et la réponse à l'offre (plus loin) fonctionne, elle, avec ce lien.

☐ OK ☐ KO

---

## Étape 58 — Exiger une pièce : "Acte de naissance test guide"
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/settings`, section **« Pièces à fournir »**

1. Cliquer **« Ajouter une pièce »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_ACTE_NAISSANCE` |
| Libellé | `Acte de naissance test guide` |
| Niveau concerné | "6e" |
| Prise en charge concernée | « Toutes » |
| Pièce obligatoire | cochée |

2. Cliquer **« Ajouter »**.

✅ « Pièce enregistrée. » ; la ligne porte la pastille « Obligatoire ». Tant que cette pièce n'est pas acceptée, aucun dossier 6e ne peut passer à "Admis" (la pièce est désactivée à la dernière étape de la phase).

⚠️ *Test d'erreur* : Libellé vide → "Libellé obligatoire." ; Code `TG-ACTE` (tiret) → message commençant par "Code en majuscules, chiffres et".

☐ OK ☐ KO

---

## Étape 59 — Enregistrer un prospect et le marquer contacté
👤 **chargé d'admissions** · fenêtre **A** · 📂 Onglet **« Prospects »** (`/v2/admissions/prospects`)

1. Se déconnecter du directeur, se connecter en chargé. Ouvrir **« Prospects »** : « Aucun prospect. »
2. Cliquer **« Nouveau prospect »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Prénoms | `Mariam` |
| Nom | `COULIBALY test guide` |
| Téléphone | `+225 07 48 12 34 56` |
| Adresse e-mail | `mariam.coulibaly.tg@exemple.test` |
| Niveau visé | "6e" |
| Origine | « Recommandation » |
| Notes | `Recommandée par une famille du quartier (test guide)` |

3. Cliquer **« Enregistrer »**, puis **« Marquer contacté »** sur la ligne.

✅ La ligne apparaît avec la pastille « Nouveau », qui devient « Contacté » (le bouton « Marquer contacté » disparaît).

⚠️ *Test d'erreur* : ni téléphone ni e-mail → "Un moyen de contact (téléphone ou e-mail) est obligatoire." ; e-mail `mariam.coulibaly` → "Adresse e-mail invalide."

🔒 *Test de droit* : en tant que chargé, taper `/v2/admissions/settings` puis `/v2/admissions/settings/workflow` → page « Accès refusé » (redirection vers `/unauthorized`). `/v2/admissions/campaigns` reste lisible mais sans boutons « Nouvelle campagne », « Ouvrir », « Capacités ».

☐ OK ☐ KO

---

## Étape 60 — Convertir le prospect en candidature : Awa COULIBALY test guide
👤 **chargé d'admissions** · fenêtre **A** · 📂 `/v2/admissions/prospects`

1. Sur la ligne de Mariam, cliquer **« Convertir »**.
2. Dans la fenêtre « Convertir Mariam COULIBALY test guide en candidature », saisir :

| Champ | Valeur |
| :--- | :--- |
| Campagne d'admission | "Campagne test guide 2027 (TG-2027)" |
| Prénoms de l'enfant | `Awa` |
| Date de naissance de l'enfant | `2014-06-12` |
| Niveau visé | "6e" |
| Lien de parenté du prospect | "Mère" |

3. Cliquer **« Convertir »**.

✅ Le dossier s'ouvre : **Awa COULIBALY test guide**, étape "Brouillon", tuteur Mariam COULIBALY test guide, numéro de la forme `AAAA-NNNNN`. Retour sur « Prospects » : la ligne est « Converti » avec le lien « Ouvrir le dossier » et plus de bouton « Convertir ».

⚠️ *Test d'erreur* : date de naissance vide → « Date attendue au format AAAA-MM-JJ. »

☐ OK ☐ KO

---

## Étape 61 — Compléter le dossier d'Awa (sexe, lieu de naissance)
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa COULIBALY test guide (`/v2/admissions/applications`)

Le sexe est exigé plus tard pour créer l'élève : le renseigner maintenant.

1. Sur le dossier d'Awa, cliquer **« Modifier la candidature »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Sexe | « Féminin » |
| Lieu de naissance | `Abobo` |

3. Cliquer **« Enregistrer »**.

✅ « Candidature mise à jour. » ; sexe et lieu apparaissent dans la section « Informations ». Rouvrir la fenêtre puis **« Enregistrer »** sans rien changer → « Aucune modification à enregistrer. »

⚠️ *Test d'erreur* : vider « Prénoms » → "Libellé obligatoire."

☐ OK ☐ KO

---

## Étape 62 — Consigner le consentement parental et passer à « Candidature reçue »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, sections **« Étape et décisions »** et **« Tuteurs et consentement »**

1. Dans « Étape et décisions », cliquer le bouton nommé d'après l'étape visée : **"Candidature reçue"**.
2. Constater le refus (bandeau d'erreur technique `le consentement parental est requis avant l'étape SUBMITTED`) : le dossier reste en "Brouillon".
3. Dans « Tuteurs et consentement », cliquer **« Consigner un consentement »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Tuteur | `Mariam COULIBALY test guide` |
| Version du texte accepté | `tg1` (présélectionnée) |
| Mode de recueil | « Document papier » |
| Référence de la pièce justificative | `REG-TG-2026-001` |

4. Cliquer **« Enregistrer le consentement »**, puis de nouveau **"Candidature reçue"**.

✅ La section affiche « Consentement valide » et une ligne "Traitement des données · vtg1 · Document papier · `<date>`". Message `Dossier passé à l'étape "Candidature reçue".` ; statut « Déposée ». L'historique ajoute "Brouillon → Candidature reçue".

⚠️ *Test d'erreur* : « Référence de la pièce justificative » = `ab` → « Au moins 3 caractères. »

⚠️ *Écart connu* : l'alerte rouge du point 2 peut rester affichée après le succès du point 4 (Mineur) ; recharger la page.

☐ OK ☐ KO

---

## Étape 63 — Déposer, rejeter, remplacer puis accepter la pièce
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Pièces du dossier »** · Fichiers : `docs/guide-test/jeux-de-donnees/17-piece-*`

Attendu au départ : "Acte de naissance test guide (obligatoire)" avec la pastille « Manquante ».

1. Cliquer **« Déposer »** et choisir `17-piece-acte-naissance-test-guide.pdf` : pastille « À contrôler ». **« Consulter »** ouvre le fichier dans un nouvel onglet.
2. Cliquer **« Rejeter »** : dans « Rejeter la pièce : Acte de naissance test guide », « Motif du rejet » = `Copie illisible (test guide)`, bouton **« Rejeter »** → pastille « Rejetée » et texte `Rejetée : Copie illisible (test guide)`.
3. Cliquer **« Remplacer »** et choisir `17-piece-bulletin-precedent-test-guide.pdf` : pastille « À contrôler », compteur "2 dépôts".
4. Cliquer **« Accepter »**.

✅ Pastille « Acceptée » ; le bandeau `Pièces manquantes : …` du haut du dossier disparaît.

⚠️ *Test d'erreur* (sur un dépôt neuf) : `17-piece-vide-test-guide.pdf` → `Le fichier est vide.` ; `17-piece-faux-pdf-test-guide.pdf` (texte renommé en .pdf) → refus du type de fichier (le type est lu dans les octets, pas dans l'extension). Si l'API répond "service indisponible", le stockage de fichiers n'est pas configuré : le consigner. La décision d'admission exige la pièce acceptée ; pour poursuivre malgré tout, le directeur peut désactiver la pièce (voir la dernière étape de la phase) avant de décider.

☐ OK ☐ KO

---

## Étape 64 — Planifier et renseigner l'entretien
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Tests et entretiens »** (visible si la fonction "tests et entretiens" est incluse)

1. Cliquer **« Planifier »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Entretien » |
| Date et heure | `2026-10-15T10:00` |
| Lieu | `Bureau du directeur (test guide)` |

2. Cliquer **« Planifier »** (dans la fenêtre) ; l'entretien est « Planifié ».
3. Cliquer **« Renseigner »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Déroulement | « Réalisé » |
| Note | `14` |
| Barème | `20` |
| Résultat | « Admis » |
| Observations | `Candidat attentif (test guide)` |

4. Cliquer **« Enregistrer »**.

✅ La ligne affiche « Note : 14 / 20 » et le résultat « Admis » (c'est le résultat de l'entretien, pas la décision d'admission). Aucune convocation n'est envoyée.

⚠️ *Test d'erreur* : « Déroulement » = « Réalisé » sans « Résultat » → `Un entretien terminé porte son résultat (réussi, échoué, sans objet).` ; « Note » `25` pour « Barème » `20` → `La note exige une échelle et ne la dépasse pas.`

☐ OK ☐ KO

---

## Étape 65 — Passer le dossier « En étude »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Cliquer **"En étude"**.

✅ Message `Dossier passé à l'étape "En étude".` ; la pastille de statut passe à « À l'étude » ; l'historique garde la trace. Dans le pipeline (`/v2/admissions`, campagne `TG-2027`), la carte d'Awa est dans la colonne "En étude".

☐ OK ☐ KO

---

## Étape 66 — 🔒 Le chargé d'admissions ne peut pas décider
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Lire les boutons proposés.
2. Dans la section « Données personnelles », chercher « Exporter le dossier » et « Anonymiser ».

✅ Seule une action de traitement est proposée ("Pièces manquantes"). **Aucun** bouton "Admis", "Liste d'attente", "Refusé", "Retiré par la famille" ni "Dossier en double" ; ni « Exporter le dossier » ni « Anonymiser ». Le secrétariat a la même limite : la décision appartient au directeur.

🔒 *Test de droit* : taper dans la barre d'adresse `/v2/admissions/settings` → « Accès refusé » (déjà vu : confirme que les réglages sont réservés au directeur).

☐ OK ☐ KO

---

## Étape 67 — Décider l'admission d'Awa
👤 **directeur** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Se déconnecter du chargé, se connecter en directeur, ouvrir le dossier d'Awa (« Candidatures » > clic sur son nom). Les boutons visibles portent le nom de l'étape visée : "Admis", "Liste d'attente", "Refusé", "Retiré par la famille", "Dossier en double", "Pièces manquantes".
2. Cliquer **"Admis"** : fenêtre « Acceptation » (« Étape visée : Admis. La décision est journalisée avec son motif et ne peut plus être modifiée. »).
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif | "Candidature retenue" |
| Conditions de l'acceptation | `Remise de l'acte de naissance original (test guide)` |

4. Cliquer **« Enregistrer : Acceptation »**.

✅ Message `Décision "Acceptation" enregistrée : dossier à l'étape "Admis".` ; statut « Acceptée » ; places restantes de la campagne : 1. Dans « Historique » > « Décisions formelles » : le motif et « Par `<nom du directeur>` ».

⚠️ *Test d'erreur* (variante, sur un dossier sans pièce acceptée) : l'admission est refusée par `pièces non acceptées : …` ; capacité atteinte en politique stricte : `2 places occupées pour 2 (niveau 6E)`.

⚠️ *Irréversible* : une décision formelle ne se modifie plus.

☐ OK ☐ KO

---

## Étape 68 — Émettre l'offre de place
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Offres de place »**

Attendu au départ : « Aucune offre émise. » et le bouton **« Émettre une offre »**.

1. Se déconnecter du directeur, se connecter en chargé, rouvrir le dossier d'Awa. Cliquer **« Émettre une offre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Conditions | `Remise de l'acte de naissance original (test guide)` |
| Validité en jours | (laisser vide : 14 jours) |

3. Cliquer **« Émettre une offre »**.
4. Dans la fenêtre « Offre émise », cliquer **« Copier »** sur **« Lien de réponse de la famille »** (`http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>`) et **le conserver (LIEN-AWA)** ; cliquer **« Fermer »**.

✅ Le lien "n'est affiché qu'une seule fois" (seule son empreinte est conservée). La section montre l'offre « En attente de réponse », « Échéance : `<date à 14 jours>` » et les boutons « Désigner la classe », « Accepter au nom de la famille », « Retirer l'offre » (ne pas les utiliser). Le dossier reste à l'étape "Admis".

⚠️ *Test d'erreur* : « Validité en jours » = `0` → "La valeur doit être supérieure ou égale à 1." (message de borne) ; le bouton « Émettre une offre » disparaît une fois l'offre en attente.

☐ OK ☐ KO

---

## Étape 69 — La famille répond à l'offre (page publique)
👤 **famille d'Awa, sans compte** · fenêtre **B** (navigation privée) · 📂 LIEN-AWA (`/v2/apply/<lien>/offer#t=<jeton>`)

1. Coller LIEN-AWA dans la barre d'adresse de la fenêtre privée.
2. Lire le titre « Proposition de place à Collège Le Baobab (démonstration) », « Vous pouvez accepter ou décliner cette proposition. », « Niveau », « Classe », « À accepter avant le » et « Conditions ».
3. Cliquer **« Décliner la place »**, puis **« Retour »** dans la confirmation (sans confirmer).
4. Cliquer **« Accepter la place »** ; lire « Confirmez-vous l'acceptation de cette place ? L'établissement vous indiquera les frais d'inscription à régler. » ; cliquer **« Accepter la place »** pour confirmer.

✅ Page « Place acceptée » avec `Merci : votre acceptation est enregistrée. L'établissement vous indiquera les frais d'inscription à régler pour confirmer l'inscription.`

⚠️ *Test d'erreur* : rouvrir LIEN-AWA → « Cette proposition a déjà été acceptée. » (aucun second élève ni seconde facture). Lien tronqué (supprimer `#t=…`) → « Ce lien est incomplet. Utilisez le lien exact reçu de l'établissement. » ; jeton modifié → « Ce lien n'est pas ou plus valide. »

⚠️ *Écart connu* (Mineur à Majeur, à vérifier) : si l'acceptation échoue pour une raison de dossier (classe non désignée, sexe absent, pièces non acceptées), la page affiche quand même "Ce lien n'est pas ou plus valide." Dans ce cas, vérifier dans le dossier que le sexe, la classe et la pièce acceptée sont bien renseignés.

☐ OK ☐ KO

---

## Étape 70 — Constater l'élève créé et la facture d'inscription
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa

1. Recharger le dossier d'Awa.
2. Lire la section « Offres de place » et la section « Inscription ».

✅ Offre « Acceptée » ; étape "Inscription en attente de paiement" ; « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. » Un élève nommé en capitales (`COULIBALY TEST GUIDE Awa`, affichage exact à relever) est créé, inactif, avec une inscription « En attente » et une facture des frais d'inscription de **25 000 F CFA**. Les liens « Dossier de l'élève » et « Fiche d'inscription » apparaissent comme liens seulement si le rôle a le droit de les ouvrir.

☐ OK ☐ KO

---

## Étape 71 — Payer les frais d'inscription (25 000 F CFA)
👤 **économe** (`econome@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **"Encaissements"** > **« Encaisser un paiement »** (`/v2/finance/payments/new`)

1. Se déconnecter du chargé, se connecter en économe.
2. Dans le bloc « Apprenant », chercher et choisir l'élève d'Awa (taper `COULIBALY`) : la zone « Factures ouvertes » liste la facture d'inscription, « Reste dû 25 000 F CFA ».
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant encaissé | `25000` |
| Mode de paiement | « Virement » |
| Référence | `VIR-TG-AWA-001` |
| Nom du payeur | `COULIBALY Mariam test guide` |
| Qui paie ? | « Famille » |

4. Laisser l'imputation « Automatique », cliquer **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.

✅ Écran « Paiement enregistré » : « Le paiement de 25 000 F CFA a été enregistré. », un reçu, « Imputé » 25 000 F CFA, « Reste dû après paiement » 0.

⚠️ *Test d'erreur* : virement sans « Référence » → `La référence du virement est requise.` (aucun paiement créé).

☐ OK ☐ KO

---

## Étape 72 — Constater « Inscrit »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa (attendre quelques secondes, le traitement est en arrière-plan)

1. Se déconnecter de l'économe, se connecter en chargé, recharger le dossier d'Awa.
2. Chercher un bouton qui poserait « Inscrit » à la main.

✅ Étape "Inscrit", statut « Inscrit », « Inscription confirmée le `<date>`. ». Aucun bouton ne permet de poser « Inscrit » manuellement : l'inscription est confirmée par le paiement seul. Dans le pipeline, Awa est dans la colonne "Inscrit" ; dans « Candidatures », le filtre « Statut » = « Inscrit » la montre avec Aïcha ADOU.

⚠️ *Écart connu* : si le dossier reste "Inscription en attente de paiement" au bout d'une minute, le service de tâches de fond (worker) n'est probablement pas démarré : le consigner. Un règlement partiel (par exemple 10 000 F CFA) ne confirme pas l'inscription (*à vérifier*).

☐ OK ☐ KO

---

## Étape 73 — Désactiver la pièce exigée (nettoyage)
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/settings`, section **« Pièces à fournir »**

1. Se déconnecter du chargé, se connecter en directeur.
2. Sur la ligne "Acte de naissance test guide", cliquer **« Désactiver »**.

✅ La pièce est inactive : les prochains dossiers 6e ne sont plus bloqués par elle. (Les éléments créés ne se suppriment pas, ils se désactivent.)

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitre 17, scénarios 17.1 à 17.4 (lecture et filtres), 17.7 (motifs, classes de priorité), 17.10 à 17.11 (autres candidatures, conflit de modification), 17.15 à 17.16 (liste d'attente, refus avec motif), 17.17 (offre retirée), 17.20 à 17.25 (liste d'attente, rapports, workflow, anonymisation, rattachement des pièces au dossier de l'élève, dépassement de capacité), 17.27 (droits), 17.28 et 17.29 (école et université).

**Ce que la phase laisse dans l'application :**
- Campagne `TG-2027` "Campagne test guide 2027", ouverte, 6e : 2 places (1 occupée par Awa), liste d'attente limitée à 5.
- Texte de consentement `tg1` désigné ; lien public actif (formulaire public fermé : écart connu).
- Pièce `TG_ACTE_NAISSANCE` "Acte de naissance test guide" (désactivée).
- Prospect "Mariam COULIBALY test guide" (converti).
- Dossier "Awa COULIBALY test guide" à l'étape "Inscrit" (consentement `REG-TG-2026-001`, pièce acceptée, entretien réalisé 14 / 20, décision d'acceptation, offre acceptée).
- Élève `COULIBALY TEST GUIDE Awa` (6e A) avec sa facture d'inscription de 25 000 F CFA soldée par le virement `VIR-TG-AWA-001`.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](03b-personnes-imports-suite.md) · [Suivant →](05-finance.md)
