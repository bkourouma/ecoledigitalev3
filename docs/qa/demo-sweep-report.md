# Balayage QA de la démonstration locale : rapport

Généré le 2026-10-03 07:27 UTC par `scripts/qa/report.mjs` à partir de `scripts/qa/demo-sweep.mjs` (pile `pnpm demo:up`, web `next dev`, lecture seule). Bruts : `.demo/qa/` (non versionné).

## Résumé

- Comptes balayés : **38** sur 38 (demo-primaire, demo-secondaire, demo-superieur, platform).
- Pages visitées (page x rôle) : **1236**, dont **254** routes distinctes de l'arborescence `app/v2` sur 295.
- Constats distincts (regroupés par type, route et message ; les défauts d'API systémiques sont regroupés par appel) : **2 bloquant(s)**, **22 majeur(s)**, **42 mineur(s)** ; 89 états vides à confronter aux données de démo.
- Corrigés dans la branche : **14** (marqués ✔ ci-dessous).

Gravités : **bloquant** = page inutilisable (5xx, écran d'erreur ou blanc, exception, lien de menu mort, boucle) ; **majeur** = fonction cassée ou donnée fausse (appel API rejeté sur une page atteignable par l'interface, clé i18n brute, `undefined`, lien menant à un refus, libellé incohérent) ; **mineur** = cosmétique, refus 403/404 attendu sur une page hors menu (route de l'arborescence sans lien depuis l'interface), bruit console.

## Synthèse et priorités

Lecture rapide : ce qui bloque un testeur, ce qui a été corrigé dans cette branche, ce qui demande une décision. Le détail de chaque constat (preuve, rôles, cause, fichier) suit.

### Corrigé dans la branche (tests Vitest ajoutés)

1. **33 liens de menu morts dans la coquille d'administration** (propriétaire et directeur, `/v2/settings`, `/v2/access/*`, `/v2/audit`) : les entrées du portail `admin` des manifestes pointaient vers `/admin/eleves`, `/admin/academique/*`, `/admin/bulletins/*`, `/admin/higher/*`… sans page (404), et `Utilisateurs` ouvrait une page blanche. `apps/web/src/platform/admin/menu.ts` les réécrit vers les écrans `/v2` ; test statique `apps/web/src/platform/v2/menu-manifests.test.ts` (liste des écarts connus) et `scripts/qa/check-menu-hrefs.mjs`. **Il reste 4 entrées sans écran v2** : `attendance.settings`, `people.settings`, `scheduling.calendar`, `scheduling.validation`.
2. **Parcours d'admission : toutes les routes répondaient 404 `admissions.institution_unknown`** pour tout établissement (pages Candidatures, Campagnes, Prospects, Rapports, Liste d'attente, Paramètres vides ou en erreur pour le chargé d'admissions) : `apps/api/src/platform/adapters/admissions-academic.ts` filtrait les établissements sur le statut `active` au lieu de `ACTIVE`. Test `apps/api/test/adapters/admissions-catalog.unit.test.ts`. **À reconfirmer après redémarrage de l'API de démonstration depuis cette branche** (la démo en cours exécute l'ancien code).
3. **Liens vers des pages interdites** (le clic menait à `/unauthorized`) : fiche élève (classe, tuteur), fiche classe (affectations), dossier de candidature (fiche élève, inscription). Nouveau composant `GuardedLink` (`apps/web/src/platform/ui/AccessGate.tsx`) : texte simple sans la permission de la page cible.
4. **Page `/unauthorized` illisible en thème sombre** (texte gris foncé sur fond sombre) : jetons de thème.
5. **Coque de navigation sur tous les écrans de module** (P1) : `<AppShell>` (`apps/web/src/platform/shell/AppShell.tsx`) est posé par le `layout.tsx` de premier niveau de chaque module `/v2` et choisit la coque d'après le **rôle actif de la session** (jamais l'URL) : coque de gestion (`TenantAdminShell` étendu : nom de l'établissement, menu `/rbac/me/navigation` portails admin + owner groupé par module, changement de module, fil d'Ariane, compte avec changement de rôle et d'établissement, déconnexion) pour la direction, l'économat, le secrétariat, les études, les examens, les admissions et l'éducateur ; `PortalShell` pour parent, élève, enseignant et instituteur (écrans partagés `/v2/finance/me/*`, `/v2/examinations/family`, `/v2/councils/famille`, `/v2/primary/mon-enfant`, `/v2/schoollife/*`, `/v2/stateassign/family` compris). Les 4 entrées sans écran v2 (`attendance.settings`, `people.settings`, `scheduling.calendar`, `scheduling.validation`) sont masquées du menu. Test statique `apps/web/src/app/v2/shell-coverage.test.ts` ; le balayage (`scripts/qa/analyze.mjs`) contrôle déconnexion et navigation globale sur tout écran `/v2`. **À reconfirmer sur la démonstration après redémarrage du web.** Nom de l'établissement et menus conditionnés par une fonctionnalité : lecture sur `GET /tenancy/branding` et `GET /entitlements/me/features` (repli sur `/tenancy/profile` et `/entitlements/me`), points d'API ajoutés par ailleurs.
6. **Atterrissage du propriétaire** (P2) : `/v2/direction` (tableau de bord) ; `/v2/owner` y redirige, l'écran technique « Fraîcheur des données » est `/v2/owner/fraicheur` ; les rôles sans atterrissage propre ouvrent l'accueil de gestion `/v2/home` (raccourcis par module selon les droits).
7. **Erreur d'hydratation `FormField`** (P2) : identifiant dérivé du libellé (déterministe, sans `useId`), suffixé après montage seulement si deux champs ont le même libellé (test `FormField.test.tsx`).
8. **Appel journalier proposé là où la politique l'interdit** (P3) : « Faire l'appel » et « Mes classes » masquent le type d'appel que la politique du cycle refuse (niveau de la classe ajouté à `GET /people/me/classes`, politique d'appel lisible avec `attendance.take`). L'ouverture de la séance dès l'affichage de l'écran d'appel n'est pas modifiée.
9. **Entrée de manifeste `admissions.workflow`** (P3) : `href` corrigé à la source (`/v2/admissions/settings/workflow`).

### À décider ou à traiter (non corrigé : changement de conception, de permission ou cause non établie)

| Priorité | Constat | Piste |
|---|---|---|
| **P1 majeur** | **`GET /api/v1/tenancy/profile` (403 `tenancy.institution.read`) et `GET /api/v1/entitlements/me` (403 `entitlements.read`) sur chaque page** pour tous les rôles autres que propriétaire et directeur (une requête en échec par page, plus de 150 pages). Effets visibles : nom de l'établissement et thème de marque absents (« EcoleDigitale » partout, `PortalShell`), et **entrées de menu conditionnées par une fonctionnalité masquées par repli « échec fermé »** (`buildPortalMenu` : parent primaire, vie scolaire, conseils, affectés de l'État, examens ; enseignant vie scolaire, conseils, congés). Constat : le menu rendu du parent n'a que 5 liens, celui de l'enseignant 10. | Point d'API lisible par tout membre authentifié (marque minimale, liste des fonctionnalités actives) ou attribution de ces permissions aux modèles de rôle : décision de sécurité, non traitée ici. |
| **P2 majeur** | L'API répond **401** quand le compte n'a pas de profil lié (`/people/me/student`, `/attendance/me/attendance`, `/higher/me/documents`) : 403/404 attendu, le 401 peut déclencher la déconnexion par l'intercepteur. | `apps/api` : code d'erreur des routes `/me/*`. |
| **P3** | Appels web au-delà des droits du rôle : `GET /academic/years` (éducateur, enseignant : filtres de `/v2/attendance*`, `/v2/students`), `GET /academic/classrooms` (enseignant : `/v2/assessments`), `GET /tenancy/institutions` (économe, secrétariat, enseignant : paramètres, annonces), `GET /academic/classrooms/:id/offerings` (403 « fonctionnalité non incluse » : feuille de notes du responsable pédagogique), `GET /people/classrooms/:id/assignments` (secrétariat). | Désactiver la requête sans la permission (attention à l'état « chargement » éternel d'une requête désactivée). |
| **P3** | `/unauthorized` s'affiche dans la coquille de l'ancienne application (menu vide, « Settings / Logout » en anglais, appels `GET /api/v1/notifications-inbox` et `/api/v1/admin/access/me/menus` en 404). | Page de refus v2 sans coquille historique. |
| **P3** | Des 5xx isolés observés lors d'un premier passage (`/v2/academic/offerings`, `/v2/access`, `/v2/account/notifications` : « `useTranslations` … contexte `NextIntlClientProvider` introuvable », « module factory is not available ») ne se reproduisent pas : recompilation de `next dev` sous charge, pas d'anomalie du code. | Aucune. |

