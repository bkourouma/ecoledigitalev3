# Guide de Migration Imhotep Data

## 📋 Résumé

Ce guide explique comment appliquer et tester la migration du schéma de base de données pour le module Imhotep Data (formations professionnelles).

## 🚀 Application de la Migration

### Option 1: Utiliser le script npm (Recommandé)

```bash
# Appliquer la migration
pnpm migrate:imhotep-data
```

### Option 2: Utiliser psql directement

```bash
psql "postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0037_imhotep_data_professional_training.sql
```

### Option 3: Utiliser une variable d'environnement

```bash
# Windows PowerShell
$env:DATABASE_URL="postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/dbecoledigitale"
pnpm migrate:imhotep-data

# Linux/Mac
export DATABASE_URL="postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/dbecoledigitale"
pnpm migrate:imhotep-data
```

## ✅ Validation de la Migration

Après avoir appliqué la migration, validez que tout fonctionne correctement :

```bash
# Validation complète
pnpm validate:imhotep-data
```

Ce script vérifie :
- ✅ Toutes les tables existent
- ✅ RLS est activé sur toutes les tables
- ✅ Les politiques RLS existent
- ✅ Les types ENUM sont créés
- ✅ Les fonctions sont créées
- ✅ Les index sont créés
- ✅ L'isolation multi-tenant fonctionne

## 🧪 Tests avec Données

Pour tester avec des données réelles :

```bash
# Test de base (vérification des structures)
pnpm test:imhotep-data

# Test avec insertion de données
pnpm test:imhotep-data-insert
```

Le script `test-imhotep-data-insert.sql` crée :
- Une formation professionnelle
- Une session avec code auto-généré
- Un formateur
- Une entreprise cliente
- Une inscription avec numéro auto-généré
- Un code promotionnel
- Un paiement
- Un support de cours

## 📊 Vérifications Manuelles

### 1. Vérifier les Tables

```sql
-- Lister toutes les tables professionnelles
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE '%professionnel%'
ORDER BY tablename;
```

### 2. Vérifier RLS

```sql
-- Vérifier que RLS est activé
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE '%professionnel%';
```

### 3. Tester l'Isolation Multi-Tenant

```sql
-- Obtenir un tenant_id
SELECT id FROM tenants WHERE slug = 'imhotepdata';

-- Définir le contexte tenant
SET app.tenant_id = '<tenant-uuid>';

-- Essayer de requêter (devrait fonctionner)
SELECT * FROM formations_professionnelles;

-- Changer de tenant
SET app.tenant_id = '<autre-tenant-uuid>';

-- Devrait retourner vide ou être bloqué
SELECT * FROM formations_professionnelles;
```

### 4. Tester les Champs Générés

```sql
-- Créer une session (code auto-généré)
INSERT INTO sessions_professionnelles (
    tenant_id,
    formation_pro_id,
    date_debut,
    date_fin,
    mode_formation,
    places_totales,
    prix_ht,
    prix_ttc
) VALUES (
    '<tenant-uuid>',
    '<formation-uuid>',
    CURRENT_DATE + INTERVAL '30 days',
    CURRENT_DATE + INTERVAL '35 days',
    'presential',
    20,
    1000.00,
    1200.00
) RETURNING code_session;

-- Vérifier le format du code (devrait être DATA-YYYY-NNN)
-- Exemple: DATA-2024-001

-- Créer une inscription (numéro auto-généré)
INSERT INTO inscriptions_professionnelles (
    tenant_id,
    session_id,
    apprenant_id,
    type_inscription,
    montant_ht,
    montant_ttc
) VALUES (
    '<tenant-uuid>',
    '<session-uuid>',
    '<user-uuid>',
    'individuelle',
    1000.00,
    1200.00
) RETURNING numero_inscription;

-- Vérifier le format du numéro (devrait être INS-DATA-YYYY-NNN)
-- Exemple: INS-DATA-2024-001
```

### 5. Vérifier les Colonnes Générées

```sql
-- Vérifier places_disponibles (calculé automatiquement)
SELECT 
    places_totales,
    places_reservees,
    places_disponibles
FROM sessions_professionnelles
WHERE id = '<session-uuid>';

-- places_disponibles devrait être égal à places_totales - places_reservees
```

## 🔍 Dépannage

### Erreur: "authentification par mot de passe échouée"

Le mot de passe PostgreSQL est incorrect. Vérifiez :
1. Le mot de passe dans votre configuration PostgreSQL
2. Utilisez la variable d'environnement `DATABASE_URL` avec le bon mot de passe

### Erreur: "relation already exists"

La migration utilise `CREATE TABLE IF NOT EXISTS`, donc cela ne devrait pas se produire. Si c'est le cas :
1. Vérifiez si la migration a été partiellement appliquée
2. Nettoyez manuellement si nécessaire

### Erreur: "type already exists"

Les types ENUM utilisent `CREATE TYPE IF NOT EXISTS`. Si l'erreur persiste :
1. Vérifiez les types existants : `SELECT typname FROM pg_type WHERE typname LIKE '%professional%';`
2. Supprimez les types si nécessaire avant de réappliquer la migration

### RLS Ne Fonctionne Pas

Vérifiez :
1. RLS est activé : `SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = '<table>';`
2. Les politiques existent : `SELECT * FROM pg_policies WHERE tablename = '<table>';`
3. Le contexte tenant est défini : `SHOW app.tenant_id;`

## 📝 Fichiers Créés

- **Migration** : `infra/scripts/migrations/0037_imhotep_data_professional_training.sql`
- **Script de migration** : `scripts/migrate-imhotep-data.js`
- **Script de validation** : `scripts/validate-imhotep-data-migration.js`
- **Scripts de test SQL** :
  - `scripts/test-imhotep-data-migration.sql`
  - `scripts/test-imhotep-data-insert.sql`

## 🎯 Prochaines Étapes

Après avoir appliqué et validé la migration :

1. **Créer des données de test** : Utilisez `pnpm test:imhotep-data-insert`
2. **Intégrer dans l'API** : Créer les endpoints pour gérer les formations professionnelles
3. **Intégrer dans le Frontend** : Créer les interfaces utilisateur
4. **Tests E2E** : Tester le flux complet d'inscription et de paiement

## 📚 Documentation

Pour plus de détails :
- [data-model.md](../specs/015-imhotep-data-schema/data-model.md) - Définitions complètes des entités
- [quickstart.md](../specs/015-imhotep-data-schema/quickstart.md) - Guide de démarrage rapide
- [plan.md](../specs/015-imhotep-data-schema/plan.md) - Plan d'implémentation

