[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](09b-regles-resultats-bulletins-suite.md) · [Suivant →](11-conseil-de-classe.md)

# Phase 10 — Vie scolaire : de l'incident à l'information de la famille

Cette phase suit un fait de vie scolaire de bout en bout : l'enseignant signale, l'éducateur propose une mesure, la direction valide (jamais le proposant lui-même pour une exclusion), la famille est notifiée, peut déposer un recours et reçoit une convocation. La machine propose, une personne décide : rien ne change le statut d'un élève sans un acte humain.

Précondition : base de démonstration du Collège Le Baobab (`secondaire-test`), graine de vie scolaire non modifiée (incidents "Bavardage répété…" de DIABATE Salimata et "Retard à la reprise…" de BAMBA Fatou, avertissement de BAMBA Fatou validé, exclusions de TOURE Yao « Proposée » et de DIABATE Salimata « Validée »). Les types, gravités et barèmes sont des **données de démonstration** : aucune sanction officielle n'est livrée. Une note ou une mesure ne se supprime jamais (elle se retire, se rejette, s'annule ou se révoque) : pour repartir de zéro, réinitialiser la base.

## Étape 173 — Lire le tableau de bord de la vie scolaire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Vie scolaire »** > **« Vie scolaire »** (`/v2/schoollife`)

Compte : `directeur@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

Attendu au départ (base intacte) :

| Indicateur | Valeur |
| :--- | :-: |
| Incidents ouverts | 2 |
| Mesures à valider | 1 |
| Exclusions en cours | 0 (1 si le test a lieu un ou deux jours après la graine) |
| Convocations à tenir | 0 |
| Effets en attente d'une décision | 1 |

1. Lire les onglets en haut de page : **« Tableau de bord »**, **« Saisie rapide »**, **« Validations »**, **« Convocations »**, **« Paramètres »**.
2. Lire les listes **« Incidents ouverts »**, **« Mesures proposées »** et **« Convocations à venir »**.
3. Cliquer sur l'indicateur **« Mesures à valider »** (il mène à la page de validation), puis revenir en arrière.

✅ Les cinq indicateurs ci-dessus sont affichés. « Incidents ouverts » liste les deux incidents de la graine au statut « Déclaré » ; « Mesures proposées » liste l'exclusion de TOURE Yao ; « Convocations à venir » affiche « Aucune convocation à venir. ». Si la base n'est pas intacte, noter les valeurs réelles.

☐ OK ☐ KO

---

## Étape 174 — L'enseignant déclare un incident
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu du portail enseignant **« Saisie vie scolaire »** (`/v2/schoollife/saisie`)

Compte : `enseignant@secondaire-test.test` (TRAORE Kouadio, sans MFA).

1. Lire les trois cartes **« Déclarer un incident »**, **« Encourager un élève »**, **« Noter une observation »**. Cliquer sur **« Déclarer un incident »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `COULIBALY Moussa` |
| Type | `Incident en classe (démonstration)` |
| Gravité | `Niveau 1 (démonstration)` |
| Date des faits | `08/10/2026` (J) |
| Heure des faits | `10:15` |
| Description des faits | `Incident test guide : bavardage pendant la composition` |
| Lieu | `Salle 6e A test guide` |
| Rôle de l'élève | `Auteur` |

3. Cliquer sur **« Déclarer l'incident »**.

✅ La fenêtre se ferme, message « Incident enregistré. ». Le déclarant est l'utilisateur connecté (aucun champ ne permet de le choisir). Avec le directeur, le tableau de bord affichera 3 incidents ouverts.

⚠️ *Test d'erreur* : description vide → « Ce champ est obligatoire. » ; description `abc` → "La description doit faire au moins 5 caractères."

🔒 *Test de droit* : en tant que **enseignant**, taper `/v2/schoollife` → « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page.").

☐ OK ☐ KO

---

## Étape 175 — L'éducateur encourage une élève et note une observation
👤 **éducateur** (secondaire-test) · fenêtre **B** (« Se déconnecter » de l'enseignant) · 📂 `/v2/schoollife/saisie`

Compte : `educateur@secondaire-test.test` (sans MFA). Aucune entrée de menu « Saisie rapide » pour ce rôle : passer par l'onglet **« Saisie rapide »** du tableau de bord (`/v2/schoollife`).

1. Cliquer sur **« Encourager un élève »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `DIABATE Nadia` |
| Type | `Encouragement (démonstration)` |
| Texte | `Encouragement test guide : très bonne participation en classe` |
| Date | `08/10/2026` |
| Visibilité | `Visible de l'élève et des parents` |

