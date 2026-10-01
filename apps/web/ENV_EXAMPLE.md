# Frontend Environment Variables Example

Copy this content to `apps/web/.env.local`:

```bash
# =================================================================
# EcoleDigitale Frontend Environment Variables
# =================================================================

# =================================================================
# TENANT CONFIGURATION
# =================================================================
# Résolution UNIQUE du tenant (src/platform/tenant/resolve-tenant.ts), dans cet ordre :
#   session > sous-domaine (<slug>.ecoledigitale.allianceconsultants.net, <slug>.localhost) > NEXT_PUBLIC_TENANT_SLUG.
# Plus AUCUN repli codé en dur : sans correspondance, le tenant est « inconnu » et l'interface l'indique.
# En développement local (localhost sans sous-domaine) : indiquer le slug du tenant de dev.
NEXT_PUBLIC_TENANT_SLUG=<slug-du-tenant-de-dev>
# Facultatif : domaines de base supplémentaires (<slug>.<domaine>), séparés par des virgules.
NEXT_PUBLIC_TENANT_BASE_DOMAINS=
# Facultatif : domaines personnalisés, hote=slug séparés par des virgules (ex. portail.monecole.ci=monecole).
NEXT_PUBLIC_TENANT_CUSTOM_DOMAINS=

# =================================================================
# API CONFIGURATION  
# =================================================================
NEXT_PUBLIC_API_URL=http://localhost:4000
API_BASE_URL=http://localhost:4000

# =================================================================
# AUTHENTICATION
# =================================================================
NEXTAUTH_URL=http://localhost:3000
# REQUIS en production (>= 32 caractères aléatoires) : le web refuse de démarrer sinon.
# En développement, s'il est absent, un secret aléatoire est généré par process
# (avertissement dans la console ; les sessions sautent au redémarrage).
NEXTAUTH_SECRET=<secret-aleatoire-32-caracteres-minimum>

# =================================================================
# FEATURE FLAGS
# =================================================================
NEXT_PUBLIC_ENABLE_DEV_TOOLS=true
# Menu latéral piloté par l'API (GET /api/v1/rbac/me/navigation). Éteint par défaut (Sidebar legacy).
# 1 = tous les portails ; admin,teacher,parent,student,owner = portails nommés. Repli sur le legacy si l'API échoue.
NEXT_PUBLIC_PLATFORM_NAV=
# PWA / service worker (public/sw.js). Actif en production par défaut ; 1 = forcer en développement ;
# 0 = interrupteur d'arrêt (désinscrit les service workers existants).
NEXT_PUBLIC_PWA=
NEXT_PUBLIC_DEMO_ACCOUNTS=
# Authentification V2 (module iam : sessions révocables, MFA TOTP, refresh à rotation côté serveur). 1 = actif ;
# absent = authentification LEGACY (défaut tant que la bascule n'est pas décidée). Inliné au build : redéployer pour changer.
# Plan de bascule : docs/architecture/auth-cutover.md
NEXT_PUBLIC_AUTH_V2=
# V2 : affiche « Continuer avec Google » sur /login (nécessite GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET et IAM_SERVICE_SECRET).
NEXT_PUBLIC_GOOGLE_AUTH=
# V2 : secret de service partagé avec l'API (IAM_SERVICE_SECRET), pour la connexion Google via iam. Serveur uniquement.
IAM_SERVICE_SECRET=
# Legacy : secret partagé avec l'API pour /auth/social-login (AUTH_SOCIAL_SHARED_SECRET côté API, MÊME valeur). Serveur uniquement.
AUTH_SOCIAL_SHARED_SECRET=
# Panneau « Comptes par tenant » de /login (remplit email + mot de passe des
# comptes techniques). Lu côté serveur, à l'exécution. Non renseigné : actif en
# `next dev`, coupé en production. Ne JAMAIS mettre `true` sur un site public.
SHOW_TECHNICAL_ACCOUNTS=
# Mot de passe commun des comptes techniques (même valeur que côté API). Aucune
# valeur par défaut : absent, le panneau liste les comptes sans mot de passe.
TECHNICAL_ACCOUNT_PASSWORD=
# Surcharges de comptes réels par tenant (JSON, lu côté serveur uniquement) :
# {"mon-tenant":{"teacher":{"email":"prenom.nom@exemple.test","password":"<...>"}}}
TECHNICAL_ACCOUNT_OVERRIDES=

# =================================================================
# RSO-PFSO ACTIVITIES MODULE (Phase 3)
# =================================================================
# TinyMCE API Key (get from https://www.tiny.cloud/)
NEXT_PUBLIC_TINYMCE_API_KEY=your_tinymce_api_key_here

# Google Maps API Key (for map insertion in activity editor)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

**Important Notes:**
- Generate NEXTAUTH_SECRET with: `openssl rand -base64 32`
- Never commit `.env.local` to version control
- In production, set `NEXT_PUBLIC_ENABLE_DEV_TOOLS=false`
- In production, leave `SHOW_TECHNICAL_ACCOUNTS` unset or `false` (login demo panel)

