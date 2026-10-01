# Frontend Environment Variables Example

Copy this content to `apps/web/.env.local`:

```bash
# =================================================================
# EcoleDigitale Frontend Environment Variables
# =================================================================

# =================================================================
# TENANT CONFIGURATION
# =================================================================
NEXT_PUBLIC_TENANT_SLUG=imhotepacademy

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
NEXT_PUBLIC_DEMO_ACCOUNTS=
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