2. Cliquer sur **« Enregistrer »**.
3. Cliquer sur **« Noter une observation »** : classe `6e A`, élève `COULIBALY Salimata`, type `Observation (démonstration)`, texte `Observation test guide : a besoin d'un suivi en lecture`, date `08/10/2026`, visibilité **Personnel seulement** (valeur par défaut). **« Enregistrer »**.

✅ « Encouragement enregistré. » puis « Observation enregistrée. ». L'encouragement de Nadia sera lu par le parent et l'élève plus loin ; l'observation reste invisible des familles.

⚠️ *Test d'erreur* : texte vide → « Ce champ est obligatoire. » sous « Texte ».

🔒 *Test de droit* : en tant qu'**éducateur**, taper `/v2/schoollife/validations` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 176 — L'éducateur propose une exclusion (il ne la valide pas)
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife/saisie` puis `/v2/schoollife`

1. Déclarer un incident (comme à l'étape *L'enseignant déclare un incident*) pour **TOURE Jean-Marc**, classe `6e A` : type `Incident en classe (démonstration)`, gravité `Niveau 2 (démonstration)`, date `08/10/2026`, description `Incident test guide : propos injurieux envers un camarade`, lieu `Cour de récréation test guide`, rôle `Auteur`. « Incident enregistré. ».
2. Ouvrir `/v2/schoollife`, cliquer sur **« Ouvrir le dossier »** en face de cet incident (fiche de TOURE Jean-Marc).
3. Cliquer sur **« Proposer une mesure »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Type | `Exclusion temporaire (démonstration)` |
| Gravité | `Niveau 2 (démonstration)` |
| Motif | `Exclusion test guide : propos injurieux répétés` |
| Premier jour | `15/10/2026` (J+7) |
| Dernier jour | `16/10/2026` (J+8) |

4. Lire le cadre **« Circuit de ce type »** : « Cette mesure se propose, puis se valide. », « Le validateur doit être une autre personne que vous. », « Elle peut faire l'objet d'un recours. », « La famille est notifiée lors de la notification de la mesure. ». Cliquer sur **« Proposer la mesure »**.

✅ « Mesure enregistrée. ». Dans la chronologie, la mesure est « Proposée » et n'a aucun effet ; aucun bouton « Valider » ni « Rejeter » pour l'éducateur. Le tableau de bord du directeur affichera « Mesures à valider » = 2 (Yao et Jean-Marc).

⚠️ *Test d'erreur* : type d'exclusion sans dates → « Ce type de mesure exige des dates de début et de fin. » ; motif `abc` → "Le motif doit faire au moins 5 caractères."

⚠️ *Écart connu* : l'auteur s'affiche sous son identifiant de connexion (`educateur`) et non sous son nom (E-19a-5).

☐ OK ☐ KO

---

## Étape 177 — L'éducateur propose un avertissement (qui sera rejeté)
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife` > **« Ouvrir le dossier »** de l'incident de COULIBALY Moussa

1. Sur la fiche de **COULIBALY Moussa**, cliquer sur **« Proposer une mesure »**, type `Avertissement (démonstration)`, motif `Avertissement test guide : retards répétés`.
2. Constater que le cadre « Circuit de ce type » ne mentionne pas « Le validateur doit être une autre personne que vous. » et que « Premier jour » / « Dernier jour » n'apparaissent pas (un avertissement n'exige ni dates ni quatre yeux).
3. Cliquer sur **« Proposer la mesure »**.

✅ « Mesure enregistrée. », mesure « Proposée » pour COULIBALY Moussa. Le tableau de bord du directeur affichera maintenant 3 mesures à valider.

☐ OK ☐ KO

---

## Étape 178 — La direction valide une mesure et en rejette une autre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Vie scolaire »** > **« Mesures à valider »** (`/v2/schoollife/validations`)

1. Lire la section **« À valider »** : TOURE Yao (graine), TOURE Jean-Marc et COULIBALY Moussa, avec « Proposée par … le … » ; pour les exclusions, « validation par une autre personne exigée ».
2. Sur la mesure de **TOURE Jean-Marc**, cliquer sur **« Valider »**, saisir la note facultative `Validation test guide` puis **« Valider »**.
3. Sur l'avertissement de **COULIBALY Moussa**, cliquer sur **« Rejeter »**, saisir `Rej` puis valider (refus), puis `Rejet test guide : motif insuffisant` et cliquer sur **« Rejeter »**.