### Données de démonstration : états vides à vérifier

Aucun « Non inscrit » incohérent n'a été relevé (parent et élève des 3 établissements : élève inscrit, classe, moyenne et séances affichés). Pages vides à confronter à la graine : sessions d'examen (primaire et supérieur), centres et types d'examen (3 établissements), plans d'échéancier, remises et sessions de caisse (économe), paie (périodes, bulletins), salles, règles d'alerte de présence, comptes liés aux fiches élève et personnel (« Aucun compte »). La liste complète est en fin de rapport. Les candidatures et campagnes d'admission paraissent vides à cause du défaut n°2 ci-dessus, pas de la graine.

### Limites de ce passage

Pile en `next dev` sous charge partagée : durées de 5 à 150 s par page. Les routes sans lien depuis l'interface (propriétaire : arborescence statique) sont marquées « hors menu » : un 403 ou 404 y est attendu (modules hors offre, profils élève ou personnel absents) et classé mineur. Les écrans d'appel (`/attendance/call/<type>/<id>`) n'ont pas été ouverts : ils ouvrent une séance (écriture). La console de la plateforme n'a qu'un jeu de 7 pages.

## Couverture par rôle

| Établissement | Rôle | Atterrissage | Pages | Menu (liens) | Bloquant | Majeur | Mineur |
|---|---|---|---:|---:|---:|---:|---:|
| primaire | admissions_officer | `/v2/admissions` | 13 | 7 | 0 | 39 | 0 |
| primaire | directeur | `/v2/direction` | 14 | 13 | 0 | 0 | 0 |
| primaire | directeur_etudes | `/v2/academic` | 19 | 6 | 0 | 23 | 1 |
| primaire | econome | `/v2/finance` | 22 | 11 | 0 | 27 | 0 |
| primaire | educateur | `/v2/attendance` | 11 | 9 | 0 | 17 | 0 |
| primaire | eleve | `/v2/student` | 18 | 12 | 0 | 29 | 0 |
| primaire | instituteur | `/v2/primary` | 7 | 6 | 0 | 11 | 1 |
| primaire | instituteur_maternelle | `/v2/primary` | 7 | 6 | 0 | 11 | 1 |
| primaire | parent | `/v2/parent` | 31 | 5 | 0 | 53 | 0 |
| primaire | proprietaire | `/v2/owner` | 217 | 13 | 0 | 1 | 69 |
| primaire | responsable_examens | `/v2/examinations` | 11 | 11 | 0 | 12 | 0 |
| primaire | responsable_pedagogique | `/v2/assessments` | 6 | 2 | 0 | 10 | 0 |
| primaire | secretariat | `/v2/students` | 20 | 3 | 0 | 33 | 0 |
| secondaire | admissions_officer | `/v2/admissions` | 13 | 7 | 0 | 39 | 0 |
| secondaire | directeur | `/v2/direction` | 14 | 13 | 0 | 0 | 0 |
| secondaire | directeur_etudes | `/v2/academic` | 18 | 6 | 0 | 24 | 1 |
| secondaire | econome | `/v2/finance` | 22 | 11 | 0 | 27 | 0 |
| secondaire | educateur | `/v2/attendance` | 13 | 9 | 0 | 21 | 0 |
| secondaire | eleve | `/v2/student` | 18 | 12 | 0 | 29 | 0 |
| secondaire | enseignant | `/v2/teacher` | 35 | 10 | 0 | 63 | 0 |
| secondaire | parent | `/v2/parent` | 31 | 5 | 0 | 53 | 0 |
| secondaire | proprietaire | `/v2/owner` | 217 | 13 | 0 | 6 | 50 |
| secondaire | responsable_examens | `/v2/examinations` | 13 | 11 | 0 | 14 | 0 |
| secondaire | responsable_pedagogique | `/v2/assessments` | 6 | 2 | 0 | 10 | 0 |
| secondaire | secretariat | `/v2/students` | 19 | 3 | 0 | 29 | 0 |
| superieur | admissions_officer | `/v2/admissions` | 13 | 7 | 0 | 39 | 0 |
| superieur | directeur | `/v2/direction` | 14 | 13 | 0 | 0 | 0 |
| superieur | directeur_etudes | `/v2/academic` | 18 | 6 | 0 | 21 | 1 |
| superieur | econome | `/v2/finance` | 22 | 11 | 0 | 27 | 0 |
| superieur | educateur | `/v2/attendance` | 11 | 9 | 0 | 17 | 0 |
| superieur | eleve | `/v2/student` | 18 | 12 | 0 | 29 | 0 |
| superieur | enseignant | `/v2/teacher` | 34 | 10 | 0 | 62 | 0 |
| superieur | parent | `/v2/parent` | 31 | 5 | 0 | 53 | 0 |
| superieur | proprietaire | `/v2/owner` | 217 | 13 | 0 | 5 | 71 |
| superieur | responsable_examens | `/v2/examinations` | 11 | 11 | 0 | 12 | 0 |
| superieur | responsable_pedagogique | `/v2/assessments` | 6 | 2 | 0 | 6 | 0 |
| superieur | secretariat | `/v2/students` | 19 | 3 | 0 | 29 | 0 |
| platform | operateur | `/v2/platform/tenants` | 7 | 4 | 0 | 1 | 0 |

## Bloquant (2)

### B1. ✔ Lien de menu mort (404)

- **Pages concernées** : 33 route(s), 33 URL : `/admin/academique/annees`, `/admin/academique/classes`, `/admin/academique/curriculum`, `/admin/academique/inscriptions`, `/admin/academique/parametres`, `/admin/academique/programmes`, `/admin/academique/reconduction`, `/admin/affectations`, `/admin/attendance/parametres`, `/admin/bulletins`, `/admin/bulletins/emission`, `/admin/bulletins/identite`, `/admin/bulletins/modeles`, `/admin/deliberations`, `/admin/eleves`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`, `/admin/notes/corrections`, `/admin/notes/relecture`, `/admin/notes/types`, `/admin/parents`, `/admin/periodes`, `/admin/personnel`, `/admin/personnes/parametres`, `/admin/regles`, `/admin/resultats`, `/v2/admissions/workflow`, `/admin/academique/offres`, `/admin/higher/diplomes`, `/admin/higher/documents`, `/admin/higher/prerequis`, `/admin/higher/rattrapages`, `/admin/higher/signataires`
- **Rôles** : primaire/directeur, primaire/proprietaire, secondaire/directeur, secondaire/proprietaire, superieur/directeur, superieur/proprietaire
- **Type** : `http-404` (passe menus)
- **Preuve** : `404 404`
- **Capture** : `.demo/qa/shots/demo_primaire_directeur-_admin_academique_annees.png`
- **Cause probable** : Route absente de l'arborescence `app/v2` ou lien de menu mal forme (entree historique `/admin/...` non reecrite par `mapToV2Href`).
- **Correction** : `apps/web/src/platform/admin/menu.ts` : 29 des 33 entrées historiques du portail admin sont réécrites vers les écrans /v2 (test statique `menu-manifests.test.ts`). Restent sans écran v2 : `/admin/attendance/parametres`, `/admin/personnes/parametres`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`. À reconfirmer après redémarrage du web depuis cette branche.

### B2. ✔ Ecran blanc (aucun texte rendu)

- **Route** : `/admin/utilisateurs`
- **Rôles** : secondaire/proprietaire
- **Type** : `blank-page` (passe menus)
- **Capture** : `.demo/qa/shots/demo_secondaire_proprietaire-_admin_utilisateurs.png`
- **Cause probable** : Rendu vide : composant client qui ne s'affiche pas faute de donnees ou de permission, sans etat vide/erreur.
- **Correction** : `Utilisateurs` réécrit vers l'écran v2 `/v2/admin/members` (`menu.ts`).

## Majeur (22)

### M1. Appel refuse (403) depuis une page du menu : GET /api/v1/tenancy/profile -> 403

