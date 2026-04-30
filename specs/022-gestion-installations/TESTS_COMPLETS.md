# Scénarios de Test Complets - 022 Gestion des Installations RSO-PFSO

**Date de création**: 2025-01-27  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module de gestion des installations RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Administrateur Gère les Installations](#user-story-1---administrateur-gère-les-installations)
3. [User Story 2 - Formateur RSO Crée et Gère ses Installations](#user-story-2---formateur-rso-crée-et-gère-ses-installations)
4. [User Story 3 - Système Gère les Années](#user-story-3---système-gère-les-années)
5. [User Story 4 - Administrateur Associe Agents PFSO aux Installations](#user-story-4---administrateur-associe-agents-pfso-aux-installations)
6. [User Story 5 - Administrateur Gère les Responsables d'Installation](#user-story-5---administrateur-gère-les-responsables-dinstallation)
7. [User Story 6 - Statistiques par Installation](#user-story-6---statistiques-par-installation)
8. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Installations Prédéfinies (19 installations)

Les 19 installations suivantes sont pré-chargées dans le système :

#### Installations d'Abidjan (PAD_*)
1. **Port de commerce** - Code: `PAD_COM` - Type: `port_commerce`
2. **Abidjan Terminal** - Code: `PAD_ABT` - Type: `terminal_conteneurs`
3. **Terminal Freetier** - Code: `PAD_FRT` - Type: `terminal_conteneurs`
4. **Port Terminal à Pêche** - Code: `PAD_PTP` - Type: `port_commerce`
5. **Côte d'Ivoire Terminal** - Code: `PAD_CIT` - Type: `terminal_conteneurs`
6. **Terminal Mineranier** - Code: `PAD_MIN` - Type: `terminal_mineranier`
7. **Pétro Sea Logistique** - Code: `PAD_PSL` - Type: `terminal_petrolier`
8. **Carena** - Code: `PAD_CAR` - Type: `terminal_petrolier`
9. **Yara** - Code: `PAD_YAR` - Type: `terminal_petrolier`
10. **SIAP** - Code: `PAD_SIA` - Type: `terminal_petrolier`
11. **Terra** - Code: `PAD_TER` - Type: `terminal_petrolier`
12. **Solevo** - Code: `PAD_SOL` - Type: `terminal_petrolier`
13. **Oil and Gas** - Code: `PAD_OGS` - Type: `terminal_petrolier`
14. **Pétroci Soute** - Code: `PAD_PTS` - Type: `terminal_petrolier`
15. **Pétroci Appontement** - Code: `PAD_PTA` - Type: `terminal_petrolier`
16. **Puma Énergie** - Code: `PAD_PUM` - Type: `terminal_petrolier`

#### Installations de San-Pedro (PSP_*)
17. **Port de San-Pedro** - Code: `PSP_COM` - Type: `port_commerce`
18. **Plateforme Shore Bélier** - Code: `PSP_SHB` - Type: `terminal_petrolier`
19. **Terminal à Compteur de San-Pedro** - Code: `PSP_TAC` - Type: `terminal_petrolier`

### Données pour Création d'Installation

#### Installation de Test - Abidjan
```json
{
  "nomPort": "Terminal Test Abidjan",
  "codeInstallation": "PAD_TEST",
  "typeInstallation": "terminal_conteneurs",
  "ville": "Abidjan",
  "statut": "actif",
  "adresse": "Boulevard de la République, Abidjan",
  "contactNom": "Jean KOUAME",
  "contactTelephone": "+2250788990100",
  "contactEmail": "contact@test-terminal.ci",
  "commentaire": "Installation de test pour validation"
}
```

#### Installation de Test - San-Pedro
```json
{
  "nomPort": "Terminal Test San-Pedro",
  "codeInstallation": "PSP_TEST",
  "typeInstallation": "terminal_petrolier",
  "ville": "San-Pedro",
  "statut": "actif",
  "adresse": "Port de San-Pedro",
  "contactNom": "Marie YAO",
  "contactTelephone": "+2250788990101",
  "contactEmail": "contact@test-sanpedro.ci",
  "commentaire": null
}
```

### Données pour Tests de Validation

#### Code Installation Invalide
- Trop court: `AB` (moins de 3 caractères)
- Trop long: `CODE_INSTALLATION_TRES_LONG` (plus de 20 caractères)
- Caractères spéciaux: `PAD-TEST` (tirets non autorisés)
- Caractères minuscules: `pad_test` (doit être en majuscules)
- Caractères spéciaux: `PAD@TEST` (caractères non autorisés)

#### Code Installation Valide
- `PAD_TEST`
- `PSP_NEW`
- `TEST_123`
- `ABIDJAN_TERMINAL`

#### Nom Installation Invalide
- Trop court: `AB` (moins de 3 caractères)
- Trop long: (plus de 150 caractères)

#### Téléphone Invalide
- Format incorrect: `0788990100` (manque +225)
- Format incorrect: `+225 78 89 90 100` (espaces non autorisés)
- Trop court: `+2250788990` (moins de 10 chiffres)
- Trop long: `+22507889901000` (plus de 10 chiffres)

#### Téléphone Valide
- `+2250788990100`
- `+2250123456789`

#### Email Invalide
- Format invalide: `email-invalide`
- Format invalide: `test@`

#### Types d'Installation Valides
- `port_commerce`
- `terminal_conteneurs`
- `terminal_petrolier`
- `terminal_mineranier`
- `autre`

#### Villes Valides
- `Abidjan`
- `San-Pedro`

#### Statuts Valides
- `actif`
- `inactif`
- `en_maintenance`

### Données pour Responsables d'Installation

#### PFSO Principal
```json
{
  "userId": 3,
  "typeResponsable": "pfso_principal",
  "dateDebut": "2024-01-01",
  "dateFin": null
}
```

#### PFSO Adjoint
```json
{
  "userId": 4,
  "typeResponsable": "pfso_adjoint",
  "dateDebut": "2024-01-01",
  "dateFin": null
}
```

#### RSO Référent
```json
{
  "userId": 2,
  "typeResponsable": "rso_referent",
  "dateDebut": "2024-01-01",
  "dateFin": "2024-12-31"
}
```

### Types de Responsables
- `pfso_principal` - PFSO Principal (un seul actif par installation)
- `pfso_adjoint` - PFSO Adjoint (plusieurs possibles)
- `rso_referent` - RSO Référent (plusieurs possibles)

---

## 🏢 User Story 1 - Administrateur Gère les Installations

**Menu**: `/rso/admin/installations`  
**Page**: Tableau de bord Admin → **Gestion Installations**

### Test 1.1 - Accès à la Page de Gestion des Installations

**Prérequis**: Être connecté en tant qu'administrateur (`admin_rso`)

**Étapes**:
1. Se connecter avec `admin_rso` / `Test1234!`
2. Accéder au menu **Gestion Installations** (`/rso/admin/installations`)

**Résultat Attendu**:
- ✅ La page affiche la liste des installations
- ✅ Les 19 installations prédéfinies sont visibles
- ✅ Tableau avec colonnes: Code, Nom, Type, Ville, Statut, Actions
- ✅ Pagination visible (20 installations par page par défaut)
- ✅ Filtres visibles: Recherche, Ville, Type, Statut
- ✅ Boutons d'export: Excel, PDF
- ✅ Bouton **Créer une installation**

---

### Test 1.2 - Affichage des 19 Installations Prédéfinies

**Menu**: `/rso/admin/installations`

**Étapes**:
1. Accéder à la page de gestion des installations
2. Vérifier la liste complète

**Résultat Attendu**:
- ✅ Les 19 installations sont affichées
- ✅ 16 installations d'Abidjan (codes PAD_*)
- ✅ 3 installations de San-Pedro (codes PSP_*)
- ✅ Informations correctes: nom, code, type, ville, statut
- ✅ Statut par défaut: `actif` pour toutes

---

### Test 1.3 - Création d'une Nouvelle Installation

**Menu**: `/rso/admin/installations` → Bouton **Créer une installation**

**Étapes**:
1. Cliquer sur **Créer une installation** ou **Nouveau**
2. Remplir le formulaire avec les données suivantes:
   - **Nom du port**: `Terminal Test Abidjan`
   - **Code installation**: `PAD_TEST`
   - **Type installation**: `terminal_conteneurs`
   - **Ville**: `Abidjan`
   - **Statut**: `actif`
   - **Adresse**: `Boulevard de la République, Abidjan` (optionnel)
   - **Contact - Nom**: `Jean KOUAME` (optionnel)
   - **Contact - Téléphone**: `+2250788990100` (optionnel)
   - **Contact - Email**: `contact@test-terminal.ci` (optionnel)
   - **Commentaire**: `Installation de test` (optionnel)
3. Cliquer sur **Créer** ou **Enregistrer**

**Résultat Attendu**:
- ✅ Message de succès: "Installation créée avec succès"
- ✅ Redirection vers la liste des installations
- ✅ Nouvelle installation visible dans la liste
- ✅ Code unique validé
- ✅ Entrée dans les journaux d'activité: `create_installation`
- ✅ `created_by` rempli avec l'ID de l'administrateur

---

### Test 1.4 - Validation Code Installation en Temps Réel

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Dans le champ **Code installation**, saisir: `PAD_COM` (déjà existant)
3. Attendre 1-2 secondes après avoir arrêté de taper

**Résultat Attendu**:
- ✅ Message d'erreur en temps réel: "Ce code d'installation est déjà utilisé"
- ✅ Le bouton de soumission est désactivé
- ✅ Indicateur visuel (icône d'erreur)

**Tests Additionnels**:
- Saisir un code valide et disponible: `PAD_NEW`
- ✅ Message de validation: "Code disponible" (ou pas d'erreur)
- Saisir un code invalide: `pad-test` (minuscules et tiret)
- ✅ Erreur: "Le code doit contenir uniquement des majuscules, chiffres et underscores"

---

### Test 1.5 - Validation Format Code Installation

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Tester différents codes dans le champ **Code installation**:

**Cas de Test**:
- `AB` (trop court, moins de 3 caractères)
  - ✅ Erreur: "Le code doit contenir entre 3 et 20 caractères"
- `CODE_INSTALLATION_TRES_LONG` (trop long, plus de 20 caractères)
  - ✅ Erreur: "Le code doit contenir entre 3 et 20 caractères"
- `PAD-TEST` (tirets non autorisés)
  - ✅ Erreur: "Le code doit contenir uniquement des majuscules, chiffres et underscores"
- `pad_test` (minuscules)
  - ✅ Erreur: "Le code doit être en majuscules"
- `PAD@TEST` (caractères spéciaux)
  - ✅ Erreur: "Caractères non autorisés"
- `PAD_TEST` (valide)
  - ✅ Pas d'erreur

---

### Test 1.6 - Validation Nom Installation

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Tester différents noms dans le champ **Nom du port**:

**Cas de Test**:
- `AB` (trop court)
  - ✅ Erreur: "Le nom doit contenir entre 3 et 150 caractères"
- Nom très long (plus de 150 caractères)
  - ✅ Erreur: "Le nom ne peut pas dépasser 150 caractères"
- `Terminal Test` (valide)
  - ✅ Pas d'erreur

---

### Test 1.7 - Validation Téléphone Contact

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Tester différents téléphones dans le champ **Contact - Téléphone**:

**Cas de Test**:
- `0788990100` (manque +225)
  - ✅ Erreur: "Le format doit être +225 suivi de 10 chiffres"
- `+225 78 89 90 100` (espaces)
  - ✅ Erreur: "Le format doit être +225 suivi de 10 chiffres"
- `+2250788990` (trop court)
  - ✅ Erreur: "Le numéro doit contenir 10 chiffres après +225"
- `+22507889901000` (trop long)
  - ✅ Erreur: "Le numéro doit contenir 10 chiffres après +225"
- `+2250788990100` (valide)
  - ✅ Pas d'erreur

---

### Test 1.8 - Validation Email Contact

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Tester différents emails dans le champ **Contact - Email**:

**Cas de Test**:
- `email-invalide` (format invalide)
  - ✅ Erreur: "Format d'email invalide"
- `test@` (format invalide)
  - ✅ Erreur: "Format d'email invalide"
- `contact@test.ci` (valide)
  - ✅ Pas d'erreur

---

### Test 1.9 - Modification d'une Installation

**Menu**: `/rso/admin/installations` → Cliquer sur **Modifier** pour une installation

**Étapes**:
1. Dans la liste, cliquer sur **Modifier** (icône crayon) pour une installation
2. Modifier les champs suivants:
   - **Nom du port**: Modifier le nom
   - **Statut**: Changer de `actif` à `inactif`
   - **Contact - Téléphone**: Modifier le numéro
   - **Commentaire**: Ajouter un commentaire
3. Cliquer sur **Enregistrer**

**Résultat Attendu**:
- ✅ Message de succès: "Installation modifiée avec succès"
- ✅ Redirection vers la liste
- ✅ Modifications visibles dans la liste
- ✅ `updated_at` mis à jour
- ✅ Entrée dans les journaux: `update_installation`

---

### Test 1.10 - Consultation Détails d'une Installation

**Menu**: `/rso/admin/installations` → Cliquer sur une installation

**Étapes**:
1. Dans la liste, cliquer sur une installation pour voir les détails
2. Vérifier l'affichage de la modal ou page de détails

**Résultat Attendu**:
- ✅ Modal/page de détails s'ouvre
- ✅ Toutes les informations affichées:
  - Informations générales (nom, code, type, ville, statut)
  - Coordonnées (adresse, contact)
  - Responsables (section visible, peut être vide)
  - Statistiques (section visible, peut être vide)
  - Informations système (créé par, dates)
- ✅ Boutons **Modifier** et **Supprimer** visibles (pour admin)

---

### Test 1.11 - Suppression (Archivage) d'une Installation

**Menu**: `/rso/admin/installations` → Détails installation → **Supprimer**

**Prérequis**: Installation sans agents PFSO assignés

**Étapes**:
1. Ouvrir les détails d'une installation
2. Cliquer sur **Supprimer**
3. Une modal de confirmation apparaît
4. Confirmer la suppression

**Résultat Attendu**:
- ✅ Modal de confirmation: "Êtes-vous sûr de vouloir archiver cette installation ?"
- ✅ Après confirmation: Message de succès
- ✅ Installation retirée de la liste principale
- ✅ `deleted_at` rempli dans la base de données
- ✅ Installation visible dans les archives
- ✅ Entrée dans les journaux: `delete_installation`

---

### Test 1.12 - Tentative de Suppression avec Agents PFSO Assignés

**Menu**: `/rso/admin/installations` → Détails installation → **Supprimer**

**Prérequis**: Installation avec au moins un agent PFSO assigné

**Étapes**:
1. Assigner un agent PFSO à une installation (voir Test 4.2)
2. Essayer de supprimer cette installation

**Résultat Attendu**:
- ✅ Message d'erreur: "Impossible de supprimer cette installation car elle a des agents PFSO assignés. Veuillez réassigner les agents d'abord."
- ✅ La suppression est bloquée
- ✅ L'installation reste active

---

### Test 1.13 - Consultation des Archives

**Menu**: `/rso/admin/installations/archives`

**Prérequis**: Avoir au moins une installation archivée

**Étapes**:
1. Accéder à la page **Archives** (`/rso/admin/installations/archives`)
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Liste des installations archivées affichée
- ✅ Colonnes: Code, Nom, Type, Ville, Date d'archivage
- ✅ Boutons **Restaurer** et **Supprimer définitivement** visibles

---

### Test 1.14 - Restauration d'une Installation Archivée

**Menu**: `/rso/admin/installations/archives` → **Restaurer**

**Prérequis**: Avoir une installation archivée

**Étapes**:
1. Accéder aux archives
2. Cliquer sur **Restaurer** pour une installation archivée
3. Confirmer l'action

**Résultat Attendu**:
- ✅ Message de succès: "Installation restaurée avec succès"
- ✅ Installation retirée des archives
- ✅ Installation visible dans la liste principale
- ✅ `deleted_at` remis à NULL
- ✅ Entrée dans les journaux: `restore_installation`

**Test de Validation Code**:
- Si le code existe toujours (même installation), la restauration fonctionne
- Si un autre installation a le même code, erreur: "Un code similaire existe déjà"

---

### Test 1.15 - Recherche d'Installations

**Menu**: `/rso/admin/installations` → Champ de recherche

**Étapes**:
1. Dans le champ de recherche, saisir: `PAD_COM`
2. Attendre les résultats

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les installations dont le nom ou code contient "PAD_COM"
- ✅ Résultat: Port de commerce (PAD_COM)

**Tests Additionnels**:
- Recherche par nom: `Terminal`
- ✅ Tous les terminaux affichés
- Recherche par code partiel: `PAD_`
- ✅ Toutes les installations d'Abidjan
- Recherche vide
- ✅ Affiche toutes les installations

---

### Test 1.16 - Filtrage par Ville

**Menu**: `/rso/admin/installations` → Filtre Ville

**Étapes**:
1. Cliquer sur le filtre **Ville**
2. Sélectionner `Abidjan`
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les installations d'Abidjan
- ✅ 16 installations affichées
- ✅ Compteur mis à jour

**Tests Additionnels**:
- Filtrer par `San-Pedro`
- ✅ 3 installations affichées

---

### Test 1.17 - Filtrage par Type

**Menu**: `/rso/admin/installations` → Filtre Type

**Étapes**:
1. Cliquer sur le filtre **Type**
2. Sélectionner `terminal_petrolier`
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les terminaux pétroliers
- ✅ Compteur mis à jour

---

### Test 1.18 - Filtrage par Statut

**Menu**: `/rso/admin/installations` → Filtre Statut

**Étapes**:
1. Cliquer sur le filtre **Statut**
2. Sélectionner `inactif`
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les installations inactives

---

### Test 1.19 - Filtres Combinés

**Menu**: `/rso/admin/installations` → Filtres multiples

**Étapes**:
1. Appliquer plusieurs filtres simultanément:
   - Ville: `Abidjan`
   - Type: `terminal_petrolier`
   - Statut: `actif`
2. Appliquer les filtres

**Résultat Attendu**:
- ✅ Liste filtrée selon tous les critères
- ✅ Seules les installations correspondant à tous les filtres sont affichées

---

### Test 1.20 - Réinitialisation des Filtres

**Menu**: `/rso/admin/installations` → Bouton **Réinitialiser**

**Étapes**:
1. Appliquer plusieurs filtres
2. Cliquer sur **Réinitialiser** ou **Effacer les filtres**

**Résultat Attendu**:
- ✅ Tous les filtres sont effacés
- ✅ Liste retourne à l'état par défaut (toutes les installations)
- ✅ Champ de recherche vidé

---

### Test 1.21 - Pagination

**Menu**: `/rso/admin/installations`

**Prérequis**: Avoir plus de 20 installations (créer des installations de test si nécessaire)

**Étapes**:
1. Vérifier que la pagination est visible en bas de la liste
2. Cliquer sur **Page suivante** (→)
3. Cliquer sur **Page précédente** (←)
4. Cliquer sur un numéro de page (ex: 2)

**Résultat Attendu**:
- ✅ Pagination affiche: "Page 1 sur X"
- ✅ Boutons précédent/suivant fonctionnent
- ✅ Navigation par numéro de page fonctionne
- ✅ 20 installations par page par défaut (configurable)

---

### Test 1.22 - Export Excel

**Menu**: `/rso/admin/installations` → Bouton **Exporter** → **Excel**

**Étapes**:
1. Appliquer des filtres si nécessaire
2. Cliquer sur **Exporter**
3. Sélectionner **Excel**
4. Télécharger le fichier

**Résultat Attendu**:
- ✅ Fichier Excel (.xlsx) téléchargé
- ✅ Nom: `installations_[DATE].xlsx`
- ✅ Contenu: Toutes les installations filtrées
- ✅ Colonnes: Code, Nom, Type, Ville, Statut, Adresse, Contact, etc.
- ✅ Formatage approprié (en-têtes, colonnes)

**Test avec Filtres**:
- Appliquer des filtres avant l'export
- ✅ Seules les installations filtrées sont exportées

---

### Test 1.23 - Export PDF

**Menu**: `/rso/admin/installations` → Bouton **Exporter** → **PDF**

**Étapes**:
1. Appliquer des filtres si nécessaire
2. Cliquer sur **Exporter**
3. Sélectionner **PDF**
4. Télécharger le fichier

**Résultat Attendu**:
- ✅ Fichier PDF téléchargé
- ✅ Nom: `installations_[DATE].pdf`
- ✅ Contenu: Liste formatée des installations
- ✅ Mise en page professionnelle
- ✅ Toutes les informations principales

---

### Test 1.24 - Changement de Statut depuis la Liste

**Menu**: `/rso/admin/installations` → Menu Actions → Changer statut

**Étapes**:
1. Dans la liste, trouver une installation avec statut `actif`
2. Cliquer sur le menu **Actions** ou le badge de statut
3. Sélectionner un nouveau statut (ex: `en_maintenance`)
4. Confirmer

**Résultat Attendu**:
- ✅ Statut mis à jour immédiatement dans la liste
- ✅ Badge de statut mis à jour (couleur change)
- ✅ Message de confirmation
- ✅ Entrée dans les journaux: `update_installation`

---

### Test 1.25 - Génération Automatique de Code

**Menu**: `/rso/admin/installations` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Remplir le **Nom du port**: `Terminal Nouveau Abidjan`
3. Sélectionner **Ville**: `Abidjan`
4. Laisser le champ **Code installation** vide ou cliquer sur **Générer automatiquement**

**Résultat Attendu**:
- ✅ Code généré automatiquement (ex: `PAD_TERMINAL_NOUVEAU` ou similaire)
- ✅ Code unique (vérifié automatiquement)
- ✅ Si le code existe, un suffixe est ajouté (ex: `PAD_TERMINAL_NOUVEAU_1`)

---

## 👨‍🏫 User Story 2 - Formateur RSO Crée et Gère ses Installations

**Menu**: `/rso/formateur/installations`  
**Page**: Dashboard Formateur → **Mes Installations**

### Test 2.1 - Accès à la Page des Installations (Formateur)

**Prérequis**: Être connecté en tant que formateur (`formateur_rso1`)

**Étapes**:
1. Se connecter avec `formateur_rso1` / `Test1234!`
2. Accéder au menu **Mes Installations** ou `/rso/formateur/installations`

**Résultat Attendu**:
- ✅ Page affiche la liste de toutes les installations
- ✅ Indicateur visuel pour les installations créées par le formateur (badge, icône, ou couleur différente)
- ✅ Bouton **Créer une installation** visible

---

### Test 2.2 - Création d'Installation par Formateur

**Menu**: `/rso/formateur/installations` → **Créer une installation**

**Étapes**:
1. Cliquer sur **Créer une installation**
2. Remplir le formulaire:
   - **Nom du port**: `Terminal Formateur Test`
   - **Code installation**: `PAD_FORM`
   - **Type installation**: `terminal_conteneurs`
   - **Ville**: `Abidjan`
   - **Statut**: `actif`
   - Autres champs optionnels
3. Cliquer sur **Créer**

**Résultat Attendu**:
- ✅ Message de succès: "Installation créée avec succès"
- ✅ Installation visible dans la liste avec indicateur "Créée par moi"
- ✅ `created_by` rempli avec l'ID du formateur
- ✅ Entrée dans les journaux: `create_installation`

---

### Test 2.3 - Modification d'Installation Créée par le Formateur

**Menu**: `/rso/formateur/installations` → Modifier (installation créée par le formateur)

**Étapes**:
1. Dans la liste, trouver une installation créée par le formateur (avec indicateur)
2. Cliquer sur **Modifier**
3. Modifier des informations (nom, statut, contact)
4. Enregistrer

**Résultat Attendu**:
- ✅ Modifications enregistrées avec succès
- ✅ Message de confirmation
- ✅ Entrée dans les journaux: `update_installation`

---

### Test 2.4 - Tentative de Modification d'Installation Créée par Autrui

**Menu**: `/rso/formateur/installations` → Modifier (installation créée par admin)

**Étapes**:
1. Dans la liste, trouver une installation créée par un autre utilisateur (sans indicateur "Créée par moi")
2. Cliquer sur **Modifier**
3. Essayer de modifier des informations

**Résultat Attendu**:
- ✅ Message d'erreur: "Vous ne pouvez modifier que les installations que vous avez créées"
- ✅ Ou formulaire en lecture seule (champs désactivés)
- ✅ Les modifications ne peuvent pas être sauvegardées

---

### Test 2.5 - Absence de Bouton Supprimer pour Formateur

**Menu**: `/rso/formateur/installations` → Détails installation

**Étapes**:
1. Ouvrir les détails d'une installation (même créée par le formateur)
2. Vérifier les boutons disponibles

**Résultat Attendu**:
- ✅ Bouton **Modifier** visible (si créée par le formateur)
- ✅ **Aucun bouton Supprimer** visible
- ✅ Seul l'administrateur peut supprimer

---

### Test 2.6 - Consultation de Toutes les Installations

**Menu**: `/rso/formateur/installations`

**Étapes**:
1. Accéder à la page des installations
2. Vérifier la liste

**Résultat Attendu**:
- ✅ Toutes les installations sont visibles (pas seulement celles créées par le formateur)
- ✅ Indicateur visuel pour distinguer les siennes
- ✅ Filtres et recherche fonctionnent normalement

---

## 📅 User Story 3 - Système Gère les Années

**Menu**: Sélecteur d'années global (en-tête) et `/rso/admin/annees`  
**Page**: Sélecteur d'années + Gestion des années (admin)

### Test 3.1 - Affichage du Sélecteur d'Années

**Prérequis**: Être connecté

**Étapes**:
1. Se connecter avec n'importe quel utilisateur
2. Vérifier la présence du sélecteur d'années dans l'en-tête

**Résultat Attendu**:
- ✅ Sélecteur d'années visible dans l'en-tête (dropdown)
- ✅ Année actuelle sélectionnée par défaut
- ✅ Année actuelle mise en évidence (badge, couleur)

---

### Test 3.2 - Liste des Années Disponibles

**Menu**: Sélecteur d'années → Ouvrir le dropdown

**Étapes**:
1. Cliquer sur le sélecteur d'années
2. Vérifier la liste

**Résultat Attendu**:
- ✅ Toutes les années de 2004 à l'année courante sont listées
- ✅ Années ordonnées de la plus récente à la plus ancienne (ou inversement)
- ✅ Année active mise en évidence
- ✅ Années archivées affichées différemment

---

### Test 3.3 - Sélection d'une Année

**Menu**: Sélecteur d'années

**Étapes**:
1. Cliquer sur le sélecteur d'années
2. Sélectionner une année différente (ex: 2023)
3. Vérifier la persistance

**Résultat Attendu**:
- ✅ Année sélectionnée mise à jour dans le sélecteur
- ✅ Année sauvegardée en session (sessionStorage ou localStorage)
- ✅ Toutes les données dépendantes de l'année sont filtrées (statistiques, etc.)
- ✅ L'année reste sélectionnée lors de la navigation entre pages

---

### Test 3.4 - Persistance de l'Année Sélectionnée

**Menu**: Navigation entre pages

**Étapes**:
1. Sélectionner une année (ex: 2023)
2. Naviguer vers une autre page (ex: `/rso/admin/dashboard`)
3. Revenir à la page précédente
4. Vérifier l'année sélectionnée

**Résultat Attendu**:
- ✅ L'année sélectionnée (2023) est toujours active
- ✅ Les données sont toujours filtrées par cette année
- ✅ Le sélecteur affiche toujours 2023

---

### Test 3.5 - Accès à la Gestion des Années (Admin)

**Menu**: `/rso/admin/annees`

**Prérequis**: Être connecté en tant qu'administrateur

**Étapes**:
1. Se connecter avec `admin_rso`
2. Accéder à `/rso/admin/annees`

**Résultat Attendu**:
- ✅ Page de gestion des années s'affiche
- ✅ Liste de toutes les années (2004 à année courante)
- ✅ Colonnes: Année, Statut, Date de création
- ✅ Année active mise en évidence

---

### Test 3.6 - Modification du Statut d'une Année (Admin)

**Menu**: `/rso/admin/annees` → Modifier statut

**Étapes**:
1. Dans la liste des années, trouver une année archivée
2. Cliquer sur **Modifier** ou changer le statut
3. Changer le statut de `archive` à `active`
4. Confirmer

**Résultat Attendu**:
- ✅ Statut mis à jour
- ✅ L'année précédemment active devient `archive`
- ✅ Seule une année peut être `active` à la fois
- ✅ Message de confirmation

---

### Test 3.7 - Ajout Manuel d'une Année (Admin)

**Menu**: `/rso/admin/annees` → **Ajouter une année**

**Étapes**:
1. Cliquer sur **Ajouter une année**
2. Saisir une année (ex: 2025)
3. Sélectionner le statut
4. Enregistrer

**Résultat Attendu**:
- ✅ Année créée avec succès
- ✅ Validation: année entre 2004 et 2100
- ✅ Validation: année unique (pas de doublon)
- ✅ Année visible dans la liste

---

### Test 3.8 - Incrémentation Automatique des Années

**Note**: Ce test nécessite de simuler le 1er janvier ou de déclencher manuellement la tâche

**Étapes**:
1. Vérifier l'année actuelle dans la base de données
2. Simuler le passage au 1er janvier (ou déclencher manuellement la tâche)
3. Vérifier les résultats

**Résultat Attendu**:
- ✅ L'année précédente est archivée (statut: `archive`)
- ✅ La nouvelle année est ajoutée avec statut `active`
- ✅ Tâche automatique exécutée (cron: `0 1 1 1 *`)
- ✅ Log enregistré pour l'opération

**Test Manuel**:
- Appeler l'endpoint `/api/v1/rso/annees/increment` (admin seulement)
- ✅ Même résultat que l'incrémentation automatique

---

### Test 3.9 - Filtrage des Données par Année

**Menu**: N'importe quelle page avec données dépendantes de l'année

**Étapes**:
1. Sélectionner l'année 2023 dans le sélecteur
2. Accéder à la page des statistiques (`/rso/admin/installations/dashboard`)
3. Vérifier les statistiques affichées

**Résultat Attendu**:
- ✅ Toutes les statistiques sont filtrées par l'année 2023
- ✅ Les données affichées correspondent à 2023
- ✅ Changer l'année met à jour automatiquement les statistiques

---

## 👥 User Story 4 - Administrateur Associe Agents PFSO aux Installations

**Menu**: `/rso/admin/users` (modification du formulaire de création utilisateur)  
**Page**: Gestion Utilisateurs → Créer/Modifier Agent PFSO

### Test 4.1 - Assignation Installation lors de Création Agent PFSO

**Menu**: `/rso/admin/users` → **Créer un utilisateur** → Rôle: `agent_pfso`

**Étapes**:
1. Accéder au formulaire de création d'utilisateur
2. Sélectionner le rôle: `agent_pfso`
3. Vérifier l'apparition du champ **Installation**
4. Remplir le formulaire:
   - **Username**: `pfso_test`
   - **Nom**: `Test`
   - **Prénoms**: `PFSO`
   - **Email**: `pfso.test@aspci.rso`
   - **Téléphone**: `+2250788990200`
   - **Mot de passe**: `PfsoTest@2024!`
   - **Rôle**: `agent_pfso`
   - **Installation**: Sélectionner une installation (ex: "Port de commerce - PAD_COM")
5. Créer l'utilisateur

**Résultat Attendu**:
- ✅ Champ **Installation** visible et obligatoire pour `agent_pfso`
- ✅ Dropdown avec liste des installations actives
- ✅ Installation assignée avec succès
- ✅ `installation_id` rempli dans la base de données
- ✅ Utilisateur créé

---

### Test 4.2 - Validation Installation Obligatoire pour Agent PFSO

**Menu**: `/rso/admin/users` → Formulaire de création → Rôle: `agent_pfso`

**Étapes**:
1. Ouvrir le formulaire de création
2. Sélectionner le rôle: `agent_pfso`
3. Remplir tous les champs sauf **Installation**
4. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "L'installation est obligatoire pour les agents PFSO"
- ✅ Le formulaire ne peut pas être soumis
- ✅ Champ **Installation** marqué comme requis

---

### Test 4.3 - Modification de l'Assignation Installation

**Menu**: `/rso/admin/users` → Modifier un agent PFSO

**Étapes**:
1. Dans la liste des utilisateurs, trouver un agent PFSO
2. Cliquer sur **Modifier**
3. Changer l'installation assignée (sélectionner une autre installation)
4. Enregistrer

**Résultat Attendu**:
- ✅ Modification enregistrée avec succès
- ✅ `installation_id` mis à jour dans la base de données
- ✅ L'agent perd l'accès à l'ancienne installation
- ✅ L'agent gagne l'accès à la nouvelle installation

---

### Test 4.4 - Restriction d'Accès Agent PFSO à son Installation

**Menu**: `/rso/pfso/consultation` (après connexion agent PFSO)

**Prérequis**: Agent PFSO assigné à une installation

**Étapes**:
1. Se connecter avec un agent PFSO (ex: `pfso_abidjan`)
2. Accéder à la page de consultation (`/rso/pfso/consultation`)
3. Vérifier les données affichées

**Résultat Attendu**:
- ✅ Seules les données de l'installation assignée sont visibles
- ✅ Filtre installation pré-rempli et désactivé
- ✅ Impossible d'accéder aux données d'autres installations

---

### Test 4.5 - Filtrage Agents PFSO par Installation

**Menu**: `/rso/admin/users` → Filtre Installation

**Étapes**:
1. Dans la liste des utilisateurs, utiliser le filtre **Installation**
2. Sélectionner une installation (ex: "Port de commerce")
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les agents PFSO de l'installation sélectionnée
- ✅ Compteur mis à jour

---

### Test 4.6 - Affichage Installation dans Liste Utilisateurs

**Menu**: `/rso/admin/users`

**Étapes**:
1. Accéder à la liste des utilisateurs
2. Vérifier la colonne **Installation** pour les agents PFSO

**Résultat Attendu**:
- ✅ Colonne **Installation** visible
- ✅ Nom de l'installation affiché pour chaque agent PFSO
- ✅ Pour les autres rôles, colonne vide ou "N/A"

---

## 👤 User Story 5 - Administrateur Gère les Responsables d'Installation

**Menu**: `/rso/admin/installations` → Détails installation → Section **Responsables**  
**Page**: Détails installation avec section responsables

### Test 5.1 - Accès à la Section Responsables

**Menu**: `/rso/admin/installations` → Détails installation

**Étapes**:
1. Ouvrir les détails d'une installation
2. Vérifier la section **Responsables**

**Résultat Attendu**:
- ✅ Section **Responsables** visible dans les détails
- ✅ Liste des responsables actuels affichée (peut être vide)
- ✅ Bouton **Ajouter un responsable** visible

---

### Test 5.2 - Consultation des Responsables Actuels

**Menu**: `/rso/admin/installations` → Détails installation → Section Responsables

**Prérequis**: Installation avec au moins un responsable assigné

**Étapes**:
1. Ouvrir les détails d'une installation avec des responsables
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Liste des responsables actifs affichée
- ✅ Informations pour chaque responsable:
  - Nom et prénom
  - Type (PFSO Principal, PFSO Adjoint, RSO Référent)
  - Date de début
  - Date de fin (si définie)
- ✅ Badges de type visibles

---

### Test 5.3 - Ajout d'un PFSO Principal

**Menu**: `/rso/admin/installations` → Détails installation → **Ajouter un responsable**

**Étapes**:
1. Cliquer sur **Ajouter un responsable**
2. Remplir le formulaire:
   - **Utilisateur**: Sélectionner un utilisateur (formateur ou agent PFSO)
   - **Type**: `pfso_principal`
   - **Date de début**: `2024-01-01`
   - **Date de fin**: Laisser vide (en cours)
3. Enregistrer

**Résultat Attendu**:
- ✅ Responsable créé avec succès
- ✅ Apparaît dans la liste des responsables actuels
- ✅ Type: PFSO Principal
- ✅ Statut: `actif`

---

### Test 5.4 - Validation: Un Seul PFSO Principal Actif

**Menu**: `/rso/admin/installations` → Détails installation → **Ajouter un responsable**

**Prérequis**: Installation avec déjà un PFSO Principal actif

**Étapes**:
1. Essayer d'ajouter un deuxième PFSO Principal
2. Remplir le formulaire avec type `pfso_principal`
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Une seule personne peut être PFSO Principal actif à la fois pour cette installation"
- ✅ Le formulaire ne peut pas être soumis
- ✅ Suggestion: Terminer l'assignation actuelle d'abord

---

### Test 5.5 - Ajout de Plusieurs PFSO Adjoints

**Menu**: `/rso/admin/installations` → Détails installation → **Ajouter un responsable**

**Étapes**:
1. Ajouter un premier PFSO Adjoint
2. Ajouter un deuxième PFSO Adjoint
3. Vérifier la liste

**Résultat Attendu**:
- ✅ Plusieurs PFSO Adjoints peuvent être actifs simultanément
- ✅ Tous apparaissent dans la liste
- ✅ Aucune erreur

---

### Test 5.6 - Ajout d'un RSO Référent

**Menu**: `/rso/admin/installations` → Détails installation → **Ajouter un responsable**

**Étapes**:
1. Cliquer sur **Ajouter un responsable**
2. Remplir le formulaire:
   - **Utilisateur**: Sélectionner un formateur RSO
   - **Type**: `rso_referent`
   - **Date de début**: `2024-01-01`
   - **Date de fin**: `2024-12-31` (optionnel)
3. Enregistrer

**Résultat Attendu**:
- ✅ RSO Référent créé avec succès
- ✅ Apparaît dans la liste
- ✅ Plusieurs RSO Référents peuvent être actifs simultanément

---

### Test 5.7 - Modification d'une Assignation de Responsable

**Menu**: `/rso/admin/installations` → Détails installation → Responsables → **Modifier**

**Étapes**:
1. Dans la liste des responsables, cliquer sur **Modifier** pour un responsable
2. Modifier:
   - **Type**: Changer le type (si autorisé)
   - **Date de début**: Modifier la date
   - **Date de fin**: Ajouter ou modifier
3. Enregistrer

**Résultat Attendu**:
- ✅ Modifications enregistrées
- ✅ Validation: date de fin >= date de début
- ✅ Si changement de type vers PFSO Principal, vérifier qu'il n'y en a pas déjà un actif

---

### Test 5.8 - Fin d'une Assignation (Retirer un Responsable)

**Menu**: `/rso/admin/installations` → Détails installation → Responsables → **Terminer**

**Étapes**:
1. Dans la liste des responsables, cliquer sur **Terminer** pour un responsable actif
2. Définir la date de fin (ex: date du jour)
3. Confirmer

**Résultat Attendu**:
- ✅ Date de fin définie
- ✅ Statut changé à `inactif`
- ✅ Responsable retiré de la liste des actifs
- ✅ Responsable reste dans l'historique

---

### Test 5.9 - Consultation de l'Historique Complet

**Menu**: `/rso/admin/installations` → Détails installation → Responsables → **Voir l'historique**

**Étapes**:
1. Cliquer sur **Voir l'historique** ou **Historique**
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Liste complète de tous les responsables (actifs et inactifs)
- ✅ Informations pour chaque entrée:
  - Nom et prénom
  - Type
  - Date de début
  - Date de fin
  - Statut (actif/inactif)
- ✅ Trié par date de début (plus récent en premier)

---

### Test 5.10 - Validation Dates (Date de Fin >= Date de Début)

**Menu**: `/rso/admin/installations` → Détails installation → **Ajouter un responsable**

**Étapes**:
1. Ouvrir le formulaire d'ajout
2. Remplir:
   - **Date de début**: `2024-12-31`
   - **Date de fin**: `2024-01-01` (antérieure à la date de début)
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "La date de fin doit être supérieure ou égale à la date de début"
- ✅ Le formulaire ne peut pas être soumis

---

## 📊 User Story 6 - Statistiques par Installation

**Menu**: `/rso/admin/installations/dashboard`  
**Page**: Dashboard Statistiques Installations

### Test 6.1 - Accès au Dashboard Statistiques

**Prérequis**: Être connecté en tant qu'administrateur ou formateur

**Étapes**:
1. Se connecter avec `admin_rso`
2. Accéder au menu **Statistiques Installations** ou `/rso/admin/installations/dashboard`

**Résultat Attendu**:
- ✅ Dashboard des statistiques s'affiche
- ✅ Statistiques globales visibles
- ✅ Sélecteur d'installation pour statistiques détaillées
- ✅ Filtre année intégré (utilise l'année sélectionnée)

---

### Test 6.2 - Statistiques Globales

**Menu**: `/rso/admin/installations/dashboard`

**Étapes**:
1. Accéder au dashboard
2. Vérifier les statistiques globales

**Résultat Attendu**:
- ✅ Métriques principales affichées:
  - Nombre total d'installations
  - Installations actives
  - Installations inactives
  - Installations en maintenance
- ✅ Répartition par ville (graphique ou tableau):
  - Abidjan: X installations
  - San-Pedro: Y installations
- ✅ Répartition par type (graphique ou tableau):
  - Port de commerce: X
  - Terminal conteneurs: Y
  - Terminal pétrolier: Z
  - etc.

---

### Test 6.3 - Statistiques par Installation

**Menu**: `/rso/admin/installations/dashboard` → Sélectionner une installation

**Étapes**:
1. Dans le sélecteur d'installation, choisir une installation (ex: "Port de commerce")
2. Vérifier les statistiques affichées

**Résultat Attendu**:
- ✅ Statistiques détaillées pour l'installation sélectionnée:
  - Nombre d'activités (placeholder si Phase 3 pas encore implémentée)
  - Nombre d'incidents (placeholder si Phase 4 pas encore implémentée)
  - Date de dernière activité
  - Autres métriques pertinentes
- ✅ Statistiques filtrées par l'année sélectionnée

---

### Test 6.4 - Filtrage Statistiques par Année

**Menu**: `/rso/admin/installations/dashboard` → Changer l'année

**Étapes**:
1. Accéder au dashboard
2. Changer l'année dans le sélecteur global (ex: 2023)
3. Vérifier les statistiques

**Résultat Attendu**:
- ✅ Toutes les statistiques sont recalculées pour l'année 2023
- ✅ Statistiques globales mises à jour
- ✅ Statistiques par installation mises à jour
- ✅ Graphiques mis à jour

---

### Test 6.5 - Statistiques pour Formateur RSO

**Menu**: `/rso/formateur/installations` → Dashboard (si disponible)

**Prérequis**: Être connecté en tant que formateur

**Étapes**:
1. Se connecter avec `formateur_rso1`
2. Accéder au dashboard des statistiques (si disponible)

**Résultat Attendu**:
- ✅ Statistiques affichées uniquement pour les installations que le formateur peut gérer
- ✅ Mêmes fonctionnalités que pour l'admin mais avec restrictions
- ✅ Statistiques globales filtrées par installations accessibles

---

### Test 6.6 - Visualisations Graphiques

**Menu**: `/rso/admin/installations/dashboard`

**Étapes**:
1. Accéder au dashboard
2. Vérifier les graphiques

**Résultat Attendu**:
- ✅ Graphique de répartition par ville (camembert ou barres)
- ✅ Graphique de répartition par type (camembert ou barres)
- ✅ Graphiques interactifs (si bibliothèque le permet)
- ✅ Légendes et labels clairs

---

### Test 6.7 - Statistiques dans Détails Installation

**Menu**: `/rso/admin/installations` → Détails installation → Section Statistiques

**Étapes**:
1. Ouvrir les détails d'une installation
2. Vérifier la section **Statistiques**

**Résultat Attendu**:
- ✅ Section Statistiques visible
- ✅ Statistiques pour l'année sélectionnée
- ✅ Métriques: activités, incidents, dernière activité
- ✅ Mise à jour automatique lors du changement d'année

---

## 🔄 Workflow de Test Complet

### Workflow 1: Cycle de Vie Complet d'une Installation

**Objectif**: Tester toutes les fonctionnalités liées à une installation de bout en bout

**Étapes**:
1. **Création** (Admin)
   - Se connecter en tant qu'admin
   - Créer une nouvelle installation
   - Vérifier dans les journaux: `create_installation`

2. **Modification**
   - Modifier les informations de l'installation
   - Changer le statut
   - Vérifier dans les journaux: `update_installation`

3. **Assignation Responsables**
   - Ajouter un PFSO Principal
   - Ajouter un PFSO Adjoint
   - Vérifier l'historique

4. **Assignation Agent PFSO**
   - Créer un agent PFSO et l'assigner à l'installation
   - Vérifier l'accès restreint de l'agent

5. **Consultation Statistiques**
   - Consulter les statistiques de l'installation
   - Changer l'année et vérifier la mise à jour

6. **Archivage**
   - Archiver l'installation
   - Vérifier qu'elle n'apparaît plus dans la liste principale
   - Vérifier qu'elle apparaît dans les archives

7. **Restauration**
   - Restaurer l'installation depuis les archives
   - Vérifier qu'elle réapparaît dans la liste principale

---

### Workflow 2: Gestion Année et Filtrage

**Objectif**: Tester le système de gestion des années et son impact sur les données

**Étapes**:
1. **Sélection Année**
   - Sélectionner l'année 2023 dans le sélecteur
   - Naviguer entre différentes pages
   - Vérifier que l'année reste sélectionnée

2. **Statistiques par Année**
   - Accéder au dashboard statistiques
   - Vérifier que les données sont filtrées par 2023
   - Changer l'année à 2024
   - Vérifier que les statistiques se mettent à jour

3. **Gestion Années (Admin)**
   - Accéder à la gestion des années
   - Vérifier toutes les années (2004 à année courante)
   - Modifier le statut d'une année
   - Vérifier l'impact sur le sélecteur

---

### Workflow 3: Délégation Formateur → Installation

**Objectif**: Tester le workflow de création et gestion d'installations par un formateur

**Étapes**:
1. **Création par Formateur**
   - Se connecter en tant que formateur
   - Créer une nouvelle installation
   - Vérifier l'indicateur "Créée par moi"

2. **Modification par Formateur**
   - Modifier l'installation créée
   - Vérifier que les modifications sont sauvegardées

3. **Tentative Modification Autre Installation**
   - Essayer de modifier une installation créée par admin
   - Vérifier le refus d'accès

4. **Consultation Toutes Installations**
   - Vérifier que le formateur voit toutes les installations
   - Vérifier les indicateurs visuels

---

### Workflow 4: Assignation et Restrictions Agent PFSO

**Objectif**: Tester l'assignation d'agents PFSO et les restrictions d'accès

**Étapes**:
1. **Création Agent avec Installation**
   - Créer un agent PFSO et l'assigner à une installation
   - Vérifier l'assignation dans la base de données

2. **Connexion Agent**
   - Se connecter avec l'agent PFSO
   - Vérifier la redirection vers la page de consultation
   - Vérifier que seule son installation est visible

3. **Modification Assignation**
   - Se reconnecter en tant qu'admin
   - Modifier l'assignation de l'agent vers une autre installation
   - Vérifier que l'agent perd l'accès à l'ancienne installation

4. **Tentative Accès Autre Installation**
   - Se reconnecter avec l'agent
   - Essayer d'accéder aux données d'une autre installation
   - Vérifier le refus d'accès (403)

---

### Workflow 5: Gestion Complète des Responsables

**Objectif**: Tester toutes les fonctionnalités de gestion des responsables

**Étapes**:
1. **Ajout PFSO Principal**
   - Ajouter un PFSO Principal à une installation
   - Vérifier qu'il apparaît dans la liste

2. **Tentative Deuxième Principal**
   - Essayer d'ajouter un deuxième PFSO Principal
   - Vérifier le refus avec message d'erreur

3. **Ajout Adjoints et Référents**
   - Ajouter plusieurs PFSO Adjoints
   - Ajouter plusieurs RSO Référents
   - Vérifier que tous sont actifs simultanément

4. **Modification et Fin d'Assignation**
   - Modifier une assignation
   - Terminer une assignation
   - Vérifier l'historique complet

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Critiques (P1)
- [ ] Affichage des 19 installations prédéfinies
- [ ] Création d'installations par admin
- [ ] Modification d'installations
- [ ] Suppression (archivage) d'installations
- [ ] Restauration depuis archives
- [ ] Recherche et filtres (ville, type, statut)
- [ ] Export Excel et PDF
- [ ] Création d'installations par formateur
- [ ] Restrictions formateur (modification uniquement de ses installations)
- [ ] Sélecteur d'années global
- [ ] Persistance de l'année sélectionnée
- [ ] Gestion des années (admin)
- [ ] Incrémentation automatique des années

### Fonctionnalités Importantes (P2)
- [ ] Assignation installation lors création agent PFSO
- [ ] Modification assignation installation
- [ ] Restrictions d'accès agent PFSO
- [ ] Ajout responsables d'installation
- [ ] Validation un seul PFSO Principal actif
- [ ] Historique complet des responsables
- [ ] Statistiques globales
- [ ] Statistiques par installation
- [ ] Filtrage statistiques par année

### Validation et Sécurité
- [ ] Validation code installation (format, unicité)
- [ ] Validation nom installation
- [ ] Validation téléphone et email
- [ ] Protection contre suppression avec agents assignés
- [ ] Vérification permissions (formateur vs admin)
- [ ] Isolation tenant (RLS)
- [ ] Journalisation complète des actions

### Interface Utilisateur
- [ ] Responsive design
- [ ] Messages d'erreur clairs
- [ ] États de chargement
- [ ] Indicateurs visuels (installations créées par formateur)
- [ ] Graphiques et visualisations
- [ ] Accessibilité (ARIA)

---

## 📝 Notes de Test

### Environnement de Test
- **Backend**: `http://localhost:4000`
- **Frontend**: `http://localhost:3000`
- **Base de données**: PostgreSQL (vérifier la connexion)

### Prérequis
1. Exécuter les migrations Phase 2: `infra/scripts/migrations/0022_rso_phase2_installations.sql`
2. Exécuter le seed: `infra/scripts/migrations/0022_rso_phase2_seed.sql`
3. Démarrer les serveurs: `pnpm dev:api` et `pnpm dev:web`

### Données de Test
- 19 installations prédéfinies chargées automatiquement
- Années 2004 à année courante pré-chargées
- Utilisateurs de test: `admin_rso`, `formateur_rso1`, `pfso_abidjan`
- Tenant: ASPCI (slug: `aspci`)

### Points d'Attention
- Vérifier les journaux d'activité après chaque action importante
- Tester avec différents rôles pour vérifier les permissions
- Vérifier la base de données directement si nécessaire
- Les statistiques d'activités et d'incidents peuvent être des placeholders jusqu'à Phase 3 et 4

---

## 🐛 Problèmes Connus / À Vérifier

1. **Génération Code**: Vérifier que la génération automatique de code fonctionne correctement
2. **Export Asynchrone**: Pour de grandes listes, vérifier que l'export est asynchrone avec notification
3. **Incrémentation Année**: Tester manuellement l'incrémentation automatique (simuler le 1er janvier)
4. **Statistiques**: Certaines statistiques peuvent être des placeholders jusqu'à Phase 3/4

---

**Fin du Document de Test**
