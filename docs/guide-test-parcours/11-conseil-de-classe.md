[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](10-vie-scolaire.md) · [Suivant →](12-eleves-affectes-etat.md)

# Phase 11 — Conseil de classe et procès-verbal

Cette phase prépare un conseil de classe (planifier, composer, préparer, convoquer), délibère sur la séance de démonstration du Trimestre 2 (propositions, décisions humaines), la clôt, génère le procès-verbal, essaie la signature et le déverrouillage motivé, puis montre à la famille ce qui lui est visible. Le module ne calcule aucune moyenne, aucun passage, aucun redoublement : il fige les résultats lus, recueille des propositions et des décisions **humaines**. Le bandeau « Règles de démonstration — non réglementaires » s'affiche partout.

Précondition : base de démonstration du Collège Le Baobab ; résultats du Trimestre 1 **clôturés** et ceux du Trimestre 2 verrouillés (état de la graine) ; séance « Conseil de classe de la période 2 (démonstration) » (classe 6e A) « En séance », avec cinq participants présents. Si une phase précédente a changé l'état des résultats, relever les écarts. Le worker doit tourner pour le PDF du procès-verbal. Comptes : directeur des études, secrétariat et directeur en fenêtre **A** ; enseignant, parent et élève en fenêtre **B**.

⚠️ **Limites à connaître avant de commencer**
- **Une séance du Trimestre 1 ne peut jamais s'ouvrir** : elle se crée, se compose, se prépare et se convoque, mais l'ouverture est refusée par le module des résultats ("La période est clôturée."). La délibération se fait donc sur la séance de démonstration du Trimestre 2.
- **La signature du procès-verbal est impossible avec les comptes de démonstration** (les fiches « Conseil » du président et du secrétaire ne sont liées à aucun compte). Le procès-verbal reste « Généré » et la séance « Clos » ; l'état « Signé », la publication irréversible et les effets "à la signature" ne sont pas démontrables ici.

## Étape 190 — Lire le calendrier des conseils de classe
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Conseils de classe »** > **« Conseils de classe »** (`/v2/councils`)

Compte : `etudes@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

1. Lire les onglets **« Calendrier des conseils »**, **« Effets des décisions »**, **« Orientation »**, **« Paramètres »** et le tableau « Conseils de classe ».
2. Dans le formulaire « Filtres du calendrier », choisir « Classe » = `6e A`, puis « Statut » = « Clos ».
3. Remettre « Statut » sur tous, lire le bloc **« Synthèse de la classe »**.

✅ Une ligne « Conseil de classe de la période 2 (démonstration) », classe 6e A, période Trimestre 2, statut « En séance », avancement du type « 0 décidé(s) sur 9 · 5 présent(s) sur 5 ». Avec « Clos » : « Aucun conseil » et « Aucune séance ne correspond à ces filtres. ». La synthèse affiche « 0 en attente », « 0 en échec », « 0 à appliquer par un humain ». Le bouton « Planifier un conseil » est visible.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/councils` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 191 — Lire le dossier de la séance de démonstration
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils` > titre de la séance (`/v2/councils/<identifiant>`)

1. Cliquer sur le titre « Conseil de classe de la période 2 (démonstration) ». Lire les sous-onglets **« Dossier de classe »**, **« Délibération »**, **« Procès-verbal »**, **« Historique »**.
2. Lire le cadre **« État de la séance »**, le tableau **« Participants et présence »**, puis **« Ordre du jour par élève »**.
3. Lire les boutons : **« Clore la séance »**, **« Modifier »**, **« Annuler la séance »**, **« Passer en mode séance »**, **« Voir les effets »**.

✅ Bandeau de démonstration visible ; statut « En séance », badge « Quorum atteint », ligne « 5 présent(s) — aucun minimum défini ». Cinq participants dont "PRESIDENT Conseil" (Président) et "SECRETAIRE Conseil" (Secrétaire), « Présent ». L'ordre du jour liste environ 9 élèves (dont ADOU Aïcha), « Faits » « Version 1 », statut « À examiner », « Décisions » 0 ; 1 « Propositions à traiter » pour l'élève n° 1.

☐ OK ☐ KO

---

## Étape 192 — Planifier un conseil du Trimestre 1
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils` > **« Planifier un conseil »**

1. Cliquer sur **« Planifier un conseil »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Type de conseil | `Conseil de classe de période` |
| Année scolaire | l'année courante (présélectionnée) |
| Période | `Trimestre 1` |
| Intitulé (facultatif) | `Conseil de classe T1 test guide` |
| Date prévue | `10/10/2026` (J+2) |
| Heure | `14:00` |
| Lieu | `Salle des professeurs test guide` |

