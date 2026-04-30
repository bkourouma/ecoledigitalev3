# Backend API Environment Variables Example

Copy this content to `apps/api/.env`:

```bash
# =================================================================
# EcoleDigitale Backend API Environment Variables
# =================================================================

# =================================================================
# DATABASE CONFIGURATION
# =================================================================
DATABASE_URL=postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale

# =================================================================
# SERVER CONFIGURATION
# =================================================================
PORT=4000
NODE_ENV=development

# =================================================================
# AUTHENTICATION & SECURITY
# =================================================================
JWT_SECRET=your-super-secret-jwt-key-change-in-production
NEXTAUTH_SECRET=your-secret-key-here-change-in-production

# CRITICAL: Set to false in production!
ENABLE_DEV_BYPASS=true

# =================================================================
# CORS CONFIGURATION
# =================================================================
CORS_ORIGIN=http://localhost:3000

# =================================================================
# FILE STORAGE
# =================================================================
UPLOAD_DIR=uploads
MAX_FILE_SIZE=10485760

# RSO Activities Module - Image Upload Configuration (Phase 3)
RSO_ACTIVITES_UPLOAD_DIR=uploads/aspci/activites
RSO_ACTIVITES_MAX_FILE_SIZE=5242880  # 5MB in bytes (for activity images)

# =================================================================
# LOGGING
# =================================================================
LOG_LEVEL=info

# =================================================================
# PAYMENT PROVIDERS
# =================================================================
# Orange Money API Configuration
ORANGE_MONEY_API_URL=https://api.orange.com
ORANGE_MONEY_CLIENT_ID=your-orange-money-client-id
ORANGE_MONEY_CLIENT_SECRET=your-orange-money-client-secret
ORANGE_MONEY_MERCHANT_KEY=your-orange-money-merchant-key

# MTN Money API Configuration
MTN_MONEY_API_URL=https://api.mtn.com
MTN_MONEY_SUBSCRIPTION_KEY=your-mtn-money-subscription-key
MTN_MONEY_USER_ID=your-mtn-money-user-id
MTN_MONEY_API_SECRET=your-mtn-money-api-secret

# Wave API Configuration
WAVE_API_URL=https://api.wave.com
WAVE_API_KEY=your-wave-api-key
WAVE_BUSINESS_ID=your-wave-business-id

# Bank Card Gateway (CinetPay) Configuration
CINETPAY_API_URL=https://api.cinetpay.com
CINETPAY_SITE_ID=your-cinetpay-site-id
CINETPAY_API_KEY=your-cinetpay-api-key

# TresorPay Configuration
TRESORPAY_API_URL=https://api.tresorpay.com
TRESORPAY_MERCHANT_ID=your-tresorpay-merchant-id
TRESORPAY_API_KEY=your-tresorpay-api-key
TRESORPAY_SECRET_KEY=your-tresorpay-secret-key

# =================================================================
# EMAIL SERVICE (SMTP)
# =================================================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-email-app-password
SMTP_FROM_NAME=EcoleDigitale
SMTP_FROM_EMAIL=noreply@ecoledigitale.com

# =================================================================
# SMS SERVICE (Twilio)
# =================================================================
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Alternative SMS Provider (if not using Twilio)
# SMS_PROVIDER_API_URL=https://api.sms-provider.com
# SMS_PROVIDER_API_KEY=your-sms-provider-api-key

# =================================================================
# RSO-PFSO MODULE CONFIGURATION
# =================================================================
# JWT Configuration for RSO module (can reuse existing JWT_SECRET or set RSO-specific)
RSO_JWT_SECRET=your-rso-jwt-secret-key-here
RSO_JWT_EXPIRES_IN=8h
RSO_JWT_REMEMBER_ME_EXPIRES_IN=30d

# Email Configuration for RSO (password reset, welcome emails)
# Can reuse SMTP settings above or set RSO-specific
RSO_SMTP_HOST=smtp.gmail.com
RSO_SMTP_PORT=587
RSO_SMTP_USER=your-email@gmail.com
RSO_SMTP_PASS=your-app-password
RSO_SMTP_FROM=noreply@aspci.ci

# Or use SendGrid for RSO emails
# RSO_SENDGRID_API_KEY=your-sendgrid-api-key

# CAPTCHA Configuration (for brute force protection)
# Backend: Secret key for server-side validation
HCAPTCHA_SECRET_KEY=your-hcaptcha-secret-key
# Frontend: Site key for client-side widget (add to apps/web/.env.local)
# NEXT_PUBLIC_HCAPTCHA_SITE_KEY=your-hcaptcha-site-key

# Or use Google reCAPTCHA
# RECAPTCHA_SITE_KEY=your-recaptcha-site-key
# RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
# NEXT_PUBLIC_RECAPTCHA_SITE_KEY=your-recaptcha-site-key

# Note: Get hCaptcha keys from https://www.hcaptcha.com/
# - Site Key: Public key used in frontend (safe to expose)
# - Secret Key: Private key used in backend (keep secret)

# Rate Limiting Configuration
RSO_RATE_LIMIT_LOGIN_ATTEMPTS=5
RSO_RATE_LIMIT_WINDOW_MINUTES=15
RSO_RATE_LIMIT_CAPTCHA_THRESHOLD=3

# =================================================================
# RSO-PFSO ACTIVITIES MODULE (Phase 3)
# =================================================================
# Google Maps API Key (for backend map validation if needed)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# =================================================================
# RSO-PFSO MEDIA MANAGEMENT MODULE (Phase 4)
# =================================================================
# Media storage directories
RSO_MEDIAS_UPLOAD_DIR=uploads/aspci/medias
RSO_EXPORTS_UPLOAD_DIR=uploads/aspci/exports

# Media processing settings
RSO_IMAGE_MAX_SIZE_MB=10
RSO_VIDEO_MAX_SIZE_MB=100
RSO_DOCUMENT_MAX_SIZE_MB=20
RSO_IMAGE_COMPRESSION_QUALITY=85
RSO_IMAGE_MAX_DIMENSION=2048
RSO_THUMBNAIL_SIZE=300

# Quota management defaults
RSO_DEFAULT_QUOTA_MB=1000
RSO_QUOTA_WARNING_THRESHOLD=80

# Export settings
RSO_EXPORT_EXPIRY_DAYS=30
```

**Important Notes:**
- Generate secrets with: `openssl rand -base64 32`
- Never commit `.env` to version control  
- **MUST set `ENABLE_DEV_BYPASS=false` in production!**
- Payment provider credentials must be obtained from respective providers
- SMTP credentials: Use app-specific passwords for Gmail, not your regular password
- Twilio credentials: Available from Twilio Console dashboard

