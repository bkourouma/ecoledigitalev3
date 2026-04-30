# Scénarios de Test Complets - 021 Infrastructure Authentification RSO-PFSO

**Date de création**: 2024-12-19  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module d'authentification RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Gestion des Utilisateurs](#user-story-1---gestion-des-utilisateurs)
3. [User Story 2 - Authentification Sécurisée](#user-story-2---authentification-sécurisée)
4. [User Story 3 - Réinitialisation Mot de Passe](#user-story-3---réinitialisation-mot-de-passe)
5. [User Story 4 - Formateur Crée Agents PFSO](#user-story-4---formateur-crée-agents-pfso)
6. [User Story 5 - Agent PFSO Consultation](#user-story-5---agent-pfso-consultation)
7. [User Story 6 - Journalisation des Activités](#user-story-6---journalisation-des-activités)
8. [User Story 7 - Changement de Mot de Passe](#user-story-7---changement-de-mot-de-passe)
9. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Utilisateurs de Test (Créés par le script de seed)

| Username | Email | Mot de passe | Rôle | Statut |
|----------|-------|--------------|------|--------|
| `admin_rso` | `admin@aspci.rso` | `Test1234!` | administrateur | actif |
| `formateur_rso1` | `formateur@aspci.rso` | `Test1234!` | rso_formateur | actif |
| `pfso_abidjan` | `pfso.abidjan@aspci.rso` | `Test1234!` | agent_pfso | actif |
| `agent_surete1` | `agent.surete@aspci.rso` | `Test1234!` | agent_surete | actif |

### Données pour Création d'Utilisateurs

#### Formateur RSO
```json
{
  "username": "formateur_test",
  "nom": "Kouassi",
  "prenoms": "Jean",
  "email": "jean.kouassi@aspci.rso",
  "telephone": "+2250788990020",
  "password": "Formateur@2024!",
  "role": "rso_formateur",
  "statut": "actif"
}
```

#### Agent PFSO
```json
{
  "username": "pfso_sanpedro",
  "nom": "Yao",
  "prenoms": "Marie",
  "email": "marie.yao@aspci.rso",
  "telephone": "+2250788990021",
  "password": "Pfso@2024!",
  "role": "agent_pfso",
  "statut": "actif",
  "installationId": 1
}
```

#### Agent de Sûreté
```json
{
  "username": "agent_surete2",
  "nom": "Kone",
  "prenoms": "Paul",
  "email": "paul.kone@aspci.rso",
  "telephone": "+2250788990022",
  "password": "Surete@2024!",
  "role": "agent_surete",
  "statut": "actif"
}
```

### Données pour Tests de Validation

#### Username Invalide
- Trop court: `user` (moins de 5 caractères)
- Trop long: `username_trop_long_pour_validation` (plus de 20 caractères)
- Caractères spéciaux: `user@test` (caractères non autorisés)

#### Email Invalide
- Format invalide: `email-invalide`
- Format invalide: `test@`
- Format invalide: `@test.com`

#### Mot de Passe Invalide
- Trop court: `Pass1!` (moins de 8 caractères)
- Pas de majuscule: `password123!`
- Pas de minuscule: `PASSWORD123!`
- Pas de chiffre: `Password!`
- Pas de caractère spécial: `Password123`

#### Mot de Passe Valide
- `Test1234!`
- `Admin@2024!`
- `Formateur#2024`

---

## 👥 User Story 1 - Gestion des Utilisateurs

**Menu**: `/rso/admin/users`  
**Page**: Tableau de bord Admin → **Gestion Utilisateurs**

### Test 1.1 - Accès à la Page de Gestion des Utilisateurs

**Prérequis**: Être connecté en tant qu'administrateur (`admin_rso`)

**Étapes**:
1. Se connecter avec `admin_rso` / `Test1234!`
2. Accéder au menu **Gestion Utilisateurs** (`/rso/admin/users`)

**Résultat Attendu**:
- ✅ La page affiche la liste des utilisateurs
- ✅ Tableau avec colonnes: Username, Nom complet, Email, Téléphone, Rôle, Statut, Dernière connexion, Actions
- ✅ Pagination visible (20 utilisateurs par page)
- ✅ Filtres visibles: Rôle, Statut, Recherche

**Données à Vérifier**:
- Voir les 4 utilisateurs de test dans la liste
- Vérifier que les informations sont correctement affichées

---

### Test 1.2 - Création d'un Utilisateur Formateur RSO

**Menu**: `/rso/admin/users` → Bouton **Créer un utilisateur**

**Étapes**:
1. Cliquer sur le bouton **Créer un utilisateur** ou **Nouveau**
2. Remplir le formulaire avec les données suivantes:
   - **Username**: `formateur_test`
   - **Nom**: `Kouassi`
   - **Prénoms**: `Jean`
   - **Email**: `jean.kouassi@aspci.rso`
   - **Téléphone**: `+2250788990020`
   - **Mot de passe**: `Formateur@2024!`
   - **Confirmer mot de passe**: `Formateur@2024!`
   - **Rôle**: `rso_formateur`
   - **Statut**: `actif`
3. Cliquer sur **Créer** ou **Enregistrer**

**Résultat Attendu**:
- ✅ Message de succès: "Utilisateur créé avec succès"
- ✅ Email de bienvenue envoyé (vérifier les logs email)
- ✅ Redirection vers la liste des utilisateurs
- ✅ Nouvel utilisateur visible dans la liste
- ✅ Entrée dans les journaux d'activité: `create_user`

**Vérifications Supplémentaires**:
- Vérifier que le champ `created_by` est rempli avec l'ID de l'administrateur connecté
- Vérifier que le mot de passe est hashé (ne pas apparaître en clair dans la base)

---

### Test 1.3 - Création d'un Agent PFSO avec Installation

**Menu**: `/rso/admin/users` → Bouton **Créer un utilisateur**

**Prérequis**: Avoir au moins une installation créée (Phase 2) ou utiliser l'ID 1

**Étapes**:
1. Cliquer sur **Créer un utilisateur**
2. Remplir le formulaire:
   - **Username**: `pfso_sanpedro`
   - **Nom**: `Yao`
   - **Prénoms**: `Marie`
   - **Email**: `marie.yao@aspci.rso`
   - **Téléphone**: `+2250788990021`
   - **Mot de passe**: `Pfso@2024!`
   - **Confirmer mot de passe**: `Pfso@2024!`
   - **Rôle**: `agent_pfso`
   - **Statut**: `actif`
   - **Installation**: Sélectionner une installation (ex: "Port de San-Pedro")
3. Cliquer sur **Créer**

**Résultat Attendu**:
- ✅ Message de succès
- ✅ Utilisateur créé avec `installation_id` rempli
- ✅ Validation: le champ installation est obligatoire pour agent_pfso

**Test de Validation**:
- Essayer de créer un agent_pfso sans sélectionner d'installation
- ✅ Erreur: "L'installation est obligatoire pour les agents PFSO"

---

### Test 1.4 - Validation Username en Temps Réel

**Menu**: `/rso/admin/users` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Dans le champ **Username**, saisir: `admin_rso` (déjà existant)
3. Attendre 1-2 secondes après avoir arrêté de taper

**Résultat Attendu**:
- ✅ Message d'erreur en temps réel: "Ce nom d'utilisateur est déjà utilisé"
- ✅ Le bouton de soumission est désactivé

**Tests Additionnels**:
- Saisir un username valide et disponible: `nouveau_user`
- ✅ Message de validation: "Nom d'utilisateur disponible" (ou pas d'erreur)

---

### Test 1.5 - Validation Email en Temps Réel

**Menu**: `/rso/admin/users` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Dans le champ **Email**, saisir: `admin@aspci.rso` (déjà existant)
3. Attendre 1-2 secondes

**Résultat Attendu**:
- ✅ Message d'erreur: "Cet email est déjà utilisé"

**Tests Additionnels**:
- Email invalide: `email-invalide`
- ✅ Erreur: "Format d'email invalide"
- Email valide et disponible: `nouveau@aspci.rso`
- ✅ Pas d'erreur

---

### Test 1.6 - Validation Mot de Passe

**Menu**: `/rso/admin/users` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Tester différents mots de passe dans le champ **Mot de passe**:

**Cas de Test**:
- `Pass1!` (trop court)
  - ✅ Erreur: "Le mot de passe doit contenir au moins 8 caractères"
- `password123!` (pas de majuscule)
  - ✅ Erreur: "Le mot de passe doit contenir au moins une majuscule"
- `PASSWORD123!` (pas de minuscule)
  - ✅ Erreur: "Le mot de passe doit contenir au moins une minuscule"
- `Password!` (pas de chiffre)
  - ✅ Erreur: "Le mot de passe doit contenir au moins un chiffre"
- `Password123` (pas de caractère spécial)
  - ✅ Erreur: "Le mot de passe doit contenir au moins un caractère spécial"
- `Test1234!` (valide)
  - ✅ Pas d'erreur, indicateur de force du mot de passe

---

### Test 1.7 - Modification d'un Utilisateur

**Menu**: `/rso/admin/users` → Cliquer sur **Modifier** pour un utilisateur

**Étapes**:
1. Dans la liste des utilisateurs, cliquer sur **Modifier** (icône crayon) pour `formateur_rso1`
2. Modifier les champs suivants:
   - **Nom**: `Formateur` → `Formateur_Modifié`
   - **Prénoms**: `RSO Test` → `RSO Test Modifié`
   - **Téléphone**: `+2250788990012` → `+2250788990099`
   - **Email**: `formateur@aspci.rso` → `formateur.modifie@aspci.rso`
3. Cliquer sur **Enregistrer**

**Résultat Attendu**:
- ✅ Message de succès: "Utilisateur modifié avec succès"
- ✅ Redirection vers la liste
- ✅ Modifications visibles dans la liste
- ✅ Entrée dans les journaux: `update_user`

**Test de Validation Email**:
- Essayer de modifier l'email vers un email déjà utilisé
- ✅ Erreur: "Cet email est déjà utilisé"

---

### Test 1.8 - Changement de Statut Utilisateur (Activer/Désactiver)

**Menu**: `/rso/admin/users` → Toggle ou menu Actions

**Étapes**:
1. Dans la liste, trouver `pfso_abidjan` (statut: actif)
2. Cliquer sur le toggle de statut ou menu **Actions** → **Désactiver**
3. Confirmer l'action

**Résultat Attendu**:
- ✅ Statut change de `actif` à `inactif`
- ✅ Message de confirmation
- ✅ Entrée dans les journaux: `deactivate_user`

**Test de Conséquence**:
1. Se déconnecter
2. Essayer de se connecter avec `pfso_abidjan` / `Test1234!`
3. ✅ Erreur: "Votre compte est inactif. Veuillez contacter l'administrateur."

**Réactivation**:
1. Reconnecter en tant qu'admin
2. Réactiver le compte
3. ✅ Statut redevient `actif`
4. ✅ L'utilisateur peut à nouveau se connecter

---

### Test 1.9 - Suspension d'un Utilisateur

**Menu**: `/rso/admin/users` → Menu Actions → Suspendre

**Étapes**:
1. Dans la liste, trouver un utilisateur actif
2. Cliquer sur **Actions** → **Suspendre**
3. Confirmer l'action

**Résultat Attendu**:
- ✅ Statut change à `suspendu`
- ✅ Message de confirmation
- ✅ Entrée dans les journaux: `suspend_user`

**Test de Conséquence**:
1. Essayer de se connecter avec le compte suspendu
2. ✅ Erreur: "Votre compte est suspendu. Veuillez contacter l'administrateur."

---

### Test 1.10 - Suppression d'un Utilisateur

**Menu**: `/rso/admin/users` → Menu Actions → Supprimer

**Étapes**:
1. Dans la liste, trouver un utilisateur (créer un utilisateur de test si nécessaire)
2. Cliquer sur **Actions** → **Supprimer**
3. Une modal de confirmation apparaît
4. Confirmer la suppression

**Résultat Attendu**:
- ✅ Modal de confirmation avec message: "Êtes-vous sûr de vouloir supprimer cet utilisateur ?"
- ✅ Après confirmation: Message de succès
- ✅ Utilisateur retiré de la liste
- ✅ Entrée dans les journaux: `delete_user`

**Test de Sécurité**:
- Essayer de supprimer l'utilisateur actuellement connecté
- ✅ Erreur: "Vous ne pouvez pas supprimer votre propre compte"

---

### Test 1.11 - Recherche d'Utilisateurs

**Menu**: `/rso/admin/users` → Champ de recherche

**Étapes**:
1. Dans le champ de recherche, saisir: `admin`
2. Attendre les résultats

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les utilisateurs dont le nom, prénom ou email contient "admin"
- ✅ Résultats: `admin_rso`

**Tests Additionnels**:
- Recherche par email: `@aspci.rso`
- ✅ Tous les utilisateurs avec cet email
- Recherche par nom: `Kouassi`
- ✅ Utilisateurs avec ce nom
- Recherche vide
- ✅ Affiche tous les utilisateurs

---

### Test 1.12 - Filtrage par Rôle

**Menu**: `/rso/admin/users` → Filtre Rôle

**Étapes**:
1. Cliquer sur le filtre **Rôle**
2. Sélectionner `agent_pfso`
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les agents PFSO
- ✅ Compteur mis à jour: "X agents PFSO"

**Tests Additionnels**:
- Filtrer par `rso_formateur`
- ✅ Affiche uniquement les formateurs
- Filtrer par `administrateur`
- ✅ Affiche uniquement les administrateurs

---

### Test 1.13 - Filtrage par Statut

**Menu**: `/rso/admin/users` → Filtre Statut

**Étapes**:
1. Cliquer sur le filtre **Statut**
2. Sélectionner `inactif`
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les utilisateurs inactifs

---

### Test 1.14 - Pagination

**Menu**: `/rso/admin/users`

**Prérequis**: Avoir plus de 20 utilisateurs (créer des utilisateurs de test si nécessaire)

**Étapes**:
1. Vérifier que la pagination est visible en bas de la liste
2. Cliquer sur **Page suivante** (→)
3. Cliquer sur **Page précédente** (←)
4. Cliquer sur un numéro de page (ex: 2)

**Résultat Attendu**:
- ✅ Pagination affiche: "Page 1 sur X"
- ✅ Boutons précédent/suivant fonctionnent
- ✅ Navigation par numéro de page fonctionne
- ✅ 20 utilisateurs par page maximum

---

### Test 1.15 - Affichage Dernière Connexion

**Menu**: `/rso/admin/users` → Colonne "Dernière connexion"

**Étapes**:
1. Se connecter avec `formateur_rso1`
2. Se déconnecter
3. Se reconnecter en tant qu'admin
4. Vérifier la colonne "Dernière connexion" pour `formateur_rso1`

**Résultat Attendu**:
- ✅ Date et heure de la dernière connexion affichées
- ✅ Format: "DD/MM/YYYY HH:mm" ou format relatif "Il y a X minutes"

---

## 🔐 User Story 2 - Authentification Sécurisée

**Menu**: `/rso/login`  
**Page**: Page de connexion RSO

### Test 2.1 - Connexion avec Username

**Menu**: `/rso/login`

**Étapes**:
1. Accéder à `/rso/login`
2. Saisir:
   - **Identifiant**: `admin_rso`
   - **Mot de passe**: `Test1234!`
3. Cliquer sur **Se connecter**

**Résultat Attendu**:
- ✅ Connexion réussie
- ✅ Redirection vers `/rso/admin/dashboard`
- ✅ Token JWT stocké (localStorage ou cookie)
- ✅ Entrée dans les journaux: `login`
- ✅ `last_login` mis à jour dans la base de données

---

### Test 2.2 - Connexion avec Email

**Menu**: `/rso/login`

**Étapes**:
1. Accéder à `/rso/login`
2. Saisir:
   - **Identifiant**: `admin@aspci.rso`
   - **Mot de passe**: `Test1234!`
3. Cliquer sur **Se connecter**

**Résultat Attendu**:
- ✅ Connexion réussie (le système accepte email ou username)
- ✅ Redirection vers le dashboard approprié

---

### Test 2.3 - Connexion avec Identifiants Incorrects

**Menu**: `/rso/login`

**Étapes**:
1. Accéder à `/rso/login`
2. Saisir:
   - **Identifiant**: `admin_rso`
   - **Mot de passe**: `MauvaisMotDePasse123!`
3. Cliquer sur **Se connecter**

**Résultat Attendu**:
- ✅ Message d'erreur générique: "Identifiants incorrects" (ne révèle pas si c'est l'email ou le mot de passe)
- ✅ Pas de redirection
- ✅ Entrée dans les journaux: `login_failed`
- ✅ Compteur de tentatives échouées incrémenté

---

### Test 2.4 - Rate Limiting - 3 Tentatives Échouées (CAPTCHA)

**Menu**: `/rso/login`

**Étapes**:
1. Effectuer 3 tentatives de connexion avec un mot de passe incorrect
2. À la 4ème tentative, vérifier l'affichage

**Résultat Attendu**:
- ✅ Après 3 tentatives échouées, un CAPTCHA apparaît
- ✅ Le formulaire ne peut pas être soumis sans compléter le CAPTCHA
- ✅ Message: "Pour des raisons de sécurité, veuillez compléter le CAPTCHA"

**Test du CAPTCHA**:
- Compléter le CAPTCHA
- Réessayer la connexion avec les bons identifiants
- ✅ Connexion réussie

---

### Test 2.5 - Rate Limiting - 5 Tentatives Échouées (Blocage IP)

**Menu**: `/rso/login`

**Étapes**:
1. Effectuer 5 tentatives de connexion échouées en moins de 15 minutes
2. À la 6ème tentative, vérifier

**Résultat Attendu**:
- ✅ Message d'erreur: "Trop de tentatives échouées. Votre adresse IP est temporairement bloquée. Réessayez dans 15 minutes."
- ✅ Code HTTP: 429 (Too Many Requests)
- ✅ L'IP est bloquée pendant 15 minutes

**Test de Déblocage**:
- Attendre 15 minutes (ou modifier manuellement en base de données)
- Réessayer la connexion
- ✅ Le blocage est levé

---

### Test 2.6 - Connexion avec Compte Inactif

**Menu**: `/rso/login`

**Prérequis**: Avoir un utilisateur avec statut `inactif`

**Étapes**:
1. Désactiver un utilisateur (Test 1.8)
2. Se déconnecter
3. Essayer de se connecter avec cet utilisateur

**Résultat Attendu**:
- ✅ Message d'erreur: "Votre compte est inactif. Veuillez contacter l'administrateur."
- ✅ Pas de connexion
- ✅ Entrée dans les journaux: `login_failed` avec description appropriée

---

### Test 2.7 - Connexion avec Compte Suspendu

**Menu**: `/rso/login`

**Prérequis**: Avoir un utilisateur avec statut `suspendu`

**Étapes**:
1. Suspendre un utilisateur (Test 1.9)
2. Essayer de se connecter avec cet utilisateur

**Résultat Attendu**:
- ✅ Message d'erreur: "Votre compte est suspendu. Veuillez contacter l'administrateur."
- ✅ Pas de connexion

---

### Test 2.8 - "Se Souvenir de Moi" - Session 30 Jours

**Menu**: `/rso/login`

**Étapes**:
1. Accéder à `/rso/login`
2. Saisir les identifiants
3. **Cocher** la case "Se souvenir de moi"
4. Cliquer sur **Se connecter**

**Résultat Attendu**:
- ✅ Connexion réussie
- ✅ Token JWT avec expiration de 30 jours (au lieu de 8 heures)
- ✅ Vérifier dans les cookies/localStorage: `expiresAt` dans 30 jours

**Test de Persistance**:
1. Fermer le navigateur complètement
2. Rouvrir le navigateur
3. Accéder à `/rso/admin/dashboard`
4. ✅ L'utilisateur est toujours connecté (pas besoin de se reconnecter)

---

### Test 2.9 - Session Expiration (8 heures)

**Menu**: `/rso/login`

**Étapes**:
1. Se connecter **sans** cocher "Se souvenir de moi"
2. Vérifier l'expiration du token

**Résultat Attendu**:
- ✅ Token JWT avec expiration de 8 heures
- ✅ Après 8 heures (ou modification manuelle de l'expiration), l'utilisateur est déconnecté automatiquement
- ✅ Redirection vers `/rso/login`
- ✅ Message: "Votre session a expiré. Veuillez vous reconnecter."
- ✅ Entrée dans les journaux: `session_expired`

---

### Test 2.10 - Refresh Token Automatique

**Menu**: N'importe quelle page RSO (après connexion)

**Étapes**:
1. Se connecter
2. Attendre que le token soit proche de l'expiration (30 minutes avant)
3. Effectuer une action (ex: charger une page)

**Résultat Attendu**:
- ✅ Le token est automatiquement rafraîchi en arrière-plan
- ✅ Pas de déconnexion
- ✅ Nouveau token avec nouvelle expiration
- ✅ Entrée dans les journaux: `token_refreshed`

---

### Test 2.11 - Déconnexion

**Menu**: Menu utilisateur → **Déconnexion** ou `/rso/auth/logout`

**Étapes**:
1. Être connecté
2. Cliquer sur le menu utilisateur (en haut à droite)
3. Cliquer sur **Déconnexion**

**Résultat Attendu**:
- ✅ Déconnexion réussie
- ✅ Token invalidé
- ✅ Session marquée comme `logout` dans la base de données
- ✅ Redirection vers `/rso/login`
- ✅ Entrée dans les journaux: `logout`

---

### Test 2.12 - Redirection selon le Rôle

**Menu**: `/rso/login`

**Tests par Rôle**:

#### Administrateur
1. Se connecter avec `admin_rso` / `Test1234!`
2. ✅ Redirection vers `/rso/admin/dashboard`

#### Formateur RSO
1. Se connecter avec `formateur_rso1` / `Test1234!`
2. ✅ Redirection vers `/rso/formateur/dashboard`

#### Agent PFSO
1. Se connecter avec `pfso_abidjan` / `Test1234!`
2. ✅ Redirection vers `/rso/pfso/consultation`

#### Agent Sûreté
1. Se connecter avec `agent_surete1` / `Test1234!`
2. ✅ Redirection vers le dashboard approprié (selon implémentation)

---

### Test 2.13 - Protection des Routes Authentifiées

**Menu**: Accès direct à une route protégée sans être connecté

**Étapes**:
1. Se déconnecter (ou ouvrir une fenêtre privée)
2. Accéder directement à `/rso/admin/users`

**Résultat Attendu**:
- ✅ Redirection automatique vers `/rso/login`
- ✅ Message: "Vous devez être connecté pour accéder à cette page"

---

## 🔑 User Story 3 - Réinitialisation Mot de Passe

**Menu**: `/rso/forgot-password` et `/rso/reset-password/[token]`

### Test 3.1 - Demande de Réinitialisation

**Menu**: `/rso/forgot-password` (lien depuis la page de login)

**Étapes**:
1. Accéder à `/rso/forgot-password`
2. Saisir un email valide: `admin@aspci.rso`
3. Cliquer sur **Envoyer le lien de réinitialisation**

**Résultat Attendu**:
- ✅ Message de succès: "Si cet email existe, un lien de réinitialisation a été envoyé."
- ✅ **Important**: Le message est identique même si l'email n'existe pas (sécurité)
- ✅ Email envoyé avec le lien de réinitialisation (vérifier les logs email)
- ✅ Token de réinitialisation généré et stocké (hashé)
- ✅ Expiration du token: 1 heure
- ✅ Entrée dans les journaux: `password_reset_requested`

---

### Test 3.2 - Email de Réinitialisation

**Vérification**: Consulter les logs email ou la boîte de réception

**Contenu Attendu**:
- ✅ Sujet: "Réinitialisation de votre mot de passe RSO-PFSO"
- ✅ Lien de réinitialisation: `http://localhost:3000/rso/reset-password/[TOKEN]`
- ✅ Instructions claires
- ✅ Expiration mentionnée: "Ce lien est valide pendant 1 heure"

---

### Test 3.3 - Accès au Formulaire de Réinitialisation

**Menu**: `/rso/reset-password/[token]` (via le lien dans l'email)

**Étapes**:
1. Cliquer sur le lien dans l'email de réinitialisation
2. Vérifier l'affichage de la page

**Résultat Attendu**:
- ✅ Page de réinitialisation s'affiche
- ✅ Formulaire avec champs: Nouveau mot de passe, Confirmer mot de passe
- ✅ Le token est validé automatiquement au chargement de la page
- ✅ Si le token est invalide/expiré, message d'erreur affiché

---

### Test 3.4 - Réinitialisation avec Token Valide

**Menu**: `/rso/reset-password/[token]`

**Étapes**:
1. Accéder au formulaire avec un token valide
2. Saisir:
   - **Nouveau mot de passe**: `NouveauPass123!`
   - **Confirmer mot de passe**: `NouveauPass123!`
3. Cliquer sur **Réinitialiser le mot de passe**

**Résultat Attendu**:
- ✅ Message de succès: "Votre mot de passe a été réinitialisé avec succès"
- ✅ Redirection vers `/rso/login`
- ✅ Token invalidé (ne peut plus être utilisé)
- ✅ Mot de passe mis à jour dans la base de données (hashé)
- ✅ Entrée dans les journaux: `password_reset_completed`

**Test de Connexion**:
1. Se connecter avec le nouveau mot de passe
2. ✅ Connexion réussie

---

### Test 3.5 - Validation Mot de Passe dans Formulaire

**Menu**: `/rso/reset-password/[token]`

**Étapes**:
1. Accéder au formulaire
2. Tester différents mots de passe (voir Test 1.6 pour les règles)

**Résultat Attendu**:
- ✅ Validation en temps réel avec messages d'erreur clairs
- ✅ Les mêmes règles que pour la création de compte

---

### Test 3.6 - Confirmation Mot de Passe

**Menu**: `/rso/reset-password/[token]`

**Étapes**:
1. Accéder au formulaire
2. Saisir:
   - **Nouveau mot de passe**: `Test1234!`
   - **Confirmer mot de passe**: `Test12345!` (différent)
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Les mots de passe ne correspondent pas"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 3.7 - Token Expiré

**Menu**: `/rso/reset-password/[token]`

**Prérequis**: Avoir un token expiré (attendre 1 heure ou modifier en base)

**Étapes**:
1. Accéder au formulaire avec un token expiré
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Message d'erreur: "Ce lien de réinitialisation a expiré. Veuillez demander un nouveau lien."
- ✅ Lien vers `/rso/forgot-password` pour demander un nouveau lien
- ✅ Entrée dans les journaux: `password_reset_token_expired`

---

### Test 3.8 - Token Invalide

**Menu**: `/rso/reset-password/[token]`

**Étapes**:
1. Accéder à `/rso/reset-password/token-invalide-12345`
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Message d'erreur: "Lien de réinitialisation invalide"
- ✅ Lien vers `/rso/forgot-password`

---

### Test 3.9 - Réutilisation d'un Token

**Menu**: `/rso/reset-password/[token]`

**Étapes**:
1. Utiliser un token pour réinitialiser le mot de passe (Test 3.4)
2. Essayer de réutiliser le même token

**Résultat Attendu**:
- ✅ Message d'erreur: "Ce lien a déjà été utilisé"
- ✅ Le token est invalidé après la première utilisation

---

### Test 3.10 - Demande Multiple de Réinitialisation

**Menu**: `/rso/forgot-password`

**Étapes**:
1. Demander une réinitialisation pour `admin@aspci.rso`
2. Attendre quelques minutes
3. Demander à nouveau une réinitialisation pour le même email

**Résultat Attendu**:
- ✅ Nouveau token généré
- ✅ Ancien token invalidé
- ✅ Seul le dernier token est valide

---

## 👨‍🏫 User Story 4 - Formateur Crée Agents PFSO

**Menu**: `/rso/formateur/users`  
**Page**: Dashboard Formateur → **Agents PFSO**

### Test 4.1 - Accès à la Page de Gestion des Agents PFSO

**Prérequis**: Être connecté en tant que formateur (`formateur_rso1`)

**Étapes**:
1. Se connecter avec `formateur_rso1` / `Test1234!`
2. Accéder au menu **Agents PFSO** ou `/rso/formateur/users`

**Résultat Attendu**:
- ✅ Page affiche uniquement les agents PFSO
- ✅ Filtre par installation disponible
- ✅ Bouton **Créer un agent PFSO** visible

---

### Test 4.2 - Création d'un Agent PFSO par Formateur

**Menu**: `/rso/formateur/users` → **Créer un agent PFSO**

**Prérequis**: Avoir au moins une installation disponible

**Étapes**:
1. Cliquer sur **Créer un agent PFSO**
2. Remplir le formulaire:
   - **Username**: `pfso_test_formateur`
   - **Nom**: `Kouame`
   - **Prénoms**: `François`
   - **Email**: `francois.kouame@aspci.rso`
   - **Téléphone**: `+2250788990030`
   - **Mot de passe**: `PfsoTest@2024!`
   - **Confirmer mot de passe**: `PfsoTest@2024!`
   - **Installation**: Sélectionner une installation (obligatoire)
   - **Statut**: `actif`
3. Cliquer sur **Créer**

**Résultat Attendu**:
- ✅ Message de succès: "Agent PFSO créé avec succès"
- ✅ Rôle automatiquement défini à `agent_pfso` (non modifiable)
- ✅ Installation obligatoire (validation)
- ✅ Agent visible dans la liste
- ✅ Entrée dans les journaux: `create_pfso_agent` (par le formateur)

---

### Test 4.3 - Validation Installation Obligatoire

**Menu**: `/rso/formateur/users` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Remplir tous les champs sauf **Installation**
3. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "L'installation est obligatoire pour les agents PFSO"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 4.4 - Filtrage par Installation

**Menu**: `/rso/formateur/users` → Filtre Installation

**Étapes**:
1. Dans la liste des agents PFSO, utiliser le filtre **Installation**
2. Sélectionner une installation (ex: "Port d'Abidjan")
3. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les agents de l'installation sélectionnée
- ✅ Compteur mis à jour

---

### Test 4.5 - Modification d'un Agent PFSO

**Menu**: `/rso/formateur/users` → Modifier un agent

**Étapes**:
1. Dans la liste, cliquer sur **Modifier** pour un agent PFSO
2. Modifier les informations (nom, prénom, téléphone, email)
3. **Important**: Le rôle et l'installation ne doivent pas être modifiables (ou avec restrictions)
4. Enregistrer

**Résultat Attendu**:
- ✅ Modifications enregistrées
- ✅ Rôle reste `agent_pfso`
- ✅ Entrée dans les journaux: `update_user`

---

### Test 4.6 - Restriction: Formateur ne peut pas créer d'autres rôles

**Menu**: `/rso/formateur/users` → Formulaire de création

**Étapes**:
1. Ouvrir le formulaire de création
2. Vérifier le champ **Rôle**

**Résultat Attendu**:
- ✅ Le champ Rôle est verrouillé à `agent_pfso`
- ✅ Ou le champ n'est pas visible (rôle automatique)
- ✅ Le formateur ne peut pas créer d'administrateurs ou d'autres formateurs

---

## 🔍 User Story 5 - Agent PFSO Consultation

**Menu**: `/rso/pfso/consultation`  
**Page**: Consultation des Activités (Lecture seule)

### Test 5.1 - Accès à la Page de Consultation

**Prérequis**: Être connecté en tant qu'agent PFSO (`pfso_abidjan`)

**Étapes**:
1. Se connecter avec `pfso_abidjan` / `Test1234!`
2. Vérifier la redirection ou accéder à `/rso/pfso/consultation`

**Résultat Attendu**:
- ✅ Page de consultation s'affiche
- ✅ Filtres visibles: Année, Installation (pré-rempli et désactivé), Type d'activité
- ✅ Liste des activités (vide si aucune activité n'existe encore)

---

### Test 5.2 - Filtre Installation Pré-rempli

**Menu**: `/rso/pfso/consultation`

**Étapes**:
1. Accéder à la page de consultation
2. Vérifier le champ **Installation**

**Résultat Attendu**:
- ✅ Installation de l'agent PFSO pré-remplie automatiquement
- ✅ Champ désactivé (non modifiable)
- ✅ L'agent ne peut voir que les activités de son installation

---

### Test 5.3 - Filtrage par Année

**Menu**: `/rso/pfso/consultation` → Filtre Année

**Prérequis**: Avoir des activités dans différentes années

**Étapes**:
1. Sélectionner une année dans le filtre (ex: 2024)
2. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les activités de l'année sélectionnée
- ✅ Filtre combiné avec l'installation de l'agent

---

### Test 5.4 - Filtrage par Type d'Activité

**Menu**: `/rso/pfso/consultation` → Filtre Type

**Étapes**:
1. Sélectionner un type d'activité dans le filtre
2. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée par type d'activité
- ✅ Filtres combinés (année + installation + type)

---

### Test 5.5 - Consultation d'une Activité (Lecture seule)

**Menu**: `/rso/pfso/consultation` → Cliquer sur une activité

**Étapes**:
1. Dans la liste, cliquer sur une activité pour voir les détails
2. Vérifier les boutons disponibles

**Résultat Attendu**:
- ✅ Détails de l'activité affichés
- ✅ Boutons **Télécharger** et **Imprimer** visibles
- ✅ **Aucun bouton Modifier ou Supprimer** (lecture seule)
- ✅ Entrée dans les journaux: `view_activity`

---

### Test 5.6 - Téléchargement d'un Rapport

**Menu**: `/rso/pfso/consultation` → Détails activité → Télécharger

**Étapes**:
1. Ouvrir les détails d'une activité
2. Cliquer sur **Télécharger**

**Résultat Attendu**:
- ✅ Fichier PDF téléchargé
- ✅ Nom du fichier: `activite_[ID]_[DATE].pdf`
- ✅ Contenu: Rapport complet de l'activité
- ✅ Entrée dans les journaux: `download_report`

---

### Test 5.7 - Impression d'un Rapport

**Menu**: `/rso/pfso/consultation` → Détails activité → Imprimer

**Étapes**:
1. Ouvrir les détails d'une activité
2. Cliquer sur **Imprimer**

**Résultat Attendu**:
- ✅ Fenêtre d'impression du navigateur s'ouvre
- ✅ Mise en page optimisée pour l'impression
- ✅ CSS d'impression appliqué (masque les éléments non nécessaires)
- ✅ Entrée dans les journaux: `print_report`

---

### Test 5.8 - Message État Vide

**Menu**: `/rso/pfso/consultation`

**Prérequis**: Aucune activité ne correspond aux filtres

**Étapes**:
1. Appliquer des filtres qui ne retournent aucun résultat
2. Vérifier l'affichage

**Résultat Attendu**:
- ✅ Message clair: "Aucune activité trouvée pour les critères sélectionnés"
- ✅ Suggestion de modifier les filtres

---

### Test 5.9 - Restriction d'Accès aux Autres Installations

**Menu**: `/rso/pfso/consultation`

**Prérequis**: Avoir des activités de différentes installations

**Étapes**:
1. Se connecter en tant qu'agent PFSO d'une installation (ex: Abidjan)
2. Vérifier la liste des activités

**Résultat Attendu**:
- ✅ Seules les activités de l'installation de l'agent sont visibles
- ✅ Les activités d'autres installations ne sont pas accessibles
- ✅ Tentative d'accès direct à une activité d'une autre installation → Erreur 403

---

## 📊 User Story 6 - Journalisation des Activités

**Menu**: `/rso/admin/activity-logs`  
**Page**: Tableau de bord Admin → **Journaux d'Activité**

### Test 6.1 - Accès aux Journaux d'Activité

**Prérequis**: Être connecté en tant qu'administrateur

**Étapes**:
1. Se connecter avec `admin_rso`
2. Accéder au menu **Journaux d'Activité** (`/rso/admin/activity-logs`)

**Résultat Attendu**:
- ✅ Page des journaux s'affiche
- ✅ Tableau avec colonnes: Date/Heure, Utilisateur, Action, Entité, Description, IP, User Agent
- ✅ Filtres disponibles: Utilisateur, Action, Type d'entité, Date (début/fin)
- ✅ Pagination

---

### Test 6.2 - Consultation des Logs de Connexion

**Menu**: `/rso/admin/activity-logs` → Filtrer par Action: `login`

**Étapes**:
1. Effectuer quelques connexions/déconnexions
2. Dans les journaux, filtrer par **Action**: `login`
3. Vérifier les résultats

**Résultat Attendu**:
- ✅ Toutes les connexions réussies sont listées
- ✅ Informations affichées: Utilisateur, Date/Heure, IP, User Agent
- ✅ Description: "Connexion réussie: [username]"

---

### Test 6.3 - Consultation des Logs de Gestion Utilisateurs

**Menu**: `/rso/admin/activity-logs` → Filtrer par Action: `create_user`

**Étapes**:
1. Créer un utilisateur (Test 1.2)
2. Dans les journaux, filtrer par **Action**: `create_user`
3. Vérifier les résultats

**Résultat Attendu**:
- ✅ Log de création visible
- ✅ Informations: Qui a créé, quel utilisateur a été créé, date/heure
- ✅ Description: "Création d'utilisateur: [nom] [prenoms] ([role])"

---

### Test 6.4 - Filtrage par Utilisateur

**Menu**: `/rso/admin/activity-logs` → Filtre Utilisateur

**Étapes**:
1. Dans le filtre **Utilisateur**, sélectionner `admin_rso`
2. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée affichant uniquement les actions de `admin_rso`
- ✅ Toutes les actions de cet utilisateur sont visibles

---

### Test 6.5 - Filtrage par Date

**Menu**: `/rso/admin/activity-logs` → Filtres Date

**Étapes**:
1. Sélectionner une plage de dates (ex: Aujourd'hui)
2. Appliquer le filtre

**Résultat Attendu**:
- ✅ Liste filtrée par plage de dates
- ✅ Seules les activités dans la plage sont affichées

---

### Test 6.6 - Export CSV

**Menu**: `/rso/admin/activity-logs` → Bouton **Exporter** → Format CSV

**Étapes**:
1. Appliquer des filtres si nécessaire
2. Cliquer sur **Exporter**
3. Sélectionner **CSV**
4. Télécharger le fichier

**Résultat Attendu**:
- ✅ Fichier CSV téléchargé
- ✅ Nom: `activity-logs_[DATE].csv`
- ✅ Contenu: Toutes les activités filtrées au format CSV
- ✅ Colonnes: Date, Utilisateur, Action, Entité, Description, IP, User Agent

---

### Test 6.7 - Export Excel

**Menu**: `/rso/admin/activity-logs` → Bouton **Exporter** → Format Excel

**Étapes**:
1. Appliquer des filtres si nécessaire
2. Cliquer sur **Exporter**
3. Sélectionner **Excel**
4. Télécharger le fichier

**Résultat Attendu**:
- ✅ Fichier Excel (.xlsx) téléchargé
- ✅ Nom: `activity-logs_[DATE].xlsx`
- ✅ Contenu: Toutes les activités filtrées au format Excel
- ✅ Formatage approprié (en-têtes, colonnes)

---

### Test 6.8 - Vérification des Logs de Toutes les Actions

**Menu**: `/rso/admin/activity-logs`

**Actions à Vérifier** (effectuer chaque action puis vérifier dans les logs):

1. **Connexion**: `login`
2. **Déconnexion**: `logout`
3. **Création utilisateur**: `create_user`
4. **Modification utilisateur**: `update_user`
5. **Suppression utilisateur**: `delete_user`
6. **Activation utilisateur**: `activate_user`
7. **Désactivation utilisateur**: `deactivate_user`
8. **Suspension utilisateur**: `suspend_user`
9. **Demande réinitialisation**: `password_reset_requested`
10. **Réinitialisation complétée**: `password_reset_completed`
11. **Changement mot de passe**: `password_changed`
12. **Création agent PFSO**: `create_pfso_agent`
13. **Consultation activité**: `view_activity`
14. **Téléchargement rapport**: `download_report`
15. **Impression rapport**: `print_report`
16. **Tentative accès non autorisé**: `unauthorized_access`

**Résultat Attendu**:
- ✅ Toutes les actions sont enregistrées dans les journaux
- ✅ Informations complètes: utilisateur, date, IP, description

---

### Test 6.9 - Pagination des Journaux

**Menu**: `/rso/admin/activity-logs`

**Prérequis**: Avoir plus de 100 entrées (limite par défaut)

**Étapes**:
1. Vérifier la pagination en bas de la liste
2. Naviguer entre les pages

**Résultat Attendu**:
- ✅ Pagination fonctionnelle
- ✅ 100 entrées par page (ou selon la configuration)
- ✅ Navigation entre pages fonctionne

---

## 🔒 User Story 7 - Changement de Mot de Passe

**Menu**: `/rso/profile`  
**Page**: Profil Utilisateur

### Test 7.1 - Accès à la Page de Profil

**Prérequis**: Être connecté

**Étapes**:
1. Se connecter avec n'importe quel utilisateur
2. Accéder au menu **Profil** ou `/rso/profile`

**Résultat Attendu**:
- ✅ Page de profil s'affiche
- ✅ Informations utilisateur: Nom, Prénom, Email, Téléphone, Rôle (lecture seule)
- ✅ Section **Changer le mot de passe** visible

---

### Test 7.2 - Affichage des Informations du Profil

**Menu**: `/rso/profile`

**Étapes**:
1. Accéder à la page de profil
2. Vérifier les informations affichées

**Résultat Attendu**:
- ✅ Nom: Affiché correctement
- ✅ Prénom: Affiché correctement
- ✅ Email: Affiché correctement
- ✅ Téléphone: Affiché correctement
- ✅ Rôle: Affiché correctement
- ✅ Tous les champs en lecture seule (sauf changement de mot de passe)

---

### Test 7.3 - Changement de Mot de Passe avec Ancien Mot de Passe Correct

**Menu**: `/rso/profile` → Section Changer le mot de passe

**Étapes**:
1. Dans la section **Changer le mot de passe**, remplir:
   - **Ancien mot de passe**: `Test1234!`
   - **Nouveau mot de passe**: `NouveauPass123!`
   - **Confirmer nouveau mot de passe**: `NouveauPass123!`
2. Cliquer sur **Changer le mot de passe**

**Résultat Attendu**:
- ✅ Message de succès: "Votre mot de passe a été changé avec succès. Toutes vos autres sessions ont été fermées."
- ✅ Mot de passe mis à jour
- ✅ Toutes les autres sessions actives sont fermées (vérifier dans `rso_user_sessions`)
- ✅ Entrée dans les journaux: `password_changed`
- ✅ Redirection vers la page de login (ou message de reconnexion)

**Test de Reconnexion**:
1. Se reconnecter avec le nouveau mot de passe
2. ✅ Connexion réussie

---

### Test 7.4 - Validation Ancien Mot de Passe Incorrect

**Menu**: `/rso/profile` → Section Changer le mot de passe

**Étapes**:
1. Remplir le formulaire:
   - **Ancien mot de passe**: `MauvaisMotDePasse123!`
   - **Nouveau mot de passe**: `NouveauPass123!`
   - **Confirmer nouveau mot de passe**: `NouveauPass123!`
2. Cliquer sur **Changer le mot de passe**

**Résultat Attendu**:
- ✅ Message d'erreur générique: "Impossible de changer le mot de passe. Vérifiez vos informations."
- ✅ Le message ne révèle pas si c'est l'ancien ou le nouveau mot de passe qui est incorrect
- ✅ Le mot de passe n'est pas changé

---

### Test 7.5 - Validation Nouveau Mot de Passe

**Menu**: `/rso/profile` → Section Changer le mot de passe

**Étapes**:
1. Tester différents nouveaux mots de passe (voir Test 1.6 pour les règles)

**Résultat Attendu**:
- ✅ Validation en temps réel avec messages d'erreur clairs
- ✅ Les mêmes règles que pour la création de compte

---

### Test 7.6 - Confirmation Nouveau Mot de Passe

**Menu**: `/rso/profile` → Section Changer le mot de passe

**Étapes**:
1. Remplir:
   - **Ancien mot de passe**: `Test1234!`
   - **Nouveau mot de passe**: `NouveauPass123!`
   - **Confirmer nouveau mot de passe**: `NouveauPass456!` (différent)
2. Essayer de soumettre

**Résultat Attendu**:
- ✅ Message d'erreur: "Les nouveaux mots de passe ne correspondent pas"
- ✅ Le formulaire ne peut pas être soumis

---

### Test 7.7 - Fermeture des Autres Sessions

**Menu**: `/rso/profile` → Changer le mot de passe

**Prérequis**: Avoir plusieurs sessions actives (se connecter depuis plusieurs navigateurs/appareils)

**Étapes**:
1. Se connecter depuis 2 navigateurs différents avec le même compte
2. Depuis l'un des navigateurs, changer le mot de passe
3. Vérifier l'autre navigateur

**Résultat Attendu**:
- ✅ Dans le navigateur où le mot de passe a été changé: Message de succès
- ✅ Dans l'autre navigateur: Déconnexion automatique
- ✅ Toutes les sessions dans `rso_user_sessions` sont marquées comme `logout` (sauf la session actuelle)
- ✅ Tentative d'action dans l'autre navigateur → Redirection vers login

---

### Test 7.8 - Tentative de Réutilisation de l'Ancien Mot de Passe

**Menu**: `/rso/profile` → Changer le mot de passe

**Étapes**:
1. Changer le mot de passe (Test 7.3)
2. Essayer de changer à nouveau le mot de passe en utilisant l'ancien mot de passe comme "nouveau"

**Résultat Attendu**:
- ✅ Erreur: "Le nouveau mot de passe doit être différent de l'ancien"
- ✅ Ou validation qui empêche la réutilisation

---

## 🔄 Workflow de Test Complet

### Workflow 1: Cycle de Vie Complet d'un Utilisateur

**Objectif**: Tester toutes les fonctionnalités liées à un utilisateur de bout en bout

**Étapes**:
1. **Création** (Admin)
   - Se connecter en tant qu'admin
   - Créer un nouveau formateur RSO
   - Vérifier dans les journaux: `create_user`

2. **Première Connexion**
   - Se connecter avec le nouveau compte
   - Vérifier la redirection vers le dashboard formateur
   - Vérifier `last_login` mis à jour

3. **Réinitialisation Mot de Passe**
   - Se déconnecter
   - Demander une réinitialisation
   - Utiliser le lien pour réinitialiser
   - Se reconnecter avec le nouveau mot de passe

4. **Changement de Mot de Passe**
   - Se connecter
   - Accéder au profil
   - Changer le mot de passe
   - Vérifier la fermeture des autres sessions

5. **Modification** (Admin)
   - Se reconnecter en tant qu'admin
   - Modifier les informations du formateur
   - Vérifier dans les journaux: `update_user`

6. **Désactivation** (Admin)
   - Désactiver le compte
   - Vérifier que le formateur ne peut plus se connecter

7. **Réactivation** (Admin)
   - Réactiver le compte
   - Vérifier que le formateur peut se reconnecter

8. **Suppression** (Admin)
   - Supprimer le compte
   - Vérifier dans les journaux: `delete_user`
   - Vérifier que le compte n'existe plus

---

### Workflow 2: Délégation Formateur → Agent PFSO

**Objectif**: Tester le workflow de création d'agents PFSO par un formateur

**Étapes**:
1. **Connexion Formateur**
   - Se connecter avec `formateur_rso1`
   - Accéder à `/rso/formateur/users`

2. **Création Agent PFSO**
   - Créer un nouvel agent PFSO
   - Assigner une installation
   - Vérifier la création

3. **Connexion Agent PFSO**
   - Se connecter avec le nouvel agent
   - Vérifier la redirection vers `/rso/pfso/consultation`
   - Vérifier que l'installation est pré-remplie

4. **Consultation Activités**
   - Filtrer par année et type
   - Consulter une activité
   - Télécharger un rapport
   - Vérifier qu'il ne peut pas modifier

5. **Vérification Logs**
   - Se reconnecter en tant qu'admin
   - Vérifier dans les journaux: `create_pfso_agent` par le formateur
   - Vérifier: `login`, `view_activity`, `download_report` par l'agent

---

### Workflow 3: Sécurité et Rate Limiting

**Objectif**: Tester toutes les protections de sécurité

**Étapes**:
1. **Tentatives Échouées**
   - Essayer de se connecter 3 fois avec un mauvais mot de passe
   - Vérifier l'apparition du CAPTCHA

2. **Blocage IP**
   - Continuer jusqu'à 5 tentatives échouées
   - Vérifier le blocage IP
   - Attendre 15 minutes (ou modifier en base)
   - Vérifier le déblocage

3. **Session Expiration**
   - Se connecter sans "Se souvenir de moi"
   - Vérifier l'expiration après 8 heures (ou modifier le token)
   - Vérifier la déconnexion automatique

4. **Token Refresh**
   - Se connecter
   - Attendre 30 minutes avant expiration
   - Effectuer une action
   - Vérifier le refresh automatique

5. **Protection Routes**
   - Se déconnecter
   - Essayer d'accéder directement à `/rso/admin/users`
   - Vérifier la redirection vers login

---

### Workflow 4: Audit et Traçabilité

**Objectif**: Vérifier que toutes les actions sont tracées

**Étapes**:
1. **Effectuer des Actions**
   - Créer un utilisateur
   - Modifier un utilisateur
   - Changer un statut
   - Se connecter/déconnecter
   - Changer un mot de passe

2. **Vérifier les Journaux**
   - Accéder à `/rso/admin/activity-logs`
   - Filtrer par utilisateur
   - Filtrer par action
   - Vérifier que toutes les actions sont enregistrées

3. **Export**
   - Exporter en CSV
   - Exporter en Excel
   - Vérifier le contenu des fichiers

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Critiques (P1)
- [ ] Création d'utilisateurs par admin
- [ ] Connexion avec username/email
- [ ] Rate limiting (5 tentatives)
- [ ] CAPTCHA après 3 tentatives
- [ ] Session expiration (8h / 30 jours)
- [ ] Redirection selon le rôle
- [ ] Protection des routes authentifiées

### Fonctionnalités Importantes (P2)
- [ ] Réinitialisation mot de passe
- [ ] Création agents PFSO par formateur
- [ ] Consultation activités PFSO (lecture seule)
- [ ] Journalisation complète
- [ ] Export journaux (CSV/Excel)

### Fonctionnalités Secondaires (P3)
- [ ] Changement mot de passe depuis profil
- [ ] Fermeture autres sessions

### Validation et Sécurité
- [ ] Validation username/email en temps réel
- [ ] Validation mot de passe (règles complètes)
- [ ] Protection contre injection (XSS, SQL)
- [ ] Isolation tenant (RLS)
- [ ] Hashage mots de passe (bcrypt)

### Interface Utilisateur
- [ ] Responsive design
- [ ] Messages d'erreur clairs
- [ ] États de chargement
- [ ] Accessibilité (ARIA)

---

## 📝 Notes de Test

### Environnement de Test
- **Backend**: `http://localhost:4000`
- **Frontend**: `http://localhost:3000`
- **Base de données**: PostgreSQL (vérifier la connexion)

### Prérequis
1. Exécuter les migrations: `infra/scripts/migrations/0021_rso_phase1.sql`
2. Exécuter le seed: `tsx infra/scripts/seed-rso-phase1.ts`
3. Démarrer les serveurs: `pnpm dev:api` et `pnpm dev:web`

### Données de Test
- Tous les utilisateurs de test ont le mot de passe: `Test1234!`
- Tenant: ASPCI (slug: `aspci`)

### Points d'Attention
- Vérifier les logs email (peuvent être dans la console ou un service de test)
- Vérifier les journaux d'activité après chaque action importante
- Tester avec différents rôles pour vérifier les permissions
- Vérifier la base de données directement si nécessaire

---

## 🐛 Problèmes Connus / À Vérifier

1. **CAPTCHA**: Vérifier que le widget CAPTCHA est correctement intégré
2. **Email**: Vérifier la configuration SMTP pour l'envoi d'emails
3. **Installations**: Pour les tests PFSO, s'assurer qu'au moins une installation existe
4. **Sessions**: Vérifier le nettoyage automatique des sessions expirées

---

**Fin du Document de Test**