2. Cliquer sur **« Planifier »**, puis sur le lien **« Ouvrir la séance »** du message.

✅ « Séance créée. » ; statut « Planifié », « Aucun participant pour le moment. », « Aucun élève à l'ordre du jour », avertissements "L'ordre du jour n'est pas préparé." et "Aucun président présent : la séance ne peut pas être ouverte."

⚠️ *Test d'erreur* : type « Période » sans période → « Ce type de conseil porte sur une période : choisissez-la. » ; `6e A` + "Conseil de classe de période" + `Trimestre 2` → "Un conseil de ce type existe déjà pour cette classe et cette période."

⚠️ *Écart connu* : l'écran ne prévient pas qu'une séance sur une période clôturée ne pourra jamais s'ouvrir (E-19b-9).

🔒 *Test de droit* : en tant qu'**enseignant**, le bouton « Planifier un conseil » est absent.

☐ OK ☐ KO

---

## Étape 193 — Composer la séance : les participants
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Lire **« Participants proposés »** (les trois enseignants de la classe, d'après leurs affectations).
2. Cliquer sur **« Ajouter TRAORE Kouadio »** : Membre du personnel = TRAORE Kouadio, Rôle = `Président du conseil`, Fonction = `Président`. **« Ajouter »**.
3. Même procédure pour **YAO Fatou** : Rôle = `Secrétaire de séance`, Fonction = `Secrétaire`. Puis **KOUAME Adjoua** : Rôle = `Professeur principal`, Fonction = `Aucune`.
4. Cliquer sur **« Modifier »** (« Modifier la séance »), changer le Lieu en `Salle des professeurs test guide, étage 1`, **« Enregistrer »**.

✅ Chaque ajout affiche « Participant ajouté. » et une ligne « Participants et présence » avec la présence « Convoqué » et « Non convoqué » dans « Convocation ». Étape 4 : « Séance mise à jour. ».

⚠️ *Test d'erreur* : ajouter un participant au rôle « Enseignant de la classe » avec la fonction « Président » → "Ce rôle ne peut pas présider la séance." ; un second « Président » → "Cet enregistrement existe déjà."

⚠️ *Écart connu* : « Participants proposés » affiche le code de rôle brut `TEACHER` ; seuls les enseignants de la classe sont proposés (E-19b-2, E-19b-5).

☐ OK ☐ KO

---

## Étape 194 — Préparer l'ordre du jour et convoquer
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Préparer la séance »**, lire le tableau « Ordre du jour par élève » (colonnes « N° », « Élève », « Statut », « Faits », « Décisions », « Propositions à traiter »).
2. Cliquer de nouveau sur **« Préparer la séance »** (rejeu).
3. Cliquer sur **« Convoquer »**.

✅ Étape 1 : « Préparation terminée : 9 créé(s), 0 reconstruit(s), 0 inchangé(s), 0 ignoré(s). » (9 = élèves actifs de la classe, à relever) ; « Faits » « Version 1 », statut « À examiner » ; un élève sans résultat de période porte « Résultats manquants » *(probablement ADOU Aïcha, à vérifier)*. Étape 2 : « Préparation terminée : 0 créé(s), 0 reconstruit(s), 9 inchangé(s), 0 ignoré(s). » (rejouable sans doublon). Étape 3 : « Convocation envoyée : 3 convoqué(s), 1 notifié(s). » (seul TRAORE Kouadio a un compte de connexion ; les autres donnent un avertissement du type "Aucune remise n'a pu être mise en file pour …"). Aucun message réel.

🔒 *Test de droit* : se connecter en **secrétariat** (`secretariat@secondaire-test.test`, MFA) : « Convoquer » est visible, « Préparer la séance » est absent.

☐ OK ☐ KO

---

## Étape 195 — Ouvrir la séance : les deux refus attendus
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Ouvrir la séance »** sans avoir marqué personne présent (fenêtre « Ouvrir la séance » : « Le quorum est atteint. »), puis **« Ouvrir »**.
2. Fermer. Passer la présence de **TRAORE Kouadio** et de **YAO Fatou** à « Présent » (liste « Présence de … »).
3. Cliquer de nouveau sur **« Ouvrir la séance »**, puis **« Ouvrir »**.

✅ Étape 1 : "Un président présent est nécessaire pour ouvrir la séance." (bandeau « Le président n'est pas présent. »). Étape 3 : les présences sont acceptées mais l'ouverture est refusée par le module des résultats : "La période est clôturée." La séance reste « Planifié ».

⚠️ *Limite connue* : **c'est le comportement attendu pour une séance du Trimestre 1.** Ne pas chercher à contourner (la dérogation de quorum ne contourne pas ce contrôle). Seule la séance du Trimestre 2 s'ouvre et se délibère.

🔒 *Test de droit* : le **secrétariat** n'a pas le bouton « Ouvrir la séance ».

☐ OK ☐ KO

---

## Étape 196 — Annuler la séance du Trimestre 1
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Annuler la séance »**, saisir `Non` puis valider (refus), puis `Annulation test guide : essai terminé` et cliquer sur **« Annuler la séance »**.
2. Revenir au calendrier et filtrer sur « Annulé ».

✅ `Non` est refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Séance annulée. », badge « Annulé », ligne « Motif d'annulation ». Les boutons d'action disparaissent. **Ne pas replanifier** cette séance : elle n'est plus utile.

⚠️ *Écart connu* : les deux boutons nommés « Annuler » de la fenêtre (fermer, confirmer) peuvent prêter à confusion.

☐ OK ☐ KO

---

## Étape 197 — Examiner un élève : faits figés et suggestions
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance de démonstration > nom de **DIABATE Nadia** (`/v2/councils/<identifiant>/eleves/<identifiant-ligne>`)

1. Cliquer sur le nom de **DIABATE Nadia** dans « Ordre du jour par élève ».
2. Lire **« Faits du dossier »** (« Faits figés, version 1, empreinte » et une empreinte abrégée, « État du résultat », « Moyenne », « Rang », « Mention », « Assiduité », « Vie scolaire »), puis **« Suggestions des règles »**.
3. Cliquer sur **« Marquer comme examiné »**, puis sur **« Reconstruire les faits »**.

✅ Si l'élève n'a pas de résultat exploitable (Trimestre 2 verrouillé mais non calculé) : « Aucun résultat exploitable pour cet élève : une décision de passage ou de redoublement exige une justification. » et badge « Résultats manquants » *(à relever)*. Suggestions : « Ces suggestions viennent du jeu de règles : ce ne sont pas des décisions. Seul le conseil décide. » puis des lignes « Suggestion » ou « Aucune suggestion des règles pour cet élève. ». Étape 3 : « Élève marqué comme examiné. » (statut « Examiné » dans l'ordre du jour) puis « Faits reconstruits. » (la version reste "1" si rien n'a changé).

☐ OK ☐ KO

---

## Étape 198 — L'enseignant propose
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu du portail **« Conseils de classe »** > séance de démonstration > **DIABATE Nadia**

1. Dans « Propositions », cliquer sur **« Ajouter une proposition »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | `Appréciation` |
| Texte | `Appréciation test guide : élève sérieuse et régulière` |

   Cliquer sur **« Ajouter »**.
2. Recommencer avec Nature = `Remarque`, texte `Remarque test guide : à encourager en lecture`.
3. Constater qu'il n'a ni « Accepter », ni « Refuser », ni « Retirer », ni bouton « Enregistrer la décision ».

✅ « Proposition ajoutée. » à chaque fois ; badge « Proposition », statut « Proposée », « Proposée par … ». Côté dossier de la séance, l'enseignant ne voit ni « Clore la séance », ni « Modifier », ni « Annuler la séance », ni « Préparer la séance », et le sous-onglet « Procès-verbal » est absent.

⚠️ *Test d'erreur* : Nature « Appréciation » sans texte → « Ce champ est obligatoire. » sous « Texte ».

🔒 *Test de droit* : en tant qu'**enseignant**, taper `/v2/councils/parametres` puis `/v2/councils/effets` → « Accès refusé » (les deux).

☐ OK ☐ KO

---

## Étape 199 — La direction des études tranche les propositions
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 fiche de **DIABATE Nadia** dans la séance de démonstration

1. Sur la remarque, cliquer sur **« Accepter »**.
2. Sur l'appréciation, cliquer sur **« Refuser »**, saisir la note `Refus test guide`, cliquer sur **« Refuser »**.

✅ « Proposition acceptée. » puis « Proposition refusée. » (statut « Refusée », la note est affichée). **Ne pas accepter l'appréciation** : accepter cette nature crée plus tard un effet qui écrit dans les résultats de la classe. Seule la remarque (sans effet) est acceptée.

☐ OK ☐ KO

---

## Étape 200 — Mode séance : enregistrer des décisions humaines
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance de démonstration > **« Passer en mode séance »** (`/v2/councils/<identifiant>/deliberation`)

1. Lire « Mode séance : un élève à la fois. », utiliser « Élève suivant », « Élève précédent » et la liste « Aller à un élève ».
2. Sur **DIABATE Nadia**, dans « Enregistrer une décision », saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de décision | `Avis requis du conseil` |
| Décideur présent | `PRESIDENT Conseil` |
| Mode de décision | `Consensus` |
| Justification | *(vide)* |

   Cliquer sur **« Enregistrer la décision »**.
3. Sur **BAMBA Aya** : Type = `Autre décision`, Décideur = `PRESIDENT Conseil`, Mode = `Vote`, Voix pour `5`, contre `2`, abstentions `1`, Justification `Décision test guide : suivi renforcé demandé par le conseil`. **« Enregistrer la décision »**.

✅ « Décision enregistrée. » ; le panneau « Décisions » liste "Avis requis du conseil" avec les badges « Enregistrée » et « Avis requis » et « Décideur » = PRESIDENT Conseil. Pour Aya : "5 pour, 2 contre, 1 abstention(s)". Dans l'ordre du jour, « Décisions » passe à 1 et le statut à « Décidé ».

⚠️ *Test d'erreur* : « Autre décision » sans justification → « La justification est obligatoire pour cette décision. » ; mode « Vote » sans voix → "Un vote consigne les voix pour, contre et les abstentions."

⚠️ *Écart connu* : la liste propose aussi des types de portée « Année » (passage, redoublement…) que le serveur refuse pour un conseil de période ("Ce type de décision ne s'applique pas à ce type de séance.", E-19b-4). N'enregistrer aucune décision « Exclusion » ni « Réorientation » : elles créent des effets sur le statut ou l'orientation.

☐ OK ☐ KO

---

## Étape 201 — Retirer une décision, verrou du décideur
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance et fiche de **BAMBA Aya**

1. Dans le dossier de la séance, passer la présence de **PRESIDENT Conseil** à « Absent ».
2. Revenir à « Présent ».
3. Sur la fiche de BAMBA Aya, cliquer sur **« Retirer la décision »**, saisir `No` puis valider (refus), puis `Retrait test guide : décision d'essai` et cliquer sur **« Retirer »**.

✅ Étape 1 : refus du serveur "Ce participant est le décideur de décisions enregistrées : retirez-les d'abord." (la présence reste « Présent »). Étape 3 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Décision retirée. » ; la décision reste visible dans l'historique avec le statut « Retirée » et « Motif du retrait ». **Laisser la décision "Avis requis du conseil" de Nadia en place.**

☐ OK ☐ KO

---

## Étape 202 — ⚠️ Clore la séance
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance de démonstration

1. Cliquer sur **« Clore la séance »** (« Après la clôture, les décisions ne sont plus modifiables sans déverrouillage motivé. », « Confirmez-vous la clôture de la séance ? »), puis **« Clore »**.
2. Essayer de saisir une décision sur la fiche d'un élève, puis de changer une présence.

✅ « Séance close. », statut « Clos ». Les boutons « Clore la séance », « Modifier », « Annuler la séance », « Passer en mode séance » disparaissent ; la présence ne se modifie plus ; le formulaire de décision affiche « Les décisions s'enregistrent pendant que la séance est ouverte. ». La clôture n'est pas bloquée par les élèves sans décision (ce type de conseil n'en exige pas). Aucun effet n'apparaît (déclencheur : signature du procès-verbal). Le déverrouillage motivé, plus loin, permet de revenir en arrière.

☐ OK ☐ KO

---

## Étape 203 — Générer le procès-verbal et obtenir le PDF
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance > **« Procès-verbal »** (`/v2/councils/<identifiant>/pv`)

1. Lire « Aucun procès-verbal » et « Générez le procès-verbal une fois les décisions enregistrées. ». Cliquer sur **« Générer le procès-verbal »**.
2. Lire le tableau **« Versions »** et la section « Procès-verbal, version 1 » (« Statut », « Rendu PDF », « Généré le », « Signé le »). Attendre « PDF prêt » (recharger la page si besoin).
3. Cliquer sur **« Préparer le téléchargement »**, puis sur **« Télécharger le PDF »**. Déplier **« Contenu du procès-verbal »**.
4. Cliquer une seconde fois sur **« Générer le procès-verbal »**.

✅ Étape 1 : « Procès-verbal généré (version 1). », statut « Généré ». Rendu : « Rendu en cours » puis « PDF prêt » ; si le worker est éteint : « Rendu en échec » (à relever). Le lien est valable quelques minutes ("Lien valable jusqu'au …"), le PDF porte la mention "Jeu de règles de démonstration, non réglementaire". Le contenu liste « Décisions par élève » (ex. `REQUIRED_OPINION` pour Nadia). Étape 4 : refus du serveur "Un procès-verbal vivant existe déjà pour cette séance : réouvrez la séance (déverrouillage motivé) pour en produire une nouvelle version."

🔒 *Test de droit* : en tant qu'**enseignant**, taper l'adresse du procès-verbal `/v2/councils/<identifiant>/pv` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 204 — Essayer de signer (refus attendu)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/<identifiant>/pv`

1. Lire **« Signatures »** (« Aucune signature pour le moment. ») et « Signataires manquants » : PRESIDENT Conseil et SECRETAIRE Conseil, badge « À signer », bouton « Signature papier ».
2. Cliquer sur **« Signer électroniquement »**. Recommencer avec le directeur des études, puis avec le directeur.
3. Cliquer sur **« Signature papier »** en face de PRESIDENT Conseil, choisir le signataire, « Référence de la pièce numérisée » = `TG-pièce-inexistante`, **« Enregistrer »**.

✅ Étape 2, pour les trois comptes : "Votre compte n'est lié à aucune fiche du personnel : vous ne pouvez pas signer en tant que participant." Étape 3 : "La pièce de la signature papier est introuvable dans le stockage." Aucune signature enregistrée ; le procès-verbal reste « Généré » et la séance « Clos ».

⚠️ *Limite connue* : **la signature ne peut pas être démontrée avec les comptes de démonstration** (E-19b-1, à confirmer par cet essai). L'état « Signé », la publication irréversible et le déclenchement des effets "à la signature" sont donc **hors de ce guide**.

☐ OK ☐ KO

---

## Étape 205 — Déverrouillage motivé : demande, quatre yeux, approbation, réouverture
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/<identifiant>/pv`, section « Déverrouillage motivé » ; puis **directeur** (`directeur@secondaire-test.test`, MFA)

1. Directeur des études : cliquer sur **« Demander le déverrouillage »**, saisir `Trop court` puis valider (refus), puis `Demande test guide : correction d'une décision saisie par erreur` et cliquer sur **« Envoyer la demande »**.
2. Constater que le directeur des études n'a ni « Approuver » ni « Refuser » dans « Demandes de déverrouillage ».
3. Se connecter en **directeur** : dans la ligne au statut « Demandé », cliquer sur **« Approuver »** (note facultative) puis **« Approuver »**.
4. Lire « Un déverrouillage est approuvé : la séance peut être rouverte. », cliquer sur **« Rouvrir la séance »** puis **« Rouvrir »**.
5. Quatre yeux : clore de nouveau la séance, demander un déverrouillage **avec le directeur lui-même** (`Demande test guide : essai du refus de l'auto-approbation`) et cliquer sur **« Approuver »** sur sa propre demande. Puis **« Refuser »** : `No` (refus), puis `Refus test guide : auto-approbation impossible`.

✅ Étape 1 : `Trop court` est refusé avec « Le motif doit comporter au moins 20 caractères. » ; ensuite « Demande de déverrouillage envoyée. », statut « Demandé ». Étape 3 : « Demande approuvée. », statut « Approuvé ». Étape 4 : « Séance rouverte. », statut « En séance », badge « Rouvert 1 fois », procès-verbal précédent « Remplacé ». Étape 5 : "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." ; le refus donne « Demande refusée. » (`No` refusé avec « Le motif doit comporter au moins 5 caractères. »). Une seconde demande ouverte en parallèle : "Une demande de déverrouillage est déjà ouverte pour cette séance."

⚠️ *Écart connu* : le bouton « Rouvrir la séance » reste visible pour le directeur des études, mais l'API le refuse (E-19b-7). Le journal (onglet « Historique ») garde tout le cycle ; sa colonne « Auteur » affiche `user` et non le nom (E-19b-6).

☐ OK ☐ KO

---

## Étape 206 — Régler les effets "à la clôture" et clore de nouveau
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/parametres` puis séance

**Attention : cette variante modifie un réglage d'établissement ; il est remis en l'état à la fin de la phase.**

1. Ouvrir **« Paramètres »**, section « Réglages de l'établissement », **« Modifier »** : « Déclenchement des effets » = **À la clôture de la séance**, **« Enregistrer »**.
2. Dans la séance de démonstration, cliquer sur **« Clore la séance »** puis **« Clore »**.
3. Ouvrir **« Effets des décisions »** (`/v2/councils/effets`).

✅ « Paramètre enregistré. ». Après la clôture, une ligne **« Information des tuteurs »** pour DIABATE Nadia au statut « Appliqué » (ou « En échec » si le port de notification n'est pas prêt : bouton « Relancer », « Relance demandée. ») *(à relever)*. Aucune ligne pour BAMBA Aya (décision retirée) ni pour la remarque acceptée (aucun effet).

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/councils/effets` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 207 — La famille et l'élève voient la décision notifiée
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Menu du portail parent **« Décisions du conseil »** (`/v2/councils/famille`)

1. Choisir l'enfant **DIABATE Nadia**, puis **DIABATE Salimata**.
2. « Se déconnecter », se connecter en **élève** (`eleve@secondaire-test.test`, DIABATE Nadia, sans MFA) et ouvrir **« Décisions du conseil »** (`/v2/councils/moi`).

✅ Nadia : une carte "Avis requis du conseil" avec le badge « Avis requis » et "Conseil de classe de période · Trimestre 2 · `<date>`". **Jamais** la suggestion de la règle, le vote, la justification interne ni la décision d'un autre élève. Salimata : « Aucune décision à afficher ». Élève : titre « Mes décisions du conseil de classe » et même contenu que le parent pour Nadia. (Avant la notification des tuteurs, les deux pages affichaient « Aucune décision à afficher » et « Aucune décision n'est visible pour le moment. ».)

🔒 *Test de droit* : en tant que **parent**, taper `/v2/councils/moi` → « Accès refusé » ; en tant qu'**élève**, taper `/v2/councils/famille` → « Accès refusé ».

☐ OK ☐ KO

---

## Étape 208 — ⚠️ Annuler l'effet et remettre le réglage
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/effets` puis `/v2/councils/parametres`

1. Sur la ligne « Information des tuteurs » de Nadia, cliquer sur **« Annuler l'effet »**, saisir `No` puis valider (refus), puis `Annulation test guide : effet d'essai` et cliquer sur **« Annuler l'effet »**.
2. Dans **« Paramètres »**, remettre « Déclenchement des effets » sur **À la signature du procès-verbal**, **« Enregistrer »**.
3. Rouvrir la séance : **« Demander le déverrouillage »** (motif d'au moins 20 caractères, par exemple `Demande test guide : remise de la séance en état`), approbation par le **directeur**, puis **« Rouvrir la séance »** et **« Rouvrir »**.

✅ `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Effet annulé. », statut « Annulé ». La décision disparaît de la vue du parent *(à relever)*. Sans l'annulation de l'effet, la réouverture est refusée : "Des effets appliqués doivent d'abord être annulés avant la réouverture." État final : séance « En séance », rouverte plusieurs fois, décision de Nadia conservée.

📚 *Pour aller plus loin* : chapitre 19b, scénarios 19.32 (quorum et dérogation), 19.41 (révocation du procès-verbal), 19.43 (historique), 19.45 (effets humains), 19.46 à 19.49 (orientation, paramètres), 19.51 (orientation vue par la famille).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Séance "Conseil de classe T1 test guide" (6e A, Trimestre 1) **annulée**, avec participants TRAORE Kouadio (Président), YAO Fatou (Secrétaire), KOUAME Adjoua (Professeur principal).
- Séance « Conseil de classe de la période 2 (démonstration) » **« En séance »**, rouverte plusieurs fois ; procès-verbal version 1 « Remplacé » ; demandes de déverrouillage approuvées et refusée.
- Propositions sur DIABATE Nadia : "Remarque test guide : à encourager en lecture" (acceptée), "Appréciation test guide : élève sérieuse et régulière" (refusée). Décision "Avis requis du conseil" de Nadia conservée ; décision d'Aya "Décision test guide : suivi renforcé demandé par le conseil" retirée.
- Effet « Information des tuteurs » (Nadia) annulé ; réglage « Déclenchement des effets » remis sur « À la signature du procès-verbal ».
- **Rien de signé**, aucun statut d'élève ni orientation modifié par ce module.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](10-vie-scolaire.md) · [Suivant →](12-eleves-affectes-etat.md)
