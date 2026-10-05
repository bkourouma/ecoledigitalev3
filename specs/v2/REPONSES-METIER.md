# Réponses métier de l'utilisateur (questions de `QUESTIONS-A-VALIDER.md`)

Réponses données via AskUserQuestion à partir du 2026-10-05. Source de vérité avec `DECISIONS-METIER.md`.
**Statut « Écart »** = la réponse diffère de la valeur par défaut déjà implémentée : changement de code à planifier.

| Id | Décision | Statut |
|----|----------|--------|
| O-01 | Inscription confirmée par paiement des frais OU confirmation manuelle (dérogation de la direction) | Écart |
| O-03 | Découpage libre par école + modèles 3 trimestres et 2 semestres | Défaut conservé |
| O-04 | Cumul de financements autorisé sur une même inscription (ex. bourse + État) | Écart — **implémenté** (academic 0710, finance 0508 ; stateassign sans migration) |
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
| Q-P04 | Rang AFFICHÉ par défaut sur le bulletin du primaire (classement « compétition » en cas d'égalité) | Implémenté (2026-10-05) : gabarits `primary-bulletin` / `report-primary` v2, `showRank` actif par défaut, jamais de rang à la maternelle |
| Q-P05 | Mentions automatiques par seuils de moyenne (seuils réglables par l'établissement, non officiels) | Implémenté (2026-10-05) : règle `mention_periode` de `CI-PRIMARY-PLACEHOLDER` v3 (placeholder), gabarits v2 (`showMention`) |
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
| Q-P17 | Appel matin ET après-midi dès la V1 (politique d'appel par demi-journée) | Implémenté (2026-10-05) : migration `attendance` 0905, `dailyCallMode = HALF_DAYS` par cycle, modèle de pack PRIMARY (maternelle inchangée) |
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

## 007 — Admissions

| Id | Décision | Statut |
|----|----------|--------|
| Q-A01 | Pas de frais de dossier avant admission | Défaut conservé |
| Q-A02 | Offre valable 14 jours (réglable) | Défaut conservé |
| Q-A03 | Liste d'attente : DÉCISION MANUELLE de la direction (pas d'ordre automatique par ancienneté) | Écart |
| Q-A04 | Dossiers refusés : pas de purge, anonymisation sur demande motivée | Défaut conservé |
| Q-A05 | Aucun délai de paiement des frais d'inscription, pas d'annulation automatique | Défaut conservé |
| Q-A06 | Aucun contrôle d'âge | Défaut conservé |
| Q-A07 | Test d'entrée/entretien facultatif | Défaut conservé |
| Q-A08 | Acceptation par tout tuteur (lien unique) ; secrétariat avec pièce | Défaut conservé |
| Q-A11 | Transfert entrant : même workflow, inscription marquée transfert | Défaut conservé |
| Q-A12 | Affectés : capacité respectée, dépassement possible avec motif | Défaut conservé |
| Q-A13 | Place libérée : proposition manuelle | Défaut conservé |
| Q-A14 | Pas de remboursement automatique des frais d'inscription | Défaut conservé |
| Q-A15 | Réinscription hors admissions (reconduction annuelle) | Défaut conservé |
| Q-A16 | Fournisseur SMS = Orange (décision antérieure) | Décidé |
| Q-A17 | Commissions d'apporteurs non reprises | Défaut conservé |
| Q-A18 | Motif de refus : libellé neutre du motif codé | Défaut conservé |
| Q-A09, Q-A10 | Texte de consentement et liste de pièces par niveau : à fournir par l'établissement | En attente |

## 012 — Moteur de règles

| Id | Décision | Statut |
|----|----------|--------|
| Q-01 | Supérieur : semestre validé si toutes les UE le sont ; pas de compensation ; passage décidé par une personne | Défaut conservé |
| Q-02 | Rattrapage (session 2) remplace toujours la note de session 1 | Décidé 2026-10-01 |
| Q-04 | Note < 5 éliminatoire, repassable en session 2 | Défaut conservé |
| Q-06 | Calcul exact, arrondi à l'affichage (2 décimales ; notes saisies à 3) | Défaut conservé |
| Q-07 | Seuils testés sur la valeur exacte | Défaut conservé |
| Q-08 | Moyenne des devoirs simple | Défaut conservé |
| Q-09 | Sans examen = pas de note ; sans devoir = contrôle continu 0 | Défaut conservé |
| Q-10 | Absence justifiée ignorée, injustifiée = 0 (paramétrable) | Défaut conservé |
| Q-11 | Deux personnes différentes par défaut ; option « tâches cumulables » tracée | Défaut conservé |
| Q-12 | Correction après clôture avec approbation du directeur ; bulletin réédité | Défaut conservé |
| Q-13 | Bulletin non bloqué par les impayés par défaut (option d'établissement) | Défaut conservé |
| Q-16 | Réforme applicable à partir de la période suivante | Défaut conservé |
| Q-17 | Établissements : paramètres bornés seulement ; formules libres sur validation plateforme | Défaut conservé |
| Q-18 | Ex æquo : même rang, suivant saute (1, 1, 3) | Défaut conservé |
| Q-19 | Distinctions : honneur ≥ 12, encouragements ≥ 15, félicitations ≥ 17 (réglables) | Défaut conservé |
| Q-21 | Aucun signataire par défaut ; pas d'impression sans signataires | Défaut conservé |
| Q-22 | Diplôme révoqué : définitif sauf décision écrite du directeur général | Défaut conservé |
| Q-23 | Moyenne de matière simple (notes ramenées sur 20) | Défaut conservé |
| Q-24 | Numérotation des diplômes/attestations : FORMAT LIBRE par établissement (pas de séquence imposée sans trou) | Écart — **implémenté** (module `higher`, migration 1409) |
| Q-25 | Crédit acquis définitivement | Défaut conservé |
| Q-26 | Prérequis satisfait par UE validée seulement | Défaut conservé |
| Q-27 | Paie : francs entiers, calcul mois par mois | Décidé |
| Q-28 | Pas de retenues légales pour l'instant | Défaut conservé |
| Q-29 | Admin accède à un bulletin en attente de paiement pour la gestion | Défaut conservé |
| Q-30 | Validation de bulletin par propriétaire ET administrateur selon droits | Défaut conservé |
| Q-31 | Vérification publique : « Authentique », nom, nature, date, établissement, mention | Défaut conservé |
| Q-32 | Modèle plateforme + options (logo, couleurs, rubriques, signatures) | Défaut conservé |
| Q-33 | Français uniquement en V1 | Défaut conservé |
| Q-34 | Date de délibération saisie ; relevé définitif après délibération | Défaut conservé |
| Q-35 | Saisie directe des moyennes autorisée (type « moyenne saisie ») | Défaut conservé |
| Q-36 | Heures payables : présences et séances validées au choix | Défaut conservé |
| Q-38 | Barème libre par évaluation ramené sur 20 | Défaut conservé |
| Q-39 | Changement de classe : un bulletin par classe | Défaut conservé |
| Q-40 | Heures validées d'un enseignant désactivé payées | Défaut conservé |
| Q-03, Q-37 | Couverts par O-18 (pas de compensation) et par la contrainte de non-chevauchement des périodes de paie | Défaut conservé |

## 015 — Paiements

| Id | Décision | Statut |
|----|----------|--------|
| Q-PAY-30 | Établissement sans identifiants propres : utiliser les comptes de la PLATEFORME partagés | Écart à risque (fonds de plusieurs écoles sur un même compte : à cadrer — répartition, réconciliation par tenant, responsabilité juridique — avant implémentation) |
| Q-PAY-31 | Gestion des fournisseurs : directeur et propriétaire, pas l'économe (MFA) | Défaut conservé |
| Q-PAY-32 | Remboursement chez le fournisseur : TOUJOURS MANUEL (preuve auditée) | Écart — **implémenté** (`FINANCE_PROVIDER_REFUND_AUTO`, désactivé par défaut) |
| Q-PAY-34 | Frais d'agrégation non modélisés (montant payé = facture) | Défaut conservé |
| Q-PAY-35 | TresorPay : adaptateur livré, contrat à confirmer (désactivé) | Défaut conservé |
| Q-PAY-36 | Secrets des fournisseurs dans l'environnement (trousseau, rotation) | Défaut conservé |
| Q-PAY-37 | Paiement toujours en attente : signalé, reste PENDING | Défaut conservé |
| Q-PAY-38 | Résolution manuelle d'un paiement bloqué : UNE SEULE personne habilitée (pas de second approbateur) | Écart |
| Q-PAY-33, 39, 40, 41 | Questions techniques : défauts conservés | Défaut conservé |

## 016 — Communications

| Id | Décision | Statut |
|----|----------|--------|
| Q-02 | Conversations conservées sans suppression ; anonymisation sur demande | Défaut conservé |
| Q-03 | Élève écrit aux enseignants et à l'établissement | Défaut conservé |
| Q-04 | Contacts d'administration : directeur et secrétariat, 30 max | Défaut conservé |
| Q-05 | Parent peut écrire aussi aux enseignants de l'année précédente | Écart |
| Q-06 | Plafonds de messagerie PLUS LARGES (120 messages/h au lieu de 60) | Écart |
| Q-07 | Aucun filtre de contenu, signalement manuel | Défaut conservé |
| Q-08 | Pièces jointes : types réels PDF/JPEG/PNG/WebP, scanner branchable | Défaut conservé |
| Q-09 | Accusé « vu » non exposé | Défaut conservé |
| Q-11 | Groupe : liste figée à la création, départ possible | Défaut conservé |
| Q-12 | Annonce programmée : audience figée à la programmation | Défaut conservé |
| Q-13 | TOUT enseignant peut écrire à toute famille (pas seulement ses classes) | Écart (élargit la portée ; à examiner côté confidentialité) |
| Q-14 | Supervision : permission sensible, MFA, motif, audit | Défaut conservé |
| Q-18 | Fournisseur SMS = Orange | Décidé |
| Q-19 | Consentement implicite par défaut (explicite possible par canal) | Défaut conservé |
| Q-23 | Heures calmes 20h-07h Abidjan, urgence contourne | Défaut conservé |
| Q-24 | Urgence ne contourne pas la liste de révocation par défaut | Défaut conservé |
| Q-25 | Plafonds par canal : SMS 500, WhatsApp 1500, e-mail 3000, push 10k, in-app 20k par jour | Défaut conservé |
| Q-26 | Relances d'impayés à J+7 / J+21 / J+45 (au lieu de J+3 / J+10 / J+30) | Écart — **implémenté** (règle livrée `dunning.default`) |
| Q-27 | Charge d'enseignement 800 h/an par défaut ; alerte de baisse désactivée | Défaut conservé |
| Q-28 | Pas de rôle RH ; alerte documents expirant au secrétariat | Défaut conservé |
| Q-29 | Journal de consentement conservé tant que l'établissement existe | Défaut conservé |
| Q-01, 10, 15, 16, 17, 20, 21, 22 | Questions techniques ou déjà livrées : défauts conservés | Défaut conservé |

## 018 — Examens

| Id | Décision | Statut |
|----|----------|--------|
| Q-E03 | Numéro de candidat interne sans trou (ex. CEPE2027-00001) + numéro officiel importé | Défaut conservé |
| Q-E04 | Centre d'examen et centre d'accueil, répartition manuelle ou automatique | Défaut conservé |
| Q-E05 | Épreuve facultative non comptée si non notée ; aucune compensation | Défaut conservé |
| Q-E07 | Session de rattrapage prévue au modèle, aucune règle d'accès | Défaut conservé |
| Q-E08 | Taux de réussite = admis ÷ présents, 2 décimales | Défaut conservé |
| Q-E10 | Résultats reçus par import CSV ou saisie manuelle | Défaut conservé |
| Q-E13 | Frais d'examen INTÉGRÉS à l'inscription du candidat (facture générée à l'inscription) | Écart — IMPLÉMENTÉ (examinations 2006 : barème vide par défaut, port finance, remboursement manuel ; limite : le candidat libre sans compte famille attend une facture établie à la main, `finance` ne facturant que des apprenants) |
| Q-E14 | Examens blancs libres, jamais officiels | Défaut conservé |
| Q-E15 | CANDIDAT LIBRE (non élève de l'établissement) géré dès la V1 | Écart — IMPLÉMENTÉ (examinations 2005 : candidat sans dossier élève, profil restreint, anonymisation) |
| Q-E16 | Listes et résultats conservés sans limite | Défaut conservé |
| Q-E17 | Correction d'un résultat transmis : révision approuvée par un autre, motif 10+ caractères | Défaut conservé |
| Q-E18 | Du CEPE vers l'admission en 6e : résultat ET MOYENNE transmis (pas seulement admis/non admis) | Écart — IMPLÉMENTÉ (examinations 2007 + admissions 1904 : événement dédié, moyenne réservée au personnel habilité, lecture tracée) |
| Q-E01, E02, E06, E09, E11, E12 | Dépendent des textes officiels (épreuves, éligibilité, seuil, mentions, formats, modèles) : à fournir | En attente |

## 024 — Documents

| Id | Décision | Statut |
|----|----------|--------|
| Q-02 | Un seul niveau RESTREINT ; catégorie financière via droits de catégorie | Défaut conservé |
| Q-03 | Pièces JAMAIS purgées (aucune rétention légale) | Écart |
| Q-04 | Taille maximale 15 Mio (plafond plateforme 50 Mio) | Défaut conservé |
| Q-05 | Quotas de stockage par plan : 5 Gio / 50 Gio / 250 Gio | Écart |
| Q-06 | Antivirus optionnel ; sans scanner = « non scanné » + avertissement | Défaut conservé |
| Q-10 | Dépôt parent/élève sans validation préalable | Défaut conservé |
| Q-11 | Doublon refusé (409) | Défaut conservé |
| Q-13 | Alerte d'expiration : déposant, propriétaire et gestion | Défaut conservé |
| Q-14 | Recherche DANS LE TEXTE DES PDF dès la V1 (extraction de texte) | Écart (chantier) |
| Q-15 | Partage à toute identité IAM, en un clic | Défaut conservé |
| Q-17 | Changement de catégorie refusé sauf même type | Défaut conservé |
| Q-01, 07, 08, 09, 12, 16 | Questions techniques : défauts conservés | Défaut conservé |

## 031 — Imports

| Id | Décision | Statut |
|----|----------|--------|
| O-01 | Plafond 5 000 lignes ; VALID_ONLY pour les gros fichiers | Défaut conservé |
| O-02 | Import de notes aussi pour les ENSEIGNANTS sur leurs classes | Écart |
| O-03 | Permissions : secrétariat (élèves/tuteurs), directeur d'études (classes), économe (préparation) ; soldes d'ouverture à la direction | Défaut conservé |
| O-05 | Doublons : rejet ou acquittement avec motif, aucune fusion | Défaut conservé |
| O-08 | 5 000 lignes par défaut, 20 000 maximum | Défaut conservé |
| O-10 | Fichier d'origine conservé 30 jours | Défaut conservé |
| O-11 | Accepter AUSSI .xls et .ods (conversion côté serveur — risque de sécurité à étudier) | Écart à risque |
| O-12 | Aucune reprise de données legacy (Imhotep / V1) | Défaut conservé |
| O-13 | AJOUTER l'import des inscriptions maintenant | Écart |
| O-15 | Avoir sans facture de reprise refusé | Défaut conservé |
| O-04, 06, 07, 09, 14 | Questions techniques : défauts conservés | Défaut conservé |

## Textes officiels et décisions d'exploitation

| Sujet | Décision | Statut |
|-------|----------|--------|
| Textes officiels ivoiriens (programmes, MGA, passage, conseils, BEPC, BAC, CEPE, bulletins, états à transmettre) | L'utilisateur les fournira plus tard | En attente : les packs restent en règles de démonstration |
| Secrets exposés | Rotation immédiate puis tous les 90 jours | À exécuter côté serveur par l'utilisateur ; procédure à documenter |
| Serveur Imhotep | Archiver une sauvegarde chiffrée puis supprimer | À exécuter par l'utilisateur après sauvegarde |
| Conformité RGPD / loi 2013-450 | Pas d'avis juridique prévu pour l'instant | Risque accepté : durées de conservation et anonymisation laissées aux établissements |

## Arbitrages d'intégration (L-01 à L-08)

| Id | Décision | Statut |
|----|----------|--------|
| L-01 | Enseignants : lecture de leurs conseils de classe et propositions | Défaut conservé |
| L-02 | Le directeur d'études PUBLIE aussi les résultats d'examen et approuve les dérogations | Écart (modifier les rôles RBAC) |
| L-03 | Secrétariat sans droit sur les examens | Défaut conservé |
| L-04 | Soldes d'ouverture importés par la direction seule, avec MFA | Défaut conservé |
| L-05 | Règles de notification vie scolaire / admissions laissées désactivées | Défaut conservé |
| L-06 | Rapprochement des affectés : frais d'inscription inclus, tolérance de l'établissement | Défaut conservé |
| L-07 | Job d'effets du conseil de classe sous l'identité de l'humain décideur | Défaut conservé |
| L-08 | Couleur « destructive » éclaircie conservée | Défaut conservé |

---

## Écarts à implémenter (réponses différentes des valeurs par défaut déjà codées)

Chaque ligne est une demande de changement ; les lignes « à risque » demandent un cadrage avant code.

| Id | Changement demandé | Risque |
|----|--------------------|--------|
| O-01 | Confirmation d'inscription par paiement OU confirmation manuelle | Faible |
| O-04 | Cumul de financements sur une inscription (ex. bourse + État) | Moyen (facturation, rapprochement des affectés) |
| O-05 | Générateur complet d'emploi du temps | Chantier important |
| O-10 | Calendrier national des jours fériés préchargé | Faible (données à maintenir) |
| O-11 | UE gérée sur deux semestres (supérieur) | Moyen (résultats) |
| O-14 | Dispense d'UE manuelle avec motif | Faible |
| Q-P04 | Rang affiché par défaut au primaire | Faible |
| Q-P05 | Mentions automatiques par seuils réglables (primaire) | Faible (seuils non officiels) |
| Q-P17 | Appel matin et après-midi | Moyen (politique d'appel, bulletins d'assiduité) |
| Q-P18 | Parents voient rangs et compétences immédiatement après saisie | À RISQUE : résultats non validés exposés aux familles |
| Q-A03 | Liste d'attente : décision manuelle (pas d'ordre par ancienneté) | Faible |
| Q-24 | Numérotation des diplômes à format libre | Moyen (perd la garantie « sans trou ni doublon ») |
| Q-PAY-30 | Comptes fournisseurs de la plateforme partagés entre établissements | À RISQUE : fonds de plusieurs écoles sur un même compte |
| Q-PAY-32 | Remboursements toujours manuels | Faible (désactiver l'exécution automatique) |
| Q-PAY-38 | Résolution manuelle d'un paiement bloqué par UNE seule personne | Moyen (perd la séparation des tâches) |
| Q-05 (msg) | Parent peut écrire aux enseignants de l'année précédente | Faible |
| Q-06 (msg) | Plafond de messagerie 120 messages/h | Faible |
| Q-13 (msg) | Tout enseignant peut écrire à toute famille | À RISQUE : confidentialité, portée élargie |
| Q-26 | Relances d'impayés à J+7/J+21/J+45 | Faible |
| Q-E13 | Frais d'examen intégrés à l'inscription du candidat | Moyen |
| Q-E15 | Candidat libre (sans dossier élève) | Chantier (examens) |
| Q-E18 | Du CEPE vers l'admission en 6e : résultat et moyenne | Moyen (données personnelles) |
| Q-03 (doc) | Pièces jamais purgées | Faible (à rapprocher de la loi sur les données) |
| Q-05 (doc) | Quotas de stockage 5/50/250 Gio | Faible |
| Q-14 (doc) | Recherche dans le texte des PDF | Chantier |
| O-02 (imp) | Import de notes par les enseignants pour leurs classes | Faible |
| O-11 (imp) | Import .xls et .ods | À RISQUE : conversion côté serveur, surface d'attaque |
| O-13 (imp) | Import des inscriptions | Chantier |
| L-02 | Directeur d'études publie les résultats d'examen | Moyen (séparation des tâches) |

## État d'implémentation des écarts (2026-10-05)

Fusionnés dans `feat/v2-phase-0` (suite API complète 6778 tests verts) : O-01, O-04, O-10, O-11 (UE sur deux semestres), O-14, Q-P04, Q-P05, Q-P17, Q-A03, Q-24, Q-PAY-32, Q-05 et Q-06 (msg), Q-26, Q-E13, Q-E15, Q-E18, Q-03 et Q-05 (doc), O-02 (imp), O-13 (imp), L-02.

Pas encore faits :
- À cadrer avant code (à risque) : Q-P18, Q-PAY-30, Q-13 (msg), O-11 (imp, .xls/.ods), Q-PAY-38.
- Chantiers non lancés : O-05 (générateur d'emploi du temps complet), Q-14 (recherche dans le texte des PDF).

## Cadrage des écarts à risque (2026-10-05, réponses de l'utilisateur)

- Q-P18 : rangs et compétences visibles des parents après que l'enseignant marque « prêts » (ou après validation), jamais en brouillon.
- Q-PAY-30 : compte fournisseur par école, avec repli sur le compte plateforme ; rapprochement séparé par école.
- Q-13 (msg) : permission explicite accordée par la direction pour écrire à toute famille, chaque envoi journalisé.
- O-11 (imp) : conversion .xls/.ods par un convertisseur isolé (processus séparé, limites de taille et de durée, sans réseau).
- Q-PAY-38 : résolution manuelle d'un paiement bloqué par une seule personne, MFA récente, motif obligatoire, audit renforcé.
- O-05 (générateur d'emploi du temps complet) et Q-14 (recherche dans le texte des PDF) : lancés.
