# Scénarios de Test Complets - 023 Gestion des Activités (CORE) RSO-PFSO

**Date de création**: 2025-11-30  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module de gestion des activités RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Création d'Activité par Workflow Guidé](#user-story-1---création-dactivité-par-workflow-guidé)
3. [User Story 2 - Rédaction avec Éditeur de Texte Riche](#user-story-2---rédaction-avec-éditeur-de-texte-riche)
4. [User Story 3 - Gestion des Permissions de Visualisation](#user-story-3---gestion-des-permissions-de-visualisation)
5. [User Story 4 - Gestion des Recommandations](#user-story-4---gestion-des-recommandations)
6. [User Story 5 - Consultation des Activités par les Agents PFSO](#user-story-5---consultation-des-activités-par-les-agents-pfso)
7. [User Story 6 - Recherche Avancée d'Activités](#user-story-6---recherche-avancée-dactivités)
8. [User Story 7 - Gestion et Liste des Activités](#user-story-7---gestion-et-liste-des-activités)
9. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Types d'Activités Hiérarchiques

#### Types Racines (6 types)
1. **CARTOGRAPHIE** - Pas de sous-types
2. **ENTRAINEMENT** - Avec sous-types (T1, T2, T3, T4)
3. **EXERCICE_ANNUEL** - Avec sous-types (Séminaire, Sur Table, Grandeur Nature)
4. **FORMATION_SURETE** - Pas de sous-types
5. **AUDIT_SURETE** - Avec sous-types (Semestre 1, Semestre 2)
6. **EVALUATION_SURETE** - Pas de sous-types

#### Sous-types
- **ENTRAINEMENT**: T1, T2, T3, T4 (Trimestres)
- **EXERCICE_ANNUEL**: EXERCICE_SEMINAIRE, EXERCICE_SUR_TABLE, EXERCICE_GRANDEUR_NATURE
- **AUDIT_SURETE**: AUDIT_SEMESTRE_1, AUDIT_SEMESTRE_2

### Données pour Création d'Activité

#### Activité d'Entraînement - Trimestre 1
```json
{
  "installationId": 1,
  "typeActivite": "ENTRAINEMENT",
  "sousType": "T1",
  "titre": "Entraînement évacuation d'urgence - T1 2024",
  "dateActivite": "2024-03-15",
  "dureeMinutes": 120,
  "lieu": "Salle de formation, Port de commerce",
  "nombreParticipants": 25,
  "plateformeVisio": "zoom",
  "lienVisio": "https://zoom.us/j/123456789",
  "visibleTousPfso": true,
  "pfsoAgentsIds": []
}
```

#### Activité d'Exercice Annuel
```json
{
  "installationId": 1,
  "typeActivite": "EXERCICE_ANNUEL",
  "sousType": "EXERCICE_GRANDEUR_NATURE",
  "titre": "Exercice grandeur nature - Simulation d'incident majeur",
  "dateActivite": "2024-06-20",
  "dureeMinutes": 240,
  "lieu": "Terminal à conteneurs, Port de commerce",
  "nombreParticipants": 50,
  "plateformeVisio": null,
  "lienVisio": null,
  "visibleTousPfso": false,
  "pfsoAgentsIds": [3, 4]
}
```

#### Activité de Formation
```json
{
  "installationId": 2,
  "typeActivite": "FORMATION_SURETE",
  "sousType": null,
  "titre": "Formation en sûreté portuaire - Niveau avancé",
  "dateActivite": "2024-04-10",
  "dureeMinutes": 180,
  "lieu": "Centre de formation ASPCI",
  "nombreParticipants": 15,
  "plateformeVisio": "teams",
  "lienVisio": "https://teams.microsoft.com/l/meetup-join/...",
  "visibleTousPfso": true,
  "pfsoAgentsIds": []
}
```

### Données pour Tests de Validation

#### Titre Invalide
- Trop court: `Test` (moins de 10 caractères)
- ✅ Erreur: "Le titre doit contenir au moins 10 caractères"

#### Date Invalide
- Date hors année sélectionnée: Si année 2024 sélectionnée, date `2023-12-31`
- ✅ Erreur: "La date de l'activité doit être dans l'année sélectionnée"

#### Lien Visioconférence Invalide
- Lien invalide: `not-a-url`
- ✅ Erreur: "Le lien de visioconférence doit être une URL valide"
- Plateforme sélectionnée sans lien: `plateformeVisio: "zoom"` mais `lienVisio: null`
- ✅ Erreur: "Le lien de visioconférence est obligatoire lorsque une plateforme est sélectionnée"

#### Durée Invalide
- Négative: `-30`
- ✅ Erreur: "La durée doit être positive"
- Zéro: `0`
- ✅ Erreur: "La durée doit être supérieure à 0"

#### Nombre Participants Invalide
- Négatif: `-5`
- ✅ Erreur: "Le nombre de participants ne peut pas être négatif"

### Données pour Recommandations

#### Recommandation Critique
```json
{
  "titre": "Améliorer la signalétique d'évacuation",
  "description": "Lors de l'exercice d'évacuation, il a été constaté que plusieurs panneaux de signalisation d'évacuation sont manquants ou illisibles dans les zones de stockage. Il est recommandé de procéder à un audit complet de la signalétique et de remplacer tous les panneaux défectueux dans un délai de 30 jours.",
  "priorite": "critique",
  "responsableId": 3,
  "dateEcheance": "2024-04-15"
}
```

#### Recommandation Haute Priorité
```json
{
  "titre": "Mettre à jour le plan de sûreté",
  "description": "Le plan de sûreté de l'installation n'a pas été mis à jour depuis 2022. Il est nécessaire de réviser le document complet, d'inclure les nouveaux équipements installés, et de former le personnel aux nouvelles procédures. Cette mise à jour doit être complétée avant le prochain audit.",
  "priorite": "haute",
  "responsableId": 4,
  "dateEcheance": "2024-05-30"
}
```

### Priorités de Recommandation
- `critique` - Priorité critique (rouge)
- `haute` - Priorité haute (orange)
- `moyenne` - Priorité moyenne (jaune)
- `basse` - Priorité basse (vert)

### Statuts de Recommandation
- `en_attente` - En attente
- `en_cours` - En cours
- `terminee` - Terminée
- `validee` - Validée
- `annulee` - Annulée

### Statuts d'Activité
- `brouillon` - Brouillon
- `en_cours` - En cours
- `termine` - Terminé
- `valide` - Validé
- `archive` - Archivé

### Plateformes de Visioconférence
- `zoom` - Zoom
- `teams` - Microsoft Teams
- `meet` - Google Meet
- `autre` - Autre

---

## 📝 User Story 1 - Création d'Activité par Workflow Guidé

**Menu**: `/rso/formateur/activites/creer`  
**Page**: Dashboard Formateur → **Créer une activité**

### Test 1.1 - Accès à la Page de Création d'Activité

**Prérequis**: Être connecté en tant que formateur RSO avec une année sélectionnée

**Étapes**:
1. Se connecter avec `formateur_rso1` / `Test1234!`
2. S'assurer qu'une année est sélectionnée (ex: 2024)
3. Accéder au menu **Créer une activité** ou `/rso/formateur/activites/creer`

**Résultat Attendu**:
- ✅ Page de création d'activité s'affiche
- ✅ Année pré-remplie et non modifiable (affichée en lecture seule)
- ✅ Formulaire avec étapes:
  - Étape 1: Sélection installation
  - Étape 2: Sélection type d'activité
  - Étape 3: Informations générales

---

### Test 1.2 - Sélection de l'Installation

**Menu**: `/rso/formateur/activites/creer` → Étape 1

**Étapes**:
1. Dans le champ **Installation**, ouvrir le dropdown
2. Vérifier la liste des installations disponibles
3. Sélectionner une installation (ex: "Port de commerce - PAD_COM")

**Résultat Attendu**:
- ✅ Liste des installations actives affichée
- ✅ Installation sélectionnée visible
- ✅ Passage à l'étape suivante possible

---

### Test 1.3 - Sélection Type d'Activité avec Sous-types

**Menu**: `/rso/formateur/activites/creer` → Étape 2

**Étapes**:
1. Dans le champ **Type d'activité**, sélectionner `ENTRAINEMENT`
2. Vérifier l'apparition du champ **Sous-type**
3. Vérifier les options disponibles

**Résultat Attendu**:
- ✅ Champ **Sous-type** apparaît dynamiquement
- ✅ Options disponibles: T1, T2, T3, T4
- ✅ Sélection d'un sous-type devient obligatoire
- ✅ Message: "Veuillez sélectionner un sous-type"

**Tests Additionnels**:
- Sélectionner `EXERCICE_ANNUEL`
- ✅ Sous-types: Séminaire, Sur Table, Grandeur Nature
- Sélectionner `AUDIT_SURETE`
- ✅ Sous-types: Semestre 1, Semestre 2
- Sélectionner `FORMATION_SURETE`
- ✅ Aucun champ sous-type n'apparaît (pas de sous-types)

---

### Test 1.4 - Sélection Type d'Activité sans Sous-types

**Menu**: `/rso/formateur/activites/creer` → Étape 2

**Étapes**:
1. Sélectionner `CARTOGRAPHIE` (type sans sous-types)
2. Vérifier l'absence de champ sous-type

**Résultat Attendu**:
- ✅ Aucun champ sous-type n'apparaît
- ✅ Formulaire peut être soumis directement après remplissage des autres champs

---

### Test 1.5 - Remplissage des Informations Générales

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Étapes**:
1. Remplir le formulaire:
   - **Titre**: `Entraînement évacuation d'urgence - T1 2024`
   - **Date**: `2024-03-15`
   - **Durée (minutes)**: `120`
   - **Lieu**: `Salle de formation, Port de commerce`
   - **Nombre de participants**: `25`
   - **Plateforme visio**: `zoom` (optionnel)
   - **Lien visio**: `https://zoom.us/j/123456789` (si plateforme sélectionnée)
2. Cliquer sur **Continuer** ou **Créer**

**Résultat Attendu**:
- ✅ Formulaire validé
- ✅ Code d'activité généré automatiquement (format: `ACT-2024-PAD_COM-ENT-T1-001`)
- ✅ Activité créée avec statut `brouillon`
- ✅ Redirection vers l'éditeur de texte riche (`/rso/formateur/activites/[id]/modifier`)

---

### Test 1.6 - Validation Titre (Minimum 10 Caractères)

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Étapes**:
1. Dans le champ **Titre**, saisir: `Test` (moins de 10 caractères)
2. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Le titre doit contenir au moins 10 caractères"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 1.7 - Validation Date (Dans l'Année Sélectionnée)

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Prérequis**: Année 2024 sélectionnée

**Étapes**:
1. Dans le champ **Date**, saisir: `2023-12-31` (hors année)
2. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "La date de l'activité doit être dans l'année sélectionnée (2024)"
- ✅ Le formulaire ne peut pas être soumis

**Test avec Date Valide**:
- Saisir une date dans l'année: `2024-03-15`
- ✅ Pas d'erreur

---

### Test 1.8 - Validation Lien Visioconférence

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Étapes**:
1. Sélectionner **Plateforme visio**: `zoom`
2. Laisser **Lien visio** vide
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Le lien de visioconférence est obligatoire lorsque une plateforme est sélectionnée"
- ✅ Le formulaire ne peut pas être soumis

**Tests Additionnels**:
- Sélectionner plateforme et saisir lien invalide: `not-a-url`
- ✅ Erreur: "Le lien de visioconférence doit être une URL valide"
- Saisir URL valide: `https://zoom.us/j/123456789`
- ✅ Pas d'erreur

---

### Test 1.9 - Validation Durée

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Étapes**:
1. Tester différentes valeurs dans **Durée (minutes)**:
   - `-30` (négatif)
   - `0` (zéro)
   - `120` (valide)

**Résultat Attendu**:
- ✅ Valeur négative: Erreur "La durée doit être positive"
- ✅ Zéro: Erreur "La durée doit être supérieure à 0"
- ✅ Valeur positive: Pas d'erreur

---

### Test 1.10 - Validation Nombre de Participants

**Menu**: `/rso/formateur/activites/creer` → Étape 3

**Étapes**:
1. Tester différentes valeurs dans **Nombre de participants**:
   - `-5` (négatif)
   - `0` (zéro, valide)
   - `25` (valide)

**Résultat Attendu**:
- ✅ Valeur négative: Erreur "Le nombre de participants ne peut pas être négatif"
- ✅ Zéro ou positif: Pas d'erreur

---

### Test 1.11 - Génération Automatique du Code d'Activité

**Menu**: `/rso/formateur/activites/creer` → Après création

**Étapes**:
1. Créer une activité avec:
   - Année: 2024
   - Installation: PAD_COM
   - Type: ENTRAINEMENT
   - Sous-type: T1
2. Vérifier le code généré

**Résultat Attendu**:
- ✅ Code généré: `ACT-2024-PAD_COM-ENT-T1-001`
- ✅ Format respecté: `ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN`
- ✅ Numéro séquentiel incrémenté pour les activités suivantes (002, 003, etc.)

**Test de Collision**:
- Créer plusieurs activités avec mêmes paramètres
- ✅ Codes uniques générés (001, 002, 003...)

---

### Test 1.12 - Workflow Complet de Création

**Menu**: `/rso/formateur/activites/creer`

**Étapes**:
1. Accéder à la page de création
2. Sélectionner installation: "Port de commerce"
3. Sélectionner type: "ENTRAINEMENT"
4. Sélectionner sous-type: "T1"
5. Remplir informations générales (titre, date, durée, lieu, participants)
6. Soumettre le formulaire

**Résultat Attendu**:
- ✅ Activité créée avec succès
- ✅ Code généré automatiquement
- ✅ Statut: `brouillon`
- ✅ Redirection vers l'éditeur de texte riche
- ✅ Entrée dans les journaux: `create_activity`

---

## ✏️ User Story 2 - Rédaction avec Éditeur de Texte Riche

**Menu**: `/rso/formateur/activites/[id]/modifier`  
**Page**: Éditeur de texte riche (après création d'activité)

### Test 2.1 - Accès à l'Éditeur de Texte Riche

**Prérequis**: Avoir créé une activité (Test 1.12)

**Étapes**:
1. Après création d'activité, vérifier la redirection
2. Vérifier l'affichage de l'éditeur

**Résultat Attendu**:
- ✅ Éditeur TinyMCE chargé et prêt
- ✅ Barre d'outils complète visible
- ✅ Zone d'édition vide (pour nouvelle activité)
- ✅ Indicateur "Dernière sauvegarde" visible en bas

---

### Test 2.2 - Formatage de Texte (Gras, Italique, Souligné)

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Saisir du texte dans l'éditeur
2. Sélectionner une portion de texte
3. Appliquer le formatage:
   - **Gras** (Ctrl+B)
   - **Italique** (Ctrl+I)
   - **Souligné** (Ctrl+U)

**Résultat Attendu**:
- ✅ Texte formaté visuellement dans l'éditeur
- ✅ Formatage préservé lors de la sauvegarde
- ✅ Formatage visible dans la vue finale

---

### Test 2.3 - Création de Titres (H1, H2, H3, H4)

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Saisir du texte
2. Sélectionner le texte
3. Appliquer un titre (H1, H2, H3, ou H4) depuis le menu déroulant

**Résultat Attendu**:
- ✅ Texte transformé en titre avec la taille appropriée
- ✅ Hiérarchie visuelle respectée (H1 > H2 > H3 > H4)
- ✅ Formatage préservé

---

### Test 2.4 - Création de Tableaux

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Cliquer sur l'icône **Tableau** dans la barre d'outils
2. Sélectionner le nombre de lignes et colonnes (ex: 3x4)
3. Créer le tableau
4. Remplir les cellules avec du contenu
5. Modifier les propriétés (bordures, couleurs)

**Résultat Attendu**:
- ✅ Tableau créé avec le nombre de lignes/colonnes spécifié
- ✅ Possibilité de modifier les propriétés
- ✅ Tableau affiché correctement dans l'éditeur et la vue finale

---

### Test 2.5 - Insertion d'Image (Upload)

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Cliquer sur l'icône **Image** dans la barre d'outils
2. Sélectionner un fichier image depuis l'ordinateur (JPG, PNG, max 5MB)
3. Attendre l'upload
4. Vérifier l'insertion

**Résultat Attendu**:
- ✅ Indicateur de progression pendant l'upload
- ✅ Image uploadée sur le serveur
- ✅ Image insérée dans l'éditeur à la position du curseur
- ✅ Possibilité de redimensionner l'image
- ✅ Image visible dans la vue finale

**Tests de Validation**:
- Fichier trop volumineux (>5MB): Erreur "Fichier trop volumineux"
- Format invalide (ex: .txt): Erreur "Format de fichier non supporté"

---

### Test 2.6 - Insertion de Vidéo YouTube

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Cliquer sur l'icône **Média** dans la barre d'outils
2. Coller l'URL d'une vidéo YouTube (ex: `https://www.youtube.com/watch?v=...`)
3. Insérer la vidéo

**Résultat Attendu**:
- ✅ Vidéo insérée en embed
- ✅ Vidéo affichée correctement dans l'éditeur (aperçu)
- ✅ Vidéo affichée correctement dans la vue finale
- ✅ Vidéo jouable directement dans la page

---

### Test 2.7 - Insertion de Carte Google Maps

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Cliquer sur le bouton personnalisé **Carte** (si disponible)
2. Saisir une adresse ou coordonnées
3. Ajuster la largeur et hauteur si nécessaire
4. Insérer la carte

**Résultat Attendu**:
- ✅ Prévisualisation de la carte affichée
- ✅ Carte insérée en iframe dans l'éditeur
- ✅ Carte affichée correctement dans la vue finale
- ✅ Carte interactive (zoom, navigation)

---

### Test 2.8 - Création de Galerie d'Images

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Cliquer sur le bouton personnalisé **Galerie** (si disponible)
2. Uploader plusieurs images (drag & drop ou sélection)
3. Voir la grille de prévisualisation
4. Choisir le nombre de colonnes (2, 3, ou 4)
5. Insérer la galerie

**Résultat Attendu**:
- ✅ Images uploadées
- ✅ Grille de prévisualisation affichée
- ✅ Galerie insérée dans l'éditeur avec toutes les images
- ✅ Galerie affichée correctement dans la vue finale (grille responsive)

---

### Test 2.9 - Sauvegarde Automatique (Auto-save)

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Rédiger du contenu dans l'éditeur
2. Attendre 30 secondes sans action
3. Vérifier l'indicateur de sauvegarde

**Résultat Attendu**:
- ✅ Sauvegarde automatique déclenchée après 30 secondes
- ✅ Indicateur "Dernière sauvegarde : Il y a X secondes" mis à jour
- ✅ Contenu sauvegardé en brouillon (statut non modifié)
- ✅ Pas de perte de contenu

---

### Test 2.10 - Avertissement Modifications Non Sauvegardées

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Rédiger du contenu dans l'éditeur
2. Faire des modifications
3. Attendre moins de 30 secondes (avant auto-save)
4. Essayer de quitter la page (fermer l'onglet ou naviguer ailleurs)

**Résultat Attendu**:
- ✅ Avertissement du navigateur: "Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir quitter ?"
- ✅ Possibilité d'annuler et rester sur la page
- ✅ Possibilité de confirmer et quitter (perte des modifications)

---

### Test 2.11 - Sauvegarde Finale du Contenu

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Rédiger du contenu complet dans l'éditeur
2. Cliquer sur **Sauvegarder** ou **Enregistrer**

**Résultat Attendu**:
- ✅ Contenu HTML sauvegardé
- ✅ Version texte (sans balises HTML) extraite et sauvegardée pour la recherche
- ✅ Message de succès: "Contenu sauvegardé avec succès"
- ✅ Statut peut être changé (brouillon → en_cours)

---

### Test 2.12 - Restauration du Contenu

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Prérequis**: Activité avec contenu déjà sauvegardé

**Étapes**:
1. Créer une activité et sauvegarder du contenu
2. Quitter la page
3. Revenir sur l'activité plus tard
4. Vérifier le contenu dans l'éditeur

**Résultat Attendu**:
- ✅ Contenu restauré depuis la dernière sauvegarde
- ✅ Images et médias insérés visibles
- ✅ Formatage préservé
- ✅ Éditeur pré-rempli avec le contenu existant

---

### Test 2.13 - Sanitization HTML (Protection XSS)

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Dans l'éditeur, essayer d'insérer du code JavaScript malveillant (via inspecteur ou copier-coller)
2. Sauvegarder le contenu
3. Vérifier le contenu sauvegardé

**Résultat Attendu**:
- ✅ Code JavaScript supprimé ou neutralisé
- ✅ Balises HTML dangereuses supprimées
- ✅ Seules les balises autorisées conservées
- ✅ Contenu sécurisé stocké

---

## 🔒 User Story 3 - Gestion des Permissions de Visualisation

**Menu**: `/rso/formateur/activites/[id]/modifier` → Section **Permissions**  
**Page**: Édition activité → Section Permissions

### Test 3.1 - Accès à la Section Permissions

**Menu**: `/rso/formateur/activites/[id]/modifier`

**Étapes**:
1. Ouvrir une activité en édition
2. Vérifier la section **Permissions de visualisation**

**Résultat Attendu**:
- ✅ Section **Permissions** visible
- ✅ Case à cocher "Visible par tous les agents PFSO de cette installation"
- ✅ Liste de tous les agents PFSO de l'installation avec cases à cocher individuelles

---

### Test 3.2 - Permissions "Visible par Tous"

**Menu**: `/rso/formateur/activites/[id]/modifier` → Section Permissions

**Étapes**:
1. Cocher "Visible par tous les agents PFSO de cette installation"
2. Sauvegarder l'activité
3. Vérifier dans la base de données

**Résultat Attendu**:
- ✅ `visible_tous_pfso` = `true` dans la base de données
- ✅ Tous les agents PFSO de l'installation peuvent consulter l'activité
- ✅ Permissions individuelles effacées (si présentes)

---

### Test 3.3 - Permissions Individuelles

**Menu**: `/rso/formateur/activites/[id]/modifier` → Section Permissions

**Étapes**:
1. Décocher "Visible par tous"
2. Sélectionner individuellement 2 agents PFSO spécifiques
3. Sauvegarder l'activité

**Résultat Attendu**:
- ✅ `visible_tous_pfso` = `false`
- ✅ Permissions individuelles créées dans `rso_activites_pfso_access`
- ✅ Seuls les 2 agents sélectionnés peuvent consulter l'activité
- ✅ Autres agents PFSO de l'installation ne peuvent pas y accéder

---

### Test 3.4 - Consultation par Agent PFSO avec Permission "Tous"

**Menu**: `/rso/pfso/activites` (après connexion agent PFSO)

**Prérequis**: Activité avec `visible_tous_pfso = true` pour l'installation de l'agent

**Étapes**:
1. Se connecter avec un agent PFSO (ex: `pfso_abidjan`)
2. Accéder à la liste des activités (`/rso/pfso/activites`)
3. Vérifier la présence de l'activité

**Résultat Attendu**:
- ✅ Activité visible dans la liste
- ✅ Agent peut accéder aux détails de l'activité
- ✅ Pas d'erreur 403

---

### Test 3.5 - Consultation par Agent PFSO avec Permission Individuelle

**Menu**: `/rso/pfso/activites`

**Prérequis**: Activité avec permission individuelle pour l'agent

**Étapes**:
1. Se connecter avec un agent PFSO ayant une permission individuelle
2. Accéder à la liste des activités
3. Vérifier la présence de l'activité

**Résultat Attendu**:
- ✅ Activité visible dans la liste
- ✅ Agent peut accéder aux détails

---

### Test 3.6 - Refus d'Accès (403) pour Agent sans Permission

**Menu**: `/rso/pfso/activites/[id]` (accès direct)

**Prérequis**: Activité sans permission pour l'agent

**Étapes**:
1. Se connecter avec un agent PFSO sans permission
2. Essayer d'accéder directement à l'activité via URL: `/rso/pfso/activites/[id]`

**Résultat Attendu**:
- ✅ Erreur 403 (Forbidden)
- ✅ Message: "Vous n'avez pas l'autorisation de consulter cette activité"
- ✅ Redirection vers la liste des activités

---

### Test 3.7 - Modification des Permissions

**Menu**: `/rso/formateur/activites/[id]/modifier` → Section Permissions

**Prérequis**: Activité avec permissions existantes

**Étapes**:
1. Ouvrir une activité avec permissions "tous"
2. Modifier pour désélectionner "tous" et sélectionner des agents individuels
3. Sauvegarder

**Résultat Attendu**:
- ✅ Permissions mises à jour
- ✅ Agents qui avaient accès via "tous" perdent l'accès
- ✅ Seuls les agents sélectionnés ont accès
- ✅ Entrée dans les journaux: `update_activity_permissions`

---

### Test 3.8 - Affichage des Permissions Actuelles

**Menu**: `/rso/formateur/activites/[id]` → Détails → Section Permissions

**Étapes**:
1. Ouvrir les détails d'une activité
2. Vérifier la section **Permissions**

**Résultat Attendu**:
- ✅ Liste des agents PFSO ayant actuellement accès
- ✅ Date d'attribution de chaque permission affichée
- ✅ Indication si "visible par tous" ou permissions individuelles

---

## 📋 User Story 4 - Gestion des Recommandations

**Menu**: `/rso/formateur/activites/recommandations`  
**Page**: Dashboard Formateur → **Recommandations**

### Test 4.1 - Accès à la Section Recommandations d'une Activité

**Menu**: `/rso/formateur/activites/[id]` → Section Recommandations

**Étapes**:
1. Ouvrir les détails d'une activité
2. Vérifier la section **Recommandations**

**Résultat Attendu**:
- ✅ Section **Recommandations** visible
- ✅ Liste des recommandations existantes (peut être vide)
- ✅ Bouton **Ajouter une recommandation** visible

---

### Test 4.2 - Création d'une Recommandation

**Menu**: `/rso/formateur/activites/[id]` → **Ajouter une recommandation**

**Étapes**:
1. Cliquer sur **Ajouter une recommandation**
2. Remplir le formulaire:
   - **Titre**: `Améliorer la signalétique d'évacuation` (min 10 caractères)
   - **Description**: Description détaillée (min 150 caractères)
   - **Priorité**: `haute`
   - **Responsable**: Sélectionner un agent PFSO ou formateur
   - **Date d'échéance**: `2024-04-15` (optionnel)
3. Cliquer sur **Créer**

**Résultat Attendu**:
- ✅ Recommandation créée avec succès
- ✅ Apparaît dans la liste des recommandations de l'activité
- ✅ Indicateur visuel de priorité (badge couleur)
- ✅ Responsable notifié (si notifications implémentées)
- ✅ Entrée dans les journaux: `create_recommendation`

---

### Test 4.3 - Validation Titre Recommandation (Minimum 10 Caractères)

**Menu**: `/rso/formateur/activites/[id]` → Formulaire recommandation

**Étapes**:
1. Ouvrir le formulaire de création
2. Saisir un titre trop court: `Test` (moins de 10 caractères)
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Le titre doit contenir au moins 10 caractères"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 4.4 - Validation Description Recommandation (Minimum 150 Caractères)

**Menu**: `/rso/formateur/activites/[id]` → Formulaire recommandation

**Étapes**:
1. Ouvrir le formulaire
2. Saisir une description trop courte (moins de 150 caractères)
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "La description doit contenir au moins 150 caractères"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 4.5 - Création Recommandation Critique

**Menu**: `/rso/formateur/activites/[id]` → Formulaire recommandation

**Étapes**:
1. Créer une recommandation avec priorité `critique`
2. Sauvegarder

**Résultat Attendu**:
- ✅ Recommandation créée
- ✅ Badge rouge "Critique" visible
- ✅ Responsable notifié (si notifications implémentées)
- ✅ Recommandation mise en évidence dans les listes

---

### Test 4.6 - Mise à Jour Statut Recommandation (En Cours)

**Menu**: `/rso/formateur/activites/[id]` → Recommandations → **Modifier statut**

**Prérequis**: Recommandation avec statut `en_attente`

**Étapes**:
1. Ouvrir une recommandation
2. Changer le statut de `en_attente` à `en_cours`
3. Sauvegarder

**Résultat Attendu**:
- ✅ Statut mis à jour
- ✅ Badge de statut mis à jour (couleur change)
- ✅ Entrée dans les journaux: `update_recommendation_status`

---

### Test 4.7 - Finalisation Recommandation (Terminée)

**Menu**: `/rso/formateur/activites/[id]` → Recommandations → **Marquer comme terminée**

**Prérequis**: Recommandation avec statut `en_cours`

**Étapes**:
1. Ouvrir une recommandation
2. Changer le statut à `terminee`
3. Remplir le champ **Actions prises**: Description des actions réalisées
4. Renseigner la **Date de résolution**
5. Sauvegarder

**Résultat Attendu**:
- ✅ Statut changé à `terminee`
- ✅ Champ "Actions prises" obligatoire et rempli
- ✅ Date de résolution enregistrée
- ✅ Recommandation marquée comme terminée

---

### Test 4.8 - Validation Actions Prises (Obligatoire pour Terminée)

**Menu**: `/rso/formateur/activites/[id]` → Recommandations → **Marquer comme terminée**

**Étapes**:
1. Changer le statut à `terminee`
2. Laisser le champ **Actions prises** vide
3. Essayer de sauvegarder

**Résultat Attendu**:
- ✅ Message d'erreur: "Les actions prises sont obligatoires lorsque le statut est 'terminée'"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 4.9 - Recommandations en Retard

**Menu**: `/rso/formateur/activites/recommandations` → Filtres

**Prérequis**: Recommandation avec date d'échéance passée et statut `en_attente` ou `en_cours`

**Étapes**:
1. Accéder à la page de suivi des recommandations
2. Vérifier la section "Recommandations en retard"

**Résultat Attendu**:
- ✅ Section "En retard" visible
- ✅ Recommandations en retard listées
- ✅ Indicateur visuel d'alerte (rouge, icône warning)
- ✅ Nombre de jours de retard affiché

---

### Test 4.10 - Filtrage des Recommandations

**Menu**: `/rso/formateur/activites/recommandations` → Filtres

**Étapes**:
1. Accéder à la page de suivi
2. Appliquer des filtres:
   - **Statut**: `en_cours`
   - **Priorité**: `haute`
   - **Installation**: "Port de commerce"
   - **Période**: Janvier à Mars 2024
3. Vérifier les résultats

**Résultat Attendu**:
- ✅ Liste filtrée selon tous les critères
- ✅ Seules les recommandations correspondantes affichées
- ✅ Compteurs mis à jour

---

### Test 4.11 - Statistiques des Recommandations

**Menu**: `/rso/formateur/activites/recommandations` → Statistiques

**Étapes**:
1. Accéder à la page de suivi
2. Vérifier les statistiques affichées

**Résultat Attendu**:
- ✅ Métriques affichées:
  - Nombre total de recommandations
  - Nombre en attente
  - Nombre en cours
  - Nombre terminées
  - Nombre en retard
- ✅ Graphiques ou tableaux de répartition

---

### Test 4.12 - Affichage Recommandations dans Détails Activité

**Menu**: `/rso/formateur/activites/[id]` → Section Recommandations

**Prérequis**: Activité avec recommandations

**Étapes**:
1. Ouvrir les détails d'une activité
2. Vérifier la section Recommandations

**Résultat Attendu**:
- ✅ Liste des recommandations de l'activité affichée
- ✅ Statuts et priorités visibles
- ✅ Lien vers les détails de chaque recommandation

---

## 👁️ User Story 5 - Consultation des Activités par les Agents PFSO

**Menu**: `/rso/pfso/activites`  
**Page**: Dashboard PFSO → **Consultation Activités**

### Test 5.1 - Accès à la Page de Consultation

**Prérequis**: Être connecté en tant qu'agent PFSO

**Étapes**:
1. Se connecter avec `pfso_abidjan` / `Test1234!`
2. Accéder à `/rso/pfso/activites`

**Résultat Attendu**:
- ✅ Page de consultation s'affiche
- ✅ Liste des activités avec permissions affichée
- ✅ Filtres disponibles: Année (pré-remplie), Type d'activité
- ✅ Champ de recherche
- ✅ **Aucun bouton Modifier ou Supprimer** visible

---

### Test 5.2 - Filtrage par Année et Type

**Menu**: `/rso/pfso/activites` → Filtres

**Étapes**:
1. Utiliser le filtre **Année** (déjà pré-rempli)
2. Sélectionner un **Type d'activité** (ex: "Entraînements")
3. Appliquer les filtres

**Résultat Attendu**:
- ✅ Liste filtrée selon les critères
- ✅ Seules les activités correspondantes affichées
- ✅ Installation verrouillée (non modifiable, pré-remplie)

---

### Test 5.3 - Recherche par Mot-clé

**Menu**: `/rso/pfso/activites` → Champ de recherche

**Étapes**:
1. Dans le champ de recherche, saisir: `évacuation`
2. Lancer la recherche

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les activités contenant "évacuation"
- ✅ Mots-clés mis en surbrillance dans les résultats
- ✅ Pagination si nécessaire

---

### Test 5.4 - Consultation Détails d'une Activité

**Menu**: `/rso/pfso/activites` → Cliquer sur une activité

**Étapes**:
1. Dans la liste, cliquer sur une activité
2. Vérifier l'affichage des détails

**Résultat Attendu**:
- ✅ Page de détails s'affiche
- ✅ Toutes les informations visibles:
  - Titre, type, date, durée, lieu, participants
  - Contenu complet avec formatage (texte, tableaux, images, vidéos, cartes)
  - Recommandations
- ✅ Boutons **Télécharger PDF** et **Imprimer** visibles
- ✅ **Aucun bouton Modifier ou Supprimer**

---

### Test 5.5 - Export PDF d'une Activité

**Menu**: `/rso/pfso/activites/[id]` → **Télécharger PDF**

**Étapes**:
1. Ouvrir les détails d'une activité
2. Cliquer sur **Télécharger PDF**

**Résultat Attendu**:
- ✅ PDF généré (indicateur de chargement)
- ✅ Fichier PDF téléchargé automatiquement
- ✅ Nom: `activite_[CODE]_[DATE].pdf`
- ✅ Contenu: Rapport professionnel avec:
  - Logo de l'organisation
  - Métadonnées (titre, type, date, installation)
  - Contenu complet formaté
  - Recommandations
  - Pied de page avec numéros de page
- ✅ Entrée dans les journaux: `download_activity_pdf`

---

### Test 5.6 - Impression d'une Activité

**Menu**: `/rso/pfso/activites/[id]` → **Imprimer**

**Étapes**:
1. Ouvrir les détails d'une activité
2. Cliquer sur **Imprimer**

**Résultat Attendu**:
- ✅ Boîte de dialogue d'impression du navigateur s'ouvre
- ✅ Mise en page optimisée pour l'impression:
  - Pas d'éléments de navigation
  - En-têtes et pieds de page appropriés
  - Contenu bien formaté
- ✅ CSS d'impression appliqué
- ✅ Entrée dans les journaux: `print_activity`

---

### Test 5.7 - Affichage Lien Visioconférence

**Menu**: `/rso/pfso/activites/[id]`

**Prérequis**: Activité avec lien de visioconférence

**Étapes**:
1. Ouvrir une activité avec visioconférence
2. Vérifier l'affichage du lien

**Résultat Attendu**:
- ✅ Lien de visioconférence affiché et cliquable
- ✅ Plateforme indiquée (Zoom, Teams, etc.)
- ✅ Lien fonctionnel (si session encore active)

---

### Test 5.8 - Refus d'Accès sans Permission (403)

**Menu**: `/rso/pfso/activites/[id]` (accès direct)

**Prérequis**: Activité sans permission pour l'agent

**Étapes**:
1. Se connecter avec un agent PFSO
2. Essayer d'accéder directement à une activité sans permission via URL

**Résultat Attendu**:
- ✅ Erreur 403 (Forbidden)
- ✅ Message: "Vous n'avez pas l'autorisation de consulter cette activité"
- ✅ Redirection vers la liste des activités

---

## 🔍 User Story 6 - Recherche Avancée d'Activités

**Menu**: `/rso/recherche` ou `/rso/recherche-avancee`  
**Page**: Recherche Avancée

### Test 6.1 - Accès à la Page de Recherche Avancée

**Prérequis**: Être connecté (formateur ou admin)

**Étapes**:
1. Se connecter avec `formateur_rso1`
2. Accéder à `/rso/recherche` ou menu **Recherche avancée**

**Résultat Attendu**:
- ✅ Page de recherche avancée s'affiche
- ✅ Champ de recherche full-text
- ✅ Filtres disponibles: Année, Installation, Type, Statut, Période (date début/fin)
- ✅ Options de tri: Pertinence, Date décroissante, Date croissante, Titre A-Z
- ✅ Bouton **Rechercher** et **Réinitialiser**

---

### Test 6.2 - Recherche Full-Text Simple

**Menu**: `/rso/recherche`

**Étapes**:
1. Dans le champ de recherche, saisir: `évacuation`
2. Cliquer sur **Rechercher**

**Résultat Attendu**:
- ✅ Résultats affichés avec "évacuation" mis en surbrillance
- ✅ Extraits du contenu avec mots-clés en surbrillance
- ✅ Métadonnées pour chaque résultat: date, installation, type
- ✅ Score de pertinence affiché (si recherche full-text)

---

### Test 6.3 - Recherche avec Filtres

**Menu**: `/rso/recherche`

**Étapes**:
1. Saisir: `évacuation`
2. Appliquer des filtres:
   - **Année**: 2024
   - **Installation**: "Port de commerce"
   - **Type**: "Entraînements"
   - **Période**: Janvier à Mars 2024
3. Lancer la recherche

**Résultat Attendu**:
- ✅ Résultats filtrés selon tous les critères
- ✅ Seules les activités correspondant à tous les filtres affichées
- ✅ Mots-clés toujours mis en surbrillance

---

### Test 6.4 - Tri par Pertinence

**Menu**: `/rso/recherche` → Résultats → Tri

**Étapes**:
1. Effectuer une recherche full-text
2. Sélectionner le tri: **Pertinence**

**Résultat Attendu**:
- ✅ Résultats triés par score de pertinence (plus pertinent en premier)
- ✅ Scores de pertinence visibles (optionnel)

---

### Test 6.5 - Tri par Date

**Menu**: `/rso/recherche` → Résultats → Tri

**Étapes**:
1. Effectuer une recherche
2. Sélectionner le tri: **Date décroissante**

**Résultat Attendu**:
- ✅ Résultats triés par date (plus récent en premier)
- ✅ Changer à **Date croissante**: Plus ancien en premier

---

### Test 6.6 - Tri par Titre

**Menu**: `/rso/recherche` → Résultats → Tri

**Étapes**:
1. Effectuer une recherche
2. Sélectionner le tri: **Titre A-Z**

**Résultat Attendu**:
- ✅ Résultats triés alphabétiquement par titre

---

### Test 6.7 - Mise en Surbrillance des Mots-clés

**Menu**: `/rso/recherche` → Résultats

**Étapes**:
1. Rechercher: `évacuation`
2. Vérifier les résultats

**Résultat Attendu**:
- ✅ Mot "évacuation" mis en surbrillance dans les extraits
- ✅ Extraits montrent le contexte autour du mot-clé
- ✅ Mise en surbrillance visible (fond coloré ou gras)

---

### Test 6.8 - Pagination des Résultats

**Menu**: `/rso/recherche` → Résultats

**Prérequis**: Recherche retournant plus de 20 résultats

**Étapes**:
1. Effectuer une recherche qui retourne de nombreux résultats
2. Vérifier la pagination

**Résultat Attendu**:
- ✅ Pagination visible (20 résultats par page)
- ✅ Navigation entre pages fonctionnelle
- ✅ Compteur: "Page 1 sur X"

---

### Test 6.9 - Réinitialisation des Filtres

**Menu**: `/rso/recherche` → Bouton **Réinitialiser**

**Étapes**:
1. Appliquer plusieurs filtres et effectuer une recherche
2. Cliquer sur **Réinitialiser**

**Résultat Attendu**:
- ✅ Tous les champs vidés
- ✅ Filtres réinitialisés aux valeurs par défaut
- ✅ Liste retourne à l'état initial

---

### Test 6.10 - Recherche avec Restrictions Permissions (Agent PFSO)

**Menu**: `/rso/recherche` (agent PFSO)

**Prérequis**: Être connecté en tant qu'agent PFSO

**Étapes**:
1. Se connecter avec un agent PFSO
2. Effectuer une recherche
3. Vérifier les résultats

**Résultat Attendu**:
- ✅ Seules les activités avec permissions affichées
- ✅ Activités sans permission exclues des résultats
- ✅ Même si elles correspondent aux critères de recherche

---

## 📋 User Story 7 - Gestion et Liste des Activités

**Menu**: `/rso/formateur/activites`  
**Page**: Dashboard Formateur → **Mes Activités**

### Test 7.1 - Accès à la Liste des Activités

**Prérequis**: Être connecté en tant que formateur RSO

**Étapes**:
1. Se connecter avec `formateur_rso1`
2. Accéder à `/rso/formateur/activites`

**Résultat Attendu**:
- ✅ Liste de toutes les activités du formateur affichée
- ✅ Informations clés visibles: Type, Titre, Installation, Date, Durée, Participants, Statut
- ✅ Filtres rapides: Installation, Type, Statut
- ✅ Bouton **Créer une activité** visible
- ✅ Actions disponibles: Voir, Modifier, Exporter, Supprimer

---

### Test 7.2 - Affichage des Informations Clés

**Menu**: `/rso/formateur/activites`

**Étapes**:
1. Vérifier les colonnes/informations affichées pour chaque activité

**Résultat Attendu**:
- ✅ Type et sous-type avec icône
- ✅ Titre
- ✅ Installation
- ✅ Date formatée
- ✅ Durée (en minutes ou heures)
- ✅ Nombre de participants
- ✅ Statut avec badge coloré (brouillon, en_cours, termine, valide, archive)
- ✅ Actions (voir, modifier, exporter, supprimer)

---

### Test 7.3 - Filtrage Rapide par Installation

**Menu**: `/rso/formateur/activites` → Filtre Installation

**Étapes**:
1. Utiliser le filtre **Installation**
2. Sélectionner "Port de commerce"
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les activités de cette installation
- ✅ URL mise à jour (partageable)
- ✅ Compteur mis à jour

---

### Test 7.4 - Filtrage Rapide par Type

**Menu**: `/rso/formateur/activites` → Filtre Type

**Étapes**:
1. Utiliser le filtre **Type**
2. Sélectionner "Entraînements"
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée par type
- ✅ Seules les activités d'entraînement affichées

---

### Test 7.5 - Filtrage Rapide par Statut

**Menu**: `/rso/formateur/activites` → Filtre Statut

**Étapes**:
1. Utiliser le filtre **Statut**
2. Sélectionner "Terminé"
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée par statut
- ✅ Seules les activités terminées affichées

---

### Test 7.6 - Filtres Combinés

**Menu**: `/rso/formateur/activites` → Filtres multiples

**Étapes**:
1. Appliquer plusieurs filtres simultanément:
   - Installation: "Port de commerce"
   - Type: "Entraînements"
   - Statut: "Terminé"
2. Vérifier les résultats

**Résultat Attendu**:
- ✅ Liste filtrée selon tous les critères
- ✅ Seules les activités correspondant à tous les filtres affichées

---

### Test 7.7 - Consultation Détails d'une Activité

**Menu**: `/rso/formateur/activites` → **Voir**

**Étapes**:
1. Dans la liste, cliquer sur **Voir** pour une activité
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Page de détails s'affiche
- ✅ Toutes les informations complètes visibles
- ✅ Bouton **Retour à la liste** visible

---

### Test 7.8 - Modification d'une Activité

**Menu**: `/rso/formateur/activites` → **Modifier**

**Étapes**:
1. Dans la liste, cliquer sur **Modifier** pour une activité
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Page d'édition s'affiche
- ✅ Tous les champs pré-remplis avec les valeurs actuelles
- ✅ Éditeur de texte riche avec contenu existant
- ✅ Possibilité de modifier le contenu

---

### Test 7.9 - Export PDF depuis la Liste

**Menu**: `/rso/formateur/activites` → **Exporter PDF**

**Étapes**:
1. Dans la liste, cliquer sur **Exporter PDF** pour une activité
2. Attendre la génération

**Résultat Attendu**:
- ✅ PDF généré et téléchargé
- ✅ Indicateur de progression pendant la génération
- ✅ Fichier téléchargé automatiquement

---

### Test 7.10 - Suppression d'une Activité (Soft Delete)

**Menu**: `/rso/formateur/activites` → **Supprimer**

**Étapes**:
1. Dans la liste, cliquer sur **Supprimer** pour une activité
2. Confirmer la suppression dans la modal

**Résultat Attendu**:
- ✅ Modal de confirmation: "Êtes-vous sûr de vouloir supprimer cette activité ?"
- ✅ Après confirmation: Activité supprimée (soft delete)
- ✅ Activité disparaît de la liste principale
- ✅ `deleted_at` rempli dans la base de données
- ✅ Activité accessible pour les administrateurs dans les archives
- ✅ Entrée dans les journaux: `delete_activity`

---

### Test 7.11 - Changement de Statut depuis la Liste

**Menu**: `/rso/formateur/activites` → Menu Actions → **Changer statut**

**Étapes**:
1. Dans la liste, trouver une activité avec statut `brouillon`
2. Changer le statut à `en_cours`

**Résultat Attendu**:
- ✅ Statut mis à jour immédiatement
- ✅ Badge de statut mis à jour (couleur change)
- ✅ Message de confirmation
- ✅ Entrée dans les journaux: `update_activity_status`

**Transitions de Statut**:
- `brouillon` → `en_cours` ✅
- `en_cours` → `termine` ✅
- `termine` → `valide` (admin seulement) ✅
- N'importe quel statut → `archive` (admin seulement) ✅

---

### Test 7.12 - Liste des Activités pour Administrateur

**Menu**: `/rso/admin/activites` (si disponible)

**Prérequis**: Être connecté en tant qu'administrateur

**Étapes**:
1. Se connecter avec `admin_rso`
2. Accéder à la liste des activités

**Résultat Attendu**:
- ✅ Toutes les activités de tous les formateurs affichées
- ✅ Indication du créateur pour chaque activité
- ✅ Toutes les actions disponibles (modifier, supprimer, valider) sur n'importe quelle activité

---

### Test 7.13 - Pagination de la Liste

**Menu**: `/rso/formateur/activites`

**Prérequis**: Avoir plus de 20 activités

**Étapes**:
1. Vérifier la pagination en bas de la liste
2. Naviguer entre les pages

**Résultat Attendu**:
- ✅ Pagination fonctionnelle
- ✅ 20 activités par page par défaut
- ✅ Navigation entre pages fonctionne

---

## 🔄 Workflow de Test Complet

### Workflow 1: Cycle de Vie Complet d'une Activité

**Objectif**: Tester toutes les fonctionnalités liées à une activité de bout en bout

**Étapes**:
1. **Création** (Formateur)
   - Créer une activité via le workflow guidé
   - Vérifier la génération du code
   - Vérifier dans les journaux: `create_activity`

2. **Rédaction Contenu**
   - Rédiger le contenu dans l'éditeur riche
   - Insérer images, tableaux, vidéos, cartes
   - Vérifier l'auto-sauvegarde

3. **Permissions**
   - Définir les permissions de visualisation
   - Vérifier l'accès des agents PFSO

4. **Recommandations**
   - Ajouter des recommandations
   - Suivre leur statut

5. **Consultation PFSO**
   - Se connecter en tant qu'agent PFSO
   - Consulter l'activité
   - Exporter en PDF

6. **Modification**
   - Modifier le contenu
   - Changer le statut

7. **Recherche**
   - Rechercher l'activité avec différents critères
   - Vérifier la mise en surbrillance

8. **Suppression**
   - Supprimer l'activité (soft delete)
   - Vérifier qu'elle disparaît de la liste

---

### Workflow 2: Gestion Complète des Recommandations

**Objectif**: Tester le cycle complet de vie d'une recommandation

**Étapes**:
1. **Création**
   - Créer une recommandation critique
   - Assigner un responsable
   - Définir une date d'échéance

2. **Suivi**
   - Responsable marque comme "en cours"
   - Responsable marque comme "terminée" avec actions prises

3. **Validation**
   - Formateur valide la recommandation

4. **Statistiques**
   - Consulter les statistiques
   - Vérifier les recommandations en retard

---

### Workflow 3: Recherche et Consultation

**Objectif**: Tester la recherche et la consultation complète

**Étapes**:
1. **Création Multiples Activités**
   - Créer plusieurs activités avec différents types et contenus

2. **Recherche Full-Text**
   - Rechercher par mot-clé
   - Vérifier la pertinence des résultats

3. **Recherche avec Filtres**
   - Combiner recherche et filtres
   - Vérifier les résultats filtrés

4. **Consultation PFSO**
   - Agent PFSO recherche et consulte
   - Vérifier les restrictions de permissions

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Critiques (P1)
- [ ] Création d'activité via workflow guidé
- [ ] Génération automatique du code d'activité
- [ ] Sélection type d'activité avec sous-types dynamiques
- [ ] Validation des champs (titre, date, durée, etc.)
- [ ] Éditeur de texte riche fonctionnel
- [ ] Formatage texte (gras, italique, titres)
- [ ] Insertion tableaux, images, vidéos, cartes
- [ ] Création galeries d'images
- [ ] Auto-sauvegarde toutes les 30 secondes
- [ ] Avertissement modifications non sauvegardées
- [ ] Gestion des permissions (visible tous / individuel)
- [ ] Enforcement des permissions (403 si pas d'accès)

### Fonctionnalités Importantes (P2)
- [ ] Création de recommandations
- [ ] Suivi statut recommandations
- [ ] Recommandations en retard
- [ ] Statistiques recommandations
- [ ] Consultation activités par agents PFSO
- [ ] Export PDF activités
- [ ] Impression activités
- [ ] Recherche avancée full-text
- [ ] Filtres et tri dans la recherche
- [ ] Liste et gestion des activités
- [ ] Filtres rapides (installation, type, statut)
- [ ] Changement de statut

### Validation et Sécurité
- [ ] Validation titre (min 10 caractères)
- [ ] Validation date (dans l'année sélectionnée)
- [ ] Validation lien visioconférence (URL valide)
- [ ] Sanitization HTML (protection XSS)
- [ ] Validation upload images (type, taille)
- [ ] Restrictions permissions respectées
- [ ] Journalisation complète des actions

### Interface Utilisateur
- [ ] Responsive design
- [ ] Messages d'erreur clairs
- [ ] États de chargement
- [ ] Indicateurs visuels (statuts, priorités)
- [ ] Accessibilité (ARIA, navigation clavier)

---

## 📝 Notes de Test

### Environnement de Test
- **Backend**: `http://localhost:4000`
- **Frontend**: `http://localhost:3000`
- **Base de données**: PostgreSQL (vérifier la connexion)

### Prérequis
1. Exécuter les migrations Phase 3: `infra/scripts/migrations/0023_rso_phase3_activites.sql`
2. Exécuter le seed: `infra/scripts/migrations/0023_rso_phase3_seed.sql`
3. Démarrer les serveurs: `pnpm dev:api` et `pnpm dev:web`
4. Configurer TinyMCE API key dans `.env`
5. Configurer Google Maps API key (si utilisé)

### Données de Test
- Types d'activités hiérarchiques pré-chargés (6 types racines + sous-types)
- Utilisateurs de test: `admin_rso`, `formateur_rso1`, `pfso_abidjan`
- Installations disponibles (Phase 2)
- Années disponibles (Phase 2)

### Points d'Attention
- Vérifier les journaux d'activité après chaque action importante
- Tester avec différents rôles pour vérifier les permissions
- Vérifier la base de données directement si nécessaire
- Tester l'upload d'images avec différents formats et tailles
- Vérifier la génération PDF avec différents contenus

---

## 🐛 Problèmes Connus / À Vérifier

1. **TinyMCE**: Vérifier que l'API key est configurée correctement
2. **Upload Images**: Vérifier les permissions d'écriture dans le dossier d'upload
3. **PDF Generation**: Vérifier que Puppeteer est installé et fonctionne
4. **Auto-save**: Vérifier la gestion des erreurs réseau
5. **Recherche Full-Text**: Vérifier que les index GIN sont créés

---

**Fin du Document de Test**