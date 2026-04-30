# Guide de Validation - Refactoring du Système d'Assignation

## 🎯 Objectif

Ce guide décrit comment valider que le refactoring du système d'assignation a été implémenté correctement selon le PRP `/docs/prp_assignments_refactor.md`.

## 📋 Résumé des Changements

### Avant (Système basé sur les statuts)
- Assignments avec statuts : `draft`, `published`, `archived`
- Logique de publication/dépublication
- Paramètres figés au niveau de l'assignment
- Un assignment = une utilisation

### Après (Système basé sur les instances)
- Assignments sans statut (toujours réutilisables)
- Assignment instances pour chaque assignation à une classe
- Paramètres personnalisables par instance
- Un assignment = multiples utilisations possibles

## 🧪 Tests de Validation

### 1. Tests Automatisés

#### A. Validation de la Base de Données
```bash
# Windows PowerShell
.\infra\scripts\validate_assignments_refactor.ps1

# Linux/Mac
./infra/scripts/validate_assignments_refactor.sh
```

#### B. Tests Individuels

**Test de la structure de base de données :**
```sql
psql -f infra/scripts/test_assignments_refactor.sql
```

**Test des APIs :**
```bash
node infra/scripts/test_api_assignments_refactor.js
```

**Test d'intégration complet :**
```bash
node infra/scripts/test_workflow_integration.js
```

### 2. Tests Manuels

#### A. Test de Création d'Assignment

1. **Accéder à l'interface de création :**
   - URL : `/academic/evaluations/create`
   - Vérifier que les champs de statut ont été supprimés
   - Vérifier que la planification a été supprimée

2. **Créer un assignment :**
   ```json
   {
     "course_id": "uuid-du-cours",
     "title": "Test Assignment",
     "description": "Assignment de test",
     "type": "evaluation",
     "duration_minutes": 90,
     "max_attempts": 2
   }
   ```

3. **Vérifications :**
   - ✅ Assignment créé sans champ `status`
   - ✅ Assignment immédiatement disponible pour assignation
   - ✅ Pas de logique de publication

#### B. Test d'Assignation à une Classe

1. **Accéder à l'interface d'assignation :**
   - URL : `/academic/assignments/assign`
   - Workflow : Classe → Cours → Assignment → Configuration → Validation

2. **Assigner l'assignment :**
   ```json
   {
     "assignment_id": "uuid-assignment",
     "class_id": "uuid-classe",
     "starts_at": "2024-01-15T09:00:00Z",
     "ends_at": "2024-01-22T17:00:00Z",
     "duration_minutes": 120,
     "max_attempts": 3
   }
   ```

3. **Vérifications :**
   - ✅ Assignment instance créée
   - ✅ Paramètres personnalisés appliqués
   - ✅ Assignment visible pour les étudiants de la classe

#### C. Test de l'Interface Étudiant

1. **Accès étudiant :**
   - Se connecter en tant qu'étudiant
   - Vérifier la liste des assignments disponibles

2. **Vérifications :**
   - ✅ Assignments basés sur les instances (pas sur le statut)
   - ✅ Seuls les assignments assignés à la classe de l'étudiant sont visibles
   - ✅ Dates et paramètres spécifiques à l'instance affichés

#### D. Test de Réutilisation

1. **Réassigner le même assignment :**
   - Utiliser le même assignment pour une autre classe
   - Appliquer des paramètres différents

2. **Vérifications :**
   - ✅ Même assignment utilisé pour plusieurs classes
   - ✅ Paramètres indépendants par classe
   - ✅ Pas de conflit entre les instances

## 🔍 Points de Contrôle Critiques

### 1. Base de Données

- [ ] Table `assignment_instances` créée avec les bonnes contraintes
- [ ] Politiques RLS appliquées pour l'isolation multi-tenant
- [ ] Index créés pour les performances
- [ ] Vues `student_assignments_view` et `teacher_assignments_view` fonctionnelles
- [ ] Migration des données existantes réussie

