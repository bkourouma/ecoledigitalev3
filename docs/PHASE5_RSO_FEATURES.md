# Phase 5: Recherche Avancée et Gestion des Recommandations

**Date**: 2025-01-27  
**Branch**: `025-phase`

## Vue d'ensemble

Phase 5 implémente un système complet de recherche avancée et de gestion des recommandations pour la plateforme RSO-PFSO. Cette phase ajoute des fonctionnalités de recherche multi-critères, un système de tags, un tableau de bord des recommandations, des notifications automatiques, des recherches enregistrées avec alertes, et la génération de rapports planifiés.

## Fonctionnalités principales

### 1. Recherche Avancée Multi-Critères

- **Recherche full-text** : Recherche dans les activités et recommandations avec support de la langue française
- **Filtres multiples** : Année, installation, type d'activité, statut, tags, dates
- **Autocomplétion** : Suggestions en temps réel lors de la saisie
- **Tri par pertinence** : Résultats classés par pertinence avec surlignage des mots-clés
- **Pagination** : Navigation efficace dans les résultats
- **Export** : Export des résultats en PDF, Excel, CSV

**Routes API** :
- `POST /api/v1/rso/search` - Effectuer une recherche
- `GET /api/v1/rso/search/suggestions` - Obtenir des suggestions
- `POST /api/v1/rso/search/export` - Exporter les résultats

### 2. Système de Tags et Catégorisation

- **Gestion des tags** : Création, modification, suppression de tags par catégories
- **Association aux activités** : Association de tags multiples aux activités
- **Filtrage par tags** : Utilisation des tags dans la recherche avancée
- **Catégories** : Thèmes, Priorité, Type d'incident, Équipement, Zone, Autre
- **Compteur d'utilisation** : Suivi du nombre d'utilisations de chaque tag

**Routes API** :
- `GET /api/v1/rso/tags` - Lister les tags
- `POST /api/v1/rso/tags` - Créer un tag
- `PUT /api/v1/rso/tags/:id` - Modifier un tag
- `DELETE /api/v1/rso/tags/:id` - Supprimer un tag
- `POST /api/v1/rso/activites/:id/tags` - Associer des tags à une activité

### 3. Tableau de Bord des Recommandations

- **Statistiques** : Total, en attente, en cours, terminées, validées, en retard
- **Graphiques** : Évolution mensuelle, répartition par priorité
- **Recommandations en retard** : Liste des recommandations dépassant leur échéance
- **Échéances proches** : Alertes pour les échéances dans les 7 prochains jours
- **Filtrage** : Par période, installation, statut

**Routes API** :
- `GET /api/v1/rso/recommandations/dashboard` - Données complètes du tableau de bord
- `GET /api/v1/rso/recommandations/statistiques` - Statistiques uniquement
- `GET /api/v1/rso/recommandations/en-retard` - Recommandations en retard
- `GET /api/v1/rso/recommandations/echeance-proche` - Échéances proches

### 4. Notifications et Alertes Automatiques

- **Notifications automatiques** : Création automatique lors d'événements importants
- **Types de notifications** :
  - Nouvelle recommandation assignée
  - Échéance approchant (7, 3, 1 jours)
  - Recommandation en retard
  - Nouvelle activité
  - Commentaire ajouté
  - Validation requise
- **Widget de notifications** : Affichage dans l'en-tête avec compteur de non-lues
- **Polling** : Mise à jour automatique toutes les 30 secondes
- **Rate limiting** : Limite de 10 notifications par minute par utilisateur

**Routes API** :
- `GET /api/v1/rso/notifications` - Lister les notifications
- `GET /api/v1/rso/notifications/non-lues` - Compter les non-lues
- `PATCH /api/v1/rso/notifications/:id/lire` - Marquer comme lue
- `PATCH /api/v1/rso/notifications/marquer-toutes-lues` - Tout marquer comme lu

### 5. Recherches Enregistrées et Alertes

- **Sauvegarde de recherches** : Enregistrement des critères de recherche fréquemment utilisés
- **Alertes automatiques** : Notifications lorsque de nouveaux résultats correspondent
- **Fréquences** : Immédiate, quotidienne, hebdomadaire
- **Exécution automatique** : Vérification horaire des recherches avec alertes actives

**Routes API** :
- `GET /api/v1/rso/recherches-enregistrees` - Lister les recherches enregistrées
- `POST /api/v1/rso/recherches-enregistrees` - Créer une recherche enregistrée
- `PUT /api/v1/rso/recherches-enregistrees/:id` - Modifier une recherche
- `DELETE /api/v1/rso/recherches-enregistrees/:id` - Supprimer une recherche
- `POST /api/v1/rso/recherches-enregistrees/:id/executer` - Exécuter manuellement

### 6. Rapports Planifiés et Exports

- **Génération automatique** : Rapports générés selon une planification configurée
- **Fréquences** : Quotidien, hebdomadaire, mensuel, trimestriel
- **Formats** : PDF, Excel, CSV, Email
- **Types de rapports** : Activités, Recommandations, Statistiques, Personnalisé
- **Livraison par email** : Envoi automatique aux destinataires configurés
- **Historique d'exécution** : Suivi des exécutions passées
- **Retry logic** : Nouvelle tentative automatique en cas d'échec (jusqu'à 3 tentatives)

