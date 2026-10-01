# Imhotep — rapport de suppression du code

> Exécution de `imhotep-removal-inventory.md` (étapes 1 à 6). **Périmètre : le code seulement.** Aucune migration SQL n'a été ajoutée ni modifiée (`infra/scripts/migrations/*.sql`, `apps/api/prisma/migrations` intacts), aucun `DROP`. Les tables et les données Imhotep sont toujours en base ; elles seront supprimées au reset de la Phase 2, avec sauvegarde et confirmation explicite du propriétaire.

Branche : `worktree-agent-af043be7585c79b55` (issue de `feat/v2-phase-0`, rien n'est poussé). `pnpm-lock.yaml` n'est **pas** régénéré (voir §6).

## 1. Ce qui a été retiré

| Commit (ordre) | Contenu |
|---|---|
| 1. découplage du cœur (B1, B2, B3, B8) | route `GET /api/v1/owner/formations`, `owner-formations.service`, contrat `OwnerFormationsResponse`, hook `use-owner-formations`, page de redirection `/owner/formations` ; champ `activeFormateurs` (RH owner) ; menus RBAC `fpro.*` et périmètre de menus `formateur` (`admin-roles.schema`) ; `formateur` retiré des rôles attribuables par le propriétaire ; `tresorpay-gateway` importe ses types depuis `contracts/src/student-payments` (tsc API 443 → 433) |
| 2. LiveKit / notifications (B5, B6) | `live-sessions` : `parentType` réduit à `instance`, `resolvePublicRecipients`, `sessionProfessionnelleId` du DTO, `PUBLIC_FORMATION_PRO_URL` ; webhook LiveKit : préfixe d'identité `pu_` et branche `sessions_professionnelles` ; `notifications-dispatch` : `SubjectKind = "tenant_user"` |
| 3. portail public et infra | `apps/formation-pro-public` (92 fichiers), `Dockerfile.formation-pro-public`, `infra/nginx/formation-pro.conf`, `scripts/prepare-formation-public-db.mjs`, service compose `ecoledigitale-formation-pro`, construction de l'image dans `deploy.sh` (la ligne `prisma migrate deploy` n'est pas touchée), 3 entrées de matrice dans `ci.yml`, scripts racine `dev:formation-public` et `db:formation-public:*`, sections « formation-pro » de `infra/.env.example` et de `bootstrap-server.md` (vhost, OAuth Google, port 3012) |
| 4. API | 40 fichiers (routes formations-pro, sessions-pro, inscriptions-pro, codes-promo, paiements-pro, formateur, documents, entreprises, exports, reporting ; services associés ; adaptateurs de paiement Imhotep ; SMS Twilio ; Vimeo ; middleware `formateurAuth` ; jobs `document-automation` et `reservation-cleanup` ; `utils/table-names`), leurs enregistrements dans `index.ts` (dont le double enregistrement à la racine `/api/v1`), les contournements d'authentification `/formations-pro` et `GET /sessions-pro` (B4), le gabarit « programme PDF » de `pdf-generation.service` (il ne garde que `generatePdfFromHtml`, utilisé par l'espace owner) ; dépendances `twilio`, `axios`, `exceljs`, `pdfkit`, `@types/pdfkit` d'`apps/api` |
| 5. web | `app/formations-professionnelles/**`, `app/formateur/**`, proxys Next `app/api/v1/formations-pro/**`, composants `sessions-pro`, `inscriptions-pro`, `formations-pro`, `formateur`, `admin/{entreprises,exports,formateurs,documents,reporting}`, 15 hooks, `lib/pro-tenants`, un test orphelin, `ui/breadcrumb` ; édition de `Sidebar` (menus Formateur, Catalogue Formations, Administration Pro), `role-landing`, `fetch-interceptor`, `next.config` (rewrites) ; `@fullcalendar/list` |
| 5b. contrats | 10 dossiers/fichiers de `packages/contracts/src` (37 fichiers) et leurs ré-exports. Fait après le web (qui les importait encore), non avant comme dans l'inventaire |
| 6. scripts, config, docs | 14 scripts racine (`create-formations-*`, `create-sessions-pro`, `create-inscriptions-pro`, `apply-aspci-*`, `apply-price-precision-migration`, `migrate-*` Imhotep, `validate-imhotep-data-migration`, deux guides `IMHOTEP_DATA_*`) et leurs entrées `package.json` ; `ENV_EXAMPLE.md` (Orange, MTN, Wave, CinetPay, Twilio) ; `application-overview.md`, `menus-et-fonctionnalites-par-profil.md`, guide owner, `apps/web/docs/platform-web.md` |

Volume (de `99fb22c` au dernier commit de cette tâche, hors ce rapport) : 425 fichiers touchés, dont 390 supprimés ; environ 73 200 lignes supprimées pour 83 ajoutées.

## 2. Mesures

