# Imhotep — inventaire de suppression (D7)

> Document généré par `scripts/inventory/build-imhotep-doc.mjs` (tâche 0.6 du plan) à partir de `imhotep-removal-inventory.json` (script `imhotep-deps.mjs`), de `tables-usage-matrix.json` et des notes de `scripts/inventory/imhotep-notes.mjs`. Les listes « A » et les preuves chiffrées sont recalculées à chaque exécution ; les sections B, C et l'ordre de suppression sont rédigés à la main (références fichier:ligne à la date de l'inventaire). **Aucune suppression n'a été faite.**

## 1. Verdict

| Catégorie | Contenu | Volume |
|---|---|---|
| **A — supprimer sans risque** | fichiers sans dépendance entrante depuis le cœur scolaire / Professional / owner / rémunération | 376 fichiers dont 41 API (26229 lignes), 191 web (33112 lignes), 92 dans `apps/formation-pro-public` (6898 lignes), 37 contrats Zod, 15 scripts ; 22 tables + 17 tables `_aspci` zombies |
| **B — à découpler d'abord** | le cœur en dépend, ou le fichier est partagé | 14 chantiers (B1–B14) ; 2 importations et 20 références de tables entrantes hors accroches mécaniques |
| **C — à conserver (rangé à tort sous Imhotep)** | | 11 ensembles : prospection/commissions, LiveKit, infrastructure de notifications, e-mail, rendu PDF, abstraction de paiement, auto-inscription, Professional, RSO |

Trois constats pèsent sur la suite :

1. **Le couplage entrant est faible** : hors points d'accroche mécaniques (`index.ts`, barrel de contrats), seuls `owner-formations`, `owner-staff`, `user-auth` et les chaînes LiveKit/notifications touchent des objets Imhotep (§3). Aucune clé étrangère d'une table du cœur ne pointe vers une table Imhotep.
2. **Prisma n'est pas « de l'Imhotep »** : il porte 9 tables du cœur et c'est lui que `deploy.sh` exécute (B11). Le supprimer avec Imhotep (plan §5.1) casserait le déploiement.
3. **Plusieurs fonctionnalités du cœur sont Imhotep-adjacentes sans l'être** : visio (3 parents dont 1 seul Imhotep), notifications, prospection, e-mail, rendu PDF. Un `grep` sur « formation » ou « formateur » supprimerait du Professional et du RSO.

## 2. A — À SUPPRIMER SANS RISQUE

Critère : le script `imhotep-deps.mjs` ne trouve **aucune** importation, aucune référence SQL, aucun appel HTTP, aucun symbole de contrat, depuis un fichier hors de cette liste — sauf les points d'accroche mécaniques de B10 (`index.ts`, barrel de contrats). Les fichiers dont la suppression exige une édition préalable ailleurs sont en B.

### 2.1 API (41 fichiers, 26229 lignes ; 40 sans aucune dépendance entrante, 1 à débloquer par B2)

| Fichier | Lignes | Statut | Rôle |
|---|--:|---|---|
| `api/src/services/session-pro.service.ts` | 3057 | A | sessions de formation, formateurs, capacité |
| `api/src/routes/sessions-pro.ts` | 2694 | A | sessions (public + admin), calendrier, formateurs de session |
| `api/src/routes/formations-pro.ts` | 2160 | A | catalogue public des formations |
| `api/src/services/inscription-pro.service.ts` | 2040 | A | inscriptions, panier, codes promo, réservations |
| `api/src/services/formation-pro.service.ts` | 1750 | A | catalogue, supports, programme |
| `api/src/services/formateur.service.ts` | 1733 | A | espace formateur (profil, sessions, supports) |
| `api/src/routes/formateur.ts` | 1609 | A | espace formateur (planning, supports, présences, messagerie) |
| `api/src/services/document-generation.service.ts` | 1411 | A | conventions, devis, attestations, factures (pdfkit) |
| `api/src/routes/inscriptions-pro.ts` | 1035 | A | inscriptions (individuel/entreprise), panier, factures |
| `api/src/services/supports-cours.service.ts` | 792 | A | supports de cours (vidéos, fichiers) |
| `api/src/services/export.service.ts` | 751 | A | exports Excel/CSV |
| `api/src/services/entreprise-cliente.service.ts` | 717 | A | entreprises clientes |
| `api/src/services/paiement-pro.service.ts` | 717 | A | orchestration des paiements (appelle les 5 adaptateurs, SMS, factures) |
| `api/src/services/reporting.service.ts` | 554 | A | indicateurs Imhotep |
| `api/src/routes/documents.ts` | 454 | A | conventions, devis, attestations Imhotep |
| `api/src/jobs/document-automation.job.ts` | 430 | A | génération automatique de documents (cron) |
| `api/src/routes/paiements-pro.ts` | 422 | A | paiement mobile money / carte, webhooks |
| `api/src/routes/exports.ts` | 377 | A | exports inscriptions/paiements/présences/CA |
| `api/src/routes/entreprises.ts` | 313 | A | entreprises clientes |
| `api/src/services/formateur-attendance.service.ts` | 270 | A | présences des apprenants (formateur) |
| `api/src/services/invoice.service.ts` | 269 | A | factures PDF |
| `api/src/services/code-promo.service.ts` | 248 | A | codes promotionnels |
| `api/src/jobs/reservation-cleanup.job.ts` | 233 | A | libération des réservations temporaires (toutes les 5 min) |
| `api/src/services/formateur-messaging.service.ts` | 214 | A | messages formateur → apprenants (e-mail + SMS) |
| `api/src/services/carte-bancaire.service.ts` | 213 | A | adaptateur carte (CinetPay) — voir C |
| `api/src/services/formateur-availability.service.ts` | 195 | A | disponibilités des formateurs |
| `api/src/routes/reporting.ts` | 180 | A | tableaux de bord Imhotep |
| `api/src/services/orange-money.service.ts` | 154 | A | adaptateur Orange Money (mock) — voir C |
| `api/src/services/mtn-money.service.ts` | 151 | A | adaptateur MTN MoMo — voir C |
| `api/src/services/wave.service.ts` | 126 | A | adaptateur Wave (mock) — voir C |
| `api/src/routes/codes-promo.ts` | 125 | A | codes promotionnels |
| `api/src/services/tresorpay.service.ts` | 123 | A | adaptateur TresorPay (Imhotep) — voir C |
| `api/src/middleware/formateurAuth.ts` | 121 | A | garde « formateur actif » |
| `api/src/utils/transaction-number.util.ts` | 92 | A | numéro de transaction (paiement-pro) |
| `api/src/services/sms.service.ts` | 89 | A | Twilio (seul importeur de `twilio`) |
| `api/src/services/vimeo.service.ts` | 87 | A | hébergement vidéo des supports |
| `api/src/services/payment-provider.interface.ts` | 86 | A | interface commune des adaptateurs — voir C (réutilisable, plan §3.12) |
| `api/src/utils/sessionAccess.ts` | 78 | A | contrôle d'accès formateur ↔ session |
| `api/src/utils/audit-log.ts` | 62 | A | journal d'audit formateur (corps commenté) |
| `api/src/utils/enrollment-number.util.ts` | 52 | A | aucun importeur (orphelin) |
| `api/src/utils/table-names.ts` | 45 | A après B2 (owner-formations.service.ts, owner-staff.service.ts) | indirection `_aspci` (constantes) |

### 2.2 Web `apps/web` (191 fichiers, 33112 lignes)

| Dossier / fichier | Fichiers | Lignes |
|---|--:|--:|
| `apps/web/src/components/sessions-pro/` | 34 | 5968 |
| `apps/web/src/components/formateur/` | 26 | 3890 |
| `apps/web/src/lib/hooks/use-* (hooks Imhotep)` | 15 | 3852 |
| `apps/web/src/app/formations-professionnelles/catalogue/` | 6 | 3757 |
| `apps/web/src/components/inscriptions-pro/` | 22 | 2929 |
| `apps/web/src/app/formations-professionnelles/admin/` | 26 | 2486 |
| `apps/web/src/components/formations-pro/` | 7 | 1695 |
| `apps/web/src/app/api/v1/` | 11 | 1347 |
| `apps/web/src/components/admin/entreprises/` | 5 | 1184 |
| `apps/web/src/app/formateur/supports/` | 3 | 890 |
| `apps/web/src/components/admin/exports/` | 6 | 814 |
| `apps/web/src/components/admin/reporting/` | 5 | 813 |
| `apps/web/src/components/admin/documents/` | 4 | 648 |
| `apps/web/src/app/formations-professionnelles/inscription/` | 5 | 640 |
| `apps/web/src/app/formateur/sessions/` | 3 | 454 |
| `apps/web/src/app/formations-professionnelles/public/` | 2 | 371 |
| `apps/web/src/__tests__/` | 1 | 341 |
| `apps/web/src/components/admin/formateurs/` | 1 | 328 |
| `apps/web/src/app/formateur/planning/` | 1 | 176 |
| `apps/web/scripts/README-test-formation-detail.md` | 1 | 155 |
| `apps/web/src/app/formations-professionnelles/sessions/` | 2 | 130 |
| `apps/web/src/app/formateur/profil/` | 1 | 107 |
| `apps/web/src/app/formateur/dashboard/` | 1 | 70 |
| `apps/web/src/app/formations-professionnelles/mon-compte/` | 1 | 46 |
| `apps/web/src/lib/pro-tenants.ts` | 1 | 12 |
| `apps/web/src/app/formateur/` | 1 | 9 |

Fichiers orphelins après suppression (tous leurs importeurs sont dans la liste) : `web/src/components/ui/breadcrumb.tsx`.

### 2.3 Portail public `apps/formation-pro-public` (92 fichiers, 6898 lignes)

