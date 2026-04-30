# Guide utilisateur — Espace Propriétaire (Pilotage)

Ce document est le mode d’emploi de l’espace « Propriétaire » dans EcoleDigitale : à quoi il sert, qui y entre, et que faire dans chaque partie de l’écran, sans jargon technique.

> Documentation technique (API, base de données, recette) : `specs/027-compte-proprietaire-owner/quickstart.md`

---

## 1. En deux phrases : qu’est-ce que c’est ?

L’espace Propriétaire est une zone réservée pour le dirigeant ou le propriétaire de l’établissement (ou une personne à qui on a donné ce rôle).

Il sert à voir l’essentiel sur une seule interface : chiffres, tendances, alertes, finances, personnel, formations — et à faire quelques actions de pilotage (valider une paie, marquer une alerte comme traitée, ajuster les rôles des comptes).  
Ce n’est pas l’écran où l’on saisit les notes ou les devoirs au quotidien : c’est un tableau de bord de direction.

---

## 2. Qui peut l’utiliser ?

- Oui : comptes auxquels l’administrateur a donné le rôle Propriétaire (parfois affiché « Owner »).
- Non : enseignants, parents, élèves, etc., sans ce rôle — l’application affichera accès refusé ou une page d’erreur d’autorisation.

Si vous croyez devoir y accéder mais que l’application refuse : contactez l’administrateur de l’établissement.

---

## 3. Comment y accéder ?

1. Ouvrez l’application (l’adresse fournie par votre établissement).
2. Connectez-vous avec votre compte (celui qui a le rôle propriétaire).
3. Allez à l’adresse du pilotage, en général du type :  
   `https://<adresse-de-votre-site>/owner/dashboard`  
   ou utilisez un lien ou menu « Propriétaire » ou « Pilotage » si votre établissement l’a prévu sur la page d’accueil.

Demandez l’adresse exacte à votre administrateur si besoin.

---

## 4. Le menu : à quoi sert chaque entrée ?

| Menu | Rôle pour vous |
|------|----------------|
| Pilotage | Vue d’ensemble : finances simplifiées, effectifs, indicateurs académiques très synthétiques, RH, formations, alertes. |
| Finances | Rentrées d’argent, recouvrement (qui paie, qui est en retard), suivi de la paie enseignants côté validation. |
| Rapport financier | Télécharger un fichier (tableur ou PDF) pour archives ou présentation. |
| Académique | Lecture seule : moyennes, assiduité, réussite — sans modifier les notes ici. |
| RH | Enseignants, heures, cours sans titulaire, validations de paie en attente. |
| Formations | Synthèse des formations professionnelles (si votre établissement les utilise). |
| Alertes | Points d’attention du système ; vous pouvez les marquer comme traités quand c’est réglé. |
| Accès | Rôles des utilisateurs (enseignant, admin, parent, etc.), dans les limites du logiciel. |

---

## 5. Que faire sur chaque page ? (pas à pas)

### Pilotage (tableau de bord)

1. Ouvrez Pilotage.
2. Parcourez les cartes et graphiques (finances, synthèse élèves/classes, personnel, formations).
3. Regardez les alertes : elles indiquent souvent la priorité du moment.

Vous ne modifiez pas les notes ici : vous consultez et repérez quoi traiter ensuite.

---

### Finances

1. Ouvrez Finances.
2. Utilisez les filtres (période, année scolaire, cycle…).
3. Lisez les tableaux (recouvrement, impayés, paie enseignants).
4. Si une ligne affiche une validation à faire et un bouton du type Valider, ne cliquez qu’après accord interne (comptable / RH) : cela engage la validation de paie.

---

### Rapport financier

1. Ouvrez Rapport financier.
2. Choisissez les mêmes critères que pour la vue finances.
3. Téléchargez CSV ou PDF.  
   Si le PDF échoue, notez le message et contactez le support technique.

---

### Académique

1. Ouvrez Académique.
2. Consultez graphiques et tableaux pour repérer les classes ou périodes à surveiller.
3. Pour modifier une note ou un bulletin, passez par les écrans habituels (enseignant, scolarité) — pas par cet espace.

---

### RH

1. Ouvrez RH.
2. Notez effectifs, heures, cours sans enseignant, paies en attente.
3. Enclenchez les actions humaines (recrutement, remplacement) avec votre équipe si nécessaire.

---

### Formations

1. Ouvrez Formations.
2. Parcourez les chiffres (sessions, inscriptions…).
3. Le détail pédagogique se gère en général sur d’autres écrans ; ici c’est une synthèse.

---

### Alertes

1. Ouvrez Alertes.
2. Lisez chaque message.
3. Quand c’est réglé, utilisez Acquitter ou Marquer comme lu pour faire disparaître l’alerte de la liste active.

---

### Accès (rôles)

1. Ouvrez Accès.
2. Choisissez un utilisateur.
3. Cochez ou décochez les rôles autorisés.
4. Enregistrez.

Rappels :

- On ne s’attribue en général pas seul le rôle Propriétaire ici.
- Le système peut refuser une modification si l’établissement n’aurait plus aucun administrateur : lisez le message et corrigez.

Après un changement de rôle, la personne peut devoir se déconnecter et se reconnecter.

---

## 6. Ce que vous faites — et ce que vous ne faites pas

| Ici vous pouvez… | Ici vous ne faites généralement pas… |
|-------------------|--------------------------------------|
| Voir des indicateurs et listes | Saisir des notes ou bulletins |
| Valider une paie (si prévu) | Valider sans contrôle interne |
| Acquitter des alertes | Ignorer tout ce qui est signalé sans raison |
| Modifier les rôles des comptes | Remplacer votre logiciel comptable |

---

## 7. Problèmes courants

| Situation | Action |
|-----------|--------|
| Accès refusé | Votre compte n’a peut‑être pas le rôle Propriétaire → contactez l’admin. |
| Page qui charge sans fin | Rafraîchir ; sinon support avec date, heure, page. |
| Pas de bouton Valider (paie) | La ligne n’est peut‑être pas à votre statut → vérifiez avec l’administration. |

---

## 8. Côté technique (une phrase)

Pour qu’un compte voie cet espace, un administrateur système doit lui donner le rôle propriétaire sur le bon établissement et avoir appliqué les mises à jour prévues ; le détail est dans la doc technique du projet, pas dans ce guide.

---

*Guide utilisateur — espace Propriétaire / Pilotage EcoleDigitale.*
