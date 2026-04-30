# PRP - Refactoring du Système de Devoirs et Évaluations EcoleDigitale

## 🎯 Goal
Refactoriser le système de devoirs et évaluations pour implémenter un nouveau workflow basé sur la réutilisabilité des contenus et l'assignation par classe plutôt que la publication directe.

## 🤔 Why
- **Réutilisabilité** : Les devoirs/évaluations deviennent des ressources réutilisables liées aux cours
- **Workflow simplifié** : Suppression des statuts draft/published/archived au profit d'un système d'assignation
- **Contrôle enseignant** : Seuls les enseignants peuvent assigner des contenus à leurs classes
- **Flexibilité** : Un même contenu peut être assigné à plusieurs classes avec des dates différentes

## 📋 What - Nouveau Workflow

### Phase 1 : Création des Contenus
1. **Enseignants et Administrateurs** peuvent créer des devoirs/évaluations
2. **Liaison obligatoire** à un cours spécifique
3. **Pas de notion de statut** (draft/published/archived)
4. **Contenus réutilisables** par défaut

### Phase 2 : Assignation par l'Enseignant
1. **Sélection d'une classe** par l'enseignant
2. **Affichage automatique** des cours liés à cette classe
3. **Liste des devoirs/évaluations** disponibles pour chaque cours
4. **Configuration de l'assignation** :
   - Date de début
   - Date de fin
   - Paramètres spécifiques (durée, tentatives, etc.)
5. **Validation de l'assignation**

### Success Criteria
- [ ] Suppression complète des statuts draft/published/archived
- [ ] Interface de création liée obligatoirement à un cours
- [ ] Nouvelle interface d'assignation par classe
- [ ] Système de dates d'assignation fonctionnel
- [ ] Conservation des fonctionnalités de soumission existantes
- [ ] Tests automatisés pour tous les nouveaux workflows
- [ ] Migration des données existantes

## 🔍 All Needed Context

### Documentation & References
- **file**: `# 📋 Processus Complet des Devoirs et Évaluations - EcoleDigitale` (document fourni)
  - **why**: Compréhension complète de l'architecture actuelle
- **Tables principales concernées**:
  - `assignments` : Suppression des statuts, ajout de logique de réutilisabilité
  - Nouvelle table `assignment_instances` : Gestion des assignations par classe
  - `courses`, `classes`, `teachers` : Relations existantes à préserver

### Architecture Actuelle à Modifier
```sql
-- Table assignments actuelle
CREATE TYPE assignment_status AS ENUM ('draft', 'published', 'archived'); -- À SUPPRIMER

-- Nouvelle structure nécessaire
CREATE TABLE assignment_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  tenant_id UUID NOT NULL,
  CONSTRAINT unique_assignment_class_period UNIQUE (assignment_id, class_id, starts_at, ends_at)
);
```

### Composants Frontend à Modifier
- **Pages de création** : `/academic/evaluations/create/` - Suppression de la gestion des statuts
- **Nouvelle interface d'assignation** : `/academic/assignments/assign/` - À créer
- **Interface étudiant** : Affichage basé sur les assignations plutôt que le statut published

### Known Gotchas
- **CRITIQUE** : Préserver les soumissions existantes lors de la migration
- **CRITIQUE** : Maintenir la compatibilité des permissions (RLS)
- **CRITIQUE** : Gérer la transition des données existantes avec statut
- **ATTENTION** : L'interface étudiant doit continuer à fonctionner pendant la migration

## 🛠️ Implementation Blueprint

### Étape 1 : Analyse et Validation de l'Existant (30min)
1. **Audit complet du code actuel**
   - Identifier tous les usages de `assignment_status`
   - Mapper les dépendances frontend/backend
   - Vérifier les permissions et RLS
   
2. **Tests de régression**
   - Exécuter les tests existants
   - Documenter les fonctionnalités qui marchent actuellement

