# Configuration CAPTCHA pour RSO-PFSO

Ce guide explique comment configurer hCaptcha pour la protection contre les attaques brute force lors de la connexion RSO.

## Étapes de configuration

### 1. Obtenir les clés hCaptcha

1. Créer un compte sur [https://www.hcaptcha.com/](https://www.hcaptcha.com/)
2. Créer un nouveau site dans le tableau de bord
3. Noter les deux clés :
   - **Site Key** (clé publique) : utilisée côté frontend
   - **Secret Key** (clé privée) : utilisée côté backend

### 2. Configuration Backend (API)

Ajouter dans `apps/api/.env` :

```env
HCAPTCHA_SECRET_KEY=your-hcaptcha-secret-key-here
```

### 3. Configuration Frontend (Web)

Ajouter dans `apps/web/.env.local` :

```env
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=your-hcaptcha-site-key-here
```

**Important** : La variable doit commencer par `NEXT_PUBLIC_` pour être accessible côté client dans Next.js.

### 4. Redémarrer les serveurs

Après avoir ajouté les variables d'environnement :

```bash
# Redémarrer l'API
cd apps/api
pnpm dev

# Redémarrer le frontend
cd apps/web
pnpm dev
```

## Fonctionnement

- **Après 3 tentatives échouées** : Le widget CAPTCHA s'affiche automatiquement
- **Après 5 tentatives échouées** : L'IP est bloquée pendant 15 minutes
- **Validation** : Le token CAPTCHA est validé côté serveur avant l'authentification

## Mode développement

En mode développement, si `HCAPTCHA_SECRET_KEY` n'est pas configuré et `ENABLE_DEV_BYPASS=true`, la validation CAPTCHA est contournée pour faciliter les tests.

**⚠️ Important** : Ne jamais activer `ENABLE_DEV_BYPASS=true` en production !

## Dépannage

### Le widget CAPTCHA ne s'affiche pas

1. Vérifier que `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` est défini dans `apps/web/.env.local`
2. Vérifier que le serveur frontend a été redémarré après l'ajout de la variable
3. Vérifier la console du navigateur pour les erreurs

### Erreur "CAPTCHA invalide"

1. Vérifier que `HCAPTCHA_SECRET_KEY` est défini dans `apps/api/.env`
2. Vérifier que les clés correspondent (même site dans le tableau de bord hCaptcha)
3. Vérifier que le serveur API a été redémarré après l'ajout de la variable

### Tester sans CAPTCHA (développement uniquement)

Pour tester sans configurer hCaptcha en développement :

```env
# apps/api/.env
ENABLE_DEV_BYPASS=true
```

Le CAPTCHA sera contourné si la clé secrète n'est pas configurée.