✅ « Mesure validée. » : la mesure de Jean-Marc passe dans « Validées : à notifier ou à exécuter » et un effet « Demande de changement de statut de l'élève » apparaît dans « Effets d'exclusion en attente » au statut « En attente d'une décision humaine ». Pour le rejet : le motif `Rej` est refusé avec « Le motif doit comporter au moins 5 caractères. », puis « Mesure rejetée. » et la mesure disparaît de « À valider ». Proposant (éducateur) et validateur (directeur) sont deux personnes différentes.

🔒 *Test de droit* : en tant que **directeur des études**, taper `/v2/schoollife/validations` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 179 — Quatre yeux : le directeur ne valide pas sa propre proposition
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/saisie` puis fiche, puis `/v2/schoollife/validations`

1. Dans **« Saisie rapide »**, déclarer un incident pour **COULIBALY Salimata** (classe `6e A`) : type `Incident en classe (démonstration)`, description `Incident test guide : refus d'obéir`, rôle `Auteur`. Ouvrir sa fiche par **« Ouvrir le dossier »**.
2. Cliquer sur **« Proposer une mesure »** : type `Exclusion temporaire (démonstration)`, motif `Exclusion test guide : proposition de la direction`, premier jour `28/10/2026` (J+20), dernier jour `29/10/2026` (J+21). **« Proposer la mesure »**.
3. Aller sur **« Mesures à valider »**, cliquer sur **« Valider »** pour cette mesure puis valider.
4. Fermer la fenêtre, puis cliquer sur **« Rejeter »** avec le motif `Rejet test guide : validation impossible par le proposant`.

✅ À l'étape 3, la fenêtre reste ouverte avec l'erreur du serveur : "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." La mesure reste « Proposée ». Le rejet de l'étape 4 est possible : « Mesure rejetée. ». (Pour qu'une telle exclusion soit validée, il faudrait le compte propriétaire `direction.generale@secondaire-test.test`.)

☐ OK ☐ KO

---