### Étape 2 : Migration de la Base de Données (45min)
1. **Création de la nouvelle table `assignment_instances`**
2. **Script de migration des données existantes**
   ```sql
   -- Conversion des assignments publishées en instances
   INSERT INTO assignment_instances (assignment_id, class_id, teacher_id, starts_at, ends_at, tenant_id)
   SELECT a.id, c.id, a.teacher_id, a.starts_at, a.ends_at, a.tenant_id
   FROM assignments a
   JOIN courses_classes cc ON cc.course_id = a.course_id
   JOIN classes c ON c.id = cc.class_id
   WHERE a.status = 'published';
   ```
3. **Suppression de la colonne status après validation**

### Étape 3 : Refactoring Backend API (60min)
1. **Modification des endpoints assignments**
   - Suppression de la logique de statut
   - Nouveaux endpoints pour les assignations
   ```typescript
   // Nouveaux endpoints
   POST /api/v1/assignments/:id/instances
   GET /api/v1/classes/:classId/assignments
   DELETE /api/v1/assignment-instances/:instanceId
   ```

2. **Mise à jour des permissions et RLS**
3. **Tests unitaires pour les nouveaux endpoints**

### Étape 4 : Interface de Création Simplifiée (45min)
1. **Modification de `/academic/evaluations/create/`**
   - Suppression des contrôles de statut
   - Interface simplifiée focalisée sur le contenu
   - Liaison obligatoire au cours

### Étape 5 : Nouvelle Interface d'Assignation (90min)
1. **Création de `/academic/assignments/assign/`**
   ```tsx
   // Structure de l'interface
   ClassSelector → CoursesList → AssignmentsList → AssignmentConfig → Validation
   ```
2. **Composants réactifs avec hooks**
3. **Validation des dates et conflits**

### Étape 6 : Adaptation Interface Étudiant (30min)
1. **Modification des queries pour utiliser assignment_instances**
2. **Conservation de l'UX existante**
3. **Tests d'affichage par classe**

### Étape 7 : Tests d'Intégration et Validation (45min)
1. **Tests du workflow complet**
2. **Validation des migrations de données**
3. **Tests de performance**

## ✅ Validation Loop

### Niveau 1 : Vérification Syntaxe & Types
```bash
# Backend
npm run typecheck
npm run lint:fix

# Frontend  
npm run build
npm run lint:fix
```

### Niveau 2 : Tests Unitaires
```bash
# Tests backend
npm test -- --testPathPattern="assignments|evaluations"

# Tests frontend
npm test -- src/components/assignments/
npm test -- src/app/academic/
```

### Niveau 3 : Tests d'Intégration
```bash
# Test workflow complet
npm run test:e2e -- --spec="**/assignments/**"

# Validation migration données
npm run test:migration
```

### Niveau 4 : Tests Manuels Critiques
1. **Création d'un devoir/évaluation** par enseignant et admin
2. **Assignation à une classe** avec dates spécifiques
3. **Affichage côté étudiant** des devoirs assignés
4. **Soumission et correction** (workflow existant)
5. **Réutilisation du même contenu** pour une autre classe

### Niveau 5 : Validation Métier
```bash
# Vérification des données migrées
SELECT COUNT(*) FROM assignment_instances; -- Doit correspondre aux anciens 'published'
SELECT COUNT(*) FROM assignments WHERE status IS NULL; -- Tous les assignments

# Test de performance
EXPLAIN ANALYZE SELECT * FROM assignment_instances 
JOIN assignments ON assignments.id = assignment_instances.assignment_id 
WHERE class_id = $1;
```

## 🔄 Plan de Rollback
En cas de problème critique :
1. **Restauration de la colonne status** dans assignments
2. **Rollback des données** depuis la sauvegarde
3. **Réactivation des anciens endpoints**
4. **Communication aux utilisateurs**

## 📊 Métriques de Succès
- **Performance** : Temps de chargement < 2s pour l'assignation
- **Adoption** : 100% des enseignants peuvent assigner sans formation
- **Fiabilité** : 0 perte de données pendant la migration
- **UX** : Workflow d'assignation en < 5 clics

---

**Note importante** : Cette refactorisation majeure nécessite une approche progressive et des tests approfondis. Chaque étape doit être validée avant de passer à la suivante.