- **Pages concernées** : 128 route(s), 269 URL : `/v2/admissions`, `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/campaigns`, `/v2/admissions/prospects`, `/v2/admissions/reports`, `/v2/admissions/waitlist`, `/v2/admissions/applications/[id]`, `/v2/enrollments/[id]`, `/v2/students/[id]`, `/v2/academic`, `/v2/academic/classrooms`, `/v2/academic/curriculum`, `/v2/academic/offerings`, `/v2/academic/programs`, `/v2/academic/settings`, `/v2/academic/years`, `/v2/academic/classrooms/[id]`, `/v2/staff/[id]`, `/v2/staff/assignments`, `/v2/staff`, `/v2/guardians`, `/v2/guardians/[id]`, `/v2/students`, `/v2/finance`, `/v2/finance/cash`, `/v2/finance/fees`, `/v2/finance/funding`, `/v2/finance/invoices`, `/v2/finance/payments`, `/v2/finance/payments/pending`, `/v2/finance/receipts`, `/v2/finance/refunds`, `/v2/finance/reports`, `/v2/finance/webhooks`, `/v2/finance/invoices/new`, `/v2/finance/payments/new`, `/v2/finance/fees/discounts`, `/v2/finance/fees/plans`, `/v2/finance/fees/schedules` …
- **Rôles** : primaire/admissions_officer, primaire/directeur_etudes, primaire/econome, primaire/educateur, primaire/eleve, primaire/instituteur, primaire/instituteur_maternelle, primaire/parent … (31)
- **Type** : `api-403` (passe menus)
- **Preuve** : `GET /api/v1/tenancy/profile -> 403 {"status":403,"code":"FORBIDDEN","kind":"forbidden","message":"Action non autorisée.","details":{"permission":"tenancy.institution.read"},"requestId":"01a0ffd6-5b92-7149-88c7-a3883d6faae0"}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_admissions.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/platform/theme/theme.ts`, `apps/web/src/platform/shell/branding.ts`, `apps/web/src/platform/admin/tenancy/hooks.ts`

### M2. Appel refuse (403) depuis une page du menu : GET /api/v1/entitlements/me -> 403

- **Pages concernées** : 50 route(s), 128 URL : `/v2/admissions/applications/[id]`, `/v2/academic/offerings`, `/v2/finance/payments`, `/v2/finance/fees/plans`, `/v2/finance/invoices/[id]`, `/v2/attendance/conflicts`, `/v2/attendance/staff/me`, `/v2/student`, `/v2/student/attendance`, `/v2/student/documents`, `/v2/student/finance`, `/v2/student/profile`, `/v2/student/reportcards`, `/v2/student/results`, `/v2/student/schedule`, `/v2/student/upcoming`, `/v2/student/finance/receipts/[id]`, `/v2/primary/archives`, `/v2/primary/bilans`, `/v2/primary/competences`, `/v2/primary/conseil`, `/v2/parent`, `/v2/parent/account`, `/v2/parent/children/[childId]`, `/v2/parent/children/[childId]/attendance`, `/v2/parent/children/[childId]/finance`, `/v2/parent/children/[childId]/results`, `/v2/parent/children/[childId]/schedule`, `/v2/parent/children/[childId]/documents`, `/v2/parent/children/[childId]/emergency`, `/v2/parent/children/[childId]/reportcards`, `/v2/parent/children/[childId]/upcoming`, `/v2/parent/children/[childId]/finance/receipts/[id]`, `/v2/enrollments/new`, `/v2/enrollments/[id]`, `/v2/attendance/call/[kind]/[id]`, `/v2/teacher`, `/v2/teacher/assessments`, `/v2/teacher/attendance`, `/v2/teacher/classes` …
- **Rôles** : primaire/admissions_officer, primaire/directeur_etudes, primaire/econome, primaire/educateur, primaire/eleve, primaire/instituteur, primaire/instituteur_maternelle, primaire/parent … (25)
- **Type** : `api-403` (passe menus)
- **Preuve** : `GET /api/v1/entitlements/me -> 403 {"status":403,"code":"FORBIDDEN","kind":"forbidden","message":"Action non autorisée.","details":{"permission":"entitlements.read"},"requestId":"01a0ffd7-2376-751f-bdaa-63bd3b94486d"}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_admissions_applications_01a0fefd_cb44_74a6_b33e_bf545dd734d4.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/platform/access/hooks.ts`, `apps/web/src/platform/access/types.ts`, `apps/web/src/platform/admin/FeatureGate.tsx`

### M3. ✔ Ressource ou route API introuvable : GET /api/v1/notifications-inbox/unread-count -> 404