Application Next.js autonome (next-auth, Prisma, Resend, PayHubSecure) : 19 pages, 14 routes API, 31 composants, accès **direct** à la base par Prisma (`public_users`, `accounts`, `inscriptions_public`, `verification_tokens`, `supports_cours`, `formations_professionnelles`, `formateurs`, `sessions_professionnelles`). Elle n'importe rien d'autre du monorepo que `@ecoledigitale/ui` (cloche de notification, `LiveSessionRoom`). Suppression du répertoire entier.

| Sous-dossier | Fichiers | Lignes |
|---|--:|--:|
| `src/app` | 39 | 2479 |
| `src/components` | 31 | 2278 |
| `src/lib` | 12 | 1842 |
| `tailwind.config.ts` | 1 | 91 |
| `src/hooks` | 3 | 88 |
| `src/types` | 3 | 82 |
| `src/stores` | 1 | 16 |
| `next.config.js` | 1 | 15 |
| `postcss.config.js` | 1 | 7 |

### 2.4 Contrats Zod `packages/contracts` (37 fichiers, 2617 lignes)

`codes-promo/code-promo.schema.ts`, `codes-promo/index.ts`, `codes-promo/types.ts`, `documents/document.schema.ts`, `documents/document.types.ts`, `documents/index.ts`, `entreprises/entreprise.schema.ts`, `entreprises/entreprise.types.ts`, `entreprises/index.ts`, `exports/export.schema.ts`, `exports/export.types.ts`, `exports/index.ts`, `formateurs/attendance.schema.ts`, `formateurs/dashboard.schema.ts`, `formateurs/index.ts`, `formateurs/messaging.schema.ts`, `formateurs/notifications.schema.ts`, `formateurs/profil.schema.ts`, `formateurs/schedule.schema.ts`, `formateurs/sessions.schema.ts`, `formateurs/supports.schema.ts`, `formations-pro.ts`, `inscriptions-pro/index.ts`, `inscriptions-pro/inscription-api.schema.ts`, `inscriptions-pro/inscription.schema.ts`, `inscriptions-pro/types.ts`, `paiements-pro/index.ts`, `paiements-pro/paiement.schema.ts`, `paiements-pro/types.ts`, `reporting/index.ts`, `reporting/reporting.schema.ts`, `reporting/reporting.types.ts`, `sessions-pro/admin.schema.ts`, `sessions-pro/calendar.schema.ts`, `sessions-pro/index.ts`, `sessions-pro/session.schema.ts`, `sessions-pro/types.ts`.

Ré-exportés par `packages/contracts/src/index.ts:24,27,30,33,36-77,80-83` (édition B10). Aucun symbole de ces dossiers n'est importé par le cœur, sauf `FormationDetail` (B7) et la collision `PaymentInitiationResponse` (B8).

### 2.5 Scripts racine (15 fichiers)

- `scripts/IMHOTEP_DATA_MIGRATION_GUIDE.md` (230 lignes)
- `scripts/IMHOTEP_DATA_NEXT_STEPS.md` (206 lignes)
- `scripts/apply-aspci-migrations.js` (112 lignes)
- `scripts/apply-aspci-tables-migration.js` (59 lignes)
- `scripts/apply-price-precision-migration.js` (161 lignes)
- `scripts/create-formations-diplomantes.ts` (244 lignes)
- `scripts/create-formations-interentreprises.ts` (466 lignes)
- `scripts/create-formations-pro.ts` (267 lignes)
- `scripts/create-inscriptions-pro.ts` (294 lignes)
- `scripts/create-sessions-pro.ts` (282 lignes)
- `scripts/migrate-add-carriere.js` (89 lignes)
- `scripts/migrate-imhotep-data.js` (99 lignes)
- `scripts/migrate-reservations-temporaires.js` (93 lignes)
- `scripts/prepare-formation-public-db.mjs` (98 lignes)
- `scripts/validate-imhotep-data-migration.js` (272 lignes)