**Routes API** :
- `GET /api/v1/rso/rapports-planifies` - Lister les rapports planifiés
- `POST /api/v1/rso/rapports-planifies` - Créer un rapport planifié
- `PUT /api/v1/rso/rapports-planifies/:id` - Modifier un rapport
- `DELETE /api/v1/rso/rapports-planifies/:id` - Supprimer un rapport
- `POST /api/v1/rso/rapports-planifies/:id/executer` - Exécuter immédiatement

### 7. Historique des Recommandations

- **Traçabilité complète** : Enregistrement de tous les changements et événements
- **Types d'actions** : Création, modification, changement de statut, commentaire, validation, clôture
- **Détails des modifications** : Suivi des valeurs avant/après pour chaque champ modifié
- **Affichage** : Historique visible dans les détails de chaque recommandation

**Routes API** :
- `GET /api/v1/rso/formateur/recommandations/:id/historique` - Récupérer l'historique

## Architecture technique

### Base de données

**Nouvelles tables** :
- `rso_tags` - Tags pour catégorisation
- `rso_activites_tags` - Association activités-tags
- `rso_recherches_enregistrees` - Recherches sauvegardées
- `rso_notifications` - Notifications utilisateurs
- `rso_rapports_planifies` - Configuration des rapports planifiés
- `rso_recommandations_historique` - Historique des recommandations

**Tables modifiées** :
- `rso_recommandations` - Colonnes supplémentaires (categorie, impact, cout_estime, etc.)

**Index de performance** :
- Index GIN pour la recherche full-text sur activités et recommandations
- Index sur les colonnes fréquemment filtrées (statut, priorité, date_echeance, etc.)

### Services backend

- `SearchService` - Logique de recherche et exécution des requêtes
- `SearchQueryBuilder` - Construction des requêtes PostgreSQL
- `SearchSuggestionsService` - Génération des suggestions d'autocomplétion
- `TagService` - Gestion CRUD des tags
- `TagAssociationService` - Association tags-activités
- `NotificationService` - Création et gestion des notifications
- `NotificationSchedulerService` - Planification des notifications automatiques
- `SavedSearchService` - Gestion des recherches enregistrées
- `SavedSearchExecutorService` - Exécution des alertes de recherche
- `ScheduledReportService` - Gestion des rapports planifiés
- `ReportGeneratorService` - Génération des rapports (PDF, Excel, CSV)
- `RecommendationDashboardService` - Agrégation des données du tableau de bord
- `RecommendationHistoryService` - Traçabilité des recommandations

### Jobs en arrière-plan

- **check-echeances.job.ts** : Vérification quotidienne des échéances (8h00)
- **execute-saved-searches.job.ts** : Exécution horaire des recherches enregistrées
- **execute-rapports-planifies.job.ts** : Exécution horaire des rapports planifiés
- **cleanup-notifications.job.ts** : Nettoyage hebdomadaire des anciennes notifications (lundi 2h00)

### Composants frontend

**Pages** :
- `/rso/recherche-avancee` - Page de recherche avancée
- `/rso/admin/tags` - Gestion des tags
- `/rso/recommandations/dashboard` - Tableau de bord des recommandations
- `/rso/recherches-enregistrees` - Recherches enregistrées
- `/rso/rapports-planifies` - Rapports planifiés

**Composants réutilisables** (packages/ui) :
- `SearchAutocomplete` - Autocomplétion de recherche
- `TagSelector` - Sélecteur de tags
- `TagBadge` - Badge d'affichage de tag
- `NotificationWidget` - Widget de notifications

## Performance

- **Recherche** : Résultats en < 2 secondes même avec filtres complexes
- **Précision** : 95% de précision dans les résultats
- **Tableau de bord** : Chargement en < 3 secondes
- **Notifications** : Livraison en < 1 minute après déclenchement
- **Rapports** : Génération en < 30 secondes pour jusqu'à 1000 éléments

## Sécurité

- **Authentification** : Tous les endpoints requièrent l'authentification RSO
- **Autorisation** : Vérification des permissions par rôle
- **Isolation multi-tenant** : Toutes les requêtes respectent l'isolation par tenant (RLS)
- **Validation** : Validation Zod pour tous les inputs
- **Rate limiting** : Limitation des notifications pour éviter la surcharge
- **Sanitization** : Nettoyage des requêtes de recherche pour prévenir l'injection SQL

## Migration

La migration `0025_rso_phase5_search_recommendations.sql` crée :
- 6 nouvelles tables
- Colonnes supplémentaires sur `rso_recommandations`
- Index de performance (GIN pour full-text, index sur colonnes fréquentes)
- Politiques RLS pour l'isolation multi-tenant
- Triggers pour la mise à jour automatique des timestamps

## Tests

- **Tests unitaires** : Services de recherche, tags, notifications, rapports
- **Tests d'intégration** : Endpoints API avec différents scénarios
- **Tests E2E** : Workflows complets avec Playwright

## Documentation supplémentaire

- `specs/025-phase/plan.md` - Plan d'implémentation détaillé
- `specs/025-phase/data-model.md` - Modèle de données complet
- `specs/025-phase/quickstart.md` - Guide de démarrage rapide
- `specs/025-phase/research.md` - Décisions techniques
- `specs/025-phase/contracts/` - Contrats API TypeScript

## Prochaines étapes

1. Tests de performance en production
2. Optimisation supplémentaire si nécessaire
3. Formation des utilisateurs
4. Collecte de feedback pour améliorations futures









