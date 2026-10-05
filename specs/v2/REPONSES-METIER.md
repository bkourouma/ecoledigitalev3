# Réponses métier de l'utilisateur (questions de `QUESTIONS-A-VALIDER.md`)

Réponses données via AskUserQuestion à partir du 2026-10-05. Source de vérité avec `DECISIONS-METIER.md`.
**Statut « Écart »** = la réponse diffère de la valeur par défaut déjà implémentée : changement de code à planifier.

| Id | Décision | Statut |
|----|----------|--------|
| O-01 | Inscription confirmée par paiement des frais OU confirmation manuelle (dérogation de la direction) | Écart |
| O-03 | Découpage libre par école + modèles 3 trimestres et 2 semestres | Défaut conservé |
| O-04 | Cumul de financements autorisé sur une même inscription (ex. bourse + État) | Écart |
| O-05 | Générateur complet d'emploi du temps dès maintenant | Écart (chantier important) |
| O-06 | Responsable, co-enseignant et remplaçant rémunérés ; surveillant non rémunéré par défaut | Défaut conservé |
| O-07 | Pas de fusion de doublons ; ne pas tenir compte des données d'élèves de la V1 (pas de reprise des élèves legacy) | Défaut conservé + précision |
| O-08 | Pas de champs de santé en V1 | Défaut conservé |
| O-09 | Aucune règle d'absence codée ; chaque école configure | Défaut conservé |
| O-10 | Calendrier national (jours fériés ivoiriens) préchargé par la plateforme | Écart |
| O-11 | Gérer une UE sur deux semestres (supérieur) | Écart |
| O-12 | Notes regroupées avec mention des deux classes lors d'un changement de classe | Défaut conservé |
| O-13 | Numéro d'élève réglable (5 chiffres), numéro national facultatif et unique | Défaut conservé |
| O-15 | Durée de conservation avant anonymisation : paramètre par établissement, sans durée imposée | Défaut conservé |
| O-16 | Élève inscrit dans plusieurs établissements : autorisé | Défaut conservé |
| O-17 | Durée de réservation de place avant paiement réglable par école | Défaut conservé |
| O-18 | 20 crédits/semestre, 48/an, sans compensation entre UE | Défaut conservé |
| O-19 | Enseignant disponible par défaut si aucune déclaration | Défaut conservé |
| O-20 | Justification d'absence : parent, élève majeur, école ; pièce obligatoire pour maladie | Défaut conservé |
| O-21 | Validation « quatre yeux » des heures réglable ; par défaut interdit de valider ce qu'on a saisi | Défaut conservé |
| O-22 | Réinscription à une UE validée autorisée avec avertissement et motif | Défaut conservé |

Décisions antérieures (conversation) : conduite non notée = semestre « en attente » ; notes à 3 décimales sans arrondi intermédiaire ; paie en francs entiers ; fournisseur SMS = Orange ; social-login conservé avec secret obligatoire ; extinction des jetons legacy 90 jours après la bascule ; démarrage refusé en production avec comptes techniques visibles ; brouillons de notes hors-ligne conservés à la déconnexion ; `admission.document.attach` retiré au chargé d'admissions ; préchargement d'une semaine de l'emploi du temps ; mises à jour de dépendances sans changement majeur ; fastify 5 ; cache de session avec révocation immédiate.

## 004 (suite) et 005 — Primaire

