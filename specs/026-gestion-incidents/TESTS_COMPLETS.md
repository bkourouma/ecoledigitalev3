# Scénarios de Test Complets - 026 Gestion des Incidents RSO-PFSO

**Date de création**: 2025-01-27  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module de gestion des incidents RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Agent de Sûreté enregistre rapidement un incident](#user-story-1---agent-de-sûreté-enregistre-rapidement-un-incident)
3. [User Story 2 - RSO prend en charge et traite un incident](#user-story-2---rso-prend-en-charge-et-traite-un-incident)
4. [User Story 3 - Responsable assigné traite un incident](#user-story-3---responsable-assigné-traite-un-incident)
5. [User Story 4 - Administrateur consulte le dashboard des incidents](#user-story-4---administrateur-consulte-le-dashboard-des-incidents)
6. [User Story 5 - Utilisateur consulte et recherche des incidents](#user-story-5---utilisateur-consulte-et-recherche-des-incidents)
7. [User Story 6 - Système génère un rapport PDF d'incident](#user-story-6---système-génère-un-rapport-pdf-dincident)
8. [User Story 7 - Système envoie des notifications automatiques](#user-story-7---système-envoie-des-notifications-automatiques)
9. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Incidents de Test

#### Incident 1 - Intrusion Critique
- **Code**: `INC-2024-PAD_COM-001`
- **Type**: `intrusion`
- **Catégorie**: `critique`
- **Niveau urgence**: `critique`
- **Installation**: Port de commerce (ID: 1)
- **Zone**: "Zone de chargement terminal 3"
- **Date incident**: 2024-03-15 14:30:00
- **Description courte**: "Intrusion non autorisée dans la zone de chargement"
- **Description détaillée**: "Un individu non autorisé a été détecté dans la zone de chargement du terminal 3. L'individu a tenté d'accéder à un conteneur verrouillé. Intervention immédiate de l'équipe de sûreté."
- **Statut**: `nouveau`
- **Priorité**: `P1`

#### Incident 2 - Vol Modéré
- **Code**: `INC-2024-PAD_ABT-002`
- **Type**: `vol`
- **Catégorie**: `modere`
- **Niveau urgence**: `moyen`
- **Installation**: Abidjan Terminal (ID: 2)
- **Zone**: "Parking personnel"
- **Date incident**: 2024-04-20 08:15:00
- **Description courte**: "Vol d'équipement dans le parking"
- **Description détaillée**: "Vol d'un équipement de sécurité dans le parking du personnel. L'équipement a été signalé manquant lors de l'inventaire du matin."
- **Statut**: `en_investigation`
- **Priorité**: `P3`

#### Incident 3 - Vandalisme Mineur
- **Code**: `INC-2024-PAD_COM-003`
- **Type**: `vandalisme`
- **Catégorie**: `mineur`
- **Niveau urgence**: `bas`
- **Installation**: Port de commerce (ID: 1)
- **Zone**: "Bâtiment administratif"
- **Date incident**: 2024-05-10 19:45:00
- **Description courte**: "Graffitis sur le mur extérieur"
- **Description détaillée**: "Graffitis découverts sur le mur extérieur du bâtiment administratif. Dégâts esthétiques uniquement."
- **Statut**: `resolu`
- **Priorité**: `P4`

### Fichiers de Preuve de Test

#### Images
- **photo_intrusion_1.jpg** - 2.5 MB, 1920x1080px
- **photo_intrusion_2.jpg** - 1.8 MB, 1600x1200px
- **photo_vol_1.jpg** - 3.2 MB, 2048x1536px

#### Vidéos
- **video_intrusion.mp4** - 45 MB, 1920x1080, durée 2min30s
- **video_surveillance.mp4** - 85 MB, 1280x720, durée 5min

#### Documents
- **rapport_initial.pdf** - 5 MB
- **declaration_temoin.pdf** - 2 MB

### Utilisateurs de Test

- **Agent de Sûreté**: 
  - Email: `agent@aspci.ci`
  - Mot de passe: `Password123!`
  - Installation: Port de commerce
  - Rôle: `agent_surete`

- **RSO (Responsable Sûreté Organisation)**: 
  - Email: `rso@aspci.ci`
  - Mot de passe: `Password123!`
  - Installation: Port de commerce
  - Rôle: `rso_formateur` ou `admin`

- **Responsable Assigné**: 
  - Email: `responsable@aspci.ci`
  - Mot de passe: `Password123!`
  - Rôle: `agent_pfso`

- **Administrateur**: 
  - Email: `admin@aspci.ci`
  - Mot de passe: `Password123!`
  - Rôle: `admin`

### Installations de Test

- **Port de commerce** - Code: `PAD_COM` - ID: 1
- **Abidjan Terminal** - Code: `PAD_ABT` - ID: 2

---

## User Story 1 - Agent de Sûreté enregistre rapidement un incident

**Menu**: RSO → Incidents → Nouvel Incident  
**URL**: `/rso/incidents/nouveau`

### Test 1.1 - Création d'Incident Basique

**Objectif**: Vérifier qu'un agent peut créer un incident avec les informations essentielles.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir une installation assignée

**Étapes**:
1. Accéder à "RSO → Incidents → Nouvel Incident"
2. Observer que le formulaire est pré-rempli:
   - Installation: Installation de l'agent (pré-remplie)
   - Date/heure: Date et heure actuelles (pré-remplies)
3. Remplir les champs obligatoires:
   - Type: "Intrusion"
   - Zone: "Zone de chargement terminal 3"
   - Description courte: "Intrusion non autorisée dans la zone de chargement"
   - Niveau urgence: "Critique"
4. Cliquer sur "Enregistrer"

**Résultats Attendus**:
- ✅ L'incident est créé avec succès
- ✅ Un code unique est généré (format: `INC-2024-PAD_COM-001`)
- ✅ Le statut est "nouveau"
- ✅ La date de création est enregistrée
- ✅ L'agent est enregistré comme déclarant
- ✅ Une notification est envoyée au RSO de l'installation
- ✅ Redirection vers la page de détails de l'incident

**Données à Vérifier**:
- Code incident: Format `INC-YYYY-CODE_INSTALLATION-XXX`
- Statut: `nouveau`
- Déclarant: ID de l'agent connecté
- Installation: Installation de l'agent

---

### Test 1.2 - Création d'Incident avec Upload de Preuves

**Objectif**: Vérifier qu'on peut uploader des preuves lors de la création.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir des fichiers de preuve (images, vidéos)

**Étapes**:
1. Accéder à "RSO → Incidents → Nouvel Incident"
2. Remplir les champs obligatoires
3. Dans la section "Preuves", cliquer sur "Ajouter des fichiers"
4. Sélectionner 2 images:
   - `photo_intrusion_1.jpg` (2.5 MB)
   - `photo_intrusion_2.jpg` (1.8 MB)
5. Observer les barres de progression
6. Cliquer sur "Enregistrer"

**Résultats Attendus**:
- ✅ Les fichiers sont validés (format, taille)
- ✅ Les fichiers sont uploadés avec succès
- ✅ Des vignettes sont générées pour les images
- ✅ Les fichiers sont associés à l'incident
- ✅ Les métadonnées sont enregistrées dans `rso_incidents_medias`
- ✅ Les fichiers sont stockés dans MinIO/S3

---

### Test 1.3 - Upload de Vidéo comme Preuve

**Objectif**: Vérifier qu'on peut uploader une vidéo comme preuve.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir une vidéo de test

**Étapes**:
1. Créer un nouvel incident
2. Uploader une vidéo: `video_intrusion.mp4` (45 MB)
3. Observer le traitement

**Résultats Attendus**:
- ✅ La vidéo est validée (format MP4, taille < 100 MB)
- ✅ La vidéo est uploadée avec succès
- ✅ Une vignette est générée pour la vidéo
- ✅ Les métadonnées (durée, dimensions) sont extraites
- ✅ La vidéo est associée à l'incident

---

### Test 1.4 - Notification Email pour Incident Critique

**Objectif**: Vérifier qu'un email est envoyé pour les incidents critiques.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir un RSO configuré pour l'installation

**Étapes**:
1. Créer un nouvel incident avec niveau urgence "Critique"
2. Enregistrer l'incident
3. Vérifier la boîte mail du RSO

**Résultats Attendus**:
- ✅ Une notification dans l'application est créée pour le RSO
- ✅ Un email est envoyé au RSO
- ✅ L'email contient:
  - Code de l'incident
  - Type et urgence
  - Description courte
  - Lien direct vers l'incident
- ✅ L'email est marqué comme urgent

---

### Test 1.5 - Sauvegarde en Brouillon

**Objectif**: Vérifier qu'on peut sauvegarder un incident en brouillon.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté

**Étapes**:
1. Accéder à "RSO → Incidents → Nouvel Incident"
2. Remplir partiellement le formulaire (sans tous les champs obligatoires)
3. Cliquer sur "Enregistrer en brouillon"
4. Vérifier que l'incident est sauvegardé
5. Retourner plus tard et compléter l'incident

**Résultats Attendus**:
- ✅ L'incident est sauvegardé avec le statut "brouillon"
- ✅ L'incident peut être complété plus tard
- ✅ Aucune notification n'est envoyée pour un brouillon
- ✅ L'incident apparaît dans la liste avec le statut "brouillon"

---

### Test 1.6 - Validation des Champs Obligatoires

**Objectif**: Vérifier que la validation des champs obligatoires fonctionne.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté

**Étapes**:
1. Accéder à "RSO → Incidents → Nouvel Incident"
2. Tenter d'enregistrer sans remplir les champs obligatoires
3. Observer les messages d'erreur

**Résultats Attendus**:
- ✅ Les champs obligatoires sont validés
- ✅ Des messages d'erreur clairs sont affichés:
  - Type: "Le type d'incident est requis"
  - Zone: "La zone est requise"
  - Description courte: "La description courte est requise (minimum 20 caractères)"
  - Niveau urgence: "Le niveau d'urgence est requis"
- ✅ L'enregistrement est bloqué jusqu'à ce que tous les champs soient remplis

---

### Test 1.7 - Validation de la Taille des Fichiers

**Objectif**: Vérifier que les fichiers trop volumineux sont rejetés.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir un fichier > 100 MB (ou simuler)

**Étapes**:
1. Créer un nouvel incident
2. Tenter d'uploader un fichier de 120 MB
3. Observer le message d'erreur

**Résultats Attendus**:
- ✅ Le fichier est rejeté avant l'upload
- ✅ Message d'erreur: "La taille maximale autorisée est de 100 MB"
- ✅ Aucun transfert n'est effectué

---

### Test 1.8 - Validation des Formats de Fichiers

**Objectif**: Vérifier que seuls les formats autorisés sont acceptés.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir des fichiers avec formats non autorisés

**Étapes**:
1. Créer un nouvel incident
2. Tenter d'uploader un fichier .exe
3. Tenter d'uploader un fichier .php
4. Observer les messages d'erreur

**Résultats Attendus**:
- ✅ Les formats non autorisés sont rejetés
- ✅ Message d'erreur: "Format de fichier non autorisé. Formats acceptés: JPG, PNG, MP4, PDF"
- ✅ Seuls les formats JPG, PNG, MP4, PDF sont acceptés

---

### Test 1.9 - Formulaire Optimisé Mobile

**Objectif**: Vérifier que le formulaire est optimisé pour mobile.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Accéder depuis un appareil mobile ou simuler un mobile

**Étapes**:
1. Accéder à "RSO → Incidents → Nouvel Incident" depuis mobile
2. Observer la mise en page
3. Remplir le formulaire
4. Uploader une photo depuis l'appareil photo

**Résultats Attendus**:
- ✅ Le formulaire est responsive et adapté au mobile
- ✅ Les champs sont facilement accessibles
- ✅ L'upload depuis l'appareil photo fonctionne
- ✅ Le formulaire est utilisable sur petit écran

---

### Test 1.10 - Complétion d'Informations Détaillées

**Objectif**: Vérifier qu'on peut compléter les informations détaillées après création.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir créé un incident

**Étapes**:
1. Créer un incident basique
2. Accéder à la page de détails de l'incident
3. Cliquer sur "Compléter les informations"
4. Remplir:
   - Description détaillée
   - Circonstances
   - Témoins (nom, fonction, téléphone)
   - Impact matériel
   - Coût estimé
5. Sauvegarder

**Résultats Attendus**:
- ✅ Les informations détaillées peuvent être ajoutées
- ✅ Les témoins sont enregistrés en JSON
- ✅ L'impact est enregistré
- ✅ Le coût estimé est enregistré
- ✅ L'historique est mis à jour

---

## User Story 2 - RSO prend en charge et traite un incident

**Menu**: RSO → Incidents → [Sélectionner un incident]  
**URL**: `/rso/incidents/[id]`

### Test 2.1 - Réception de Notification pour Nouvel Incident

**Objectif**: Vérifier qu'un RSO reçoit une notification pour un nouvel incident.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident créé dans son installation

**Étapes**:
1. Se connecter en tant que RSO
2. Observer le widget de notifications dans le header
3. Vérifier qu'une notification est présente pour le nouvel incident
4. Cliquer sur la notification

**Résultats Attendus**:
- ✅ Une notification est créée dans l'application
- ✅ Le badge de notifications affiche le nombre de notifications non lues
- ✅ La notification contient:
  - Titre: "Nouvel incident"
  - Code de l'incident
  - Type et urgence
  - Lien direct vers l'incident
- ✅ Le clic sur la notification navigue vers l'incident

---

### Test 2.2 - Consultation des Détails d'un Incident

**Objectif**: Vérifier qu'un RSO peut consulter tous les détails d'un incident.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident existant

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Observer toutes les sections:
   - Informations générales
   - Description
   - Personnes impliquées
   - Impact
   - Preuves
   - Mesures
   - Historique
   - Commentaires

**Résultats Attendus**:
- ✅ Toutes les sections sont affichées
- ✅ Les informations sont complètes et lisibles
- ✅ Les preuves sont affichées avec vignettes
- ✅ L'historique est complet
- ✅ Les actions disponibles sont visibles

---

### Test 2.3 - Assignation d'un Incident à un Responsable

**Objectif**: Vérifier qu'un RSO peut assigner un incident à un responsable.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident avec statut "nouveau"
- Avoir un responsable disponible

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Assigner à"
3. Sélectionner un responsable dans la liste
4. Confirmer l'assignation

**Résultats Attendus**:
- ✅ L'incident est assigné au responsable
- ✅ Le statut passe automatiquement à "en_investigation"
- ✅ La date de prise en charge est enregistrée
- ✅ Le responsable assigné reçoit une notification
- ✅ L'action est enregistrée dans l'historique
- ✅ L'assignation est visible dans les détails

---

### Test 2.4 - Changement de Statut d'un Incident

**Objectif**: Vérifier qu'un RSO peut changer le statut d'un incident.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Changer le statut"
3. Sélectionner un nouveau statut: "en_traitement"
4. Ajouter un commentaire optionnel
5. Confirmer le changement

**Résultats Attendus**:
- ✅ Le statut est changé avec succès
- ✅ La transition de statut est validée (workflow respecté)
- ✅ Le commentaire est enregistré
- ✅ L'action est enregistrée dans l'historique
- ✅ Les notifications appropriées sont envoyées
- ✅ Les dates sont mises à jour automatiquement (date_prise_en_charge, date_resolution, etc.)

---

### Test 2.5 - Définition de Priorité et Catégorie

**Objectif**: Vérifier qu'un RSO peut définir la priorité et la catégorie.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Modifier priorité/catégorie"
3. Définir:
   - Priorité: P1
   - Catégorie: Critique
4. Sauvegarder

**Résultats Attendus**:
- ✅ La priorité est mise à jour
- ✅ La catégorie est mise à jour
- ✅ Les changements sont visibles dans les détails
- ✅ L'action est enregistrée dans l'historique

---

### Test 2.6 - Ajout de Mesures Immédiates

**Objectif**: Vérifier qu'un RSO peut ajouter des mesures immédiates.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Ajouter mesures immédiates"
4. Saisir: "Renforcement de la surveillance, contrôle d'accès renforcé"
5. Sauvegarder

**Résultats Attendus**:
- ✅ Les mesures immédiates sont enregistrées
- ✅ Les mesures apparaissent dans la section "Mesures"
- ✅ Les mesures sont enregistrées dans le champ `mesures_immediates`
- ✅ Une entrée est créée dans `rso_incidents_mesures` avec type "immediate"
- ✅ L'action est enregistrée dans l'historique

---

### Test 2.7 - Validation d'un Incident Résolu

**Objectif**: Vérifier qu'un RSO peut valider un incident résolu.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident avec statut "resolu"

**Étapes**:
1. Accéder à la page de détails d'un incident résolu
2. Cliquer sur "Valider"
3. Ajouter un commentaire de validation (optionnel)
4. Confirmer la validation

**Résultats Attendus**:
- ✅ L'incident passe au statut "clos"
- ✅ La date de validation est enregistrée
- ✅ Le RSO est enregistré comme validateur
- ✅ Le commentaire est enregistré
- ✅ L'action est enregistrée dans l'historique
- ✅ Un rapport PDF peut être généré

---

### Test 2.8 - Clôture d'un Incident

**Objectif**: Vérifier qu'un RSO peut clôturer un incident.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident résolu ou validé

**Étapes**:
1. Accéder à la page de détails d'un incident résolu
2. Cliquer sur "Clôturer"
3. Ajouter un commentaire de clôture
4. Confirmer la clôture

**Résultats Attendus**:
- ✅ L'incident passe au statut "clos"
- ✅ La date de clôture est enregistrée
- ✅ Le commentaire est enregistré
- ✅ L'action est enregistrée dans l'historique
- ✅ L'incident peut être archivé après 2 ans

---

### Test 2.9 - Consultation de l'Historique Complet

**Objectif**: Vérifier que l'historique complet est affiché.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident avec plusieurs actions

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Historique"
3. Observer toutes les entrées d'historique

**Résultats Attendus**:
- ✅ Toutes les actions sont listées chronologiquement
- ✅ Chaque entrée affiche:
  - Type d'action
  - Utilisateur
  - Date/heure
  - Détails (ancien/nouveau statut, commentaire, etc.)
- ✅ L'historique est complet et traçable

---

## User Story 3 - Responsable assigné traite un incident

**Menu**: RSO → Incidents → [Sélectionner un incident assigné]  
**URL**: `/rso/incidents/[id]`

### Test 3.1 - Réception de Notification d'Assignation

**Objectif**: Vérifier qu'un responsable reçoit une notification lors de l'assignation.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné par un RSO

**Étapes**:
1. Se connecter en tant que Responsable
2. Observer le widget de notifications
3. Vérifier qu'une notification d'assignation est présente
4. Cliquer sur la notification

**Résultats Attendus**:
- ✅ Une notification est créée
- ✅ Type: "incident_assignation"
- ✅ Titre: "Incident assigné"
- ✅ Message: Contient les détails de l'incident
- ✅ Lien: Pointe vers l'incident
- ✅ Un email est envoyé (si configuré)

---

### Test 3.2 - Ajout de Commentaires d'Investigation

**Objectif**: Vérifier qu'un responsable peut ajouter des commentaires d'investigation.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné

**Étapes**:
1. Accéder à la page de détails d'un incident assigné
2. Naviguer vers la section "Commentaires"
3. Cliquer sur "Ajouter un commentaire"
4. Sélectionner le type: "Investigation"
5. Saisir: "Investigation en cours. Témoins interrogés. Analyse des caméras de surveillance en cours."
6. Sauvegarder

**Résultats Attendus**:
- ✅ Le commentaire est enregistré
- ✅ Le type "investigation" est associé
- ✅ Le commentaire apparaît dans la liste
- ✅ L'auteur et la date sont affichés
- ✅ L'action est enregistrée dans l'historique

---

### Test 3.3 - Création de Mesures Correctives

**Objectif**: Vérifier qu'un responsable peut créer des mesures correctives.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Ajouter mesure corrective"
4. Remplir le formulaire:
   - Description: "Renforcement des contrôles d'accès"
   - Responsable: Sélectionner un utilisateur
   - Date échéance: 2024-12-31
   - Coût estimé: 50000 FCFA
5. Sauvegarder

**Résultats Attendus**:
- ✅ La mesure corrective est créée
- ✅ Type: "corrective"
- ✅ Statut: "planifiee"
- ✅ Le responsable de la mesure reçoit une notification
- ✅ La mesure apparaît dans la liste
- ✅ L'action est enregistrée dans l'historique

---

### Test 3.4 - Création de Mesures Préventives

**Objectif**: Vérifier qu'un responsable peut créer des mesures préventives.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Ajouter mesure préventive"
4. Remplir le formulaire:
   - Description: "Formation du personnel aux procédures de sécurité"
   - Responsable: Sélectionner un utilisateur
   - Date échéance: 2025-01-31
5. Sauvegarder

**Résultats Attendus**:
- ✅ La mesure préventive est créée
- ✅ Type: "preventive"
- ✅ Statut: "planifiee"
- ✅ Le responsable de la mesure reçoit une notification
- ✅ La mesure apparaît dans la liste

---

### Test 3.5 - Mise à Jour du Statut d'une Mesure

**Objectif**: Vérifier qu'on peut mettre à jour le statut d'une mesure.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident avec des mesures

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Modifier le statut" pour une mesure
4. Changer le statut: "en_cours"
5. Sauvegarder
6. Changer le statut: "terminee"
7. Ajouter la date de réalisation
8. Sauvegarder

**Résultats Attendus**:
- ✅ Le statut est mis à jour
- ✅ La date de réalisation est enregistrée (si terminée)
- ✅ L'historique est mis à jour
- ✅ Les notifications appropriées sont envoyées
- ✅ Le statut est visible dans la liste

---

### Test 3.6 - Changement de Statut Incident à "en_traitement"

**Objectif**: Vérifier qu'un responsable peut changer le statut à "en_traitement".

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné avec statut "en_investigation"

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Changer le statut"
3. Sélectionner "en_traitement"
4. Ajouter un commentaire: "Traitement en cours. Mesures correctives en cours d'implémentation."
5. Confirmer

**Résultats Attendus**:
- ✅ Le statut passe à "en_traitement"
- ✅ Le commentaire est enregistré
- ✅ L'action est enregistrée dans l'historique
- ✅ Le RSO est notifié du changement

---

### Test 3.7 - Résolution d'un Incident

**Objectif**: Vérifier qu'un responsable peut résoudre un incident.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident avec statut "en_traitement"

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Résoudre"
3. Ajouter un commentaire de résolution: "Toutes les mesures correctives ont été mises en place. L'incident est résolu."
4. Confirmer

**Résultats Attendus**:
- ✅ Le statut passe à "resolu"
- ✅ La date de résolution est enregistrée
- ✅ Le commentaire est enregistré
- ✅ L'action est enregistrée dans l'historique
- ✅ Le RSO est notifié pour validation

---

### Test 3.8 - Ajout de Preuves Supplémentaires

**Objectif**: Vérifier qu'un responsable peut ajouter des preuves supplémentaires.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné
- Avoir des fichiers de preuve

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Preuves"
3. Cliquer sur "Ajouter des preuves"
4. Uploader 2 fichiers:
   - `rapport_initial.pdf`
   - `declaration_temoin.pdf`
5. Marquer comme "Élément de preuve" si nécessaire
6. Sauvegarder

**Résultats Attendus**:
- ✅ Les fichiers sont uploadés avec succès
- ✅ Les fichiers sont associés à l'incident
- ✅ Les métadonnées sont enregistrées
- ✅ L'action est enregistrée dans l'historique
- ✅ Les fichiers apparaissent dans la galerie de preuves

---

### Test 3.9 - Modification d'une Mesure

**Objectif**: Vérifier qu'on peut modifier une mesure existante.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident avec des mesures

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Modifier" pour une mesure
4. Modifier la description ou la date d'échéance
5. Sauvegarder

**Résultats Attendus**:
- ✅ La mesure est modifiée avec succès
- ✅ Les modifications sont visibles
- ✅ L'historique est mis à jour
- ✅ Les notifications sont envoyées si nécessaire

---

### Test 3.10 - Suppression d'une Mesure

**Objectif**: Vérifier qu'on peut supprimer une mesure.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident avec des mesures

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Naviguer vers la section "Mesures"
3. Cliquer sur "Supprimer" pour une mesure
4. Confirmer la suppression

**Résultats Attendus**:
- ✅ La mesure est supprimée
- ✅ La mesure disparaît de la liste
- ✅ L'action est enregistrée dans l'historique
- ✅ Aucune erreur n'est générée

---

## User Story 4 - Administrateur consulte le dashboard des incidents

**Menu**: RSO → Admin → Incidents → Dashboard  
**URL**: `/rso/admin/incidents` ou `/rso/incidents/dashboard`

### Test 4.1 - Affichage des Statistiques Globales

**Objectif**: Vérifier que les statistiques globales s'affichent correctement.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents dans le système

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer les cartes de statistiques

**Résultats Attendus**:
- ✅ Carte "Total": Affiche le nombre total d'incidents
- ✅ Carte "Nouveaux": Affiche le nombre d'incidents avec statut "nouveau"
- ✅ Carte "En cours": Affiche le nombre d'incidents en cours (en_investigation + en_traitement)
- ✅ Carte "Résolus": Affiche le nombre d'incidents résolus
- ✅ Les chiffres sont corrects et à jour
- ✅ Des indicateurs visuels sont présents (couleurs, icônes)

---

### Test 4.2 - Graphique d'Évolution Mensuelle

**Objectif**: Vérifier que le graphique d'évolution mensuelle fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents créés sur plusieurs mois

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer le graphique d'évolution mensuelle
3. Changer la période (ex: dernier trimestre, dernière année)
4. Observer le graphique mis à jour

**Résultats Attendus**:
- ✅ Le graphique affiche l'évolution du nombre d'incidents par mois
- ✅ Les données sont distinguées: Total, Critiques, Résolus
- ✅ Le changement de période met à jour le graphique
- ✅ Le graphique est lisible et professionnel (barres ou lignes)

---

### Test 4.3 - Graphique de Répartition par Type

**Objectif**: Vérifier que le graphique de répartition par type fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents de différents types

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer le graphique de répartition par type

**Résultats Attendus**:
- ✅ Le graphique affiche la répartition des incidents par type
- ✅ Les types sont: intrusion, vol, vandalisme, incendie, accident, etc.
- ✅ Les pourcentages ou nombres sont affichés
- ✅ Le graphique est lisible (camembert ou barres)

---

### Test 4.4 - Liste des Incidents Critiques/Urgents

**Objectif**: Vérifier que la liste des incidents critiques s'affiche.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents avec niveau urgence critique ou élevé

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer la section "Incidents urgents/critiques"
3. Cliquer sur un incident pour voir les détails

**Résultats Attendus**:
- ✅ La liste des incidents critiques/urgents s'affiche
- ✅ Les incidents sont triés par urgence (critique en premier)
- ✅ Chaque incident affiche:
  - Code
  - Type
  - Installation
  - Date
  - Statut
  - Niveau urgence (avec indicateur visuel)
- ✅ Le clic sur un incident navigue vers ses détails

---

### Test 4.5 - Filtrage par Installation

**Objectif**: Vérifier que le filtrage par installation fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents de différentes installations

**Étapes**:
1. Accéder au dashboard des incidents
2. Sélectionner une installation dans le filtre
3. Observer les statistiques et graphiques mis à jour

**Résultats Attendus**:
- ✅ Les statistiques sont filtrées par installation
- ✅ Les graphiques sont mis à jour
- ✅ Les listes (incidents critiques) sont filtrées
- ✅ Le filtre est persisté dans l'URL

---

### Test 4.6 - Filtrage par Période

**Objectif**: Vérifier que le filtrage par période fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents de différentes périodes

**Étapes**:
1. Accéder au dashboard des incidents
2. Sélectionner une période (ex: dernier trimestre)
3. Observer les statistiques et graphiques mis à jour

**Résultats Attendus**:
- ✅ Les statistiques sont filtrées par période
- ✅ Les graphiques sont mis à jour
- ✅ Les données correspondent à la période sélectionnée

---

### Test 4.7 - Tableau de Temps Moyen de Résolution

**Objectif**: Vérifier que le temps moyen de résolution s'affiche.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents résolus de différentes catégories

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer la section "Temps moyen de résolution"

**Résultats Attendus**:
- ✅ Le tableau affiche les temps moyens par catégorie:
  - Critique
  - Grave
  - Modéré
  - Mineur
- ✅ Les objectifs sont affichés (si définis)
- ✅ Des indicateurs visuels montrent si les objectifs sont atteints
- ✅ Les données sont correctes

---

### Test 4.8 - Tableau de Répartition par Installation

**Objectif**: Vérifier que le tableau de répartition par installation s'affiche.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des incidents de différentes installations

**Étapes**:
1. Accéder au dashboard des incidents
2. Observer le tableau de répartition par installation

**Résultats Attendus**:
- ✅ Le tableau affiche les installations avec leurs statistiques
- ✅ Colonnes: Installation, Total, Critiques, Résolus, En cours
- ✅ Les données sont correctes
- ✅ Le tableau est triable

---

## User Story 5 - Utilisateur consulte et recherche des incidents

**Menu**: RSO → Incidents  
**URL**: `/rso/incidents`

### Test 5.1 - Affichage de la Liste des Incidents

**Objectif**: Vérifier que la liste des incidents s'affiche correctement.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents dans le système

**Étapes**:
1. Accéder à "RSO → Incidents"
2. Observer la liste des incidents

**Résultats Attendus**:
- ✅ La liste s'affiche avec pagination
- ✅ Chaque incident affiche:
  - Code
  - Titre
  - Type
  - Installation
  - Date
  - Statut
  - Niveau urgence (avec indicateur visuel)
  - Responsable assigné
- ✅ La pagination fonctionne

---

### Test 5.2 - Filtrage par Statut

**Objectif**: Vérifier que le filtrage par statut fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents avec différents statuts

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer le filtre "Statut: Nouveau"
3. Observer la liste filtrée
4. Changer le filtre pour "Statut: En cours"
5. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les incidents avec le statut sélectionné sont affichés
- ✅ Le filtre fonctionne correctement
- ✅ Le nombre de résultats est mis à jour
- ✅ Les filtres peuvent être combinés

---

### Test 5.3 - Filtrage par Type d'Incident

**Objectif**: Vérifier que le filtrage par type fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents de différents types

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer le filtre "Type: Intrusion"
3. Observer la liste filtrée
4. Ajouter un autre type: "Vol"
5. Observer la liste filtrée (multi-sélection)

**Résultats Attendus**:
- ✅ Seuls les incidents des types sélectionnés sont affichés
- ✅ La multi-sélection fonctionne
- ✅ Le nombre de résultats est mis à jour

---

### Test 5.4 - Filtrage par Niveau d'Urgence

**Objectif**: Vérifier que le filtrage par urgence fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents avec différents niveaux d'urgence

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer le filtre "Urgence: Critique"
3. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les incidents avec le niveau d'urgence sélectionné sont affichés
- ✅ Le filtre fonctionne correctement

---

### Test 5.5 - Filtrage par Installation

**Objectif**: Vérifier que le filtrage par installation fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents de différentes installations

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer le filtre "Installation: Port de commerce"
3. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les incidents de l'installation sélectionnée sont affichés
- ✅ Le filtre fonctionne correctement

---

### Test 5.6 - Filtrage par Période de Date

**Objectif**: Vérifier que le filtrage par période fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents de différentes dates

**Étapes**:
1. Accéder à la liste des incidents
2. Définir une période:
   - Date début: 2024-01-01
   - Date fin: 2024-06-30
3. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les incidents dans la période sélectionnée sont affichés
- ✅ Le filtre fonctionne correctement

---

### Test 5.7 - Recherche par Mots-clés

**Objectif**: Vérifier que la recherche par mots-clés fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents avec différents contenus

**Étapes**:
1. Accéder à la liste des incidents
2. Saisir "intrusion" dans le champ de recherche
3. Observer les résultats
4. Saisir "zone de chargement"
5. Observer les résultats

**Résultats Attendus**:
- ✅ La recherche fonctionne dans:
  - Titre
  - Description courte
  - Description détaillée
- ✅ Les mots-clés sont mis en surbrillance dans les résultats
- ✅ Les résultats sont pertinents
- ✅ Le debouncing fonctionne (pas de requête à chaque caractère)

---

### Test 5.8 - Vue Kanban

**Objectif**: Vérifier que la vue Kanban fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents avec différents statuts

**Étapes**:
1. Accéder à la liste des incidents
2. Cliquer sur "Vue Kanban"
3. Observer l'organisation par colonnes de statut
4. Glisser-déposer un incident d'une colonne à une autre
5. Observer le changement de statut

**Résultats Attendus**:
- ✅ Les incidents sont organisés par colonnes de statut:
  - Nouveau
  - En investigation
  - En traitement
  - Résolu
  - Clos
- ✅ Le drag & drop fonctionne
- ✅ Le statut change automatiquement lors du drop
- ✅ L'interface est mise à jour de manière optimiste
- ✅ Une confirmation est demandée si nécessaire

---

### Test 5.9 - Export Excel

**Objectif**: Vérifier que l'export Excel fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents dans la liste

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer des filtres (optionnel)
3. Cliquer sur "Exporter en Excel"
4. Télécharger le fichier
5. Ouvrir le fichier Excel

**Résultats Attendus**:
- ✅ Le fichier Excel est généré
- ✅ Le fichier contient tous les incidents (filtrés si filtres appliqués)
- ✅ Les colonnes incluent: Code, Titre, Type, Installation, Date, Statut, Urgence, etc.
- ✅ Le fichier s'ouvre correctement dans Excel ou LibreOffice
- ✅ Les données sont correctement formatées

---

### Test 5.10 - Accès aux Détails depuis la Liste

**Objectif**: Vérifier qu'on peut accéder aux détails depuis la liste.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir des incidents dans la liste

**Étapes**:
1. Accéder à la liste des incidents
2. Cliquer sur un incident dans la liste
3. Observer la navigation vers la page de détails

**Résultats Attendus**:
- ✅ Le clic sur un incident navigue vers ses détails
- ✅ La page de détails s'affiche correctement
- ✅ Toutes les informations sont accessibles

---

### Test 5.11 - Persistance des Filtres

**Objectif**: Vérifier que les filtres sont persistants.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé

**Étapes**:
1. Accéder à la liste des incidents
2. Appliquer plusieurs filtres
3. Naviguer vers une autre page
4. Revenir à la liste des incidents
5. Observer que les filtres sont conservés

**Résultats Attendus**:
- ✅ Les filtres sont sauvegardés dans localStorage
- ✅ Les filtres sont restaurés au retour
- ✅ Les filtres sont persistants dans l'URL (partageable)

---

## User Story 6 - Système génère un rapport PDF d'incident

**Menu**: RSO → Incidents → [Sélectionner un incident] → Générer PDF  
**URL**: `/rso/incidents/[id]` (bouton "Générer PDF")

### Test 6.1 - Génération de Rapport PDF Basique

**Objectif**: Vérifier que la génération de PDF fonctionne.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident résolu ou clos

**Étapes**:
1. Accéder à la page de détails d'un incident
2. Cliquer sur "Générer rapport PDF"
3. Observer l'indicateur de progression
4. Télécharger le PDF généré
5. Ouvrir le PDF

**Résultats Attendus**:
- ✅ Le PDF est généré avec succès
- ✅ Le téléchargement démarre automatiquement
- ✅ Le PDF s'ouvre correctement dans un lecteur PDF
- ✅ Le nom du fichier suit un format cohérent (ex: `INC-2024-PAD_COM-001.pdf`)

---

### Test 6.2 - Page de Couverture du PDF

**Objectif**: Vérifier que la page de couverture est présente.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident

**Étapes**:
1. Générer un rapport PDF pour un incident
2. Ouvrir le PDF
3. Examiner la page de couverture

**Résultats Attendus**:
- ✅ Page de couverture présente avec:
  - Code de l'incident (mis en évidence)
  - Type d'incident
  - Installation
  - Niveau d'urgence (avec indicateur visuel)
  - Date de l'incident
  - Logo de l'organisation (si disponible)

---

### Test 6.3 - Résumé Exécutif dans le PDF

**Objectif**: Vérifier que le résumé exécutif est présent.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident complet

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner la section "Résumé Exécutif"

**Résultats Attendus**:
- ✅ Section "Résumé Exécutif" présente
- ✅ Tableau avec informations essentielles:
  - Code, Type, Catégorie, Urgence
  - Installation, Zone, Date
  - Statut, Priorité
  - Déclarant, Responsable assigné
- ✅ Format professionnel et lisible

---

### Test 6.4 - Description Détaillée dans le PDF

**Objectif**: Vérifier que la description détaillée est incluse.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec description détaillée

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner la section "Description Détaillée"

**Résultats Attendus**:
- ✅ Section "Description Détaillée" présente
- ✅ Description courte incluse
- ✅ Description détaillée incluse
- ✅ Circonstances inclues (si présentes)
- ✅ Formatage correct (paragraphes, listes)

---

### Test 6.5 - Personnes Impliquées dans le PDF

**Objectif**: Vérifier que les personnes impliquées sont incluses.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec témoins, suspects, victimes

**Étapes**:
1. Générer un rapport PDF pour un incident avec personnes impliquées
2. Ouvrir le PDF
3. Examiner la section "Personnes Impliquées"

**Résultats Attendus**:
- ✅ Section "Témoins" présente avec:
  - Nom, Fonction, Téléphone, Email
- ✅ Section "Suspects" présente avec:
  - Description, Identité (si identifiés)
- ✅ Section "Victimes" présente avec:
  - Nom, Blessures, Contact

---

### Test 6.6 - Impact dans le PDF

**Objectif**: Vérifier que l'impact est inclus.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec impact renseigné

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner la section "Impact"

**Résultats Attendus**:
- ✅ Section "Impact" présente avec:
  - Impact matériel
  - Impact opérationnel
  - Impact humain
  - Coût estimé (si renseigné)

---

### Test 6.7 - Preuves dans le PDF

**Objectif**: Vérifier que les preuves sont incluses dans le PDF.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec des preuves (images)

**Étapes**:
1. Générer un rapport PDF pour un incident avec preuves
2. Ouvrir le PDF
3. Examiner la section "Preuves"

**Résultats Attendus**:
- ✅ Section "Preuves" présente
- ✅ Les images sont intégrées dans le PDF
- ✅ Des légendes sont présentes pour chaque preuve
- ✅ Indication si élément de preuve
- ✅ Les images sont de qualité appropriée pour impression

---

### Test 6.8 - Mesures dans le PDF

**Objectif**: Vérifier que les mesures sont incluses.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec des mesures

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner la section "Mesures"

**Résultats Attendus**:
- ✅ Section "Mesures Immédiates" présente
- ✅ Section "Mesures Correctives" présente avec:
  - Description
  - Responsable
  - Date échéance
  - Statut
- ✅ Section "Mesures Préventives" présente
- ✅ Format professionnel (tableaux ou listes)

---

### Test 6.9 - Chronologie dans le PDF

**Objectif**: Vérifier que la chronologie est incluse.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident avec historique

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner la section "Chronologie"

**Résultats Attendus**:
- ✅ Section "Chronologie" présente
- ✅ Timeline de toutes les actions:
  - Création
  - Changements de statut
  - Assignations
  - Commentaires
  - Mesures
  - Validation
  - Clôture
- ✅ Dates et heures affichées
- ✅ Utilisateurs affichés

---

### Test 6.10 - Conclusion dans le PDF

**Objectif**: Vérifier que la conclusion est présente pour les incidents clos.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident clos

**Étapes**:
1. Générer un rapport PDF pour un incident clos
2. Ouvrir le PDF
3. Examiner la section "Conclusion"

**Résultats Attendus**:
- ✅ Section "Conclusion" présente
- ✅ Date de clôture affichée
- ✅ Résumé des mesures préventives mises en place
- ✅ Format professionnel

---

### Test 6.11 - Format Professionnel du PDF

**Objectif**: Vérifier que le PDF respecte les standards professionnels.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir un incident

**Étapes**:
1. Générer un rapport PDF
2. Ouvrir le PDF
3. Examiner le format général

**Résultats Attendus**:
- ✅ En-têtes et pieds de page présents
- ✅ Numérotation des pages "Page X sur Y"
- ✅ Mise en page cohérente
- ✅ Polices lisibles
- ✅ Marges appropriées
- ✅ Format A4 respecté

---

## User Story 7 - Système envoie des notifications automatiques

**Menu**: Notifications (widget dans le header)  
**URL**: Widget dans le header

### Test 7.1 - Notification lors de Création d'Incident

**Objectif**: Vérifier qu'une notification est créée lors de la création d'un incident.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir un RSO configuré pour l'installation

**Étapes**:
1. Créer un nouvel incident
2. Se connecter en tant que RSO
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée pour le RSO
- ✅ Type: "incident_nouveau"
- ✅ Titre: "Nouvel incident"
- ✅ Message: Contient le code et les détails
- ✅ Lien: Pointe vers l'incident
- ✅ Priorité: Selon le niveau d'urgence

---

### Test 7.2 - Notification Email pour Incident Critique

**Objectif**: Vérifier qu'un email est envoyé pour les incidents critiques.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté
- Avoir un RSO configuré

**Étapes**:
1. Créer un incident avec niveau urgence "Critique"
2. Vérifier la boîte mail du RSO

**Résultats Attendus**:
- ✅ Un email est envoyé au RSO
- ✅ L'email contient les détails de l'incident
- ✅ L'email est marqué comme urgent
- ✅ L'email contient un lien vers l'incident

---

### Test 7.3 - Notification lors de Changement de Statut

**Objectif**: Vérifier qu'une notification est créée lors du changement de statut.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident

**Étapes**:
1. Changer le statut d'un incident
2. Vérifier les notifications du déclarant et du responsable assigné

**Résultats Attendus**:
- ✅ Une notification est créée pour le déclarant
- ✅ Une notification est créée pour le responsable assigné (si présent)
- ✅ Type: "incident_changement_statut"
- ✅ Message: Indique l'ancien et le nouveau statut
- ✅ Lien: Pointe vers l'incident

---

### Test 7.4 - Notification lors d'Assignation

**Objectif**: Vérifier qu'une notification est créée lors de l'assignation.

**Prérequis**:
- Être connecté en tant que RSO
- Avoir un incident et un responsable

**Étapes**:
1. Assigner un incident à un responsable
2. Vérifier les notifications du responsable

**Résultats Attendus**:
- ✅ Une notification est créée pour le responsable assigné
- ✅ Type: "incident_assignation"
- ✅ Titre: "Incident assigné"
- ✅ Message: Contient les détails de l'incident
- ✅ Lien: Pointe vers l'incident
- ✅ Un email est envoyé (si configuré)

---

### Test 7.5 - Notification d'Alerte de Retard (Critique - 6h)

**Objectif**: Vérifier qu'une alerte est envoyée pour un incident critique en retard.

**Prérequis**:
- Avoir un incident critique créé il y a plus de 6 heures
- Attendre l'exécution du job (ou simuler)

**Étapes**:
1. Créer un incident critique
2. Attendre 6 heures (ou simuler)
3. Attendre l'exécution du job de vérification des retards
4. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification d'alerte est créée
- ✅ Type: "incident_retard"
- ✅ Titre: "Incident en retard de traitement"
- ✅ Message: Indique que l'incident dépasse le seuil de 6 heures
- ✅ Priorité: "urgente"
- ✅ Le responsable assigné et les administrateurs sont notifiés

---

### Test 7.6 - Notification d'Alerte de Retard (Grave - 24h)

**Objectif**: Vérifier qu'une alerte est envoyée pour un incident grave en retard.

**Prérequis**:
- Avoir un incident grave créé il y a plus de 24 heures

**Étapes**:
1. Créer un incident grave
2. Attendre 24 heures (ou simuler)
3. Attendre l'exécution du job
4. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification d'alerte est créée après 24 heures
- ✅ Le seuil de 24 heures est respecté
- ✅ Les notifications appropriées sont envoyées

---

### Test 7.7 - Notification d'Alerte de Retard (Modéré - 7 jours)

**Objectif**: Vérifier qu'une alerte est envoyée pour un incident modéré en retard.

**Prérequis**:
- Avoir un incident modéré créé il y a plus de 7 jours

**Étapes**:
1. Créer un incident modéré
2. Attendre 7 jours (ou simuler)
3. Attendre l'exécution du job
4. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification d'alerte est créée après 7 jours
- ✅ Le seuil de 7 jours est respecté

---

### Test 7.8 - Notification d'Alerte de Retard (Mineur - 14 jours)

**Objectif**: Vérifier qu'une alerte est envoyée pour un incident mineur en retard.

**Prérequis**:
- Avoir un incident mineur créé il y a plus de 14 jours

**Étapes**:
1. Créer un incident mineur
2. Attendre 14 jours (ou simuler)
3. Attendre l'exécution du job
4. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification d'alerte est créée après 14 jours
- ✅ Le seuil de 14 jours est respecté

---

### Test 7.9 - Notification lors de Création de Mesure

**Objectif**: Vérifier qu'une notification est créée lors de la création d'une mesure.

**Prérequis**:
- Être connecté en tant que Responsable
- Avoir un incident assigné
- Créer une mesure avec responsable

**Étapes**:
1. Créer une mesure corrective avec un responsable
2. Vérifier les notifications du responsable de la mesure

**Résultats Attendus**:
- ✅ Une notification est créée pour le responsable de la mesure
- ✅ Type: "mesure_nouvelle" ou "incident_mesure"
- ✅ Message: Contient les détails de la mesure
- ✅ Lien: Pointe vers l'incident

---

### Test 7.10 - Exécution du Job de Vérification des Retards

**Objectif**: Vérifier que le job de vérification des retards s'exécute correctement.

**Prérequis**:
- Avoir des incidents en retard
- Attendre l'exécution du job (ou simuler)

**Étapes**:
1. Vérifier que le job s'exécute toutes les heures
2. Observer les notifications créées

**Résultats Attendus**:
- ✅ Le job s'exécute toutes les heures
- ✅ Les incidents en retard sont détectés
- ✅ Les notifications sont créées selon les seuils
- ✅ Les logs sont enregistrés

---

## Workflow de Test Complet

### Workflow 1 - Cycle Complet de Gestion d'Incident

**Objectif**: Tester un cycle complet depuis la création jusqu'à la clôture.

**Prérequis**:
- Être connecté en tant qu'Agent de Sûreté, puis RSO, puis Responsable

**Étapes**:
1. **Création d'Incident (Agent)**
   - Créer un incident critique avec preuves
   - Vérifier que le code est généré
   - Vérifier que les notifications sont envoyées

2. **Prise en Charge (RSO)**
   - Se connecter en tant que RSO
   - Recevoir la notification
   - Assigner l'incident à un responsable
   - Définir la priorité et catégorie
   - Ajouter des mesures immédiates

3. **Traitement (Responsable)**
   - Se connecter en tant que Responsable
   - Recevoir la notification d'assignation
   - Ajouter des commentaires d'investigation
   - Créer des mesures correctives et préventives
   - Changer le statut à "en_traitement"
   - Résoudre l'incident

4. **Validation et Clôture (RSO)**
   - Se connecter en tant que RSO
   - Valider l'incident résolu
   - Clôturer l'incident

5. **Génération de Rapport (Utilisateur)**
   - Générer le rapport PDF
   - Vérifier que le PDF contient toutes les informations

**Résultats Attendus**:
- ✅ Toutes les étapes fonctionnent correctement
- ✅ Les notifications sont envoyées à chaque étape
- ✅ L'historique est complet
- ✅ Le workflow est respecté
- ✅ Le PDF est généré correctement

---

### Workflow 2 - Test Administrateur (Dashboard et Statistiques)

**Objectif**: Tester le dashboard et les statistiques pour un administrateur.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir plusieurs incidents dans le système

**Étapes**:
1. **Consultation du Dashboard**
   - Accéder au dashboard des incidents
   - Observer les statistiques globales
   - Observer les graphiques d'évolution
   - Observer la liste des incidents critiques

2. **Filtrage**
   - Filtrer par installation
   - Filtrer par période
   - Observer les statistiques mises à jour

3. **Analyse**
   - Consulter la répartition par type
   - Consulter les temps moyens de résolution
   - Consulter le tableau par installation

**Résultats Attendus**:
- ✅ Le dashboard affiche toutes les statistiques
- ✅ Les graphiques sont corrects
- ✅ Le filtrage fonctionne
- ✅ Les données sont à jour

---

### Workflow 3 - Test Recherche et Consultation

**Objectif**: Tester la recherche et la consultation des incidents.

**Prérequis**:
- Être connecté en tant qu'utilisateur autorisé
- Avoir plusieurs incidents dans le système

**Étapes**:
1. **Recherche**
   - Effectuer une recherche par mots-clés
   - Observer les résultats

2. **Filtrage**
   - Appliquer plusieurs filtres
   - Observer les résultats filtrés

3. **Vue Kanban**
   - Basculer en vue Kanban
   - Glisser-déposer un incident
   - Observer le changement de statut

4. **Export**
   - Exporter les résultats en Excel
   - Vérifier le fichier généré

**Résultats Attendus**:
- ✅ La recherche fonctionne
- ✅ Le filtrage fonctionne
- ✅ La vue Kanban fonctionne
- ✅ L'export fonctionne

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Core
- [ ] Création d'incident fonctionne
- [ ] Génération de code unique fonctionne
- [ ] Upload de preuves fonctionne
- [ ] Notifications automatiques fonctionnent
- [ ] Assignation d'incident fonctionne
- [ ] Changement de statut fonctionne
- [ ] Ajout de commentaires fonctionne
- [ ] Création de mesures fonctionne
- [ ] Mise à jour de mesures fonctionne
- [ ] Résolution d'incident fonctionne
- [ ] Validation d'incident fonctionne
- [ ] Clôture d'incident fonctionne
- [ ] Dashboard fonctionne
- [ ] Statistiques fonctionnent
- [ ] Graphiques fonctionnent
- [ ] Recherche fonctionne
- [ ] Filtrage fonctionne
- [ ] Vue Kanban fonctionne
- [ ] Export Excel fonctionne
- [ ] Génération PDF fonctionne
- [ ] Notifications de retard fonctionnent

### Sécurité
- [ ] Les permissions sont respectées (agents, RSO, admin)
- [ ] Les agents ne voient que les incidents de leur installation
- [ ] Les RSO ne voient que les incidents de leurs installations
- [ ] Les validations de données fonctionnent
- [ ] Les validations de fichiers fonctionnent
- [ ] Les RLS policies sont appliquées

### Performance
- [ ] La création d'incident est rapide (< 2 secondes)
- [ ] L'upload de fichiers fonctionne correctement
- [ ] La recherche retourne des résultats rapidement (< 2 secondes)
- [ ] Le dashboard se charge rapidement (< 3 secondes)
- [ ] La génération PDF est acceptable (< 10 secondes pour incident normal)

### Interface Utilisateur
- [ ] Les messages d'erreur sont clairs
- [ ] Les indicateurs de chargement fonctionnent
- [ ] Les notifications sont visibles
- [ ] Le formulaire est optimisé mobile
- [ ] Le responsive design fonctionne
- [ ] Les indicateurs visuels (urgence, statut) fonctionnent

### Workflow
- [ ] Le workflow de statut est respecté
- [ ] Les transitions de statut sont validées
- [ ] Les dates sont mises à jour automatiquement
- [ ] L'historique est complet
- [ ] Les notifications sont envoyées aux bons utilisateurs

---

## 📝 Notes de Test

### Problèmes Connus
- (À compléter lors des tests)

### Améliorations Suggérées
- (À compléter lors des tests)

### Questions à Clarifier
- (À compléter lors des tests)

---

**Fin du Document de Test**