Entrées de `package.json` à retirer : `dev:formation-public`, `db:formation-public:apply`, `db:formation-public:generate` (l. 13-15), `migrate:imhotep-data` (l. 22), `test:imhotep-data`, `test:imhotep-data-insert`, `validate:imhotep-data` (l. 29-31 — les deux scripts de test pointent vers des fichiers **absents** du dépôt) ; dans `apps/api/package.json` : `test:formations-pro` (l. 27, fichier absent). Ces entrées contiennent par ailleurs un mot de passe de base en clair (à retirer en tâche 0.4, indépendamment d'Imhotep).

### 2.6 Infrastructure et CI

| Élément | Référence | Remarque |
|---|---|---|
| Service compose `ecoledigitale-formation-pro` | `infra/compose/docker-compose.yml:29-57` | port hôte 3012, `NEXTAUTH_URL` propre |
| Construction de l'image | `infra/scripts/deploy.sh:29` | **à retirer en même temps** que le service, sinon `dc build` échoue |
| Dockerfile | `infra/compose/Dockerfile.formation-pro-public` (68 l.) | génère le client Prisma |
| Vhost nginx | `infra/nginx/formation-pro.conf` (79 l.) | installé à la main sur le serveur (`infra/scripts/bootstrap-server.md:83-115`) |
| Variables d'environnement | `infra/.env.example:32-53`, `apps/formation-pro-public/.env.example` | `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_*`, `PAYHUBSECURE_*`, `RESEND_*` ; côté API : `TWILIO_*`, `VIMEO_*`, `ORANGE_MONEY_*`, `MTN_MONEY_*`, `WAVE_*`, `TRESORPAY_*`, `CINETPAY_*` |
| Documentation d'exploitation | `infra/scripts/bootstrap-server.md:31,83-115,204-233` | ports, vhost, OAuth Google |
| CI | `.github/workflows/deploy.yml` | **aucune modification** : il appelle `deploy.sh` |

### 2.7 Dépendances npm exclusives à Imhotep

| Package | Dépendance | Importée seulement par | Remarque |
|---|---|---|---|
| `apps/api` | `axios` | `services/carte-bancaire.service.ts`, `services/mtn-money.service.ts`, `services/orange-money.service.ts` | retirable après étape 4 ; utile aux futurs adaptateurs de paiement (C) |
| `apps/api` | `exceljs` | `services/entreprise-cliente.service.ts`, `services/export.service.ts`, `services/session-pro.service.ts` | retirable après étape 4 ; **redeviendra utile** (imports/exports Excel, plan §3.13) |
| `apps/api` | `pdfkit` | `services/document-generation.service.ts`, `services/invoice.service.ts` | retirable après étape 4 |
| `apps/api` | `twilio` | `services/sms.service.ts` | retirable après étape 4 ; le fournisseur SMS CI reste à choisir (plan §8) |
| `apps/web` | `@fullcalendar/list` | `components/sessions-pro/CalendarComponent.tsx` | |
| `apps/formation-pro-public` | 32 dépendances (next, next-auth, @prisma/client, resend, nodemailer, bcryptjs, zustand…) | tout le package | disparaît avec le répertoire ; `pnpm-lock.yaml` à régénérer |

Toute modification de `package.json` impose de régénérer `pnpm-lock.yaml` dans le même commit : les `Dockerfile.api` / `Dockerfile.web` installent avec `--frozen-lockfile`.

### 2.8 Base de données

**Tables Imhotep** (22, statut dans `tables-usage-matrix.md`) :

| Table | Origine | Statut | Fichiers du cœur qui la citent |
|---|---|---|--:|
| `accounts` | prisma/migrations/20260420120000_add_public_portal_tables | prisma-only, sans aucune référence | 0 |
| `codes_promo` | 0037_imhotep_data_professional_training.sql | active | 0 |
| `documents` | 0041_documents_export_jobs.sql | active | 0 |
| `entreprises_clientes` | 0037_imhotep_data_professional_training.sql | active | 1 |
| `export_jobs` | 0041_documents_export_jobs.sql | active | 0 |
| `formateur_indisponibilites` | 0056_restore_pro_sessions_formateurs.sql | active | 0 |
| `formateurs` | 0056_restore_pro_sessions_formateurs.sql | active | 3 |
| `formations_professionnelles` | 0037_imhotep_data_professional_training.sql | active | 0 |
| `inscriptions_professionnelles` | 0037_imhotep_data_professional_training.sql | active | 1 |
| `inscriptions_public` | prisma/migrations/20260420120000_add_public_portal_tables | prisma-only | 1 |
| `notifications_formateurs` | 0056_restore_pro_sessions_formateurs.sql | active | 0 |
| `paiements_professionnels` | 0037_imhotep_data_professional_training.sql | active | 1 |
| `public_users` | prisma/migrations/20260420120000_add_public_portal_tables | prisma-only | 2 |
| `reservations_temporaires` | 0039_reservations_temporaires.sql | active | 0 |
| `session_attendance` | 0056_restore_pro_sessions_formateurs.sql | active | 0 |
| `session_formateurs` | 0056_restore_pro_sessions_formateurs.sql | active | 0 |
| `sessions_professionnelles` | 0056_restore_pro_sessions_formateurs.sql | active | 3 |
| `support_session_associations` | 0056_restore_pro_sessions_formateurs.sql | active | 0 |
| `support_telechargements` | 0040_formateur_space_tables.sql | active | 0 |
| `supports_cours` | 0037_imhotep_data_professional_training.sql | active | 0 |
| `user_sessions` | prisma/migrations/20260420120000_add_public_portal_tables | prisma-only, sans aucune référence | 0 |
| `verification_tokens` | prisma/migrations/20260420120000_add_public_portal_tables | prisma-only, sans aucune référence | 0 |

**Zombies Prisma `*_aspci`** (17) : `codes_promo_aspci`, `documents_aspci`, `entreprises_clientes_aspci`, `export_jobs_aspci`, `formateur_indisponibilites_aspci`, `formateurs_aspci`, `formations_professionnelles_aspci`, `inscriptions_professionnelles_aspci`, `notifications_formateurs_aspci`, `paiements_professionnels_aspci`, `reservations_temporaires_aspci`, `session_attendance_aspci`, `session_formateurs_aspci`, `sessions_professionnelles_aspci`, `support_session_associations_aspci`, `support_telechargements_aspci`, `supports_cours_aspci` — présentes dans le baseline Prisma `20260403110000`, supprimées par `0055_unified_multitenancy.sql` côté SQL, citées nulle part dans le code. Elles existent encore sur toute base initialisée par `prisma migrate deploy`.

**Tables partagées (C, à NE PAS supprimer)** : `live_session_attendances`, `live_session_recordings`, `live_session_webhook_events`, `live_sessions` — voir B5.

**Aucune clé étrangère d'une table du cœur ne référence une table Imhotep** (`fk_inbound_from_core` vide) ; les seules FK sortantes d'Imhotep vers le cœur visent `users` et `tenants`. Colonnes « souples » à retirer : `live_sessions.session_professionnelle_id` (B5).

**Objets SQL Imhotep** : fonctions `generate_session_code`, `set_session_code`, `generate_enrollment_number`, `set_enrollment_number`, `generate_invoice_number`, `update_session_capacity_on_enrollment_change` (+ triggers `trigger_update_session_capacity_*`, `set_session_code_trigger`, `set_enrollment_number_trigger`) ; enums `session_professional_status`, `enrollment_type`, `enrollment_professional_status`, `promo_code_reduction_type`, `payment_method`, `payment_professional_status`, `document_type`, `export_type`, `job_status`. Exclusions : voir B14.

**Migrations d'origine** (archivées avec `legacy-final`, jamais rejouées) : `0037_imhotep_data_professional_training`, `0038_add_formations_pro_fts_index`, `0039_reservations_temporaires`, `0040_formateur_space_tables`, `0041_documents_export_jobs`, `0044_add_carriere_to_formations_professionnelles`, `0045_aspci_professional_training_setup`, `0046_create_aspci_professional_training_tables`, `0047_increase_price_precision`, `0051_imhotep_remove_sessions_formateurs`, `0056_restore_pro_sessions_formateurs`, `9999_update_session_capacity_trigger` ; mixtes : `0055_unified_multitenancy` (fusion `_aspci`), `0056_live_sessions` et `0057_notifications` (C), `0069_pedagogie_ue_ecue` (colonne `live_sessions`). Chaîne Prisma : `20260403110000_baseline`, `20260420120000_add_public_portal_tables` (`public_users`, `accounts`, `user_sessions`, `verification_tokens`, `inscriptions_public`).

### 2.9 Données et services externes (hors dépôt — à traiter avec l'exploitant)

- Données des tables de §2.8 sur chaque tenant (`imhotepacademy`, `imhotepdata`, `aspci`…) : **comptage et export à décider** (D8 est une hypothèse, plan §1).
- DNS et certificat `formation-pro.allianceconsultants.net` ; vhost nginx installé à la main.
- Clients et comptes tiers : Google OAuth (portail), PayHubSecure, Resend, Twilio, Vimeo, Orange Money / MTN MoMo / Wave / CinetPay / TresorPay.
- Stockage objet des supports de cours et enregistrements (`supports_cours`, `LIVEKIT_RECORDINGS_*` — ces derniers à conserver tant que la visio existe).

## 3. B — À DÉCOUPLER D'ABORD

Pour chaque chantier : qui dépend de quoi (fichier:ligne), l'action de découplage, le test de fin de chantier.

### B1 — Tableau de bord owner « formations pro » (fonctionnalité déjà orpheline)

**Dépendance** : Le cœur (espace owner) lit des tables Imhotep.

- `apps/api/src/routes/owner/index.ts:137` (import) et `:1267-1285` (`GET /formations`) → `services/owner-formations.service.ts` (110 lignes ; lit `sessions_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `entreprises_clientes`, `formateurs` via `getTableName`, :44-48,82-95).
- `packages/contracts/src/owner.schema.ts:255-261,301` (`OwnerFormationsResponseSchema`) ; `apps/web/src/lib/hooks/use-owner-formations.ts` (27 lignes, **jamais importé**) ; `apps/web/src/app/owner/formations/page.tsx` (simple redirection).
- Les erreurs sont avalées (`scalarCount` renvoie 0 sur échec, :8-19) : supprimer les tables ne casserait rien… et ne le dirait pas.

**Action** : Supprimer la route, le service, le schéma, le hook et la redirection (la redirection `/owner/formations` n'est plus nécessaire une fois les liens profonds du pouls corrigés, `Sidebar.tsx:148` la cite).

**Test** : `__tests__/owner-api-surface.test.ts` (statique), `owner-routes.test.ts`, `require-owner.test.ts` ; `imhotep-residue.mjs --group tables` ne doit plus citer `owner-formations`.

### B2 — Compteur « formateurs actifs » dans l'espace RH owner

**Dépendance** : Le cœur (RH owner) lit `formateurs`.

- `apps/api/src/services/owner-staff.service.ts:4` (import `table-names`), `:110-125` (`SELECT COUNT(*) FROM formateurs`), `:150` (`activeFormateurs`).
- `packages/contracts/src/owner.schema.ts:252` (`OwnerStaffResponseSchema.activeFormateurs`, champ optionnel, non lu par le web).
- `apps/api/src/utils/table-names.ts` (44 lignes) n'a que 18 importeurs : tous Imhotep, plus `owner-staff` et `owner-formations`.

**Action** : Retirer le bloc `activeFormateurs` et le champ du contrat ; supprimer ensuite `utils/table-names.ts` (le module `usesDedicatedTables`/`usesSessionBased…` renvoie des constantes : survivance du modèle `_aspci`).

**Test** : `owner-routes.test.ts`, `owner-api-surface.test.ts`.

### B3 — Rôle `formateur` : inférence, rôles assignables, menus RBAC, lignes `roles`

**Dépendance** : Le cœur (auth, owner, RBAC) connaît un rôle dont seule la table `formateurs` (Imhotep) fait foi.

- `apps/api/src/services/user-auth.service.ts:6` (`ROLE_PRIORITY`), `:86-97` (rôle inféré par `SELECT 1 FROM formateurs`, déjà dans un `try/catch` « le catalogue simplifié peut tourner sans formateurs »).
- `apps/api/src/services/owner-users.service.ts:6-14` (`OWNER_ASSIGNABLE_ROLE_KEYS` contient `formateur`, aussi utilisé en SQL :134) ; tests `__tests__/owner-routes.test.ts:25,111`, `__tests__/require-owner.test.ts:31-32`.
- `packages/contracts/src/admin-roles.schema.ts:228-270` (groupe « Catalogue Formations », clés `fpro.*`), `:555-580` (`FORMATEUR_MENU_CATALOG`, clés `formateur.*`), `:589` (`MENU_SCOPES`), `:597,605`, `:741` (menus par défaut).
- Données : tables `admin_role_menus`, `role_menu_denials` (migrations 0091/0092) contiennent des clés `fpro.%` / `formateur.%` ; table `roles` contient la ligne `formateur` (0055:167 ; Prisma `20260515112000_seed_reference_roles:70`) ; `user_roles` peut référencer ce rôle pour de vrais comptes.

**Action** : Retirer le rôle du code, du contrat et du menu ; migration de nettoyage des clés de menu sur le modèle de `0095_retire_admin_menu_keys.sql` ; suppression de la ligne `roles` et des `user_roles` correspondants EN DERNIER (étape 7, après confirmation).

**Test** : `owner-routes.test.ts`, `require-owner.test.ts` ; connexion manuelle de chaque rôle restant (admin, owner, teacher, parent, student) ; `imhotep-residue.mjs --group role-formateur --expect 0`.

### B4 — Contournements d'authentification des routes publiques Imhotep

**Dépendance** : Le cœur de sécurité (`auth-middleware`) exempte des routes Imhotep d'authentification.

- `apps/api/src/plugins/auth-middleware.ts:248` (`/api/v1/formations-pro`), `:253-257` (`GET /api/v1/sessions-pro/*` public), `:250` (`/api/v1/webhooks/livekit`, à garder tant que le webhook existe).

**Action** : À retirer APRÈS la suppression des routes (étape 4) — l'ordre inverse supprimerait une garde avant la route. Résultat : une surface publique de moins (le plan §2 note que le tenant du JWT est pris non vérifié sur les routes publiques).

**Test** : Requête non authentifiée vers `/api/v1/formations-pro` : 404 (route absente) et non 401 ; `GET /api/v1/health` reste public.

### B5 — LiveKit : retirer la branche Imhotep sans casser scolaire ni Professional

**Dépendance** : Le cœur ET le Professional partagent `live_sessions` et le service LiveKit avec Imhotep.

- `apps/api/src/routes/live-sessions.ts:25,41,57,69-74,120,643-649` ; `routes/webhooks/livekit.ts:31,38,63-70,174-186` ; `services/livekit.service.ts` (aucun importeur Imhotep).
- Schéma : `live_sessions.session_professionnelle_id` + `live_sessions_exactly_one_parent` (0056, redéfini par 0069:497-504) ; `live_session_attendances.subject_kind CHECK (tenant_user|public_user)` (0056:126).
- Web : `components/live-sessions/AddLiveSessionButton.tsx:12,19` (prop `parentType`), `app/formateur/sessions/[id]/details/page.tsx:100` (usage Imhotep, supprimé avec le portail formateur), `app/live/[id]/*` (C).
- Consommateurs à CONSERVER : `components/schedule/SessionDetails.tsx:5,64` (scolaire), `components/professional/ProfessionalLiveSessionsPanel.tsx`, `lib/hooks/use-professional-assignments.ts:432-515` (Professional), `packages/ui/src/components/LiveSessionRoom.tsx`.

**Action** : Réduire `ParentTypeSchema` à `instance` ; supprimer `resolvePublicRecipients` et le lookup `sessions_professionnelles` du webhook ; PUIS migration : supprimer la colonne `session_professionnelle_id` et recréer le CHECK à deux parents (`session_instance_id`, `professional_ecue_seance_id`), resserrer `subject_kind`. La table `live_sessions` et ses trois dépendantes restent.

**Test** : `professional-seance-validation.test.ts` ne couvre pas la visio : test manuel de bout en bout (création d'une visio sur une séance scolaire ET sur une séance ECUE, jeton, fin de séance, webhook simulé) ; `scripts/test-live-session-e2e.mjs` (Playwright, flux enseignant) ; `imhotep-residue.mjs --group public-user --expect 0`.

### B6 — Notifications : sujet `public_user`

**Dépendance** : Le dispatcher générique de notifications (cœur) porte un type de destinataire Imhotep.

- `apps/api/src/services/notifications-dispatch.service.ts:29-34` (`SubjectKind`), `:181-191` (`recipient_user_id` seulement pour `tenant_user`), `:295-297` (téléphone obligatoire pour `public_user`).
- `infra/scripts/migrations/0057_notifications.sql:26` (`app_notifications.subject_kind` CHECK), `:68` (`app_email_delivery_log.recipient_subject_kind`).
- `routes/notifications-inbox.ts` : ne lit que `tenant_user` (déjà prêt).

**Action** : Réduire `SubjectKind` à `tenant_user` ; supprimer les lignes `public_user` existantes AVANT de resserrer les CHECK (étape 7).

**Test** : Type-check de `notifications-dispatch.service.ts` ; test manuel : invitation de visio scolaire reçue dans la cloche (`NotificationBellWidget`).

### B7 — `pdf-generation.service.ts` : moitié Imhotep, moitié service partagé

**Dépendance** : L'espace owner utilise la méthode générique `generatePdfFromHtml`, le reste est le programme PDF d'une formation Imhotep.

- `apps/api/src/services/pdf-generation.service.ts:2` (import `FormationDetail`), `:42` (`generateProgrammePDF`), `:72-348` (gabarit « IMHOTEP DATA », :265,339), `:350` (`generatePdfFromHtml` — utilisé par `routes/owner/index.ts:133,1388-1404`).

**Action** : Extraire `generatePdfFromHtml`/`close`/`initialize` dans un module neutre (c'est le futur rendu PDF serveur du plan §3.10) ; supprimer `generateProgrammePDF` et son gabarit.

**Test** : Export owner PDF (route de `routes/owner/index.ts:1388`) ; `imhotep-residue.mjs --group tenant`.

### B8 — Contrat de paiement partagé par collision de noms

**Dépendance** : Le paiement des frais scolaires (cœur) importe un type qui se résout vers le contrat Imhotep.

- `apps/api/src/services/tresorpay-gateway.service.ts:3-8` importe `PaymentInitiationResponse, PaymentWebhook, CreatePaymentTransaction, TransactionStatus, PaymentMethodType` depuis la racine de `@ecoledigitale/contracts` ; or `student-payments.ts` n'est PAS exporté par la racine (`packages/contracts/src/index.ts:14`, « commented out due to conflicting… ») et seul `PaymentInitiationResponse` existe via `paiements-pro/types.ts:34`. Les quatre autres types ne se résolvent donc vers rien (erreurs TypeScript masquées par `type-check` désactivé, `apps/api/package.json:21`) ; sans effet à l'exécution (types effacés).

**Action** : Importer depuis `@ecoledigitale/contracts/src/student-payments` avant de retirer `paiements-pro` du barrel.

**Test** : `apps/api/src/tests/tresorpay-gateway.test.ts`, type-check ciblé.

### B9 — Coquille web : sidebar, redirection par rôle, intercepteur, rewrites Next

**Dépendance** : Fichiers centraux du web qui contiennent des entrées Imhotep.

- `apps/web/src/components/layout/Sidebar.tsx:263-286` (menus formateur / catalogue / admin sessions), `:682,749-752,879-886,1011-1015`, `:1847-1905` (groupes dépliants « Formations Pro »).
- `apps/web/src/lib/role-landing.ts:16` (`formateur` → `/formateur/dashboard`).
- `apps/web/src/lib/fetch-interceptor.ts:417-449,551,589-605` (traitement « route publique formations-pro »).
- `apps/web/next.config.js:120-125` (rewrites `/api/v1/formations-pro/*`).
- `apps/web/src/components/layout/AppLayout.tsx:15` (`NO_LAYOUT_PREFIXES` contient `/rso/formateur`, `/live` : à garder, ce sont RSO et la visio).

**Action** : Édition mécanique après suppression des pages (étape 5). `Sidebar.tsx` fait 2 177 lignes : la retouche doit rester minimale (la sidebar sera générée depuis le registre en Phase 1).

**Test** : Build web + `imhotep-residue.mjs --group web-paths --expect 0` ; parcours de connexion de chaque rôle.

### B10 — Points d'accroche de bootstrap (API) et barrel de contrats

**Dépendance** : Fichiers centraux qui référencent chaque module Imhotep.

- `apps/api/src/index.ts:94-99,103-106` (imports de routes), `:111` (`reservation-cleanup.job`), `:314-334,350-354` (enregistrements, y compris le double enregistrement de `sessions-pro` et `inscriptions-pro` à la racine `/api/v1`, :320,325), `:400-407` (démarrage des jobs `document-automation` et `reservation-cleanup`). À garder : `:363-365` (`live-sessions`, `webhooks/livekit`), `:368` (`notifications-inbox`).
- `packages/contracts/src/index.ts:23-83` (ré-exports).

**Action** : Éditions mécaniques, dans le même commit que la suppression des fichiers ciblés (sinon `tsx` échoue au démarrage : l'API tourne en `tsx src/index.ts`, `Dockerfile.api:38`).

**Test** : Démarrage de l'API (`GET /api/v1/health` 200) ; `imhotep-residue.mjs --group api-prefixes`.

### B11 — Prisma : le déploiement en dépend, et il porte aussi des tables du cœur

**Dépendance** : Le déploiement (`deploy.sh`) exécute `prisma migrate deploy` ; Prisma crée des tables que le cœur utilise.

- `infra/scripts/deploy.sh:35-123` (réparation de `_prisma_migrations`, `prisma migrate resolve`, `prisma migrate deploy --schema prisma/schema.prisma` :124) — **c'est le seul chemin de migration automatique en production** ; les 164 fichiers `infra/scripts/migrations/*.sql` ne sont appliqués par aucun script de déploiement (ils le sont à la main : `scripts/apply-migration-*.js`, `psql`).
- `apps/api/prisma/schema.prisma` (307 lignes) : modèles Imhotep (`FormationProfessionnelle`, `SessionProfessionnelle`, `Formateur`, `SessionFormateur`, `PublicUser`, `Account`, `UserSession`, `VerificationToken`, `InscriptionPublic`, `SupportCours`, `SupportSessionAssociation`) MAIS AUSSI des modèles du cœur : `BilanType`, `Programme`, `Course`, `StudentPeriodAttendanceSummary` et l'enum `DeliveryMode`.
- Tables du cœur créées UNIQUEMENT par la chaîne Prisma (absentes de `infra/scripts/migrations`) : `bilan_types`, `student_period_attendance_summaries`, `course_assignments`, `teaching_hours`, `admin_student_messages`, `admin_teacher_messages`, `teacher_student_messages`, `parent_school_conversations`, `parent_school_conversation_messages` (+ `parent_school_messages`, `teacher_announcements`, `teaching_units` : aucune citation dans le code). Voir `tables-usage-matrix.md`, statut `prisma-only`.
- `apps/api/package.json:18-20,37,82` (scripts `prisma:*`, `@prisma/client`, `prisma`) ; `@prisma/client` n'est importé par AUCUN fichier de `apps/api/src` (seul `apps/formation-pro-public` s'en sert).

**Action** : **Ne pas supprimer Prisma avec Imhotep** (le plan §5.1 le suggère). Ordre sûr : (1) porter en SQL les 9 tables du cœur ci-dessus dans un runner de migrations ; (2) remplacer l'étape `prisma migrate deploy` de `deploy.sh` ; (3) seulement alors supprimer `schema.prisma`, `prisma/migrations`, les scripts `prisma:*` et la réparation de `_prisma_migrations` (`0090_fix_prisma_migrations_tenant.sql`). Cette tâche relève de la Phase 1 (runner de migrations, ADR-005/006), pas de la suppression d'Imhotep.

**Test** : Déploiement sur staging depuis une base vierge puis depuis une copie de prod ; comparaison de `pg_dump --schema-only` avant/après.

### B12 — Identité de tenant Imhotep codée en dur dans le cœur

**Dépendance** : Le cœur suppose l'existence du tenant `imhotepacademy` / `imhotepdata`.

- `apps/web/src` : « imhotepacademy » comme repli dans **116 fichiers (181 occurrences)**, « imhotepdata » dans 10 (`apps/web/src/lib/api-utils.ts:17-39`, `contexts/TenantContext.tsx:11,28,89`).
- `apps/api/src/routes/files.ts:394,603` et `routes/student-courses.ts:512` : UUID de tenant `6eb9c106-b650-4398-b6fa-091b6828c4ba` associé au slug `imhotepacademy` ; `routes/evaluation-questions.ts:42,328,500,668,786` : `if (tenantId === 'imhotepacademy')`.
- `scripts/apply-aspci-migrations.js` et `package.json` : références au tenant `aspci`.

**Action** : Hors suppression stricte, mais à traiter AVANT le reset de base (D8) : un tenant recréé change d'UUID. À remplacer par la résolution unique de tenant de la Phase 1 (plan §2, §3.14).

**Test** : `imhotep-residue.mjs --group tenant` (360 occurrences aujourd'hui) ; e2e sur un tenant de test (`test-30091`).

### B13 — Marque « Imhotep Academy / IPAM » codée en dur dans les gabarits du cœur

**Dépendance** : Bulletins, reçus, attestations et bulletins de paie du cœur impriment l'identité d'Imhotep.

- `apps/api/src/services/report-card-template.service.ts:399-404`, `attendance-certificate-template.service.ts:444,467,504,509`, `receipt-generator.service.ts:414`, `teacher-payslip.service.ts:91`, `invoice.service.ts:117` (Imhotep, supprimé).
- `apps/web/src/lib/bulletin-format.ts:6-48` (INSTITUT IPAM, logos), `apps/web/src/app/payments/manage/page.tsx:768`, `payments/calculate/page.tsx:1615`, `app/api/teacher-payments/[id]/statement/route.ts:267,283,352`.
- Assets : `apps/api/assets/logo-ipam.jpeg`, `apps/web/public/logo-ipam.jpeg`, `embleme.*`.

**Action** : Branding par tenant (plan §3.10) : pas un prérequis de la suppression, mais à planifier avec 2.6.

**Test** : —

### B14 — Objets SQL partagés à ne pas emporter

**Dépendance** : Des objets créés par les migrations Imhotep sont utilisés par le cœur.

- Enum `delivery_mode` : créé par `0002_academic.sql:9` (cœur : `courses.delivery_mode`, `0002:76`, `0022:32`) puis réutilisé par `0037` et `0056_restore`. **Ne pas le supprimer** (Prisma : enum `DeliveryMode`, `schema.prisma:64`).
- Fonction `update_updated_at_column()` : redéfinie par `0040_formateur_space_tables.sql:254` mais utilisée par tous les triggers du cœur.
- `student_attendance.marked_via` (colonne ajoutée par 0056 pour le webhook LiveKit) : cœur.
- Enums Imhotep seuls (supprimables) : `session_professional_status`, `enrollment_type`, `enrollment_professional_status`, `promo_code_reduction_type`, `payment_method`, `payment_professional_status`, `document_type`, `export_type`, `job_status` (vérifié : utilisés uniquement par des tables Imhotep, `0037/0041/0046` et baseline Prisma). `payment_method_type` (sans « _type » = Imhotep) est, lui, utilisé par les paiements scolaires (`0012`).

**Action** : Écrire la migration de suppression avec liste blanche explicite (étape 7) et la rejouer sur une base copiée.

**Test** : Diff `pg_dump --schema-only` avant/après : seules les tables/fonctions/enums listés disparaissent.

### Preuves automatiques (imhotep-deps.mjs)

Importations entrantes vers les graines depuis des fichiers hors graines (24) :

| Depuis | Ligne | Vers |
|---|--:|---|
| `api/src/index.ts` | 94 | `api/src/routes/formations-pro.ts` |
| `api/src/index.ts` | 95 | `api/src/routes/sessions-pro.ts` |
| `api/src/index.ts` | 96 | `api/src/routes/inscriptions-pro.ts` |
| `api/src/index.ts` | 97 | `api/src/routes/codes-promo.ts` |
| `api/src/index.ts` | 98 | `api/src/routes/paiements-pro.ts` |
| `api/src/index.ts` | 99 | `api/src/routes/formateur.ts` |
| `api/src/index.ts` | 103 | `api/src/routes/documents.ts` |
| `api/src/index.ts` | 104 | `api/src/routes/entreprises.ts` |
| `api/src/index.ts` | 105 | `api/src/routes/exports.ts` |
| `api/src/index.ts` | 106 | `api/src/routes/reporting.ts` |
| `api/src/index.ts` | 111 | `api/src/jobs/reservation-cleanup.job.ts` |
| `api/src/index.ts` | 401 | `api/src/jobs/document-automation.job.ts` |
| `api/src/services/owner-formations.service.ts` | 4 | `api/src/utils/table-names.ts` |
| `api/src/services/owner-staff.service.ts` | 4 | `api/src/utils/table-names.ts` |
| `packages/contracts/src/index.ts` | 24 | `packages/contracts/src/formations-pro.ts` |
| `packages/contracts/src/index.ts` | 27 | `packages/contracts/src/inscriptions-pro/index.ts` |
| `packages/contracts/src/index.ts` | 30 | `packages/contracts/src/codes-promo/index.ts` |
| `packages/contracts/src/index.ts` | 33 | `packages/contracts/src/paiements-pro/index.ts` |
| `packages/contracts/src/index.ts` | 61 | `packages/contracts/src/sessions-pro/index.ts` |
| `packages/contracts/src/index.ts` | 77 | `packages/contracts/src/sessions-pro/index.ts` |
| `packages/contracts/src/index.ts` | 80 | `packages/contracts/src/documents/index.ts` |
| `packages/contracts/src/index.ts` | 81 | `packages/contracts/src/entreprises/index.ts` |
| `packages/contracts/src/index.ts` | 82 | `packages/contracts/src/exports/index.ts` |
| `packages/contracts/src/index.ts` | 83 | `packages/contracts/src/reporting/index.ts` |

Références SQL entrantes vers des tables Imhotep depuis des fichiers hors graines, hors tests (21) :

| Table | Fichier | Lignes |
|---|---|---|
| `entreprises_clientes` | `api/src/services/owner-formations.service.ts` (partagé) | 47 |
| `formateurs` | `api/src/services/owner-formations.service.ts` (partagé) | 48 |
| `formateurs` | `api/src/services/owner-staff.service.ts` | 116 |
| `formateurs` | `api/src/services/user-auth.service.ts` (partagé) | 89 |
| `inscriptions_professionnelles` | `api/src/services/owner-formations.service.ts` (partagé) | 45 |
| `inscriptions_public` | `api/src/routes/live-sessions.ts` (partagé) | 643 |
| `live_session_attendances` | `api/src/routes/webhooks/livekit.ts` (partagé) | 81, 99, 128, 153, 200, 225, 300 |
| `live_session_recordings` | `api/src/routes/live-sessions.ts` (partagé) | 199, 467, 514 |
| `live_session_recordings` | `api/src/routes/webhooks/livekit.ts` (partagé) | 339, 368, 486 |
| `live_session_recordings` | `api/src/services/livekit.service.ts` (partagé) | 187 |
| `live_session_webhook_events` | `api/src/routes/webhooks/livekit.ts` (partagé) | 16, 52 |
| `live_sessions` | `api/src/routes/live-sessions.ts` (partagé) | 79, 155, 168, 182, 359 |
| `live_sessions` | `api/src/routes/webhooks/livekit.ts` (partagé) | 20, 39, 110, 191, 208, 264, 460 |
| `live_sessions` | `api/src/services/professional-live-sessions.service.ts` (partagé) | 5, 80, 113, 125, 147, 168, 183, 188 |
| `live_sessions` | `scripts/apply-migration-0066-professional-session-features.js` | 7 |
| `paiements_professionnels` | `api/src/services/owner-formations.service.ts` (partagé) | 46 |
| `public_users` | `api/src/routes/live-sessions.ts` (partagé) | 644 |
| `public_users` | `api/src/services/notifications-dispatch.service.ts` (partagé) | 34 |
| `sessions_professionnelles` | `api/src/routes/live-sessions.ts` (partagé) | 73, 74 |
| `sessions_professionnelles` | `api/src/routes/webhooks/livekit.ts` (partagé) | 175, 181 |
| `sessions_professionnelles` | `api/src/services/owner-formations.service.ts` (partagé) | 44 |

Appels HTTP entrants (web → préfixes Imhotep ou partagés) :

| Fichier | Lignes : préfixe |
|---|---|
| `web/next.config.js` | 120: /formations-pro, 121: /formations-pro, 124: /formations-pro, 125: /formations-pro |
| `web/src/app/live/[id]/page.tsx` | 23: /live-sessions, 36: /live-sessions, 42: /live-sessions, 52: /live-sessions |
| `web/src/app/live/[id]/recordings/page.tsx` | 49: /live-sessions, 66: /live-sessions |
| `web/src/components/live-sessions/AddLiveSessionButton.tsx` | 41: /live-sessions |
| `web/src/components/notifications/NotificationBellWidget.tsx` | 14: /notifications-inbox, 15: /notifications-inbox, 24: /notifications-inbox, 36: /notifications-inbox, 46: /notifications-inbox, 55: /notifications-inbox |
| `packages/ui/src/components/NotificationBell.tsx` | 11: /notifications-inbox |

Clés étrangères entrantes depuis le cœur : **0**. Symboles de contrats Imhotep importés par le cœur : `api/src/services/pdf-generation.service.ts` (FormationDetail).

## 4. C — À CONSERVER (rangé à tort sous Imhotep)

| Ensemble | Pourquoi | Preuves |
|---|---|---|
| Prospection, commerciaux, commissions (`commerciaux`, `student_provenances`, `commissions_versements`) | Rattachés aux encaissements Professional (`professional_payments`) et à l'espace owner ; sans lien avec Imhotep ni avec la paie des enseignants. | `infra/scripts/migrations/0120_prospection_commerciaux.sql`, `0124_provenance_canal_autre.sql`, `0125_commission_par_paiement.sql:31-32` ; `routes/prospection.ts`, `services/prospection.service.ts`, `services/owner-prospection.service.ts` ; `apps/web/src/components/prospection/*`, `apps/web/src/app/professionnel/admin/prospection/page.tsx`, `packages/contracts/src/prospection.ts` ; Tests : `__tests__/prospection-commission.test.ts`, `__tests__/owner-prospection-canaux.test.ts`, `apps/web/src/__tests__/commerciaux-report.test.ts`, `provenances-report.test.ts`, `commissions-historique-report.test.ts` |
| Visioconférence LiveKit : `live_sessions`, `live_session_recordings`, `live_session_attendances`, `live_session_webhook_events`, `livekit.service.ts`, `routes/live-sessions.ts`, `routes/webhooks/livekit.ts`, `professional-live-sessions.service.ts`, `app/live/[id]/*`, `packages/ui` `LiveSessionRoom` | Servent la séance scolaire (`instance`) ET la séance ECUE du Professional (`professional_ecue_seance_id`). Seule la branche `professionnelle` / `public_user` est Imhotep (B5). | `routes/live-sessions.ts:25`, `0056_live_sessions.sql`, `0069_pedagogie_ue_ecue.sql:486-505` ; `components/schedule/SessionDetails.tsx:64`, `components/professional/ProfessionalLiveSessionsPanel.tsx` ; `apps/api/package.json` `livekit-server-sdk` ; variables `LIVEKIT_*` |
| Infrastructure de notifications : `app_notifications`, `app_email_delivery_log`, `app_whatsapp_delivery_log`, `notifications-dispatch.service.ts`, `routes/notifications-inbox.ts`, `NotificationBellWidget`, `packages/ui` `NotificationBell`, `wasender.ts`, `whatsapp-delivery-log.ts` | Utilisées par le dispatch de visio scolaire et la messagerie du cœur (`services/message-delivery.ts` : admin-email, admin-messages, parent/student/teacher-messages). Seul le sujet `public_user` est Imhotep (B6). | `services/message-delivery.ts` ← 5 routes de messagerie ; `components/layout/Header.tsx:5` ← `NotificationBellWidget` |
| `email.service.ts` (nodemailer) | Importé par 5 fichiers Imhotep mais aussi par 10 du cœur (auth, étudiants, enseignants, parents, messagerie, bulletins de paie). | `routes/auth.ts:15`, `routes/students.ts:16`, `routes/teachers.ts:11`, `routes/parents.ts:4`, `services/message-delivery.ts:16`, `services/teacher-payslip-notification.service.ts:18` |
| `pdf-generation.service.ts` (partie rendu HTML→PDF) | `generatePdfFromHtml` sert l'espace owner ; base du futur rendu PDF serveur (B7). | `routes/owner/index.ts:133,1388-1404` |
| Abstraction de paiement : `payment-provider.interface.ts` + adaptateurs Orange, MTN, Wave, carte bancaire (CinetPay), TresorPay | Aujourd'hui importés par le seul `paiement-pro.service.ts`, donc supprimés avec Imhotep ; mais le plan (§3.12) dit de RÉUTILISER cette interface pour le module Finance. Décision à prendre avant suppression : les archiver (tag git) ou les déplacer sous `packages/` ; Orange et Wave sont des mocks. | `services/payment-provider.interface.ts` ← 6 importeurs, tous Imhotep ; `services/tresorpay-gateway.service.ts` (cœur : `routes/student-payments.ts:4`) est DIFFÉRENT de `tresorpay.service.ts` (adaptateur Imhotep) |
| `registration_requests` et `routes/registration-requests.ts` | Auto-inscription d'élèves/parents validée par l'administration de l'école, pas du portail public Imhotep (`routes/registration-requests.ts` crée `users`, `student_profiles`, `student_parents`). | `routes/registration-requests.ts:1-60` ; `services/owner-recrutement.service.ts` |
| Module Professionnel (`professional_*`, `routes/professional.ts`, `apps/web/src/app/professionnel/*`) et rémunération (spec 031) | Le code utilise massivement les mots « session », « formation », « filière » ; ce n'est PAS Imhotep (commentaire de `index.ts:336-337` : « Module DISTINCT du module formations professionnelles »). Aucun import entrant vers les fichiers Imhotep. | `imhotep-removal-inventory.json` → `inbound_imports` (aucune ligne depuis `professional*`) |
| Rôle « formateur » du module RSO (`apps/web/src/app/_rso/formateur/*`, `components/rso/formateur/*`) et tables `rso_*` | Homonyme sans rapport (rôle interne RSO-PFSO). RSO n'est pas dans le plan : sort à décider séparément. | `routes/rso/activities.ts:318` ; `apps/web/src/components/layout/AppLayout.tsx:15` |
| Enum `delivery_mode`, fonction `update_updated_at_column()`, colonne `student_attendance.marked_via` | Objets SQL du cœur déclarés ou redéfinis dans des migrations Imhotep (B14). | `0002_academic.sql:9` ; `0040_formateur_space_tables.sql:254` ; `0056_live_sessions.sql` |
| Scripts qui portent « session » dans le nom : `scripts/creer-session-aout-2026.js`, `scripts/README_DELETE_SESSIONS.md`, `scripts/test-live-session-e2e.mjs` | Professional (cohorte), génération d'emploi du temps scolaire, visio enseignante. | en-têtes des fichiers |

## 5. Vérifications demandées par le plan (§5.2)

### Le rôle `formateur` est-il utilisé par le module Professional / la rémunération ?

**Non.** Aucune occurrence de « formateur » dans `routes/professional.ts`, `routes/professional-remuneration.ts`, `middlewares/professional-guards.ts`, `services/professional-*.ts`, ni dans les collecteurs d'heures (seul `hour-collectors/types.ts:18` le cite, comme exemple hypothétique d'une « 3ᵉ origine »). Le Professional et la paie travaillent sur `teachers` / rôle `teacher` (`professional_ue_sessions.enseignant_id → teachers.id`, 0069:149 ; `professional-teacher.service.ts`). Le rôle `formateur` n'est consommé que par : l'inférence d'authentification (`services/user-auth.service.ts:6,86-97`), la liste des rôles assignables par le propriétaire (`services/owner-users.service.ts:6-14`), le catalogue de menus RBAC (`packages/contracts/src/admin-roles.schema.ts:559-605`), les lignes de la table `roles` (`infra/scripts/migrations/0055_unified_multitenancy.sql:167`, `apps/api/prisma/migrations/20260515112000_seed_reference_roles/migration.sql:70`) et le web (`Sidebar.tsx:682,749-752,885-886`, `role-landing.ts:16`). Attention à l'homonyme : le module RSO a son PROPRE rôle interne « formateur » (`apps/web/src/app/_rso/formateur/*`, `components/rso/formateur/*`, `routes/rso/activities.ts:318`) qui n'a rien à voir et ne doit pas être supprimé par un `grep formateur`.

### `live-sessions.ts` (parentType `instance` | `professionnelle`) sert-il le scolaire ?

**Oui, et le Professional aussi : à CONSERVER (catégorie C), en retirant seulement la branche Imhotep.** `routes/live-sessions.ts:25` : `parentType = "instance"` (→ `session_instances`, séance de l'emploi du temps scolaire) ou `"professionnelle"` (→ `sessions_professionnelles`, Imhotep). Le bouton « visio » du planning scolaire (`apps/web/src/components/schedule/SessionDetails.tsx:64`, `AddLiveSessionButton parentType="instance"`) et la page `/live/[id]` (message d'en-tête : « school-side live sessions ») en dépendent ; les destinataires de l'invitation sont les élèves inscrits (`live-sessions.ts:596-620`, jointure `student_enrollments`). De plus `live_sessions` a une **troisième** colonne parent `professional_ecue_seance_id` (migration 0069:486-505, CHECK « exactement un parent ») utilisée par `services/professional-live-sessions.service.ts` et `components/professional/ProfessionalLiveSessionsPanel.tsx`. Le webhook LiveKit écrit dans les présences scolaires (`routes/webhooks/livekit.ts:216-300`). → Retirer : `session_professionnelle_id` (colonne + CHECK + index), la branche `parentType = "professionnelle"` (`live-sessions.ts:25,41,57,69-74,120`, `webhooks/livekit.ts:31,38,174-186`), `resolvePublicRecipients` (`live-sessions.ts:628-655`), le préfixe d'identité `pu_` (`webhooks/livekit.ts:63-70`, `live-sessions.ts:293`).

### `entreprises` (`entreprises_clientes`) : qui s'en sert ?

**Imhotep seul** (inscriptions en entreprise, conventions/devis, exports CA). Aucune citation dans le Professional, la prospection ni la paie. Seule dépendance entrante du cœur : `services/owner-formations.service.ts:47,82` (compteur « entreprises »), lui-même orphelin côté web (voir B1). Le concept reviendra avec le type de financement `COMPANY` du futur module Finance (plan §3.12) : le modèle sera à reconcevoir, pas à reprendre.

### Prospection / commissions (migration 0125) : lien avec l'owner / la paie ?

**Lien avec l'owner et les encaissements Professional, aucun lien avec Imhotep ni avec la paie des enseignants. À CONSERVER (catégorie C), mal rangé sous « Imhotep ».** `commissions_versements.payment_id → professional_payments(id) ON DELETE CASCADE` (0125:31-32) ; `services/prospection.service.ts` lit `professional_orders/payments/enrollments/ue_sessions`, `student_profiles`, `cycles_frais` ; `services/owner-prospection.service.ts` alimente l'écran owner ; routes `routes/prospection.ts` (gardes `professional-guards`). Aucune citation de `teacher_payments` ni de `payment_periods` : « commission » (rémunération d'un commercial) ≠ « paie » (rémunération d'un enseignant, spec 031). Tests : `__tests__/prospection-commission.test.ts`, `owner-prospection-canaux.test.ts`. Seul rapprochement : le mot « commission » ; ne pas fusionner avec `032-payroll-port`.

### `notifications.subject_kind = public_user`

**La table concernée est `app_notifications`, pas `notifications`** (cette dernière est le fil de messages parents, `routes/parent-messages.ts:1939-2117`). `app_notifications.subject_kind` (0057:26) vaut `tenant_user | public_user` (CHECK) ; `app_email_delivery_log` et `live_session_attendances` (0056:126) portent le même couple. Seul `notifications-dispatch.service.ts` (type `SubjectKind` :29, branches :181-191,295-297) et deux routes LiveKit produisent `public_user`. La cloche `routes/notifications-inbox.ts` ne lit QUE `tenant_user` (:74,125,152,163,190). → B6 : on retire le sujet `public_user` du code, puis on resserre les CHECK ; l'infrastructure de notification (dispatcher, in-app, e-mail, WhatsApp) reste (C).

### Twilio / SMS

**Twilio n'est utilisé que par Imhotep** : `services/sms.service.ts` (88 lignes, seule importation de `twilio`) est appelé par `paiement-pro.service.ts:493-527` (confirmation de paiement) et `formateur-messaging.service.ts:174` (messages aux apprenants). Dépendance npm `twilio` exclusive à ce fichier ; variables `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER` (`apps/api/ENV_EXAMPLE.md:93-97`). Le cœur n'envoie AUCUN SMS réel : `services/notification.service.ts` (appelé seulement par `routes/notifications.ts`, rappels de paiement) SIMULE e-mail et SMS (`sendSMS` simulé, 685 lignes) ; `routes/parent-settings.ts` ne stocke que des préférences. La suppression de Twilio ne casse donc rien mais laisse le produit sans canal SMS : le choix du fournisseur CI (plan §8, point ouvert 2) devient un prérequis de Phase 3, pas de la suppression. WhatsApp (`wasender.ts`, `whatsapp-delivery-log.ts`) est un autre canal, utilisé par le cœur : à conserver.

### Dépendances npm propres à Imhotep

Voir §2.7 (généré). Résumé : `apps/api` : `twilio`, `axios` (adaptateurs Orange/MTN/carte), `exceljs` (exports/reporting Imhotep), `pdfkit` (factures/documents Imhotep) ne sont importés que par des fichiers Imhotep ; `apps/web` : `@fullcalendar/list` ; **tout `apps/formation-pro-public/package.json`** (next-auth, @prisma/client, resend, nodemailer, bcryptjs, zustand…). À NE PAS retirer : `livekit-server-sdk` (API, via `livekit.service.ts` partagé), `nodemailer` (e-mail du cœur), `puppeteer`, `docx*`/`pizzip`/`mammoth`/`pdf-lib` (attestation de présence scolaire, `attendance-certificate-template.service.ts`). Aucun import trouvé, donc retirables mais SANS rapport avec Imhotep : `bullmq`, `ioredis`, `node-cron`, `sharp`, `fluent-ffmpeg`, `isomorphic-dompurify` (api) ; `@dnd-kit/*`, `react-grid-layout`, `@tinymce/*`, `@react-pdf-viewer/*`, `livekit-client`, `@livekit/components-*`, `qrcode`, `pdfjs-dist`… (web) — à vérifier un par un (imports dynamiques, configuration) avant d'agir. NB : `exceljs` redeviendra nécessaire pour les imports/exports Excel du plan (§3.13).

### Workflows de déploiement, nginx, compose de `formation-pro-public`

`.github/workflows/deploy.yml` n'a **aucune** référence à Imhotep (il lance `infra/scripts/deploy.sh` sur deux runners auto-hébergés) ; c'est `deploy.sh:29` qui construit l'image `ecoledigitale-formation-pro` (si on supprime le service de `docker-compose.yml` sans toucher à cette ligne, `dc build` échoue et le déploiement entier s'arrête). `infra/compose/docker-compose.yml:29-57` (service, port hôte 3012, `NEXTAUTH_URL` propre, `depends_on` API), `infra/compose/Dockerfile.formation-pro-public` (68 lignes, génère le client Prisma depuis `apps/api/prisma/schema.prisma`), `infra/nginx/formation-pro.conf` (79 lignes ; vhost `formation-pro.allianceconsultants.net` → :3012 + proxy `/api/v1/` → :8011 ; **installé à la main sur le serveur** dans `/etc/nginx/sites-available/formation-pro`, `bootstrap-server.md:83-115`), `infra/.env.example:32-53` (`GOOGLE_CLIENT_*`, `PAYHUBSECURE_*`, `NEXT_PUBLIC_APP_URL`). Côté externe (hors dépôt) : DNS, certificat Let's Encrypt, client OAuth Google (`bootstrap-server.md:204-233`), compte PayHubSecure, Resend, Twilio, Vimeo.

### Contrats Zod

Dossiers/fichiers Imhotep dans `packages/contracts/src` : `formations-pro.ts`, `inscriptions-pro/`, `codes-promo/`, `paiements-pro/`, `sessions-pro/`, `documents/`, `entreprises/`, `exports/`, `reporting/`, `formateurs/` (37 fichiers). Ils sont ré-exportés par `packages/contracts/src/index.ts:24,27,30,33,36-77,80-83` (à retirer). Collisions de noms silencieuses à connaître : `PaymentStatus(Schema)`, `PaymentInitiationResponse`, `EnrollmentStatus`, `DeliveryMode`, `CalendarEvent` existent à la fois côté Imhotep et côté cœur ; `PaymentInitiationResponse` importé depuis la racine par `services/tresorpay-gateway.service.ts:3-8` (cœur, paiements élèves) se résout aujourd'hui vers la version `paiements-pro` (B8). `OwnerFormationsResponseSchema` et `activeFormateurs` vivent dans `owner.schema.ts:252,255-261,301` (B1/B2). `admin-roles.schema.ts` porte les menus `fpro.*` et `formateur.*` (B3). Aucun autre fichier du cœur n'importe un symbole des dossiers Imhotep (détection par import nommé, `imhotep-removal-inventory.json` → `inbound_contract_symbols`) hormis `pdf-generation.service.ts:2` (`FormationDetail`).

## 6. Ordre de suppression en étapes sûres

Chaque étape est livrable et réversible seule (`main` reste déployable). **L'étape 3 hors dépôt et l'étape 7 sont destructives et soumises à votre confirmation explicite.** Le test de fin d'étape se compose toujours de (a) la suite de tests nommée, (b) `node scripts/inventory/imhotep-residue.mjs` (le groupe concerné doit tomber à 0), (c) un parcours manuel court.

Commandes disponibles : `node scripts/inventory/imhotep-residue.mjs --list`, `--group <nom> --expect 0` (code retour 1 sinon), et `node scripts/inventory/imhotep-deps.mjs` pour revoir les dépendances entrantes tant que les fichiers existent.

### Étape 0 — Préalables (aucune modification de code)

**À faire**

- Sauvegarde complète de la base (tâche 0.7) ; tag git `pre-imhotep-removal` ; confirmer D8 : requêtes **de comptage en lecture seule** sur chaque tenant (`SELECT count(*)` sur `formations_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `public_users`, `inscriptions_public`, `formateurs`, `live_sessions WHERE session_professionnelle_id IS NOT NULL`) — non exécutées par cet inventaire.
- Décider du sort du code de paiement (C : adaptateurs Orange/MTN/Wave/CinetPay/TresorPay) et d'un éventuel export des données réelles (formations, inscriptions, paiements) avant destruction.
- Capturer la base de référence des tests : `node scripts/inventory/build-tables-matrix.mjs` (matrice), `node scripts/inventory/imhotep-deps.mjs` (dépendances entrantes), `node scripts/inventory/imhotep-residue.mjs` (compteurs de résidus) ; relever le nombre d'erreurs de `tsc` actuel (le type-check est désactivé : `apps/api/package.json:21`, `ignoreBuildErrors` côté web) pour pouvoir dire « pas de nouvelle erreur ».

**Test de fin d'étape**

- Les trois commandes ci-dessus s'exécutent sans erreur ; sauvegarde restaurable sur une base jetable (jamais sur la prod).

### Étape 1 — Découpler le cœur (B1, B2, B3, B6, B7, B8) — code seul, rien n'est supprimé

**À faire**

- B1 : retirer la route owner `/formations`, `owner-formations.service.ts`, `OwnerFormationsResponseSchema`, `use-owner-formations.ts`, la page de redirection.
- B2 : retirer `activeFormateurs` (service + contrat).
- B3 : retirer l'inférence du rôle `formateur` (`user-auth.service.ts`), `formateur` de `OWNER_ASSIGNABLE_ROLE_KEYS`, les catalogues de menus `fpro.*`/`formateur.*` ; adapter les tests `owner-routes.test.ts` / `require-owner.test.ts`.
- B6 : réduire `SubjectKind` à `tenant_user` dans `notifications-dispatch.service.ts`.
- B7 : extraire `generatePdfFromHtml` du service PDF ; B8 : corriger l'import de `tresorpay-gateway.service.ts`.

**Test de fin d'étape**

- API (statiques, sans base) : `pnpm --filter @ecoledigitale/api test -- owner-api-surface require-owner owner-prospection-canaux professional-results` ; avec base de test : `-- owner-routes tresorpay-gateway`.
- `node scripts/inventory/imhotep-deps.mjs` : `inbound_table_references` ne doit plus contenir `owner-formations`, `owner-staff`, `user-auth` ; `inbound_imports` ne doit plus contenir `utils/table-names.ts`.
- Connexion manuelle (admin, owner, teacher, parent, student).

### Étape 2 — Découpler LiveKit (B5) — code seul

**À faire**

- Réduire `parentType` à `instance` ; retirer `resolvePublicRecipients`, le lookup `sessions_professionnelles` du webhook, le préfixe `pu_`.
- Laisser les colonnes `session_professionnelle_id` et `subject_kind` en place jusqu'à l'étape 7 (rollback possible).

**Test de fin d'étape**

- Scénario manuel : visio sur une séance du planning scolaire, visio sur une séance ECUE du Professional (jeton, démarrage, fin, webhook de présence).
- `node scripts/inventory/imhotep-residue.mjs --group public-user --expect 0`.

### Étape 3 — Retirer le portail public et son infrastructure

**À faire**

- Retirer le service `ecoledigitale-formation-pro` de `docker-compose.yml:29-57`, la ligne `deploy.sh:29`, `Dockerfile.formation-pro-public`, `nginx/formation-pro.conf` ; supprimer `apps/formation-pro-public/` ; scripts racine `dev:formation-public`, `db:formation-public:*`, `migrate:imhotep-data`, `test:imhotep-data*`, `validate:imhotep-data` (`package.json:13-15,22,29-31`) ; `scripts/prepare-formation-public-db.mjs`.
- Régénérer `pnpm-lock.yaml` dans le même commit (un `pnpm install --frozen-lockfile` échouerait sinon : `Dockerfile.api`, `Dockerfile.web`).
- Côté serveur (hors dépôt, sous confirmation explicite) : arrêter le conteneur, retirer le vhost nginx et le certificat, désactiver le client OAuth Google et les comptes PayHubSecure/Resend.

**Test de fin d'étape**

- `docker compose -f infra/compose/docker-compose.yml config` valide ; déploiement complet sur le runner de STAGING (`deploy.sh`) jusqu'au health check ; `node scripts/inventory/imhotep-residue.mjs --group infra --expect 0`.

### Étape 4 — Retirer le code API Imhotep (routes, services, jobs, contrats, dépendances)

**À faire**

- Supprimer les 41 fichiers API listés en A (routes `formations-pro`, `sessions-pro`, `inscriptions-pro`, `paiements-pro`, `formateur`, `codes-promo`, `entreprises`, `documents`, `exports`, `reporting` ; services associés ; middleware `formateurAuth` ; jobs `document-automation` et `reservation-cleanup` ; utilitaires) ; retirer leurs enregistrements dans `index.ts` (B10) et les contournements d'auth (B4).
- Supprimer les contrats Imhotep et leurs ré-exports ; retirer de `apps/api/package.json` : `twilio`, `axios`, `exceljs`, `pdfkit` (après vérification, cf. §2.7) ; régénérer le lockfile.

**Test de fin d'étape**

- Démarrage de l'API puis `GET /api/v1/health` = 200 ; `GET /api/v1/formations-pro` = 404.
- `pnpm --filter @ecoledigitale/api test` (suite complète, base de test) ; en particulier `heures-consommees`, `payment-calculator-*`, `professional-*`, `owner-*`.
- `node scripts/inventory/imhotep-residue.mjs --group api-prefixes` : seules des occurrences web doivent rester ; `--group role-formateur`, `--group sms --expect 0`.

### Étape 5 — Retirer le web Imhotep

**À faire**

- Supprimer `app/formations-professionnelles/**`, `app/formateur/**`, `app/api/v1/formations-pro/**`, `components/{formations-pro,inscriptions-pro,sessions-pro,formateur}`, `components/admin/{entreprises,exports,formateurs,documents,reporting}`, les hooks `use-*` listés en A, `lib/pro-tenants.ts`, le test `formation-detail-button-click-fix.test.tsx`.
- Éditer `Sidebar.tsx`, `role-landing.ts`, `fetch-interceptor.ts`, `next.config.js` (B9) ; retirer `@fullcalendar/list` de `apps/web/package.json`.

**Test de fin d'étape**

- `pnpm --filter @ecoledigitale/web build` (attention : `ignoreBuildErrors` masque les erreurs de types : comparer le nombre d'erreurs `tsc --noEmit` avec la base de l'étape 0) ; `pnpm --filter @ecoledigitale/web test` si exécutable ; Playwright `apps/web/e2e/*` ; parcours de connexion de chaque rôle.
- `node scripts/inventory/imhotep-residue.mjs --group web-paths --expect 0` et `--group api-prefixes --expect 0`.

### Étape 6 — Scripts, documentation et configuration résiduelle

**À faire**

- Supprimer les 15 scripts Imhotep (`scripts/*imhotep*`, `create-formations-*`, `create-sessions-pro`, `create-inscriptions-pro`, `apply-aspci-*`, `migrate-reservations-temporaires`, `migrate-add-carriere`, `apply-price-precision-migration`) et les deux guides `IMHOTEP_DATA_*.md` ; retirer `test:formations-pro` d'`apps/api/package.json:27` (script qui pointe un fichier absent).
- Variables d'environnement : retirer des fichiers d'exemple et des `.env` serveur `TWILIO_*`, `PAYHUBSECURE_*`, `GOOGLE_CLIENT_*` (portail), `RESEND_*`, `VIMEO_*`, `ORANGE_MONEY_*`, `MTN_MONEY_*`, `WAVE_*`, `CINETPAY_*` si l'étape 0 a conclu à l'abandon des adaptateurs ; faire tourner les secrets qui étaient dans le dépôt (plan 0.4).

**Test de fin d'étape**

- `node scripts/inventory/imhotep-residue.mjs --group sms --expect 0` ; `git grep -il imhotep -- scripts infra .github package.json` ne retourne plus que des archives voulues.

### Étape 7 — Base de données (SOUS CONFIRMATION EXPLICITE, après sauvegarde, staging d'abord)

**À faire**

- Migration de suppression, avec liste blanche, dans cet ordre (enfants d'abord, d'après les FK relevées) : `documents`, `export_jobs`, `support_telechargements`, `support_session_associations`, `supports_cours`, `session_attendance`, `formateur_indisponibilites`, `notifications_formateurs`, `session_formateurs`, `paiements_professionnels`, `reservations_temporaires`, `inscriptions_public`, `accounts`, `user_sessions`, `verification_tokens`, `inscriptions_professionnelles`, `public_users`, `sessions_professionnelles`, `formateurs`, `entreprises_clientes`, `codes_promo`, `formations_professionnelles`, puis les 17 tables `*_aspci` du baseline Prisma si elles existent.
- Puis : fonctions `generate_session_code`, `set_session_code`, `generate_enrollment_number`, `set_enrollment_number`, `generate_invoice_number`, `update_session_capacity_on_enrollment_change` (+ triggers) ; enums listés en B14 ; colonne `live_sessions.session_professionnelle_id` + CHECK à deux parents ; resserrage des CHECK `subject_kind` après suppression des lignes `public_user` ; nettoyage RBAC (`admin_role_menus`/`role_menu_denials` clés `fpro.*`/`formateur.*`, ligne `roles = formateur`, `user_roles` associés).
- NE PAS supprimer : `delivery_mode`, `update_updated_at_column()`, `live_sessions`/`live_session_*`, `app_*`, `student_attendance.marked_via`, `payment_method_type`.

**Test de fin d'étape**

- Sur une copie : `pg_dump --schema-only` avant/après (seuls les objets listés disparaissent) ; `node scripts/inventory/build-tables-matrix.mjs` : plus aucune table de domaine `imhotep` hors `live_*` ; suite API complète ; scénario S17-T (paie) et visio scolaire/ECUE inchangés.

### Étape 8 — Prisma (tâche séparée, dépend de la Phase 1)

**À faire**

- Ne PAS supprimer Prisma ici (B11). Quand le runner de migrations existe : porter les 9 tables du cœur uniquement connues de Prisma, remplacer l'étape de `deploy.sh`, puis retirer `schema.prisma`, `prisma/migrations`, `@prisma/client`, `prisma` et `0090_fix_prisma_migrations_tenant.sql`.

**Test de fin d'étape**

- Déploiement sur base vierge ET sur copie de prod ; comparaison de schéma.

## 7. Ce qui reste incertain

- Le schéma réel de production n'est pas versionné : `infra/scripts/migrations` (rejoué) et la chaîne Prisma (baseline du 03/04/2026) se contredisent (ex. `course_assignments` et `teaching_hours` supprimées par `0005_academic_years.sql` mais présentes dans le baseline et citées par 12 fichiers API). Seul un `pg_dump --schema-only` de la base réelle tranchera ; cet inventaire n'a exécuté aucune requête.
- Les fichiers `0021_rso_phase1.sql` à `0026_rso_phase6.sql` référencés par `scripts/migrate-rso-*.js` et leurs scripts de rollback ne sont pas dans le dépôt : les tables `rso_users`, `rso_annees`… (13 tables) n'ont pas de CREATE versionné.
- Données réelles : on ignore si `imhotepacademy`, `imhotepdata` ou `aspci` contiennent des données à conserver (D8 est une hypothèse). Aucun comptage n'a été fait.
- Le portail public est-il en production (DNS, certificat, clients OAuth, comptes PayHubSecure/Resend) ? Seuls les fichiers de configuration le laissent penser.
- Usage réel de la visio scolaire (`parentType = "instance"`) : le code et l'UI existent (`SessionDetails.tsx:64`), la fréquentation est inconnue. Même incertitude pour le webhook de présence LiveKit.
- La détection « importé par aucun fichier » ignore les imports dynamiques par chaîne construite et les usages par configuration (ex. dépendances npm sans import) ; chaque dépendance à retirer doit être revérifiée.
- Le comptage « web appelant » repose sur des préfixes `/api/v1/...` trouvés dans le texte : sur-estimation (préfixes génériques) et sous-estimation (URLs construites à partir d'une variable de base).

## 8. Compteurs de résidus au moment de l'inventaire

À relancer : `node scripts/inventory/imhotep-residue.mjs` (le portail `apps/formation-pro-public` est exclu du balayage ; les fichiers Imhotep eux-mêmes comptent tant qu'ils existent).