| Contrôle | Avant | Après |
|---|---|---|
| `tsc --noEmit` API (`tsconfig.json`) | 443 (433 après B8) | **344**, aucune erreur nouvelle (comparaison par fichier et code TS) |
| `tsc --noEmit` web | 596 | **412**, aucune erreur nouvelle |
| `tsc` `packages/contracts`, `apps/api/tsconfig.v2.json` | propres | propres |
| Jest API | 27 suites vertes, 8 en échec (271 tests verts, 4 en échec) | identique |
| Vitest web | 12 fichiers, 158 tests | identique |
| `check:boundaries`, `check:secrets` | verts | verts |
| `docker compose config` (variables factices) | — | services `postgres, redis, ecoledigitale-api, ecoledigitale-web, minio` ; `bash -n deploy.sh` OK |

Résidus (`node scripts/inventory/imhotep-residue.mjs`) : `api-prefixes` 0, `public-user` 0, `sms` 0, `infra` 0. Restent : `web-paths` 3 (faux positifs : le module RSO a son propre rôle « formateur »), `role-formateur` 7 (voir §3), `tables` 4 (inférence d'authentification et deux commentaires), `tenant` 201 (B12, hors périmètre).

Les 8 suites Jest en échec le sont déjà avant : `@jest/globals` introuvable (`owner-routes`, `require-owner`, `owner-api-surface`, `owner-prospection-canaux`, `api-endpoints`, `upload-management*`) ou environnement (`file-serving`). Les tests propriétaire n'ont donc pas pu être exécutés ici ; leur couverture a été remplacée par le type-check et la lecture. `pnpm --filter @ecoledigitale/api test:v2` : 8 fichiers échouent sur la résolution du sous-chemin `@ecoledigitale/contracts/v2`, sans lien avec ces suppressions (non revérifié sur la base d'origine).

## 3. Ce qui reste volontairement

- **Prisma** : `schema.prisma`, `prisma/migrations`, scripts `prisma:*`, `@prisma/client` et l'étape `prisma migrate deploy` de `deploy.sh` ne sont pas touchés. Retirer les modèles Imhotep du schéma n'a aucun effet sur `migrate deploy`, mais le prochain `prisma migrate dev` d'un développeur générerait des `DROP TABLE` ; le schéma reste donc tel quel jusqu'au reset (Phase 2). Les modèles concernés : `FormationProfessionnelle`, `SessionProfessionnelle`, `Formateur`, `SessionFormateur`, `PublicUser`, `Account`, `UserSession`, `VerificationToken`, `InscriptionPublic`, `SupportCours`, `SupportSessionAssociation`.
- **Rôle `formateur`** : la ligne `roles` reste en base. `user-auth.service.ts` garde l'inférence (`SELECT 1 FROM formateurs`, entourée d'un `try/catch`, sans effet une fois la table supprimée) ; le mapping v2 `rbac/domain/legacy.ts` (`formateur` → `enseignant`) est conservé. Le Professional et la paie ne dépendent pas de ce rôle (vérifié : ils travaillent sur `teachers`). Il n'a plus de menu ni de page d'atterrissage (retombe sur `/tableau-de-bord`) et n'est plus attribuable par le propriétaire. Les lignes `admin_role_menus` / `role_menu_denials` portant des clés `fpro.*` ou `formateur.*` restent en base, sans effet (ignorées, le périmètre `formateur` n'existe plus).
- **LiveKit scolaire et ECUE**, `live_sessions` et ses trois tables, `livekit.service`, `professional-live-sessions.service`, `app/live/[id]`.
- **Notifications** : `app_notifications`, `app_email_delivery_log`, dispatcher, cloche, WhatsApp.
- **Prospection / commissions (0125)**, Professional, rémunération (031), RSO, `registration_requests`, `email.service`, `tresorpay-gateway` (frais de scolarité ; variables `TRESORPAY_*` conservées dans `ENV_EXAMPLE.md`), enum `delivery_mode`, `update_updated_at_column()`, `student_attendance.marked_via`.
- **Dépendances** : `axios` racine (utilisé par `scripts/db-audit.js`) ; `exceljs` d'`apps/web` n'est plus importé nulle part (candidat au retrait, avec le contournement de `next.config.js` et `turbopack-stubs/empty.js`, à décider avec le futur export Excel du plan §3.13). `GOOGLE_CLIENT_ID/SECRET` restent dans `infra/.env.example` : `apps/web/src/lib/auth-options.ts` les lit encore.
- **B12 / B13** (tenant `imhotepacademy` codé en dur, marque « Imhotep Academy / IPAM » dans les gabarits) : hors suppression stricte, à traiter avant le reset (nouveaux UUID de tenant) ; inchangés. Documents d'inventaire, outils `scripts/inventory/*` et `specs/` conservés comme historique.
- Aucun blocage de dépendance non répertoriée n'a été rencontré ; aucune étape n'a été abandonnée.

## 4. À supprimer au reset de la Phase 2 (base)

À faire par migration de suppression avec liste blanche, sur une copie d'abord (ordre de l'inventaire §6, étape 7) :