| Id | Décision | Statut |
|----|----------|--------|
| O-14 | Dispense d'UE manuelle avec motif (direction), tracée | Écart |
| O-23 | Enseignant : séance ponctuelle de ses classes ; réservation de salle selon permission | Défaut conservé |
| Q-P01 | Primaire noté sur 20, barème modifiable par type d'évaluation | Défaut conservé |
| Q-P02 | 3 trimestres proposés, école libre | Défaut conservé |
| Q-P03 | Poids des périodes égaux 1-1-1, modifiables | Défaut conservé |
| Q-P04 | Rang AFFICHÉ par défaut sur le bulletin du primaire (classement « compétition » en cas d'égalité) | Écart |
| Q-P05 | Mentions automatiques par seuils de moyenne (seuils réglables par l'établissement, non officiels) | Écart |
| Q-P06 | La règle propose, le conseil confirme (écart justifié et tracé) | Défaut conservé |
| Q-P07 | Bilan annuel : résultat d'année, compétences, assiduité, décision | Défaut conservé |
| Q-P08 | Maternelle : sans note, compétences à 4 niveaux, sans rang | Défaut conservé |
| Q-P09 | CEPE et passage en 6e indépendants | Défaut conservé |
| Q-P10 | Pas de classes multigrades en V1 (une classe = un niveau) | Défaut conservé |
| Q-P11 | Archives et bilans conservés sans limite ; dégel exceptionnel par procédure super-admin auditée | Défaut conservé |
| Q-P13 | Instituteur remplacé : l'écrit garde son auteur, nouveau titulaire dès sa date d'effet | Défaut conservé |
| Q-P14 | Conseil des maîtres : aucun quorum bloquant, présence comptée | Défaut conservé |
| Q-P15 | Aucun plafond de redoublements, signalé au conseil | Défaut conservé |
| Q-P16 | Affectés par l'État : non activé au primaire (activable) | Défaut conservé |
| Q-P17 | Appel matin ET après-midi dès la V1 (politique d'appel par demi-journée) | Écart |
| Q-P18 | Rangs et compétences visibles des parents IMMÉDIATEMENT après saisie (risque : avant validation/publication — à cadrer) | Écart à risque |
| Q-P20 | Conduite = matière transversale non comptée dans la moyenne, modifiable par nœud | Défaut conservé |
| Q-P12, Q-P19 | Dépendent des textes officiels (états à transmettre, programmes/coefficients) : à fournir | En attente |

## 006 — Secondaire

| Id | Décision | Statut |
|----|----------|--------|
| Q6-01 | Un conseil par période + bilan annuel ; types réglables | Défaut conservé |
| Q6-02 | Rôles génériques adaptables ; président obligatoire pour ouvrir | Défaut conservé |
| Q6-03 | Aucun quorum imposé ; ouverture sans quorum avec motif | Défaut conservé |
| Q6-04 | Décisions du PRD configurables ; exclusion jamais appliquée automatiquement | Défaut conservé |
| Q6-05 | Consensus par défaut ; vote optionnel consigné | Défaut conservé |
| Q6-06 | Distinctions suggérées par la règle, acceptées ou refusées par une personne | Défaut conservé |
| Q6-07 | Appréciation générale : phrase suggérée + validation humaine | Défaut conservé |
| Q6-08 | PV généré ; signature dans l'app ou scan signé | Défaut conservé |
| Q6-09 | Familles voient les décisions après notification officielle (réglable) | Défaut conservé |
| Q6-10 | Réouverture d'un conseil signé : demande motivée approuvée par une autre personne | Défaut conservé |
| Q6-13 | Changement de série en cours d'année sur décision écrite avec motif | Défaut conservé |
| Q6-15 | Quatre yeux obligatoires pour sanctions et exclusions, réglable par type | Défaut conservé |
| Q6-16 | Aucune durée d'exclusion imposée ; définitive = changement de statut explicite | Défaut conservé |
| Q6-17 | 3 niveaux de confidentialité, lectures confidentielles journalisées | Défaut conservé |
| Q6-18 | Points de conduite : solde affiché, note saisie par une personne, aucun barème livré | Défaut conservé |
| Q6-19 | Absences pendant exclusion : qualification paramétrable, aucune note automatique | Défaut conservé (débloque la consommation par `attendance`) |
| Q6-20 | Convocations : in-app + courrier imprimé ; SMS/WhatsApp quand le fournisseur est choisi | Défaut conservé |
| Q6-21 | Aucun seuil d'absences codé | Défaut conservé |
| Q6-22 | Recours pour les types qui le prévoient | Défaut conservé |
| Q6-23 | « Affecté(e) » = type de financement « affecté par l'État » | Défaut conservé |
| Q6-24 | Rapprochement État/famille : tolérance zéro, réglable | Défaut conservé |
| Q6-25 | Contrôles de l'État : aucun par défaut | Défaut conservé |
| Q6-26 | Échange avec la plateforme de l'État : saisie et import manuels | Défaut conservé |
| Q6-27 | 3e et Terminale = « examen terminal » | Défaut conservé |
| Q6-28 | Conditions de présentation aux examens : textes officiels à fournir | Défaut conservé |
| Q6-30 | Conduite : matière transversale notée par une personne, coefficient réglable | Défaut conservé |
| Q6-31 | Élève voit ce que voit la famille sauf « parents seulement » (réglable) | Défaut conservé |
| Q6-32 | Même outil de conseil pour primaire et secondaire | Défaut conservé |
| Q6-11, Q6-12, Q6-14, Q6-29 | Dépendent des textes officiels (limites de redoublement, séries/options, catalogue de fautes, coefficients) : à fournir | En attente |
