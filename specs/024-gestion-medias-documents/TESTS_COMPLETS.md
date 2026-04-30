# Scénarios de Test Complets - 024 Gestion des Médias et Documents RSO-PFSO

**Date de création**: 2025-01-27  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module de gestion des médias et documents RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Upload Sécurisé de Médias pour Activités](#user-story-1---upload-sécurisé-de-médias-pour-activités)
3. [User Story 2 - Bibliothèque de Médias et Organisation](#user-story-2---bibliothèque-de-médias-et-organisation)
4. [User Story 3 - Galeries d'Images pour Activités](#user-story-3---galeries-dimages-pour-activités)
5. [User Story 4 - Génération de PDF Professionnels](#user-story-4---génération-de-pdf-professionnels)
6. [User Story 5 - Export Multi-formats (Word, Excel)](#user-story-5---export-multi-formats-word-excel)
7. [User Story 6 - Gestion des Quotas et Limitations](#user-story-6---gestion-des-quotas-et-limitations)
8. [User Story 7 - Impression Optimisée](#user-story-7---impression-optimisée)
9. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Fichiers de Test à Préparer

#### Images (JPG, PNG, GIF, WEBP)
- **image_test_1.jpg** - 2.5 MB, 4000x3000px (sera compressée)
- **image_test_2.png** - 1.8 MB, 2000x1500px
- **image_test_3.gif** - 500 KB, 800x600px
- **image_test_4.webp** - 3.2 MB, 5000x4000px (sera compressée)
- **image_test_5.jpg** - 12 MB, 6000x4500px (dépassera la limite de 10MB - doit être rejetée)
- **image_test_6.jpg** - 8 MB, 3000x2000px (valide)

#### Vidéos (MP4, WEBM)
- **video_test_1.mp4** - 45 MB, 1920x1080, durée 2min30s
- **video_test_2.webm** - 85 MB, 1280x720, durée 5min
- **video_test_3.mp4** - 120 MB, 1920x1080, durée 8min (dépassera la limite de 100MB - doit être rejetée)
- **video_test_4.mp4** - 15 MB, 1280x720, durée 1min

#### Documents (PDF, DOC, DOCX, XLS, XLSX)
- **document_test_1.pdf** - 5 MB
- **document_test_2.docx** - 3 MB
- **document_test_3.xlsx** - 2 MB
- **document_test_4.pdf** - 25 MB (dépassera la limite de 20MB - doit être rejetée)
- **document_test_5.doc** - 8 MB

#### Fichiers Invalides (pour tests de validation)
- **fichier_malveillant.exe** - Type non autorisé
- **script.php** - Type non autorisé
- **image_corrompue.jpg** - Fichier corrompu
- **fichier_vide.txt** - Type non autorisé

### Activités de Test

Pour tester l'intégration avec les activités, utiliser les activités existantes ou créer :
- **Activité 1**: "Entraînement évacuation T1 2024" - ID: 1
- **Activité 2**: "Formation sécurité incendie" - ID: 2
- **Activité 3**: "Audit sécurité portuaire" - ID: 3

### Utilisateurs de Test

- **Formateur RSO**: 
  - Email: `formateur@aspci.ci`
  - Mot de passe: `Password123!`
  - Quota initial: 1000 MB

- **Administrateur**: 
  - Email: `admin@aspci.ci`
  - Mot de passe: `Password123!`

- **Agent PFSO**: 
  - Email: `pfso@aspci.ci`
  - Mot de passe: `Password123!`

---

## User Story 1 - Upload Sécurisé de Médias pour Activités

**Menu**: RSO → Formateur → Activités → [Sélectionner une activité] → Section Médias  
**URL**: `/rso/formateur/activites/[id]/modifier` (section médias)

### Test 1.1 - Upload d'Images Valides

**Objectif**: Vérifier que l'upload d'images valides fonctionne correctement avec compression et génération de vignettes.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité existante (ID: 1)
- Avoir des fichiers images valides (JPG, PNG)

**Étapes**:
1. Accéder à la page de modification d'une activité
2. Naviguer vers la section "Médias" ou "Galerie"
3. Cliquer sur "Ajouter des médias" ou utiliser la zone de drag & drop
4. Sélectionner 3 images valides :
   - `image_test_1.jpg` (2.5 MB)
   - `image_test_2.png` (1.8 MB)
   - `image_test_6.jpg` (8 MB)
5. Observer les barres de progression pour chaque fichier
6. Attendre la fin du traitement

**Résultats Attendus**:
- ✅ Les 3 fichiers sont acceptés (validation MIME type et extension)
- ✅ Des barres de progression s'affichent pour chaque fichier
- ✅ Les images sont compressées automatiquement si > 2048px
- ✅ Des vignettes (300x300px) sont générées pour chaque image
- ✅ Les images apparaissent dans la galerie de l'activité
- ✅ Les métadonnées EXIF sont extraites et stockées
- ✅ Le quota utilisateur est mis à jour (augmentation de ~12.3 MB)
- ✅ Les fichiers sont stockés dans `uploads/aspci/medias/{YYYY}/{MM}/image/`

**Données à Vérifier**:
- Nombre de fichiers uploadés: 3
- Taille totale utilisée: ~12.3 MB
- Statut de traitement: "traite" pour tous
- Présence de vignettes: Oui
- Présence de versions optimisées: Oui (si images > 2048px)

---

### Test 1.2 - Upload de Vidéos Valides

**Objectif**: Vérifier que l'upload de vidéos fonctionne avec extraction de métadonnées et génération de vignettes.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité existante
- Avoir des fichiers vidéo valides (MP4, WEBM)

**Étapes**:
1. Accéder à la section médias d'une activité
2. Cliquer sur "Ajouter des médias"
3. Sélectionner 2 vidéos valides :
   - `video_test_1.mp4` (45 MB)
   - `video_test_4.mp4` (15 MB)
4. Observer le traitement

**Résultats Attendus**:
- ✅ Les 2 vidéos sont acceptées
- ✅ Les métadonnées sont extraites (durée, dimensions, codec)
- ✅ Une vignette est générée à la 1ère seconde
- ✅ Les vidéos apparaissent dans la galerie
- ✅ Le quota est mis à jour (+60 MB)
- ✅ Les fichiers sont stockés dans `uploads/aspci/medias/{YYYY}/{MM}/video/`

**Données à Vérifier**:
- Durée extraite: 2min30s pour video_test_1, 1min pour video_test_4
- Dimensions extraites: 1920x1080 et 1280x720
- Présence de vignette: Oui

---

### Test 1.3 - Upload de Documents Valides

**Objectif**: Vérifier que l'upload de documents fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité existante
- Avoir des fichiers documents valides (PDF, DOCX, XLSX)

**Étapes**:
1. Accéder à la section médias d'une activité
2. Cliquer sur "Ajouter des médias"
3. Sélectionner 3 documents :
   - `document_test_1.pdf` (5 MB)
   - `document_test_2.docx` (3 MB)
   - `document_test_3.xlsx` (2 MB)
4. Observer le traitement

**Résultats Attendus**:
- ✅ Les 3 documents sont acceptés
- ✅ Les documents apparaissent dans la liste avec icônes appropriées
- ✅ Le quota est mis à jour (+10 MB)
- ✅ Les fichiers sont stockés dans `uploads/aspci/medias/{YYYY}/{MM}/document/`

---

### Test 1.4 - Rejet de Fichiers Invalides (Type)

**Objectif**: Vérifier que les fichiers avec types non autorisés sont rejetés avant l'upload.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des fichiers invalides (.exe, .php, .txt)

**Étapes**:
1. Accéder à la section médias d'une activité
2. Tenter d'uploader `fichier_malveillant.exe`
3. Tenter d'uploader `script.php`
4. Tenter d'uploader `fichier_vide.txt`

**Résultats Attendus**:
- ✅ Chaque fichier est rejeté immédiatement (avant upload)
- ✅ Message d'erreur clair: "Type de fichier non autorisé: .exe"
- ✅ Aucun transfert de fichier n'est effectué
- ✅ Le quota n'est pas modifié

---

### Test 1.5 - Rejet de Fichiers Dépassant la Taille Maximale

**Objectif**: Vérifier que les fichiers dépassant les limites de taille sont rejetés.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des fichiers trop volumineux

**Étapes**:
1. Accéder à la section médias d'une activité
2. Tenter d'uploader `image_test_5.jpg` (12 MB - limite: 10 MB)
3. Tenter d'uploader `video_test_3.mp4` (120 MB - limite: 100 MB)
4. Tenter d'uploader `document_test_4.pdf` (25 MB - limite: 20 MB)

**Résultats Attendus**:
- ✅ Image 12 MB: Rejetée avec message "Taille maximale pour les images: 10 MB"
- ✅ Vidéo 120 MB: Rejetée avec message "Taille maximale pour les vidéos: 100 MB"
- ✅ Document 25 MB: Rejeté avec message "Taille maximale pour les documents: 20 MB"
- ✅ Aucun transfert n'est effectué
- ✅ Le quota n'est pas modifié

---

### Test 1.6 - Upload Multiple Simultané

**Objectif**: Vérifier que l'upload de plusieurs fichiers simultanément fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir au moins 5 fichiers valides de différents types

**Étapes**:
1. Accéder à la section médias d'une activité
2. Sélectionner simultanément 5 fichiers :
   - `image_test_1.jpg`
   - `image_test_2.png`
   - `video_test_4.mp4`
   - `document_test_1.pdf`
   - `document_test_2.docx`
3. Observer les barres de progression pour chaque fichier

**Résultats Attendus**:
- ✅ Les 5 fichiers sont acceptés
- ✅ Chaque fichier a sa propre barre de progression
- ✅ Les uploads se font en parallèle sans bloquer l'interface
- ✅ Tous les fichiers sont traités correctement
- ✅ Le quota est mis à jour avec la somme des tailles

---

### Test 1.7 - Blocage par Quota Insuffisant

**Objectif**: Vérifier que l'upload est bloqué si le quota serait dépassé.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un quota presque saturé (ex: 950 MB / 1000 MB utilisé)
- Avoir un fichier volumineux (ex: 100 MB)

**Étapes**:
1. Vérifier le quota actuel (doit être proche de la limite)
2. Accéder à la section médias d'une activité
3. Tenter d'uploader un fichier de 100 MB

**Résultats Attendus**:
- ✅ Le système calcule que l'upload dépasserait le quota
- ✅ L'upload est bloqué AVANT le transfert
- ✅ Message d'erreur clair: "Quota insuffisant. Espace disponible: 50 MB. Espace nécessaire: 100 MB"
- ✅ Aucun transfert n'est effectué
- ✅ Le quota n'est pas modifié

---

### Test 1.8 - Gestion des Erreurs d'Upload

**Objectif**: Vérifier que les erreurs d'upload sont gérées correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un fichier corrompu ou simuler une erreur réseau

**Étapes**:
1. Accéder à la section médias d'une activité
2. Tenter d'uploader `image_corrompue.jpg` (fichier corrompu)
3. Simuler une interruption réseau pendant l'upload

**Résultats Attendus**:
- ✅ Message d'erreur spécifique affiché
- ✅ Possibilité de réessayer l'upload du fichier échoué
- ✅ Les fichiers déjà uploadés avec succès ne sont pas supprimés
- ✅ L'interface reste utilisable

---

## User Story 2 - Bibliothèque de Médias et Organisation

**Menu**: RSO → Formateur → Médias  
**URL**: `/rso/formateur/medias`

### Test 2.1 - Affichage de la Bibliothèque avec Quota

**Objectif**: Vérifier que la bibliothèque affiche correctement tous les médias et le quota.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir uploadé au moins 10 médias de différents types

**Étapes**:
1. Accéder au menu "RSO → Formateur → Médias"
2. Observer le tableau de bord de quota
3. Observer la liste des médias

**Résultats Attendus**:
- ✅ Le tableau de bord de quota s'affiche avec :
  - Quota total: 1000 MB
  - Quota utilisé: X MB (calculé)
  - Pourcentage: X%
  - Barre de progression visuelle
  - Répartition par type (images: X MB, vidéos: Y MB, documents: Z MB)
- ✅ La liste des médias s'affiche (vue grille ou liste)
- ✅ Chaque média affiche :
  - Vignette (images/vidéos) ou icône (documents)
  - Nom de fichier original
  - Taille
  - Date d'upload
  - Type de média

---

### Test 2.2 - Filtrage par Type de Média

**Objectif**: Vérifier que le filtrage par type fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias de différents types dans la bibliothèque

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Appliquer le filtre "Type: Images"
3. Observer la liste filtrée
4. Changer le filtre pour "Type: Vidéos"
5. Observer la liste filtrée
6. Changer le filtre pour "Type: Documents"
7. Observer la liste filtrée
8. Retirer le filtre

**Résultats Attendus**:
- ✅ Filtre "Images": Seules les images sont affichées
- ✅ Filtre "Vidéos": Seules les vidéos sont affichées
- ✅ Filtre "Documents": Seuls les documents sont affichées
- ✅ Sans filtre: Tous les médias sont affichés
- ✅ Les filtres sont persistants dans l'URL (partageable)

---

### Test 2.3 - Filtrage par Activité

**Objectif**: Vérifier que le filtrage par activité associée fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias associés à différentes activités

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Appliquer le filtre "Activité: Entraînement évacuation T1 2024"
3. Observer la liste filtrée
4. Changer pour une autre activité
5. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les médias associés à l'activité sélectionnée sont affichés
- ✅ Le filtre fonctionne correctement
- ✅ Les médias non associés à une activité sont visibles avec filtre "Aucune activité"

---

### Test 2.4 - Filtrage par Période de Date

**Objectif**: Vérifier que le filtrage par période fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias uploadés à différentes dates

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Définir une période de date (ex: dernier mois)
3. Observer la liste filtrée
4. Changer la période (ex: dernier trimestre)
5. Observer la liste filtrée

**Résultats Attendus**:
- ✅ Seuls les médias uploadés dans la période sélectionnée sont affichés
- ✅ Le filtre fonctionne correctement avec dates de début et fin

---

### Test 2.5 - Recherche par Nom de Fichier

**Objectif**: Vérifier que la recherche fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias avec des noms variés

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Saisir "test" dans le champ de recherche
3. Observer les résultats
4. Saisir "image" dans le champ de recherche
5. Observer les résultats
6. Saisir un terme qui n'existe pas
7. Observer les résultats (aucun résultat)

**Résultats Attendus**:
- ✅ La recherche fonctionne sur les noms de fichiers originaux
- ✅ La recherche fonctionne sur les légendes
- ✅ Les résultats sont affichés avec le terme mis en surbrillance
- ✅ Si aucun résultat: Message "Aucun média trouvé"

---

### Test 2.6 - Vue Grille vs Vue Liste

**Objectif**: Vérifier que le changement de vue fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias dans la bibliothèque

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Sélectionner "Vue Grille"
3. Observer l'affichage
4. Sélectionner "Vue Liste"
5. Observer l'affichage

**Résultats Attendus**:
- ✅ Vue Grille:
  - Médias affichés en grille avec vignettes
  - Informations clés au survol (nom, taille, date)
  - Layout responsive (2-4 colonnes selon écran)
- ✅ Vue Liste:
  - Médias affichés en tableau
  - Colonnes: Type, Nom, Taille, Activité, Date, Actions
  - Tableau triable par colonnes

---

### Test 2.7 - Prévisualisation d'un Média

**Objectif**: Vérifier que la prévisualisation fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias dans la bibliothèque

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Cliquer sur une image pour la prévisualiser
3. Observer la modal de prévisualisation
4. Fermer la modal
5. Cliquer sur une vidéo pour la prévisualiser
6. Observer la modal de prévisualisation

**Résultats Attendus**:
- ✅ Modal de prévisualisation s'ouvre
- ✅ Pour images: Image en grand format
- ✅ Pour vidéos: Lecteur vidéo avec contrôles
- ✅ Pour documents: Icône et informations
- ✅ Affichage des informations complètes:
  - Métadonnées (dimensions, taille, dates)
  - Légende éditable
  - Activité associée
  - Actions disponibles (télécharger, modifier, supprimer, copier lien)

---

### Test 2.8 - Modification de Légende

**Objectif**: Vérifier que la modification de légende fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un média avec légende

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Cliquer sur un média pour l'ouvrir
3. Cliquer sur "Modifier" ou éditer la légende dans la modal
4. Modifier la légende: "Nouvelle légende de test"
5. Sauvegarder
6. Vérifier que la légende est mise à jour dans toutes les vues

**Résultats Attendus**:
- ✅ La légende est modifiable
- ✅ Après sauvegarde, la légende est mise à jour
- ✅ La légende apparaît dans:
  - La bibliothèque
  - La galerie d'activité
  - Les exports PDF
  - La prévisualisation

---

### Test 2.9 - Suppression de Média

**Objectif**: Vérifier que la suppression fonctionne avec soft delete.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un média à supprimer

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Noter le quota actuel
3. Cliquer sur un média pour l'ouvrir
4. Cliquer sur "Supprimer"
5. Confirmer la suppression
6. Observer que le média disparaît de la bibliothèque
7. Vérifier le quota (doit être mis à jour)

**Résultats Attendus**:
- ✅ Confirmation demandée avant suppression
- ✅ Le média est marqué comme supprimé (soft delete: `deleted_at` défini)
- ✅ Le média disparaît de la bibliothèque principale
- ✅ Le quota est mis à jour immédiatement (diminution)
- ✅ Le fichier physique est conservé (sera supprimé après 30 jours)
- ✅ Le média peut être restauré (si fonctionnalité disponible)

---

### Test 2.10 - Avertissement Quota > 80%

**Objectif**: Vérifier que l'avertissement s'affiche quand le quota approche de la limite.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un quota utilisé > 80% (ou simuler)

**Étapes**:
1. Accéder à la bibliothèque de médias
2. Observer le tableau de bord de quota
3. Si quota > 80%, vérifier l'affichage de l'avertissement

**Résultats Attendus**:
- ✅ Avertissement visuel affiché (couleur orange/rouge)
- ✅ Message: "Vous approchez de la limite de votre quota (X%)"
- ✅ Suggestions d'actions:
  - Supprimer des médias inutilisés
  - Contacter l'administrateur pour augmenter le quota

---

## User Story 3 - Galeries d'Images pour Activités

**Menu**: RSO → Formateur → Activités → [Sélectionner une activité] → Section Galerie  
**URL**: `/rso/formateur/activites/[id]/modifier` (section galerie)

### Test 3.1 - Affichage de la Galerie d'Images

**Objectif**: Vérifier que la galerie s'affiche correctement dans une activité.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des images associées

**Étapes**:
1. Accéder à la page de modification d'une activité
2. Naviguer vers la section "Galerie d'images"
3. Observer l'affichage de la galerie

**Résultats Attendus**:
- ✅ La galerie s'affiche en grille responsive:
  - 2 colonnes sur mobile
  - 3 colonnes sur tablette
  - 4 colonnes sur desktop
- ✅ Chaque image affiche:
  - Vignette
  - Légende (si présente)
  - Badge "Image principale" si applicable
- ✅ Bouton "Ajouter des images" visible

---

### Test 3.2 - Ajout d'Images depuis la Bibliothèque

**Objectif**: Vérifier qu'on peut ajouter des images existantes depuis la bibliothèque.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité
- Avoir des images dans la bibliothèque

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Cliquer sur "Ajouter des images"
3. Sélectionner "Depuis la bibliothèque"
4. Utiliser les filtres/recherche pour trouver des images
5. Sélectionner 5 images
6. Confirmer l'ajout

**Résultats Attendus**:
- ✅ Modal d'ajout s'ouvre avec option "Bibliothèque"
- ✅ Filtres et recherche disponibles
- ✅ Sélection multiple possible
- ✅ Les 5 images sont ajoutées à la galerie
- ✅ Les images apparaissent dans la galerie avec ordre par défaut

---

### Test 3.3 - Upload Direct d'Images dans la Galerie

**Objectif**: Vérifier qu'on peut uploader directement des images dans la galerie.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité
- Avoir des images à uploader

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Cliquer sur "Ajouter des images"
3. Sélectionner "Uploader de nouvelles images"
4. Sélectionner 3 images
5. Observer l'upload et le traitement

**Résultats Attendus**:
- ✅ Modal d'ajout s'ouvre avec option "Upload"
- ✅ Upload direct vers l'activité
- ✅ Les images sont traitées (compression, vignettes)
- ✅ Les images sont automatiquement associées à l'activité
- ✅ Les images apparaissent dans la galerie

---

### Test 3.4 - Réorganisation de l'Ordre des Images

**Objectif**: Vérifier que la réorganisation par drag & drop ou boutons fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec au moins 5 images dans la galerie

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Utiliser les boutons "Haut" / "Bas" pour réorganiser
3. Ou utiliser drag & drop si disponible
4. Observer le changement d'ordre
5. Recharger la page et vérifier que l'ordre est préservé

**Résultats Attendus**:
- ✅ Boutons de réorganisation disponibles
- ✅ L'ordre change immédiatement dans l'interface
- ✅ L'ordre est sauvegardé (champ `ordre` mis à jour)
- ✅ Après rechargement, l'ordre est préservé
- ✅ L'ordre est respecté dans les exports PDF

---

### Test 3.5 - Définition d'Image Principale

**Objectif**: Vérifier qu'on peut définir une image principale.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec au moins 3 images dans la galerie

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Cliquer sur "Définir comme image principale" sur une image
3. Observer que l'image est marquée comme principale
4. Définir une autre image comme principale
5. Observer que la première n'est plus principale

**Résultats Attendus**:
- ✅ Bouton "Définir comme principale" disponible
- ✅ L'image principale est marquée visuellement (badge)
- ✅ L'image principale apparaît en premier dans la galerie
- ✅ Une seule image peut être principale à la fois
- ✅ L'image principale est utilisée comme vignette de l'activité dans les listes
- ✅ L'image principale est mise en avant dans les exports

---

### Test 3.6 - Ajout de Légendes aux Images de la Galerie

**Objectif**: Vérifier qu'on peut ajouter des légendes aux images de la galerie.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des images dans la galerie

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Cliquer sur une image pour l'éditer
3. Ajouter une légende: "Photo de l'exercice d'évacuation"
4. Sauvegarder
5. Vérifier que la légende s'affiche sous l'image dans la galerie

**Résultats Attendus**:
- ✅ Possibilité d'éditer la légende depuis la galerie
- ✅ La légende est sauvegardée
- ✅ La légende s'affiche sous l'image dans la galerie
- ✅ La légende apparaît dans les exports PDF

---

### Test 3.7 - Lightbox pour Visualisation

**Objectif**: Vérifier que la lightbox fonctionne pour visualiser les images en grand.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des images dans la galerie

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Cliquer sur une image
3. Observer la lightbox
4. Utiliser les flèches gauche/droite pour naviguer
5. Fermer la lightbox

**Résultats Attendus**:
- ✅ Lightbox s'ouvre avec l'image en grand format
- ✅ Navigation entre images avec flèches clavier ou boutons
- ✅ Légende complète affichée dans la lightbox
- ✅ Fermeture possible (clic extérieur, ESC, bouton fermer)

---

### Test 3.8 - Suppression d'Image de la Galerie

**Objectif**: Vérifier qu'on peut retirer une image de la galerie sans la supprimer définitivement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des images dans la galerie

**Étapes**:
1. Accéder à la section galerie d'une activité
2. Noter qu'une image est principale
3. Retirer une image de la galerie (pas l'image principale)
4. Observer que l'image disparaît de la galerie
5. Vérifier que l'image existe toujours dans la bibliothèque
6. Retirer l'image principale
7. Observer qu'une autre image devient principale automatiquement

**Résultats Attendus**:
- ✅ Bouton "Retirer de la galerie" disponible
- ✅ L'image est retirée de la galerie (association supprimée)
- ✅ L'image reste dans la bibliothèque (pas supprimée)
- ✅ Si l'image principale est retirée, la première image restante devient principale

---

## User Story 4 - Génération de PDF Professionnels

**Menu**: RSO → Formateur → Activités → [Sélectionner une activité] → Exporter en PDF  
**URL**: `/rso/formateur/activites/[id]/export` ou bouton "Exporter en PDF"

### Test 4.1 - Export PDF Basique (Options par Défaut)

**Objectif**: Vérifier que l'export PDF basique fonctionne avec les options par défaut.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité complète avec contenu, images, recommandations

**Étapes**:
1. Accéder à la page de détail d'une activité
2. Cliquer sur "Exporter en PDF"
3. Observer les options d'export (ou utiliser les valeurs par défaut)
4. Cliquer sur "Générer le PDF"
5. Observer l'indicateur de progression
6. Télécharger le PDF généré

**Résultats Attendus**:
- ✅ Modal d'options d'export s'ouvre (ou export direct avec défauts)
- ✅ Options disponibles:
  - Format de page: A4 (par défaut)
  - Orientation: Portrait (par défaut)
  - Inclure images: Oui (par défaut)
  - Inclure recommandations: Oui (par défaut)
  - Filigrane: Non (par défaut)
- ✅ Indicateur de progression affiché
- ✅ PDF généré en moins de 5 secondes (pour activité normale)
- ✅ Téléchargement automatique du PDF
- ✅ Nom de fichier: `RAPPORT_[CODE_ACTIVITE]_[DATE].pdf`

---

### Test 4.2 - Export PDF avec Page de Couverture

**Objectif**: Vérifier que le PDF contient une page de couverture professionnelle.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité complète

**Étapes**:
1. Exporter une activité en PDF
2. Ouvrir le PDF généré
3. Examiner la page de couverture

**Résultats Attendus**:
- ✅ Page de couverture présente avec:
  - Logo de l'organisation
  - Titre de l'activité
  - Type d'activité
  - Installation
  - Date
  - Métadonnées clés (code, statut, etc.)

---

### Test 4.3 - Export PDF avec Contenu Formaté

**Objectif**: Vérifier que le contenu HTML est correctement converti en PDF.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec contenu riche (titres, paragraphes, listes, tableaux)

**Étapes**:
1. Exporter une activité avec contenu riche en PDF
2. Ouvrir le PDF généré
3. Examiner le contenu

**Résultats Attendus**:
- ✅ Mise en forme préservée:
  - Titres (H1-H4) avec styles appropriés
  - Paragraphes correctement formatés
  - Listes à puces et numérotées
  - Tableaux avec bordures et couleurs
- ✅ Images incluses avec leurs légendes
- ✅ Contenu lisible et professionnel

---

### Test 4.4 - Export PDF avec Galerie d'Images

**Objectif**: Vérifier que la galerie d'images est incluse dans le PDF.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec au moins 8 images dans la galerie

**Étapes**:
1. Exporter une activité avec galerie d'images en PDF (option "Inclure images" activée)
2. Ouvrir le PDF généré
3. Examiner la section galerie

**Résultats Attendus**:
- ✅ Section galerie d'images présente
- ✅ Images organisées en grille professionnelle (2 images par page)
- ✅ Légendes affichées sous chaque image
- ✅ Images réparties sur plusieurs pages si nécessaire
- ✅ Qualité d'image appropriée pour impression

---

### Test 4.5 - Export PDF avec Recommandations

**Objectif**: Vérifier que les recommandations sont incluses dans le PDF.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec au moins 3 recommandations

**Étapes**:
1. Exporter une activité avec recommandations en PDF (option "Inclure recommandations" activée)
2. Ouvrir le PDF généré
3. Examiner la section recommandations

**Résultats Attendus**:
- ✅ Section recommandations présente
- ✅ Toutes les recommandations listées
- ✅ Priorités affichées avec codes couleur
- ✅ Statuts affichés
- ✅ Échéances affichées

---

### Test 4.6 - Export PDF avec En-têtes et Pieds de Page

**Objectif**: Vérifier que les en-têtes et pieds de page sont présents.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité

**Étapes**:
1. Exporter une activité en PDF
2. Ouvrir le PDF généré
3. Examiner les en-têtes et pieds de page sur chaque page

**Résultats Attendus**:
- ✅ En-tête sur chaque page:
  - Code d'activité
  - Titre (tronqué si trop long)
- ✅ Pied de page sur chaque page:
  - Numérotation "Page X sur Y"
  - Nom de l'organisation
  - Mention "Document confidentiel"

---

### Test 4.7 - Export PDF avec Filigrane

**Objectif**: Vérifier que le filigrane optionnel fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité

**Étapes**:
1. Exporter une activité en PDF avec option "Filigrane" activée
2. Ouvrir le PDF généré
3. Examiner le filigrane sur chaque page

**Résultats Attendus**:
- ✅ Filigrane "CONFIDENTIEL" présent sur chaque page
- ✅ Filigrane en transparence (diagonal)
- ✅ Filigrane ne gêne pas la lecture du contenu

---

### Test 4.8 - Export PDF avec Options Personnalisées

**Objectif**: Vérifier que toutes les options personnalisables fonctionnent.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité complète

**Étapes**:
1. Exporter une activité en PDF avec options:
   - Format: Letter
   - Orientation: Paysage
   - Inclure images: Non
   - Inclure recommandations: Non
   - Filigrane: Oui
2. Ouvrir le PDF généré
3. Vérifier que les options sont respectées

**Résultats Attendus**:
- ✅ Format Letter respecté
- ✅ Orientation paysage respectée
- ✅ Images non incluses (si option désactivée)
- ✅ Recommandations non incluses (si option désactivée)
- ✅ Filigrane présent (si option activée)

---

### Test 4.9 - Export PDF pour Agent PFSO

**Objectif**: Vérifier que les agents PFSO peuvent exporter en PDF.

**Prérequis**:
- Être connecté en tant qu'Agent PFSO
- Avoir accès à une activité

**Étapes**:
1. Se connecter en tant qu'Agent PFSO
2. Accéder à une activité accessible
3. Cliquer sur "Exporter en PDF"
4. Générer le PDF

**Résultats Attendus**:
- ✅ L'agent PFSO peut exporter en PDF
- ✅ Le PDF est généré avec les mêmes options (ou options limitées)
- ✅ Le PDF contient les informations appropriées

---

### Test 4.10 - Gestion des Erreurs d'Export PDF

**Objectif**: Vérifier que les erreurs d'export sont gérées correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité très volumineuse (ou simuler une erreur)

**Étapes**:
1. Tenter d'exporter une activité très volumineuse (>50 pages)
2. Observer la gestion de l'erreur ou du timeout

**Résultats Attendus**:
- ✅ Si timeout: Message d'erreur clair
- ✅ Proposition de génération asynchrone ou division en plusieurs PDF
- ✅ Interface reste utilisable

---

## User Story 5 - Export Multi-formats (Word, Excel)

**Menu**: RSO → Formateur → Activités → [Sélectionner une activité] → Exporter  
**URL**: `/rso/formateur/activites/[id]/export`

### Test 5.1 - Export Word (DOCX) d'une Activité

**Objectif**: Vérifier que l'export Word fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité complète avec contenu, images, tableaux

**Étapes**:
1. Accéder à la page de détail d'une activité
2. Cliquer sur "Exporter" → "Exporter en Word (DOCX)"
3. Sélectionner les options (inclure images, inclure recommandations)
4. Générer le document Word
5. Télécharger le fichier DOCX
6. Ouvrir le fichier dans Microsoft Word ou LibreOffice

**Résultats Attendus**:
- ✅ Fichier DOCX généré
- ✅ Nom de fichier: `ACTIVITE_[CODE]_[DATE].docx`
- ✅ Document s'ouvre correctement dans Word/LibreOffice
- ✅ Structure préservée:
  - Titres (H1-H4)
  - Paragraphes
  - Listes (puces/numérotées)
  - Tableaux avec formatage
- ✅ Images incluses avec légendes (si option activée)
- ✅ Recommandations incluses (si option activée)
- ✅ Document éditable

---

### Test 5.2 - Export Excel (XLSX) d'une Liste d'Activités

**Objectif**: Vérifier que l'export Excel d'une liste d'activités fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir au moins 10 activités dans le système

**Étapes**:
1. Accéder à la liste des activités
2. Appliquer des filtres (optionnel): Installation, Type, Année, Statut
3. Cliquer sur "Exporter" → "Exporter en Excel (XLSX)"
4. Télécharger le fichier XLSX
5. Ouvrir le fichier dans Microsoft Excel ou LibreOffice

**Résultats Attendus**:
- ✅ Fichier XLSX généré
- ✅ Nom de fichier: `LISTE_ACTIVITES_[YEAR].xlsx`
- ✅ Fichier s'ouvre correctement dans Excel/LibreOffice
- ✅ Tableau avec une ligne par activité
- ✅ Colonnes pour tous les champs pertinents:
  - Code
  - Titre
  - Type
  - Sous-type
  - Installation
  - Date
  - Durée
  - Participants
  - Statut
- ✅ Si filtres appliqués: Seules les activités filtrées sont incluses
- ✅ Données triables/filtrables dans Excel

---

### Test 5.3 - Export Excel avec Filtres Appliqués

**Objectif**: Vérifier que les filtres sont respectés dans l'export Excel.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec différents critères

**Étapes**:
1. Accéder à la liste des activités
2. Appliquer des filtres:
   - Installation: "Port de commerce"
   - Type: "Entraînement"
   - Année: 2024
   - Statut: "Terminé"
3. Exporter en Excel
4. Ouvrir le fichier Excel
5. Vérifier que seules les activités filtrées sont présentes

**Résultats Attendus**:
- ✅ Seules les activités correspondant aux filtres sont exportées
- ✅ Les filtres appliqués sont documentés (en-tête ou feuille séparée)
- ✅ Le nombre d'activités exportées correspond au nombre filtré

---

### Test 5.4 - Validation des Formats Word et Excel

**Objectif**: Vérifier que les fichiers générés sont valides et compatibles.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités

**Étapes**:
1. Exporter une activité en Word
2. Vérifier que le fichier s'ouvre dans:
   - Microsoft Word
   - LibreOffice Writer
3. Exporter une liste en Excel
4. Vérifier que le fichier s'ouvre dans:
   - Microsoft Excel
   - LibreOffice Calc

**Résultats Attendus**:
- ✅ Fichier Word s'ouvre dans Word et LibreOffice
- ✅ Fichier Excel s'ouvre dans Excel et LibreOffice
- ✅ Aucune erreur de format
- ✅ Contenu lisible et éditable

---

## User Story 6 - Gestion des Quotas et Limitations

**Menu Formateur**: RSO → Formateur → Médias (tableau de bord quota)  
**Menu Admin**: RSO → Admin → Quotas  
**URL Formateur**: `/rso/formateur/medias`  
**URL Admin**: `/rso/admin/quotas`

### Test 6.1 - Affichage du Tableau de Bord de Quota (Formateur)

**Objectif**: Vérifier que le tableau de bord de quota s'affiche correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir uploadé des médias

**Étapes**:
1. Accéder à "RSO → Formateur → Médias"
2. Observer le tableau de bord de quota

**Résultats Attendus**:
- ✅ Affichage du quota:
  - Total: 1000 MB (ou valeur configurée)
  - Utilisé: X MB (calculé)
  - Disponible: Y MB
  - Pourcentage: Z%
- ✅ Barre de progression visuelle
- ✅ Répartition par type:
  - Images: X MB (Y fichiers)
  - Vidéos: X MB (Y fichiers)
  - Documents: X MB (Y fichiers)
- ✅ Statistiques:
  - Évolution dans le temps (graphique si disponible)
  - Taille moyenne des fichiers
  - Activités les plus consommatrices

---

### Test 6.2 - Avertissement Quota > 80%

**Objectif**: Vérifier que l'avertissement s'affiche quand le quota approche de la limite.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un quota utilisé > 80% (ou simuler)

**Étapes**:
1. Accéder au tableau de bord de quota
2. Si quota > 80%, observer l'avertissement

**Résultats Attendus**:
- ✅ Avertissement visuel (couleur orange/rouge)
- ✅ Message: "Vous approchez de la limite de votre quota (X%)"
- ✅ Suggestions:
  - Supprimer des médias inutilisés
  - Contacter l'administrateur pour augmentation

---

### Test 6.3 - Blocage Upload si Quota Dépassé

**Objectif**: Vérifier que l'upload est bloqué si le quota serait dépassé.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir un quota presque saturé (ex: 950 MB / 1000 MB)

**Étapes**:
1. Vérifier le quota actuel (proche de la limite)
2. Tenter d'uploader un fichier de 100 MB
3. Observer le message d'erreur

**Résultats Attendus**:
- ✅ Upload bloqué AVANT le transfert
- ✅ Message d'erreur clair:
  - "Quota insuffisant"
  - "Espace disponible: X MB"
  - "Espace nécessaire: Y MB"
- ✅ Aucun transfert effectué
- ✅ Quota non modifié

---

### Test 6.4 - Mise à Jour Quota après Suppression

**Objectif**: Vérifier que le quota est mis à jour après suppression de médias.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des médias à supprimer

**Étapes**:
1. Noter le quota actuel (ex: 850 MB / 1000 MB)
2. Supprimer un média de 50 MB
3. Observer la mise à jour du quota

**Résultats Attendus**:
- ✅ Quota mis à jour immédiatement
- ✅ Nouveau quota: 800 MB / 1000 MB
- ✅ Barre de progression mise à jour
- ✅ Pourcentage recalculé

---

### Test 6.5 - Liste des Quotas (Admin)

**Objectif**: Vérifier que l'admin peut consulter tous les quotas.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir plusieurs utilisateurs avec quotas

**Étapes**:
1. Accéder à "RSO → Admin → Quotas"
2. Observer la liste des quotas

**Résultats Attendus**:
- ✅ Liste de tous les utilisateurs avec leurs quotas
- ✅ Colonnes affichées:
  - Utilisateur (nom, email)
  - Quota total (MB)
  - Quota utilisé (MB)
  - Quota disponible (MB)
  - Pourcentage utilisé
  - Nombre de fichiers (total, images, vidéos, documents)
- ✅ Pagination si nécessaire
- ✅ Recherche par nom/email disponible

---

### Test 6.6 - Modification de Quota par Admin

**Objectif**: Vérifier que l'admin peut modifier le quota d'un utilisateur.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un utilisateur avec quota

**Étapes**:
1. Accéder à "RSO → Admin → Quotas"
2. Cliquer sur "Modifier" pour un utilisateur
3. Changer le quota total de 1000 MB à 2000 MB
4. Sauvegarder
5. Vérifier que le quota est mis à jour
6. Se connecter en tant que l'utilisateur modifié
7. Vérifier que le nouveau quota est visible

**Résultats Attendus**:
- ✅ Formulaire de modification disponible
- ✅ Quota total modifiable
- ✅ Limites par type modifiables (optionnel)
- ✅ Quota mis à jour immédiatement
- ✅ Utilisateur notifié du changement (si fonctionnalité disponible)
- ✅ Nouveau quota visible dans le tableau de bord de l'utilisateur

---

### Test 6.7 - Recalcul de Quota (Admin)

**Objectif**: Vérifier que l'admin peut recalculer le quota d'un utilisateur.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un utilisateur avec quota potentiellement incorrect

**Étapes**:
1. Accéder à "RSO → Admin → Quotas"
2. Cliquer sur "Recalculer" pour un utilisateur
3. Confirmer le recalcul
4. Observer que le quota est recalculé

**Résultats Attendus**:
- ✅ Bouton "Recalculer" disponible
- ✅ Confirmation demandée
- ✅ Quota recalculé à partir des fichiers réels
- ✅ Mise à jour immédiate
- ✅ Message de succès affiché

---

### Test 6.8 - Statistiques de Quota

**Objectif**: Vérifier que les statistiques de quota sont affichées.

**Prérequis**:
- Être connecté en tant que Formateur RSO ou Administrateur

**Étapes**:
1. Accéder au tableau de bord de quota
2. Observer les statistiques disponibles

**Résultats Attendus**:
- ✅ Évolution de l'utilisation dans le temps (graphique)
- ✅ Répartition par type de média (graphique)
- ✅ Taille moyenne des fichiers
- ✅ Activités les plus consommatrices d'espace
- ✅ Statistiques détaillées disponibles

---

## User Story 7 - Impression Optimisée

**Menu**: RSO → Formateur → Activités → [Sélectionner une activité] → Imprimer  
**URL**: `/rso/formateur/activites/[id]` (bouton Imprimer)

### Test 7.1 - Impression Basique

**Objectif**: Vérifier que l'impression fonctionne avec mise en page optimisée.

**Prérequis**:
- Être connecté en tant que Formateur RSO ou Agent PFSO
- Avoir une activité complète

**Étapes**:
1. Accéder à la page de détail d'une activité
2. Cliquer sur "Imprimer"
3. Observer la prévisualisation d'impression
4. Configurer les options d'impression (orientation, marges)
5. Imprimer sur papier A4

**Résultats Attendus**:
- ✅ Boîte de dialogue d'impression du navigateur s'ouvre
- ✅ Prévisualisation optimisée affichée
- ✅ Éléments de navigation masqués (menus, boutons, barres latérales)
- ✅ Seul le contenu de l'activité visible
- ✅ Mise en page adaptée pour impression
- ✅ Impression correcte sur papier A4

---

### Test 7.2 - En-têtes et Pieds de Page d'Impression

**Objectif**: Vérifier que les en-têtes et pieds de page sont présents à l'impression.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité

**Étapes**:
1. Accéder à une activité
2. Cliquer sur "Imprimer"
3. Observer la prévisualisation
4. Examiner les en-têtes et pieds de page

**Résultats Attendus**:
- ✅ En-tête sur chaque page:
  - Code d'activité
  - Titre (tronqué si nécessaire)
- ✅ Pied de page sur chaque page:
  - Numérotation "Page X sur Y"
  - Nom de l'organisation

---

### Test 7.3 - Gestion des Sauts de Page

**Objectif**: Vérifier que les sauts de page évitent de couper le contenu.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec tableaux larges et images

**Étapes**:
1. Accéder à une activité avec tableaux et images
2. Cliquer sur "Imprimer"
3. Observer la prévisualisation
4. Vérifier que les tableaux ne sont pas coupés

**Résultats Attendus**:
- ✅ Tableaux ne sont pas coupés au milieu
- ✅ Images ne sont pas coupées
- ✅ Sauts de page appropriés
- ✅ Contenu bien formaté sur chaque page

---

### Test 7.4 - Optimisation des Images pour Impression

**Objectif**: Vérifier que les images sont optimisées pour l'impression.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec images

**Étapes**:
1. Accéder à une activité avec images
2. Cliquer sur "Imprimer"
3. Observer la prévisualisation des images
4. Imprimer et vérifier la qualité

**Résultats Attendus**:
- ✅ Images optimisées pour impression (résolution adaptée)
- ✅ Couleurs adaptées (si imprimante couleur disponible)
- ✅ Légendes préservées
- ✅ Qualité d'impression correcte

---

### Test 7.5 - Options d'Impression (Orientation, Marges)

**Objectif**: Vérifier que les options d'impression fonctionnent.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité

**Étapes**:
1. Accéder à une activité
2. Cliquer sur "Imprimer"
3. Configurer:
   - Orientation: Paysage
   - Marges: Réduites
4. Observer la prévisualisation
5. Changer pour Portrait
6. Observer la prévisualisation

**Résultats Attendus**:
- ✅ Orientation paysage respectée
- ✅ Marges configurées respectées
- ✅ Orientation portrait respectée
- ✅ Mise en page s'adapte aux options

---

### Test 7.6 - Compatibilité Multi-navigateurs

**Objectif**: Vérifier que l'impression fonctionne sur différents navigateurs.

**Prérequis**:
- Avoir accès à différents navigateurs (Chrome, Firefox, Safari, Edge)

**Étapes**:
1. Tester l'impression sur Chrome
2. Tester l'impression sur Firefox
3. Tester l'impression sur Safari (si disponible)
4. Tester l'impression sur Edge

**Résultats Attendus**:
- ✅ Impression fonctionne sur tous les navigateurs testés
- ✅ Mise en page cohérente entre navigateurs
- ✅ Aucune erreur d'affichage

---

## Workflow de Test Complet

### Workflow 1 - Cycle Complet de Gestion des Médias

**Objectif**: Tester un cycle complet depuis l'upload jusqu'à l'export.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité existante

**Étapes**:
1. **Upload de Médias**
   - Accéder à une activité
   - Uploader 5 images, 2 vidéos, 3 documents
   - Vérifier que tous sont traités correctement

2. **Organisation dans la Bibliothèque**
   - Accéder à la bibliothèque de médias
   - Filtrer par type "Images"
   - Rechercher un média spécifique
   - Modifier la légende d'une image

3. **Gestion de la Galerie**
   - Retourner à l'activité
   - Organiser les images dans la galerie
   - Définir une image principale
   - Ajouter des légendes

4. **Export PDF**
   - Exporter l'activité en PDF avec toutes les options
   - Vérifier que le PDF contient:
     - Page de couverture
     - Contenu formaté
     - Galerie d'images
     - Recommandations
     - En-têtes/pieds de page

5. **Export Word**
   - Exporter l'activité en Word
   - Ouvrir dans Word et vérifier la structure

6. **Gestion du Quota**
   - Vérifier le quota utilisé
   - Supprimer un média inutile
   - Vérifier que le quota est mis à jour

7. **Impression**
   - Imprimer l'activité
   - Vérifier la mise en page optimisée

**Résultats Attendus**:
- ✅ Toutes les étapes fonctionnent correctement
- ✅ Les médias sont cohérents entre les différentes vues
- ✅ Les exports contiennent toutes les informations
- ✅ Le quota est géré correctement

---

### Workflow 2 - Test Administrateur (Gestion des Quotas)

**Objectif**: Tester la gestion des quotas par l'administrateur.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir plusieurs utilisateurs avec médias

**Étapes**:
1. **Consultation des Quotas**
   - Accéder à "RSO → Admin → Quotas"
   - Observer la liste de tous les quotas
   - Utiliser la recherche pour trouver un utilisateur spécifique

2. **Modification de Quota**
   - Identifier un utilisateur avec quota proche de la limite
   - Augmenter son quota de 1000 MB à 2000 MB
   - Vérifier que le quota est mis à jour

3. **Recalcul de Quota**
   - Identifier un utilisateur avec quota potentiellement incorrect
   - Recalculer son quota
   - Vérifier que le quota est recalculé correctement

4. **Vérification Utilisateur**
   - Se connecter en tant que l'utilisateur modifié
   - Vérifier que le nouveau quota est visible
   - Tester qu'un upload précédemment bloqué fonctionne maintenant

**Résultats Attendus**:
- ✅ L'admin peut consulter tous les quotas
- ✅ L'admin peut modifier les quotas
- ✅ L'admin peut recalculer les quotas
- ✅ Les modifications sont visibles par les utilisateurs
- ✅ Les utilisateurs peuvent utiliser leur nouveau quota

---

### Workflow 3 - Test Agent PFSO (Export et Impression)

**Objectif**: Tester les fonctionnalités d'export et d'impression pour les agents PFSO.

**Prérequis**:
- Être connecté en tant qu'Agent PFSO
- Avoir accès à des activités

**Étapes**:
1. **Consultation d'Activité**
   - Accéder à une activité accessible
   - Observer le contenu et la galerie d'images

2. **Export PDF**
   - Exporter l'activité en PDF
   - Vérifier que le PDF est généré correctement
   - Ouvrir le PDF et vérifier le contenu

3. **Impression**
   - Imprimer l'activité
   - Vérifier la mise en page optimisée
   - Imprimer sur papier A4

**Résultats Attendus**:
- ✅ L'agent PFSO peut consulter les activités
- ✅ L'agent PFSO peut exporter en PDF
- ✅ L'agent PFSO peut imprimer
- ✅ Les fonctionnalités fonctionnent correctement

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Core
- [ ] Upload d'images fonctionne (compression, vignettes)
- [ ] Upload de vidéos fonctionne (métadonnées, vignettes)
- [ ] Upload de documents fonctionne
- [ ] Validation des types de fichiers fonctionne
- [ ] Validation des tailles de fichiers fonctionne
- [ ] Blocage par quota fonctionne
- [ ] Bibliothèque de médias fonctionne
- [ ] Filtrage et recherche fonctionnent
- [ ] Modification de légendes fonctionne
- [ ] Suppression de médias fonctionne (soft delete)
- [ ] Galeries d'images fonctionnent
- [ ] Réorganisation d'images fonctionne
- [ ] Image principale fonctionne
- [ ] Export PDF fonctionne
- [ ] Export Word fonctionne
- [ ] Export Excel fonctionne
- [ ] Gestion des quotas fonctionne
- [ ] Impression optimisée fonctionne

### Sécurité
- [ ] Types de fichiers non autorisés sont rejetés
- [ ] Tailles de fichiers sont validées
- [ ] Quota est vérifié avant upload
- [ ] Permissions sont respectées
- [ ] Fichiers sont stockés de manière sécurisée

### Performance
- [ ] Upload de 10 fichiers simultanés fonctionne
- [ ] Compression d'images < 2 secondes par image
- [ ] Génération PDF < 5 secondes (activité normale)
- [ ] Recherche < 1 seconde (bibliothèque < 1000 fichiers)
- [ ] Mise à jour quota < 1 seconde

### Interface Utilisateur
- [ ] Barres de progression fonctionnent
- [ ] Messages d'erreur sont clairs
- [ ] Vues grille et liste fonctionnent
- [ ] Prévisualisation fonctionne
- [ ] Lightbox fonctionne
- [ ] Responsive design fonctionne

### Compatibilité
- [ ] PDF s'ouvre dans Adobe Reader
- [ ] PDF s'ouvre dans Chrome PDF viewer
- [ ] Word s'ouvre dans Microsoft Word
- [ ] Word s'ouvre dans LibreOffice
- [ ] Excel s'ouvre dans Microsoft Excel
- [ ] Excel s'ouvre dans LibreOffice
- [ ] Impression fonctionne sur Chrome
- [ ] Impression fonctionne sur Firefox
- [ ] Impression fonctionne sur Safari
- [ ] Impression fonctionne sur Edge

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