- Tables (22) : `documents`, `export_jobs`, `support_telechargements`, `support_session_associations`, `supports_cours`, `session_attendance`, `formateur_indisponibilites`, `notifications_formateurs`, `session_formateurs`, `paiements_professionnels`, `reservations_temporaires`, `inscriptions_public`, `accounts`, `user_sessions`, `verification_tokens`, `inscriptions_professionnelles`, `public_users`, `sessions_professionnelles`, `formateurs`, `entreprises_clientes`, `codes_promo`, `formations_professionnelles` ; puis les 17 tables `*_aspci` du baseline Prisma si elles existent.
- Fonctions `generate_session_code`, `set_session_code`, `generate_enrollment_number`, `set_enrollment_number`, `generate_invoice_number`, `update_session_capacity_on_enrollment_change` et leurs triggers ; enums `session_professional_status`, `enrollment_type`, `enrollment_professional_status`, `promo_code_reduction_type`, `payment_method`, `payment_professional_status`, `document_type`, `export_type`, `job_status`.
- `live_sessions.session_professionnelle_id` (colonne, index, CHECK `live_sessions_exactly_one_parent` à recréer à deux parents) ; supprimer les lignes `public_user` de `app_notifications`, `app_email_delivery_log`, `live_session_attendances` avant de resserrer les CHECK `subject_kind`.
- RBAC : lignes `admin_role_menus` / `role_menu_denials` à clés `fpro.%` et `formateur.%` ; ligne `roles` = `formateur` et `user_roles` associés (après confirmation).
- À ne pas supprimer : `delivery_mode`, `update_updated_at_column()`, `live_sessions` et `live_session_*`, `app_*`, `student_attendance.marked_via`, `payment_method_type`.
- Compter les données avant destruction (D8 est une hypothèse) : `formations_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `public_users`, `inscriptions_public`, `formateurs`, `live_sessions WHERE session_professionnelle_id IS NOT NULL`, sur chaque tenant.

## 5. Actions manuelles pour le propriétaire (serveur et services externes)

Le déploiement automatique ne supprime rien de tout cela :

1. **Conteneur orphelin** : `docker compose up -d` ne retire pas `ecoledigitale-formation-pro` (qui garde le port hôte 3012). Sur le serveur : `docker rm -f ecoledigitale-formation-pro` puis `docker rmi ecoledigitale-formation-pro:latest` (ou `up -d --remove-orphans`).
2. **nginx** : retirer `/etc/nginx/sites-enabled/formation-pro` et `/etc/nginx/sites-available/formation-pro` (installés à la main), puis `nginx -t && systemctl reload nginx`.
3. **Certificat et DNS** : `certbot delete --cert-name formation-pro.allianceconsultants.net` ; supprimer l'enregistrement DNS `formation-pro.allianceconsultants.net`.
4. **Fichier d'environnement du serveur** (`/home/deployer/ecoledigitale.env`) : retirer `NEXT_PUBLIC_APP_URL`, `PUBLIC_FORMATION_TENANT_ID`, `FORMATION_PUBLIC_ADMIN_EMAILS`, `PUBLIC_FORMATION_PRO_URL`, `LEAD_NOTIFY_TO`, `PAYHUBSECURE_*`, `RESEND_*`, `TWILIO_*`, `VIMEO_*`, `ORANGE_MONEY_*`, `MTN_MONEY_*`, `WAVE_*`, `CINETPAY_*`. Conserver `TRESORPAY_*`, `SMTP_*`, `LIVEKIT_*`. Faire tourner les secrets qui auraient été exposés (plan 0.4).
5. **Comptes externes** : client OAuth Google du portail (vérifier d'abord que la connexion Google de `apps/web` n'utilise pas le même client avant de le désactiver), PayHubSecure, Resend, Twilio, Vimeo, et les comptes Orange Money / MTN MoMo / Wave / CinetPay s'ils n'ont plus d'usage.
6. **Stockage objet** : supports de cours et vidéos des formations (conserver les enregistrements LiveKit tant que la visio existe).
7. **GitHub** : retirer des protections de branche tout statut requis nommé `typecheck (formation-pro-public)`, `lint (formation-pro-public)` ou `build (formation-pro-public)`.

## 6. Pour le lead

- **Régénérer `pnpm-lock.yaml`** (`pnpm install`) avant de fusionner : `Dockerfile.api` / `Dockerfile.web` installent avec `--frozen-lockfile`. Changements de dépendances : workspace `@ecoledigitale/formation-pro-public` supprimé ; `apps/api` perd `twilio`, `axios`, `exceljs`, `pdfkit`, `@types/pdfkit` ; `apps/web` perd `@fullcalendar/list`.
- Mesure de référence API : 443 erreurs `tsc` à la base de cette branche (433 après la correction de l'import TresorPay, B8) ; la contrainte « ≤ 433 » est respectée (344).
- Le commentaire de `ci.yml` (« TODO dette ») cite maintenant 344 erreurs pour `tsconfig.json` ; le chiffre « 415 avec tsconfig.build.json » n'a pas été remesuré.
