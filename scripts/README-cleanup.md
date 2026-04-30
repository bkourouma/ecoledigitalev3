# Script de Nettoyage de la Base de Données

## ⚠️ ATTENTION

Ce script est **DESTRUCTIF** et supprimera **TOUTES** les données de la base de données sauf :
- Le compte Admin (`admin@imhotepacademy.fr`)
- Les cycles
- Les salles de classe

**FAITES UNE SAUVEGARDE COMPLÈTE DE VOTRE BASE DE DONNÉES AVANT D'EXÉCUTER CE SCRIPT !**

## 📋 Prérequis

1. PostgreSQL 16 installé et en cours d'exécution
2. Accès à la base de données `dbecoledigitale`
3. Permissions d'administration sur la base de données

## 🔧 Utilisation

### Option 1 : Via psql (Recommandé)

```bash
# Se connecter à PostgreSQL
psql -U postgres -d dbecoledigitale

# Exécuter le script
\i scripts/cleanup-database.sql
```

### Option 2 : Via ligne de commande

```bash
psql -U postgres -d dbecoledigitale -f scripts/cleanup-database.sql
```

### Option 3 : Via pgAdmin

1. Ouvrir pgAdmin
2. Se connecter à la base de données `dbecoledigitale`
3. Ouvrir l'éditeur de requête
4. Ouvrir le fichier `scripts/cleanup-database.sql`
5. Exécuter le script (F5)

## 📊 Ce que le script fait

1. **Sauvegarde** les données à conserver :
   - Le compte admin et ses rôles
   - Tous les cycles
   - Toutes les salles de classe

2. **Supprime** toutes les autres données dans l'ordre correct (respect des contraintes de clés étrangères)

3. **Restaure** les données sauvegardées

4. **Affiche** un résumé avec les comptes :
   - Nombre d'utilisateurs restants
   - Nombre de cycles restants
   - Nombre de salles de classe restantes

## ✅ Vérification après exécution

Après l'exécution, vous devriez avoir :
- **1 utilisateur** : `admin@imhotepacademy.fr`
- **Tous les cycles** conservés
- **Toutes les salles de classe** conservées
- **Toutes les autres données** supprimées

## 🔄 En cas de problème

Si quelque chose ne va pas, vous pouvez restaurer votre sauvegarde :

```bash
# Restaurer depuis une sauvegarde
psql -U postgres -d dbecoledigitale < backup.sql
```

## 📝 Notes

- Le script utilise une transaction (`BEGIN`/`COMMIT`) pour garantir que toutes les opérations réussissent ou échouent ensemble
- Les tables temporaires sont automatiquement supprimées à la fin
- Le script préserve les rôles associés au compte admin

