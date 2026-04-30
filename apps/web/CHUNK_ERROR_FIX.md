# Correction des erreurs ChunkLoadError

## Problème
L'erreur `ChunkLoadError` se produit généralement lors de l'ajout de nouvelles dépendances (comme Ant Design) ou lors de modifications du code qui affectent le bundling webpack.

## Solution implémentée

### 1. Configuration webpack optimisée
- Séparation des chunks Ant Design
- Configuration des timeouts de chargement
- Gestion améliorée du cache

### 2. Gestionnaire d'erreurs robuste
- Détection automatique des erreurs de chunk
- Tentatives de récupération automatiques
- Nettoyage du cache en cas d'échec

### 3. Chargement dynamique des composants
- Lazy loading pour les composants Ant Design
- Suspense boundaries pour éviter les erreurs de rendu

### 4. Script de correction automatique
```bash
pnpm run fix-chunks
```

## Utilisation

### Correction immédiate
```bash
cd apps/web
pnpm run fix-chunks
```

### Correction manuelle
1. Arrêter le serveur de développement
2. Supprimer le dossier `.next`
3. Supprimer `node_modules/.cache`
4. Exécuter `pnpm install`
5. Redémarrer avec `pnpm dev`

### En cas de persistance
1. Vider le cache du navigateur (Ctrl+Shift+R)
2. Utiliser un onglet de navigation privée
3. Vérifier la console pour d'autres erreurs

## Prévention

### Bonnes pratiques
- Utiliser le `AntdConfigProvider` pour tous les composants Ant Design
- Implémenter le lazy loading pour les gros composants
- Tester les modifications en mode développement

### Monitoring
- Surveiller la console pour les erreurs de chunk
- Utiliser les outils de développement du navigateur
- Vérifier la taille des bundles

## Composants affectés
- `AntdCycleForm`
- `AntdProgrammeForm`
- Tous les composants utilisant Ant Design

## Configuration technique
- Next.js 15.0.0
- Ant Design 5.27.4
- Webpack avec splitChunks optimisé
- Gestionnaire d'erreurs personnalisé
