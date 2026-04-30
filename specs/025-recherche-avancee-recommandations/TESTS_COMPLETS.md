# Scénarios de Test Complets - 025 Recherche Avancée et Gestion des Recommandations RSO-PFSO

**Date de création**: 2025-01-27  
**Version**: 1.0  
**Objectif**: Valider toutes les fonctionnalités implémentées dans le module de recherche avancée et gestion des recommandations RSO-PFSO

---

## 📋 Table des Matières

1. [Données de Test](#données-de-test)
2. [User Story 1 - Recherche Avancée Multi-Critères](#user-story-1---recherche-avancée-multi-critères)
3. [User Story 2 - Système de Tags et Catégorisation](#user-story-2---système-de-tags-et-catégorisation)
4. [User Story 3 - Tableau de Bord des Recommandations](#user-story-3---tableau-de-bord-des-recommandations)
5. [User Story 4 - Notifications et Alertes Automatiques](#user-story-4---notifications-et-alertes-automatiques)
6. [User Story 5 - Recherches Enregistrées et Alertes](#user-story-5---recherches-enregistrées-et-alertes)
7. [User Story 6 - Rapports Planifiés et Exports](#user-story-6---rapports-planifiés-et-exports)
8. [Workflow de Test Complet](#workflow-de-test-complet)

---

## 🔑 Données de Test

### Activités de Test

Pour tester la recherche, utiliser les activités existantes ou créer :
- **Activité 1**: "Entraînement évacuation d'urgence" - Code: `ACT-2024-PAD_COM-ENT-T1-001`
  - Type: `ENTRAINEMENT`
  - Sous-type: `T1`
  - Installation: Port de commerce (ID: 1)
  - Date: 2024-03-15
  - Statut: `termine`
  - Contenu: "Procédures d'évacuation en cas d'urgence ont été testées avec succès"

- **Activité 2**: "Formation sécurité incendie" - Code: `ACT-2024-PAD_COM-FOR-T2-002`
  - Type: `FORMATION`
  - Sous-type: `T2`
  - Installation: Port de commerce (ID: 1)
  - Date: 2024-04-20
  - Statut: `en_cours`
  - Contenu: "Formation sur l'utilisation des extincteurs et procédures d'évacuation"

- **Activité 3**: "Audit sécurité portuaire" - Code: `ACT-2024-PAD_ABT-AUD-T3-003`
  - Type: `AUDIT`
  - Sous-type: `T3`
  - Installation: Abidjan Terminal (ID: 2)
  - Date: 2024-05-10
  - Statut: `termine`
  - Contenu: "Audit complet des installations de sécurité du terminal"

- **Activité 4**: "Exercice simulation intrusion" - Code: `ACT-2024-PAD_COM-ENT-T1-004`
  - Type: `ENTRAINEMENT`
  - Sous-type: `T1`
  - Installation: Port de commerce (ID: 1)
  - Date: 2024-06-05
  - Statut: `termine`
  - Contenu: "Simulation d'intrusion pour tester les procédures de sûreté"

### Recommandations de Test

- **Recommandation 1**: "Améliorer les procédures d'évacuation"
  - Activité: Activité 1
  - Priorité: `haute`
  - Statut: `en_cours`
  - Échéance: 2024-12-31
  - Catégorie: `procedure`
  - Impact: `moyen`
  - Coût estimé: 50000 FCFA

- **Recommandation 2**: "Remplacer les extincteurs périmés"
  - Activité: Activité 2
  - Priorité: `urgente`
  - Statut: `en_cours`
  - Échéance: 2024-11-15 (en retard)
  - Catégorie: `equipement`
  - Impact: `eleve`
  - Coût estimé: 150000 FCFA

- **Recommandation 3**: "Former le personnel aux nouvelles procédures"
  - Activité: Activité 3
  - Priorité: `normale`
  - Statut: `termine`
  - Échéance: 2024-10-30
  - Catégorie: `formation`
  - Impact: `moyen`
  - Coût estimé: 75000 FCFA

### Tags de Test

- **Tag 1**: "évacuation"
  - Catégorie: `theme`
  - Couleur: `#e74c3c` (rouge)
  - Icône: `🚨`
  - Description: "Activités liées aux procédures d'évacuation"

- **Tag 2**: "sécurité incendie"
  - Catégorie: `theme`
  - Couleur: `#f39c12` (orange)
  - Icône: `🔥`
  - Description: "Activités liées à la sécurité incendie"

- **Tag 3**: "audit"
  - Catégorie: `type_incident`
  - Couleur: `#3498db` (bleu)
  - Icône: `📋`
  - Description: "Activités d'audit"

- **Tag 4**: "formation"
  - Catégorie: `theme`
  - Couleur: `#2ecc71` (vert)
  - Icône: `📚`
  - Description: "Activités de formation"

### Utilisateurs de Test

- **Formateur RSO**: 
  - Email: `formateur@aspci.ci`
  - Mot de passe: `Password123!`
  - Installation: Port de commerce

- **Administrateur**: 
  - Email: `admin@aspci.ci`
  - Mot de passe: `Password123!`

- **Agent PFSO**: 
  - Email: `pfso@aspci.ci`
  - Mot de passe: `Password123!`
  - Installation: Port de commerce

### Années de Test

- **Année 2024**: ID: 1, Statut: `active`
- **Année 2023**: ID: 2, Statut: `archivee`

---

## User Story 1 - Recherche Avancée Multi-Critères

**Menu**: RSO → Recherche Avancée  
**URL**: `/rso/recherche-avancee`

### Test 1.1 - Recherche Simple par Mot-clé

**Objectif**: Vérifier que la recherche par mot-clé fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec le mot "évacuation" dans le contenu

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Cliquer sur "Rechercher" ou appuyer sur Entrée
4. Observer les résultats

**Résultats Attendus**:
- ✅ Les résultats s'affichent avec les activités contenant "évacuation"
- ✅ Les mots-clés sont mis en surbrillance dans les résultats
- ✅ Un extrait (excerpt) est affiché pour chaque résultat
- ✅ Le score de pertinence est affiché
- ✅ La pagination fonctionne si plus de 20 résultats

**Données à Vérifier**:
- Nombre de résultats: Au moins 2 (Activité 1 et Activité 4)
- Mots en surbrillance: "évacuation"
- Score de pertinence: > 0 pour tous les résultats

---

### Test 1.2 - Recherche avec Auto-complétion

**Objectif**: Vérifier que l'auto-complétion fonctionne lors de la saisie.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités existantes

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Commencer à saisir "évac" dans le champ de recherche
3. Observer les suggestions qui apparaissent
4. Sélectionner une suggestion

**Résultats Attendus**:
- ✅ Des suggestions apparaissent après 2 caractères minimum
- ✅ Les suggestions incluent:
  - Titre d'activité
  - Type
  - Date
  - Icône
  - URL de navigation
- ✅ La sélection d'une suggestion navigue vers l'activité
- ✅ Le debouncing fonctionne (pas de requête à chaque caractère)

---

### Test 1.3 - Filtrage par Année

**Objectif**: Vérifier que le filtrage par année fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités de différentes années

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Sélectionner "Année: 2024" dans les filtres
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités de l'année 2024 sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour

---

### Test 1.4 - Filtrage par Installation

**Objectif**: Vérifier que le filtrage par installation fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités de différentes installations

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Sélectionner "Installation: Port de commerce" dans les filtres
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités de l'installation sélectionnée sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour

---

### Test 1.5 - Filtrage par Type d'Activité

**Objectif**: Vérifier que le filtrage par type d'activité fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités de différents types

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Sélectionner "Type: Entraînement" dans les filtres
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités de type "Entraînement" sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour

---

### Test 1.6 - Filtrage par Statut

**Objectif**: Vérifier que le filtrage par statut fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec différents statuts

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Sélectionner "Statut: Terminé" dans les filtres
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités avec le statut "Terminé" sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour

---

### Test 1.7 - Filtrage par Tags

**Objectif**: Vérifier que le filtrage par tags fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec des tags associés
- Avoir créé des tags (voir US2)

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Sélectionner le tag "évacuation" dans les filtres
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités avec le tag sélectionné sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour
- ✅ Les tags sont affichés sur chaque résultat

---

### Test 1.8 - Filtrage par Période de Date

**Objectif**: Vérifier que le filtrage par période de date fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités de différentes dates

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Définir une période:
   - Date début: 2024-01-01
   - Date fin: 2024-06-30
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités dans la période sélectionnée sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Le nombre de résultats est mis à jour

---

### Test 1.9 - Combinaison de Plusieurs Filtres

**Objectif**: Vérifier que la combinaison de plusieurs filtres fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités correspondant aux critères combinés

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Appliquer plusieurs filtres:
   - Année: 2024
   - Installation: Port de commerce
   - Type: Entraînement
   - Statut: Terminé
4. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités correspondant à TOUS les filtres sont affichées
- ✅ Les filtres sont combinés avec AND (et non OR)
- ✅ Le nombre de résultats est correct

---

### Test 1.10 - Tri des Résultats

**Objectif**: Vérifier que le tri des résultats fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des résultats de recherche

**Étapes**:
1. Effectuer une recherche qui retourne plusieurs résultats
2. Trier par "Pertinence" (par défaut)
3. Observer l'ordre des résultats
4. Changer le tri pour "Date décroissante"
5. Observer l'ordre des résultats
6. Changer le tri pour "Date croissante"
7. Observer l'ordre des résultats
8. Changer le tri pour "Titre A-Z"
9. Observer l'ordre des résultats

**Résultats Attendus**:
- ✅ Tri par pertinence: Résultats les plus pertinents en premier
- ✅ Tri par date décroissante: Activités les plus récentes en premier
- ✅ Tri par date croissante: Activités les plus anciennes en premier
- ✅ Tri par titre A-Z: Activités triées alphabétiquement

---

### Test 1.11 - Pagination des Résultats

**Objectif**: Vérifier que la pagination fonctionne correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche qui retourne plus de 20 résultats

**Étapes**:
1. Effectuer une recherche qui retourne plus de 20 résultats
2. Observer la pagination en bas de page
3. Cliquer sur "Page 2"
4. Observer les résultats de la page 2
5. Cliquer sur "Page précédente"
6. Observer les résultats de la page 1
7. Cliquer sur "Page suivante"
8. Observer les résultats de la page 2

**Résultats Attendus**:
- ✅ La pagination affiche le nombre total de pages
- ✅ La navigation entre pages fonctionne
- ✅ Les résultats changent selon la page sélectionnée
- ✅ Le numéro de page actuel est mis en évidence

---

### Test 1.12 - Recherche dans les Recommandations

**Objectif**: Vérifier que la recherche fonctionne aussi pour les recommandations.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations avec du contenu

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "procédures" dans le champ de recherche
3. Lancer la recherche
4. Observer les résultats (activités et recommandations)

**Résultats Attendus**:
- ✅ Les recommandations contenant "procédures" sont affichées
- ✅ Les recommandations sont distinguées des activités (icône ou badge)
- ✅ Les mots-clés sont mis en surbrillance dans les recommandations
- ✅ Un extrait est affiché pour chaque recommandation

---

### Test 1.13 - Recherche avec Correspondance Exacte

**Objectif**: Vérifier que l'option "Correspondance exacte" fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec des mots similaires

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Saisir "évacuation" dans le champ de recherche
3. Activer l'option "Correspondance exacte"
4. Lancer la recherche
5. Observer les résultats
6. Désactiver l'option "Correspondance exacte"
7. Relancer la recherche
8. Observer les résultats

**Résultats Attendus**:
- ✅ Avec correspondance exacte: Seuls les résultats contenant exactement "évacuation" sont affichés
- ✅ Sans correspondance exacte: Les résultats contenant "évacuation" ou des mots similaires sont affichés
- ✅ La différence est visible dans les résultats

---

### Test 1.14 - Export des Résultats de Recherche

**Objectif**: Vérifier que l'export des résultats fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des résultats de recherche

**Étapes**:
1. Effectuer une recherche qui retourne des résultats
2. Cliquer sur "Exporter"
3. Sélectionner le format (PDF, Excel, CSV)
4. Télécharger le fichier
5. Ouvrir le fichier et vérifier le contenu

**Résultats Attendus**:
- ✅ Les options d'export sont disponibles (PDF, Excel, CSV)
- ✅ Le fichier est généré et téléchargé
- ✅ Le fichier contient tous les résultats de recherche
- ✅ Le format est correct (PDF s'ouvre dans un lecteur PDF, Excel dans Excel, etc.)

---

## User Story 2 - Système de Tags et Catégorisation

**Menu Admin**: RSO → Admin → Tags  
**URL**: `/rso/admin/tags`

### Test 2.1 - Création d'un Tag (Admin)

**Objectif**: Vérifier qu'un administrateur peut créer un tag.

**Prérequis**:
- Être connecté en tant qu'Administrateur

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Cliquer sur "Créer un tag"
3. Remplir le formulaire:
   - Nom: "évacuation"
   - Catégorie: "Thème"
   - Couleur: `#e74c3c` (rouge)
   - Icône: `🚨`
   - Description: "Activités liées aux procédures d'évacuation"
4. Sauvegarder

**Résultats Attendus**:
- ✅ Le tag est créé avec succès
- ✅ Le tag apparaît dans la liste des tags
- ✅ Le slug est généré automatiquement ("evacuation")
- ✅ Le nombre d'utilisations est à 0
- ✅ Le tag est actif par défaut

---

### Test 2.2 - Modification d'un Tag (Admin)

**Objectif**: Vérifier qu'un administrateur peut modifier un tag.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un tag existant

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Cliquer sur "Modifier" pour un tag existant
3. Modifier la couleur: `#c0392b` (rouge foncé)
4. Modifier la description
5. Sauvegarder

**Résultats Attendus**:
- ✅ Le tag est modifié avec succès
- ✅ Les modifications sont visibles dans la liste
- ✅ Le nombre d'utilisations n'est pas affecté

---

### Test 2.3 - Désactivation d'un Tag (Admin)

**Objectif**: Vérifier qu'un administrateur peut désactiver un tag.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un tag actif non utilisé

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Cliquer sur "Désactiver" pour un tag
3. Confirmer la désactivation
4. Observer que le tag n'apparaît plus dans les sélections

**Résultats Attendus**:
- ✅ Le tag est désactivé
- ✅ Le tag n'apparaît plus dans les sélecteurs de tags
- ✅ Le tag reste visible dans la liste (avec indication "Inactif")
- ✅ Les associations existantes ne sont pas affectées

---

### Test 2.4 - Suppression d'un Tag Non Utilisé (Admin)

**Objectif**: Vérifier qu'un administrateur peut supprimer un tag non utilisé.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un tag non utilisé (nb_utilisations = 0)

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Cliquer sur "Supprimer" pour un tag non utilisé
3. Confirmer la suppression

**Résultats Attendus**:
- ✅ Le tag est supprimé avec succès
- ✅ Le tag disparaît de la liste
- ✅ Aucune erreur n'est générée

---

### Test 2.5 - Tentative de Suppression d'un Tag Utilisé (Admin)

**Objectif**: Vérifier qu'un tag utilisé ne peut pas être supprimé.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un tag utilisé (nb_utilisations > 0)

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Cliquer sur "Supprimer" pour un tag utilisé
3. Observer le message d'erreur

**Résultats Attendus**:
- ✅ La suppression est bloquée
- ✅ Message d'erreur: "Ce tag est utilisé et ne peut pas être supprimé. Désactivez-le à la place."
- ✅ Le tag reste dans la liste
- ✅ L'option "Désactiver" est disponible

---

### Test 2.6 - Association de Tags à une Activité (Formateur)

**Objectif**: Vérifier qu'un formateur peut associer des tags à une activité.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité existante
- Avoir des tags créés par l'admin

**Étapes**:
1. Accéder à la page de modification d'une activité
2. Naviguer vers la section "Tags"
3. Cliquer sur "Ajouter des tags"
4. Sélectionner 2 tags: "évacuation" et "sécurité incendie"
5. Sauvegarder

**Résultats Attendus**:
- ✅ Les tags sont associés à l'activité
- ✅ Les tags apparaissent sur la page de l'activité avec leurs couleurs et icônes
- ✅ Le nombre d'utilisations de chaque tag est incrémenté
- ✅ Les tags peuvent être utilisés pour filtrer dans la recherche

---

### Test 2.7 - Retrait de Tags d'une Activité (Formateur)

**Objectif**: Vérifier qu'un formateur peut retirer des tags d'une activité.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des tags associés

**Étapes**:
1. Accéder à la page de modification d'une activité avec tags
2. Retirer un tag en cliquant sur le bouton "Retirer"
3. Sauvegarder

**Résultats Attendus**:
- ✅ Le tag est retiré de l'activité
- ✅ Le tag disparaît de l'affichage
- ✅ Le nombre d'utilisations du tag est décrémenté
- ✅ L'activité n'apparaît plus dans les résultats filtrés par ce tag

---

### Test 2.8 - Affichage des Tags sur les Activités

**Objectif**: Vérifier que les tags sont affichés correctement sur les activités.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une activité avec des tags associés

**Étapes**:
1. Accéder à la page de détail d'une activité avec tags
2. Observer l'affichage des tags

**Résultats Attendus**:
- ✅ Les tags sont affichés avec leurs couleurs
- ✅ Les icônes sont affichées
- ✅ Les tags sont cliquables (lien vers recherche filtrée)
- ✅ L'affichage est cohérent (badges ou chips)

---

### Test 2.9 - Filtrage par Tags dans la Recherche

**Objectif**: Vérifier que le filtrage par tags fonctionne dans la recherche.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des activités avec différents tags

**Étapes**:
1. Accéder à "RSO → Recherche Avancée"
2. Sélectionner le tag "évacuation" dans les filtres
3. Lancer la recherche

**Résultats Attendus**:
- ✅ Seules les activités avec le tag "évacuation" sont affichées
- ✅ Le filtre est appliqué correctement
- ✅ Les résultats affichent les tags associés

---

### Test 2.10 - Liste des Tags Groupés par Catégorie (Admin)

**Objectif**: Vérifier que les tags sont groupés par catégorie dans la liste admin.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir des tags de différentes catégories

**Étapes**:
1. Accéder à "RSO → Admin → Tags"
2. Observer la liste des tags

**Résultats Attendus**:
- ✅ Les tags sont groupés par catégorie
- ✅ Chaque catégorie a un titre
- ✅ Le nombre d'utilisations est affiché pour chaque tag
- ✅ Les tags inactifs sont distingués visuellement

---

## User Story 3 - Tableau de Bord des Recommandations

**Menu**: RSO → Recommandations → Tableau de Bord  
**URL**: `/rso/recommandations/dashboard`

### Test 3.1 - Affichage des Statistiques Globales

**Objectif**: Vérifier que les statistiques globales s'affichent correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations dans le système

**Étapes**:
1. Accéder à "RSO → Recommandations → Tableau de Bord"
2. Observer les cartes de statistiques

**Résultats Attendus**:
- ✅ Carte "Total": Affiche le nombre total de recommandations
- ✅ Carte "En cours": Affiche le nombre de recommandations en cours
- ✅ Carte "En retard": Affiche le nombre de recommandations en retard
- ✅ Carte "Terminées": Affiche le nombre de recommandations terminées
- ✅ Les chiffres sont corrects et à jour

---

### Test 3.2 - Graphique d'Évolution Mensuelle

**Objectif**: Vérifier que le graphique d'évolution mensuelle fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations créées sur plusieurs mois

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Observer le graphique d'évolution mensuelle
3. Changer la période (ex: dernier trimestre, dernière année)
4. Observer le graphique mis à jour

**Résultats Attendus**:
- ✅ Le graphique affiche l'évolution du nombre de recommandations par mois
- ✅ Les données sont correctes
- ✅ Le changement de période met à jour le graphique
- ✅ Le graphique est lisible et professionnel

---

### Test 3.3 - Graphique de Répartition par Priorité

**Objectif**: Vérifier que le graphique de répartition par priorité fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations avec différentes priorités

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Observer le graphique de répartition par priorité

**Résultats Attendus**:
- ✅ Le graphique affiche la répartition des recommandations par priorité
- ✅ Les priorités sont: Urgente, Haute, Normale, Basse
- ✅ Les couleurs sont distinctes pour chaque priorité
- ✅ Les pourcentages ou nombres sont affichés

---

### Test 3.4 - Liste des Recommandations en Retard

**Objectif**: Vérifier que la liste des recommandations en retard s'affiche.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations avec échéance dépassée

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Observer la section "Recommandations en retard"
3. Cliquer sur une recommandation en retard

**Résultats Attendus**:
- ✅ La liste des recommandations en retard s'affiche
- ✅ Le nombre de jours de retard est affiché pour chaque recommandation
- ✅ Les recommandations sont triées par retard (plus retardées en premier)
- ✅ Le clic sur une recommandation navigue vers sa page de détail

---

### Test 3.5 - Liste des Échéances Proches

**Objectif**: Vérifier que la liste des échéances proches s'affiche.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations avec échéance dans les 7 prochains jours

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Observer la section "Échéances proches"

**Résultats Attendus**:
- ✅ La liste des recommandations avec échéance dans les 7 prochains jours s'affiche
- ✅ Le nombre de jours restants est affiché
- ✅ Les recommandations sont triées par échéance (plus proches en premier)
- ✅ Un avertissement visuel est affiché (couleur orange/rouge)

---

### Test 3.6 - Filtrage par Installation

**Objectif**: Vérifier que le filtrage par installation fonctionne dans le tableau de bord.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations de différentes installations

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Sélectionner une installation dans le filtre
3. Observer les statistiques et graphiques mis à jour

**Résultats Attendus**:
- ✅ Les statistiques sont filtrées par installation
- ✅ Les graphiques sont mis à jour
- ✅ Les listes (en retard, échéances proches) sont filtrées
- ✅ Le filtre est persisté dans l'URL

---

### Test 3.7 - Filtrage par Période

**Objectif**: Vérifier que le filtrage par période fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations de différentes périodes

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Sélectionner une période (ex: dernier trimestre)
3. Observer les statistiques et graphiques mis à jour

**Résultats Attendus**:
- ✅ Les statistiques sont filtrées par période
- ✅ Les graphiques sont mis à jour
- ✅ Les données correspondent à la période sélectionnée

---

### Test 3.8 - Tableau de Répartition par Installation

**Objectif**: Vérifier que le tableau de répartition par installation s'affiche.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des recommandations de différentes installations

**Étapes**:
1. Accéder au tableau de bord des recommandations
2. Observer le tableau de répartition par installation

**Résultats Attendus**:
- ✅ Le tableau affiche les installations avec leurs statistiques
- ✅ Colonnes: Installation, Total, En cours, En retard, Terminées
- ✅ Les données sont correctes
- ✅ Le tableau est triable

---

## User Story 4 - Notifications et Alertes Automatiques

**Menu**: Notifications (widget dans le header)  
**URL**: Widget dans le header, page `/rso/notifications` (si disponible)

### Test 4.1 - Affichage du Widget de Notifications

**Objectif**: Vérifier que le widget de notifications s'affiche dans le header.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des notifications non lues

**Étapes**:
1. Se connecter et observer le header
2. Localiser le widget de notifications (icône cloche)
3. Observer le badge avec le nombre de notifications non lues

**Résultats Attendus**:
- ✅ Le widget de notifications est visible dans le header
- ✅ Un badge affiche le nombre de notifications non lues
- ✅ Le badge est visible même si le nombre est 0 (ou masqué si 0)

---

### Test 4.2 - Ouverture de la Liste des Notifications

**Objectif**: Vérifier que la liste des notifications s'ouvre au clic.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des notifications

**Étapes**:
1. Cliquer sur le widget de notifications
2. Observer la liste des notifications qui s'affiche

**Résultats Attendus**:
- ✅ Une dropdown ou modal s'ouvre avec la liste des notifications
- ✅ Les notifications sont affichées par ordre chronologique (plus récentes en premier)
- ✅ Les notifications non lues sont distinguées visuellement
- ✅ Chaque notification affiche:
  - Titre
  - Message
  - Date/heure
  - Type (icône ou badge)
  - Lien vers l'entité concernée

---

### Test 4.3 - Notification Automatique lors d'Assignation de Recommandation

**Objectif**: Vérifier qu'une notification est créée lors de l'assignation d'une recommandation.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recommandation à assigner

**Étapes**:
1. Assigner une recommandation à un utilisateur
2. Se connecter en tant que l'utilisateur assigné
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "recommandation_nouvelle" ou "recommandation_assignee"
- ✅ Titre: "Nouvelle recommandation assignée"
- ✅ Message: Contient les détails de la recommandation
- ✅ Lien: Pointe vers la page de la recommandation
- ✅ Priorité: Selon la priorité de la recommandation

---

### Test 4.4 - Notification Automatique pour Échéance Approchante (7 jours)

**Objectif**: Vérifier qu'une notification est créée 7 jours avant l'échéance.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recommandation avec échéance dans 7 jours
- Attendre l'exécution du job quotidien (ou simuler)

**Étapes**:
1. Créer une recommandation avec échéance dans 7 jours
2. Attendre l'exécution du job de vérification des échéances (ou simuler)
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "recommandation_echeance"
- ✅ Titre: "Échéance approchante"
- ✅ Message: Indique que l'échéance est dans 7 jours
- ✅ Priorité: "normale" ou "haute"

---

### Test 4.5 - Notification Automatique pour Échéance Approchante (3 jours)

**Objectif**: Vérifier qu'une notification est créée 3 jours avant l'échéance.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recommandation avec échéance dans 3 jours

**Étapes**:
1. Créer une recommandation avec échéance dans 3 jours
2. Attendre l'exécution du job (ou simuler)
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "recommandation_echeance"
- ✅ Priorité: "haute" (plus urgente que celle à 7 jours)

---

### Test 4.6 - Notification Automatique pour Échéance Approchante (1 jour)

**Objectif**: Vérifier qu'une notification est créée 1 jour avant l'échéance.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recommandation avec échéance dans 1 jour

**Étapes**:
1. Créer une recommandation avec échéance dans 1 jour
2. Attendre l'exécution du job (ou simuler)
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "recommandation_echeance"
- ✅ Priorité: "urgente"

---

### Test 4.7 - Notification Automatique pour Recommandation en Retard

**Objectif**: Vérifier qu'une notification est créée pour les recommandations en retard.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recommandation avec échéance dépassée

**Étapes**:
1. Créer une recommandation avec échéance dépassée
2. Attendre l'exécution du job (ou simuler)
3. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "recommandation_retard"
- ✅ Titre: "Recommandation en retard"
- ✅ Message: Indique le nombre de jours de retard
- ✅ Priorité: "urgente"

---

### Test 4.8 - Marquer une Notification comme Lue

**Objectif**: Vérifier qu'on peut marquer une notification comme lue.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des notifications non lues

**Étapes**:
1. Ouvrir la liste des notifications
2. Cliquer sur une notification non lue
3. Observer que la notification est marquée comme lue
4. Vérifier que le badge de notifications non lues est mis à jour

**Résultats Attendus**:
- ✅ La notification est marquée comme lue
- ✅ L'indicateur visuel change (couleur, style)
- ✅ Le badge de notifications non lues est décrémenté
- ✅ La date de lecture est enregistrée

---

### Test 4.9 - Marquer Toutes les Notifications comme Lues

**Objectif**: Vérifier qu'on peut marquer toutes les notifications comme lues.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir plusieurs notifications non lues

**Étapes**:
1. Ouvrir la liste des notifications
2. Cliquer sur "Marquer toutes comme lues"
3. Observer que toutes les notifications sont marquées comme lues

**Résultats Attendus**:
- ✅ Toutes les notifications sont marquées comme lues
- ✅ Le badge de notifications non lues passe à 0
- ✅ Les indicateurs visuels sont mis à jour

---

### Test 4.10 - Filtrage des Notifications par Type

**Objectif**: Vérifier que le filtrage par type fonctionne.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir des notifications de différents types

**Étapes**:
1. Ouvrir la liste des notifications
2. Filtrer par type "recommandation_echeance"
3. Observer les notifications filtrées
4. Changer le filtre pour un autre type

**Résultats Attendus**:
- ✅ Seules les notifications du type sélectionné sont affichées
- ✅ Le filtre fonctionne correctement
- ✅ Le nombre de notifications filtrées est affiché

---

### Test 4.11 - Polling Automatique des Notifications

**Objectif**: Vérifier que les notifications sont mises à jour automatiquement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une session active

**Étapes**:
1. Observer le widget de notifications
2. Attendre 30 secondes (ou simuler la création d'une nouvelle notification)
3. Observer que le badge est mis à jour automatiquement

**Résultats Attendus**:
- ✅ Les notifications sont rafraîchies automatiquement toutes les 30 secondes
- ✅ Le badge est mis à jour sans rechargement de page
- ✅ Les nouvelles notifications apparaissent dans la liste

---

## User Story 5 - Recherches Enregistrées et Alertes

**Menu**: RSO → Recherches Enregistrées  
**URL**: `/rso/recherches-enregistrees`

### Test 5.1 - Enregistrer une Recherche

**Objectif**: Vérifier qu'on peut enregistrer une recherche.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir effectué une recherche avec des critères

**Étapes**:
1. Effectuer une recherche avec des critères:
   - Mot-clé: "évacuation"
   - Année: 2024
   - Installation: Port de commerce
   - Type: Entraînement
2. Cliquer sur "Enregistrer cette recherche"
3. Remplir le formulaire:
   - Nom: "Recherche évacuation 2024"
   - Description: "Recherche des activités d'évacuation pour 2024"
4. Sauvegarder

**Résultats Attendus**:
- ✅ La recherche est enregistrée avec succès
- ✅ La recherche apparaît dans la liste des recherches enregistrées
- ✅ Tous les critères sont sauvegardés (query, filters, sort)

---

### Test 5.2 - Exécuter une Recherche Enregistrée

**Objectif**: Vérifier qu'on peut exécuter une recherche enregistrée.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Cliquer sur "Exécuter" pour une recherche enregistrée
3. Observer les résultats

**Résultats Attendus**:
- ✅ La recherche est exécutée avec les critères sauvegardés
- ✅ Les résultats s'affichent
- ✅ La navigation vers la page de recherche avancée avec les critères pré-remplis est possible

---

### Test 5.3 - Modifier une Recherche Enregistrée

**Objectif**: Vérifier qu'on peut modifier une recherche enregistrée.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Cliquer sur "Modifier" pour une recherche
3. Modifier le nom et/ou les critères
4. Sauvegarder

**Résultats Attendus**:
- ✅ La recherche est modifiée avec succès
- ✅ Les modifications sont visibles dans la liste
- ✅ Les critères modifiés sont sauvegardés

---

### Test 5.4 - Supprimer une Recherche Enregistrée

**Objectif**: Vérifier qu'on peut supprimer une recherche enregistrée.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Cliquer sur "Supprimer" pour une recherche
3. Confirmer la suppression

**Résultats Attendus**:
- ✅ La recherche est supprimée avec succès
- ✅ La recherche disparaît de la liste
- ✅ Aucune erreur n'est générée

---

### Test 5.5 - Activer les Alertes pour une Recherche Enregistrée

**Objectif**: Vérifier qu'on peut activer les alertes pour une recherche enregistrée.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Cliquer sur "Configurer les alertes" pour une recherche
3. Activer les notifications
4. Sélectionner la fréquence: "Quotidien"
5. Sauvegarder

**Résultats Attendus**:
- ✅ Les alertes sont activées
- ✅ La fréquence est sauvegardée
- ✅ Un indicateur visuel montre que les alertes sont actives
- ✅ La prochaine exécution est planifiée

---

### Test 5.6 - Désactiver les Alertes pour une Recherche Enregistrée

**Objectif**: Vérifier qu'on peut désactiver les alertes.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée avec alertes activées

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Cliquer sur "Configurer les alertes" pour une recherche
3. Désactiver les notifications
4. Sauvegarder

**Résultats Attendus**:
- ✅ Les alertes sont désactivées
- ✅ L'indicateur visuel est mis à jour
- ✅ La recherche n'est plus exécutée automatiquement

---

### Test 5.7 - Réception d'une Notification d'Alerte (Nouveaux Résultats)

**Objectif**: Vérifier qu'on reçoit une notification quand de nouveaux résultats correspondent à une recherche enregistrée.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée avec alertes activées
- Créer une nouvelle activité correspondant aux critères

**Étapes**:
1. Créer une recherche enregistrée avec alertes quotidiennes
2. Attendre l'exécution du job (ou simuler)
3. Créer une nouvelle activité correspondant aux critères
4. Attendre la prochaine exécution du job
5. Vérifier les notifications

**Résultats Attendus**:
- ✅ Une notification est créée automatiquement
- ✅ Type: "activite_nouvelle" ou "recherche_alerte"
- ✅ Titre: "Nouveaux résultats pour votre recherche"
- ✅ Message: Indique le nombre de nouveaux résultats
- ✅ Lien: Pointe vers les résultats de la recherche

---

### Test 5.8 - Fréquence des Alertes (Quotidien)

**Objectif**: Vérifier que les alertes quotidiennes fonctionnent.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée avec alertes quotidiennes

**Étapes**:
1. Configurer une recherche avec alertes quotidiennes
2. Attendre l'exécution du job quotidien (ou simuler)
3. Vérifier que la recherche est exécutée une fois par jour

**Résultats Attendus**:
- ✅ La recherche est exécutée une fois par jour
- ✅ Les notifications sont créées si de nouveaux résultats sont trouvés
- ✅ La date de dernière notification est mise à jour

---

### Test 5.9 - Fréquence des Alertes (Hebdomadaire)

**Objectif**: Vérifier que les alertes hebdomadaires fonctionnent.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir une recherche enregistrée avec alertes hebdomadaires

**Étapes**:
1. Configurer une recherche avec alertes hebdomadaires
2. Attendre l'exécution du job hebdomadaire (ou simuler)
3. Vérifier que la recherche est exécutée une fois par semaine

**Résultats Attendus**:
- ✅ La recherche est exécutée une fois par semaine
- ✅ Les notifications sont créées si de nouveaux résultats sont trouvés
- ✅ La date de dernière notification est mise à jour

---

### Test 5.10 - Liste des Recherches Enregistrées

**Objectif**: Vérifier que la liste des recherches enregistrées s'affiche correctement.

**Prérequis**:
- Être connecté en tant que Formateur RSO
- Avoir plusieurs recherches enregistrées

**Étapes**:
1. Accéder à "RSO → Recherches Enregistrées"
2. Observer la liste des recherches

**Résultats Attendus**:
- ✅ La liste affiche toutes les recherches enregistrées
- ✅ Chaque recherche affiche:
  - Nom
  - Description (si présente)
  - Critères (résumé)
  - Statut des alertes (actif/inactif)
  - Date de dernière exécution
  - Actions (Exécuter, Modifier, Supprimer, Configurer alertes)

---

## User Story 6 - Rapports Planifiés et Exports

**Menu**: RSO → Rapports Planifiés  
**URL**: `/rso/rapports-planifies`

### Test 6.1 - Création d'un Rapport Planifié (Admin)

**Objectif**: Vérifier qu'un administrateur peut créer un rapport planifié.

**Prérequis**:
- Être connecté en tant qu'Administrateur

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Créer un rapport planifié"
3. Remplir le formulaire:
   - Nom: "Rapport mensuel des activités"
   - Description: "Rapport mensuel de toutes les activités"
   - Type: "Activités"
   - Fréquence: "Mensuel"
   - Jour du mois: 1
   - Heure: 08:00
   - Format: "PDF"
   - Email destinataires: ["admin@aspci.ci", "formateur@aspci.ci"]
   - Paramètres: Filtrer par année 2024
4. Sauvegarder

**Résultats Attendus**:
- ✅ Le rapport planifié est créé avec succès
- ✅ Le rapport apparaît dans la liste
- ✅ La prochaine exécution est calculée automatiquement
- ✅ Le statut est "Actif" par défaut

---

### Test 6.2 - Modification d'un Rapport Planifié

**Objectif**: Vérifier qu'on peut modifier un rapport planifié.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié existant

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Modifier" pour un rapport
3. Modifier la fréquence: "Hebdomadaire"
4. Modifier le jour de la semaine: Lundi
5. Sauvegarder

**Résultats Attendus**:
- ✅ Le rapport est modifié avec succès
- ✅ La prochaine exécution est recalculée
- ✅ Les modifications sont visibles dans la liste

---

### Test 6.3 - Désactivation d'un Rapport Planifié

**Objectif**: Vérifier qu'on peut désactiver un rapport planifié.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié actif

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Désactiver" pour un rapport
3. Confirmer la désactivation

**Résultats Attendus**:
- ✅ Le rapport est désactivé
- ✅ Le statut passe à "Inactif"
- ✅ Le rapport n'est plus exécuté automatiquement
- ✅ L'indicateur visuel est mis à jour

---

### Test 6.4 - Suppression d'un Rapport Planifié

**Objectif**: Vérifier qu'on peut supprimer un rapport planifié.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Supprimer" pour un rapport
3. Confirmer la suppression

**Résultats Attendus**:
- ✅ Le rapport est supprimé avec succès
- ✅ Le rapport disparaît de la liste
- ✅ Aucune erreur n'est générée

---

### Test 6.5 - Exécution Manuelle d'un Rapport Planifié

**Objectif**: Vérifier qu'on peut exécuter manuellement un rapport planifié.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Exécuter maintenant" pour un rapport
3. Observer la génération du rapport
4. Vérifier que le rapport est généré et envoyé

**Résultats Attendus**:
- ✅ Le rapport est généré immédiatement
- ✅ Le rapport est envoyé par email (si configuré)
- ✅ La date de dernière exécution est mise à jour
- ✅ L'historique d'exécution est enregistré

---

### Test 6.6 - Exécution Automatique d'un Rapport Planifié (Quotidien)

**Objectif**: Vérifier qu'un rapport planifié quotidien s'exécute automatiquement.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec fréquence "Quotidien"

**Étapes**:
1. Créer un rapport planifié quotidien à 08:00
2. Attendre l'exécution du job (ou simuler)
3. Vérifier que le rapport est généré et envoyé

**Résultats Attendus**:
- ✅ Le rapport est exécuté automatiquement à l'heure configurée
- ✅ Le rapport est généré dans le format configuré
- ✅ Le rapport est envoyé par email aux destinataires
- ✅ La date de dernière exécution est mise à jour
- ✅ La prochaine exécution est calculée

---

### Test 6.7 - Exécution Automatique d'un Rapport Planifié (Mensuel)

**Objectif**: Vérifier qu'un rapport planifié mensuel s'exécute automatiquement.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec fréquence "Mensuel"

**Étapes**:
1. Créer un rapport planifié mensuel le 1er de chaque mois à 08:00
2. Attendre l'exécution du job (ou simuler)
3. Vérifier que le rapport est généré et envoyé

**Résultats Attendus**:
- ✅ Le rapport est exécuté automatiquement le 1er du mois
- ✅ Le rapport est généré dans le format configuré
- ✅ Le rapport est envoyé par email
- ✅ La date de dernière exécution est mise à jour

---

### Test 6.8 - Génération de Rapport PDF

**Objectif**: Vérifier que la génération de rapport PDF fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec format PDF

**Étapes**:
1. Exécuter un rapport planifié avec format PDF
2. Télécharger le fichier PDF généré
3. Ouvrir le PDF et vérifier le contenu

**Résultats Attendus**:
- ✅ Le fichier PDF est généré avec succès
- ✅ Le PDF contient toutes les données demandées
- ✅ Le format est professionnel et lisible
- ✅ Le PDF s'ouvre correctement dans un lecteur PDF

---

### Test 6.9 - Génération de Rapport Excel

**Objectif**: Vérifier que la génération de rapport Excel fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec format Excel

**Étapes**:
1. Exécuter un rapport planifié avec format Excel
2. Télécharger le fichier Excel généré
3. Ouvrir le fichier Excel et vérifier le contenu

**Résultats Attendus**:
- ✅ Le fichier Excel est généré avec succès
- ✅ Le fichier contient toutes les données dans un tableau
- ✅ Le fichier s'ouvre correctement dans Excel ou LibreOffice
- ✅ Les données sont correctement formatées

---

### Test 6.10 - Génération de Rapport CSV

**Objectif**: Vérifier que la génération de rapport CSV fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec format CSV

**Étapes**:
1. Exécuter un rapport planifié avec format CSV
2. Télécharger le fichier CSV généré
3. Ouvrir le fichier CSV et vérifier le contenu

**Résultats Attendus**:
- ✅ Le fichier CSV est généré avec succès
- ✅ Le fichier contient toutes les données
- ✅ Le fichier s'ouvre correctement dans Excel ou un éditeur de texte
- ✅ Les données sont correctement séparées par virgules

---

### Test 6.11 - Envoi par Email d'un Rapport

**Objectif**: Vérifier que l'envoi par email fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec email destinataires configurés

**Étapes**:
1. Exécuter un rapport planifié avec email configuré
2. Vérifier la boîte mail des destinataires
3. Ouvrir l'email et vérifier la pièce jointe

**Résultats Attendus**:
- ✅ L'email est envoyé aux destinataires configurés
- ✅ L'email contient le rapport en pièce jointe
- ✅ Le sujet de l'email est approprié
- ✅ Le corps de l'email contient des informations sur le rapport

---

### Test 6.12 - Historique d'Exécution des Rapports

**Objectif**: Vérifier que l'historique d'exécution s'affiche.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir un rapport planifié avec des exécutions

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Cliquer sur "Voir l'historique" pour un rapport
3. Observer l'historique des exécutions

**Résultats Attendus**:
- ✅ L'historique affiche toutes les exécutions
- ✅ Chaque exécution affiche:
  - Date et heure d'exécution
  - Statut (succès/échec)
  - Format généré
  - Destinataires
  - Lien de téléchargement (si disponible)
- ✅ Les exécutions sont triées par date (plus récentes en premier)

---

### Test 6.13 - Filtrage des Rapports Planifiés

**Objectif**: Vérifier que le filtrage des rapports fonctionne.

**Prérequis**:
- Être connecté en tant qu'Administrateur
- Avoir plusieurs rapports planifiés avec différents statuts

**Étapes**:
1. Accéder à "RSO → Rapports Planifiés"
2. Filtrer par statut "Actif"
3. Observer les rapports filtrés
4. Filtrer par type "Activités"
5. Observer les rapports filtrés

**Résultats Attendus**:
- ✅ Le filtrage par statut fonctionne
- ✅ Le filtrage par type fonctionne
- ✅ Seuls les rapports correspondants sont affichés
- ✅ Le nombre de rapports filtrés est affiché

---

## Workflow de Test Complet

### Workflow 1 - Cycle Complet de Recherche et Tags

**Objectif**: Tester un cycle complet depuis la création de tags jusqu'à la recherche.

**Prérequis**:
- Être connecté en tant qu'Administrateur puis Formateur RSO

**Étapes**:
1. **Création de Tags (Admin)**
   - Créer 3 tags: "évacuation", "sécurité incendie", "audit"
   - Vérifier qu'ils apparaissent dans la liste

2. **Association de Tags (Formateur)**
   - Se connecter en tant que Formateur
   - Associer les tags à des activités existantes
   - Vérifier que les tags apparaissent sur les activités

3. **Recherche avec Tags**
   - Effectuer une recherche avec le tag "évacuation"
   - Vérifier que seules les activités avec ce tag sont affichées
   - Combiner avec d'autres filtres (année, installation)

4. **Enregistrement de Recherche**
   - Enregistrer la recherche avec les critères
   - Vérifier qu'elle apparaît dans les recherches enregistrées

5. **Alertes**
   - Activer les alertes pour la recherche enregistrée
   - Créer une nouvelle activité correspondant aux critères
   - Vérifier qu'une notification est reçue

**Résultats Attendus**:
- ✅ Toutes les étapes fonctionnent correctement
- ✅ Les tags sont cohérents entre les différentes vues
- ✅ La recherche fonctionne avec les tags
- ✅ Les alertes fonctionnent

---

### Workflow 2 - Cycle Complet de Recommandations et Notifications

**Objectif**: Tester un cycle complet de gestion des recommandations avec notifications.

**Prérequis**:
- Être connecté en tant que Formateur RSO

**Étapes**:
1. **Création de Recommandation**
   - Créer une recommandation avec échéance dans 7 jours
   - Assigner la recommandation à un utilisateur

2. **Notification d'Assignation**
   - Se connecter en tant que l'utilisateur assigné
   - Vérifier qu'une notification est reçue

3. **Tableau de Bord**
   - Accéder au tableau de bord des recommandations
   - Vérifier que la recommandation apparaît dans les statistiques
   - Vérifier qu'elle apparaît dans "Échéances proches"

4. **Notification d'Échéance**
   - Attendre ou simuler l'approche de l'échéance (7 jours, 3 jours, 1 jour)
   - Vérifier que les notifications sont créées

5. **Notification de Retard**
   - Laisser passer l'échéance
   - Vérifier qu'une notification de retard est créée
   - Vérifier que la recommandation apparaît dans "En retard" du tableau de bord

**Résultats Attendus**:
- ✅ Toutes les notifications sont créées automatiquement
- ✅ Le tableau de bord affiche les bonnes statistiques
- ✅ Les notifications sont visibles dans le widget

---

### Workflow 3 - Cycle Complet de Rapports Planifiés

**Objectif**: Tester un cycle complet de création et d'exécution de rapports planifiés.

**Prérequis**:
- Être connecté en tant qu'Administrateur

**Étapes**:
1. **Création de Rapport**
   - Créer un rapport planifié mensuel
   - Configurer les paramètres (filtres, format, email)
   - Vérifier que le rapport est créé

2. **Exécution Manuelle**
   - Exécuter le rapport manuellement
   - Vérifier que le rapport est généré
   - Vérifier que l'email est envoyé

3. **Exécution Automatique**
   - Attendre ou simuler l'exécution automatique
   - Vérifier que le rapport est généré automatiquement
   - Vérifier que l'email est envoyé

4. **Historique**
   - Consulter l'historique d'exécution
   - Vérifier que toutes les exécutions sont enregistrées

5. **Désactivation**
   - Désactiver le rapport
   - Vérifier qu'il n'est plus exécuté automatiquement

**Résultats Attendus**:
- ✅ Le rapport est créé correctement
- ✅ L'exécution manuelle fonctionne
- ✅ L'exécution automatique fonctionne
- ✅ L'historique est complet
- ✅ La désactivation fonctionne

---

## ✅ Checklist de Validation Finale

### Fonctionnalités Core
- [ ] Recherche avancée par mot-clé fonctionne
- [ ] Auto-complétion fonctionne
- [ ] Filtrage par année fonctionne
- [ ] Filtrage par installation fonctionne
- [ ] Filtrage par type d'activité fonctionne
- [ ] Filtrage par statut fonctionne
- [ ] Filtrage par tags fonctionne
- [ ] Filtrage par période de date fonctionne
- [ ] Combinaison de plusieurs filtres fonctionne
- [ ] Tri des résultats fonctionne
- [ ] Pagination fonctionne
- [ ] Recherche dans les recommandations fonctionne
- [ ] Export des résultats fonctionne
- [ ] Création de tags fonctionne (admin)
- [ ] Modification de tags fonctionne (admin)
- [ ] Désactivation de tags fonctionne (admin)
- [ ] Suppression de tags non utilisés fonctionne (admin)
- [ ] Association de tags aux activités fonctionne (formateur)
- [ ] Retrait de tags fonctionne (formateur)
- [ ] Affichage des tags sur les activités fonctionne
- [ ] Tableau de bord des recommandations fonctionne
- [ ] Statistiques globales s'affichent
- [ ] Graphiques d'évolution fonctionnent
- [ ] Liste des recommandations en retard fonctionne
- [ ] Liste des échéances proches fonctionne
- [ ] Filtrage par installation dans le tableau de bord fonctionne
- [ ] Widget de notifications fonctionne
- [ ] Notifications automatiques fonctionnent
- [ ] Marquer notifications comme lues fonctionne
- [ ] Filtrage des notifications fonctionne
- [ ] Polling automatique des notifications fonctionne
- [ ] Enregistrement de recherches fonctionne
- [ ] Exécution de recherches enregistrées fonctionne
- [ ] Alertes pour recherches enregistrées fonctionnent
- [ ] Création de rapports planifiés fonctionne (admin)
- [ ] Exécution manuelle de rapports fonctionne
- [ ] Exécution automatique de rapports fonctionne
- [ ] Génération PDF fonctionne
- [ ] Génération Excel fonctionne
- [ ] Génération CSV fonctionne
- [ ] Envoi par email fonctionne
- [ ] Historique d'exécution fonctionne

### Sécurité
- [ ] Les permissions sont respectées (admin vs formateur)
- [ ] Les utilisateurs ne voient que leurs propres recherches enregistrées
- [ ] Les utilisateurs ne voient que leurs propres notifications
- [ ] Les RLS policies sont appliquées
- [ ] La validation des entrées fonctionne

### Performance
- [ ] La recherche retourne des résultats en < 2 secondes
- [ ] L'auto-complétion fonctionne avec debouncing
- [ ] Le polling des notifications ne surcharge pas le serveur
- [ ] Les graphiques se chargent rapidement
- [ ] La pagination fonctionne correctement

### Interface Utilisateur
- [ ] Les messages d'erreur sont clairs
- [ ] Les indicateurs de chargement fonctionnent
- [ ] Les notifications sont visibles et accessibles
- [ ] Les graphiques sont lisibles et professionnels
- [ ] Le responsive design fonctionne
- [ ] Les badges et indicateurs visuels fonctionnent

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