### 2. API Backend

- [ ] Endpoint `POST /api/v1/assignment-instances` fonctionnel
- [ ] Endpoint `GET /api/v1/assignment-instances/classes/:classId/assignments` fonctionnel
- [ ] Endpoint `GET /api/v1/assignment-instances/students/:studentId/assignments` fonctionnel
- [ ] Suppression des filtres par statut dans `/api/v1/assignments`
- [ ] Validation des données d'entrée correcte

### 3. Interface Frontend

- [ ] Interface de création simplifiée (sans statut)
- [ ] Nouvelle interface d'assignation fonctionnelle
- [ ] Interface étudiant adaptée aux instances
- [ ] Hooks React mis à jour
- [ ] Gestion d'erreur appropriée

### 4. Workflow Complet

- [ ] Création → Assignation → Accès étudiant fonctionne
- [ ] Paramètres personnalisables par instance
- [ ] Réutilisation d'assignments possible
- [ ] Gestion des dates et échéances
- [ ] Permissions et sécurité maintenues

## 🚨 Tests de Régression

### Fonctionnalités à Vérifier

1. **Soumissions d'assignments :**
   - Les soumissions existantes fonctionnent toujours
   - Nouvelles soumissions liées aux bonnes instances

2. **Corrections et notes :**
   - Système de correction inchangé
   - Affichage des résultats correct

3. **Rapports et statistiques :**
   - Rapports par classe fonctionnels
   - Statistiques d'assignments correctes

4. **Permissions et sécurité :**
   - RLS toujours actif
   - Isolation des tenants maintenue
   - Permissions enseignant/étudiant respectées

## 🔄 Plan de Rollback

En cas de problème, utiliser le script de rollback :

```sql
-- ATTENTION : Ceci supprimera toutes les assignment instances
psql -f infra/scripts/migrations/0018_assignments_refactor_rollback.sql
```

**⚠️ Important :** Le rollback supprimera toutes les assignment instances créées après la migration.

## 📊 Métriques de Performance

### Requêtes à Surveiller

1. **Récupération des assignments étudiants :**
   ```sql
   -- Doit s'exécuter en < 100ms
   SELECT ai.*, a.title FROM assignment_instances ai 
   JOIN assignments a ON a.id = ai.assignment_id 
   WHERE ai.class_id IN (SELECT class_id FROM student_enrollments WHERE student_id = $1)
   ```

2. **Assignation d'un assignment :**
   ```sql
   -- Doit s'exécuter en < 50ms
   INSERT INTO assignment_instances (assignment_id, class_id, teacher_id, ends_at) 
   VALUES ($1, $2, $3, $4)
   ```

### Seuils de Performance

- Création d'assignment : < 200ms
- Assignation à une classe : < 100ms
- Récupération assignments étudiant : < 150ms
- Liste assignments enseignant : < 200ms

## ✅ Checklist de Validation Finale

- [ ] Tous les tests automatisés passent
- [ ] Tests manuels réussis
- [ ] Performance acceptable
- [ ] Aucune régression détectée
- [ ] Documentation mise à jour
- [ ] Formation équipe réalisée
- [ ] Plan de rollback testé
- [ ] Monitoring en place

## 🚀 Déploiement

Une fois la validation complète :

1. **Staging :**
   - Déployer sur l'environnement de staging
   - Tests d'acceptation utilisateur
   - Tests de charge

2. **Production :**
   - Planifier une fenêtre de maintenance
   - Exécuter la migration
   - Surveiller les performances
   - Valider le fonctionnement

## 📞 Support

En cas de problème :
- Consulter les logs : `/tmp/*_test.log`
- Vérifier la base de données avec `validate_0018_migration.sql`
- Contacter l'équipe de développement

---

**Date de création :** 2024-01-XX  
**Version :** 1.0  
**Auteur :** Équipe de développement