## Étape 180 — La famille ne voit rien avant la notification
👤 **parent** (secondaire-test) · fenêtre **B** (« Se déconnecter » de l'éducateur) · 📂 Menu du portail parent **« Vie scolaire »** (`/v2/schoollife/famille`)

Compte : `parent@secondaire-test.test` (DIABATE Séka, sans MFA ; deux enfants : DIABATE Nadia et DIABATE Salimata).

1. Choisir l'enfant **DIABATE Salimata** dans la liste « Enfant ».
2. Choisir ensuite **DIABATE Nadia**.

✅ Pour Salimata (dont l'exclusion de la graine est validée mais non notifiée), la page affiche « Rien à afficher pour le moment. » avec l'aide « Les informations apparaissent ici une fois notifiées par l'établissement. ». Pour Nadia, le chapitre de référence annonce aussi « Rien à afficher pour le moment. » : l'encouragement saisi plus haut n'apparaît qu'après la notification, à l'étape suivante *(à vérifier ; s'il s'affiche déjà, le noter)*. **Jamais** d'incident, de note du personnel ni d'élément confidentiel.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/schoollife/saisie` puis `/v2/schoollife` → « Accès refusé » (les deux).

☐ OK ☐ KO

---

## Étape 181 — La direction notifie la famille
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`

1. Dans « Validées : à notifier ou à exécuter », repérer l'exclusion de **DIABATE Salimata** (graine) et cliquer sur **« Notifier la famille »**.
2. Faire de même pour l'exclusion de **TOURE Jean-Marc**.

✅ « Mesure notifiée. » à chaque fois ; les deux mesures passent dans **« Mesures en vigueur »** (« Notifiées ou exécutées : révocables avec un motif. »). L'envoi aux tuteurs est simulé : aucun message réel n'est émis.

⚠️ *Écart connu* : l'écran n'indique pas « Simulée » ni le statut de remise après l'envoi (E-19a-3).

☐ OK ☐ KO

---

## Étape 182 — La famille voit la décision, jamais l'incident
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »** (`/v2/schoollife/famille`)

1. Rafraîchir la page, choisir l'enfant **DIABATE Salimata**.
2. Choisir ensuite **DIABATE Nadia**.

✅ Salimata : un groupe « Décisions » avec le titre « Exclusion temporaire (démonstration) », le badge « Notifiée », la période « du … au … », le motif de la mesure et le bouton **« Déposer un recours »**. Nadia : sous « Encouragements et observations », "Encouragement test guide : très bonne participation en classe" (titre « Encouragement (démonstration) ») ; l'encouragement de la graine ("Très bonne participation cette semaine.", personnel seulement) n'apparaît pas. La liste « Enfant » ne propose que Nadia et Salimata : la mesure de Jean-Marc est invisible pour ce parent.

☐ OK ☐ KO

---

## Étape 183 — La famille dépose un recours
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »**, enfant DIABATE Salimata

1. Cliquer sur **« Déposer un recours »**.
2. Saisir le motif `Recours` puis valider (refus).
3. Saisir `Recours test guide : la famille conteste la décision` et cliquer sur **« Déposer le recours »**.

✅ Le motif `Recours` (7 caractères) est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Recours déposé. », la ligne affiche « Recours : déposé » et le bouton « Déposer un recours » disparaît.

☐ OK ☐ KO

---

## Étape 184 — La direction tranche le recours
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Recours déposés »

1. Lire « Recours de … » avec le motif (« Maintenir ou annuler la mesure, avec une motivation. »).
2. Cliquer sur **« Maintenir la mesure »**, saisir `Court` puis valider (refus), puis `Décision test guide : la mesure est maintenue` et cliquer sur **« Maintenir »**.

✅ `Court` est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Recours tranché. » et la mesure revient « Exécutée ». Côté parent (rafraîchir la page de Salimata) : « Recours : rejeté ». (Le bouton « Annuler la mesure » aurait révoqué l'exclusion : ne pas l'utiliser ici.)

☐ OK ☐ KO

---

## Étape 185 — L'éducateur convoque les tuteurs
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 Menu **« Vie scolaire »** > **« Convocations »** (`/v2/schoollife/convocations`)

1. Cliquer sur **« Nouvelle convocation »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `DIABATE Salimata` |
| Nature | `Discipline` |
| Motif | `Convocation test guide : entretien sur le comportement` |
| Date de l'entretien | `11/10/2026` (J+3) |
| Heure | `09:00` |
| Lieu | `Bureau vie scolaire test guide` |

2. Cliquer sur **« Créer la convocation »** : « Convocation créée. », badge « Brouillon ».
3. Cliquer sur **« Envoyer »**. Dans la fenêtre « Envoyer la convocation », les canaux « Application » et « E-mail » sont cochés par défaut (« SMS », « WhatsApp » et « Notification push » ne le sont pas). Cliquer sur **« Envoyer »**.

✅ « Convocation envoyée. », badge « Envoyée ». Le message envoyé ne reprend jamais le motif (il se lit dans le portail). Aucun envoi réel.

⚠️ *Test d'erreur* : date de l'entretien vide → « Ce champ est obligatoire. » ; motif `abc` → "Le motif doit faire au moins 5 caractères."

⚠️ *Écart connu* : un envoi avec le seul canal « Application » peut être refusé par le serveur ("Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées).") ; garder les canaux par défaut.

☐ OK ☐ KO

---

## Étape 186 — La famille accuse réception, l'entretien est tenu
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »**, enfant DIABATE Salimata ; puis **éducateur** sur `/v2/schoollife/convocations`

1. Parent : le groupe « Convocations » affiche « Convocation » avec le motif, la date et le lieu, et le bouton **« Accuser réception »**. Cliquer dessus : « Accusé de réception enregistré. ».
2. « Se déconnecter », puis se connecter en **éducateur** (fenêtre **B**) et rouvrir `/v2/schoollife/convocations` : la ligne affiche « accusé de réception le … », badge « Accusée ».
3. Cliquer sur **« Entretien tenu »**, saisir le compte rendu `Compte rendu test guide : entretien tenu`, **« Enregistrer »**.

✅ « Entretien enregistré comme tenu. », badge « Tenue ». Les boutons « Reporter » et « Entretien tenu » n'existent que pour une convocation « Envoyée » ou « Accusée ».

🔒 *Test de droit* : en tant que **parent**, taper `/v2/schoollife/convocations` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 187 — ⚠️ Irréversible : révoquer une mesure notifiée
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Mesures en vigueur »

1. Sur l'exclusion de **TOURE Jean-Marc**, cliquer sur **« Révoquer »**, saisir `Court` puis valider (refus), puis `Révocation test guide : erreur de saisie` et cliquer sur **« Révoquer »**.

✅ `Court` (5 caractères) est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Mesure révoquée. ». L'effet « Demande de changement de statut de l'élève » de cette mesure disparaît de « Effets d'exclusion en attente » (il passe à « Écarté » dans l'historique). Aucun bouton « Révoquer » pour l'éducateur.

⚠️ *Écart connu* : la révocation ne demande pas de confirmation explicite (E-19a-6).

☐ OK ☐ KO

---

## Étape 188 — L'éducateur propose une seconde exclusion pour l'application d'un effet
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife` > **« Ouvrir le dossier »** de TOURE Jean-Marc

1. Si la fiche de Jean-Marc n'est plus atteignable depuis le tableau de bord, déclarer d'abord un nouvel incident à son nom (`Incident test guide : seconde infraction`, type « Incident en classe (démonstration) »).
2. **« Proposer une mesure »** : type `Exclusion temporaire (démonstration)`, motif `Exclusion test guide : seconde proposition`, premier jour `22/10/2026` (J+14), dernier jour `23/10/2026` (J+15). **« Proposer la mesure »**.

✅ « Mesure enregistrée. », mesure « Proposée ».

⚠️ *Écart connu* : la fiche d'un élève n'est atteignable que s'il a un incident ouvert ou une mesure proposée, ou par son adresse (E-19a-9).

☐ OK ☐ KO

---

## Étape 189 — ⚠️ Irréversible : écarter un effet, puis appliquer l'autre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Effets d'exclusion en attente »

**Attention : « Appliquer » modifie le statut d'un élève dans son dossier. Ne jamais le faire sur DIABATE Nadia ni DIABATE Salimata (comptes du parent et de l'élève).**

1. Valider la mesure de la graine de **TOURE Yao** (« À valider » > **« Valider »**). Un effet « Demande de changement de statut de l'élève » apparaît pour lui.
2. Sur l'effet de Yao, cliquer sur **« Écarter »**, saisir `Non` puis valider (refus), puis `Effet écarté test guide : sanction non retenue` et cliquer sur **« Écarter »**.
3. Valider la seconde exclusion de **TOURE Jean-Marc** (étape précédente). Dans « Effets d'exclusion en attente », cliquer sur **« Appliquer »**.
4. Lire « Appliquer le changement de statut » (« Le statut de l'élève sera modifié dans son dossier, sous votre responsabilité. »), choisir « Nouveau statut de l'élève » = **Suspendu**, cliquer sur **« Appliquer »**.

✅ Étape 2 : `Non` refusé avec « Le motif doit comporter au moins 5 caractères. », puis « Effet écarté. » ; le statut de Yao n'a pas changé. Étape 4 : « Statut de l'élève modifié. », l'effet disparaît de la liste ; le dossier de Jean-Marc dans le module des élèves affiche le statut « Suspendu » (il était « Actif » avant : aucune tâche automatique ne le change). La mesure garde son statut « Validée ». Le statut se rétablit par un autre acte humain dans le module des élèves (pas de bouton "Lever" ici).

📚 *Pour aller plus loin* : chapitre 19a, scénarios 19.3, 19.7, 19.12 (annulation, « Marquer exécutée »), 19.18 (élément confidentiel), 19.19 à 19.24 (paramètres, barème de points de conduite, vue élève, droits, qualité).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Incidents "Incident test guide : bavardage pendant la composition" (COULIBALY Moussa), "…propos injurieux envers un camarade" (TOURE Jean-Marc), "…refus d'obéir" (COULIBALY Salimata).
- Encouragement "Encouragement test guide : très bonne participation en classe" (DIABATE Nadia, visible famille et élève) ; observation "Observation test guide : a besoin d'un suivi en lecture" (COULIBALY Salimata, personnel seulement).
- Mesures : exclusion "Exclusion test guide : propos injurieux répétés" (Jean-Marc, notifiée puis révoquée) ; avertissement "Avertissement test guide : retards répétés" (Moussa, rejeté) ; "Exclusion test guide : proposition de la direction" (Salimata COULIBALY, rejetée) ; "Exclusion test guide : seconde proposition" (Jean-Marc, validée, effet appliqué, **statut de l'élève « Suspendu »**) ; exclusion de TOURE Yao validée, effet écarté.
- Graine modifiée : exclusion de DIABATE Salimata notifiée, recours "Recours test guide : la famille conteste la décision" tranché "maintenu" (Exécutée).
- Convocation "Convocation test guide : entretien sur le comportement" (DIABATE Salimata, « Tenue »).

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](09b-regles-resultats-bulletins-suite.md) · [Suivant →](11-conseil-de-classe.md)