- **Pages concernées** : 42 route(s), 54 URL : `/v2/enrollments/[id]`, `/v2/students/[id]`, `/v2/staff/assignments`, `/v2/enrollments`, `/v2/academic/classrooms/[id]`, `/v2/guardians/[id]`, `/v2/students`, `/v2/settings`, `/admin/academique/annees`, `/admin/academique/classes`, `/admin/academique/curriculum`, `/admin/academique/inscriptions`, `/admin/academique/parametres`, `/admin/academique/programmes`, `/admin/academique/reconduction`, `/admin/affectations`, `/admin/attendance/parametres`, `/admin/bulletins`, `/admin/bulletins/emission`, `/admin/bulletins/identite`, `/admin/bulletins/modeles`, `/admin/deliberations`, `/admin/eleves`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`, `/admin/notes/corrections`, `/admin/notes/relecture`, `/admin/notes/types`, `/admin/parents`, `/admin/periodes`, `/admin/personnel`, `/admin/personnes/parametres`, `/admin/regles`, `/admin/resultats`, `/admin/utilisateurs`, `/v2/access/assignments`, `/admin/academique/offres`, `/admin/higher/diplomes`, `/admin/higher/documents`, `/admin/higher/prerequis` …
- **Rôles** : primaire/admissions_officer, primaire/secretariat, secondaire/admissions_officer, secondaire/enseignant, secondaire/secretariat, superieur/admissions_officer, superieur/enseignant, superieur/secretariat … (37)
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/notifications-inbox/unread-count -> 404 {"message":"Route GET:/api/v1/notifications-inbox/unread-count not found","error":"Not Found","statusCode":404}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_enrollments_01a0fefd_cebc_717c_863c_77eee6def720.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/components/notifications/NotificationBellWidget.tsx`
- **Correction** : appels de la page historique `/unauthorized` (cloche de notifications de l'ancienne coquille) : n'apparaissent plus quand les liens vers des pages interdites sont masqués ; la page `/unauthorized` garde la coquille historique (voir priorité P3).

### M4. ✔ Ressource ou route API introuvable : GET /api/v1/notifications-inbox?limit=20 -> 404

- **Pages concernées** : 42 route(s), 54 URL : `/v2/enrollments/[id]`, `/v2/students/[id]`, `/v2/staff/assignments`, `/v2/enrollments`, `/v2/academic/classrooms/[id]`, `/v2/guardians/[id]`, `/v2/students`, `/v2/settings`, `/admin/academique/annees`, `/admin/academique/classes`, `/admin/academique/curriculum`, `/admin/academique/inscriptions`, `/admin/academique/parametres`, `/admin/academique/programmes`, `/admin/academique/reconduction`, `/admin/affectations`, `/admin/attendance/parametres`, `/admin/bulletins`, `/admin/bulletins/emission`, `/admin/bulletins/identite`, `/admin/bulletins/modeles`, `/admin/deliberations`, `/admin/eleves`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`, `/admin/notes/corrections`, `/admin/notes/relecture`, `/admin/notes/types`, `/admin/parents`, `/admin/periodes`, `/admin/personnel`, `/admin/personnes/parametres`, `/admin/regles`, `/admin/resultats`, `/admin/utilisateurs`, `/v2/access/assignments`, `/admin/academique/offres`, `/admin/higher/diplomes`, `/admin/higher/documents`, `/admin/higher/prerequis` …
- **Rôles** : primaire/admissions_officer, primaire/secretariat, secondaire/admissions_officer, secondaire/enseignant, secondaire/secretariat, superieur/admissions_officer, superieur/enseignant, superieur/secretariat … (37)
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/notifications-inbox?limit=20 -> 404 {"message":"Route GET:/api/v1/notifications-inbox?limit=20 not found","error":"Not Found","statusCode":404}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_enrollments_01a0fefd_cebc_717c_863c_77eee6def720.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/components/notifications/NotificationBellWidget.tsx`
- **Correction** : appels de la page historique `/unauthorized` (cloche de notifications de l'ancienne coquille) : n'apparaissent plus quand les liens vers des pages interdites sont masqués ; la page `/unauthorized` garde la coquille historique (voir priorité P3).

### M5. ✔ Ressource ou route API introuvable : GET /api/v1/admin/access/me/menus -> 404

- **Pages concernées** : 39 route(s), 51 URL : `/v2/enrollments/[id]`, `/v2/students/[id]`, `/v2/staff/assignments`, `/v2/academic/classrooms/[id]`, `/v2/guardians/[id]`, `/v2/settings`, `/admin/academique/annees`, `/admin/academique/classes`, `/admin/academique/curriculum`, `/admin/academique/inscriptions`, `/admin/academique/parametres`, `/admin/academique/programmes`, `/admin/academique/reconduction`, `/admin/affectations`, `/admin/attendance/parametres`, `/admin/bulletins`, `/admin/bulletins/emission`, `/admin/bulletins/identite`, `/admin/bulletins/modeles`, `/admin/deliberations`, `/admin/eleves`, `/admin/emploi-du-temps/calendrier`, `/admin/emploi-du-temps/validation`, `/admin/notes/corrections`, `/admin/notes/relecture`, `/admin/notes/types`, `/admin/parents`, `/admin/periodes`, `/admin/personnel`, `/admin/personnes/parametres`, `/admin/regles`, `/admin/resultats`, `/admin/utilisateurs`, `/admin/academique/offres`, `/admin/higher/diplomes`, `/admin/higher/documents`, `/admin/higher/prerequis`, `/admin/higher/rattrapages`, `/admin/higher/signataires`
- **Rôles** : primaire/admissions_officer, primaire/secretariat, secondaire/admissions_officer, secondaire/enseignant, secondaire/secretariat, superieur/admissions_officer, superieur/enseignant, superieur/secretariat … (37)
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admin/access/me/menus -> 404 {"message":"Route GET:/api/v1/admin/access/me/menus not found","error":"Not Found","statusCode":404}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_enrollments_01a0fefd_cebc_717c_863c_77eee6def720.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/app/v2/enrollments/[id]/page.tsx`
- **Correction** : appels de l'ancienne page `/admin/utilisateurs`, qui n'est plus liée (réécriture vers `/v2/admin/members`).

### M6. ✔ Entree de menu qui mene a un acces refuse (/unauthorized)

- **Pages concernées** : 6 route(s), 18 URL : `/v2/enrollments/:id`, `/v2/students/:id`, `/v2/staff/assignments`, `/v2/academic/classrooms/:id`, `/v2/guardians/:id`, `/v2/settings`
- **Rôles** : primaire/admissions_officer, primaire/secretariat, secondaire/admissions_officer, secondaire/enseignant, secondaire/secretariat, superieur/admissions_officer, superieur/enseignant, superieur/secretariat … (31)
- **Type** : `denied-redirect` (passe menus)
- **Preuve** : `/v2/enrollments/01a0fefd-cebc-717c-863c-77eee6def720 -> /unauthorized`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_enrollments_01a0fefd_cebc_717c_863c_77eee6def720.png`
- **Cause probable** : Garde `requirePermission` plus stricte que le lien qui y mene : le lien devrait etre masque sans la permission de la page cible.
- **Fichier suspect** : `apps/web/src/app/v2/enrollments/[id]/page.tsx`
- **Correction** : liens masqués sans la permission de la page cible (`GuardedLink` : fiche élève -> classe et tuteur, fiche classe -> affectations, candidature -> fiche élève et inscription) ; à reconfirmer après redémarrage du web.

### M7. Appel refuse (403) depuis une page du menu : GET /api/v1/tenancy/institutions -> 403

- **Pages concernées** : 5 route(s), 10 URL : `/v2/academic/settings`, `/v2/staff/:id`, `/v2/finance/fees/schedules`, `/v2/examinations`, `/v2/announcements/new`
- **Rôles** : primaire/directeur_etudes, primaire/econome, primaire/responsable_examens, primaire/secretariat, secondaire/directeur_etudes, secondaire/econome, secondaire/enseignant, secondaire/responsable_examens … (14)
- **Type** : `api-403` (passe menus)
- **Preuve** : `GET /api/v1/tenancy/institutions -> 403 {"status":403,"code":"FORBIDDEN","kind":"forbidden","message":"Action non autorisée.","details":{"permission":"tenancy.institution.read"},"requestId":"01a0ffcb-580d-7740-9603-6b07efdabaee"}`
- **Capture** : `.demo/qa/shots/demo_primaire_directeur_etudes-_v2_academic_settings.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/platform/v2/lookups.ts`, `apps/web/src/platform/admin/tenancy/hooks.ts`, `apps/web/src/app/v2/finance/_components/shared.tsx`

### M8. Appel refuse (403) depuis une page du menu : GET /api/v1/academic/years -> 403

- **Pages concernées** : 4 route(s), 9 URL : `/v2/attendance`, `/v2/attendance/absences`, `/v2/attendance/student/:id`, `/v2/students`
- **Rôles** : primaire/educateur, secondaire/educateur, secondaire/enseignant, superieur/educateur, superieur/enseignant
- **Type** : `api-403` (passe menus)
- **Preuve** : `GET /api/v1/academic/years -> 403 `
- **Capture** : `.demo/qa/shots/demo_primaire_educateur-_v2_attendance.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/platform/admin/menu.ts`, `apps/web/src/platform/v2/primary.ts`, `apps/web/src/platform/v2/academic.ts`

### M9. ✔ Ecran d'atterrissage sans coquille : ni deconnexion, ni menu global, ni nom d'etablissement

- **Pages concernées** : 9 route(s), 9 URL : `/v2/admissions`, `/v2/direction`, `/v2/academic`, `/v2/finance`, `/v2/attendance`, `/v2/owner`, `/v2/examinations`, `/v2/assessments`, `/v2/students`
- **Rôles** : superieur/admissions_officer, superieur/directeur, superieur/directeur_etudes, superieur/econome, superieur/educateur, superieur/proprietaire, superieur/responsable_examens, superieur/responsable_pedagogique … (9)
- **Type** : `no-shell` (passe menus)
- **Preuve** : `/v2/admissions : aucun bouton de deconnexion`
- **Capture** : `.demo/qa/shots/demo_superieur_admissions_officer-_v2_admissions.png`
- **Cause probable** : Le layout de premier niveau du module (`app/v2/<module>/layout.tsx`) ne pose pas `<AppShell>` (`platform/shell/AppShell.tsx` : nom de l'etablissement, menu global, modules, compte, deconnexion) ; le test statique `app/v2/shell-coverage.test.ts` le verifie.
- **Fichier suspect** : `apps/web/src/app/v2/admissions/page.tsx`
- **Correction** : `<AppShell>` posé par le layout de premier niveau de chaque module (`apps/web/src/platform/shell/AppShell.tsx`, choix selon le rôle de la session) ; test statique `apps/web/src/app/v2/shell-coverage.test.ts`. À reconfirmer après redémarrage du web.

### M10. Appel refuse (403) depuis une page du menu : GET /api/v1/academic/classrooms/:id/offerings -> 403

- **Pages concernées** : 2 route(s), 8 URL : `/v2/assessments/:id`, `/v2/assessments/:id/grades`
- **Rôles** : primaire/responsable_pedagogique, secondaire/responsable_pedagogique
- **Type** : `api-403`
- **Preuve** : `GET /api/v1/academic/classrooms/01a0fefd-752e-70b7-bee1-daaefe84580a/offerings -> 403 {"status":403,"code":"entitlements.feature_not_available","kind":"forbidden","message":"Cette fonctionnalité n'est pas incluse dans l'abonnement de votre établissement.","details":{"feature":"academic.a-la-carte","`
- **Capture** : `.demo/qa/shots/demo_primaire_responsable_pedagogique-_v2_assessments_01a0fefd_99d2_73f9_bbdd_b5defd47ce3f.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/app/v2/assessments/[id]/page.tsx`

### M11. ✔ Ressource ou route API introuvable : GET /api/v1/admissions/campaigns -> 404

- **Pages concernées** : 6 route(s), 6 URL : `/v2/admissions`, `/v2/admissions/applications`, `/v2/admissions/applications/new`, `/v2/admissions/campaigns`, `/v2/admissions/reports`, `/v2/admissions/waitlist`
- **Rôles** : primaire/admissions_officer, primaire/proprietaire, secondaire/admissions_officer, secondaire/proprietaire, superieur/admissions_officer, superieur/proprietaire, primaire/directeur, secondaire/directeur
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admissions/campaigns -> 404 `
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_admissions.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/platform/v2/admissions.ts`, `apps/web/src/app/v2/admissions/_components/PipelineScreen.tsx`, `apps/web/src/app/v2/admissions/_components/AdmissionsShell.tsx`
- **Correction** : `apps/api/src/platform/adapters/admissions-academic.ts` : le filtre de statut `active` (minuscules) ne correspondait à aucune ligne (`ACTIVE` en base) ; test `apps/api/test/adapters/admissions-catalog.unit.test.ts`. À reconfirmer après redémarrage de l'API de démonstration depuis cette branche.

### M12. ✔ Erreur JavaScript en console

- **Pages concernées** : 6 route(s), 6 URL : `/v2/academic/curriculum`, `/v2/attendance/absences`, `/v2/higher/credits`, `/v2/finance/cash`, `/v2/reportcards/issue`, `/v2/attendance/conflicts`
- **Rôles** : secondaire/directeur_etudes, secondaire/proprietaire, superieur/proprietaire, secondaire/educateur
- **Type** : `console-js` (passe menus)
- **Preuve** : `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used: - A server/client branch 'if (typeof window !== 'undefined')'. - Variable input such as 'Date.now()' or 'Math.random()' whi`
- **Capture** : `.demo/qa/shots/demo_secondaire_directeur_etudes-_v2_academic_curriculum.png`
- **Cause probable** : Erreur d'hydratation React : rendu serveur different du rendu client (date/heure, `typeof window`, attribut variable).
- **Fichier suspect** : `apps/web/src/app/v2/academic/curriculum/page.tsx`
- **Correction** : `FormField` : identifiant dérivé du libellé (plus de `useId`, source de la divergence serveur/client) ; test `FormField.test.tsx`. À reconfirmer après redémarrage du web.

### M13. Indicateur d'erreur Next.js (probleme signale en console)

- **Pages concernées** : 6 route(s), 6 URL : `/v2/academic/curriculum`, `/v2/attendance/absences`, `/v2/higher/credits`, `/v2/finance/cash`, `/v2/reportcards/issue`, `/v2/attendance/conflicts`
- **Rôles** : secondaire/directeur_etudes, secondaire/proprietaire, superieur/proprietaire, secondaire/educateur
- **Type** : `dev-toast` (passe menus)
- **Preuve** : `01 Issue`
- **Capture** : `.demo/qa/shots/demo_secondaire_directeur_etudes-_v2_academic_curriculum.png`
- **Cause probable** : Erreur capturee par Next (voir la console) : exception de composant ou erreur d'hydratation.
- **Fichier suspect** : `apps/web/src/app/v2/academic/curriculum/page.tsx`

### M14. Appel refuse (403) depuis une page du menu : GET /api/v1/people/classrooms/:id/assignments -> 403

- **Pages concernées** : 1 route(s), 4 URL : `/v2/academic/classrooms/:id`
- **Rôles** : primaire/secretariat, secondaire/secretariat, superieur/secretariat
- **Type** : `api-403`
- **Preuve** : `GET /api/v1/people/classrooms/01a0fefd-752e-70b7-bee1-daaefe84580a/assignments -> 403 {"status":403,"code":"FORBIDDEN","kind":"forbidden","message":"Action non autorisée.","details":{"permission":"teaching.read"},"requestId":"01a0ffce-17e9-7598-bdd5-d9cb8e82b929"}`
- **Capture** : `.demo/qa/shots/demo_primaire_secretariat-_v2_academic_classrooms_01a0fefd_752e_70b7_bee1_daaefe84580a.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/app/v2/academic/classrooms/[id]/page.tsx`

### M15. ✔ Ressource ou route API introuvable : GET /api/v1/admissions/settings -> 404

- **Pages concernées** : 2 route(s), 2 URL : `/v2/admissions/waitlist`, `/v2/admissions/settings`
- **Rôles** : primaire/admissions_officer, primaire/proprietaire, secondaire/admissions_officer, secondaire/proprietaire, superieur/admissions_officer, superieur/proprietaire
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admissions/settings -> 404 {"status":404,"code":"admissions.institution_unknown","kind":"not_found","message":"Établissement introuvable.","details":{"resource":"Établissement"},"requestId":"01a0ffd7-0d56-70fe-b3bc-9576d205ada0"}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_admissions_waitlist.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/platform/admin/menu.ts`, `apps/web/src/platform/v2/analytics.ts`, `apps/web/src/platform/v2/admissions.ts`
- **Correction** : `apps/api/src/platform/adapters/admissions-academic.ts` : le filtre de statut `active` (minuscules) ne correspondait à aucune ligne (`ACTIVE` en base) ; test `apps/api/test/adapters/admissions-catalog.unit.test.ts`. À reconfirmer après redémarrage de l'API de démonstration depuis cette branche.

### M16. ✔ Ressource ou route API introuvable : GET /api/v1/admin/access/roles -> 404

- **Pages concernées** : 2 route(s), 2 URL : `/admin/utilisateurs`, `/v2/access/assignments`
- **Rôles** : primaire/directeur, primaire/proprietaire, secondaire/directeur, secondaire/proprietaire, superieur/proprietaire
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admin/access/roles -> 404 {"message":"Route GET:/api/v1/admin/access/roles not found","error":"Not Found","statusCode":404}`
- **Capture** : `.demo/qa/shots/demo_primaire_directeur-_admin_utilisateurs.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/platform/admin/menu.ts`
- **Correction** : appels de l'ancienne page `/admin/utilisateurs`, qui n'est plus liée (réécriture vers `/v2/admin/members`).

### M17. ✔ Ressource ou route API introuvable : GET /api/v1/admin/access/users -> 404

- **Pages concernées** : 2 route(s), 2 URL : `/admin/utilisateurs`, `/v2/access/assignments`
- **Rôles** : primaire/directeur, primaire/proprietaire, secondaire/directeur, secondaire/proprietaire, superieur/proprietaire
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admin/access/users -> 404 {"message":"Route GET:/api/v1/admin/access/users not found","error":"Not Found","statusCode":404}`
- **Capture** : `.demo/qa/shots/demo_primaire_directeur-_admin_utilisateurs.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Correction** : appels de l'ancienne page `/admin/utilisateurs`, qui n'est plus liée (réécriture vers `/v2/admin/members`).

### M18. Requete rejetee : GET /api/v1/primary_school/settings -> 400

- **Pages concernées** : 1 route(s), 1 URL : `/v2/primary/parametres`
- **Rôles** : secondaire/proprietaire, superieur/proprietaire
- **Type** : `api-400`
- **Preuve** : `GET /api/v1/primary_school/settings -> 400 {"status":400,"code":"primary_school.institution_required","kind":"validation","message":"Précisez l'établissement (institutionId).","issues":[{"path":["institutionId"],"message":"Précisez l'établissement (institutionId).","code":"primary_school.institution`
- **Capture** : `.demo/qa/shots/demo_secondaire_proprietaire-_v2_primary_parametres.png`
- **Cause probable** : Requete mal formee : parametre que le contrat de l'API rejette (desalignement web <-> contrat Zod).
- **Fichier suspect** : `apps/web/src/platform/v2/primary.ts`

### M19. Appel non authentifie : GET /api/v1/higher/me/documents -> 401

- **Pages concernées** : 1 route(s), 1 URL : `/v2/higher/prerequisites`
- **Rôles** : primaire/proprietaire, secondaire/proprietaire
- **Type** : `api-401`
- **Preuve** : `GET /api/v1/higher/me/documents -> 401 `
- **Capture** : `.demo/qa/shots/demo_primaire_proprietaire-_v2_higher_prerequisites.png`
- **Cause probable** : Jeton absent ou expire sur l'appel (proxy web -> API, rafraichissement de session).
- **Fichier suspect** : `apps/web/src/platform/v2/higher-documents.ts`, `apps/web/src/app/v2/higher/_components/HigherNav.tsx`

### M20. Appel refuse (403) depuis une page du menu : GET /api/v1/academic/classrooms?pageSize=200 -> 403

- **Pages concernées** : 1 route(s), 1 URL : `/v2/assessments`
- **Rôles** : secondaire/enseignant, superieur/enseignant
- **Type** : `api-403`
- **Preuve** : `GET /api/v1/academic/classrooms?pageSize=200 -> 403 {"status":403,"code":"FORBIDDEN","kind":"forbidden","message":"Action non autorisée.","details":{"permission":"academic.classroom.read"},"requestId":"01a0ff8d-919e-7505-8fde-d2ce35805eac"}`
- **Capture** : `.demo/qa/shots/demo_secondaire_enseignant-_v2_assessments.png`
- **Cause probable** : Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).
- **Fichier suspect** : `apps/web/src/platform/admin/menu.ts`, `apps/web/src/platform/v2/academic.ts`, `apps/web/src/platform/v2/admissions.ts`

### M21. ✔ Ressource ou route API introuvable : GET /api/v1/admissions/prospects?page=1&pageSize=30 -> 404

- **Pages concernées** : 1 route(s), 1 URL : `/v2/admissions/prospects`
- **Rôles** : primaire/admissions_officer, primaire/proprietaire, secondaire/admissions_officer, secondaire/proprietaire, superieur/admissions_officer, superieur/proprietaire
- **Type** : `api-404` (passe menus)
- **Preuve** : `GET /api/v1/admissions/prospects?page=1&pageSize=30 -> 404 {"status":404,"code":"admissions.institution_unknown","kind":"not_found","message":"Établissement introuvable.","details":{"resource":"Établissement"},"requestId":"01a0ffd6-d38f-76f9-a638-4d88bdeb86ad"}`
- **Capture** : `.demo/qa/shots/demo_primaire_admissions_officer-_v2_admissions_prospects.png`
- **Cause probable** : Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).
- **Fichier suspect** : `apps/web/src/platform/v2/admissions.ts`, `apps/web/src/app/v2/admissions/_components/AdmissionsShell.tsx`
- **Correction** : `apps/api/src/platform/adapters/admissions-academic.ts` : le filtre de statut `active` (minuscules) ne correspondait à aucune ligne (`ACTIVE` en base) ; test `apps/api/test/adapters/admissions-catalog.unit.test.ts`. À reconfirmer après redémarrage de l'API de démonstration depuis cette branche.

### M22. Requete rejetee : POST /api/v1/attendance/sessions -> 409

- **Pages concernées** : 1 route(s), 1 URL : `/v2/teacher/attendance/call/daily/:id`
- **Rôles** : secondaire/enseignant
- **Type** : `api-409`
- **Preuve** : `POST /api/v1/attendance/sessions -> 409 {"status":409,"code":"attendance.call_scope_not_allowed","kind":"conflict","message":"La politique d'appel de ce cycle n'autorise pas l'appel journalier.","details":{"callScope":"SESSION","requested":"DAILY"},"requestId":"01a0ff8c-d1aa-76cc-8af3-008b93f8e599"}`
- **Capture** : `.demo/qa/shots/demo_secondaire_enseignant-_v2_teacher_attendance_call_daily_01a0fefc_bfc1_73f1_83d4_f5d43f4e17db.png`
- **Cause probable** : À analyser.
- **Fichier suspect** : `apps/web/src/platform/admin/menu.ts`, `apps/web/src/platform/v2/attendance.ts`, `apps/web/src/lib/hooks/use-attendance.ts`

## Mineur (42)

| # | Type | Constat | Pages (ex.) | Rôles |
|---:|---|---|---|---|
| m1 | `api-404` | Ressource ou route API introuvable : GET /api/v1/people/me/student -> 404 | `/v2/student`, `/v2/student/attendance`, `/v2/student/documents` (+7) | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m2 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/scheduling/me/today -> 403 | `/v2/attendance/call`, `/v2/schedule/today`, `/v2/teacher` (+2) | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m3 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/scheduling/me/timetable?from=:n-09-28&to=:n-10-04&limit=500 -> 403 | `/v2/schedule`, `/v2/schedule/export`, `/v2/teacher/schedule` (+1) | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m4 | `api-404` | Ressource ou route API introuvable : GET /api/v1/people/me/staff -> 404 | `/v2/staff/me`, `/v2/teacher/attendance`, `/v2/teacher/attendance/call` (+1) | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m5 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/primary_school/rule-banner -> 403 | `/v2/primary/appreciations`, `/v2/primary/classe`, `/v2/primary/parametres` | secondaire/proprietaire, superieur/proprietaire |
| m6 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/me/children -> 403 | `/v2/councils/famille`, `/v2/schoollife/famille` | primaire/proprietaire, superieur/proprietaire |
| m7 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/higher/diplomas -> 403 | `/v2/higher`, `/v2/higher/diplomas` | primaire/proprietaire, secondaire/proprietaire |
| m8 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/payroll/my/payslips?limit=25&offset=0 -> 403 | `/v2/payroll/my`, `/v2/teacher/payslips` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m9 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/reference -> 403 | `/v2/schoollife/parametres`, `/v2/schoollife/saisie` | primaire/proprietaire, superieur/proprietaire |
| m10 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/assignments?page=1&pageSize=30 -> 403 | `/v2/stateassign`, `/v2/stateassign/verification` | primaire/proprietaire, superieur/proprietaire |
| m11 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/export-formats?dataset=ASSIGNMENTS -> 403 | `/v2/stateassign/reports`, `/v2/stateassign/settings` | primaire/proprietaire, superieur/proprietaire |
| m12 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/primary_school/my-classrooms -> 403 | `/v2/primary/appreciations`, `/v2/primary/classe` | secondaire/proprietaire, superieur/proprietaire |
| m13 | `api-401-no-profile` | GET /api/v1/attendance/me/attendance -> 401 (profil absent du compte ; l'API devrait repondre 403/404, pas 401) | `/v2/attendance/me` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m14 | `api-401-no-profile` | GET /api/v1/higher/me/documents -> 401 (profil absent du compte ; l'API devrait repondre 403/404, pas 401) | `/v2/higher/me/documents` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m15 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/councils?page=1&pageSize=25 -> 403 | `/v2/councils` | primaire/proprietaire, superieur/proprietaire |
| m16 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/effects?page=1&pageSize=25 -> 403 | `/v2/councils/effets` | primaire/proprietaire, superieur/proprietaire |
| m17 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/me/decisions -> 403 | `/v2/councils/moi` | primaire/proprietaire, superieur/proprietaire |
| m18 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/orientation-paths -> 403 | `/v2/councils/orientation` | primaire/proprietaire, superieur/proprietaire |
| m19 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/series-transfers -> 403 | `/v2/councils/orientation` | primaire/proprietaire, superieur/proprietaire |
| m20 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/orientation-files?pageSize=100 -> 403 | `/v2/councils/orientation` | primaire/proprietaire, superieur/proprietaire |
| m21 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/councils/reference -> 403 | `/v2/councils/parametres` | primaire/proprietaire, superieur/proprietaire |
| m22 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/higher/documents?limit=50 -> 403 | `/v2/higher/documents` | primaire/proprietaire, secondaire/proprietaire |
| m23 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/higher/document-slots -> 403 | `/v2/higher/signatories` | primaire/proprietaire, secondaire/proprietaire |
| m24 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/dashboard -> 403 | `/v2/schoollife` | primaire/proprietaire, superieur/proprietaire |
| m25 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/convocations -> 403 | `/v2/schoollife/convocations` | primaire/proprietaire, superieur/proprietaire |
| m26 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/me/life -> 403 | `/v2/schoollife/moi` | primaire/proprietaire, superieur/proprietaire |
| m27 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/measures?status=PROPOSED -> 403 | `/v2/schoollife/validations` | primaire/proprietaire, superieur/proprietaire |
| m28 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/schoollife/measure-effects?status=AWAITING_HUMAN -> 403 | `/v2/schoollife/validations` | primaire/proprietaire, superieur/proprietaire |
| m29 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/receivables/aging -> 403 | `/v2/stateassign/receivables` | primaire/proprietaire, superieur/proprietaire |
| m30 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/receivables?page=1&pageSize=30 -> 403 | `/v2/stateassign/receivables` | primaire/proprietaire, superieur/proprietaire |
| m31 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/reports/controls-due?status=PENDING&overdueOnly=true&pageSize=20 -> 403 | `/v2/stateassign/reconciliation` | primaire/proprietaire, superieur/proprietaire |
| m32 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/reports/reconciliation?reconciliationStatus=DISCREPANCY&page=1&pageSize=30 -> 403 | `/v2/stateassign/reconciliation` | primaire/proprietaire, superieur/proprietaire |
| m33 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/reports/summary -> 403 | `/v2/stateassign/reports` | primaire/proprietaire, superieur/proprietaire |
| m34 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/gateway/status -> 403 | `/v2/stateassign/reports` | primaire/proprietaire, superieur/proprietaire |
| m35 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/stateassign/settings?institutionId=:id -> 403 | `/v2/stateassign/settings` | primaire/proprietaire, superieur/proprietaire |
| m36 | `api-403` | Appel refuse (403, attendu hors menu) : GET /api/v1/primary_school/phrases -> 403 | `/v2/primary/appreciations` | secondaire/proprietaire, superieur/proprietaire |
| m37 | `api-404` | ✔ Ressource ou route API introuvable : GET /api/v1/admissions/workflows -> 404 | `/v2/admissions/settings/workflow` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m38 | `api-404` | Ressource ou route API introuvable : GET /api/v1/councils/me/orientation -> 404 | `/v2/councils/moi` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire |
| m39 | `api-404` | Ressource ou route API introuvable : GET /api/v1/councils/me/decisions -> 404 | `/v2/councils/moi` | secondaire/proprietaire |
| m40 | `api-404` | Ressource ou route API introuvable : GET /api/v1/schoollife/me/life -> 404 | `/v2/schoollife/moi` | secondaire/proprietaire |
| m41 | `menu-redirect` | Entree de menu qui redirige ailleurs | `/v2/academic` | primaire/directeur_etudes, secondaire/directeur_etudes, superieur/directeur_etudes |
| m42 | `menu-redirect` | Entree de menu qui redirige ailleurs | `/v2/primary` | primaire/instituteur, primaire/instituteur_maternelle |

## Menus de navigation par rôle

Menu rendu à l'atterrissage, liens de menu visités (un lien mort est un constat bloquant ci-dessus), et comparaison avec la navigation de l'API (`/api/v1/rbac/me/navigation`, tous portails) : entrées de l'API absentes du menu rendu = entrées filtrées côté web ou mal réécrites.

| Établissement | Rôle | Liens du menu rendu | Entrées API (tous portails) | Entrées API absentes du menu rendu | Droits / abonnement (`entitlements/me`) |
|---|---|---:|---:|---|---|
| primaire | admissions_officer | 7 | 10 | Messages (`/v2/messages`), Annonces (`/v2/announcements`) | HTTP 403 |
| primaire | directeur | 102 | 142 | — | lisible |
| primaire | directeur_etudes | 6 | 55 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Personnel (`/admin/personnel`) … (+38) | HTTP 403 |
| primaire | econome | 11 | 33 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`) … (+16) | HTTP 403 |
| primaire | educateur | 9 | 18 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Classes (`/admin/academique/classes`) … (+7) | HTTP 403 |
| primaire | eleve | 12 | 14 | — | HTTP 403 |
| primaire | instituteur | 6 | 18 | Suivi des appels (`/admin/attendance`), Bulletins — liste (`/admin/bulletins`), Types d'évaluation (`/admin/notes/types`) … (+2) | HTTP 403 |
| primaire | instituteur_maternelle | 6 | 18 | Suivi des appels (`/admin/attendance`), Bulletins — liste (`/admin/bulletins`), Types d'évaluation (`/admin/notes/types`) … (+2) | HTTP 403 |
| primaire | parent | 5 | 15 | — | HTTP 403 |
| primaire | proprietaire | 102 | 142 | — | lisible |
| primaire | responsable_examens | 11 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+8) | HTTP 403 |
| primaire | responsable_pedagogique | 2 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+15) | HTTP 403 |
| primaire | secretariat | 3 | 34 | Années et périodes (`/admin/academique/annees`), Programmes et niveaux (`/admin/academique/programmes`), Curriculum (`/admin/academique/curriculum`) … (+26) | HTTP 403 |
| secondaire | admissions_officer | 7 | 10 | Messages (`/v2/messages`), Annonces (`/v2/announcements`) | HTTP 403 |
| secondaire | directeur | 112 | 154 | — | lisible |
| secondaire | directeur_etudes | 6 | 58 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Personnel (`/admin/personnel`) … (+41) | HTTP 403 |
| secondaire | econome | 11 | 38 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`) … (+20) | HTTP 403 |
| secondaire | educateur | 9 | 21 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Classes (`/admin/academique/classes`) … (+9) | HTTP 403 |
| secondaire | eleve | 12 | 16 | — | HTTP 403 |
| secondaire | enseignant | 10 | 20 | Suivi des appels (`/admin/attendance`), Types d'évaluation (`/admin/notes/types`), Conseils de classe (`/v2/councils`) … (+3) | HTTP 403 |
| secondaire | parent | 5 | 17 | — | HTTP 403 |
| secondaire | proprietaire | 112 | 154 | — | lisible |
| secondaire | responsable_examens | 11 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+8) | HTTP 403 |
| secondaire | responsable_pedagogique | 2 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+15) | HTTP 403 |
| secondaire | secretariat | 3 | 35 | Années et périodes (`/admin/academique/annees`), Programmes et niveaux (`/admin/academique/programmes`), Curriculum (`/admin/academique/curriculum`) … (+27) | HTTP 403 |
| superieur | admissions_officer | 7 | 10 | Messages (`/v2/messages`), Annonces (`/v2/announcements`) | HTTP 403 |
| superieur | directeur | 103 | 141 | — | lisible |
| superieur | directeur_etudes | 6 | 54 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Personnel (`/admin/personnel`) … (+37) | HTTP 403 |
| superieur | econome | 11 | 33 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`) … (+16) | HTTP 403 |
| superieur | educateur | 9 | 18 | Élèves (`/admin/eleves`), Parents et tuteurs (`/admin/parents`), Classes (`/admin/academique/classes`) … (+7) | HTTP 403 |
| superieur | eleve | 12 | 16 | — | HTTP 403 |
| superieur | enseignant | 10 | 17 | Suivi des appels (`/admin/attendance`), Types d'évaluation (`/admin/notes/types`), Mes notifications (`/v2/account/notifications`) … (+2) | HTTP 403 |
| superieur | parent | 5 | 15 | — | HTTP 403 |
| superieur | proprietaire | 103 | 141 | — | lisible |
| superieur | responsable_examens | 11 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+8) | HTTP 403 |
| superieur | responsable_pedagogique | 2 | 22 | Années et périodes (`/admin/academique/annees`), Élèves (`/admin/eleves`), Programmes et niveaux (`/admin/academique/programmes`) … (+15) | HTTP 403 |
| superieur | secretariat | 3 | 32 | Années et périodes (`/admin/academique/annees`), Programmes et niveaux (`/admin/academique/programmes`), Curriculum (`/admin/academique/curriculum`) … (+24) | HTTP 403 |

## États vides à confronter aux données de démo

Information, pas un défaut avéré : pages dont le contenu se réduit à un état vide. À rapprocher de ce que le rôle devrait voir avec la graine de démonstration.

| Route | Rôles | Texte affiché |
|---|---|---|
| `/v2/staff/[id]` | primaire/directeur_etudes, secondaire/directeur_etudes, superieur/directeur_etudes | Aucun établissement de rattachement. |
| `/v2/finance/payments/[id]` | primaire/econome, secondaire/econome, superieur/econome | Aucun remboursement |
| `/v2/attendance/student/[studentId]` | primaire/educateur, secondaire/educateur, superieur/educateur | Aucun justificatif. |
| `/v2/parent/children/[childId]` | primaire/parent, secondaire/parent, superieur/parent | Aucune donnée d'assiduité. |
| `/v2/parent/children/[childId]/attendance` | primaire/parent, secondaire/parent, superieur/parent | Aucune absence ni retard. |
| `/v2/parent/children/[childId]/schedule` | primaire/parent, secondaire/parent, superieur/parent | Aucune séance cette semaine. |
| `/v2/parent/children/[childId]/emergency` | primaire/parent, secondaire/parent, superieur/parent | Aucun contact d'urgence. |
| `/v2/parent/children/[childId]/upcoming` | primaire/parent, secondaire/parent, superieur/parent | Aucune évaluation planifiée. |
| `/v2/students/[id]` | primaire/directeur_etudes, secondaire/directeur_etudes, secondaire/enseignant, superieur/directeur_etudes … | Aucun compte |
| `/v2/guardians/[id]` | primaire/directeur_etudes, primaire/secretariat, secondaire/directeur_etudes, secondaire/secretariat … | Aucun compte |
| `/v2/messages/[id]` | primaire/eleve, secondaire/eleve, superieur/eleve | Aucune notification non lue |
| `/v2/parent/children/[childId]/finance` | primaire/parent, secondaire/parent, superieur/parent | Aucune échéance à payer. |
| `/v2/attendance/call/[kind]/[id]` | secondaire/educateur | Aucune exception : tous présents. |
| `/v2/announcements/[id]` | secondaire/eleve, secondaire/enseignant, secondaire/parent, superieur/enseignant | Aucune notification non lue |
| `/v2/admissions/reports` | primaire/admissions_officer, primaire/proprietaire, secondaire/admissions_officer, secondaire/proprietaire … | Aucune campagne à analyser. |
| `/v2/owner/charges` | primaire/directeur, primaire/proprietaire, secondaire/directeur, secondaire/proprietaire … | Aucun module de charges ou de comptabilité n'est encore disponible dans la plateforme |
| `/v2/finance/cash` | primaire/econome, primaire/proprietaire, secondaire/econome, secondaire/proprietaire … | Aucune session ouverte. Choisissez une caisse pour commencer à encaisser des espèces. |
| `/v2/finance/refunds` | primaire/econome, primaire/proprietaire, secondaire/econome, secondaire/proprietaire … | Aucun remboursement |
| `/v2/finance/fees/discounts` | primaire/econome, primaire/proprietaire, secondaire/econome, secondaire/proprietaire … | Aucune remise |
| `/v2/finance/fees/plans` | primaire/econome, primaire/proprietaire, secondaire/econome, secondaire/proprietaire … | Aucun plan d'échéancier |
| `/v2/attendance/alerts` | primaire/educateur, secondaire/educateur, superieur/educateur | Aucune règle d'alerte. |
| `/v2/attendance/justifications` | primaire/educateur, primaire/proprietaire, secondaire/educateur, secondaire/proprietaire … | Aucun justificatif. |
| `/v2/student` | primaire/eleve, primaire/proprietaire, secondaire/eleve, secondaire/proprietaire … | Aucune donnée d'assiduité. |
| `/v2/student/attendance` | primaire/eleve, primaire/proprietaire, secondaire/eleve, secondaire/proprietaire … | Aucune absence ni retard. |
| `/v2/student/finance` | primaire/eleve, primaire/proprietaire, secondaire/eleve, secondaire/proprietaire … | Aucune échéance à payer. |
| `/v2/student/schedule` | primaire/eleve, primaire/proprietaire, secondaire/eleve, secondaire/proprietaire … | Aucune séance cette semaine. |
| `/v2/student/upcoming` | primaire/eleve, primaire/proprietaire, secondaire/eleve, secondaire/proprietaire … | Aucune évaluation planifiée. |
| `/v2/announcements` | primaire/proprietaire, secondaire/eleve, secondaire/enseignant, secondaire/parent … | Aucune notification non lue |
| `/v2/assessments/revisions` | primaire/proprietaire, secondaire/enseignant, secondaire/proprietaire, superieur/enseignant … | Aucune demande de correction. |
| `/v2/attendance/children` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est lié à votre compte. |
| `/v2/attendance/conflicts` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun conflit à arbitrer. |
| `/v2/attendance/staff/me` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune présence enregistrée. |
| `/v2/documents/expirations` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun document n'arrive à échéance dans cet horizon. |
| `/v2/documents/quarantine` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun fichier. |
| `/v2/examinations` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/assignments` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/candidates` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/centers` | primaire/proprietaire, primaire/responsable_examens, secondaire/proprietaire, secondaire/responsable_examens … | Aucun centre d'examen |
| `/v2/examinations/corrections` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/exports` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/family` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun examen |
| `/v2/examinations/imports` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/mock` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/results` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/statistics` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucune session d'examen |
| `/v2/examinations/types` | primaire/proprietaire, primaire/responsable_examens, superieur/proprietaire, superieur/responsable_examens | Aucun type d'examen |
| `/v2/finance/me` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun apprenant |
| `/v2/higher/me/documents` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est rattaché à votre compte. |
| `/v2/higher/signatories` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun signataire affecté. |
| `/v2/messages` | primaire/proprietaire, secondaire/eleve, secondaire/enseignant, secondaire/parent … | Aucune notification non lue |
| `/v2/messages/moderation` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune notification non lue |
| `/v2/parent` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est rattaché à votre compte. |
| `/v2/payroll` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune période de paie |
| `/v2/payroll/configuration` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune configuration |
| `/v2/payroll/history` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun bulletin arrêté |
| `/v2/payroll/owner` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune période |
| `/v2/payroll/payslips` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun bulletin |
| `/v2/payroll/reports` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune donnée pour ces filtres |
| `/v2/primary/archives` | primaire/proprietaire | Aucune archive pour cette année. |
| `/v2/primary/mon-enfant` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est lié à votre compte. |
| `/v2/reportcards/family` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun bulletin publié. |
| `/v2/results/overrides` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune surcharge. |
| `/v2/schedule/replacements` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune séance à remplacer. |
| `/v2/schedule/rooms` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune salle. |
| `/v2/schoollife/parametres` | primaire/proprietaire, superieur/proprietaire | Aucune valeur n'est fournie par défaut : types, gravités et barèmes sont à définir par |
| `/v2/settings/subscription` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun usage mesuré pour le moment. |
| `/v2/stateassign/family` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est lié à votre compte. |
| `/v2/student/documents` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun dossier d'élève n'est lié à votre compte. Contactez le secrétariat de l'établiss |
| `/v2/student/me` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune inscription. |
| `/v2/student/profile` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun dossier d'élève n'est lié à votre compte. Contactez le secrétariat de l'établiss |
| `/v2/student/reportcards` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun dossier d'élève n'est lié à votre compte. Contactez le secrétariat de l'établiss |
| `/v2/student/results` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun dossier d'élève n'est lié à votre compte. Contactez le secrétariat de l'établiss |
| `/v2/students/children` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucun enfant n'est rattaché à votre compte. |
| `/v2/teacher/classes` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune classe ne vous est affectée aujourd'hui. |
| `/v2/teacher/leaves` | primaire/proprietaire, secondaire/proprietaire, superieur/proprietaire | Aucune présence enregistrée. |
| `/v2/teacher` | secondaire/enseignant, superieur/enseignant | Aucune séance aujourd'hui. |
| `/v2/teacher/attendance` | secondaire/enseignant, superieur/enseignant | Aucune séance prévue aujourd'hui. |
| `/v2/teacher/payslips` | secondaire/enseignant, superieur/enseignant | Aucun bulletin |
| `/v2/teacher/schedule/export` | secondaire/enseignant, superieur/enseignant | Aucun lien d'abonnement. |
| `/v2/councils/effets` | secondaire/proprietaire | Aucun effet |
| `/v2/councils/famille` | secondaire/proprietaire | Aucun enfant rattaché |
| `/v2/councils/orientation` | secondaire/proprietaire | Aucun parcours défini |
| `/v2/schoollife/convocations` | secondaire/proprietaire | Aucune convocation. |
| `/v2/schoollife/famille` | secondaire/proprietaire | Aucun enfant n'est rattaché à votre compte. |
| `/v2/stateassign/verification` | secondaire/proprietaire | Aucun dossier n'attend de vérification. |
| `/v2/attendance/sessions` | superieur/educateur, superieur/proprietaire | Aucun appel sur cette période. |
| `/v2/higher` | superieur/proprietaire | Aucun diplôme. |
| `/v2/higher/diplomas` | superieur/proprietaire | Aucun diplôme. |
| `/v2/higher/documents` | superieur/proprietaire | Aucun document. |

## Routes de l'arborescence non couvertes

38 route(s) sans visite (segment dynamique sans lien découvrable, routes publiques, ou plafond de pages atteint) :

- `/v2/academic/rollover/runs/[id]`
- `/v2/access/roles/[id]`
- `/v2/announcements/[id]/edit`
- `/v2/apply/[school]`
- `/v2/apply/[school]/offer`
- `/v2/apply/[school]/track`
- `/v2/attendance/children/[studentId]`
- `/v2/audit/[id]`
- `/v2/councils/[councilId]`
- `/v2/councils/[councilId]/deliberation`
- `/v2/councils/[councilId]/eleves/[itemId]`
- `/v2/councils/[councilId]/historique`
- `/v2/councils/[councilId]/pv`
- `/v2/documents/[id]`
- `/v2/examinations/candidates/[id]`
- `/v2/finance/me/[learnerId]`
- `/v2/finance/me/[learnerId]/receipts/[id]`
- `/v2/higher/diplomas/[id]`
- `/v2/home`
- `/v2/imports/[id]`
- `/v2/notifications/unsubscribe`
- `/v2/owner/fraicheur`
- `/v2/payroll/my/[id]`
- `/v2/payroll/payslips/[id]`
- `/v2/payroll/periods/[id]`
- `/v2/platform/login`
- `/v2/reportcards/[id]`
- `/v2/results/[id]/explain`
- `/v2/results/year/[enrollmentId]/[yearId]`
- `/v2/rules/versions/[id]`
- `/v2/schedule/timetables/[id]`
- `/v2/schoollife/eleves/[studentId]`
- `/v2/stateassign/[id]`
- `/v2/students/children/[id]`
- `/v2/teacher/payslips/[id]`
- `/v2/verify`
- `/v2/verify/[code]`
- `/v2/verify/v/[code]`

## Méthode et limites

- Connexion par le formulaire de chaque rôle (MFA via le secret TOTP lu à l'exécution dans `.demo/credentials.json`), un compte à la fois, une page à la fois (`next dev`, première visite lente : délai de navigation 150 s).
- File d'exploration : page d'atterrissage, liens du menu rendu (y compris hors `/v2`), puis liens découverts depuis les pages atteignables ; au plus 2 URL par route dynamique et par compte. Le propriétaire et l'opérateur parcourent en plus toute l'arborescence statique (pages marquées « hors menu » : un 403/404 y est attendu et classé mineur).
- Détection : statut HTTP, redirections (`/unauthorized`, `/login`), dialogue d'erreur Next, écran blanc, exceptions JS, erreurs console (clés next-intl manquantes, hydratation), réponses API >= 400, textes `undefined`/`null`/`[object Object]`/`NaN`, clés i18n brutes, libellé « Non inscrit » côté parent/élève.
- Lecture seule : aucune soumission de formulaire, aucun clic hors formulaire de connexion. Les écrans d'appel (`/attendance/call/<type>/<id>`) ne sont pas visités : ils ouvrent une séance (POST) au chargement. Seul effet sur la base : les sessions de connexion.
- Les constats « mineur » et « états vides » sont des heuristiques à confirmer à l'œil. Pile en `next dev` sous charge : les 5xx isolés et les expirations de navigation sont à confirmer par un second passage (⟳).
