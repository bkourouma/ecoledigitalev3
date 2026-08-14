# Refonte du profil Propriétaire (owner) — menus, fonctionnalités et statistiques

> Document d'audit et de cadrage produit à partir d'une lecture exhaustive du code (22 pages, routes API, services, migrations).
> Toutes les fonctionnalités listées ont été **constatées dans le code**, pas supposées. Les manques sont signalés explicitement.

## Sommaire

| Section | Contenu |
| --- | --- |
| [0. Périmètre et ancrage technique](#0-périmètre-et-ancrage-technique) | Le menu cible, les 3 entrées retirées, les 22 pages et leurs fichiers |
| [1. Structure Académique](#1-structure-académique) | 6 pages : Vue d'ensemble, Cycles, Filières, Enseignants, Étudiants, Parents |
| [2. Module Professionnel](#2-module-professionnel) | 16 pages : Programme, Sessions & Planning, Étudiants, Suivi & Évaluation, Documents officiels |
| [3. Synthèse transverse](#3-synthèse-transverse) | L'existant owner, les 15 dettes récurrentes, les contraintes non négociables |
| [4. Plan de statistiques](#4-plan-de-statistiques-recommandé-pour-le-compte-propriétaire) | 8 KPI de tête, 7 tableaux de bord, indicateurs avancés, 22 alertes, migrations manquantes |
| [5. Prompt pour Claude Code](#5-prompt-à-donner-à-claude-code-pour-la-refonte) | Le prompt de refonte, prêt à copier-coller |

Chaque page des sections 1 et 2 est décrite selon le même gabarit : **à quoi elle sert · ce qu'elle permet de faire · fonctionnalités présentes · filtres · données · endpoints · permissions · statistiques déjà affichées · statistiques exploitables absentes · dettes UI/UX**.

---

## 0. Périmètre et ancrage technique

### 0.1 Le menu cible

Le menu retenu correspond **exactement aux deux premières sections** du catalogue de menus administratifs,
déclaré dans `packages/contracts/src/admin-roles.schema.ts` (constante `ADMIN_MENU_CATALOG`, ligne 32),
**moins trois entrées** volontairement retirées :

| Entrée retirée | Clé menu | Route |
| --- | --- | --- |
| Types de Bilan | `academic.bilan_types` | `/annee-academique/types-de-bilan` |
| Matières | `academic.courses` | `/academic/courses` |
| Inscriptions en ligne | `people.registrations` | `/academic/registrations` |

**Contrainte structurante :** ce catalogue est la source unique de vérité partagée par :

1. la sidebar (`apps/web/src/components/layout/Sidebar.tsx`, filtrage via `canSeeHref` / `useAdminMenuAccess`) ;
2. la page **Accès → Menus par rôle** (`apps/web/src/app/owner/acces/`) ;
3. la table `admin_role_menus` en base (colonne `menu_key`).

Retirer une entrée du menu impose donc de la retirer du catalogue **et** de gérer les lignes `admin_role_menus` orphelines.
Les `key` doivent rester stables : ce sont des identifiants persistés.

### 0.2 Les 22 pages du périmètre

| # | Section | Groupe | Page | Route | Fichier |
| --- | --- | --- | --- | --- | --- |
| 1 | Structure Académique | Cycles & Programmes | Vue d'ensemble | `/academic` | `apps/web/src/app/academic/page.tsx` |
| 2 | Structure Académique | Cycles & Programmes | Cycles | `/academic/cycles` | `apps/web/src/app/academic/cycles/page.tsx` |
| 3 | Structure Académique | Cycles & Programmes | Filières | `/academic/programmes` | `apps/web/src/app/academic/programmes/page.tsx` |
| 4 | Structure Académique | Personnes | Enseignants | `/academic/teachers` | `apps/web/src/app/academic/teachers/page.tsx` |
| 5 | Structure Académique | Personnes | Étudiants | `/academic/students` | `apps/web/src/app/academic/students/page.tsx` |
| 6 | Structure Académique | Personnes | Parents | `/academic/parents` | `apps/web/src/app/academic/parents/page.tsx` |
| 7 | Module Professionnel | Programme | UE | `/professionnel/admin/ue` | `apps/web/src/app/professionnel/admin/ue/page.tsx` |
| 8 | Module Professionnel | Programme | ECUE | `/professionnel/admin/matieres` | `apps/web/src/app/professionnel/admin/matieres/page.tsx` |
| 9 | Module Professionnel | Programme | Semestres | `/professionnel/admin/semestres` | `apps/web/src/app/professionnel/admin/semestres/page.tsx` |
| 10 | Module Professionnel | Sessions & Planning | Sessions | `/professionnel/admin/sessions` | `apps/web/src/app/professionnel/admin/sessions/page.tsx` |
| 11 | Module Professionnel | Sessions & Planning | Salles de classe | `/academic/classrooms` | `apps/web/src/app/academic/classrooms/page.tsx` |
| 12 | Module Professionnel | Sessions & Planning | Planning des cours | `/professionnel/admin/planning` | `apps/web/src/app/professionnel/admin/planning/page.tsx` |
| 13 | Module Professionnel | Étudiants | Inscriptions | `/professionnel/admin/inscriptions` | `apps/web/src/app/professionnel/admin/inscriptions/page.tsx` |
| 14 | Module Professionnel | Étudiants | Étudiants inscrits | `/professionnel/admin/inscrits` | `apps/web/src/app/professionnel/admin/inscrits/page.tsx` |
| 15 | Module Professionnel | Étudiants | Paiements | `/professionnel/admin/paiements` | `apps/web/src/app/professionnel/admin/paiements/page.tsx` |
| 16 | Module Professionnel | Suivi & Évaluation | Présences | `/professionnel/admin/presences` | `apps/web/src/app/professionnel/admin/presences/page.tsx` |
| 17 | Module Professionnel | Suivi & Évaluation | Conduite | `/professionnel/admin/conduite` | `apps/web/src/app/professionnel/admin/conduite/page.tsx` |
| 18 | Module Professionnel | Suivi & Évaluation | Notes | `/professionnel/admin/notes` | `apps/web/src/app/professionnel/admin/notes/page.tsx` |
| 19 | Module Professionnel | Suivi & Évaluation | Bulletins | `/professionnel/admin/bulletins` | `apps/web/src/app/professionnel/admin/bulletins/page.tsx` |
| 20 | Module Professionnel | Documents officiels | Attestations de réussite | `/professionnel/admin/attestations` | `apps/web/src/app/professionnel/admin/attestations/page.tsx` |
| 21 | Module Professionnel | Documents officiels | Diplômes | `/professionnel/admin/diplomes` | `apps/web/src/app/professionnel/admin/diplomes/page.tsx` |
| 22 | Module Professionnel | Documents officiels | Signataires | `/professionnel/admin/signataires` | `apps/web/src/app/professionnel/admin/signataires/page.tsx` |

---

## 1. Structure Académique

### 1.1 Cycles & Programmes

#### 1.1.1 Vue d'ensemble — `/academic`

`apps/web/src/app/academic/page.tsx` · clé menu `academic.overview`

**À quoi sert la page**

Page d'accueil du bloc « Cycles & Programmes » du sidebar administrateur. Elle sert de hall d'entree : un bandeau de bienvenue, quatre cartes de chiffres, cinq raccourcis vers les autres pages academiques et un apercu des derniers cycles. Destinee a l'administrateur / proprietaire qui ouvre la section Structure Academique.

**Ce que la page permet de faire**

- Naviguer vers les listes cycles / filieres / matieres / enseignants / evaluations via les raccourcis
- Naviguer vers la liste des cycles depuis un cycle recent ou depuis « Voir tous les cycles »
- Aucune action CRUD : la page ne cree, ne modifie et ne supprime rien

**Fonctionnalités présentes dans le code**

- Bandeau degrade (bleu/violet/indigo) « Bienvenue dans la gestion academique » avec sous-titre et bouton « Commencer » (icone Plus) pointant vers /academic/cycles
- Grille de 4 cartes KPI en degrade : « Cycles actifs », « Programmes », « Cours », « Enseignants » — valeurs et variations ECRITES EN DUR dans la constante `stats` (page.tsx lignes 56-93) : 12 / 45 / 234 / 67 avec les deltas +2, +5, +12, +3 suivis de « ce mois »
- Carte « Actions rapides » (icone TrendingUp) : 5 lignes cliquables avec pastille coloree — Nouveau cycle -> /academic/cycles, Nouveau programme -> /academic/programmes, Nouveau cours -> /academic/courses, Nouvel enseignant -> /academic/teachers, Nouvelle evaluation -> /academic/evaluations
- Carte « Cycles recents » (icone Clock, sous-titre « Derniers cycles crees ou modifies ») alimentee par useCycles({ limit: 5 })
- Chaque ligne de cycle recent affiche : nom en gras, ligne « code • type », pastille verte CheckCircle + libelle « Actif » uniquement si status === 'active', et un chip gris avec updatedAt formate en fr-FR
- Lien de bas de carte « Voir tous les cycles → » vers /academic/cycles
- Etat de chargement : 3 blocs skeleton animes (animate-pulse) dans la carte Cycles recents
- Etat vide : cercle degrade + icone GraduationCap, texte « Aucun cycle cree pour le moment » et bouton « Creer le premier cycle » (renvoie vers /academic/cycles, pas vers /academic/cycles/new)
- Effets hover: scale-105 et ombres sur toutes les cartes

**Filtres, recherche, tri, pagination**

- Aucun filtre, aucune recherche, aucun tri, aucune pagination
- Seule contrainte de volume : limit=5 passe au hook useCycles pour la carte « Cycles recents »

**Données manipulées**

- cycles (id, name, code, type, status, updatedAt)

**Endpoints API appelés**

- GET /api/v1/cycles?page=1&limit=5 (via useCycles dans src/lib/hooks/use-cycles.ts ; en-tetes X-Tenant + JWT)

**Permissions / garde-fous**

Non observe au niveau de la page : il n'existe aucun layout.tsx sous apps/web/src/app/academic et apps/web/middleware.ts ne pose que des en-tetes de securite (CSP, X-Frame-Options), sans controle de session. La seule protection observee est l'affichage du menu : Sidebar.tsx filtre l'entree via canSeeHref('admin', '/academic') (hook useAdminMenuAccess). Cote API, /api/v1/cycles est enregistre apres fastify.register(authMiddleware) (apps/api/src/index.ts ligne 196) : JWT + contexte tenant exiges, mais aucun preHandler de role sur les handlers de routes/cycles.ts.

**Statistiques déjà affichées**

- Carte « Cycles actifs » = 12 (valeur fictive codee en dur)
- Carte « Programmes » = 45 (valeur fictive codee en dur)
- Carte « Cours » = 234 (valeur fictive codee en dur)
- Carte « Enseignants » = 67 (valeur fictive codee en dur)
- Variations « +2 / +5 / +12 / +3 ce mois » (fictives)
- Liste des 5 cycles les plus recents (nom, code, type, date, badge Actif)

**Statistiques exploitables et aujourd'hui absentes**

- Remplacer les 4 KPI fictifs par les vrais comptes : nombre de cycles par statut actif/brouillon/archive (pagination.total de GET /api/v1/cycles?status=...), nombre de filieres (GET /api/v1/programmes -> pagination.total), nombre de matieres (GET /api/v1/courses -> pagination.total), nombre d'enseignants (GET /api/v1/teachers)
- Repartition des filieres par cycle : combien de filieres pour chaque cycle (table programmes.cycle_id jointe a cycles, deja renvoyee par GET /api/v1/programmes qui embarque l'objet cycle)
- Cycles « coquilles vides » : cycles sans aucune filiere, et filieres sans aucune matiere (cycles LEFT JOIN programmes ; programmes LEFT JOIN courses via GET /api/v1/courses?programmeId=) — signal direct d'un catalogue incomplet a vendre
- Effectif reel par cycle : nombre d'inscrits par cycle en agregeant student_enrollments -> classes.programme_id -> programmes.cycle_id (table classes/student_enrollments exposees par GET /api/v1/classes qui renvoie deja studentCount par classe)
- Chiffre d'affaires theorique du catalogue : somme (inscription + scolarite + annexes + autres) de la table cycles_frais multipliee par l'effectif de la filiere (GET /api/v1/cycle-fees + student_enrollments)
- Filieres sans tarif configure : programmes sans ligne correspondante dans cycles_frais (GET /api/v1/cycle-fees vs GET /api/v1/programmes) — manque a gagner direct
- Activite du catalogue sur 30/90 jours : nombre de cycles et filieres crees ou modifies (cycles.created_at/updated_at, programmes.created_at/updated_at, deja renvoyes par les deux endpoints)
- File d'attente de validation : nombre de filieres bloquees en statut 'draft' ou 'review' et anciennete moyenne depuis updated_at (programmes.status, programmes.updated_at)

**Dettes UI/UX constatées**

- Les 4 cartes de chiffres sont entierement fictives (constante `stats` en dur, page.tsx lignes 56-93) : un proprietaire lit « 12 cycles actifs / 45 programmes » sans rapport avec sa base — c'est le defaut le plus grave de la section
- Les deltas « +2 ce mois », « +5 ce mois »… sont egalement inventes et presentes avec un style « positif » (vert/blanc) qui simule un indicateur reel
- Le sous-titre annonce « Derniers cycles crees ou modifies » alors que l'API trie exclusivement par created_at DESC (routes/cycles.ts, ORDER BY created_at DESC) et n'expose aucun tri par updated_at : la date affichee est updatedAt mais l'ordre est celui de creation
- Chaque cycle recent pointe vers `/academic/cycles` (href code en dur ligne 202) au lieu de `/academic/cycles/{id}` : le clic sur un cycle precis ne mene pas a son detail
- Aucun etat d'erreur : si useCycles echoue, `error` n'est jamais lu, isLoading passe a false et data reste undefined -> la page affiche l'etat vide « Aucun cycle cree pour le moment », un faux negatif trompeur
- Les 5 raccourcis « Nouveau cycle / Nouveau programme / Nouveau cours / Nouvel enseignant / Nouvelle evaluation » renvoient vers les pages de liste et non vers les routes /new correspondantes qui existent pourtant (/academic/cycles/new, /academic/programmes/new)
- Le bouton de l'etat vide « Creer le premier cycle » souffre du meme probleme (renvoie a la liste, pas au formulaire)
- Pas de skeleton ni de squelette de chargement pour les 4 KPI (ils sont statiques), incoherent avec la carte Cycles recents qui en a un
- Palette entierement codee en dur (bg-gray-50, text-gray-900, from-gray-50 to-white) sans variante sombre ; texte text-white/70 et text-white/80 sur degrades sature = contraste limite
- Animations hover:scale-105 / transform sur toutes les cartes sans prise en compte de prefers-reduced-motion
- La page ne pose aucun garde de role : n'importe quel utilisateur authentifie qui connait l'URL /academic l'ouvre, la protection ne vit que dans l'affichage du menu

---

#### 1.1.2 Cycles — `/academic/cycles`

`apps/web/src/app/academic/cycles/page.tsx` · clé menu `academic.cycles`

**À quoi sert la page**

Gestion du referentiel des cycles de formation (BTS, Licence, Master, formations courtes, certifications) d'un etablissement. La page liste les cycles sous forme de cartes, permet de les creer, consulter, modifier et supprimer. Sous-routes couvertes : /academic/cycles/new, /academic/cycles/[id], /academic/cycles/[id]/edit. Destinee a l'administrateur qui construit la structure academique avant de creer les filieres.

**Ce que la page permet de faire**

- Creer un cycle (POST) depuis /academic/cycles/new — statut force a 'active', code auto-genere si laisse vide
- Consulter le detail d'un cycle (bouton Eye -> /academic/cycles/{id})
- Modifier un cycle par deux chemins : page /academic/cycles/{id}/edit (redirige vers la liste apres sauvegarde) ou modale d'edition sur la page detail (reste sur place)
- Supprimer un cycle : confirmation par window.confirm natif, puis DELETE ; en cas d'echec, message dans un alert() natif
- Naviguer Retour vers la liste depuis toutes les sous-routes
- Recharger la page via « Reessayer » en cas d'erreur de chargement
- Aucun export, aucun import, aucune generation de PDF, aucun envoi email/WhatsApp, aucune action groupee, aucun archivage en un clic (l'archivage passe par le select Statut en edition)

**Fonctionnalités présentes dans le code**

- LISTE — En-tete « Cycles academiques » en texte degrade + sous-titre « Gerez les cycles de formation et leurs programmes », bouton « Nouveau cycle » (degrade bleu/violet)
- LISTE — 4 cartes KPI calculees cote client sur les cycles charges : « Total cycles » (cycles.length), « Actifs » (status === 'active'), « Brouillons » (status === 'draft'), « Duree moyenne » (moyenne arrondie de durationMonths, suffixe « mois »)
- LISTE — Barre d'outils : champ de recherche avec icone Search et bouton X d'effacement (filtre client sur name, code et description), select « Filtrer par statut » (Tous les statuts / Actifs / Brouillons / Archives), et compteur « N cycle(s) trouve(s) »
- LISTE — Grille de cartes degrade bleu/violet (1/2/3 colonnes) : titre = nom du cycle, ligne « Code: X », ligne « Niveau: X » si certificationLevel renseigne, description tronquee sur 2 lignes (line-clamp-2), cercles decoratifs en fond
- LISTE — 3 boutons icone par carte : Eye (« Voir les details »), Edit (« Modifier »), Trash2 (« Supprimer », fond rouge translucide, spinner Loader2 pendant la suppression)
- LISTE — Etat de chargement plein ecran (Loader2 dans un cercle degrade + « Chargement des cycles... »)
- LISTE — Etat vide initial : « Aucun cycle trouve » + bouton « Creer un cycle »
- LISTE — Etat vide de recherche distinct : « Aucun resultat trouve » + boutons « Effacer les filtres » et « Nouveau cycle »
- LISTE — Etat d'erreur : cercle rouge AlertCircle, « Erreur de chargement », bouton « Reessayer » qui fait window.location.reload()
- CREATION (/new) — Bouton « Retour », titre « Nouveau cycle », carte « Informations du cycle » contenant AntdCycleForm
- FORMULAIRE (AntdCycleForm) — Champs : Nom du cycle (requis, max 255), Code (optionnel, max 20, genere automatiquement cote hook/API s'il est vide), Type (select : Academique / Professionnel / Formation courte / Certification), Niveau de certification (texte libre, ex. Bac+2), Description (textarea) ; le select Statut (Brouillon / Actif / Archive) n'apparait QU'EN EDITION — a la creation le statut est force a 'active'
- FORMULAIRE — Erreurs remontees par toast react-hot-toast (position top-center, 5 s) et erreur de champ posee sur `code` en cas de doublon (409)
- DETAIL (/[id]) — En-tete : bouton Retour, nom du cycle, badge de statut colore (vert « Actif », jaune « Brouillon », gris « Archive »), badge gris de type (Academique / Professionnel / Formation courte / Certification), ligne « Code: X », bouton « Modifier »
- DETAIL — Cartes KPI : « Duree » (durationMonths + « mois »), « Niveau » (si certificationLevel), « Programmes » (nombre de filieres du cycle, calcule client-side sur useProgrammes())
- DETAIL — Carte « Informations du cycle » (description, duree, niveau), carte laterale « Actions rapides » (un seul bouton « Modifier »), carte laterale « Statistiques » (Programmes, Duree, Niveau)
- DETAIL — Modale d'edition AcademicModal (taille xl, sans footer) embarquant AntdCycleForm
- DETAIL — Skeleton animate-pulse au chargement ; ecran « Cycle non trouve » avec bouton « Retour aux cycles » en cas d'erreur
- EDITION (/[id]/edit) — Page dediee « Modifier le cycle » avec le meme AntdCycleForm, etat de chargement dedie et ecran « Cycle introuvable »

**Filtres, recherche, tri, pagination**

- Recherche texte libre cote client sur name + code + description (aucun parametre `search` n'existe cote API cycles)
- Filtre statut cote client : all / active / draft / archived
- Compteur de resultats « N cycles trouves »
- Bouton « Effacer les filtres » dans l'etat vide de recherche
- Aucune pagination, aucun tri, aucun filtre par type de cycle — alors que GET /api/v1/cycles accepte `status` et `type` en querystring (jamais utilises par le front)

**Données manipulées**

- cycles (tenant_id, name, code, type, duration_months, description, certification_level, status, created_at, updated_at)
- programmes (lecture seule : comptage des filieres rattachees au cycle, et verrou de suppression cote API)

**Endpoints API appelés**

- GET /api/v1/cycles (appele sans limit -> l'API applique son defaut page=1&limit=20)
- GET /api/v1/cycles/:id
- POST /api/v1/cycles
- PUT /api/v1/cycles/:id
- DELETE /api/v1/cycles/:id
- GET /api/v1/programmes (via useProgrammes ; sur la liste le resultat n'est jamais utilise, sur le detail il sert au compteur « Programmes »)

**Permissions / garde-fous**

Non observe cote page : aucun layout.tsx ni garde de role sous apps/web/src/app/academic/cycles ; la seule restriction constatee est le filtrage du menu par canSeeHref('admin', '/academic/cycles') dans Sidebar.tsx (useAdminMenuAccess). Cote API, routes/cycles.ts n'a aucun preHandler de role : chaque handler exige seulement request.tenantId (sinon 400 « Tenant Required ») et l'authentification globale posee par fastify.register(authMiddleware) avant l'enregistrement des routes. Toute la sequence CRUD est donc ouverte a n'importe quel utilisateur authentifie du tenant.

**Statistiques déjà affichées**

- Carte « Total cycles » (compte les cycles charges en memoire, pas pagination.total)
- Carte « Actifs » (status === 'active')
- Carte « Brouillons » (status === 'draft')
- Carte « Duree moyenne » en mois (moyenne de durationMonths)
- Compteur « N cycles trouves » sous les filtres
- Detail : KPI « Duree », « Niveau », « Programmes » + bloc lateral « Statistiques » (Programmes / Duree / Niveau)

**Statistiques exploitables et aujourd'hui absentes**

- Nombre de filieres par cycle, directement sur la carte de liste (programmes.cycle_id ; GET /api/v1/programmes?cycleId=...&limit=1 -> pagination.total) : voir d'un coup d'oeil les cycles vides
- Effectif etudiant par cycle : compter les inscrits via student_enrollments -> classes.programme_id -> programmes.cycle_id (GET /api/v1/classes renvoie deja studentCount par classe) — le KPI que veut vraiment un proprietaire, absent aujourd'hui
- Taux de remplissage par cycle : somme des student_enrollments / somme des classes.max_students (table classes, colonne max_students exposee par GET /api/v1/classes)
- Revenu annuel theorique par cycle : somme sur les filieres du cycle de (inscription + scolarite + annexes + autres) x effectif (table cycles_frais via GET /api/v1/cycle-fees?cycleId=..., + student_enrollments)
- Cycles sans grille tarifaire : cycles dont aucune filiere n'a de ligne cycles_frais (GET /api/v1/cycle-fees vs GET /api/v1/programmes) — manque a gagner immediat
- Volume horaire total par cycle : somme de courses.hours_total (et coef) des matieres des filieres du cycle (GET /api/v1/courses?programmeId=...) — base du cout enseignant
- Repartition des cycles par type (academic / professional / short / certification) et par niveau de certification (cycles.type, cycles.certification_level) — deja filtrables cote API mais jamais affichees
- Duree moyenne reelle par type de cycle plutot qu'une moyenne globale (cycles.duration_months groupe par cycles.type)
- Age du referentiel : cycles crees / modifies sur les 30 et 90 derniers jours (cycles.created_at, cycles.updated_at, deja renvoyes par l'endpoint)
- Cycles archives encore porteurs de filieres actives (cycles.status = 'archived' JOIN programmes.status = 'active') — incoherence de catalogue a corriger

**Dettes UI/UX constatées**

- Plafond invisible de 20 cycles : useCycles() est appele sans limit, l'API applique limit=20 par defaut (CycleQuerySchema) et la page n'a aucune pagination ; au-dela de 20 cycles la liste est tronquee silencieusement ET les 4 KPI (Total, Actifs, Brouillons, Duree moyenne) deviennent faux car calcules sur cycles.length
- La recherche et le filtre statut sont 100 % cote client sur ces memes 20 lignes : un cycle qui n'est pas dans la premiere page est introuvable, alors que l'API accepte deja `status` et `type` en querystring
- Le filtre par type de cycle (academic / professional / short / certification), pourtant supporte par l'API, n'existe pas dans l'UI
- useProgrammes() est appele ligne 17 et le resultat `programmes` (ligne 21) n'est jamais utilise dans le rendu : a chaque affichage de la liste, le hook pagine et charge TOUTES les filieres du tenant (boucle de pages de 100 dans use-programmes.ts) pour rien
- Le message de confirmation de suppression affirme « supprimera egalement tous les programmes associes », alors que l'API refuse la suppression avec un 409 « Cannot delete cycle with associated programmes » : le texte promet l'inverse du comportement reel
- Suppression geree en dialogues natifs : window.confirm puis alert() en cas d'erreur, sans modale de l'UI kit ni toast — incoherent avec AntdCycleForm qui utilise react-hot-toast
- deleteCycleMutation.isPending est un etat partage : pendant une suppression, le bouton Trash de TOUTES les cartes est desactive et affiche un spinner
- Les cartes de la liste n'affichent ni badge de statut ni type de cycle, alors que la page detail les affiche : impossible de distinguer un cycle actif d'un brouillon ou d'un archive dans la grille — et le filtre Statut devient un pilotage a l'aveugle
- La carte a `cursor-pointer` et un effet `group` de survol mais aucun onClick sur le conteneur : seuls les trois petits boutons agissent, l'affordance est trompeuse
- Boutons d'action reduits a des icones avec un simple attribut `title`, sans aria-label ni libelle visible : accessibilite et lisibilite faibles sur mobile
- Le champ Duree (durationMonths) est affiche en KPI et sur le detail mais n'existe nulle part dans AntdCycleForm : la valeur reste figee au defaut serveur DEFAULT_CYCLE_DURATION_MONTHS = 12 (routes/cycles.ts), donc la carte « Duree moyenne » affiche pratiquement toujours 12 mois
- Le statut n'est pas proposable a la creation (force a 'active' dans AntdCycleForm) : la carte KPI « Brouillons » ne peut se remplir qu'en repassant par l'edition, ce qui rend le workflow brouillon -> actif inutilisable
- Doublon fonctionnel entre la modale d'edition du detail et la route /[id]/edit, avec deux comportements differents apres sauvegarde (la modale reste sur place, la page redirige vers la liste)
- La page detail affiche le nombre de programmes mais ne liste pas les filieres du cycle et n'offre aucun lien vers /academic/programmes filtre sur ce cycle : impasse de navigation
- La carte laterale « Actions rapides » du detail ne contient qu'un bouton « Modifier », deja present dans l'en-tete — bruit visuel
- Sur le detail, la grille de KPI est declaree en md:grid-cols-4 alors qu'il n'y a que 2 ou 3 cartes (la carte Niveau est conditionnelle) : trou de mise en page
- Les logs de debug console.log("Attempting to delete cycle: ...") et console.log("Cycle deleted successfully") sont restes en production (lignes 54 et 57)
- Le bouton « Reessayer » de l'etat d'erreur fait un window.location.reload() complet au lieu d'un refetch React Query : perte des filtres et de l'etat de la page
- Aucune action groupee, aucun tri, aucun export (CSV/PDF) sur un referentiel pourtant destine a etre partage
- Couleurs et degrades entierement codes en dur, aucune variante sombre ; texte blanc/80 sur degrade sature (contraste faible), et effets transform hover:scale-105 sans prefers-reduced-motion

---

#### 1.1.3 Filières — `/academic/programmes`

`apps/web/src/app/academic/programmes/page.tsx` · clé menu `academic.programmes`

**À quoi sert la page**

Gestion des filieres (programmes) rattachees aux cycles : creation unitaire ou en lot, consultation, modification, suppression. La page detail sert aussi de poste de pilotage des diplomes de la filiere (progression UV/UE des etudiants, generation d'attestations et de diplomes en PDF). Sous-routes couvertes : /academic/programmes/new, /academic/programmes/[id], /academic/programmes/[id]/edit.

**Ce que la page permet de faire**

- Creer une ou plusieurs filieres en une fois (boucle de POST /api/v1/programmes, une requete par filiere, statut force a 'active')
- Consulter le detail d'une filiere
- Modifier une filiere par deux chemins : modale sur la page detail ou page /academic/programmes/{id}/edit
- Supprimer une filiere : window.confirm puis DELETE, erreurs affichees en alert()
- Preparer / resynchroniser le diplome du cycle de la filiere (POST /professional/cycle-groups/{filiereId}/ensure-diploma) puis rebondir vers /professionnel/admin/diplomes/{id}
- Basculer entre plusieurs diplomes de la filiere (pastilles)
- Deplier le parcours d'un etudiant pour voir ses UE validees et restantes
- Choisir une mention et generer une ATTESTATION PDF pour un etudiant diplome (telechargement via downloadAttestationPdf)
- Generer un DIPLOME PDF pour un etudiant diplome (downloadDiplomePdf)
- Rebondir vers la gestion complete du diplome (/professionnel/admin/diplomes/{id})
- Aucun import, aucun export de la liste, aucun envoi email/WhatsApp, aucune action groupee, aucun bouton d'approbation (le endpoint PUT /programmes/:id/approve n'est appele nulle part dans l'UI)

**Fonctionnalités présentes dans le code**

- LISTE — En-tete « Filieres academiques » en degrade rose/orange, sous-titre « Gerez les filieres et unites d'enseignement », bouton « Nouvelle filiere »
- LISTE — 4 cartes KPI cote client : « Total filieres », « Actifs » (status === 'active'), « Brouillons » (status === 'draft'), « Cycles lies » (nombre de cycleId distincts)
- LISTE — Barre de filtres : select statut (Tous / Actifs / Brouillons / En revision / Approuves / Archives), select cycle (« Tous les cycles » + un item par cycle charge), compteur « N filiere(s) trouvee(s) »
- LISTE — Grille de cartes degrade rose/violet/orange : nom de la filiere, « Code: X », « Cycle: <nom du cycle> » (resolu client-side), « Domaine: X » si renseigne, description tronquee sur 2 lignes
- LISTE — 3 boutons icone par carte : Eye (Voir les details), Edit (Modifier), Trash2 (Supprimer, avec spinner)
- LISTE — Etats dedies : chargement (Loader2 rose + « Chargement des filieres... »), vide initial (« Aucune filiere trouvee » + « Creer une filiere »), vide apres filtrage (« Aucun resultat trouve » + « Effacer les filtres » + « Nouvelle filiere »), erreur (AlertCircle + « Reessayer »)
- CREATION (/new) — Titre « Nouvelles filieres », carte « Filieres par cycle » ; mode LOT : un select Cycle unique en haut, puis une liste repetable de blocs « Filiere 1, 2, 3… » (Nom, Code, Domaine optionnel), boutons « Ajouter une filiere » et « Retirer » (desactive s'il ne reste qu'une ligne) ; deduplication par code (insensible a la casse) avant envoi ; statut force a 'active'
- FORMULAIRE (ProgrammeForm, mode edition) — Champs Nom de la filiere, Code, select Cycle, Domaine (avec datalist de suggestions : « Sciences de Gestion des entreprises », « Sciences Juridiques, Politiques et Administratives », « Sciences et Technologies »), Description, select Statut (Actif / Brouillon / En revision / Approuve / Archive)
- DETAIL (/[id]) — En-tete : Retour, nom de la filiere, badge de statut colore (vert Actif, jaune Brouillon, bleu « En revision », violet « Approuve », gris Archive), ligne « Code: X | Cycle: CODE - Nom », bouton « Modifier » (ouvre la modale)
- DETAIL — Cartes KPI : « Cours » (nombre de matieres de la filiere) et « Cycle » (code du cycle)
- DETAIL — Carte « Informations du programme » (description + nom du cycle), carte laterale « Actions rapides » (bouton Modifier), carte laterale « Statistiques » (Cours, Cycle)
- DETAIL — Section « Diplome(s) de cette filiere » : texte contextuel calcule depuis le nom de la filiere (cycleLabel/cycleDureeAnnees : Licence = 3 ans, Master = 2 ans), bandeau d'erreur rouge local, etat vide avec bouton « Ouvrir le diplome du cycle » (POST ensure-diploma puis redirection vers /professionnel/admin/diplomes/{id}), onglets pastilles si plusieurs diplomes, ligne recapitulative « CODE · N UV requises · N etudiant(s) · N diplome(s) obtenu(s) » et bouton « Gerer ce diplome »
- DETAIL — Tableau « Parcours des etudiants » (colonnes : Etudiant, Matricule, Progression, Statut, Documents) ; barre de progression + pourcentage + « x/y UV » ; badges de statut « Diplome obtenu » (vert), « Eligible » (bleu), « En cours » (gris)
- DETAIL — Ligne d'etudiant depliable (ChevronDown/Up) affichant deux colonnes : « UE validees (n) » avec code, libelle et nombre d'UV, et « UE restantes (n) » avec marqueur « (obligatoire) » en rouge
- DETAIL — Pour les etudiants diplomes : select « Mention… » (Passable, Assez Bien, Bien, Tres Bien, Excellent) + bouton « Attestation » et bouton « Diplome », chacun avec spinner individuel
- DETAIL — Modale d'edition AcademicModal (xl, sans footer) embarquant ProgrammeForm
- EDITION (/[id]/edit) — Page dediee « Modifier le programme » avec ProgrammeForm, etat de chargement et ecran « Programme introuvable »

**Filtres, recherche, tri, pagination**

- Filtre statut cote client : all / active / draft / review / approved / archived
- Filtre cycle cote client : all + un item par cycle
- Compteur « N filieres trouvees »
- Bouton « Effacer les filtres » dans l'etat vide de recherche
- AUCUNE barre de recherche texte (contrairement a la page Cycles) ; aucun tri, aucune pagination ; aucun filtre par domaine ni par annee academique alors que l'API accepte cycleId, status et academicYear en querystring

**Données manipulées**

- programmes (tenant_id, cycle_id, name, code, version, description, domaine, objectives, ects_credits, academic_year, status, approved_by, approved_at, created_at, updated_at)
- cycles (lecture : nom, code, type du cycle parent)
- courses (lecture : comptage des matieres de la filiere)
- classes (verrou de suppression cote API : 409 si des classes sont rattachees)
- diplomes professionnels et leurs exigences (uv_required, candidats, statut_octroi, pourcentage, UE validees / restantes)
- students (date et lieu de naissance pour les documents PDF)

**Endpoints API appelés**

- GET /api/v1/programmes (via useProgrammes sans limit : le hook pagine par 100 et agrege toutes les pages)
- GET /api/v1/programmes/:id
- POST /api/v1/programmes (appele en boucle pour la creation en lot)
- PUT /api/v1/programmes/:id
- DELETE /api/v1/programmes/:id
- GET /api/v1/cycles (alimentation du select cycle et resolution du nom de cycle)
- GET /api/v1/courses (sans parametre -> limite serveur par defaut de 20)
- GET /api/v1/professional/diplomas?filiere_id=...
- POST /api/v1/professional/cycle-groups/:filiereId/ensure-diploma
- GET /api/v1/professional/diplomas/:id/candidates
- GET /api/v1/professional/diplomas/:id/students/:studentId/progress
- GET /api/v1/professional/diplomas/:id/students/:studentId/attestation
- GET /api/v1/students/:id (fetchStudent, pour date et lieu de naissance sur les PDF)

**Permissions / garde-fous**

Deux regimes differents sur la meme page. Referentiel filieres : aucun garde cote page, aucun preHandler de role dans apps/api/src/routes/programmes.ts (seulement request.tenantId + authMiddleware global) — tout utilisateur authentifie du tenant peut creer, modifier et supprimer une filiere. Bloc diplomes : les endpoints appeles (/diplomas/:id/candidates, /students/:id/progress, /students/:id/attestation, ensure-diploma) sont declares avec { preHandler: requireAdmin } dans apps/api/src/routes/professional.ts — reserves aux administrateurs. Cote menu, l'entree est filtree par canSeeHref('admin', '/academic/programmes') dans Sidebar.tsx.

**Statistiques déjà affichées**

- Carte « Total filieres »
- Carte « Actifs »
- Carte « Brouillons »
- Carte « Cycles lies » (cycleId distincts)
- Compteur « N filieres trouvees »
- Detail : KPI « Cours » et « Cycle », bloc lateral « Statistiques » (Cours, Cycle)
- Detail / diplome : « N UV requises · N etudiant(s) · N diplome(s) obtenu(s) »
- Detail / diplome : barre de progression par etudiant avec pourcentage et ratio « x/y UV », comptes « UE validees (n) » et « UE restantes (n) »

**Statistiques exploitables et aujourd'hui absentes**

- Effectif inscrit par filiere : nombre d'etudiants via student_enrollments -> classes.programme_id (GET /api/v1/classes renvoie deja studentCount et max_students par classe) — la donnee la plus attendue par un proprietaire et totalement absente de la page
- Taux de remplissage par filiere : somme des inscrits / somme des classes.max_students (table classes) — permet d'identifier les filieres a ouvrir ou a fermer
- Revenu theorique par filiere : (inscription + scolarite + annexes + autres) de cycles_frais x effectif de la filiere (GET /api/v1/cycle-fees?programmeId=...) ; classement des filieres par contribution au chiffre d'affaires
- Filieres sans tarif : programmes sans ligne cycles_frais correspondante (GET /api/v1/cycle-fees vs GET /api/v1/programmes) — trou de facturation direct
- Filieres sans matiere et filieres sans classe : programmes sans courses (GET /api/v1/courses?programmeId=...) et sans classes (GET /api/v1/classes?programmeId=...) — catalogue affiche mais non operationnel
- Volume horaire et charge d'enseignement par filiere : somme de courses.hours_total, hours_theory, hours_practical et coef (table courses, deja renvoyees par GET /api/v1/courses)
- Credits ECTS totaux par filiere : somme / valeur de programmes.ects_credits (colonne existante en base et dans l'API, jamais affichee ni saisissable aujourd'hui)
- Repartition des filieres par domaine (programmes.domaine) — champ deja saisi et affiche sur les cartes mais jamais agrege
- Filieres bloquees dans le workflow : nombre en statut 'draft' ou 'review' et anciennete depuis programmes.updated_at ; delai moyen de validation via programmes.approved_at - created_at (colonnes approved_by / approved_at deja renvoyees par l'API)
- Taux de diplomation par filiere : diplomes obtenus / candidats (GET /api/v1/professional/diplomas/:id/candidates, champ statut_octroi) — la page affiche le detail etudiant par etudiant mais aucun taux consolide
- Progression moyenne des cohortes par filiere : moyenne du champ `pourcentage` des candidats, et nombre d'etudiants « eligibles » non encore diplomes (meme endpoint candidates) — pipeline de diplomation exploitable commercialement
- UE les plus bloquantes : frequence des UE presentes dans `ue_restantes` sur l'ensemble des etudiants d'un diplome (GET /diplomas/:id/students/:studentId/progress) — cible pedagogique directe
- Anciennete et versions du catalogue : nombre de filieres par version (programmes.version) et par annee academique (programmes.academic_year), colonnes gerees par l'API mais absentes de l'UI

**Dettes UI/UX constatées**

- Le KPI « Cours » de la page detail est faux des que le tenant depasse 20 matieres : useCourses() est appele sans parametre, l'API applique limit=20 par defaut (CourseQuerySchema) et le comptage se fait ensuite par filtrage client sur ces 20 lignes seulement — la carte, le bloc « Statistiques » et donc la lecture de la filiere sont errones
- Sur la LISTE, useCourses() est appele ligne 18 et `courses` (ligne 23) n'est jamais utilise dans le rendu : requete reseau inutile a chaque affichage
- Aucune barre de recherche sur une page qui peut contenir des dizaines de filieres, alors que la page Cycles voisine en propose une : incoherence entre deux ecrans jumeaux
- Filtrage integralement cote client alors que l'API expose deja cycleId, status et academicYear en querystring
- Le domaine est affiche sur les cartes mais n'est ni filtrable ni triable ; l'annee academique n'apparait nulle part
- Le message de suppression annonce « supprimera egalement tous les cours associes » alors que l'API renvoie un 409 si des cours OU des classes existent (routes/programmes.ts) : le texte decrit un comportement qui n'existe pas et omet le verrou sur les classes
- Suppression et erreurs de creation geres en dialogues natifs (window.confirm, alert) sans modale ni toast de l'UI kit
- deleteProgrammeMutation.isPending est partage : une suppression desactive le bouton Supprimer de toutes les cartes simultanement
- Les cartes de la liste n'affichent aucun badge de statut alors que 5 statuts existent et sont filtrables : impossible de distinguer une filiere active d'un brouillon ou d'une archive dans la grille
- Creation en lot non transactionnelle : boucle sequentielle de POST, aucune barre de progression, et en cas d'echec partiel les filieres deja creees restent en base avec un simple alert() listant les echecs — l'utilisateur doit deviner l'etat reel
- Les champs ectsCredits, academicYear, objectives et version sont geres par l'API et stockes en base mais n'existent dans aucun formulaire ni dans la page detail : donnees structurantes inaccessibles depuis l'interface
- Le workflow d'approbation existe cote API (PUT /api/v1/programmes/:id/approve, transition review -> approved avec approvedBy/approvedAt) mais n'est expose par aucun bouton : les statuts « En revision » et « Approuve » sont filtrables et affichables sans qu'on puisse jamais les atteindre autrement qu'en forcant le select Statut
- Textes de la page detail sans accents et incoherents avec le reste de l'application : « Programme non trouve », « Le programme demande n'existe pas ou a ete supprime », « En revision », « Approuve », « Archive »
- Tableau des diplomes non responsive au-dela d'un simple overflow-x-auto : 5 colonnes dont une barre de progression et un groupe de 3 controles, illisible sur mobile ; aucune pagination ni recherche etudiant meme avec des centaines de candidats
- Le select « Mention… » n'a ni label ni aria-label et n'est pas persiste : la mention choisie vit uniquement dans un state local et disparait au rechargement, alors qu'elle est imprimee sur le diplome
- La generation de documents ne donne aucun retour de succes (pas de toast) : seul un spinner disparait, l'utilisateur ne sait pas si le PDF est parti
- Deux systemes d'erreur cohabitent sur la meme page : bandeau rouge local pour la section diplome, alert() natif pour la suppression et la creation
- Doublon fonctionnel entre la modale d'edition du detail et la route /[id]/edit, avec deux comportements post-sauvegarde differents (rester sur place vs rediriger vers la liste)
- La page detail ne liste pas les matieres de la filiere ni ses classes : elle en affiche seulement le nombre, sans lien de rebond vers /academic/courses filtre sur la filiere
- Sur le detail, la grille de KPI est declaree en md:grid-cols-4 pour 1 ou 2 cartes seulement (la carte Cycle est conditionnelle) : trou de mise en page
- Logs de debug laisses en production : console.log("Attempting to delete programme: ...") et console.log("Programme deleted successfully") (lignes 50 et 52)
- Le bouton « Reessayer » de l'etat d'erreur fait un window.location.reload() complet au lieu d'un refetch React Query
- Aucune action groupee, aucun export CSV/PDF de la liste des filieres, aucune duplication de filiere alors que la creation en lot suggere un besoin de volume
- Palette codee en dur (degrades rose/orange, bg-gray-50, text-gray-900) sans variante sombre, texte blanc/80 sur degrade sature, et animations transform hover:scale-105 sans prefers-reduced-motion

---

### 1.2 Personnes

#### 1.2.1 Enseignants — `/academic/teachers`

`apps/web/src/app/academic/teachers/page.tsx` · clé menu `people.teachers`

**À quoi sert la page**

Annuaire du corps enseignant (permanents, CDD et vacataires) de l'etablissement. Ecran d'administration reserve au personnel administratif : il permet de creer une fiche enseignant avec creation automatique du compte de connexion et envoi des identifiants par email, de consulter/modifier la fiche, de supprimer, et d'exporter la liste en Excel. Sous-routes : new/ (creation), [id]/ (fiche detail), [id]/edit/ (modification), [id]/assignments/ (affectations, page orpheline non liee au menu).

**Ce que la page permet de faire**

- Creer un enseignant (POST /api/v1/teachers) avec creation du compte utilisateur, attribution du role 'teacher' et envoi automatique des identifiants par email
- Reessayer l'envoi des identifiants apres un echec SMTP (POST /api/v1/teachers/:id/send-credentials)
- Consulter la fiche detail (bouton oeil)
- Modifier un enseignant (bouton crayon → PUT /api/v1/teachers/:id), y compris changement de statut Actif/Inactif/Suspendu
- Supprimer un enseignant (bouton corbeille) avec window.confirm 'Cette action est irreversible' ; message specialise en cas de conflit 409 (enseignant lie a des cours ou des devoirs)
- Exporter la liste filtree au format .xlsx (fichier enseignants_AAAA-MM-JJ.xlsx)
- Ajouter / retirer une specialite ou une qualification sous forme de badge dans les formulaires
- Naviguer vers la liste des affectations d'un enseignant (uniquement par URL directe /academic/teachers/[id]/assignments)

**Fonctionnalités présentes dans le code**

- Titre degrade 'Enseignants et vacataires' + sous-titre 'Gerez votre equipe pedagogique et les intervenants'
- 4 cartes KPI degradees calculees cote client sur la totalite des fiches chargees : 'Total enseignants' (teachers.length), 'Actifs' (status === 'active'), 'Permanents (CDI)' (contractType === 'permanent'), 'Vacataires' (contractType === 'freelance')
- Barre de recherche unique avec icone loupe + bouton croix d'effacement ; placeholder 'Rechercher par nom, email, specialite ou qualification...'
- Compteur de resultats 'N enseignant(s) trouve(s)' a droite de la recherche
- Liste en grille de cartes (1 / 2 / 3 colonnes) degradees orange-ambre-jaune, pas de tableau
- Contenu de chaque carte : nom + prenom, badge de statut (Actif / Inactif / Suspendu), 'N°:' employeeNumber, 'Contrat:' CDI / CDD / Vacataire, email (icone Mail), telephone (icone Phone), 'Embauche le JJ/MM/AAAA' (icone Calendar), 2 premieres specialites + '+N' (icone Award)
- Barre de pagination cote client en pied de liste : selecteur 'Enseignants par page' (10 / 50 / 100), libelle 'X-Y sur N', boutons Precedent / Suivant et 'Page X / Y'
- Etat de chargement dedie (spinner + 'Chargement des enseignants...')
- Deux etats vides distincts : 'Aucun enseignant trouve' (base vide, CTA 'Creer un enseignant') et 'Aucun resultat trouve' (recherche infructueuse, CTA 'Effacer la recherche' + 'Nouvel enseignant')
- Etat d'erreur plein ecran 'Erreur de chargement' avec bouton 'Reessayer' (window.location.reload)
- Export Excel (ExcelJS charge en import dynamique) generant 2 onglets : 'Enseignants' (colonnes N°, Matricule, Nom, Prenom(s), Email, Telephone, Specialites, Qualifications, Type de contrat, Statut, Date d'embauche, Taux horaire formate '#,##0 XOF', autofiltre, ligne de total avec SUM des taux horaires, en-tete fige et repete a l'impression) et 'Synthese' (repartition par statut et par type de contrat avec effectifs, parts en %, barres de donnees conditionnelles)
- Page /new : formulaire react-hook-form + zod en 3 cartes — 'Informations personnelles' (Prenom*, Nom*, Email*, Telephone, Numero d'employe), 'Informations d'emploi' (Type de contrat* CDI/CDD/Vacataire, Date d'embauche via DatePickerFr), 'Profil academique' (specialites et qualifications ajoutees en badges supprimables, Biographie)
- Page /new : mot de passe genere automatiquement cote client (12 caracteres) et envoi systematique des identifiants (sendCredentialsEmail: true) avec le modele email par defaut de l'etablissement
- Page /new : encart de compte rendu d'envoi — Alert destructive 'Enseignant cree, mais l'email n'est pas parti' avec message d'erreur SMTP, boutons 'Reessayer l'envoi' et 'Continuer sans envoyer' ; Alert de succes 'Identifiants envoyes a <email>'
- Page /[id] : fiche detail en 2 colonnes — cartes 'Informations personnelles' (nom complet, numero d'employe, email, telephone), 'Profil academique' (badges specialites, badges qualifications, biographie), 'Cours enseignes' (bloc placeholder 'La gestion des affectations de cours sera disponible prochainement'), sidebar 'Statut' (badge statut + badge contrat) et 'Details d'emploi' (date d'embauche, taux horaire formate FCFA, cree le, derniere modification)
- Page /[id]/edit : memes cartes que la creation + selecteur 'Statut' (Actif / Inactif / Suspendu) ; pas de champ mot de passe ni email de credentials
- Page /[id]/assignments (non reliee au menu ni aux cartes) : liste des affectations via /api/v1/teacher-assignments, affichant les UUID bruts de course_id et class_id, la periode datebut → datefin et des badges contract_type / status
- La liste est enveloppee dans un SessionProvider local (next-auth) propre a cette route

**Filtres, recherche, tri, pagination**

- Recherche texte cote client uniquement, sur nom+prenom concatenes, email, employeeNumber, specialites et qualifications
- Pagination cote client (10 / 50 / 100 par page) avec retour automatique en page 1 au changement de recherche ou de taille de page
- Aucun filtre par statut, par type de contrat ni par specialite, alors que l'API expose status, contractType et email en querystring
- Aucun tri configurable : l'ordre est impose par le serveur (ORDER BY last_name, first_name)

**Données manipulées**

- teachers (id, tenant_id, user_id, employee_number, first_name, last_name, email, phone, specialties[], bio, qualifications[], hire_date, contract_type, hourly_rate, status, created_at, updated_at)
- users (compte de connexion lie : email, name, first_name, last_name, password_hash, initial_password, is_active, active_role_key)
- roles / user_roles (role 'teacher' cree ou reutilise a la creation)
- teacher_assignments + class_courses + classes + programmes (sous-route affectations et GET /teachers/me/classes)
- Table de modele d'email des identifiants enseignants (via teacher-credentials-email.ts)

**Endpoints API appelés**

- GET /api/v1/teachers?page&limit (appele en boucle par useAllTeachers : 1re page puis toutes les pages restantes en Promise.all, limit=100)
- GET /api/v1/teachers/:id
- POST /api/v1/teachers
- PUT /api/v1/teachers/:id
- DELETE /api/v1/teachers/:id
- POST /api/v1/teachers/:id/send-credentials
- GET /api/v1/teacher-assignments?teacherId&page&limit (sous-route [id]/assignments)
- Exposes par l'API mais non utilises par ces pages : GET/PUT /api/v1/teachers/credentials-template, POST /api/v1/teachers/:id/reset-password, GET /api/v1/teachers/me/classes

**Permissions / garde-fous**

Aucun garde-fou de role dans la page Next : le composant est monte des que l'URL est atteinte. Cote API, GET/POST/PUT/DELETE /api/v1/teachers ne verifient que la presence du contexte tenant (request.tenantId), sans controle de role ; seul POST /api/v1/teachers/:id/reset-password exige admin ou super_admin. La visibilite de l'entree de menu 'Enseignants' est filtree par canSeeHref('admin', '/academic/teachers') via useAdminMenuAccess (roles administratifs personnalises), ce qui masque le lien mais ne bloque pas l'acces direct a l'URL.

**Statistiques déjà affichées**

- Carte 'Total enseignants'
- Carte 'Actifs' (status = active)
- Carte 'Permanents (CDI)'
- Carte 'Vacataires' (contractType = freelance)
- Compteur 'N enseignants trouves' lie a la recherche
- Onglet Excel 'Synthese' : repartition par statut et par type de contrat, en effectifs et en pourcentages, avec barres de donnees
- Ligne de total Excel : effectif + somme des taux horaires en XOF

**Statistiques exploitables et aujourd'hui absentes**

- Anciennete moyenne et pyramide des anciennetes du corps enseignant, avec detection des departs potentiels (teachers.hire_date)
- Nombre et liste des enseignants sans aucune affectation active sur l'annee en cours — capacite inutilisee (teachers LEFT JOIN teacher_assignments status='active')
- Charge par enseignant : nombre de classes et de cours affectes, pour reperer surcharges et sous-emploi (teacher_assignments + class_courses + classes)
- Masse salariale theorique des vacataires : somme de teacher_assignments.course_amount par periode et par filiere (teacher_assignments.course_amount, classes → programmes)
- Cout horaire moyen et cout horaire par filiere/specialite (teachers.hourly_rate + teachers.specialties + teacher_assignments)
- Heures enseignees declarees vs heures validees, et delai moyen de validation (teaching_hours.hours_taught, validated_at, validated_by)
- Affectations arrivant a echeance dans les 30/60 jours — renouvellements de contrats a anticiper (teacher_assignments.datefin)
- Taux de couverture des specialites : specialites declarees vs cours reellement rattaches (teachers.specialties + courses via class_courses)
- Taux d'activation des comptes enseignants : comptes encore sur mot de passe initial ou desactives (users.initial_password non nul, users.is_active, teachers.user_id NULL)
- Qualite des dossiers : part de fiches sans email, sans telephone, sans numero d'employe, sans qualification (colonnes de teachers, deja renvoyees par GET /api/v1/teachers)
- Repartition CDI / CDD / Vacataire dans le temps (evolution mensuelle a partir de teachers.created_at et hire_date) pour suivre la precarisation de l'equipe
- Enseignants inactifs ou suspendus depuis plus de N mois (teachers.status + teachers.updated_at)
- Paiements enseignants en attente / payes par periode (teacher_payments, GET /api/v1/teacher-payments)

**Dettes UI/UX constatées**

- La liste charge la totalite des enseignants avant affichage : useAllTeachers enchaine une requete par page de 100 puis pagine cote client — le premier rendu se degrade lineairement avec l'effectif et la carte 'Total enseignants' est fausse si une page echoue
- Aucun filtre par statut ni par type de contrat dans l'UI alors que l'API les supporte : sur un gros effectif il faut deviner un mot-cle de recherche
- La recherche n'est pas debouncee et refiltre l'ensemble du tableau a chaque frappe (useMemo sur toutes les fiches)
- Presentation en cartes degradees plutot qu'en tableau : les colonnes ne sont pas alignees d'une carte a l'autre, aucune comparaison ni tri visuel possible, et le contraste texte blanc sur degrade orange est faible
- La carte 'Cours enseignes' de la fiche detail affiche un placeholder 'sera disponible prochainement' alors que la page /academic/teachers/[id]/assignments existe deja et n'est liee depuis nulle part (page orpheline)
- La page /[id]/assignments affiche les UUID bruts de course_id et class_id dans des balises <code> au lieu des libelles de cours et de classe, et les badges de statut sont en anglais non traduits
- Le champ 'Taux horaire' (hourlyRate) est affiche sur la fiche detail et exporte en Excel mais absent des formulaires de creation et de modification : la donnee est en lecture seule et ne peut jamais etre saisie depuis l'UI
- La suppression passe par window.confirm() natif et les erreurs par alert() ; aucun toast, aucune annulation possible, et la carte reste identique pendant l'operation (seule l'icone corbeille passe en spinner, pour toutes les cartes simultanement car deleteTeacherMutation.isPending est global)
- Aucune UI de reinitialisation de mot de passe ni de renvoi des identifiants depuis la liste ou la fiche : POST /:id/reset-password et POST /:id/send-credentials n'existent que dans le formulaire de creation (bouton de reessai)
- Aucun ecran de personnalisation du modele d'email des identifiants alors que le hook useTeacherCredentialsTemplate et les routes GET/PUT /credentials-template existent
- Incoherence de charte : liste en orange/ambre, formulaires et fiche detail en violet/rose, icone Euro utilisee pour un montant formate en FCFA
- Le compte rendu d'envoi d'email n'apparait qu'en cas d'echec au moment de la creation ; en cas de succes la page redirige immediatement sans confirmer a l'utilisateur que l'email est parti
- initialPassword (mot de passe en clair) est renvoye par GET /api/v1/teachers pour toutes les fiches sans filtrage par role — il transite jusqu'au navigateur meme s'il n'est pas affiche
- Aucun etat squelette : la grille disparait entierement au profit d'un spinner centre a chaque rafraichissement
- Accessibilite : les boutons d'action ne portent qu'un attribut title (pas d'aria-label), et le bouton d'effacement de la recherche est un <button> sans libelle accessible
- Aucun garde-fou de role cote page : un utilisateur dont le menu masque 'Enseignants' accede a la liste complete en tapant l'URL

---

#### 1.2.2 Étudiants — `/academic/students`

`apps/web/src/app/academic/students/page.tsx` · clé menu `people.students`

**À quoi sert la page**

Annuaire global des etudiants de l'etablissement, independant de l'annee academique. Permet a la scolarite de creer une fiche etudiant complete (etat civil, BAC, dernier diplome en piece jointe) avec creation du compte de connexion et envoi automatique des identifiants, puis de consulter, modifier ou supprimer la fiche. Sous-routes : new/, [id]/ (fiche detail), [id]/edit/.

**Ce que la page permet de faire**

- Creer un etudiant (POST /api/v1/students/with-user) : creation du compte utilisateur, du profil, attribution du matricule d'etablissement sequentiel et envoi automatique des identifiants par email (sendCredentialsEmail actif par defaut cote API)
- Televerser le dernier diplome juste apres la creation (POST /api/v1/students/:id/diploma) avec un retry automatique unique sur 404
- Ouvrir/telecharger le fichier du dernier diplome depuis la fiche detail (GET /api/v1/students/:id/diploma/:filename, ouvert via URL blob)
- Consulter la fiche detail (bouton oeil)
- Modifier un etudiant (bouton crayon → PUT /api/v1/students/:id), y compris changement de statut et de matricule
- Supprimer un etudiant (bouton corbeille) avec window.confirm ; messages specialises en 409 (inscrit a des cours, devoirs associes)
- Rechercher et paginer cote serveur

**Fonctionnalités présentes dans le code**

- Titre degrade teal/cyan 'Gestion des etudiants' + sous-titre 'Gerez les profils et informations de vos etudiants'
- Une seule carte KPI pleine largeur : 'Total etudiants' alimentee par pagination.total renvoye par l'API (donc effectif reel, pas seulement la page courante)
- Barre de recherche serveur avec bouton croix d'effacement ; placeholder 'Rechercher par nom, email ou matricule...'
- Compteur 'N etudiant(s) trouve(s)' base sur le total serveur
- Liste en grille de cartes (1 / 2 / 3 colonnes) degradees teal-cyan-bleu
- Contenu de chaque carte : nom complet resolu par cascade (user.firstName/lastName → name → prefixe de l'email → 'Etudiant inconnu'), 'Matricule DESPS' (student_matricule), 'Matricule IPAM' (sequence_number affiche sur 4 chiffres), 'Classe' (className), 'Filiere' (programmeName), 'Sexe' (Masculin/Feminin), email (icone Mail), telephone (icone Phone), 'Ne(e) le JJ/MM/AAAA' (icone Calendar), lieu de naissance (icone MapPin), biographie tronquee sur 2 lignes
- Pagination serveur : selecteur 'Etudiants par page' (10 / 50 / 100), libelle 'X-Y sur N', boutons Precedent / Suivant, 'Page X / Y'
- Etat de chargement dedie (spinner teal + 'Chargement des etudiants...'), etat d'erreur plein ecran avec bouton 'Reessayer'
- Deux etats vides : 'Aucun etudiant trouve' (base vide) et 'Aucun resultat trouve' (recherche), avec CTA de creation
- Page /new : formulaire zod/react-hook-form en 2 cartes visibles — 'Informations personnelles' (Prenom*, Nom*, Email*, Matricule DESPS*, Sexe*, Date de naissance*, Nationalite* pre-remplie 'Ivoirienne', Telephone*) et 'Informations complementaires' (Lieu de naissance*, Residence*, Date d'obtention du BAC*, Serie du BAC*, Dernier diplome obtenu en fichier*)
- Page /new : formatage automatique du telephone ivoirien a la frappe (groupes de 2 chiffres, indicatif +225 facultatif, normalisation en 10 chiffres avant envoi)
- Page /new : upload obligatoire du dernier diplome (PDF/PNG/JPG/WEBP, 10 Mo max) avec apercu du nom et de la taille du fichier, bouton de retrait, et messages d'erreur de format/taille
- Page /new : mot de passe genere cote client, matricule d'etablissement sequentiel (10001, 10002...) attribue par l'API, suggestion d'un email alternatif en cas de conflit 'email already exists'
- Page /new : carte 'Informations administratives' entierement masquee (className='hidden') contenant N° extrait de naissance, date d'extrait, bureau d'etat civil, sous-prefecture (liste CI_SUBPREFECTURES), matricule DSPS, matricule precedent DSPS, adresse
- Page /[id] : fiche detail en 2 cartes — 'Informations personnelles' (prenom, nom, email, sexe, nationalite, telephone en police mono, date de naissance) et 'Informations complementaires' (lieu de naissance, residence, date d'obtention du BAC, serie du BAC, bouton 'Voir le fichier' du dernier diplome ouvert via blob dans un nouvel onglet) ; en-tete rappelant 'Matricule DESPS' et 'Matricule IPAM'
- Page /[id]/edit : 3 cartes — 'Informations personnelles' (Prenom*, Nom*, Email, Telephone, Matricule*, N° d'etablissement*, Statut* Actif/Diplome/Suspendu/Abandonne/Transfere, Sexe*), 'Details personnels' (date de naissance via DatePickerFr, lieu de naissance, nationalite, adresse), 'Contact d'urgence' (telephone d'urgence)
- Page /[id]/edit : garde-fou explicite sur le sexe non renseigne ('Le sexe n'est pas renseigne sur cette fiche : selectionnez-le pour pouvoir enregistrer')

**Filtres, recherche, tri, pagination**

- Recherche texte cote serveur (parametre search) couvrant nom+prenom concatenes, email, student_number, student_matricule, establishment_matricule, sequence_number formate sur 4 chiffres et matricule professionnel (professional_student_matricules)
- Pagination serveur (10 / 50 / 100 par page), retour en page 1 au changement de recherche ou de taille de page
- Aucun filtre par statut, par annee courante, par classe/filiere ni par annee academique dans l'UI, alors que l'API accepte status, currentYear, academicYearId et withoutActiveProfessionalEnrollment
- Tri fige cote serveur : ORDER BY created_at DESC puis prenom/nom, non configurable

**Données manipulées**

- student_profiles (student_number, student_matricule, sequence_number, establishment_matricule, current_year, status, gender, date_of_birth, place_of_birth, nationality, address, phone, emergency_phone, residence, sub_prefecture, birth_certificate_number/date, civil_registry_office, dsps_matricule, dsps_previous_matricule, bac_obtention_date, bac_series, last_diploma, initial_password, is_active, bio)
- users (compte de connexion : email, first_name, last_name, name, password_hash, initial_password)
- student_enrollments + classes + programmes + academic_years (LATERAL JOIN fournissant classId, className, programmeName, academicYearId, academicYearName)
- professional_student_matricules (matricule IPAM du module professionnel)
- student_parents (agregat parentsCount renvoye par le listing)
- professional_enrollments + professional_ue_sessions (filtre withoutActiveProfessionalEnrollment)

**Endpoints API appelés**

- GET /api/v1/students?search&page&limit (appel direct vers NEXT_PUBLIC_API_URL, hors proxy Next)
- GET /api/v1/students/:id
- POST /api/v1/students/with-user
- POST /api/v1/students/:id/diploma (multipart)
- GET /api/v1/students/:id/diploma/:filename
- PUT /api/v1/students/:id
- DELETE /api/v1/students/:id
- Exposes par l'API mais non utilises par ces pages : POST /api/v1/students/:id/reset-password, POST /api/v1/students/:id/send-credentials, GET/PUT /api/v1/students/credentials-template

**Permissions / garde-fous**

Aucun garde-fou de role dans la page Next. Cote API, GET /api/v1/students, GET/PUT/DELETE /:id et POST /with-user ne verifient que la presence du contexte tenant, sans controle de role (le handler du listing calcule bien canViewPasswords a partir de request.user.roles mais ne s'en sert jamais). Seules les sous-routes d'assignation de parents (POST/DELETE /:studentId/parents) exigent admin ou super_admin. La visibilite du menu 'Étudiants' depend de canSeeHref('admin', '/academic/students').

**Statistiques déjà affichées**

- Carte 'Total etudiants' (total serveur)
- Compteur 'N etudiants trouves' lie a la recherche
- Aucun autre indicateur : ni repartition par statut, ni par sexe, ni par classe/filiere, ni graphique

**Statistiques exploitables et aujourd'hui absentes**

- Repartition de l'effectif par statut et taux d'abandon / de transfert / de diplomation (student_profiles.status, deja filtrable par GET /api/v1/students?status=)
- Repartition par sexe et taux de feminisation global et par filiere (student_profiles.gender + student_enrollments → classes → programmes)
- Pyramide des ages et age moyen a l'entree (student_profiles.date_of_birth)
- Effectif par classe, par filiere et par annee academique, avec taux de remplissage face a la capacite (student_enrollments + classes.capacity/max_students + programmes + academic_years)
- Etudiants sans inscription pour l'annee academique active — dossiers a relancer (student_profiles LEFT JOIN student_enrollments sur academic_year_id actif)
- Evolution mensuelle des nouvelles fiches et des inscriptions, pour suivre la campagne de recrutement (student_profiles.created_at, student_enrollments.enrollment_date)
- Origine geographique des etudiants : top lieux de naissance, residences et sous-prefectures (student_profiles.place_of_birth, residence, sub_prefecture)
- Repartition par serie de BAC et delai moyen entre l'obtention du BAC et l'inscription (student_profiles.bac_series, bac_obtention_date)
- Completude des dossiers : part de fiches sans dernier diplome televerse, sans telephone, sans matricule DESPS, sans sexe renseigne (student_profiles.last_diploma, phone, student_matricule, gender)
- Etudiants sans aucun parent rattache — risque de non-joignabilite des familles (parentsCount deja calcule et renvoye par GET /api/v1/students)
- Frais engages et attendus par etudiant, par classe et par annee (student_enrollments.fees JSONB : inscription, scolarite, annexes, autres, total)
- Part des etudiants egalement inscrits au module professionnel et repartition par filiere IPAM (professional_enrollments, professional_student_matricules)
- Taux d'activation des comptes etudiants : comptes encore sur mot de passe initial ou desactives (users.initial_password, student_profiles.is_active)
- Progression des cohortes : repartition par current_year et taux de redoublement (student_profiles.current_year, is_repeating)

**Dettes UI/UX constatées**

- Une seule carte KPI 'Total etudiants' : la page la plus riche en donnees de l'application n'expose aucune repartition par statut, sexe, classe ou filiere alors que ces champs sont deja renvoyes par l'API dans la meme reponse
- Aucun filtre dans l'UI (statut, annee, classe, filiere) alors que l'API supporte status, currentYear et academicYearId : sur plusieurs centaines d'etudiants, seule la recherche texte est disponible
- La recherche n'est pas debouncee : chaque frappe declenche une nouvelle requete serveur avec une nouvelle cle react-query
- Pas de badge de statut sur les cartes de la liste : impossible de distinguer un etudiant actif d'un abandon ou d'un diplome sans ouvrir la fiche
- La fiche detail est tres pauvre par rapport aux donnees disponibles : ni classe/filiere/annee academique, ni statut, ni matricule d'etablissement, ni parents rattaches, ni contact d'urgence, ni adresse, alors que GET /api/v1/students/:id renvoie tous ces champs
- La fiche detail ne propose ni suppression ni renvoi des identifiants ni reinitialisation de mot de passe (les routes API existent), seulement 'Retour' et 'Modifier'
- Le message d'erreur de la creation promet 'Vous pourrez le reessayer depuis sa fiche' pour l'upload du diplome, mais la fiche detail ne comporte aucun controle d'upload : l'utilisateur est dans une impasse
- Champs obligatoires a la creation mais absents du formulaire de modification : residence, date d'obtention du BAC, serie du BAC et dernier diplome ne peuvent plus jamais etre corriges apres la creation
- Le formulaire de modification impose de saisir le 'N° d'etablissement' alors que le texte d'aide indique qu'il est 'attribue automatiquement' — un champ genere par le systeme est rendu editable et obligatoire
- La carte 'Informations administratives' du formulaire de creation est masquee par className='hidden' mais son champ 'Sous-prefecture *' est marque obligatoire : section morte laissee dans le code
- Incoherence de saisie des dates : la creation utilise des <input type="date"> bruts, la modification utilise le composant DatePickerFr
- Le succes de l'envoi automatique des identifiants n'est jamais restitue : l'API renvoie emailSent / emailError mais la page redirige sans les lire, un echec SMTP passe donc totalement inapercu
- useStudents appelle createApiHeaders() sans session : l'en-tete X-Tenant retombe sur NEXT_PUBLIC_TENANT_SLUG, le sous-domaine ou la valeur codee en dur 'imhotepdata', au lieu du tenant de la session — risque de liste vide ou de mauvais etablissement en multi-tenant
- useStudents appelle directement NEXT_PUBLIC_API_URL et contourne le rewrite Next /api/v1/:path*, contrairement aux hooks enseignants et parents
- initialPassword (mot de passe en clair) est renvoye pour chaque etudiant du listing avec le commentaire explicite 'pas de filtrage par role', alors que la variable canViewPasswords est calculee et ignoree
- Suppression par window.confirm() et erreurs par alert() ; le spinner de suppression s'applique a toutes les cartes simultanement (etat isPending global)
- Incoherence de charte : liste en teal/cyan, creation et fiche en bleu/violet, modification en bleu/vert
- Accessibilite : boutons d'action sans aria-label (attribut title seul), champ de recherche sans <label> associe, cartes cliquables au style 'cursor-pointer' sans handler de clic

---

#### 1.2.3 Parents — `/academic/parents`

`apps/web/src/app/academic/parents/page.tsx` · clé menu `people.parents`

**À quoi sert la page**

Annuaire des comptes parents de l'etablissement et gestion de leur rattachement aux etudiants. Permet de creer un compte parent (avec envoi automatique des identifiants) en assignant directement des enfants, de consulter la fiche parent avec la liste de ses enfants, de modifier ses coordonnees et de le supprimer. Sous-routes : new/, [id]/ (fiche detail), [id]/edit/, assign/ (ecran d'assignation etudiant ↔ parents).

**Ce que la page permet de faire**

- Creer un compte parent (POST /api/v1/parents) avec generation du mot de passe cote client, attribution du role 'parent' et envoi automatique des identifiants par email ; recuperation d'un compte orphelin ou ajout du role parent a un compte existant geres cote API
- Assigner un ou plusieurs enfants au parent des sa creation (POST /api/v1/students/:studentId/parents en boucle)
- Assigner un parent a un etudiant depuis /academic/parents/assign (POST /api/v1/students/:studentId/parents) avec type de relation, contact principal, contact d'urgence et autorisation de recuperation
- Retirer un parent d'un etudiant (DELETE /api/v1/students/:studentId/parents/:parentId) avec window.confirm
- Consulter la fiche parent et la liste de ses enfants (bouton oeil)
- Naviguer vers la fiche d'un enfant en cliquant sur sa ligne
- Modifier un parent (bouton crayon → PUT /api/v1/parents/:id)
- Supprimer un parent (bouton corbeille) avec window.confirm ; message specialise si le parent est encore rattache a des etudiants (409)
- Rechercher et paginer

**Fonctionnalités présentes dans le code**

- Titre degrade rose/pink 'Gestion des parents' + sous-titre 'Gerez les parents et leurs relations avec les etudiants'
- 4 cartes KPI degradees : 'Total parents', 'Avec enfants' (childrenCount > 0), 'Total enfants' (somme des childrenCount), 'Moyenne enfants' (moyenne a 1 decimale) — toutes calculees sur le tableau parents de la page courante uniquement
- Barre de recherche avec bouton croix ; placeholder 'Rechercher par nom, email...'
- Compteur 'N parent(s) trouve(s)' base sur la liste filtree de la page courante
- Liste en grille de cartes (1 / 2 / 3 colonnes) degradees rose-pink-fuchsia affichant : nom complet (name), email (icone Mail), 'Nom complet: prenom nom', 'Nombre d'enfants: N'
- Pagination serveur en pied de page : selecteur 'Parents par page' (10 / 50 / 100), libelle 'X-Y sur N', boutons Precedent / Suivant, 'Page X / Y'
- Etat de chargement dedie (spinner rose), etat d'erreur plein ecran avec bouton 'Reessayer'
- Deux etats vides : 'Aucun parent trouve' et 'Aucun resultat trouve' (CTA 'Effacer les filtres' + 'Nouveau parent')
- Page /new : carte 'Informations personnelles' (Prenom*, Nom*, Email*, Telephone) + carte 'Enfants a assigner (optionnel)'
- Page /new : combobox etudiant maison (StudentCombobox) avec champ de recherche integre au panneau deroulant, fermeture au clic exterieur et a la touche Echap, filtrant sur nom, studentNumber et email ; ne propose que les etudiants de l'annee academique active dont parentsCount === 0 et non deja ajoutes
- Page /new : pour chaque enfant ajoute, un bloc parametrable — 'Type de relation *' (Parent / Tuteur / Contact d'urgence), cases a cocher 'Contact principal' (cochee d'office pour le premier enfant), 'Contact d'urgence', 'Autorise a recuperer l'etudiant' (cochee par defaut), bouton 'Retirer'
- Page /new : libelle dynamique du bouton de soumission ('Creer le parent' ou 'Creer le parent et assigner N enfant(s)'), assignations effectuees en boucle apres la creation avec rapport d'echecs cumules
- Page /[id] : 4 cartes de synthese — 'Enfants' (childrenCount), 'Statut' affichant la valeur figee 'Actif', 'Membre depuis' (annee de createdAt), 'Contact' affichant la valeur figee 'Disponible'
- Page /[id] : carte 'Informations generales' (nom complet, email, date de creation en toutes lettres, nombre d'enfants) et carte 'Enfants (N)' listant chaque enfant avec icone toque, nom, 'Matricule:' studentNumber, 'Annee:' currentYear et badge de statut traduit (Actif / Diplome / Suspendu / Abandonne / Transfere), chaque ligne etant cliquable vers /academic/students/[id]
- Page /[id] : etat vide 'Aucun enfant associe a ce parent' avec CTA 'Assigner des etudiants' ; sidebar 'Actions rapides' (Modifier le parent, Assigner des etudiants, Retour a la liste)
- Page /[id] : deduplication defensive des enfants par id avec traces console.log/console.warn laissees en place
- Page /[id]/edit : carte unique 'Informations personnelles' (Prenom*, Nom*, Email*, Telephone)
- Page /assign : parcours en 2 etapes — '1. Selectionner un etudiant' (select de tous les etudiants de l'annee active avec studentNumber entre parentheses + encart bleu de rappel), carte 'Parents actuels' (nom, email, badge du relationshipType brut, badges 'Contact principal' et 'Contact d'urgence', bouton 'Retirer' avec confirmation), '2. Assigner un nouveau parent' (select des parents non deja rattaches, type de relation, 3 cases a cocher, boutons Annuler / Assigner)

**Filtres, recherche, tri, pagination**

- Recherche envoyee au serveur (parametre search : first_name, last_name, email, name) PUIS re-filtree une seconde fois cote client sur name, email et prenom+nom concatenes
- Pagination serveur (10 / 50 / 100 par page), remise en page 1 au changement de recherche
- Le hook accepte un parametre academicYearId (utilise par /assign et /new) mais la liste principale ne l'envoie jamais : l'annuaire parents est global
- Aucun filtre par nombre d'enfants, par type de relation ni par statut, malgre l'icone Filter importee et le libelle 'Effacer les filtres' de l'etat vide
- Aucun tri configurable (ORDER BY last_name, first_name cote serveur)

**Données manipulées**

- users (comptes portant le role 'parent' : email, first_name, last_name, name, created_at, initial_password, is_technical_account)
- roles / user_roles (jointure obligatoire sur roles.key = 'parent')
- student_parents (relationship_type, is_primary_contact, emergency_contact, can_pickup, notes) — table pivot etudiant ↔ parent
- student_profiles + users (enfants : student_number, current_year, status, nom, email)
- student_enrollments (filtre optionnel par academic_year_id sur la liste des parents)
- academic_years (annee active pour restreindre les etudiants proposes)

**Endpoints API appelés**

- GET /api/v1/parents?search&page&limit&academicYearId
- GET /api/v1/parents/:id (via la route Next apps/web/src/app/api/v1/parents/[id]/route.ts qui proxifie le backend avec la session NextAuth)
- POST /api/v1/parents
- PUT /api/v1/parents/:id (proxy Next)
- DELETE /api/v1/parents/:id (proxy Next)
- GET /api/v1/parents/:id/children
- POST /api/v1/students/:studentId/parents
- GET /api/v1/students/:studentId/parents
- DELETE /api/v1/students/:studentId/parents/:parentId
- GET /api/v1/students?limit=1000&academicYearId= (alimentation des combobox de /new et /assign)
- GET /api/v1/academic-years/active (annee academique active)
- Expose par l'API mais non utilise par ces pages : POST /api/v1/parents/:id/reset-password

**Permissions / garde-fous**

Verrouillage cote API le plus strict des trois pages : GET /, GET /:id, POST /, PUT /:id, DELETE /:id, GET /:id/children et POST /:id/reset-password renvoient 403 si request.user.roles ne contient ni 'admin' ni 'super_admin', et 401 sans identifiant utilisateur. Les routes d'assignation POST/DELETE /api/v1/students/:studentId/parents exigent egalement admin ou super_admin. La route proxy Next /api/v1/parents/:id exige en plus une session NextAuth valide. Les comptes techniques sont exclus (COALESCE(users.is_technical_account, false) = false). Cote front, aucun garde-fou de page : la visibilite du menu 'Parents' depend de canSeeHref('admin', '/academic/parents').

**Statistiques déjà affichées**

- Carte 'Total parents' (sur la page courante)
- Carte 'Avec enfants' (parents ayant au moins un enfant, page courante)
- Carte 'Total enfants' (somme des childrenCount de la page courante)
- Carte 'Moyenne enfants' (moyenne par parent, page courante)
- Compteur 'N parents trouves'
- Fiche parent : compteur 'Enfants' et titre 'Enfants (N)'
- Fiche parent : cartes 'Statut = Actif' et 'Contact = Disponible' qui sont des valeurs codees en dur, pas des statistiques

**Statistiques exploitables et aujourd'hui absentes**

- Nombre de parents reellement actifs vs comptes crees, et parents sans aucun enfant rattache — comptes a nettoyer (users role 'parent' LEFT JOIN student_parents)
- Distribution du nombre d'enfants par parent (1, 2, 3+) sur l'ensemble de l'etablissement, pas seulement sur la page affichee (student_parents GROUP BY parent_id)
- Detection des fratries et volume d'etudiants concernes — base de calcul d'une remise fratrie (student_parents + student_profiles)
- Etudiants sans contact principal designe et etudiants sans contact d'urgence — risque operationnel majeur (student_parents.is_primary_contact, emergency_contact)
- Etudiants sans aucun parent rattache, par classe et par filiere (student_profiles LEFT JOIN student_parents, agregat parentsCount deja expose par GET /api/v1/students)
- Repartition des relations par type : parent / tuteur / contact d'urgence (student_parents.relationship_type)
- Part des parents autorises a recuperer l'etudiant (student_parents.can_pickup)
- Taux d'activation des comptes parents : comptes encore sur mot de passe initial, jamais connectes (users.initial_password, users.is_active)
- Evolution mensuelle des creations de comptes parents, a rapprocher des inscriptions etudiants (users.created_at vs student_enrollments.enrollment_date)
- Parents multi-classes / multi-filieres (enfants repartis sur plusieurs classes) pour cibler la communication (student_parents + student_enrollments + classes + programmes)
- Couverture de l'annuaire par annee academique : part des familles de l'annee active disposant d'un compte parent (filtre academicYearId deja supporte par GET /api/v1/parents)

**Dettes UI/UX constatées**

- Les 4 cartes KPI sont calculees sur parents (la page courante, 10 lignes par defaut) et non sur pagination.total : avec plus de 10 parents, 'Total parents', 'Avec enfants', 'Total enfants' et 'Moyenne enfants' affichent des valeurs fausses, tandis que la barre de pagination affiche le bon total juste en dessous
- Le compteur 'N parents trouves' utilise lui aussi filteredParents.length (page courante) alors que la pagination affiche totalCount : deux nombres contradictoires sur le meme ecran
- Double filtrage redondant : la recherche est deja executee cote serveur puis re-appliquee cote client sur la page recue, ce qui peut vider une page entiere de resultats pourtant valides
- Le champ 'Telephone' est present dans le formulaire de creation ET dans le formulaire de modification, mais l'API ne le persiste jamais : ni l'INSERT ni l'UPDATE de la table users ne comportent de colonne phone, et la reponse ne renvoie aucun champ phone — la saisie est silencieusement perdue et le formulaire d'edition affiche toujours un champ vide
- Les cartes 'Statut : Actif' et 'Contact : Disponible' de la fiche parent sont des libelles codes en dur, sans aucune source de donnees : information trompeuse pour un decideur
- La fiche parent affiche 'Nombre d'enfants' deux fois avec deux sources differentes (parent.childrenCount dans la carte du haut, children.length dans la carte 'Informations generales') qui peuvent diverger
- La fiche parent utilise text-white pour les titres et valeurs (h1, nom complet, email, dates) sur des cartes a fond clair : texte blanc sur blanc, contenu potentiellement illisible
- Traces de debogage laissees en production dans la fiche parent : console.log des donnees brutes des enfants, console.warn sur les doublons, console.log a chaque rendu d'enfant ; le hook useParent journalise egalement chaque requete et chaque reponse
- L'ecran /academic/parents/assign n'est accessible que depuis la fiche d'un parent : aucun lien depuis la liste des parents ni depuis la fiche d'un etudiant
- Sur /assign, le badge du type de relation affiche la valeur brute de la base ('emergency_contact', 'guardian') au lieu du libelle francais utilise ailleurs dans les selects
- Sur /assign, les confirmations passent par alert() ('Etudiant assigne au parent avec succes', 'Parent retire avec succes') et les erreurs aussi ; aucun toast, aucun retour visuel discret
- Sur /assign, le select d'etudiants charge jusqu'a 1000 etudiants dans une liste native non virtualisee et sans recherche, alors que la page /new dispose deja d'un combobox avec recherche integree — deux composants differents pour le meme besoin
- Sur /new, une assignation partiellement echouee est signalee par un alert() cumulant les erreurs, puis la page redirige quand meme vers la liste : l'utilisateur perd le contexte pour corriger
- GET /api/v1/academic-years/active est appele avec des en-tetes X-Tenant 'imhotepacademy' et X-User-Id codes en dur dans use-academic-years.ts : sur un autre etablissement, les combobox de /new et /assign risquent de ne proposer aucun etudiant
- initialPassword (mot de passe en clair) est renvoye par GET /api/v1/parents et GET /api/v1/parents/:id pour chaque compte
- L'icone Filter est importee mais jamais utilisee, et l'etat vide propose 'Effacer les filtres' alors qu'aucun filtre autre que la recherche n'existe
- Aucun export Excel sur cette page, contrairement a la liste des enseignants
- Aucune UI de reinitialisation de mot de passe ni de renvoi des identifiants, alors que POST /api/v1/parents/:id/reset-password et le hook useResetParentPassword existent
- Le bouton de suppression n'affiche aucun etat de chargement (deleteParentMutation.isPending n'est pas branche sur le bouton, contrairement aux pages enseignants et etudiants)
- Incoherence de charte : liste et fiche en rose/fuchsia, formulaire de creation en bleu/violet avec bouton emeraude, ecran d'assignation en bleu/violet
- Accessibilite : boutons d'action sans aria-label, cases a cocher construites en <input type="checkbox"> bruts hors du systeme de composants UI, combobox maison sans role ARIA ni navigation clavier dans la liste d'options

---

## 2. Module Professionnel

### 2.1 Programme

#### 2.1.1 UE — `/professionnel/admin/ue`

`apps/web/src/app/professionnel/admin/ue/page.tsx` · clé menu `pro.ue`

**À quoi sert la page**

Ecran d'administration du referentiel des Unites d'Enseignement du Module Professionnel : l'UE est le pole ADMINISTRATIF (rattachee a une filiere, elle porte le code, le prix, la devise, les UV/credits, le statut et la categorie de bulletin). Destinee aux administrateurs de l'ecole (roles admin / super_admin / administrateur) qui construisent le catalogue avant les semestres et les sessions. Depuis le detail on gere la composition en ECUE (lecture seule), les prerequis entre UE et les sessions (cohortes) inscriptibles.

**Ce que la page permet de faire**

- Creer une UE (bouton « Nouvelle UE » / « Creer une UE » -> /ue/new, POST /ue)
- Consulter le detail d'une UE (onglets composition / prerequis / sessions)
- Modifier une UE (code, libelle, description, prix, devise, nb UV, statut actif-inactif, categorie de bulletin) via PATCH /ue/:id
- Supprimer definitivement une UE apres window.confirm (« Refuse si des inscriptions existent ») via DELETE /ue/:id
- Definir/remplacer la liste des prerequis d'une UE (PUT /ue/:id/prerequisites) — l'API refuse l'auto-reference, une autre filiere et tout cycle
- Creer une session (cohorte) rattachee a l'UE : libelle, dates de debut/fin, fenetre d'inscription, capacite max (POST /ue/:id/sessions)
- Ouvrir une session existante depuis le tableau (navigation vers /professionnel/admin/sessions/:id)
- Filtrer la liste par filiere / effacer le filtre
- Naviguer de page en page (pagination client 20 par page)

**Fonctionnalités présentes dans le code**

- Liste : titre en degrade « Unites d'Enseignement (UE) » + sous-titre « Pole administratif — prix, UV, sessions et composition en ECUE, par filiere »
- 2 cartes KPI en degrade : « Total UE » (icone Layers) et « Filieres couvertes » (icone GraduationCap, nombre de filiere_id distincts) — masquees pendant le chargement
- Carte de filtre contenant un SearchableSelect « Filtrer par filiere » (option « Toutes les filieres » + toutes les filieres de useProgrammes) et un compteur « N UE affichee(s) »
- Grille de cartes 2 colonnes ; degrade indigo/blue/cyan si statut = « actif », degrade gris sinon (le statut n'est signale que par la couleur, aucun badge texte)
- Contenu de chaque carte UE : libelle, code en police mono, « Filiere : <nom> (<code>) », « Credit(s) : nb_uv », « Prix : » formate par fmtPrice (0 => « Gratuit », XOF => « FCFA », separateur de milliers fr-FR), description tronquee sur 2 lignes
- 3 boutons icone par carte : Eye (detail, title « Composition, prerequis & sessions »), Edit (modification), Trash2 (suppression, en rouge)
- Filtrage systematique des UE de « Conduite » (isConduiteUe : libelle commencant par « conduite ») : ni affichees ni comptees dans les KPI
- Pagination cote client (PAGE_SIZE = 20) : boutons Precedent / Suivant + « Page X / Y (N UE) », visible seulement au-dela de 20 elements
- Etats : spinner « Chargement des UE… », erreur (AlertCircle + message de la query), etat vide global (icone Layers + « Aucune UE » + CTA « Creer une UE »), etat vide filtre (« Aucune UE pour cette filiere » + bouton « Effacer le filtre »)
- Bandeau d'erreur rouge en haut de page pour les echecs de suppression
- Detail [id] : header avec libelle + ligne « code · filiere (code) · prix devise · nb_uv UV · statut » et bouton « Modifier »
- Detail [id] : 3 onglets — « Composition (ECUE) » (Layers), « Prerequis » (GitBranch), « Sessions » (CalendarDays)
- Onglet Composition : tableau LECTURE SEULE colonnes Code / ECUE / Credits, alimente par ue.ecue ; message « Aucune ECUE rattachee pour l'instant. »
- Onglet Prerequis : grille de cases a cocher listant les autres UE de la MEME filiere, bouton « Enregistrer les prerequis » ; mention « Graphe acyclique garanti »
- Onglet Sessions : tableau Libelle / Debut / Fin / Capacite (« ∞ » si null) / Statut + bouton « Ouvrir » vers /professionnel/admin/sessions/:id
- Onglet Sessions : formulaire de creation en ligne (Libelle, Date debut, Date fin, Capacite max, Inscription ouverte le, Inscription fermee le) avec bouton « Creer la session »
- Page new/ : formulaire Filiere (Select classique), Code, Libelle, Prix — nb_uv force a 0, redirection vers le detail apres creation
- Page [id]/edit/ : Code, Libelle, Description (textarea), Prix, Devise, Nombre d'UV, Statut (Actif / Inactif), Categorie bulletin (— Aucune — / Unite Fondamentale / Unite de Specialite / Unite de Culture Generale) ; mention « La filiere n'est pas modifiable apres creation »

**Filtres, recherche, tri, pagination**

- SearchableSelect « Filtrer par filiere » avec champ de recherche interne (liste : « Toutes les filieres » + programmes)
- Filtrage applique COTE CLIENT sur u.filiere_id (la liste complete est chargee via useAllProfessionalUeList, pageSize 1000)
- Pagination d'affichage cote client, 20 UE par page, retour automatique en page 1 au changement de filtre
- Exclusion permanente et non debrayable des UE « Conduite »
- Aucune recherche plein texte ni filtre par statut expose dans l'UI (bien que l'API listUe accepte q et statut)
- Sur le detail : la liste des prerequis proposes est restreinte aux UE de la meme filiere (GET /ue?filiere_id=...) et exclut l'UE courante

**Données manipulées**

- professional_ue (id, filiere_id, code, libelle, description, categorie, prix, devise, nb_uv, statut, created_by, created_at, updated_at)
- professional_ue_ecue (liaison UE-ECUE : est_obligatoire, coefficient, ordre)
- professional_ecue (code, libelle, credits — lus pour la composition)
- professional_ue_prerequisites (ue_id, prerequisite_ue_id)
- professional_ue_sessions (libelle, date_debut, date_fin, inscription_ouverte_le, inscription_fermee_le, capacite_max, enseignant_id, classroom_id, statut)
- professional_enrollments (controle de suppression : refus si des inscriptions existent)
- programmes (filieres)

**Endpoints API appelés**

- GET /api/v1/programmes (via useProgrammes, pagination interne limit=100 jusqu'a epuisement)
- GET /api/v1/professional/ue?page&pageSize=1000 (useAllProfessionalUeList)
- GET /api/v1/professional/ue?filiere_id=... (useProfessionalUeList, pour les prerequis)
- POST /api/v1/professional/ue
- GET /api/v1/professional/ue/:id (renvoie l'UE + tableau ecue + tableau prerequisites)
- PATCH /api/v1/professional/ue/:id
- DELETE /api/v1/professional/ue/:id
- GET /api/v1/professional/ue/:id/prerequisites
- PUT /api/v1/professional/ue/:id/prerequisites
- GET /api/v1/professional/ue/:id/sessions
- POST /api/v1/professional/ue/:id/sessions

**Permissions / garde-fous**

Toutes les routes API consommees (/professional/ue, /ue/:id, /ue/:id/prerequisites, /ue/:id/sessions) sont protegees par le preHandler requireAdmin defini dans apps/api/src/middlewares/professional-guards.ts, qui exige un tenant et un role parmi admin, super_admin, administrateur (sinon 403 FORBIDDEN). Cote web, la visibilite du menu passe par la cle « pro.ue » du ADMIN_MENU_CATALOG (packages/contracts/src/admin-roles.schema.ts) filtree par useAdminMenuAccess dans Sidebar.tsx, plus la condition isAdmin (admin / super_admin / Administrateur). Aucune garde de role n'est implementee dans le composant de page lui-meme : l'URL reste accessible, seule l'API renvoie 403.

**Statistiques déjà affichées**

- Carte KPI « Total UE » (hors UE Conduite)
- Carte KPI « Filieres couvertes » (nombre de filiere_id distincts)
- Compteur « N UE affichee(s) » dans la barre de filtre
- Compteur de pagination « Page X / Y (N UE) »
- Sur chaque carte : nb_uv (credits) et prix formate
- Sur le detail : rappel prix + devise + nb_uv + statut dans le sous-titre, credits de chaque ECUE, capacite max de chaque session

**Statistiques exploitables et aujourd'hui absentes**

- Repartition des UE par statut actif/inactif et par filiere (professional_ue.statut, filiere_id — GET /professional/ue)
- UE sans aucune ECUE rattachee : trous de maquette (professional_ue LEFT JOIN professional_ue_ecue)
- UE sans aucune session, et UE sans session ouverte a ce jour (professional_ue_sessions.statut)
- Taux de remplissage moyen des cohortes d'une UE = nb_inscriptions_actives / capacite_max, deja calcules par GET /professional/ue-sessions (adminListSessions)
- Chiffre d'affaires potentiel du catalogue par filiere = SUM(professional_ue.prix) et CA reel = prix x inscriptions actives (professional_ue.prix x professional_enrollments)
- Classement des UE les plus demandees (COUNT professional_enrollments joint a professional_ue_sessions -> professional_ue)
- Nombre moyen d'ECUE par UE et somme des credits ECUE vs nb_uv de l'UE, pour detecter les incoherences de maquette (professional_ue_ecue + professional_ecue.credits)
- Total de credits (nb_uv) offerts par filiere et par UE (professional_ue.nb_uv)
- Nombre d'UE verrouillees par des prerequis et profondeur du graphe (professional_ue_prerequisites)
- Taux de validation par UE = validees / inscrits (student_professional_ue_results.statut = 'validee')
- Repartition des UE par categorie de bulletin (fondamentale / specialite / culture generale) et UE sans categorie renseignee (professional_ue.categorie)
- UE gratuites vs payantes et prix median par filiere (professional_ue.prix, devise)

**Dettes UI/UX constatées**

- Aucun champ de recherche texte ni filtre par statut dans l'UI alors que l'API listUe accepte deja q et statut : sur un gros catalogue il faut parcourir les pages a la main
- Toute la liste est chargee d'un bloc (pageSize=1000) puis filtree et paginee en memoire : pas de pagination serveur, temps de premier rendu proportionnel au catalogue
- La suppression utilise window.confirm() natif au lieu d'une modale coherente avec le design system
- deleteMut.isPending etant partage, cliquer « Supprimer » sur une carte met en spinner et desactive le bouton Supprimer de TOUTES les cartes
- Le statut actif/inactif n'est communique que par la couleur du degrade (indigo vs gris) : aucun badge texte, information invisible pour un daltonien ou en impression
- Categorie de bulletin et devise ne sont visibles nulle part en liste, et la categorie n'apparait pas non plus sur la page de detail bien qu'elle soit editable
- Le formulaire de creation ne permet de saisir que filiere / code / libelle / prix ; nb_uv est force a 0 et description, devise, statut et categorie ne sont accessibles qu'apres coup via « Modifier » — double saisie systematique
- L'onglet « Composition (ECUE) » est en lecture seule : impossible d'ajouter, retirer ou reordonner une ECUE ni de regler coefficient / ordre / est_obligatoire depuis l'UE, alors que les hooks useAddEcueToUe, useUpdateUeEcueLink et useRemoveEcueFromUe existent deja
- Le tableau des sessions affiche date_debut / date_fin bruts (texte ISO) sans formatage fr-FR, contrairement au reste de l'application
- Le sous-titre du detail affiche le prix brut « {prix} {devise} » alors que la liste passe par fmtPrice : deux representations differentes du meme montant
- Formulaire de session : aucune validation client (date_fin >= date_debut, fenetre d'inscription coherente) ; new Date(champ vide).toISOString() peut lever une RangeError si le navigateur laisse passer un champ datetime-local vide
- Les onglets sont de simples <button> sans role="tab" / aria-selected / tabpanel, et l'onglet actif n'est pas reflete dans l'URL (pas de deep-link ni de retour arriere)
- Les erreurs de chargement des sessions (sessionsQuery.isError) et des prerequis (ueSameFiliereQuery) ne sont jamais affichees : en cas d'echec l'utilisateur voit un ecran vide silencieux
- Pas de skeleton : les cartes KPI disparaissent completement pendant le chargement, ce qui provoque un saut de mise en page
- Cartes a fond degrade avec texte blanc a 80 % d'opacite : contraste faible sur les libellés secondaires
- Couleurs codees en dur (bg-gray-50, text-gray-600, from-gray-50 to-white) sans variables de theme : pas de rendu correct en mode sombre, contrairement aux blocs qui utilisent muted-foreground
- Aucune action de masse (activer/desactiver ou supprimer plusieurs UE), aucun export CSV/Excel du catalogue
- La grille de cartes n'est pas virtualisee et le composant recharge tout apres chaque mutation (invalidateQueries sur l'ensemble des cles professional-ue)

---

#### 2.1.2 ECUE — `/professionnel/admin/matieres`

`apps/web/src/app/professionnel/admin/matieres/page.tsx` · clé menu `pro.ecue`

**À quoi sert la page**

Ecran d'administration des ECUE (Elements Constitutifs d'UE, ex-Matieres) du Module Professionnel : l'ECUE est le pole PEDAGOGIQUE (code, libelle, credits, description, type de bilan, statut). Elle ne porte NI prix NI UV — portes par l'UE — et n'est pas rattachee a une filiere : elle est mutualisee entre plusieurs UE via la table de liaison. Destinee aux administrateurs qui construisent le referentiel pedagogique et deposent les supports de cours consultables par les enseignants, etudiants inscrits et parents.

**Ce que la page permet de faire**

- Creer une ou plusieurs ECUE en lot (POST /ecue repete pour chaque ligne valide)
- Rattacher les ECUE creees a une UE lors de la creation (POST /ue/:ueId/ecue avec est_obligatoire=true, coefficient=1, ordre=0)
- Consulter le detail d'une ECUE (informations + supports)
- Modifier une ECUE : code, libelle, credits (PATCH /ecue/:id)
- Supprimer definitivement une ECUE apres window.confirm (« Refuse si elle est encore rattachee a une UE ») via DELETE /ecue/:id
- Televerser un support de cours sur l'ECUE (POST /ecue/:id/materials/upload en multipart)
- Lire un support en streaming inline sans telechargement (GET /materials/:id/view, la consultation est journalisee)
- Consulter les statistiques de consultation d'un support par utilisateur (GET /materials/:id/views/summary)
- Supprimer un support de cours apres window.confirm (DELETE /materials/:materialId, le fichier physique est aussi efface)
- Filtrer par filiere puis par UE / effacer les filtres
- Naviguer de page en page (20 ECUE par page)

**Fonctionnalités présentes dans le code**

- Liste : titre en degrade vert/bleu « ECUE (Elements Constitutifs d'UE) » + sous-titre rappelant que prix et UV sont portes par l'UE
- 2 cartes KPI : « Total ECUE » (icone BookOpen, degrade vert/emeraude) et « ECUE actives » (icone Layers, degrade violet/rose, comptage statut === 'actif')
- Carte de filtres avec 2 SearchableSelect cote a cote : « Filtrer par filiere » (source : GET /professional/notes/filieres) et « Filtrer par UE » (liste restreinte aux UE de la filiere choisie, libelle « CODE — libelle »), plus un compteur « N ECUE affichee(s) »
- Grille de cartes 2 colonnes ; degrade vert/teal/bleu si statut = « actif », gris sinon
- Contenu de chaque carte ECUE : libelle, badge blanc translucide « N credit(s) » (si credits non nul), code en mono, ligne « UE : CODE — libelle · CODE — libelle » (toutes les UE mutualisant l'ECUE), ligne « Type de bilan : <nom> » resolue via /api/v1/bilan-types, description tronquee sur 2 lignes
- 3 boutons icone par carte : Eye (detail), Edit (modification), Trash2 (suppression rouge)
- Exclusion systematique des ECUE « Conduite » (libelle commencant par « conduite » OU code contenant EC-CON, meme regle que l'API) et des UE « Conduite » dans le selecteur d'UE
- Pagination cote client (PAGE_SIZE = 20) avec Precedent / Suivant et « Page X / Y (N ECUE) »
- Etats : chargement (« Chargement des ECUE… »), erreur (AlertCircle + message), catalogue vide (« Aucune ECUE trouvee » + CTA « Creer une ECUE »), aucun resultat filtre (« Aucun resultat trouve » + bouton « Effacer les filtres »)
- Detail [id] : header (libelle + code mono) et bouton « Modifier » ; 2 onglets « Informations » (icone Info) et « Supports de cours » (icone FileText)
- Onglet Informations : champs Code (mono), Libelle, Credits, puis Description en dessous si renseignee (les UE liees et le type de bilan ne sont PAS affiches ici bien que l'API les renvoie)
- Onglet Supports de cours : composant SubjectMaterialsPanel — liste des supports avec icone par type (PDF rouge, PPTX orange, video violet, image bleu), titre, description, ligne « KIND · taille (o/Ko/Mo) · N lecture(s) (N utilisateur(s)) »
- Supports : bouton « Lire » ouvrant une visionneuse modale plein ecran (iframe PDF avec toolbar masquee, balise video sans telechargement ni PiP, image non deplacable, message d'incitation a exporter en PDF pour les .pptx), pied de modale « Lecture seule — le telechargement est desactive », clic droit bloque
- Supports : bouton « Stats » ouvrant une modale « Consultations du support » avec tableau Utilisateur (nom + email) / Roles / Ouvertures / Derniere consultation formatee fr-FR
- Supports : formulaire d'ajout (Titre auto-rempli depuis le nom du fichier, Description optionnelle, selecteur de fichier accepte .pdf, .ppt, .pptx, .mp4, .webm, .mov, .m4v, .png, .jpg, .jpeg, .gif, .webp) et bouton « Televerser »
- Page new/ : creation EN LOT — carte « UE de rattachement (optionnel) » (SearchableSelect Filiere puis SearchableSelect UE avec option « — Aucune (rattacher plus tard) — ») puis N blocs « ECUE 1..N » avec Code / Libelle / Credits, boutons « Ajouter une ECUE » et « Retirer », libelle du bouton de soumission adaptatif (« Creer l'ECUE » / « Creer les N ECUE »)
- Page new/ : rattachement automatique a l'UE choisie avec est_obligatoire = true, coefficient = 1, ordre = 0 ; les echecs sont agreges dans un bandeau « N operation(s) en echec : ... »
- Page [id]/edit/ : Code, Libelle, Credits ; la description de carte indique « Mutualisee dans N UE : CODE, CODE » ou « Cette ECUE n'est encore rattachee a aucune UE. » ; le panneau Supports de cours est repete en dessous du formulaire

**Filtres, recherche, tri, pagination**

- SearchableSelect « Filtrer par filiere » (avec recherche interne) alimente par GET /professional/notes/filieres
- SearchableSelect « Filtrer par UE » dont les options sont restreintes aux UE de la filiere selectionnee ; changer de filiere reinitialise ce filtre a « Toutes les UE »
- Logique de filtrage cote client : si une UE precise est choisie -> ECUE dont le tableau ue contient cette UE (prioritaire) ; sinon si une filiere est choisie -> ECUE ayant au moins une UE de cette filiere
- Pagination d'affichage cote client, 20 par page, retour en page 1 des qu'un filtre change
- Exclusion permanente des ECUE et UE « Conduite »
- Aucun champ de recherche texte ni filtre par statut expose (l'API listEcue accepte pourtant q et statut)

**Données manipulées**

- professional_ecue (id, bilan_type_id, code, libelle, description, credits, statut, created_at, updated_at)
- professional_ue_ecue (liaison mutualisation : ue_id, ecue_id, est_obligatoire, coefficient, ordre)
- professional_ue (code, libelle, filiere_id — pour l'affichage des UE liees et les filtres)
- professional_ecue_materials (titre, description, kind, storage_path, mime_type, file_size, uploaded_by, created_at)
- professional_ecue_material_views (material_id, user_id, opened_at)
- bilan_types (types de bilan)
- programmes (filieres, via /notes/filieres)
- users + user_roles + roles (identite et roles dans la modale de statistiques)

**Endpoints API appelés**

- GET /api/v1/professional/ecue?page&pageSize=1000 (useAllProfessionalEcueList — renvoie aussi le tableau ue de chaque ECUE)
- GET /api/v1/professional/ecue/:id (renvoie l'ECUE + tableau ue avec est_obligatoire et coefficient)
- POST /api/v1/professional/ecue
- PATCH /api/v1/professional/ecue/:id
- DELETE /api/v1/professional/ecue/:id
- GET /api/v1/professional/ue?pageSize=1000[&filiere_id=...]
- POST /api/v1/professional/ue/:ueId/ecue
- GET /api/v1/professional/notes/filieres
- GET /api/v1/bilan-types?limit=100
- GET /api/v1/professional/ecue/:id/materials
- POST /api/v1/professional/ecue/:id/materials/upload (multipart)
- DELETE /api/v1/professional/materials/:materialId
- GET /api/v1/professional/materials/:materialId/view
- GET /api/v1/professional/materials/:materialId/views/summary

**Permissions / garde-fous**

Les routes de referentiel (/professional/ecue en GET/POST, /ecue/:id en GET/PATCH/DELETE, /ue/:id/ecue en POST) sont protegees par requireAdmin (admin, super_admin, administrateur). L'upload (POST /ecue/:id/materials/upload) et la suppression de support (DELETE /materials/:materialId) sont sous requireAdminOrTeacher, avec un controle applicatif supplementaire : un enseignant ne peut agir que sur les ECUE qu'il enseigne (teacherTeachesEcue). GET /ecue/:id/materials, /materials/:id/view et /materials/:id/views/summary n'ont PAS de garde de role Fastify mais appliquent un controle d'acces dans le service : admin, enseignant de l'ECUE, etudiant inscrit (statut confirmee/terminee) ou parent d'un tel etudiant ; les statistiques sont en plus reservees aux admins et aux enseignants de l'ECUE. Cote web : cle de menu « pro.ecue » filtree par useAdminMenuAccess + condition isAdmin dans Sidebar.tsx ; la page elle-meme ne verifie aucun role et passe canManage / canViewStats en dur a true.

**Statistiques déjà affichées**

- Carte KPI « Total ECUE » (hors Conduite)
- Carte KPI « ECUE actives » (statut = actif)
- Compteur « N ECUE affichee(s) » dans la barre de filtre
- Compteur de pagination « Page X / Y (N ECUE) »
- Badge « N credit(s) » sur chaque carte ECUE
- Par support de cours : nombre total de lectures (nb_views) et nombre d'utilisateurs distincts (nb_viewers), plus la taille du fichier
- Modale de statistiques d'un support : ouvertures par utilisateur, roles de l'utilisateur, date de derniere consultation

**Statistiques exploitables et aujourd'hui absentes**

- ECUE orphelines (aucune UE rattachee) et ECUE les plus mutualisees, avec le nombre d'UE reutilisant chacune (professional_ue_ecue GROUP BY ecue_id)
- Couverture pedagogique : nombre et pourcentage d'ECUE sans aucun support de cours, nombre moyen de supports par ECUE (professional_ecue_materials)
- Volume de stockage consomme par les supports, par ECUE et par filiere, pour anticiper les couts d'hebergement (professional_ecue_materials.file_size)
- Taux de consultation reel : part des etudiants inscrits ayant ouvert au moins un support d'une ECUE (professional_ecue_material_views croise a professional_enrollments)
- Classement des supports les plus et les moins consultes, et supports jamais ouverts depuis leur depot (professional_ecue_material_views.opened_at vs professional_ecue_materials.created_at)
- Repartition des consultations par role (etudiant / enseignant / parent) — le tableau roles est deja renvoye par listViews
- Repartition des ECUE par type de bilan et nombre d'ECUE sans bilan_type_id renseigne (professional_ecue.bilan_type_id)
- Coherence de maquette : somme des credits ECUE d'une UE comparee au nb_uv de l'UE, pour reperer les ecarts (professional_ecue.credits vs professional_ue.nb_uv)
- ECUE obligatoires sans enseignant affecte sur une session (professional_session_ecue_teachers) — deja controle a l'ouverture d'une session, jamais restitue en tableau de bord
- Charge d'enseignement par ECUE : nombre de seances programmees et heures cumulees (professional_ecue_seances, heure_debut/heure_fin)
- Performance pedagogique par ECUE : moyenne des notes, taux de validation, taux d'absenteisme (professional_ecue_notes, professional_ecue_attendance)
- ECUE actives sans session en cours sur la periode : matieres du catalogue non exploitees (professional_ue_ecue -> professional_ue_sessions.statut)

**Dettes UI/UX constatées**

- Aucune recherche par code ou libelle et aucun filtre par statut, alors que l'API listEcue accepte deja q et statut : sur plusieurs centaines d'ECUE le seul recours est le defilement page par page
- Le catalogue entier est charge d'un bloc (pageSize=1000) puis filtre et pagine en memoire ; aucune pagination serveur
- Le « Type de bilan » est affiche sur les cartes mais n'est editable dans AUCUN formulaire : ni new/ ni [id]/edit/ n'envoient bilan_type_id, le champ est donc ingerable depuis l'interface
- La description existe en base et s'affiche sur la carte et le detail, mais n'est saisissable dans aucun formulaire (creation comme edition)
- Le statut de l'ECUE n'est ni affiche en texte (seule la couleur du degrade le signale) ni modifiable depuis l'ecran d'edition, alors que le KPI « ECUE actives » repose dessus
- La page de detail n'affiche pas les UE de rattachement ni le type de bilan, alors que GET /ecue/:id renvoie deja le tableau ue avec est_obligatoire et coefficient — l'information n'est visible que sur la page d'edition
- Creation en lot : les appels API sont envoyes en boucle sequentielle sans barre de progression ; en cas d'echec partiel, les ECUE deja creees sont conservees, le formulaire reste rempli et les erreurs sont concatenees dans un unique bandeau texte peu lisible
- Le sous-titre promet « rattachez-les directement a une ou plusieurs UE » alors que le formulaire n'autorise qu'UNE seule UE ; coefficient, ordre et caractere obligatoire sont imposes en dur sans possibilite de reglage
- Supports de cours : window.confirm natif pour la suppression, aucun indicateur de progression d'upload, aucune verification de taille cote client (l'utilisateur decouvre l'erreur 413 apres l'envoi complet), et deleteMut.isPending desactive le bouton de suppression de tous les supports a la fois
- Le panneau Supports est duplique sur la page de detail ET sur la page d'edition, avec deux chemins de navigation menant au meme composant
- Le filtre UE depend du filtre filiere : changer de filiere reinitialise silencieusement la selection d'UE sans message
- Les onglets (Informations / Supports) sont de simples <button> sans semantique ARIA tablist/tab/tabpanel, et l'onglet actif n'est pas dans l'URL (pas de deep-link, retour arriere inoperant)
- Le visualiseur modale n'est pas pilotable au clavier : pas de fermeture par Echap, pas de piege de focus, pas de role="dialog" ni aria-modal
- Cartes a fond degrade et couleurs codees en dur (bg-gray-50, text-gray-600, text-white/80) : contraste faible et absence de prise en charge du theme sombre
- Aucune action de masse (activation/desactivation, suppression multiple, rattachement groupe a une UE) ni export du referentiel
- La grille de cartes n'est pas virtualisee et l'invalidation apres mutation recharge l'integralite du catalogue

---

#### 2.1.3 Semestres — `/professionnel/admin/semestres`

`apps/web/src/app/professionnel/admin/semestres/page.tsx` · clé menu `pro.semestres`

**À quoi sert la page**

Ecran d'administration des semestres du Module Professionnel : un semestre appartient a une filiere (table programmes) et regroupe les UE de cette filiere qui composent la maquette de la periode. C'est l'etape intermediaire entre le catalogue (UE/ECUE) et l'ouverture des sessions inscriptibles. Destine aux administrateurs qui structurent l'annee academique par filiere avant de creer les cohortes, les notes et les bulletins.

**Ce que la page permet de faire**

- Creer un ou plusieurs semestres d'une meme filiere en une seule soumission (POST /semestres/batch)
- Selectionner les UE composant chaque semestre par cases a cocher, avec bascule « tout selectionner » et clic sur la ligne
- Consulter le detail d'un semestre (agregats + composition UE -> ECUE)
- Modifier un semestre : renommer le libelle et remplacer l'ensemble des UE rattachees (PATCH /semestres/:id)
- Supprimer definitivement un semestre apres window.confirm (« Les UE ne sont pas supprimees, seul le semestre l'est »)  via DELETE /semestres/:id
- Filtrer la liste par filiere (cote serveur) / effacer le filtre
- Naviguer de page en page (20 semestres par page)

**Fonctionnalités présentes dans le code**

- Liste : titre en degrade indigo/violet « Semestres » + sous-titre « Composez les semestres d'une filiere avec ses UE. Les sessions se creent ensuite. »
- 2 cartes KPI : « Total semestres » (icone CalendarRange) et « UE regroupees » (icone Layers, somme des nb_ue de tous les semestres affiches)
- Carte de filtre avec un SearchableSelect « Filtrer par filiere » (« Toutes les filieres » + programmes) et un compteur « N semestre(s) affiche(s) » — ce filtre est envoye au SERVEUR (query filiere_id)
- Grille de cartes 2 colonnes, degrade indigo/violet/rose : libelle du semestre, badge « N UE », badge « N credits » (nb_uv, icone GraduationCap), ligne « Filiere : <nom> » avec icone Layers
- 3 boutons icone par carte : Eye (detail), Edit (modification), Trash2 (suppression rouge)
- Pagination cote client (PAGE_SIZE = 20) avec Precedent / Suivant et « Page X / Y (N semestres) »
- Etats : chargement (« Chargement des semestres… »), erreur (AlertCircle + message), vide avec message contextuel (« Commencez par creer votre premier semestre. » ou « Aucun semestre pour la filiere selectionnee. ») + boutons « Effacer le filtre » et « Nouveau semestre »
- Bandeau d'erreur rouge en haut de page pour les echecs de suppression
- Detail [id] : header avec libelle, filiere et code filiere en mono, bouton « Modifier »
- Detail [id] : section « TABLEAU DE BORD » avec 3 StatCard en degrade — « UE » (nb_ue), « Credits UE (UV) » (nb_uv), « Credits ECUE » (nb_credits_ecue, somme des credits de toutes les ECUE des UE du semestre)
- Detail [id] : carte « Composition du semestre » — un bloc encadre par UE avec en-tete (code mono, libelle, description tronquee sur 1 ligne, « N credit(s) UE », prix + devise affiches seulement si prix > 0) et, en dessous, un tableau des ECUE colonnes Code / ECUE / Credits ; messages « Aucune UE rattachee a ce semestre. » et « Aucune ECUE rattachee a cette UE. »
- Page new/ : creation MULTIPLE — carte « Filiere » (SearchableSelect obligatoire), puis un bloc Card par semestre a creer
- Page new/ : chaque bloc « Semestre N » affiche un libelle pre-rempli (« Semestre 1 », « Semestre 2 »…), un compteur « N UE · N credits » calcule en direct, un bouton « Retirer » (si plus d'un bloc), et un tableau des UE eligibles de la filiere avec case « Tout selectionner » en en-tete et colonnes Code / UE / Credits / ECUE (nb_ecue) ; la ligne entiere est cliquable pour cocher/decocher
- Page new/ : bouton « Ajouter un semestre », bouton de soumission adaptatif (« Creer le semestre » / « Creer les N semestres ») et validations client (filiere requise, libelle + au moins une UE par bloc, refus des libelles en doublon dans le lot)
- Page new/ : etats dedies pour la liste d'UE — chargement, erreur, et « Aucune UE pour cette filiere. Creez d'abord des UE (menu UE) avant de composer un semestre. »
- Page [id]/edit/ : carte « Informations du semestre » (libelle) + carte « UE du semestre » avec compteur « N / M UE · N credits », case « Tout selectionner » et tableau Code / UE / Credits (la colonne ECUE presente a la creation disparait ici) ; la liste fusionne les UE eligibles de la filiere et les UE deja rattachees, triees par code ; mention « Filiere : <nom> (non modifiable) »

**Filtres, recherche, tri, pagination**

- SearchableSelect « Filtrer par filiere » alimente par useProgrammes ; contrairement aux pages UE et ECUE, ce filtre est transmis a l'API (GET /semestres?filiere_id=...) et declenche une nouvelle requete
- Pagination d'affichage cote client, 20 semestres par page, retour en page 1 au changement de filtre
- Sur new/ et [id]/edit/ : la liste des UE proposees est bornee a la filiere (GET /semestres/eligible-ue?filiere_id=...)
- Aucune recherche par libelle, aucun tri configurable (l'API trie systematiquement par created_at DESC)

**Données manipulées**

- professional_semestres (id, filiere_id, libelle, created_by, created_at, updated_at)
- professional_semestre_ue (liaison semestre <-> UE)
- professional_ue (code, libelle, nb_uv, prix, devise, statut, description)
- professional_ue_ecue et professional_ecue (composition affichee dans le detail : code, libelle, credits, coefficient, est_obligatoire, ordre, indicateur is_conduite)
- professional_semestre_sessions (utilisee par l'API pour compter nb_sessions, non exploitee par l'UI)
- professional_ue_sessions (comptage des sessions rattachees au semestre cote API)
- programmes (filieres)

**Endpoints API appelés**

- GET /api/v1/professional/semestres[?filiere_id=...] (renvoie par semestre : filiere_nom, nb_ue, nb_uv et nb_sessions)
- GET /api/v1/professional/semestres/:id (renvoie filiere_nom, filiere_code, nb_ue, nb_uv, nb_credits_ecue et le tableau ues avec leurs ecues)
- GET /api/v1/professional/semestres/eligible-ue?filiere_id=... (UE de la filiere avec nb_uv, prix, devise, statut, description et nb_ecue)
- POST /api/v1/professional/semestres/batch
- PATCH /api/v1/professional/semestres/:id
- DELETE /api/v1/professional/semestres/:id
- GET /api/v1/programmes (via useProgrammes)

**Permissions / garde-fous**

Toutes les routes semestres (/professional/semestres, /semestres/:id, /semestres/batch, /semestres/eligible-ue) sont protegees par le preHandler requireAdmin (roles admin, super_admin, administrateur ; 403 FORBIDDEN sinon, et 400 TENANT_REQUIRED sans contexte tenant). Cote web, la visibilite du menu depend de la cle « pro.semestres » du ADMIN_MENU_CATALOG filtree par useAdminMenuAccess dans Sidebar.tsx, combinee a la condition isAdmin. Aucune verification de role n'est faite dans le composant de page : l'URL reste atteignable, seule l'API refuse.

**Statistiques déjà affichées**

- Carte KPI « Total semestres »
- Carte KPI « UE regroupees » (somme des nb_ue)
- Compteur « N semestre(s) affiche(s) » dans la barre de filtre
- Badges « N UE » et « N credits » sur chaque carte de semestre
- Compteur de pagination « Page X / Y (N semestres) »
- Detail : StatCard « UE », « Credits UE (UV) » et « Credits ECUE »
- Detail : credits UE et prix par UE dans l'en-tete de chaque bloc, credits de chaque ECUE dans le tableau
- Formulaires : compteur en direct « N UE · N credits » (creation) et « N / M UE · N credits » (edition)

**Statistiques exploitables et aujourd'hui absentes**

- Nombre de sessions rattachees a chaque semestre : l'API listSemestres calcule DEJA nb_sessions (professional_semestre_sessions + professional_semestre_ue) mais l'interface ne l'affiche jamais — indicateur gratuit
- Effectif inscrit par semestre et par filiere (professional_enrollments joint a professional_ue_sessions via professional_semestre_sessions), statut confirmee/terminee
- Taux de remplissage d'un semestre = inscriptions actives / somme des capacite_max des sessions du semestre (professional_ue_sessions.capacite_max)
- Revenu attendu et revenu encaisse par semestre = somme des prix des UE composant le semestre x nombre d'inscrits (professional_ue.prix x professional_enrollments, croise a professional_payments)
- Ecart de maquette : comparaison credits UE (nb_uv) vs credits ECUE (nb_credits_ecue) par semestre — les deux valeurs sont deja renvoyees par GET /semestres/:id et permettent de detecter les semestres mal parametres
- Semestres incomplets : semestres sans UE (nb_ue = 0), semestres sans aucune session creee (professional_semestre_sessions vide), UE du semestre sans ECUE rattachee
- Reussite academique par semestre : moyenne generale et credits valides, exploitables depuis professional_bulletins.data (moyenne_session, credits_total) filtres par semestre_id
- Assiduite par semestre : heures d'absence et taux de presence deja calcules par GET /professional/presences/history?filiere_id=...&semestre_id=... (professional_ecue_attendance x professional_ecue_seances)
- Progression des etudiants : UE validees / UE exigees par semestre (student_professional_ue_results.statut = 'validee' croise a professional_semestre_ue)
- Volume horaire planifie par semestre (professional_ecue_seances : nombre de seances et heures cumulees sur les sessions du semestre)
- Detection des UE reutilisees dans plusieurs semestres d'une meme filiere, source de doublons de maquette (professional_semestre_ue GROUP BY ue_id)
- Cout moyen d'un semestre pour l'etudiant = somme des prix des UE du semestre (professional_semestre_ue joint a professional_ue.prix), utile pour la politique tarifaire

**Dettes UI/UX constatées**

- nb_sessions est renvoye par l'API pour chaque semestre mais n'est jamais affiche : une donnee cle (le semestre est-il deja ouvert ?) est perdue
- Aucune recherche par libelle, aucun tri configurable et aucun regroupement visuel par filiere : sans filtre, plusieurs cartes « Semestre 1 » de filieres differentes se succedent, la filiere n'etant qu'une petite ligne de texte
- Le compteur d'en-tete affiche le nombre total de semestres charges et non celui de la page en cours, ce qui contredit la pagination affichee juste en dessous
- La page de detail n'offre aucune passerelle vers l'exploitation : pas de lien « creer les sessions de ce semestre » alors que POST /sessions/by-semestre existe, pas de lien vers les notes, bulletins ou presences filtres sur ce semestre
- La suppression passe par window.confirm et n'avertit d'aucune consequence : deleteSemestre supprime sans verifier l'existence de sessions rattachees, d'inscriptions ou de bulletins, contrairement aux garde-fous prevus pour les UE et les sessions
- Les libelles par defaut « Semestre 1..N » ne sont pas confrontes a l'existant : le conflit DUPLICATE_SEMESTRE n'apparait qu'apres soumission, et en creation groupee un echec sur le dernier bloc peut invalider tout le lot
- Le tableau de selection des UE n'est ni recherchable, ni filtrable, ni virtualise : sur une filiere a fort catalogue, chaque bloc semestre reaffiche l'integralite des UE, et la selection doit etre refaite manuellement bloc par bloc
- La colonne « ECUE » (nb_ecue), presente au tableau de creation, disparait dans le formulaire d'edition : information asymetrique entre les deux ecrans du meme objet
- Aucune indication qu'une UE est deja rattachee a un autre semestre de la meme filiere : rien n'empeche ni ne signale le doublon
- Les lignes de tableau sont cliquables (onClick sur <tr>) sans role, sans tabIndex ni gestion clavier : la selection est inaccessible au clavier et aux lecteurs d'ecran
- L'erreur de chargement des UE eligibles est traitee dans le formulaire de creation mais pas dans celui d'edition (seul isLoading y est gere) : un echec y produit un « Aucune UE disponible » trompeur
- Le detail ne signale pas les ECUE de type « Conduite » alors que l'API renvoie l'indicateur is_conduite, ni le caractere obligatoire / le coefficient des ECUE pourtant retournes
- Cartes a fond degrade avec texte blanc, et couleurs codees en dur (bg-gray-50, text-gray-600, from-gray-50 to-white) : contraste faible et absence de theme sombre
- Aucune action de masse (duplication d'un semestre vers une autre annee ou une autre filiere, suppression multiple) ni export de la maquette
- Les cartes KPI disparaissent pendant le chargement, provoquant un saut de mise en page, et aucun skeleton n'est propose

---

### 2.2 Sessions & Planning

#### 2.2.1 Sessions — `/professionnel/admin/sessions`

`apps/web/src/app/professionnel/admin/sessions/page.tsx` · clé menu `pro.sessions`

**À quoi sert la page**

Page centrale du Module Professionnel pour gerer les sessions d'UE : instances datees d'une UE rattachees a un semestre et a une filiere. Elle regroupe les sessions par « lot » (semestre + periode + libelle) et sert de point d'entree vers le detail d'un semestre, la creation en masse, l'edition, la reouverture et la suppression. Destinee a l'administrateur/proprietaire de l'ecole (garde requireAdmin cote API).

**Ce que la page permet de faire**

- Creer : bouton « Nouvelle session » → /professionnel/admin/sessions/new (aussi propose dans l'etat vide de l'onglet actives)
- Consulter un lot : icone Eye → /professionnel/admin/sessions/semestre/{semestre_id} si semestre connu, sinon /professionnel/admin/sessions/{first_id}
- Modifier un lot (uniquement si statut != termine) : icone Edit → page semestre ou /sessions/{first_id}/edit
- Rouvrir un lot termine : icone RotateCcw → window.prompt d'une nouvelle date de fin (format AAAA-MM-JJ, defaut J+30), validation regex + date strictement future, puis POST /professional/sessions/reopen sur tous les ids du lot
- Supprimer un lot : window.confirm listant le nombre de sessions impactees, puis boucle sequentielle de DELETE /professional/ue-sessions/{id} pour chaque session du lot (supports et presences lies inclus)

**Fonctionnalités présentes dans le code**

- Titre « Sessions professionnelles » + sous-titre « Instances datees d'une matiere, avec fenetre d'inscription et capacite »
- 2 cartes KPI degradees : « Total sessions » (nombre de lignes session brutes) et « Sessions ouvertes » (statut === 'ouvert')
- 2 onglets avec pastille de comptage : « Sessions actives » (groups.length - nbTermines) et « Historique (terminees) » (nbTermines) — le comptage porte sur les LOTS, pas sur les sessions
- Regroupement client en lots : cle = `${semestre_id ?? prefixe_libelle}|${date_debut}|${date_fin}` ; le suffixe « — UE_CODE » est retire du libelle pour former le titre du lot
- Grille de cartes (2 colonnes) : une carte par lot, fond en degrade dependant du statut (STATUT_GRADIENT : ouvert=vert/teal/bleu, en_cours=bleu/indigo/violet, complet=ambre/orange/rouge, brouillon=slate, termine=gris, annule=gris clair)
- Contenu de carte : titre du lot, badge de statut (Brouillon / Ouvert / Complet / En cours / Termine / Annule), ligne « filiere_nom (filiere_code) · semestre_libelle », ligne « Periode : jj/mm/aaaa → jj/mm/aaaa », ligne « {n} UE · {totalUv} credits » (somme de ue_nb_uv)
- Compteur textuel « N sessions affichees » dans la barre de filtres (somme des items des lots visibles)
- Pagination client 12 lots/page avec « Precedent / Suivant », « Page X / Y (N lots) » — affichee seulement si > 12 lots
- Etat de chargement dedie (spinner + « Chargement des sessions… »), etat d'erreur (AlertCircle + message), etat vide contextuel selon l'onglet (« Aucune session terminee » / « Aucune session active »)
- Bandeau d'erreur rouge en haut de page pour les erreurs de suppression/reouverture
- Derivation client de l'annee scolaire (pivot septembre) via anneeScolaireOf(date_debut) : >= septembre → « AAAA-AAAA+1 », sinon « AAAA-1-AAAA »

**Filtres, recherche, tri, pagination**

- Filtre « Filiere » (SearchableSelect avec recherche) : options deduites cote client des sessions chargees (filiere_code → « filiere_nom (code) »), + « Toutes les filieres »
- Filtre « Annee scolaire » (SearchableSelect) : visible uniquement dans l'onglet Historique, options derivees des lots termines de la filiere choisie, tri decroissant, + « Toutes les annees » ; auto-reset si l'annee choisie n'existe plus
- Onglets actives / historique (filtre implicite sur statut === 'termine')
- Pagination client 12 lots par page (PAGE_SIZE)
- Aucun champ de recherche texte (ni sur libelle, ni sur code UE)
- Aucun filtre par statut fin (brouillon / en_cours / annule) ni par semestre

**Données manipulées**

- professional_ue_sessions (libelle, date_debut, date_fin, inscription_ouverte_le, inscription_fermee_le, capacite_max, enseignant_id, classroom_id, statut)
- professional_ue (code, libelle, nb_uv)
- professional_semestre_sessions (jointure session ↔ semestre)
- professional_semestres (libelle, filiere_id)
- programmes (filiere : name, code)
- professional_enrollments (agregat nb_inscriptions_actives, statut <> 'annulee')

**Endpoints API appelés**

- GET /api/v1/professional/ue-sessions?pageSize=500 (via useProfessionalUeSessionsList — filtres serveur ue_id/statut/semestre_id/page/pageSize disponibles mais non utilises ici)
- POST /api/v1/professional/sessions/reopen (body { session_ids, date_fin })
- DELETE /api/v1/professional/ue-sessions/{id}

**Permissions / garde-fous**

Menu affiche uniquement si isAdmin (Sidebar.tsx, groupe « Sessions & Planning ») et selon le filtrage de menus par role. Cote API, toutes les routes /professional/ue-sessions* et /professional/sessions/* sont protegees par requireAdmin (roles admin, super_admin, administrateur) — professional-guards.ts. Aucune verification de role dans la page elle-meme.

**Statistiques déjà affichées**

- Carte « Total sessions » (nombre de sessions brutes chargees)
- Carte « Sessions ouvertes » (statut = ouvert)
- Compteur d'onglet « Sessions actives » (nombre de lots non termines)
- Compteur d'onglet « Historique (terminees) » (nombre de lots termines)
- Compteur « N sessions affichees » apres filtrage
- Par carte : « {n} UE · {totalUv} credits » et periode debut → fin

**Statistiques exploitables et aujourd'hui absentes**

- Taux de remplissage par lot/semestre : nb_inscriptions_actives / capacite_max, deja renvoye par l'API (professional_ue_sessions.capacite_max + agregat professional_enrollments) — actuellement aucun effectif n'est affiche sur les cartes
- Effectif total inscrit par filiere et par annee scolaire (professional_enrollments joint a professional_ue_sessions → programmes) : le proprietaire veut voir quelle filiere remplit
- Repartition des inscriptions par statut : en_attente_paiement vs confirmee vs terminee vs annulee (professional_enrollments.statut) — indicateur direct de cash en attente
- Taux d'annulation / d'abandon par session et par filiere (professional_enrollments.statut = 'annulee' / total)
- Nombre de sessions sans aucun inscrit (sessions ouvertes a effectif 0) — sessions a fermer ou a promouvoir (agregat existant nb_inscriptions_actives = 0)
- Sessions ouvertes dont des ECUE obligatoires n'ont pas d'enseignant (professional_session_ecue_teachers + professional_ue_ecue.est_obligatoire) : risque operationnel immediat, la donnee est deja calculee par transitionSessionStatus
- Volume de credits (UV) delivres par semestre / filiere / annee (somme de professional_ue.nb_uv sur les sessions terminees)
- Sessions arrivant a echeance dans les 30 jours (professional_ue_sessions.date_fin) — anticipation des bulletins et des reinscriptions
- Evolution du nombre de sessions et d'inscrits d'une annee scolaire a l'autre (date_debut pivot septembre, deja calcule cote client)
- Duree moyenne d'une session par filiere (date_fin - date_debut) pour comparer la charge des programmes

**Dettes UI/UX constatées**

- Le KPI « Total sessions » compte les lignes brutes alors que les onglets comptent les LOTS : deux unites differentes cote a cote, incoherence de lecture pour l'utilisateur
- Chargement en une seule requete pageSize=500, plafonnee cote service (Math.min(500, ...)) : au-dela de 500 sessions, la liste est silencieusement tronquee et tous les KPI/onglets deviennent faux, sans avertissement
- Toute la pagination, le regroupement et les filtres sont faits cote client alors que l'API expose deja statut / semestre_id / page / pageSize : chargement inutilement lourd
- Aucune recherche texte : impossible de retrouver une session par libelle ou par code UE, seule la filiere filtre
- Reouverture d'un lot via window.prompt natif (saisie de date en texte, validation regex maison) au lieu d'un date picker dans une modale — UX brute et non stylee
- Suppressions confirmees par window.confirm natif, sans modale de l'UI kit, et executees en boucle sequentielle (N appels DELETE) sans barre de progression ni resultat partiel : si l'appel 4/10 echoue, 3 sessions sont deja supprimees et l'utilisateur ne sait pas lesquelles
- Les cartes n'affichent ni effectif inscrit, ni capacite, ni enseignant, alors que nb_inscriptions_actives et capacite_max sont deja dans la reponse API
- Les boutons d'action ne sont que des icones sans libelle (seulement un attribut title) : aucune etiquette accessible (pas d'aria-label), lecteurs d'ecran penalises
- Texte blanc sur fond degrade colore pour tout le contenu des cartes : contraste faible sur les degrades clairs (ambre/orange), pas de mode sombre gere
- Le sous-titre de page promet « fenetre d'inscription et capacite » alors que ni l'une ni l'autre ne sont exposees dans l'UI (la capacite est forcee a null a la creation)
- Les etats desactives des boutons Supprimer/Rouvrir utilisent isPending global de la mutation : pendant une suppression, TOUTES les cartes voient leur bouton desactive et en spinner, pas seulement celle concernee
- Aucun etat « pas de filiere » ni squelette de chargement : passage brutal spinner → grille

---

#### 2.2.2 Salles de classe — `/academic/classrooms`

`apps/web/src/app/academic/classrooms/page.tsx` · clé menu `pro.classrooms`

**À quoi sert la page**

Referentiel des salles physiques de l'etablissement (nom, code, type, capacite, batiment, etage, equipements, statut). Ces salles alimentent le selecteur « Salle » de l'emploi du temps et de l'edition d'une session. Page transverse (route /academic) mais rattachee au groupe de menu « Sessions & Planning » du Module Professionnel.

**Ce que la page permet de faire**

- Creer une salle : bouton « Nouvelle salle » → /academic/classrooms/new (formulaire simplifie Nom + Code)
- Modifier : icone Edit sur la carte → /academic/classrooms/{id}/edit ; egalement modale d'edition depuis la page detail
- Supprimer : icone Trash2 → window.confirm puis DELETE ; l'API refuse (409) si des reservations actives existent ; erreur affichee via alert() natif avec message « Veuillez verifier que le serveur API est demarre »
- Reinitialiser tous les filtres depuis l'etat vide filtre
- Recharger la page en cas d'erreur de chargement
- Ajouter / retirer des equipements (predefinis ou personnalises) dans le formulaire complet

**Fonctionnalités présentes dans le code**

- Titre « Salles de classe » + sous-titre « Gerez les salles de classe et leurs reservations »
- 4 cartes KPI degradees, calculees cote client : « Total salles » (classrooms.length), « Disponibles » (status='disponible'), « Occupees » (status='occupe'), « Capacite totale » (somme des capacity)
- Grille responsive de cartes (1/2/3 colonnes) : chaque carte affiche UNIQUEMENT le nom de la salle et « Code: {code} » sur un degrade indigo→violet→rose identique pour toutes les salles
- Barre de recherche avec icone loupe et bouton X d'effacement
- Compteur « N salles trouvees / N salle trouvee » a droite des filtres
- Etat de chargement (spinner + « Chargement des salles... »), etat d'erreur plein ecran avec bouton « Reessayer » (window.location.reload)
- Deux etats vides distincts : « Aucune salle trouvee » (aucune salle du tout, CTA « Creer une salle ») et « Aucun resultat trouve » (filtres trop restrictifs, CTA « Effacer les filtres » + « Nouvelle salle »)
- Sous-route /academic/classrooms/new : formulaire ClassroomForm en mode `simplified` — seuls Nom et Code sont affiches ; type='salle_cours' et capacity=30 sont injectes en dur a la soumission
- Sous-route /academic/classrooms/[id] : page detail complete — badges statut + type, 4 cartes KPI (Capacite, Batiment, Equipements, Statut), carte « Informations generales » (Nom, Code, Type, Statut, Capacite, Batiment/Etage, Description), carte « Equipements » (liste), sidebar « Actions rapides » et « Informations supplementaires » (Localisation, Cree le), modale d'edition AcademicModal + ClassroomForm complet
- Sous-route /academic/classrooms/[id]/edit : page d'edition dediee avec ClassroomForm complet
- ClassroomForm complet : Nom*, Code*, Type* (8 options : Salle de cours, Amphitheatre, Laboratoire, Salle informatique, Atelier, Bibliotheque, Salle de reunion, Autre), Capacite*, Batiment, Etage, Statut (Disponible / Occupee / En maintenance / Hors service), case « Salle active », Description, et 20 equipements pre-definis a cocher (Tableau blanc, Projecteur, Ordinateur, Climatisation, WiFi, etc.) + ajout d'equipements personnalises avec puces supprimables

**Filtres, recherche, tri, pagination**

- Recherche texte cote client sur name, code et building
- Filtre « Type » (Select) : tous les types + les 8 valeurs de ClassroomType
- Filtre « Statut » (Select) : tous + disponible / occupe / maintenance / hors_service
- Filtre « Batiment » (Select) : affiche seulement si au moins un batiment renseigne, options deduites des salles chargees
- Requete serveur figee a { limit: 100, isActive: true } — pas d'UI pour desactiver ce filtre ni pour paginer
- Filtrage entierement client : les parametres serveur type/status/building/page existants ne sont pas utilises

**Données manipulées**

- classrooms (name, code, type, capacity, floor, building, description, equipment[], status, is_active, created_at, updated_at)
- classroom_reservations (title, start_datetime, end_datetime, reserved_by, course_id, class_id, status) — lue par l'API en includeReservations et bloquante a la suppression, mais jamais exposee dans l'UI

**Endpoints API appelés**

- GET /api/v1/classrooms?limit=100&isActive=true
- GET /api/v1/classrooms/{id} (+ ?includeReservations=true sur la page detail)
- POST /api/v1/classrooms
- PUT /api/v1/classrooms/{id}
- DELETE /api/v1/classrooms/{id}

**Permissions / garde-fous**

Aucune garde de role dans les routes API /api/v1/classrooms (pas de requireAdmin ni requireOwner) : l'isolation repose uniquement sur request.tenantId. Cote UI, l'entree de menu est reservee a isAdmin. Sur classroom-reservations, seul PUT verifie proprietaire-ou-admin et DELETE n'annule que ses propres reservations.

**Statistiques déjà affichées**

- Total salles
- Salles disponibles
- Salles occupees
- Capacite totale (somme des places)
- Compteur de resultats filtres
- Sur la page detail : Capacite, Batiment, nombre d'Equipements, Statut

**Statistiques exploitables et aujourd'hui absentes**

- Taux d'occupation reel des salles : heures programmees / heures ouvrables, calculable en croisant professional_emploi_temps (jour, heure_debut, heure_fin, classroom_id) avec classrooms — aujourd'hui aucune vue d'occupation n'existe
- Salles jamais utilisees sur la periode : classrooms sans aucune ligne dans professional_emploi_temps ni professional_ecue_seances ni classroom_reservations → actif immobilier dormant
- Adequation capacite / effectif : comparer classrooms.capacity a l'effectif de la session programmee dans la salle (professional_enrollments par ue_session_id via professional_emploi_temps.classroom_id) — detecte les salles trop petites ou surdimensionnees
- Repartition du parc par type et par batiment (classrooms.type, building) avec capacite cumulee par batiment
- Nombre de salles indisponibles (status = 'maintenance' ou 'hors_service') et capacite perdue associee — impact direct sur la capacite d'accueil
- Heures de pointe / creux par jour et par tranche horaire sur l'ensemble du parc (professional_emploi_temps agrege par jour + heure_debut)
- Conflits de reservation detectes : salles avec plusieurs creneaux d'emploi du temps se chevauchant (professional_emploi_temps auto-jointure sur classroom_id, jour et plages horaires)
- Taux d'equipement du parc : proportion de salles disposant d'un equipement donne (classrooms.equipment[]) — utile pour arbitrer les investissements
- Volume de reservations par mois et taux d'annulation (classroom_reservations.status, start_datetime) — table deja alimentee et jamais exploitee dans l'UI

**Dettes UI/UX constatées**

- Les cartes de la liste n'affichent QUE le nom et le code : ni type, ni capacite, ni statut, ni batiment, alors que ce sont precisement les 3 criteres de filtrage — l'utilisateur filtre sur des donnees qu'il ne voit pas
- La page detail /academic/classrooms/[id] est inaccessible depuis la liste : la carte porte `cursor-pointer` mais n'a aucun onClick de navigation, seuls Edit et Supprimer sont cliquables
- Bug dans /academic/classrooms/[id]/edit/page.tsx : `const { data: classroom } = useClassroom(classroomId)` renvoie l'enveloppe `{ data: Classroom }`, mais le code lit `classroom.name` et passe `initialData={classroom}` — le titre affiche « Modifiez les informations de » vide et le formulaire s'ouvre entierement vide au lieu d'etre pre-rempli (la page detail, elle, fait bien `classroomData?.data`)
- Toutes les cartes ont exactement le meme degrade indigo/violet/rose quel que soit le statut : aucun signal visuel pour distinguer une salle disponible d'une salle hors service
- Requete figee a limit=100 (plafond de l'API) sans pagination ni indicateur : au-dela de 100 salles la liste est silencieusement tronquee et les 4 KPI deviennent faux
- isActive: true est force sans possibilite de voir les salles archivees, alors que le formulaire propose une case « Salle active »
- Erreurs de suppression remontees par alert() natif avec un message technique (« verifiez que le serveur API est demarre »), et console.log de debug laisses dans le handler de suppression
- La suppression ne verifie cote API que classroom_reservations ; or professional_ue_sessions.classroom_id et professional_ecue_seances.classroom_id referencent classrooms SANS ON DELETE : supprimer une salle utilisee par une session ou une seance leve une violation FK (23503) non interceptee → 500 generique « Erreur lors de la suppression »
- Le sous-titre annonce « et leurs reservations » alors qu'aucun ecran de reservation n'existe : la table classroom_reservations et son endpoint /api/v1/classroom-reservations ne sont exposes nulle part dans l'interface
- Incoherence entre les deux chemins de creation : /new utilise le formulaire simplifie (Nom + Code, type et capacite injectes en dur a 'salle_cours' et 30) alors que la modale de la page detail utilise le formulaire complet — les salles creees ont donc toutes une capacite fictive de 30, ce qui fausse le KPI « Capacite totale »
- Deux chemins d'edition concurrents (page /edit et modale sur le detail) avec des comportements differents apres soumission (redirection vs fermeture de modale)
- Bouton « Reessayer » qui fait un window.location.reload complet au lieu d'un refetch React Query
- Aucune indication de tri : la liste suit l'ordre serveur (building, name) sans en-tete ni controle de tri visible
- Le PUT /classrooms/:id declare un schema de body qui liste `location` (colonne inexistante) et omet type, capacity, floor, building, status : la validation Fastify ne protege donc rien d'utile et la conversion camelCase→snake_case est faite a la main sur des cles arbitraires

---

#### 2.2.3 Planning des cours — `/professionnel/admin/planning`

`apps/web/src/app/professionnel/admin/planning/page.tsx` · clé menu `pro.planning`

**À quoi sert la page**

Construction et consultation de l'emploi du temps HEBDOMADAIRE d'un semestre du Module Professionnel : pour chaque ECUE d'une session, on declare le jour de la semaine, le creneau horaire, la salle et la periode de validite. Deux ecrans : la page principale (saisie en lot + grille editable) et /planning/consultation (lecture seule + export). Destinee a l'administrateur qui monte le planning d'une filiere.

**Ce que la page permet de faire**

- Ajouter une ligne-creneau brouillon (client)
- Retirer une ligne-creneau brouillon
- Enregistrer tous les creneaux en une fois : boucle sequentielle de POST /professional/emploi-temps (un appel par ligne), l'enseignant est repris de l'ECUE et la salle de la ligne
- Supprimer un creneau enregistre : DELETE /professional/emploi-temps/{id} au clic sur la poubelle de la case
- Exporter l'emploi du temps du semestre en Word (.docx) — desactive si aucun creneau
- Naviguer vers la consultation en lecture seule / revenir a l'edition

**Fonctionnalités présentes dans le code**

- Titre « Emploi du temps » + sous-titre expliquant la saisie en lot ; bouton « Consulter » vers /professionnel/admin/planning/consultation et bouton « Exporter en Word »
- Carte « Filiere et semestre » : SearchableSelect Filiere (uniquement les filieres ayant une session non annulee) puis SearchableSelect Semestre
- Bandeau de contexte : filiere_nom · libelle du semestre · « Du jj/mm/aaaa au jj/mm/aaaa » (min(date_debut) / max(date_fin) des sessions du semestre)
- Carte « Creneaux a enregistrer » : deux champs de dates communes (Date de debut / Date de fin) pre-remplies avec la periode du semestre, puis une liste de lignes-brouillon
- Chaque ligne-creneau comporte 5 selecteurs : ECUE (libelle « code — libelle », valeur composite `ue_session_id|ecue_id`), Jour (Lundi→Samedi), Debut (08H→19H), Fin (09H→20H), Salle (— Aucune — + toutes les salles) et un bouton poubelle « Retirer ce creneau »
- Sous chaque ligne, rappel « Enseignant : {nom} » repris automatiquement de l'affectation ECUE de la session, affiche en rouge, ou « — non affecte — »
- Bouton pleine largeur « Ajouter un creneau » et bandeau indigo « N creneaux a enregistrer » + bouton « Enregistrer N creneaux »
- Grille hebdomadaire des creneaux DEJA enregistres : colonne HORAIRES (08H–09H … 19H–20H) x 6 colonnes jours (LUNDI→SAMEDI), en-tetes indigo
- Fusion verticale (rowSpan) des cours couvrant plusieurs heures, plusieurs ECUE possibles dans une meme case (separateur horizontal entre elles)
- Couleur de fond de case stable par UE (palette de 10 couleurs, hachage du ue_code)
- Dans chaque case : libelle de l'ECUE en gras, nom de l'enseignant en rouge (ou « Non affecte » en gris), nom/code de la salle en bleu, et bouton poubelle rouge apparaissant au survol
- Export Word (.docx) via docx + file-saver : en-tete institutionnel (ministere, republique, institut), grille hebdomadaire avec fusion verticale et memes couleurs par UE
- Sous-route /planning/consultation : selecteurs Filiere (uniquement celles ayant deja un emploi du temps) → Annee scolaire (derivee du pivot septembre) → Semestre, affichage direct de la grille en lecture seule via le composant partage EmploiTempsGrid, bandeau de periode, bouton « Creer / modifier » et « Exporter en Word », messages « Selectionnez un semestre… » et « Aucun creneau pour cet emploi du temps »

**Filtres, recherche, tri, pagination**

- Selection Filiere puis Semestre (obligatoire pour afficher quoi que ce soit)
- Sur /consultation : filtre supplementaire « Annee scolaire » derive de la date de debut du semestre (pivot septembre), avec « Toutes les annees » et auto-reset si l'annee disparait
- La grille est bornee a 08H–20H et aux jours 1 a 6 (Lundi→Samedi)
- La liste de filieres est deja pre-filtree cote serveur : filieres avec sessions non annulees (edition) ou avec creneaux existants (consultation)
- L'API supporte un filtre serveur ?date_debut&date_fin sur la grille, non expose dans l'UI d'edition (la consultation charge tout, periode = null)

**Données manipulées**

- professional_emploi_temps (jour 1-7, heure_debut, heure_fin, date_debut, date_fin, ue_session_id, ecue_id, enseignant_id, classroom_id, created_by)
- professional_ue_sessions (periode, statut)
- professional_semestre_sessions / professional_semestres (libelle, filiere_id)
- professional_ue (code, libelle) et professional_ecue (code, libelle)
- professional_ue_ecue (rattachement ECUE↔UE, ordre)
- professional_session_ecue_teachers (enseignant affecte par ECUE)
- teachers (first_name, last_name)
- classrooms (name, code)
- programmes (filiere)

**Endpoints API appelés**

- GET /api/v1/professional/emploi-temps/filieres-open-sessions
- GET /api/v1/professional/emploi-temps/filieres/{id}/semestres-open-sessions
- GET /api/v1/professional/emploi-temps/filieres
- GET /api/v1/professional/emploi-temps/filieres/{id}/semestres
- GET /api/v1/professional/emploi-temps/semestre/{id} (+ ?date_debut&date_fin)
- GET /api/v1/professional/emploi-temps/semestre/{id}/ecue
- GET /api/v1/professional/emploi-temps/semestre/{id}/list (endpoint expose, non utilise par ces deux pages)
- POST /api/v1/professional/emploi-temps
- PATCH /api/v1/professional/emploi-temps/{id} (hook existant, non utilise dans l'UI)
- DELETE /api/v1/professional/emploi-temps/{id}
- GET /api/v1/classrooms?limit=100

**Permissions / garde-fous**

Toutes les routes /professional/emploi-temps/* sont protegees par requireAdmin (admin, super_admin, administrateur). Le service applique withTenant + RLS (policy professional_emploi_temps_tenant_isolation sur app.tenant_id). Cote UI, l'entree de menu n'est visible que pour isAdmin, mais aucune garde de role dans le composant lui-meme.

**Statistiques déjà affichées**

- Bandeau de periode du semestre (date de debut / date de fin agregees)
- Compteur « N creneau(x) a enregistrer » (brouillons non sauvegardes)
- Grille visuelle d'occupation hebdomadaire (lecture qualitative uniquement)
- Aucun compteur de creneaux enregistres, ni volume horaire, ni couverture

**Statistiques exploitables et aujourd'hui absentes**

- Volume horaire hebdomadaire par ECUE et par UE : somme de (heure_fin - heure_debut) sur professional_emploi_temps, a comparer au volume prevu — mesure la conformite du programme
- Charge hebdomadaire par enseignant : heures programmees par enseignant_id (professional_emploi_temps + teachers), avec detection des surcharges et des enseignants sous-employes
- Detection automatique des conflits : meme enseignant ou meme salle sur deux creneaux qui se chevauchent le meme jour (auto-jointure professional_emploi_temps sur enseignant_id / classroom_id) — aucune verification n'existe aujourd'hui a la creation
- Taux d'occupation des salles par tranche horaire et par jour (professional_emploi_temps.classroom_id x classrooms) : identifie les heures creuses et le besoin reel en salles
- Part des creneaux sans salle affectee et sans enseignant affecte (classroom_id IS NULL / enseignant_id IS NULL) — indicateur de planning incomplet avant la rentree
- Couverture du planning par semestre : nombre d'ECUE du semestre effectivement programmees / nombre total d'ECUE (professional_ue_ecue vs professional_emploi_temps) — combien de matieres n'ont pas encore d'horaire
- Nombre d'heures programmees par filiere et par semestre, pour comparer la charge reelle entre programmes (professional_emploi_temps joint a programmes via professional_ue.filiere_id)
- Densite du planning par jour de la semaine (repartition Lundi→Samedi) : detecte les journees surchargees et les samedis sous-utilises
- Ecart entre creneaux hebdomadaires planifies et seances reellement tenues (professional_emploi_temps vs professional_ecue_seances) — mesure du respect du planning
- Nombre d'etudiants impactes par creneau : effectif inscrit de la session portant le creneau (professional_enrollments par ue_session_id) — permet d'affecter les grandes salles aux gros effectifs

**Dettes UI/UX constatées**

- Aucune detection de conflit a l'enregistrement : createSlot ne verifie ni le chevauchement de salle, ni celui d'enseignant, ni celui d'ECUE — on peut reserver deux cours dans la meme salle a la meme heure sans aucun avertissement
- Enregistrement en boucle sequentielle de N POST sans transaction ni progression : si le 3e echoue, les 2 premiers sont deja crees, le message d'erreur est global et la liste `rows` n'est pas nettoyee partiellement
- Impossible de modifier un creneau existant depuis l'UI : seule la suppression est offerte alors que PATCH /emploi-temps/{id} et le hook useUpdateEmploiTempsSlot existent — il faut supprimer puis recreer
- Le bouton de suppression d'un creneau n'apparait qu'au survol (opacity-0 group-hover) : invisible au clavier et totalement inaccessible sur mobile/tactile
- Suppression d'un creneau sans aucune confirmation : un clic accidentel detruit la ligne immediatement
- La grille est bornee a 08H–20H et aux jours 1–6, alors que la base autorise jour 1 a 7 et n'importe quelle heure : un creneau du dimanche ou hors 8h-20h est enregistrable ailleurs mais devient invisible dans la grille et dans l'export Word
- La grille de la page principale est une copie integrale du composant EmploiTempsGrid (occ, UE_PALETTE, ueColor, teacherName, hourOf dupliques) : la consultation utilise le composant partage, l'edition non — les deux vues divergeront
- Le selecteur de salles charge useClassrooms({limit:100}) sans isActive et sans filtre de disponibilite : les salles hors service ou en maintenance sont proposees comme si elles etaient libres, et au-dela de 100 salles la liste est tronquee
- Les dates de validite sont communes a TOUS les creneaux saisis dans le lot : impossible de creer dans la meme passe un cours valable sur une sous-periode differente
- Les hooks useFilieresWithOpenSessions / useSemestresWithOpenSessions portent « open » dans leur nom mais filtrent en realite sur statut <> 'annule' : des semestres deja termines apparaissent dans les selecteurs de creation
- Les erreurs remontent dans un unique bandeau rouge en haut de page, sans mise en evidence de la ligne fautive parmi les N creneaux saisis
- La grille n'a ni scroll horizontal encapsule sur la page principale au-dela de overflow-x-auto sur la carte, ni version mobile : sur petit ecran les 7 colonnes deviennent illisibles et les lignes-creneaux (5 selects cote a cote) se replient mal
- Aucun etat vide explicite sur la page d'edition : quand le semestre n'a encore aucun creneau, une grille entierement vide s'affiche sans message d'accompagnement
- Aucune indication de sauvegarde reussie (pas de toast) : apres « Enregistrer », les lignes disparaissent simplement
- L'export Word contient un en-tete institutionnel code en dur (ministere, republique, « INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT ») alors que l'application est multi-tenant : tous les etablissements exportent l'en-tete d'un seul institut
- Sur /consultation, la selection annee scolaire est derivee cote client d'un pivot septembre reimplemente pour la troisieme fois dans le code (liste des sessions, consultation, service bulletins) : risque de divergence
- Les selects de la ligne-creneau n'ont pas de libelles associes accessibles (Label visuel sans htmlFor/id relie aux composants Select)

---

### 2.3 Étudiants

#### 2.3.1 Inscriptions — `/professionnel/admin/inscriptions`

`apps/web/src/app/professionnel/admin/inscriptions/page.tsx` · clé menu `pro.inscriptions`

**À quoi sert la page**

Ecran d'inscription EN LOT du Module Professionnel : l'admin coche N etudiants et M sessions (UE) et cree les N x M inscriptions en une seule operation, sans passer par le panier ni le paiement. Destine a la scolarite qui saisit les cohortes en debut de semestre. Chaque inscription creee est portee par une commande professional_orders en 'en_attente_paiement' et l'etudiant recoit (ou reutilise) son matricule professionnel de filiere.

**Ce que la page permet de faire**

- Selectionner une filiere (obligatoire pour voir des sessions)
- Cocher / decocher une session individuellement
- Tout cocher / tout decocher les sessions de la filiere affichee
- Rechercher un etudiant par nom ou matricule (filtrage client)
- Cocher / decocher un etudiant individuellement
- Tout deselectionner les etudiants
- Creer les inscriptions en lot (POST /enrollments/bulk) : creation de l'inscription + de la commande, attribution du matricule professionnel de filiere, synchronisation de la capacite de session
- Consulter le recapitulatif creees / ignorees / echecs et la liste des matricules attribues

**Fonctionnalités présentes dans le code**

- Titre 'Inscriptions' en degrade indigo/bleu avec icone UserPlus + sous-titre explicatif
- Bandeau d'erreur rouge (rounded-md border-red-300 bg-red-50) affiche au-dessus du formulaire
- Carte de resultat verte apres soumission : 'N inscription(s) creee(s)' avec icone CheckCircle2, mention '· N deja inscrit(s) (ignore(s))' en ambre si result.skipped > 0
- Bloc d'erreurs dans la carte resultat : 'N echec(s) :' avec les 3 premiers messages joints par ' · ' puis '…' (icone AlertTriangle)
- Bloc 'Matricules de la filiere' (icone Hash) dans la carte resultat : liste 2 colonnes prenom+nom / matricule en police mono indigo, alimente par result.matricules
- Grille 2 colonnes (lg) : carte 'Sessions (N)' a gauche, carte 'Etudiants (N)' a droite
- Carte Sessions : SearchableSelect de filiere (icone Layers, options derivees de sessions.filiere_code/filiere_nom), lien texte 'Tout cocher' / 'Tout decocher'
- Liste de sessions scrollable (max-h-80) regroupee par libelle de session/semestre : en-tete de groupe sticky en majuscules, puis une ligne par UE avec case a cocher, libelle de l'UE (ue_libelle) et sous-ligne 'Du JJ/MM/AAAA au JJ/MM/AAAA'
- Etats vides de la liste sessions : 'Selectionnez une filiere pour afficher ses sessions.', 'Chargement…', 'Aucune session'
- Ligne de session selectionnee surlignee (bg-primary/15)
- Carte Etudiants : champ de recherche avec icone loupe (placeholder 'Nom ou matricule…'), lien 'Tout deselectionner' visible des qu'un etudiant est coche
- Liste d'etudiants scrollable (max-h-80), une case a cocher par etudiant avec prenom + nom uniquement
- Plafond d'affichage STUDENT_VISIBLE_CAP = 120 etudiants, avec la ligne 'N de plus… affinez la recherche.'
- Etats vides etudiants : 'Chargement…', 'Aucun etudiant ne correspond a cette recherche.', 'Aucun etudiant inscriptible : tous ont deja une inscription en cours.'
- Barre de validation en bas : compteur 'X etudiant(s) × Y session(s) = Z inscription(s)' + bouton d'enregistrement
- Bouton 'Enregistrer les inscriptions' desactive tant que total = 0 ou pendant la mutation (spinner Loader2)
- Recherche etudiant purement client sur nom + studentNumber/establishmentMatricule des donnees deja chargees

**Filtres, recherche, tri, pagination**

- Filiere (SearchableSelect, options construites cote client a partir des sessions chargees)
- Recherche texte etudiant : nom complet ou matricule (client, sur la page de 1000 etudiants deja chargee)
- Filtre serveur implicite : withoutActiveProfessionalEnrollment=true (masque les etudiants ayant deja une inscription non annulee sur une cohorte non 'termine'/'annule')
- Aucune pagination, aucun tri, aucun filtre par statut de session ni par periode

**Données manipulées**

- professional_ue_sessions
- professional_ue
- professional_semestres / professional_semestre_sessions (libelle de semestre, filiere)
- programmes (filieres)
- student_profiles
- users
- professional_enrollments
- professional_orders
- professional_student_matricules

**Endpoints API appelés**

- GET /api/v1/professional/ue-sessions?pageSize=500 (adminListSessions — finalise aussi automatiquement les sessions dont date_fin est passee en statut 'termine')
- GET /api/v1/students?limit=1000&withoutActiveProfessionalEnrollment=true
- POST /api/v1/professional/enrollments/bulk (body { ue_session_ids, student_ids })

**Permissions / garde-fous**

API : POST /professional/enrollments/bulk et GET /professional/ue-sessions sont proteges par requireAdmin (roles 'admin', 'super_admin', 'administrateur') + contexte tenant obligatoire (apps/api/src/middlewares/professional-guards.ts). GET /api/v1/students n'a pas de garde de role explicite (auth + tenant seulement). Cote web : l'entree de menu est filtree par useAdminMenuAccess().canSeeHref('admin', href) et le bloc 'Module Professionnel' n'est rendu que si isAdmin (Sidebar.tsx) ; aucune garde de role au niveau de la page elle-meme (pas de layout.tsx sous /professionnel, apps/web/middleware.ts ne pose que des en-tetes CSP).

**Statistiques déjà affichées**

- Compteur de sessions selectionnees dans le titre de carte 'Sessions (N)'
- Compteur d'etudiants selectionnes dans le titre de carte 'Etudiants (N)'
- Calcul en direct 'X etudiant(s) × Y session(s) = Z inscription(s)'
- Post-traitement : nombre d'inscriptions creees, nombre d'inscriptions ignorees (deja inscrit), nombre d'echecs
- Liste des matricules professionnels attribues

**Statistiques exploitables et aujourd'hui absentes**

- Taux de remplissage par session : nb_inscriptions_actives / capacite_max — les deux champs sont deja renvoyes par GET /professional/ue-sessions (professional_ue_sessions.capacite_max) mais ne sont pas affiches
- Sessions ouvertes sans aucun inscrit / a moins de X% de remplissage, pour arbitrer l'ouverture ou l'annulation d'une cohorte (professional_ue_sessions + professional_enrollments)
- Volume d'inscriptions cree par jour / semaine / mois et par filiere (professional_enrollments.created_at + programmes)
- Nombre d'etudiants encore inscriptibles par filiere (GET /api/v1/students?withoutActiveProfessionalEnrollment=true) = vivier restant
- Chiffre d'affaires potentiel de la selection avant validation : somme des professional_ue.prix des sessions cochees × nombre d'etudiants (professional_ue.prix, deja utilise par adminEnrollStudent)
- Taux de doublons de la saisie en lot (skipped / total) pour mesurer la qualite du travail de scolarite (retour de POST /enrollments/bulk)
- Delai moyen entre l'ouverture des inscriptions (professional_ue_sessions.inscription_ouverte_le) et la date d'inscription effective (professional_enrollments.created_at)
- Nombre de sessions par filiere et par annee scolaire ouvertes a l'inscription (professional_ue_sessions.statut, date_debut)

**Dettes UI/UX constatées**

- Aucun garde-fou de volume : le bouton cree jusqu'a N x M inscriptions sans ecran de confirmation ni recapitulatif prealable, et la mutation boucle cote serveur (adminEnrollBulk appelle adminEnrollStudent une fois par couple) — risque de timeout sur les gros lots
- Sessions plafonnees a pageSize=500 en une seule requete, sans pagination : au-dela, des sessions disparaissent silencieusement de la liste
- Etudiants plafonnes a limit=1000 et recherche 100% cliente : un etudiant hors des 1000 premiers est introuvable, alors que l'API GET /students supporte le parametre search cote serveur
- Double plafond trompeur : la liste n'affiche que 120 etudiants (STUDENT_VISIBLE_CAP) avec un simple message texte, sans pagination ni virtualisation
- Selection de sessions non reinitialisee au changement de filiere : les ids restent coches mais invisibles, le compteur 'Sessions (N)' peut donc compter des sessions d'une autre filiere, et 'Tout cocher' ecrase la selection precedente (setSessionIds remplace au lieu de fusionner)
- La comparaison sessionIds.length === visibleSessions.length pour basculer le libelle 'Tout cocher'/'Tout decocher' est fausse des qu'une selection cross-filiere existe
- Aucun prix affiche : l'admin inscrit sans voir le montant qui sera du (professional_ue.prix n'est pas remonte par adminListSessions)
- Aucune capacite ni places restantes affichee alors que capacite_max et nb_inscriptions_actives sont deja dans la reponse API — sur-inscription possible a l'aveugle
- Aucun filtre sur le statut de session : des sessions 'termine' ou 'annule' apparaissent et peuvent etre cochees
- Les erreurs sont tronquees aux 3 premiers messages et n'identifient pas l'etudiant concerne (le payload contient student_id/ue_session_id, pas les noms) — impossible de reprendre les echecs
- La carte resultat n'est jamais reinitialisee lorsqu'on modifie la selection : un ancien resultat reste affiche pendant la saisie suivante
- Aucune redirection ni lien vers /professionnel/admin/inscrits apres succes pour verifier le lot cree
- Couleurs codees en dur (bg-red-50/text-red-700, border-green-300, text-indigo-600) hors tokens de theme : rendu incoherent en mode sombre
- Aucun etat de chargement global : les deux listes affichent seulement 'Chargement…' en texte, sans squelette ni desactivation du bouton pendant le chargement initial
- Listes de 500 sessions / 120 etudiants rendues dans un simple div overflow-y-auto sans virtualisation
- Accessibilite : cases a cocher sans label associe explicite (le texte est dans un span), pas d'aria-live sur la carte resultat, boutons 'Tout cocher' rendus en <button> stylise en lien

---

#### 2.3.2 Étudiants inscrits — `/professionnel/admin/inscrits`

`apps/web/src/app/professionnel/admin/inscrits/page.tsx` · clé menu `pro.inscrits`

**À quoi sert la page**

Annuaire de toutes les inscriptions du Module Professionnel, presente en cartes regroupees par binome etudiant + filiere (un meme etudiant dans deux filieres = deux cartes). Sert a la scolarite pour retrouver un inscrit, voir ses sessions/UE, l'etat de sa commande et ouvrir sa fiche detaillee. La fiche detaillee /professionnel/admin/inscrits/[id] (3 onglets Etudiant / Inscription / Session) permet de changer le statut et de supprimer l'inscription.

**Ce que la page permet de faire**

- Filtrer par filiere
- Filtrer par annee scolaire
- Rechercher un etudiant (nom, prenom, matricule, email)
- Ouvrir la modale de detail d'un binome etudiant + filiere
- Naviguer vers la fiche detaillee d'une inscription
- Changer le statut d'une inscription depuis la fiche (PATCH /enrollments/:id) — synchronise aussi le statut de la commande (payee / annulee / en_attente_paiement) et la capacite de session
- Supprimer une inscription depuis la fiche (DELETE /enrollments/:id, confirmation window.confirm) — supprime aussi la commande devenue vide
- Ouvrir la session liee depuis la fiche

**Fonctionnalités présentes dans le code**

- Titre 'Etudiants inscrits' en degrade indigo/bleu (icone Users) + sous-titre 'Toutes les inscriptions aux sessions du Module Professionnel.'
- Ecran de chargement plein page : spinner Loader2 centre sur min-h-[60vh]
- Carte de filtres : SearchableSelect 'Filiere' (icone Layers), SearchableSelect 'Annee scolaire' (icone Calendar), puis champ de recherche pleine largeur (placeholder 'Nom ou matricule…')
- Annee scolaire calculee cote client par pivot septembre a partir de session.date_debut ('AAAA-AAAA+1' si mois >= 9)
- Retour automatique a 'Toutes les annees' si la filiere change et que l'annee selectionnee n'existe plus
- Grille de cartes 1/2/3 colonnes, carte a fond degrade bleu->violet avec cercles decoratifs animes au survol
- Contenu de carte : prenom + nom, badge matricule en police mono sur fond blanc translucide, badge de statut cumule, ligne filiere (icone Layers) 'nom (code)', ligne 'N session(s) inscrite(s)', bouton 'Details' (icone Eye)
- Badge de statut cumule calcule par groupStatut : 'En attente paiement' (0 confirmee), 'Confirmee' (toutes confirmees/terminees) ou 'N/M confirmees'
- Etat vide : carte centree, pastille indigo avec icone Users, titre 'Aucune inscription' et message different selon qu'il n'y a aucune donnee ou aucun resultat de recherche
- Modale 'Details' (GroupDetailModal) titree '<Prenom Nom> — <code filiere>' : bloc d'entete Matricule / Filiere / Sessions inscrites / Email / Total du (somme des prix_unitaire)
- Dans la modale, une ligne par inscription : libelle UE + (code UE), sous-ligne libelle de session, badge de statut colore (En attente paiement ambre, Confirmee vert, Terminee bleu, Annulee gris)
- Grille de 8 informations par inscription : Debut, Fin, Cohorte (session_statut), Prix, Commande (order_reference, icone Receipt), Statut commande, Paye (montant_paye), Inscrit le (created_at)
- Lien 'Ouvrir la fiche complete de cette inscription ->' qui pousse vers /professionnel/admin/inscrits/[id]
- Modale generique fermable par clic sur l'arriere-plan ou bouton X, en-tete sticky
- FICHE [id] : bouton 'Retour', titre prenom+nom en degrade, badge matricule + badge de statut, bouton rouge 'Supprimer' avec window.confirm
- FICHE [id] : 3 onglets a soulignement indigo — Etudiant (GraduationCap), Inscription (CheckCircle2), Session (BookOpen)
- FICHE [id] onglet Etudiant : Prenom, Nom, E-mail, Sexe (Feminin/Masculin/—), Nationalite, Telephone, Date de naissance, Matricule (charges via GET /students/:id, avec spinner dedie)
- FICHE [id] onglet Inscription : Statut, Reference commande (mono), Prix de l'inscription, Statut de la commande, Montant total commande, Inscrit le + bloc 'Changer le statut' avec 4 boutons (En attente paiement / Confirmee / Terminee / Annulee), celui en cours desactive
- FICHE [id] onglet Session : Session, UE (code + libelle), Filiere, Periode 'debut -> fin', Statut de la session + bouton 'Ouvrir la session' vers /professionnel/admin/sessions/[ue_session_id]
- FICHE [id] : ecran d'erreur dedie 'Inscription introuvable.' avec bouton Retour

**Filtres, recherche, tri, pagination**

- Filiere (SearchableSelect, options derivees des inscriptions chargees)
- Annee scolaire (derivee cote client de date_debut, pivot septembre, options dependantes de la filiere, tri decroissant)
- Recherche texte : prenom, nom, matricule, email (filtrage client)
- Aucun filtre par statut d'inscription (alors que l'API GET /professional/enrollments accepte statut, ue_session_id, ue_id, student_id)
- Aucun tri configurable (tri fixe alphabetique nom+prenom), aucune pagination cote UI

**Données manipulées**

- professional_enrollments (statut, prix_unitaire, created_at, updated_at, order_id, ue_session_id)
- professional_orders (reference, statut, montant_total, devise)
- professional_payments (agregat montant_paye = somme des paiements 'confirme' de la commande)
- professional_ue_sessions (libelle, date_debut, date_fin, statut)
- professional_ue (code, libelle, filiere_id)
- programmes (filiere : name, code)
- student_profiles (student_number, gender, nationality, phone, date_of_birth)
- users (first_name, last_name, email)
- professional_student_matricules (matricule de filiere)

**Endpoints API appelés**

- GET /api/v1/professional/enrollments?page=N&pageSize=500 (appele en boucle par useAllAdminEnrollments jusqu'a epuisement, max 100 pages)
- GET /api/v1/professional/enrollments/:id (fiche detaillee)
- PATCH /api/v1/professional/enrollments/:id (body { statut })
- DELETE /api/v1/professional/enrollments/:id
- GET /api/v1/students/:id (onglet Etudiant de la fiche)

**Permissions / garde-fous**

API : GET/PATCH/DELETE /professional/enrollments* sont proteges par requireAdmin (admin, super_admin, administrateur) + tenant obligatoire. GET /api/v1/students/:id n'a pas de garde de role explicite. Cote web : visibilite du menu via useAdminMenuAccess().canSeeHref('admin', '/professionnel/admin/inscrits') et section rendue seulement si isAdmin ; la page et la sous-route [id] n'ont aucune garde de role propre (acces direct a l'URL rend la coquille, les appels API repondent 403).

**Statistiques déjà affichées**

- Compteur 'N session(s) inscrite(s)' par carte etudiant
- Badge de statut cumule par carte ('Confirmee', 'En attente paiement' ou 'N/M confirmees')
- Dans la modale de detail : nombre de sessions inscrites et 'Total du' (somme des prix_unitaire du binome)
- Par inscription dans la modale : prix, montant paye, statut de commande

**Statistiques exploitables et aujourd'hui absentes**

- Repartition des inscriptions par statut (en_attente_paiement / confirmee / terminee / annulee) en cartes KPI cliquables — professional_enrollments.statut, deja renvoye par GET /professional/enrollments
- Effectif distinct d'etudiants inscrits par filiere et par annee scolaire (COUNT DISTINCT student_id sur professional_enrollments joint a programmes et professional_ue_sessions.date_debut)
- Nombre moyen d'UE inscrites par etudiant et par filiere (professional_enrollments groupe par student_id)
- Taux d'annulation / d'abandon = inscriptions 'annulee' / total, par filiere et par session (professional_enrollments.statut)
- Taux d'achevement = inscriptions 'terminee' / (confirmee + terminee), indicateur de fin de cycle (professional_enrollments.statut)
- Evolution mensuelle des nouvelles inscriptions, avec comparaison a l'annee scolaire precedente (professional_enrollments.created_at)
- Liste et compteur des 'inscrits jamais payes' : montant_paye = 0 alors que statut = 'confirmee' (agregat professional_payments deja calcule par adminListEnrollments)
- Taux d'occupation par session/cohorte a partir des inscriptions non annulees vs professional_ue_sessions.capacite_max (GET /professional/ue-sessions)
- Repartition demographique des inscrits (sexe, tranche d'age, nationalite) — student_profiles.gender / date_of_birth / nationality, deja exposes par GET /api/v1/students
- Etudiants presents dans plusieurs filieres (COUNT DISTINCT filiere_id par student_id) — indicateur de vente croisee
- Anciennete des inscriptions non confirmees (age moyen en jours des 'en_attente_paiement') — professional_enrollments.created_at

**Dettes UI/UX constatées**

- Chargement integral cote client : useAllAdminEnrollments boucle sur des pages de 500 jusqu'a 100 pages (soit jusqu'a 50 000 lignes) avant le premier rendu, alors que l'API supporte deja les filtres filiere_id/statut/student_id et la pagination
- Toute la recherche, le filtrage filiere/annee et le regroupement sont recalcules cote client a chaque frappe sur l'ensemble du jeu de donnees
- Aucune pagination ni virtualisation des cartes : plusieurs centaines de cartes a fond degrade peuvent etre montees d'un coup
- Aucune carte KPI sur la page alors que toutes les donnees sont deja chargees (0 statistique affichee)
- Le composant EditModal et les etats editRow / updateMut / error / useStudent sont declares mais jamais rendus ni utilises dans page.tsx : code mort, et le changement de statut n'est atteignable que via la fiche [id]
- La constante STATUT_GRADIENT (degrade par statut) est definie mais jamais utilisee : toutes les cartes ont le meme degrade bleu/violet, le statut n'est donc pas lisible d'un coup d'oeil
- Imports inutilises dans page.tsx (Edit, AlertCircle, Phone, MapPin) et dans [id]/page.tsx (MapPin) — bruit de compilation
- Aucun filtre par statut d'inscription ni par session/UE, pourtant supportes par l'API
- Incoherence de calcul du 'Total du' : la modale somme prix_unitaire alors que la page Paiements somme order_montant — deux montants differents pour le meme etudiant
- Le badge de statut de la carte est affiche en blanc translucide sur degrade, ce qui annule le code couleur par statut defini dans STATUT
- Suppression d'inscription confirmee par un window.confirm natif (pas de modale applicative), et le message ne rappelle ni l'UE ni le montant deja paye
- Aucun export CSV/PDF de la liste des inscrits, aucune action en lot (changement de statut groupe, annulation groupee)
- Couleurs codees en dur (bg-red-50, bg-amber-100/text-amber-700, bg-indigo-50) hors tokens de theme : rendu incoherent en mode sombre
- La modale de detail se ferme au moindre clic sur l'arriere-plan, sans confirmation, et n'est pas fermable au clavier (pas de gestion de la touche Echap ni de piege de focus)
- Fiche [id] : aucun fil d'Ariane ni lien vers l'etudiant dans l'annuaire academique, et l'onglet Etudiant declenche une requete supplementaire par fiche ouverte
- Fiche [id] : le changement de statut ne demande aucune confirmation alors qu'il force le statut de la commande a 'payee' sans creer de ligne de paiement (ecart possible avec l'encaisse reelle)

---

#### 2.3.3 Paiements — `/professionnel/admin/paiements`

`apps/web/src/app/professionnel/admin/paiements/page.tsx` · clé menu `pro.paiements`

**À quoi sert la page**

Ecran de caisse du Module Professionnel : une carte par binome etudiant + filiere cumulant toutes ses UE, avec du / paye / reste. Permet d'enregistrer un paiement (total ou partiel, reparti automatiquement sur les inscriptions non soldees), de consulter l'historique des transactions dispatchees par semestre et d'editer/reimprimer le recu PDF de chaque transaction. Le premier paiement, meme partiel, confirme toutes les inscriptions du lot.

**Ce que la page permet de faire**

- Filtrer par filiere / annee scolaire / etat de reglement
- Rechercher un etudiant (nom, prenom, matricule)
- Deplier/replier les sessions d'une carte etudiant
- Ouvrir la modale de paiement d'un etudiant
- Enregistrer un paiement total ou partiel (POST /enrollments/pay) : creation d'une ligne professional_payments 'confirme' par commande avec numero de recu genere, mise a jour du statut de commande (payee / en_attente_paiement) et passage de toutes les inscriptions du lot en 'confirmee'
- Prefixer automatiquement le montant restant via le bouton 'Tout'
- Choisir le mode de paiement et saisir une reference de transaction
- Consulter l'historique des transactions par semestre
- Generer / reimprimer le recu de paiement au format PDF A4 (cote navigateur)

**Fonctionnalités présentes dans le code**

- Titre 'Paiements' en degrade indigo/bleu (icone Wallet) + sous-titre expliquant le cumul par etudiant
- Bandeau de 5 cartes KPI en degrade : Attendu (indigo), Encaisse (vert), Reste a payer (ambre), Etudiants (bleu), Confirmes (teal)
- Carte de filtres sur 2 rangees : filiere + annee scolaire en haut, selecteur de reglement + recherche etudiant en bas
- Selecteur 'Reglement' : Tous / Non regles / Partiels / Soldes
- Grille de cartes 1/2/3 colonnes avec liseré degrade en haut de carte
- Contenu de carte : prenom + nom, badge matricule mono indigo, badge d'etat (Solde vert avec CheckCircle2 / Partiel bleu / Non regle ambre), ligne 'filiere (code) · N UE'
- Trois tuiles de montants par carte : Du, Paye (vert), Reste (ambre), formates en FCFA
- Accordeons de sessions par carte (SessionAccordions) : un bloc repliable par libelle de session, avec compteur d'UE et chevron pivotant, deroulant la liste a puces des UE
- Bouton principal contextuel : 'Enregistrer un paiement' (degrade indigo) si reste > 0.5, sinon 'Voir les recus' (contour vert)
- Etat vide : pastille indigo icone Wallet, titre 'Aucune inscription', message 'Aucun etudiant ne correspond aux filtres.'
- Modale de paiement titree 'Paiement — Prenom Nom' : rappel filiere + nombre d'UE, 3 tuiles Du / Paye / Reste recalculees en direct depuis l'historique
- Detail par UE dans la modale : une ligne par inscription avec icone BookOpen, libelle UE et 'paye / du'
- Formulaire 'Nouveau paiement' : champ Montant (number) avec bouton 'Tout' qui prefixe le reste, selecteur Mode (Especes, Mobile Money, Virement bancaire, Autre), champ Reference optionnel, bouton 'Enregistrer le paiement'
- Bandeau vert 'Ce lot est entierement regle.' remplacant le formulaire quand le reste est nul
- Historique des paiements dispatche par semestre : un bloc par session avec en-tete 'libelle' et 'paye / du', puis la liste des transactions du plus recent au plus ancien
- Une transaction = toutes les lignes de paiement partageant le meme horodatage ; affichage montant + mode, sous-ligne 'numero de recu (+N) · date'
- Bouton 'Recu' par transaction qui genere et ouvre le PDF (openReceiptPdf, jsPDF + jspdf-autotable, logo et couleurs institut)
- Bloc 'Autres paiements' pour les lignes dont l'order_id ne correspond a aucune session identifiee
- Ouverture automatique du/des recus PDF juste apres l'enregistrement d'un paiement (un onglet par semestre credite)
- Exclusion silencieuse des UE dont le libelle commence par 'conduite' (isConduiteEnrollment) et des inscriptions 'annulee'
- Validation cliente du montant : refus si <= 0 ou s'il depasse le reste (message 'Le montant depasse le reste (X FCFA).')

**Filtres, recherche, tri, pagination**

- Filiere (SearchableSelect, options derivees des inscriptions chargees)
- Annee scolaire (derivee cote client de date_debut, pivot septembre, dependante de la filiere)
- Etat de reglement : Tous / Non regles / Partiels / Soldes (calcule cote client : reste <= 0.5 => solde, paye <= 0.5 => non regle)
- Recherche texte etudiant : prenom, nom, matricule (client)
- Aucune plage de dates sur les paiements, aucun filtre par mode de paiement, aucun tri, aucune pagination

**Données manipulées**

- professional_payments (montant, mode, reference_transaction, statut, paid_at, receipt_number, receipt_url, order_id)
- professional_orders (reference, montant_total, devise, statut)
- professional_enrollments (prix_unitaire, statut, order_id, ue_session_id)
- professional_ue_sessions (libelle, date_debut, date_fin, statut)
- professional_ue (code, libelle)
- programmes (filiere)
- student_profiles / users (identite, matricule)
- professional_student_matricules

**Endpoints API appelés**

- GET /api/v1/professional/enrollments?page=N&pageSize=500 (boucle useAllAdminEnrollments — fournit prix_unitaire, order_montant, montant_paye, order_id, order_statut)
- POST /api/v1/professional/enrollments/payments-history (body { enrollment_ids }) — retourne les lignes professional_payments du lot
- POST /api/v1/professional/enrollments/pay (body { enrollment_ids, montant, mode, reference_transaction })

**Permissions / garde-fous**

API : POST /professional/enrollments/pay, POST /professional/enrollments/payments-history et GET /professional/enrollments sont proteges par requireAdmin (admin, super_admin, administrateur) + tenant obligatoire. Cote web : menu filtre par useAdminMenuAccess().canSeeHref('admin', '/professionnel/admin/paiements') et bloc Module Professionnel rendu seulement si isAdmin ; aucune garde de role sur la page elle-meme. Aucune notion de caissier : professional_payments ne stocke pas l'utilisateur qui enregistre le paiement.

**Statistiques déjà affichées**

- Carte KPI 'Attendu' (somme des order_montant du perimetre filtre)
- Carte KPI 'Encaisse' (somme des montant_paye)
- Carte KPI 'Reste a payer'
- Carte KPI 'Etudiants' (nombre de binomes etudiant+filiere affiches)
- Carte KPI 'Confirmes' (nombre d'etudiants ayant au moins un paiement)
- Par carte : Du / Paye / Reste et badge d'etat de reglement
- Dans la modale : Du / Paye / Reste live, paye/du par UE, et paye/du par semestre dans l'historique

**Statistiques exploitables et aujourd'hui absentes**

- Taux de recouvrement global et par filiere, par semestre et par cohorte : somme(montant_paye) / somme(order_montant) — professional_payments + professional_orders (agregat deja calcule par adminListEnrollments)
- Courbe de tresorerie : encaissements par jour / semaine / mois (professional_payments.paid_at, statut='confirme')
- Repartition des encaissements par mode de paiement (professional_payments.mode : especes / mobile_money / virement / autre) — donnee stockee mais jamais agregee dans l'UI
- Balance agee des impayes : reste a payer ventile par anciennete (30/60/90 jours) a partir de professional_enrollments.created_at vs professional_payments.paid_at
- Top N des etudiants debiteurs et montant cumule du (professional_orders.montant_total - somme professional_payments)
- Delai moyen entre l'inscription et le premier paiement, par filiere (professional_enrollments.created_at vs MIN(professional_payments.paid_at))
- Panier moyen par etudiant et par filiere (professional_orders.montant_total / nombre d'etudiants distincts)
- Nombre moyen de versements par etudiant et part des dossiers en paiement echelonne (COUNT professional_payments par order_id)
- Reste a recouvrer par session/semestre, pour prioriser les relances avant le debut de cohorte (jointure paiement -> order -> enrollment -> professional_ue_sessions.date_debut)
- Encaissements du mois vs mois precedent et vs meme mois de l'annee scolaire precedente (professional_payments.paid_at)
- Montant bloque par les commandes forcees en 'payee' via un changement de statut d'inscription sans ligne de paiement (professional_orders.statut='payee' avec 0 professional_payments) — controle d'ecart de caisse
- Journal de caisse exportable : liste des recus emis sur une periode avec numero, montant, mode et etudiant (professional_payments.receipt_number)

**Dettes UI/UX constatées**

- Toute la page repose sur le chargement client de l'integralite des inscriptions (boucle de pages de 500) : KPI, filtres, regroupements et totaux sont calcules en memoire dans le navigateur, sans agregat serveur
- Aucune pagination ni virtualisation des cartes etudiants, chacune montant son propre composant d'accordeons a etat local
- Exclusion de la 'Conduite' basee sur une correspondance de chaine (libelle commencant par 'conduite', insensible a la casse) : renommer l'UE casse silencieusement la facturation
- Incoherence de calcul : le du utilise order_montant (total de la commande) alors que la page Inscrits utilise prix_unitaire — deux 'total du' differents pour le meme etudiant
- Incoherence sur le statut des paiements : paidLive ne compte que statut='confirme' tandis que buildTransactions compte aussi statut null, les totaux de l'historique peuvent donc differer des tuiles
- Aucune confirmation avant l'enregistrement d'un paiement, alors que l'operation est irreversible : ni annulation, ni remboursement, ni correction depuis l'UI (les statuts 'echoue' et 'rembourse' existent en base mais ne sont jamais exposes)
- Le recu PDF s'ouvre via window.open declenche avant l'appel reseau : bloque par les bloqueurs de pop-up, et en cas de plusieurs semestres credites les onglets supplementaires sont ouverts en 'meilleur effort' sans message si l'ouverture echoue
- Champ Montant en input number brut, sans separateur de milliers ni masque monetaire : risque eleve de saisie erronee sur des montants a 6 ou 7 chiffres
- Aucune tracabilite de l'operateur : professional_payments ne contient pas d'auteur, impossible de rattacher un encaissement a un agent
- Aucun filtre par periode ni par mode de paiement, aucun journal de caisse consolide, aucun export CSV/PDF des encaissements
- Les 5 cartes KPI ne sont pas cliquables et ne filtrent pas la liste
- Modale de paiement fermable au moindre clic sur l'arriere-plan y compris avec un montant saisi, sans confirmation de perte de saisie ; pas de gestion de la touche Echap ni de piege de focus
- Le bouton 'Voir les recus' ouvre la meme modale que le paiement : le libelle ne correspond pas exactement au contenu (formulaire masque mais entete de paiement conserve)
- Couleurs codees en dur (bg-green-50, bg-amber-100, text-indigo-600, degrades des StatCard) hors tokens de theme : contraste et coherence degrades en mode sombre
- Les accordeons de session sont tous replies par defaut et l'etat n'est pas conserve entre les rendus/filtrages
- Aucun indicateur de rafraichissement pendant la mutation en dehors du spinner du bouton : les cartes de la liste conservent les anciens montants tant que la requete d'invalidation n'a pas abouti

---

### 2.4 Suivi & Évaluation

#### 2.4.1 Présences — `/professionnel/admin/presences`

`apps/web/src/app/professionnel/admin/presences/page.tsx` · clé menu `pro.presences`

**À quoi sert la page**

Écran de consultation en lecture seule de l'historique complet des appels du Module Professionnel pour une filière : qui a pointé, quand, sur quelle ECUE, et combien d'heures d'absence chaque étudiant a cumulées. Destiné à l'administration (scolarité / direction des études) pour surveiller l'assiduité des étudiants et vérifier que les enseignants font bien l'appel. Aucune saisie de présence n'est possible ici (elle se fait par séance, ailleurs).

**Ce que la page permet de faire**

- Aucune action d'écriture : la page est strictement en lecture seule
- Sélectionner une filière (obligatoire pour déclencher la requête)
- Filtrer par année scolaire (calcul client)
- Filtrer par statut de session : Toutes les sessions / Sessions en cours / Sessions terminées
- Filtrer par semestre
- Rechercher en texte libre (filtrage client sur les deux tableaux)

**Fonctionnalités présentes dans le code**

- Bloc de filtres en 2 lignes de 2 SearchableSelect : Filière + Année scolaire (ligne 1), Statut des sessions + Semestre (ligne 2)
- L'année scolaire n'existe pas en base : elle est dérivée côté client de semestre.date_debut via anneeScolaireOf() avec pivot septembre (>= sept → AAAA-AAAA+1, sinon AAAA-1-AAAA)
- Réinitialisation automatique de l'année si elle disparaît (changement de filière) et désélection du semestre s'il sort du filtre année (2 useEffect)
- 4 cartes KPI en dégradé (composant local StatCard) : « Appels effectués » = X/Y (séances pointées / planifiées, indigo→bleu), « Heures pointées » (volume de cours avec appel, emeraude→vert), « Heures d'absence » (cumul de tous les étudiants, rouge→rose), « Taux de présence » = présents/pointages en % (ambre→orange)
- Champ de recherche unique (max-w-md, icône Search) filtrant SIMULTANÉMENT les deux tableaux
- Tableau 1 « Récapitulatif par étudiant » (en-tête sticky, max-h-[60vh], sous-titre « heures d'absence calculées sur la durée réelle des séances ») avec les colonnes : Étudiant (nom + matricule en police mono), Pointages, Présent (vert), Absent (rouge), Retard (ambre), Excusé (bleu), Heures d'absence, Taux de présence
- Colonne « Heures d'absence » rendue en badge pilule rouge (bg-red-100) si > 0h sinon vert, avec icône Clock et tooltip « + Xh excusées » quand heures_excusees > 0
- Colonne « Taux de présence » colorée par paliers codés en dur : vert si >= 80 %, ambre si >= 60 %, rouge en dessous
- Tableau 2 « Historique des appels » (en-tête sticky, max-h-[65vh], compteur « N séances · de la plus récente à la plus ancienne ») avec les colonnes : Date, Horaire · Durée, Matière (ECUE) avec l'UE en sous-ligne, Enseignant, Présents, Absents, Retards, Excusés, Appel
- Colonne Enseignant : affiche enseignant_nom, et une sous-ligne « appel : X » (10 px) quand marque_par diffère de l'enseignant titulaire
- Colonne « Appel » : badge de statut « Effectué » (vert) si nb_marques > 0, sinon « À faire » (ambre)
- Formatage FR maison : fmtHeures (4.5 → « 4h30 »), fmtDuree (minutes → heures), fmtDateFr (toLocaleDateString fr-FR), hm (HH:MM)
- État vide initial : carte centrée avec icône GraduationCap invitant à choisir une filière
- État de chargement : Loader2 animé centré ; état d'erreur : carte bordée rouge avec AlertCircle et le message de l'API

**Filtres, recherche, tri, pagination**

- Filière — SearchableSelect alimenté par useNotesFilieres() sans scope (label = name + code)
- Année scolaire — options dérivées côté client des date_debut des semestres, triées décroissant, plus l'option « Toutes les années »
- Statut des sessions — constante STATUT_OPTIONS : all / en_cours / terminee (transmis au serveur, « all » n'est pas envoyé)
- Semestre — useNotesSemestres(filiereId), restreint aux semestres de l'année sélectionnée, plus l'option « Tous les semestres »
- Recherche texte — filtrage CLIENT uniquement : sur les étudiants (first_name, last_name, matricule) et sur les séances (ecue_libelle, ue_libelle, enseignant_nom, marque_par)
- Aucun tri utilisateur : l'ordre est figé par le serveur (étudiants triés par heures_absence DESC puis nom ; séances par date DESC puis heure_debut DESC)
- Aucune pagination, aucune virtualisation

**Données manipulées**

- professional_ecue_seances (date, heure_debut, heure_fin, libelle, enseignant_id, ecue_id, ue_session_id)
- professional_ecue_attendance (statut present/absent/retard/excuse, marked_by, seance_id, student_id)
- professional_ue_sessions (statut, ue_id)
- professional_ue (libelle, filiere_id)
- professional_ecue (code, libelle)
- professional_semestre_sessions et professional_semestre_ue (les 2 chemins de liaison semestre ↔ session)
- professional_semestres
- teachers + users (nom de l'enseignant et de l'utilisateur ayant marqué l'appel)
- student_profiles (student_number = matricule) + users
- programmes (filières)

**Endpoints API appelés**

- GET /api/v1/professional/presences/history?filiere_id=&semestre_id=&statut= (hook usePresencesHistory)
- GET /api/v1/professional/notes/filieres (hook useNotesFilieres)
- GET /api/v1/professional/notes/semestres?filiere_id= (hook useNotesSemestres)

**Permissions / garde-fous**

Route API GET /presences/history protégée par preHandler requireAdmin — les enseignants n'y ont pas accès. Aucun garde-fou côté page (pas de layout.tsx sous /professionnel/admin, pas de useSession dans le composant) : la protection est purement serveur. L'entrée de menu est filtrée par canSeeAdmin('/professionnel/admin/presences') dans Sidebar.tsx, correspondant à la clé « pro.presences » du ADMIN_MENU_CATALOG (packages/contracts/src/admin-roles.schema.ts, groupe « Suivi & Évaluation »).

**Statistiques déjà affichées**

- Appels effectués : nb séances avec au moins un pointage / nb séances total
- Heures pointées : somme des duree_minutes des séances pointées, converties en heures
- Heures d'absence : cumul heures_absence de tous les étudiants
- Taux de présence global : total nb_present / total nb_appels, en %
- Par étudiant : nb_appels, nb_present, nb_absent, nb_retard, nb_excuse, heures_absence, taux de présence individuel
- Par séance : nb_present, nb_absent, nb_retard, nb_excuse, durée, statut de l'appel

**Statistiques exploitables et aujourd'hui absentes**

- Taux de présence exprimé EN HEURES et non en nombre de pointages — le champ heures_total est déjà renvoyé par l'endpoint /presences/history mais n'est jamais affiché (source : professional_ecue_attendance × professional_ecue_seances)
- Liste des étudiants à risque de décrochage : classement des étudiants dépassant un seuil paramétrable d'heures d'absence, avec alerte (source : students[].heures_absence de /presences/history)
- Taux d'appels réellement effectués PAR ENSEIGNANT — indicateur de discipline pédagogique très demandé par un propriétaire (source : seances[].enseignant_nom / marque_par + nb_marques)
- Courbe d'évolution hebdomadaire ou mensuelle du taux de présence sur le semestre (source : seances[].date + décomptes)
- Taux de présence par ECUE et par UE, pour repérer les matières désertées (source : seances[].ecue_libelle / ue_libelle)
- Volume horaire réellement dispensé vs volume planifié : somme des duree_minutes des séances pointées rapportée au total des séances (source : professional_ecue_seances.heure_debut/heure_fin)
- Analyse des retards et des absences par créneau horaire (les cours de 7h sont-ils désertés ?) (source : seances[].heure_debut + nb_retard)
- Comparatif du taux de présence entre filières et entre semestres — le même endpoint accepte déjà filiere_id et semestre_id, il suffit de boucler
- Corrélation assiduité / résultats : croiser heures_absence avec professional_ecue_results.moyenne pour démontrer l'impact des absences
- Nombre de séances planifiées jamais pointées, par enseignant et par UE (source : seances[] où nb_marques = 0)

**Dettes UI/UX constatées**

- Aucune action de sortie : pas d'export CSV/Excel, pas d'impression, pas de PDF du récapitulatif — un directeur ne peut rien emporter de cet écran
- Aucun tri cliquable sur les colonnes : l'ordre est imposé par le serveur (heures_absence DESC pour les étudiants, date DESC pour les séances)
- Le champ de recherche unique s'applique aux DEUX tableaux à la fois : chercher un nom d'enseignant vide entièrement le tableau « Récapitulatif par étudiant », et inversement
- Aucune pagination ni virtualisation : toutes les séances et tous les étudiants de la filière sont rendus dans le DOM (simple overflow + max-h), ce qui devient lourd sur un semestre complet
- Le champ heures_total renvoyé par l'API est totalement inexploité — le taux affiché reste un taux de pointages, moins parlant qu'un taux horaire
- Les heures excusées ne sont visibles que dans un attribut title (tooltip) du badge, donc invisibles au toucher sur mobile et non exportables
- Les seuils de couleur du taux de présence (80 % / 60 %) sont codés en dur dans le JSX, non paramétrables par l'établissement
- Aucun lien de navigation : impossible de cliquer sur un étudiant pour ouvrir sa fiche, ni sur une séance pour voir le détail des pointages nominatifs
- Le filtre de statut regroupe « terminée » et « annulée » (côté service : s.statut IN ('termine','annule')) sans permettre de les distinguer, alors qu'une session annulée n'a pas la même signification qu'une session terminée
- Aucune distinction visuelle entre une séance non pointée et une séance partiellement pointée (le badge ne connaît que « Effectué » dès nb_marques > 0)
- Couleurs codées en dur (bg-red-100, text-green-600, bg-muted/50, gradients blancs sur texte blanc) sans variante sombre : le rendu en thème sombre n'est pas maîtrisé
- Les deux tableaux ont des en-têtes sticky mais pas de colonne « Étudiant » figée horizontalement, contrairement aux pages Notes et Bulletins : incohérence de traitement entre écrans du même module
- Aucun état intermédiaire distinguant « aucune séance planifiée » de « séances planifiées mais aucun appel fait » — le message est le même : « Aucune séance pour cette sélection. »
- Aucun indicateur du nombre de résultats filtrés vs total quand une recherche est active sur le tableau des étudiants (le compteur n'existe que sur le tableau des séances)

---

#### 2.4.2 Conduite — `/professionnel/admin/conduite`

`apps/web/src/app/professionnel/admin/conduite/page.tsx` · clé menu `pro.conduite`

**À quoi sert la page**

Écran de SAISIE de la note de conduite /20, une par étudiant et par semestre, attribuée au vu du récapitulatif de présence affiché sur la même ligne. La note est techniquement portée par l'ECUE « Conduite » du semestre (nature « examen », note unique) et entre dans le calcul des moyennes et des crédits du semestre. Réservé à l'administration : c'est le pré-requis bloquant du calcul des notes et des bulletins.

**Ce que la page permet de faire**

- Saisir / modifier une note de conduite /20 (POST manual-note, nature « examen », note_max 20) — déclenché au blur ou sur Entrée
- Supprimer une note de conduite en vidant le champ (DELETE)
- Supprimer une note de conduite via le bouton corbeille de la ligne (DELETE)
- Sélectionner une filière puis un semestre
- Rechercher un étudiant
- Naviguer vers la page Notes (bouton d'en-tête et lien de bas de page)

**Fonctionnalités présentes dans le code**

- En-tête avec bouton de navigation « Notes » (icône ClipboardList) vers /professionnel/admin/notes
- Bloc de filtres à 2 SearchableSelect uniquement : Filière puis Semestre — pas de filtre année ni statut, la restriction étant faite côté API
- Note explicative sous les filtres (icône PlayCircle verte) : « Sont proposés les semestres encore en cours et ceux dont il reste au moins une conduite à saisir, même sessions terminées. Un semestre sans session créée n'apparaît pas. »
- Mécanisme withSelection() : mémorise filiereLabel/semestreLabel et réinjecte la sélection courante dans les options si l'API cesse de la renvoyer (ce qui arrive dès que la dernière conduite est saisie) — évite que l'écran se vide sous les yeux de l'utilisateur
- Bandeau d'avertissement ambre (AlertTriangle) quand semestreRow.nb_sessions_actives === 0 : « Sessions terminées pour ce semestre — il reste affiché tant que toutes les conduites ne sont pas saisies. »
- Carte d'erreur métier dédiée quand le semestre n'a pas d'UE « Conduite » : « Ce semestre n'a pas d'UE Conduite : impossible d'y rattacher une note. »
- 4 cartes KPI (StatCard local) : « Étudiants » (cohorte du semestre), « Conduites saisies » = X/Y, « Manquantes » (à saisir avant le calcul), « Moyenne conduite » (sur les notes saisies, 2 décimales à la virgule française)
- Champ de recherche étudiant (nom, prénom, matricule) filtrant côté client
- Tableau « Récapitulatif par étudiant » (en-tête sticky, max-h-[70vh]) reprenant à l'identique les colonnes de la page Présences : Étudiant, Pointages, Présent, Absent, Retard, Excusé, Heures d'absence (badge rouge/vert + tooltip heures excusées), Taux de présence (paliers 80/60)
- Dernière colonne « Conduite (/20) » mise en évidence (fond bg-amber-500/20 en en-tête, bg-amber-500/10 dans les cellules, bordure gauche, icône Star)
- Composant ConduiteInput par ligne : input type number min 0 max 20 step 0.25, largeur w-24, placeholder « — »
- Enregistrement automatique au blur (sortie du champ) ; la touche Entrée déclenche un blur() donc un enregistrement
- Vider le champ supprime la note existante (appel DELETE) ; si aucune note n'existait, aucune requête n'est envoyée
- Court-circuit si la valeur est inchangée (student.note === v → return)
- Indicateur d'état à droite de chaque champ : Loader2 animé pendant la mutation, puis CheckCircle2 vert pendant 2 s (flashSaved), sinon bouton Trash2 de suppression quand une note existe, sinon un espaceur invisible
- Validation client stricte 0..20 : hors bornes → bandeau d'erreur rouge global « La note de conduite doit être comprise entre 0 et 20. » et restauration de la valeur précédente
- Support de la virgule décimale (raw.replace(',', '.')) à la saisie
- La cohorte affichée provient de l'endpoint conduite (tous les inscrits du semestre) et est enrichie par le récapitulatif de présence : un étudiant sans aucun pointage reste listé avec des compteurs à zéro
- Note de bas de page rappelant que la note saisie s'affiche en lecture seule dans la colonne « Conduite (/20) » de la page Notes et entre dans les moyennes

**Filtres, recherche, tri, pagination**

- Filière — useConduiteFilieres() : uniquement les filières ayant au moins un semestre à finaliser (restriction serveur)
- Semestre — useConduiteSemestres(filiereId) : uniquement les semestres avec au moins une cohorte active OU au moins une conduite manquante
- Recherche étudiant — filtrage CLIENT sur first_name, last_name, matricule
- Aucun filtre par année scolaire, aucun filtre par statut de session, aucun tri, aucune pagination

**Données manipulées**

- professional_ecue_notes (nature = 'examen', note, note_max, ecue_id, ue_session_id, student_id) — support physique de la note de conduite
- professional_ecue (détection de l'ECUE Conduite par e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
- professional_ue_ecue (liaison UE ↔ ECUE)
- professional_ue_sessions et professional_ue
- professional_semestres, professional_semestre_sessions, professional_semestre_ue
- professional_enrollments (statut IN 'confirmee','terminee' — définit la cohorte)
- professional_ecue_attendance + professional_ecue_seances (récapitulatif de présence affiché)
- student_profiles (student_number = matricule) + users
- programmes (filières)

**Endpoints API appelés**

- GET /api/v1/professional/conduite/filieres (useConduiteFilieres)
- GET /api/v1/professional/conduite/semestres?filiere_id= (useConduiteSemestres)
- GET /api/v1/professional/semestres/:id/conduite (useSemestreConduite)
- GET /api/v1/professional/presences/history?filiere_id=&semestre_id= (usePresencesHistory, sans filtre statut)
- POST /api/v1/professional/ecue/:ecueId/manual-notes (useUpsertManualNote)
- DELETE /api/v1/professional/manual-notes/:id (useDeleteManualNote)

**Permissions / garde-fous**

Les 4 endpoints de lecture (conduite/filieres, conduite/semestres, semestres/:id/conduite, presences/history) sont en requireAdmin. En revanche les endpoints d'écriture utilisés par la saisie — POST /ecue/:ecueId/manual-notes et DELETE /manual-notes/:id — sont en requireAdminOrTeacher : un enseignant pourrait techniquement écrire une note de conduite via l'API, même s'il ne peut pas afficher cette page (la lecture lui est refusée). Aucun garde-fou de rôle côté composant. Menu filtré par canSeeAdmin('/professionnel/admin/conduite'), clé « pro.conduite » du ADMIN_MENU_CATALOG.

**Statistiques déjà affichées**

- Étudiants : effectif de la cohorte du semestre
- Conduites saisies : X/Y
- Manquantes : nombre de conduites restant à saisir
- Moyenne conduite : moyenne arithmétique des notes déjà saisies
- Par étudiant : pointages, présent, absent, retard, excusé, heures d'absence, taux de présence

**Statistiques exploitables et aujourd'hui absentes**

- Distribution (histogramme) des notes de conduite par filière et par semestre, pour repérer les notateurs anormalement généreux ou sévères (source : professional_ecue_notes nature 'examen' sur l'ECUE Conduite)
- Corrélation note de conduite / heures d'absence : mesurer si les conduites attribuées sont cohérentes avec l'assiduité réelle (sources croisées : /semestres/:id/conduite et /presences/history)
- Tableau de bord d'avancement de la saisie des conduites, tous semestres confondus — le compteur nb_conduites_manquantes est DÉJÀ agrégé par filière dans listConduiteFilieres mais n'est jamais affiché à l'écran
- Nombre et part d'étudiants sous la moyenne de conduite (< 10), qui invalident l'UE Conduite et donc bloquent la validation du semestre (source : professional_ecue_notes + logique de computeStudentBulletin)
- Délai moyen entre la fin des sessions d'un semestre et la saisie complète des conduites (source : professional_ecue_notes.created_at vs professional_ue_sessions.date_fin)
- Évolution de la moyenne de conduite d'une promotion d'un semestre à l'autre (source : professional_ecue_notes historisées par ue_session_id)
- Liste des semestres bloqués : ceux dont il ne manque qu'une poignée de conduites pour débloquer le calcul des bulletins (source : conduiteSemestreRows, champ nb_conduites_manquantes)

**Dettes UI/UX constatées**

- Aucune saisie en lot : pas de « tout à 15 », pas de copie vers le bas, pas de remplissage par défaut — une requête HTTP par étudiant, donc une classe de 60 étudiants = 60 allers-retours réseau
- Aucune navigation clavier verticale dans la colonne de saisie : Entrée provoque un blur (donc un enregistrement) mais ne passe pas au champ suivant, et les flèches haut/bas incrémentent la valeur numérique au lieu de changer de ligne
- Aucun garde-fou de navigation : quitter la page pendant qu'un champ est encore focalisé et non enregistré perd la saisie sans avertissement
- L'enregistrement est silencieux hors d'un flash de 2 s par ligne : aucun récapitulatif global du type « N conduites enregistrées », aucune trace visible du travail effectué
- Aucune traçabilité affichée : upsertManualEcueNote reçoit bien currentUserId côté API, mais ni l'auteur ni la date de saisie de la conduite ne sont montrés
- Les KPI (moyenne, manquantes, saisies) portent sur rows non filtrées alors que le tableau affiche filteredRows : quand une recherche est active, les cartes et le tableau ne parlent plus du même périmètre, sans aucun indicateur
- La détection de l'ECUE de conduite repose sur un ILIKE de libellé/code (`libelle ILIKE 'conduite%' OR code ILIKE '%EC-CON%'`) : une UE nommée autrement casse silencieusement la page, et le message d'erreur n'offre aucun lien direct vers la création de l'UE Conduite
- Aucune aide à la notation : les colonnes de présence sont affichées mais aucun barème, aucune note suggérée à partir des absences, aucun rappel du barème de l'établissement
- Aucun export (ni de la grille vierge à distribuer, ni de la grille remplie)
- Aucun tri par taux de présence ou par heures d'absence pour attaquer d'abord les cas problématiques
- Aucun aria-label ni label associé sur les inputs de note : le lecteur d'écran n'annonce que « spin button », la ligne étudiant n'est pas rattachée au champ
- Tableau non virtualisé (simple overflow + max-h-[70vh]) : une grande cohorte rend toutes les lignes ET tous les inputs contrôlés simultanément
- Couleurs codées en dur (bg-amber-500/10, bg-red-100, text-green-600, gradients) sans variante sombre
- Le bandeau d'erreur est global en haut de page : lors d'une saisie en bas d'un long tableau, l'utilisateur ne voit pas le message de refus (note hors bornes) et sa valeur est silencieusement restaurée
- Aucune confirmation avant la suppression d'une note via le bouton corbeille — le clic supprime immédiatement, sans annulation possible

---

#### 2.4.3 Notes — `/professionnel/admin/notes`

`apps/web/src/app/professionnel/admin/notes/page.tsx` · clé menu `pro.notes`

**À quoi sert la page**

Grille de saisie des notes du Module Professionnel : pour une UE (cohorte) donnée, un tableau croisé ECUE × étudiants où l'on saisit les notes de devoirs (multiples) et la note d'examen (unique), puis on lance le calcul des moyennes. Les notes issues des évaluations en ligne sont reprises automatiquement en lecture seule. Utilisée par l'administration et par les enseignants (limités à leurs ECUE affectées). La sous-route historique/ offre la même grille en consultation seule pour les cohortes terminées.

**Ce que la page permet de faire**

- Ajouter une note de devoir sur une ECUE (POST manual-note nature 'devoir', note_max 20) — bouton Plus ou touche Entrée
- Supprimer une note de devoir manuelle (DELETE, sans confirmation)
- Saisir / modifier la note d'examen d'une ECUE (POST manual-note nature 'examen', avec le champ session = 1 ou 2)
- Supprimer la note d'examen manuelle (DELETE, sans confirmation)
- Recalculer les résultats de la cohorte sélectionnée (POST /ue-sessions/:id/results/recompute)
- « Enregistrer et calculer » : force le blur du champ actif, attend la fin des mutations en cours (polling de qc.isMutating() toutes les 50 ms, 200 itérations max), puis lance le recalcul
- Basculer entre Session 1 (normale) et Session 2 (rattrapage)
- Naviguer vers l'Historique des notes, les Bulletins (admin) et la page Conduite
- Sous-page historique : consultation seule, aucune écriture possible

**Fonctionnalités présentes dans le code**

- Détection du rôle via useSession() next-auth : isAdmin = roles contient 'admin', 'super_admin' ou 'Administrateur' — conditionne la colonne Conduite et le bouton Bulletins
- En-tête avec 4 actions : lien « Historique », lien « Bulletins » (admin uniquement), bouton « Recalculer » (dégradé indigo→bleu)
- 3 SearchableSelect : Filière (scope=actives), Semestre (scope=actives), UE — placeholders contextuels (« Aucune filière en cours », « Choisir une filière », « Aucune UE »)
- Sélecteur de session LMD sous forme de 2 boutons segmentés : « Session 1 (normale) » (indigo) et « Session 2 (rattrapage) » (ambre), avec avertissement ambre en Session 2 : « Les notes d'examen saisies remplaceront celles de Session 1 »
- Filtrage CLIENT des UE proposées : exclusion des UE dont le libellé commence par « conduite », exclusion de celles sans inscrit (nb_inscrits = 0), exclusion des statuts 'termine' et 'annule'
- Bandeau rouge bloquant « Calcul bloqué — N étudiant(s) sans note de conduite, alors qu'elle entre dans les moyennes du semestre » + lien direct « Saisir les conduites »
- Barre d'action flottante juste au-dessus du tableau avec le bouton principal « Enregistrer et calculer » et le message de succès « Enregistré et calculé » (CheckCircle2 vert, 3 s)
- Grille à double en-tête : ligne 1 = une ECUE sur 3 colonnes (code en mono + libellé + « N cr. »), ligne 2 = les sous-colonnes « Devoirs (/20) », « Examen (/20) », « Note »
- Colonne « Étudiant » figée à gauche (sticky left-0 z-30) affichant nom + matricule en mono ; en-têtes figés en haut (sticky top-0 et top-14)
- Colonne « Conduite (/20) » figée à droite sur fond ambre (admin + conduite existante), avec sous-lien « saisie sur la page Conduite »
- Bandeau de titre de carte : libellé de l'UE + « N ECUE · N étudiants · conduite incluse »
- Cellule Devoirs (DevoirsCell) : pastilles grises pour les notes d'évaluations (icône BookOpen, tooltip « titre — évaluation en ligne / sujet unique / IA » via EVAL_FMT), pastilles indigo pour les notes manuelles avec bouton Trash2, puis un input « + note » (w-20) et un bouton Plus ; Entrée ajoute le devoir
- Cellule Examen (ExamenCell) : input unique enregistré au blur, badge « S2 » ambre si la note vient du rattrapage, marqueur « m » (bleu, note manuelle) ou « éval » (gris, note d'évaluation), bouton Trash2
- Verrouillage du rattrapage : en Session 2, si la moyenne de l'ECUE est déjà >= 10, la cellule Examen devient non éditable et affiche la note + un badge vert « validé »
- En Session 2 les cellules Devoirs passent en readOnly (les devoirs de Session 1 sont conservés mais non modifiables, seul l'examen se repasse)
- La note d'examen retenue est celle de la session la plus élevée (examenOf fait un reduce sur n.session)
- Cellule Note (NoteCell) : badge coloré selon la table ECUE_STATUT — Validé (vert), Compensé (bleu), Insuffisant (ambre), Éliminatoire (rouge), En attente (gris)
- Cellule Conduite (ConduiteCell) en lecture seule : badge ambre avec la note, ou badge « Non saisie » avec AlertTriangle
- Filtrage des lignes en Session 2 : seuls les étudiants ayant au moins un ECUE avec result.validee === false sont affichés ; message dédié « Aucun ECUE à rattraper dans cette UE : tous les étudiants ont validé »
- Légende de bas de page rappelant la formule (moyenne devoirs × 0,4 + examen × 0,6) et les repères « m » / « éval »
- Cascade d'états vides distincts : pas d'UE choisie, chargement, « Aucun étudiant inscrit (confirmé) dans cette UE », « Cette UE n'a pas d'ECUE (hors Conduite) », « Aucun ECUE à rattraper »
- SOUS-PAGE historique/ (apps/web/src/app/professionnel/admin/notes/historique/page.tsx) : 4 filtres (Filière scope=terminees, Année scolaire dérivée client, Semestre scope=terminees, UE filtrée sur statut termine/annule), grille en lecture seule Devoirs / Examen / Note avec badge S2, bouton « Retour à la saisie », légende de bas de page

**Filtres, recherche, tri, pagination**

- Filière — useNotesFilieres('actives') sur la page de saisie ; useNotesFilieres('terminees') sur l'historique
- Semestre — useNotesSemestres(filiereId, 'actives' | 'terminees')
- UE (cohorte) — useSemestreSessions(semestreId), puis filtrage CLIENT (hors conduite, nb_inscrits > 0, statut ouvert sur la saisie / statut termine|annule sur l'historique)
- Session de saisie : Session 1 / Session 2 (état local, filtre aussi les lignes affichées)
- Année scolaire — UNIQUEMENT sur la sous-page historique, dérivée côté client de date_debut (pivot septembre)
- AUCUN champ de recherche par étudiant, ni sur la page de saisie ni sur l'historique
- Aucun tri, aucune pagination

**Données manipulées**

- professional_ecue_notes (nature devoir|examen, note, note_max, session 1|2, libelle, created_at)
- professional_ecue_results (moyenne, moyenne_devoirs, note_examen, eliminee, note_source, validee, validee_manuellement)
- professional_ecue et professional_ue_ecue (code, libellé, crédits, ordre, est_obligatoire)
- professional_ue et professional_ue_sessions (statut, date_debut, date_fin)
- professional_enrollments (statut confirmee|terminee)
- professional_assignments + professional_assignment_submissions (notes d'évaluations reprises : titre, type, evaluation_type online|pdf|ai_generated, note)
- professional_session_ecue_teachers + teachers (affectation enseignant ↔ ECUE, base du scoping)
- professional_semestres, professional_semestre_sessions, professional_semestre_ue
- student_profiles + users
- programmes (filières)

**Endpoints API appelés**

- GET /api/v1/professional/notes/filieres?scope=actives|terminees
- GET /api/v1/professional/notes/semestres?filiere_id=&scope=actives|terminees
- GET /api/v1/professional/semestres/:id/sessions
- GET /api/v1/professional/ue-sessions/:id/grid
- GET /api/v1/professional/semestres/:id/conduite (admin uniquement)
- POST /api/v1/professional/ecue/:ecueId/manual-notes
- DELETE /api/v1/professional/manual-notes/:id
- POST /api/v1/professional/ue-sessions/:id/results/recompute

**Permissions / garde-fous**

Écran mixte admin / enseignant. Les endpoints de grille et de notes (/ue-sessions/:id/grid, /ecue/:ecueId/manual-notes, /manual-notes/:id, /ue-sessions/:id/results/recompute, /notes/filieres, /notes/semestres, /semestres/:id/sessions) sont en requireAdminOrTeacher. Pour un enseignant, le service restreint les données : listNotesFilieres/listNotesSemestres/listSemestreSessions filtrent par professional_session_ecue_teachers, et getSessionGrid ne renvoie que les ECUE qui lui sont affectées dans la cohorte. En revanche /semestres/:id/conduite est en requireAdmin, d'où le test isAdmin côté page qui masque la colonne Conduite aux enseignants. Menu : clé « pro.notes » (groupe Suivi & Évaluation) pour l'admin et clé « teacher.notes » pour l'enseignant, toutes deux pointant vers la même route.

**Statistiques déjà affichées**

- Compteur d'en-tête de carte : nombre d'ECUE et nombre d'étudiants de la cohorte (+ mention « conduite incluse »)
- Nombre d'étudiants sans note de conduite (dans le bandeau bloquant)
- Note calculée par ECUE et par étudiant, avec statut coloré (validé / compensé / insuffisant / éliminatoire / en attente)
- Aucune carte KPI : contrairement aux pages Présences, Conduite et Bulletins, cet écran n'affiche AUCUN indicateur agrégé

**Statistiques exploitables et aujourd'hui absentes**

- Taux d'avancement de la saisie des notes par UE, par ECUE et par enseignant, pour relancer nommément les retardataires (sources : professional_ecue_notes + professional_session_ecue_teachers)
- Taux de réussite par ECUE et par UE, pour identifier les matières qui font échouer la promotion (source : professional_ecue_results.validee)
- Part de notes éliminatoires (< 5) par ECUE — ces notes bloquent toute l'UE sans compensation (source : professional_ecue_results.eliminee)
- Écart moyen entre moyenne de devoirs et note d'examen par ECUE : un écart massif signale un examen mal calibré ou un contrôle continu trop généreux (source : professional_ecue_results.moyenne_devoirs vs note_examen)
- Part des notes issues d'évaluations numériques vs saisies manuellement — mesure directe de l'adoption de la plateforme par les enseignants (sources : professional_assignment_submissions vs professional_ecue_notes)
- Volume de rattrapages par ECUE et par filière : nombre de notes d'examen enregistrées en session 2 (source : professional_ecue_notes.session = 2)
- Comparaison de la sévérité des enseignants : moyenne et dispersion des notes attribuées, par enseignant (sources : professional_session_ecue_teachers + professional_ecue_notes)
- Délai entre la fin d'une session et la saisie complète de ses notes (sources : professional_ecue_notes.created_at vs professional_ue_sessions.date_fin)
- Nombre d'ECUE encore « en attente » (examen non saisi) bloquant le calcul du bulletin, par semestre (source : professional_ecue_results.moyenne IS NULL)
- Répartition des types d'évaluation utilisés — en ligne / sujet unique PDF / généré par IA (source : professional_assignments.evaluation_type)

**Dettes UI/UX constatées**

- BUG CONFIRMÉ dans apps/web/src/app/professionnel/admin/notes/historique/page.tsx : les cellules lisent `fmt(d.valeur)` (ligne 344) et `fmt(examen.valeur)` (ligne 351) alors que GET /ue-sessions/:id/grid renvoie le champ `note` (`note::float8 AS note` dans getSessionGrid). Les colonnes « Devoirs (/20) » et « Examen (/20) » de la page Historique affichent donc TOUJOURS « — ». La page de saisie, elle, utilise correctement `d.note`.
- Aucun champ de recherche par étudiant sur la grille de saisie ni sur l'historique, alors que les pages Présences, Conduite et Historique des bulletins en ont un — incohérence forte du module
- La grille s'étend horizontalement de 3 colonnes par ECUE sans virtualisation : une UE à 6 ECUE = 19 colonnes, avec seulement un overflow-x-auto pour naviguer
- La logique de « Enregistrer et calculer » repose sur un blur forcé suivi d'un polling de qc.isMutating() toutes les 50 ms borné à 200 itérations (10 s) : heuristique fragile, et si le garde-fou expire, le recalcul part quand même sur des données potentiellement incomplètes sans le signaler
- Le champ « + note » des devoirs n'applique AUCUNE borne : addDevoir ne fait qu'un parseFloat + isNaN (les attributs min/max de l'input ne bloquent pas une saisie/collage), et côté serveur CreateEcueManualNoteSchema n'a que `note: z.number().min(0)` sans maximum — une note de 45/20 est acceptée, contrairement à la conduite qui borne bien 0..20 côté client
- Aucune confirmation avant suppression : les boutons Trash2 des devoirs et de l'examen suppriment immédiatement, sans annulation possible
- Aucun import Excel/CSV des notes ni export de la grille — la ressaisie manuelle est le seul chemin
- Aucune traçabilité affichée : ni l'auteur ni la date de saisie/modification d'une note, alors que l'API reçoit bien currentUserId
- La clé ECUE_STATUT.compense (badge bleu « Compensé ») est déclarée mais INATTEIGNABLE dans NoteCell : la logique locale ne produit que eliminatoire / valide / insuffisant / en_cours, alors que le statut « compensé » est bien calculé côté API (evaluerUe). L'utilisateur ne voit jamais qu'une ECUE a été rattrapée par compensation.
- Le filtrage des UE (hors conduite, nb_inscrits > 0, statut) est fait côté CLIENT après téléchargement : le sélecteur peut afficher « Aucune UE » alors que le semestre en contient, sans expliquer pourquoi elles ont été écartées
- Aucun aria-label sur les inputs de devoirs et d'examen : dans une grille de 19 colonnes, un lecteur d'écran ne peut pas rattacher un champ à son couple étudiant × ECUE
- Couleurs et fonds codés en dur (bg-amber-500/10, bg-muted/60, bg-indigo-50, sticky bg-background) sans variante sombre ; les cellules sticky s'appuient sur des fonds opaques fixes
- La page reste accessible aux enseignants mais rien n'indique visuellement que leur grille est restreinte à leurs ECUE affectées — un enseignant peut croire que l'UE n'a que 2 ECUE
- Aucun indicateur de progression de la saisie (X notes sur Y attendues) alors que c'est l'information la plus utile sur cet écran
- Sur la sous-page Historique, aucune carte KPI ni aucun récapitulatif : simple grille, alors qu'il s'agit de données figées idéales pour un bilan

---

#### 2.4.4 Bulletins — `/professionnel/admin/bulletins`

`apps/web/src/app/professionnel/admin/bulletins/page.tsx` · clé menu `pro.bulletins`

**À quoi sert la page**

Écran de pilotage des bulletins de semestre : liste des étudiants d'un semestre avec moyenne, crédits, décision de jury et statut LMD, puis génération et consultation des bulletins en PDF (relevé LMD standard et variante « style BTS » pour les Licence 1/2). La sous-route historique/ propose une vue croisée étudiants × semestres de tous les bulletins générés d'une filière, avec le statut global de la filière.

**Ce que la page permet de faire**

- Générer (ou régénérer) les bulletins officiels de tous les étudiants du semestre (POST /semestres/:id/bulletins/generate) — sans confirmation préalable
- Recalculer les résultats de toutes les cohortes du semestre (POST /semestres/:id/bulletins/recompute, qui boucle sur recomputeSessionResults)
- Ouvrir le PDF combiné de tous les bulletins du semestre dans un nouvel onglet (génération client jsPDF)
- Consulter le relevé de notes PDF d'un étudiant dans un nouvel onglet (openBulletinPdf)
- Consulter le bulletin de style BTS d'un étudiant dans un nouvel onglet (openBulletinBtsPdf), réservé aux Licence 1 et 2
- Sélectionner une filière puis un semestre
- Naviguer vers l'Historique des bulletins et vers la Saisie des notes
- Historique : sélectionner une filière et une année scolaire, rechercher un étudiant, ouvrir un bulletin via le lien « Consulter » (target=_blank)
- Aucune action d'envoi (email / WhatsApp), aucune publication vers l'espace étudiant ou parent depuis cet écran

**Fonctionnalités présentes dans le code**

- En-tête avec 5 actions : lien « Historique », bouton « Tous les bulletins », lien « Saisie des notes », bouton « Recalculer », bouton principal « Générer les bulletins » (dégradé indigo→bleu)
- 2 SearchableSelect : Filière (useNotesFilieres sans scope) et Semestre (useProfessionalSemestres filtré côté client sur nb_sessions > 0)
- Bandeau d'erreur rouge et bandeau de succès vert (genInfo) affichant « N bulletin(s) généré(s) — X définitif(s), Y provisoire(s) »
- 4 cartes KPI en dégradé (StatCard local) : Étudiants (indigo→bleu), Admis (vert→émeraude), Rattrapage (ambre→orange), Ajournés (rouge→rose), calculées à partir du champ decision
- Tableau du roster à 8 colonnes : Étudiant, Matricule (mono), Moyenne (2 décimales, virgule française), Crédits (credits_valides/credits_total), Décision, Statut bulletin, Généré le, Bulletin
- Colonne Décision : badge pilule via la table DECISION — « Admis » vert avec CheckCircle2, « Rattrapage » ambre avec AlertTriangle, « Ajourné » rouge avec XCircle
- Colonne « Statut bulletin » : badge dérivé de statut_etudiant — « Validé » (vert), « Non validé — Session 2 » (ambre), « En dette » (rouge)
- Colonne « Généré le » : date de génération du bulletin au format fr-FR, ou « — »
- Bouton « Consulter » par ligne : ouvre le relevé de notes en PDF (jsPDF) dans un nouvel onglet, avec spinner pendant le chargement (busyStudentId)
- Bouton « Bulletin BTS » par ligne (icône Award), affiché UNIQUEMENT si isLicenceUnOuDeux(filiere.name) — regex /licence\s*[12]\b/i sur le nom de la filière
- Gestion des pop-ups : l'onglet est ouvert de façon SYNCHRONE avant le fetch, et si window.open renvoie null, un message explicite invite à autoriser les pop-ups ; l'onglet est refermé en cas d'erreur
- « Tous les bulletins » : récupère les bulletins complets du semestre (fetchFullBulletins) et construit un PDF combiné côté client (openAllBulletinsPdf), avec message dédié si la liste est vide
- États : carte vide avec icône FileSpreadsheet, spinner Loader2 plein écran, « Aucun étudiant inscrit sur ce semestre. »
- SOUS-PAGE historique/ (apps/web/src/app/professionnel/admin/bulletins/historique/page.tsx) : filtres Filière + Année scolaire (options libellées « 2025-2026 · en cours / terminée »), recherche étudiant, 3 cartes KPI (Étudiants, Bulletins générés, Filière validée)
- Historique — tableau croisé : colonne Étudiant figée à gauche, une colonne par semestre de la période (en-tête portant le libellé + badge « terminé » gris ou « en cours » émeraude), plus une colonne finale « Statut filière »
- Historique — cellule de semestre : moyenne, « X/Y cr. », badge « Définitif » (vert) ou « Provisoire » (ambre, tooltip « en attente de Session 2 »), mention « généré le JJ/MM/AAAA », lien « Consulter » (nouvel onglet) ; « Non généré » sinon
- Historique — colonne « Statut filière » calculée par filiereStatus() : « Filière validée » (vert, tous les bulletins définitifs et tous les crédits acquis), « Crédits incomplets » (rouge), « En cours » (ambre) ou « — », avec le détail « N/M crédits »
- Historique — légende de bas de page explicitant les 3 statuts de filière
- SOUS-ROUTE [studentId]/ : le fichier apps/web/src/app/professionnel/admin/bulletins/[studentId]/page.tsx existe mais est VIDE (0 octet), commité tel quel — aucune page n'y est implémentée

**Filtres, recherche, tri, pagination**

- Filière — useNotesFilieres() sans scope (filières ayant au moins un étudiant inscrit)
- Semestre — useProfessionalSemestres({ filiere_id }), filtré CÔTÉ CLIENT sur nb_sessions > 0
- Historique : Filière + Année scolaire (périodes dérivées côté client des annee_scolaire des semestres, triées de la plus ancienne à la plus récente)
- Historique : recherche étudiant (filtrage CLIENT sur first_name, last_name, matricule)
- AUCUNE recherche, AUCUN tri, AUCUNE pagination sur le tableau principal des bulletins
- Aucun filtre par décision (Admis / Rattrapage / Ajourné) ni par statut de bulletin (définitif / provisoire)

**Données manipulées**

- professional_bulletins (student_id, semestre_id, statut definitif|provisoire, generated_at, updated_at, data JSONB contenant le bulletin complet calculé)
- professional_ecue_results (moyenne, moyenne_devoirs, note_examen, eliminee, validee, validee_manuellement, session d'obtention)
- professional_ue_results
- professional_ecue_notes (dont la note de conduite, nature examen)
- professional_ue (code, libelle, nb_uv, categorie fondamentale|specialite|culture_generale) et professional_ue_sessions
- professional_semestres, professional_semestre_sessions, professional_semestre_ue
- professional_enrollments (statut confirmee|terminee)
- professional_student_matricules (matricule professionnel IPAM par filière, prioritaire sur student_number)
- student_profiles (student_number, date_of_birth, place_of_birth, is_repeating, gender) + users
- programmes (filières : name, code, domaine)

**Endpoints API appelés**

- GET /api/v1/professional/semestres/:id/bulletins (useBulletinRoster)
- POST /api/v1/professional/semestres/:id/bulletins/generate (useGenerateBulletins)
- POST /api/v1/professional/semestres/:id/bulletins/recompute (useRecomputeBulletins)
- GET /api/v1/professional/semestres/:id/bulletins-full (fetchFullBulletins, PDF combiné)
- GET /api/v1/professional/semestres/:id/bulletins/:studentId (fetchBulletin)
- GET /api/v1/professional/semestres/:id/bulletins/:studentId/bts (fetchBulletinBts)
- GET /api/v1/professional/bulletins/history?filiere_id= (useBulletinHistory)
- GET /api/v1/professional/notes/filieres (useNotesFilieres)
- GET /api/v1/professional/semestres?filiere_id= (useProfessionalSemestres)

**Permissions / garde-fous**

Toutes les routes API utilisées par cet écran sont en requireAdmin : /semestres/:id/bulletins, .../generate, .../recompute, /semestres/:id/bulletins-full, /semestres/:id/bulletins/:studentId, .../bts, /bulletins/history. Aucun garde-fou de rôle côté composant (aucun useSession sur la page Bulletins ni sur l'Historique) : la protection est entièrement serveur, un accès direct à l'URL par un non-admin donne une page vide avec des erreurs API plutôt qu'un refus explicite. L'entrée de menu est filtrée par canSeeAdmin('/professionnel/admin/bulletins'), clé « pro.bulletins » du groupe « Suivi & Évaluation » du ADMIN_MENU_CATALOG. Le bulletin BTS ajoute un contrôle métier serveur (NOT_ELIGIBLE si la filière n'est pas Licence 1 ou 2).

**Statistiques déjà affichées**

- Étudiants : effectif du semestre
- Admis / Rattrapage / Ajournés : décompte par décision de jury
- Par étudiant : moyenne de session, crédits validés sur crédits totaux, décision, statut LMD, date de génération
- Message post-génération : nombre de bulletins générés, dont définitifs et provisoires
- Historique : Étudiants, Bulletins générés, nombre de « Filière validée »
- Historique, par cellule : moyenne du semestre, crédits X/Y, statut définitif/provisoire, date de génération
- Historique, par étudiant : statut global de filière avec cumul des crédits sur les semestres de la période

**Statistiques exploitables et aujourd'hui absentes**

- Taux de réussite (part d'admis / rattrapage / ajournés) par filière et par semestre, et son évolution d'une année sur l'autre — l'indicateur numéro un pour un propriétaire d'école (source : professional_bulletins.data->>'decision')
- Moyenne de promotion et dispersion (écart-type, médiane, quartiles) par semestre et par filière, pour comparer objectivement les filières (source : professional_bulletins.data->>'moyenne_session')
- Taux d'acquisition des crédits : credits_valides / credits_total agrégé par promotion, principal prédicteur de redoublement (source : professional_bulletins, champs credits_valides et credits_total déjà extraits en SQL dans getBulletinHistory)
- Nombre d'étudiants en droit de passer en année supérieure : cumul des crédits sur les semestres de l'année comparé au seuil ANNEE_SUP_CREDITS = 48 défini dans bulletin-calc.ts (source : /bulletins/history)
- Part des bulletins encore provisoires par semestre — pilotage direct de la clôture administrative de l'année (source : professional_bulletins.statut)
- Délai entre la fin des sessions et la génération des bulletins (source : professional_bulletins.generated_at vs professional_ue_sessions.date_fin)
- Taux de validation par UE et par CATÉGORIE d'UE (fondamentale / spécialité / culture générale) pour identifier les unités qui plombent la promotion — les agrégats credits_obtenus et credits_ue par catégorie sont DÉJÀ calculés dans computeStudentBulletin et stockés dans data->'categories'
- Poids réel du rattrapage : part des UE validées en session 2 plutôt qu'en session 1 (source : data->'ues'[].session_validation = 2)
- Suivi de cohorte : nombre et part d'étudiants ayant validé les 3 semestres d'une filière — la logique filiereStatus() existe déjà côté client mais n'est jamais remontée en indicateur consolidé multi-filières
- Détection des étudiants à risque : moyenne < 10 sur deux semestres consécutifs, ou UE en « dette » (déjà tentées en session 2 sans validation) (source : data->'ues'[].etat = 'dette')
- Distribution des rangs et écart entre le premier et le dernier de promotion — le rang est déjà calculé par computeRang et listFullBulletins mais reste confiné au PDF
- Comparaison du taux de réussite entre les étudiants redoublants et non redoublants (source : student_profiles.is_repeating, déjà chargé par listFullBulletins)

**Dettes UI/UX constatées**

- DÉFAUT MAJEUR : apps/web/src/app/professionnel/admin/bulletins/[studentId]/page.tsx est un fichier VIDE de 0 octet, commité tel quel. Or la page Historique génère des liens « Consulter » vers /professionnel/admin/bulletins/{studentId}?semestre={id} en target=_blank (ligne 338) : la route n'a pas de default export et l'onglet ouvert n'affiche rien d'exploitable. Le chemin fonctionnel (PDF client) n'existe que sur la page principale.
- La colonne s'intitule « Statut bulletin » mais elle est alimentée par s.statut_etudiant (Validé / Non validé — Session 2 / En dette), c'est-à-dire le statut LMD de l'ÉTUDIANT. Le véritable statut du bulletin (définitif / provisoire) est pourtant renvoyé par listRoster sous bulletin_statut et n'est jamais affiché sur cette page, alors qu'il l'est dans l'Historique — libellé trompeur et information disponible perdue.
- Aucune confirmation avant « Générer les bulletins » : le bouton régénère l'intégralité des bulletins du semestre en un clic, sans aperçu de l'impact ni possibilité de revenir en arrière
- Aucun garde-fou « conduite manquante » sur cet écran, alors que la page Notes en impose un strict : on peut donc générer des bulletins officiels à partir de moyennes incomplètes
- Aucune recherche, aucun tri, aucune pagination sur le tableau principal — incohérent avec la sous-page Historique qui, elle, propose une recherche
- Aucune sélection multiple d'étudiants : impossible de générer ou d'exporter un sous-ensemble, « Tous les bulletins » est du tout ou rien
- Le PDF combiné est construit côté client avec jsPDF sans barre de progression ni estimation : sur une grosse promotion, l'onglet reste blanc pendant toute la construction
- Trois actions dépendent de window.open et échouent si les pop-ups sont bloqués ; le message d'erreur est correct mais l'expérience reste fragile et aucune solution de repli (téléchargement direct) n'est proposée
- Le rang de l'étudiant, pourtant calculé côté serveur (computeRang, listFullBulletins), n'apparaît nulle part dans le tableau — il faut ouvrir le PDF pour le connaître
- listRoster appelle computeStudentBulletin dans une boucle, un étudiant à la fois (N requêtes SQL séquentielles) sans pagination serveur : le temps de réponse croît linéairement avec l'effectif, et l'écran n'affiche qu'un spinner plein écran, sans squelette ni chargement progressif
- Le bouton « Bulletin BTS » repose sur une regex appliquée au NOM de la filière (/licence\s*[12]\b/i) : une filière nommée « L1 Génie Logiciel » ou « Licence I » n'y a pas droit, sans aucune explication à l'écran
- Historique : le useMemo des stats appelle filiereStatus() dans une double boucle avec un eslint-disable des dépendances — l'ensemble est recalculé à chaque frappe dans le champ de recherche, sans mémoïsation par étudiant
- Historique : le tableau croisé n'est pas virtualisé et chaque cellule empile 4 éléments (moyenne, crédits, badge, date, lien) sur une seule ligne whitespace-nowrap, ce qui produit des colonnes très larges et un défilement horizontal important
- Aucune action d'envoi ou de diffusion depuis l'écran (email, WhatsApp, publication vers l'espace étudiant/parent), alors que les endpoints /student/bulletins/:semestreId et /parent/bulletins/:semestreId existent déjà côté API
- Couleurs et dégradés codés en dur (from-indigo-500, bg-green-100, text-white sur dégradé) sans variante sombre, et cartes KPI sans hiérarchie typographique de contexte (aucune mention du semestre concerné)
- Aucun filtre par décision : impossible d'isoler d'un clic les seuls étudiants ajournés ou en rattrapage, alors que ce sont exactement les listes dont la direction a besoin

---

### 2.5 Documents officiels

#### 2.5.1 Attestations de réussite — `/professionnel/admin/attestations`

`apps/web/src/app/professionnel/admin/attestations/page.tsx` · clé menu `pro.attestations`

**À quoi sert la page**

Écran administrateur qui liste, filière par filière, les étudiants inscrits du Module Professionnel avec leur progression en UV, et permet de générer à la demande l'attestation de réussite PDF de ceux qui ont validé toutes les UE rattachées aux semestres de leur filière. Destiné à la scolarité (rôles admin, super_admin, administrateur) qui délivre les documents au guichet. Une filière = une année du cycle, à la différence du diplôme qui couvre le cycle entier.

**Ce que la page permet de faire**

- Filtrer le roster par cycle (pastilles), par filière (combobox), par année scolaire, par statut (tous / éligibles uniquement)
- Rechercher un étudiant par nom ou matricule (filtre client)
- Générer l'attestation de réussite PDF d'un étudiant éligible et l'ouvrir dans un nouvel onglet (impression / téléchargement via la visionneuse PDF native du navigateur)
- Naviguer vers la page Semestres quand la filière n'a aucune UE rattachée
- Aucune action CRUD : pas de création, d'édition ni de suppression d'attestation ; pas d'import, pas d'export de liste, pas d'envoi email/WhatsApp, pas de génération en lot, pas de validation/publication

**Fonctionnalités présentes dans le code**

- En-tête dégradé ambre/orange (icône Award) avec texte rappelant la règle d'éligibilité : toutes les UE des semestres de la filière validées, années antérieures consultables
- Alerte destructive (Alert + AlertCircle) en haut de page en cas d'échec de génération PDF (état genError)
- Pastilles de cycle (FilterPill) : 'Tous les cycles' + uniquement les cycles réellement présents, ordre LICENCE/MASTER/BTS/DOCTORAT (libellés Licence, Master, BTS, Doctorat), déduits du libellé de filière via gradeOf()
- SearchableSelect 'Filière' (combobox maison avec champ de recherche interne), options 'name · code', triées en français, filtrées par le cycle actif ; désélection automatique si la filière sort du cycle filtré
- SearchableSelect 'Année scolaire' alimenté par les valeurs distinctes de students[].annee_scolaire du roster, triées décroissant, avec l'option 'Toutes les années' ; réinitialisé à chaque changement de filière
- Champ de recherche pleine largeur (icône loupe, placeholder 'Nom ou matricule…'), désactivé tant qu'aucune filière n'est choisie
- Pastilles de statut après choix d'une filière : 'Tous les inscrits' / 'Éligibles uniquement' (icône CheckCircle2)
- 4 cartes KPI dégradées : 'Étudiants inscrits' (total roster), 'UE requises' (ue_requises.length), 'Attestations disponibles' (nb éligibles, vert/emeraude), 'Résultats affichés' (nb lignes après filtres)
- En-tête de la carte tableau : nom de la filière + code en mono, puis 'N UE réparties sur les semestres · N UV au total · Diplôme délivré : <intituleObtention(filiere.name)>' (ex. 'Licence Professionnelle en Genie Logiciel')
- Tableau à 6 colonnes : Étudiant (nom_complet + niveau via niveauOf), Matricule (mono), Année scolaire (badge ambre + icône CalendarDays ou '—'), Crédits validés (barre Progress + pourcentage mono + 'uv_validees/uv_required UV'), Statut, Action
- Badge de statut vert 'Validés' (CheckCircle2) si eligible, sinon badge gris 'N UE restante(s)' dont l'attribut title liste les codes des UE manquantes
- Bouton 'Générer' (dégradé ambre/orange, icône FileText) uniquement sur les lignes éligibles, remplacé par un spinner 'Génération…' pendant le travail ; '—' sinon
- État vide initial : carte centrée 'Choisissez une filière pour afficher ses étudiants inscrits…' avec icône Award
- État filière sans UE : message invitant à composer les semestres, avec lien souligné vers /professionnel/admin/semestres
- État chargement : Loader2 ambre centré ; état filtres vides : 'Aucun étudiant ne correspond aux filtres sélectionnés.'
- Génération PDF 100% client (jsPDF, apps/web/src/lib/attestation-pdf.ts) : nouvel onglet ouvert de façon synchrone au clic puis PDF injecté ; le document combine 3 appels (attestation filière, fiche étudiant pour date/lieu de naissance, signataires)
- Le PDF imprime : référence ATT-<matricule>, en-tête ministère/république, cartouche 'ATTESTATION DE RÉUSSITE', année académique espacée, phrase 'Je soussigné, <nom>, <qualité>, <fonction>…', nom, matricule, date et lieu de naissance, intitulé obtenu, mention, total d'UV validées, date et bloc signature (signataire attestation_reussite)

**Filtres, recherche, tri, pagination**

- Pastilles de cycle : Tous les cycles / Licence / Master / BTS / Doctorat (client, dérivé du libellé de filière)
- Sélecteur de filière avec recherche interne (déclenche le chargement serveur du roster)
- Sélecteur d'année scolaire (client, valeurs dérivées du roster ; 'Toutes les années' par défaut)
- Recherche texte sur nom_complet + matricule (client, insensible à la casse)
- Pastilles de statut : Tous les inscrits / Éligibles uniquement (client)
- Aucun tri de colonne, aucune pagination : l'ordre vient du serveur (nom_complet ASC)

**Données manipulées**

- programmes (filières)
- professional_semestres
- professional_semestre_ue
- professional_ue (code, libelle, nb_uv)
- professional_ue_sessions (date_debut → année scolaire)
- professional_enrollments (statut confirmee/terminee)
- student_professional_ue_results (statut validee, date_validation)
- professional_ecue + professional_ue_ecue + professional_ecue_notes (validation spéciale des UE Conduite : note examen >= 10)
- student_profiles (student_matricule, student_number)
- users (first_name, last_name, computed_name)
- professional_bulletins (data->>'moyenne_session', credits_total → mention)
- professional_signataires

**Endpoints API appelés**

- GET /api/v1/professional/notes/filieres (liste des filières, garde requireAdminOrTeacher)
- GET /api/v1/professional/filieres/:filiereId/attestation-roster (roster + ue_requises)
- GET /api/v1/professional/filieres/:filiereId/students/:studentId/attestation (données imprimables, échoue avec NOT_ELIGIBLE si UE manquantes)
- GET /api/v1/professional/signataires (signataire attestation_reussite)
- GET /api/v1/students/:id (dateOfBirth, placeOfBirth pour le PDF)

**Permissions / garde-fous**

Toutes les routes professionnelles utilisées sont protégées par requireAdmin (rôles normalisés admin, super_admin, administrateur) sauf /notes/filieres en requireAdminOrTeacher ; le garde vérifie aussi la présence du contexte tenant (400 TENANT_REQUIRED). Côté web, l'entrée de menu est filtrée par useAdminMenuAccess/canSeeHref('admin', href) dans Sidebar.tsx (groupe 'Documents officiels'), mais la page elle-même ne fait aucun contrôle de rôle : un accès direct à l'URL affiche l'écran, seules les requêtes API renvoient 403.

**Statistiques déjà affichées**

- Carte 'Étudiants inscrits' (total du roster de la filière)
- Carte 'UE requises' (nombre d'UE rattachées aux semestres)
- Carte 'Attestations disponibles' (nombre d'étudiants éligibles, toutes lignes confondues)
- Carte 'Résultats affichés' (nombre de lignes après filtres)
- En-tête de tableau : nombre d'UE et somme des UV du cursus, intitulé du diplôme délivré
- Par ligne : barre de progression + pourcentage d'UV validées, ratio uv_validees/uv_required, nombre d'UE restantes

**Statistiques exploitables et aujourd'hui absentes**

- Taux d'éligibilité consolidé toutes filières (aujourd'hui il faut sélectionner chaque filière une par une) : éligibles/inscrits par filière et par cycle (endpoint /filieres/:id/attestation-roster, tables professional_enrollments + student_professional_ue_results)
- Top des UE les plus bloquantes : fréquence d'apparition des codes dans students[].ue_manquantes agrégée sur le roster (professional_semestre_ue + student_professional_ue_results) — identifie l'UE qui retarde toute une promotion
- Nombre d'étudiants à une seule UE de l'éligibilité (ue_manquantes.length === 1) : cible commerciale directe pour des sessions de rattrapage
- Progression moyenne d'UV par filière et par année scolaire (moyenne de students[].pourcentage) pour prévoir le volume de diplômés de l'année suivante
- Répartition des éligibles par année scolaire / cohorte (annee_scolaire dérivée de professional_ue_sessions.date_debut) : flux annuel de délivrance et détection des cohortes en retard
- Ancienneté des éligibles non servis : écart entre aujourd'hui et max(student_professional_ue_results.date_validation) des éligibles — mesure le retard administratif de délivrance
- Distribution des mentions des étudiants éligibles (Passable → Excellent, calculée par loadMentionForFilieres à partir de professional_bulletins.data) : argument de qualité pédagogique
- Taux de déperdition par filière : inscrits en professional_enrollments (confirmee/terminee) versus éligibles, par cycle et par niveau

**Dettes UI/UX constatées**

- Aucune génération en lot : un bouton par ligne et un seul PDF à la fois (état generatingId unique) — délivrer une promotion entière exige autant de clics que d'étudiants
- Pop-up bloqué non détecté : handleGenerate appelle window.open puis openAttestationPdf(input, win) sans vérifier que win existe, contrairement à la page Diplômes qui affiche un message dédié — l'échec est silencieux
- Aucune pagination ni virtualisation : le roster complet est rendu dans un unique <table>, tous les filtres (statut, année, recherche) s'appliquent côté client
- Coût serveur en N+1 : getRoster boucle sur chaque étudiant et exécute loadValidatedUeIdsWithConduite (2 requêtes SQL par étudiant) — le temps de réponse croît linéairement avec l'effectif
- Les UE manquantes ne sont accessibles que via l'attribut title natif (tooltip au survol) : invisible sur mobile/tactile et non atteignable au clavier
- Aucune gestion des erreurs de chargement : rosterQuery.isError et filieresQuery.isError ne sont pas traités, un échec réseau affiche le même écran que 'aucun résultat'
- Aucun tri de colonne (ni par progression, ni par année, ni par matricule) alors que le tableau peut compter des centaines de lignes
- Tableau non responsive au-delà d'un overflow-x-auto : 6 colonnes dont une barre de progression sur mobile
- Aucune trace de génération en base : impossible de savoir qui a délivré quelle attestation et quand, ni de gérer un duplicata (la référence ATT-<matricule> est recalculée à la volée à chaque génération)
- Les statistiques n'apparaissent qu'après sélection d'une filière : aucune vue d'ensemble d'établissement à l'ouverture de la page
- L'année scolaire affichée dérive de la date de début de la dernière session d'UE (professional_ue_sessions.date_debut), pas d'une année académique stockée : un étudiant réinscrit voit son année basculer sans lien avec la date réelle de validation
- Le découpage par cycle repose sur le parsing du libellé de filière (regex LICENCE/MASTER/BTS/DOCTORAT) : une filière mal nommée disparaît des pastilles de filtre sans aucun avertissement
- Le SearchableSelect n'expose aucun attribut ARIA (pas de role combobox/listbox) et ne gère pas la navigation clavier dans les options
- Aucune prévisualisation avant impression : le PDF s'ouvre directement dans un onglet, sans écran de contrôle des données (mention, date de naissance manquante, etc.)

---

#### 2.5.2 Diplômes — `/professionnel/admin/diplomes`

`apps/web/src/app/professionnel/admin/diplomes/page.tsx` · clé menu `pro.diplomes`

**À quoi sert la page**

Écran administrateur de délivrance des diplômes de cycle complet (Licence 1→3, Master 1→2 d'une même spécialité). Il liste les candidats du cycle avec leur progression cumulée en UV, leur statut d'octroi, et permet de générer le diplôme PDF ainsi que l'attestation d'authenticité. Deux sous-routes complètent la page : [id]/ (gestion détaillée en 3 onglets : candidats, UE requises, diplômes octroyés, avec octroi/octroi forcé/révocation/recalcul) et [id]/edit/ (édition du libellé, de la description et du statut du diplôme).

**Ce que la page permet de faire**

- Filtrer par grade (Licence/Master), par cycle-spécialité, par année d'obtention et par statut (tous / éligibles / diplômés)
- Rechercher un candidat par nom ou matricule
- Créer/resynchroniser automatiquement le diplôme du cycle et ses exigences (POST ensure-diploma déclenché par la sélection du cycle)
- Octroyer un diplôme (implicitement depuis la liste lors d'une génération, explicitement depuis l'onglet Étudiants avec 'Octroyer')
- Forcer l'octroi d'un diplôme à un étudiant non éligible (confirmation window.confirm)
- Révoquer un diplôme obtenu avec motif obligatoire (window.prompt)
- Recalculer l'éligibilité de tous les candidats d'un diplôme (POST /recompute)
- Générer le diplôme PDF et l'attestation d'authenticité PDF (nouvel onglet, impression/téléchargement natifs)
- Générer l'attestation de réussite PDF depuis l'onglet Étudiants de la fiche détaillée
- Modifier le libellé, la description et le statut (actif/inactif) du diplôme
- Naviguer vers la gestion détaillée puis vers l'édition
- Aucune suppression de diplôme exposée dans l'UI (l'endpoint DELETE existe), aucun export CSV/Excel, aucun envoi email/WhatsApp, aucune génération en lot

**Fonctionnalités présentes dans le code**

- En-tête dégradé émeraude/turquoise (icône GraduationCap) rappelant que le diplôme couvre les 3 années de Licence ou les 2 de Master d'une même spécialité
- Alerte destructive en haut de page pour les erreurs de préparation, d'octroi ou de génération
- Pastilles de cycle : 'Tous les cycles' + Licence / Master (uniquement les grades présents dans /cycle-groups)
- SearchableSelect 'Cycle (spécialité)' listant les groupes de cycle (libellé du type 'Licence — Genie Logiciel'), triés en français ; la sélection déclenche automatiquement un POST ensure-diploma qui crée/resynchronise le diplôme et ses exigences
- SearchableSelect "Année d'obtention" dont les options sont dérivées des dates d'octroi des diplômés (academicYearFromDate), plus 'Toutes les années'
- Champ de recherche pleine largeur 'Nom ou matricule…', désactivé tant que le diplôme du cycle n'est pas prêt
- Pastilles de statut : 'Tous les candidats' / 'Éligibles' (CheckCircle2) / 'Diplômés' (Award)
- 4 cartes KPI dégradées : 'Candidats du cycle', 'Éligibles (non octroyés)', 'Diplômes obtenus', 'Résultats affichés'
- En-tête de la carte tableau : libellé du cycle, nombre d'années du cycle et liste des codes de filières ; bouton 'Gestion détaillée' (icône Settings2) vers /professionnel/admin/diplomes/<id>
- Tableau à 6 colonnes : Étudiant, Matricule (mono), Année d'obtention (badge émeraude + CalendarDays, uniquement pour les diplômés), Progression du cycle (barre Progress + % + 'N UV validées'), Statut, Actions
- 4 badges de statut réels : 'Diplômé' (vert, icône Award), 'Révoqué' (rouge), 'Éligible' (bleu), 'En cours' (gris)
- Deux boutons d'action par ligne : 'Authenticité' (contour émeraude, icône ShieldCheck) et 'Générer le diplôme' (dégradé émeraude, icône Download), tous deux désactivés avec title explicatif si l'étudiant n'est ni éligible ni diplômé ; ligne révoquée : texte 'Diplôme révoqué' sans action
- Octroi implicite : si l'étudiant est éligible mais pas encore diplômé, un clic sur Générer/Authenticité déclenche d'abord POST /award (force:false) puis refetch des candidats
- Détection explicite du blocage de pop-up avec message dédié ('Autorisez les pop-ups pour ce site, puis réessayez.')
- PDF diplôme (apps/web/src/lib/diplome-pdf.ts, A4 paysage) : en-tête 3 colonnes (MESRS, logo IPAM, armoiries + devise), cadre vert/doré, visas de la Commission de Reconnaissance et d'Équivalence des Diplômes, nom, matricule, date/lieu de naissance, intitulé du diplôme, mention, mention 'Aucun duplicata ne sera délivré', 3 blocs de signature (signataires diplome_gauche et diplome_droite configurables), filigranes
- PDF attestation d'authenticité (attestation-authenticite-pdf.ts, A4 portrait) : référence AUTH/<année>/<NNN> attribuée une seule fois et persistée, titulaire, nature du document ('Diplôme'), intitulé complet, filière/spécialité, année d'obtention, signataire authenticite
- Sous-route [id]/ : bandeau titre (libellé, code mono, 'N UV requises (N années)', statut), boutons 'Recalculer l'éligibilité' (RefreshCw) et 'Modifier', 3 cartes KPI (Candidats, Éligibles non octroyés, Diplômes obtenus) et 3 onglets — 'Étudiants & attestations', 'UE requises', 'Diplômes octroyés'
- Onglet 'UE requises' : UE regroupées par année du cycle selon le préfixe du code UE (ex. L1GL), badge du code de filière, compteur 'N UE · N UV', puis table code / libellé / nb UV triée par ordre
- Onglet 'Étudiants & attestations' : table Étudiant / Matricule / Progression (barre + uv_validees sur uv_required) / Statut (Obtenu, Révoqué, Éligible, En cours) / Actions, avec boutons 'Octroyer' ou 'Forcer l'octroi' (confirm natif) pour les non-diplômés et 'Attestation' + 'Diplôme' pour les diplômés
- Onglet 'Diplômes octroyés' : table Étudiant / Référence (DIP-<année>-<NNNNNN>, mono) / Statut (Obtenu vert, Révoqué rouge) / Date d'obtention (fr-FR) / bouton 'Révoquer' (motif saisi via window.prompt)
- Sous-route [id]/edit/ : formulaire avec code du diplôme en lecture seule dans l'en-tête, champ Libellé (requis), champ 'UV requises' désactivé affichant 'N (calculées automatiquement)', select Statut (Actif/Inactif), Textarea Description, bouton Enregistrer puis redirection vers la fiche

**Filtres, recherche, tri, pagination**

- Pastilles de grade : Tous les cycles / Licence / Master (client, à partir de group.grade)
- Sélecteur de cycle (spécialité) avec recherche interne — déclenche le chargement serveur des candidats
- Sélecteur d'année d'obtention (client, dérivé de date_obtention des diplômés)
- Recherche texte sur nom_complet + student_number (client)
- Pastilles de statut : Tous les candidats / Éligibles (éligible et non octroyé) / Diplômés (client)
- Onglets de la fiche détaillée (Étudiants & attestations, UE requises, Diplômes octroyés)
- Aucun filtre 'Révoqué' bien que le badge existe ; aucun tri de colonne ; aucune pagination

**Données manipulées**

- professional_diplomas (code DIP-<code filière sans chiffres>, libelle, description, uv_required, statut, filiere_id)
- professional_diploma_requirements (ue_id, est_obligatoire, ordre)
- student_professional_diplomas (reference DIP-<année>-<NNNNNN>, statut obtenu/revoque, uv_total_validees, requirements_snapshot JSONB, date_obtention, date_revocation, motif_revocation, octroye_par, revoque_par, authenticite_reference/numero/annee)
- programmes (filières du cycle, regroupées par grade + spécialité)
- professional_ue, professional_semestres, professional_semestre_ue
- professional_ue_sessions, professional_enrollments (statut <> annulee)
- student_professional_ue_results (statut validee)
- professional_ecue / professional_ue_ecue / professional_ecue_notes (validation des UE Conduite)
- student_profiles, users
- professional_bulletins (calcul de la mention pondérée par les crédits)
- professional_signataires (diplome_gauche, diplome_droite, authenticite)

**Endpoints API appelés**

- GET /api/v1/professional/cycle-groups
- POST /api/v1/professional/cycle-groups/:filiereId/ensure-diploma
- GET /api/v1/professional/diplomas/:id
- PATCH /api/v1/professional/diplomas/:id
- GET /api/v1/professional/diplomas/:id/candidates
- GET /api/v1/professional/diplomas/:id/awarded
- POST /api/v1/professional/diplomas/:id/recompute
- POST /api/v1/professional/diplomas/:id/award
- POST /api/v1/professional/diplomas/:id/revoke
- GET /api/v1/professional/diplomas/:id/students/:studentId/attestation
- GET /api/v1/professional/signataires
- GET /api/v1/students/:id

**Permissions / garde-fous**

Toutes les routes /diplomas*, /cycle-groups* sont protégées par requireAdmin (admin, super_admin, administrateur) avec contrôle du contexte tenant ; les variantes étudiant (/student/diplomas*) et parent (/parent/diplomas) existent mais ne sont pas utilisées par cette page. L'octroi et la révocation enregistrent l'auteur (octroye_par / revoque_par) à partir de l'utilisateur courant. Côté web, l'entrée de menu passe par canSeeHref('admin', href) ; aucune garde de rôle dans le composant de page, et aucun garde-fou distinct pour les actions sensibles (octroi forcé, révocation) : tout administrateur voyant la page peut les exécuter.

**Statistiques déjà affichées**

- Page liste : cartes 'Candidats du cycle', 'Éligibles (non octroyés)', 'Diplômes obtenus', 'Résultats affichés'
- Page liste, par ligne : barre de progression + pourcentage du cycle, nombre d'UV validées, année d'obtention
- En-tête de cycle : nombre d'années du cycle et codes des filières concernées
- Fiche détaillée : cartes 'Candidats', 'Éligibles (non octroyés)', 'Diplômes obtenus'
- Fiche détaillée, en-tête : nombre d'UV requises et nombre d'années du cycle
- Onglet UE requises : nombre d'UE et total d'UV par année du cycle
- Onglet Étudiants : progression uv_validees/uv_required par étudiant
- API getById : nb_diplomes_octroyes et uv_total_atteignable (calculés mais non affichés dans l'UI)

**Statistiques exploitables et aujourd'hui absentes**

- Taux de diplomation par cycle et par promotion : diplômés (student_professional_diplomas.statut='obtenu') rapportés aux candidats inscrits du cycle (professional_enrollments) — l'indicateur commercial n°1 d'une école
- Volume de diplômes délivrés par année civile et par année académique (student_professional_diplomas.date_obtention), avec comparaison N/N-1
- Backlog de délivrance : nombre d'éligibles non octroyés par cycle et depuis combien de temps (candidates.eligible + absence de ligne dans student_professional_diplomas)
- Diplômes octroyés par dérogation (octroi forcé) : lignes dont requirements_snapshot contient au moins une exigence validee=false — mesure du risque de conformité, aujourd'hui totalement invisible
- Taux de révocation et motifs les plus fréquents (statut='revoque', motif_revocation, date_revocation) : donnée déjà stockée et jamais restituée
- Délai moyen entre la dernière UE validée (max student_professional_ue_results.date_validation) et la date d'octroi : mesure de la réactivité administrative
- Répartition des mentions des diplômés (loadMentionForFilieres sur professional_bulletins) par cycle et par promotion
- Taux de déperdition par niveau du cycle : effectifs L1 vs L2 vs L3 issus de professional_enrollments joints à professional_ue.filiere_id, jusqu'au diplôme
- Volume annuel d'attestations d'authenticité émises (student_professional_diplomas.authenticite_annee / authenticite_numero) : indicateur des vérifications employeurs et de la valeur du diplôme sur le marché
- Classement des spécialités par taux de diplomation et durée moyenne du cycle (cycle-groups + date d'entrée en L1 via professional_ue_sessions.date_debut)

**Dettes UI/UX constatées**

- Acte administratif irréversible sans confirmation : cliquer sur 'Générer le diplôme' ou 'Authenticité' octroie automatiquement le diplôme (POST /award) à un candidat éligible, sans aucune boîte de dialogue, alors que la fiche détaillée demande confirmation pour un simple octroi forcé
- Effet de bord au simple affichage : sélectionner un cycle déclenche un POST ensure-diploma qui supprime puis réinsère toutes les exigences (DELETE + INSERT en boucle) — une opération d'écriture sur une action de lecture
- Incohérence entre les deux écrans : la page liste propose la génération dès l'éligibilité (avec octroi implicite) alors que la fiche détaillée ne propose Attestation/Diplôme qu'une fois le statut 'obtenu'
- Année académique fausse sur le diplôme : ProfessionalDiplomasService.getAttestation ne renvoie jamais annee_academique, le front retombe donc sur academicYearFromDate(date_obtention), c'est-à-dire l'année de l'octroi et non celle de fin de cycle — un diplôme régularisé tardivement porte la mauvaise année
- La colonne "Année d'obtention" et le filtre associé souffrent du même biais : ils reflètent la date d'octroi administratif, pas la fin réelle du cursus
- Motif de révocation saisi via window.prompt et octroi forcé via window.confirm : pas de modale, pas de longueur minimale, pas de champ multiligne, comportement dégradé dans certains navigateurs/webviews
- L'onglet 'Diplômes octroyés' n'affiche ni le motif ni la date de révocation, ni l'auteur de l'octroi, alors que motif_revocation, date_revocation, octroye_par et revoque_par sont en base ; il ne permet pas non plus de régénérer le PDF d'un diplômé
- Coût serveur en N+1 : listCandidates exécute par étudiant loadAllValidatedUeIdsWithConduite (2 requêtes) plus loadStudentAward (1 requête) — donc 3 requêtes SQL par candidat, sans pagination côté API ni côté UI
- Regroupement des UE requises par heuristique fragile : String(ue_code).split('-')[0] pour deviner l'année du cycle ; tout code UE ne respectant pas la convention L1GL-S1-UE1 tombe dans un groupe '—'
- Aucune gestion des erreurs de chargement (candidatesQuery.isError, diplomaQuery.isError, groupsQuery.isError) ; sur la fiche détaillée, un id inconnu affiche un titre vide plutôt qu'un état 'introuvable'
- Aucune génération en lot ni export de la liste des diplômés (un PDF à la fois, état busyId unique)
- Aucun filtre 'Révoqué' dans les pastilles alors que le badge Révoqué existe : impossible d'isoler les diplômes annulés
- Aucun tri de colonne, aucune pagination, aucune virtualisation du tableau des candidats
- La page d'édition ne confirme rien après enregistrement (redirection immédiate) et ne permet pas de corriger le code ni la filière ; le statut 'inactif' n'a aucun effet visible dans la page liste
- Les groupes de cycle reposent sur la regex '^(LICENCE|MASTER) <n> <spécialité>$' appliquée au nom de la filière : les BTS et doctorats n'ont donc aucun diplôme possible, et une faute de frappe dans un libellé scinde silencieusement un cycle en deux

---

#### 2.5.3 Signataires — `/professionnel/admin/signataires`

`apps/web/src/app/professionnel/admin/signataires/page.tsx` · clé menu `pro.signataires`

**À quoi sert la page**

Écran de paramétrage des noms et titres imprimés au bas des documents officiels du Module Professionnel. Il expose exactement 4 emplacements de signature (attestation de réussite, diplôme gauche, diplôme droite, attestation d'authenticité), chacun avec nom, qualité et fonction. Destiné à la direction ou au responsable scolarité : la modification s'applique immédiatement aux prochains PDF générés depuis les pages Attestations et Diplômes.

**Ce que la page permet de faire**

- Consulter les 4 signataires configurés (ou leurs valeurs par défaut)
- Modifier le nom, la qualité et la fonction d'un emplacement
- Enregistrer un emplacement (PUT idempotent, upsert ON CONFLICT (tenant_id, cle))
- Aucune création ni suppression d'emplacement : les 4 clés sont figées dans le contrat
- Aucun import/export, aucun envoi, aucune génération PDF, aucun aperçu, aucun téléversement d'image de signature ou de cachet

**Fonctionnalités présentes dans le code**

- En-tête dégradé ardoise (icône PenLine) avec titre 'Signataires des documents' et rappel qu'un seul nom est enregistré par titre et qu'il s'applique aux prochains documents générés
- Alerte destructive globale en haut de page en cas d'erreur de validation ou d'enregistrement
- Spinner Loader2 centré pendant le chargement de la liste
- Une carte par emplacement, dans l'ordre figé de SIGNATAIRE_LABELS (packages/contracts/src/professional-signataires.ts) : 'Attestation de réussite — signataire', 'Diplôme — signataire de gauche', 'Diplôme — signataire de droite', "Attestation d'authenticité — signataire"
- Chaque carte affiche en description l'endroit exact où le signataire apparaît sur le document (ex. « Apparaît dans “Je soussigné, <nom>, <qualité>, <fonction> de l'Institut… atteste que :” et dans le bloc de signature »)
- Champ 'Nom' obligatoire (astérisque rouge), placeholder 'Nom imprimé sur le document'
- Champ 'Qualité' affiché uniquement pour l'attestation de réussite (withQualite), placeholder 'Ex. Enseignant Chercheur'
- Champ 'Fonction / titre' : Input simple pour l'attestation de réussite et l'authenticité, Textarea 2 lignes pour les deux signataires du diplôme, avec la mention « une ligne par retour à la ligne » et le placeholder 'Directeur du Comité Scientifique / Directeur de Recherche'
- Bouton 'Enregistrer' (icône Save) par carte, remplacé par un spinner pendant la mutation de cette carte uniquement (updateMut.variables?.cle)
- Badge de confirmation vert 'Enregistré' (CheckCircle2) affiché à côté du bouton de la carte sauvegardée, effacé dès qu'un champ (de n'importe quelle carte) est modifié
- Repli automatique sur des valeurs par défaut côté serveur si aucune ligne n'existe en base pour l'établissement (noms IPAM codés en dur dans professional-signataires.service.ts)
- Les valeurs saisies alimentent directement les 3 générateurs PDF : attestationIntro()/attestationSignatureBloc() pour l'attestation, les blocs gauche/droite du diplôme, et le bloc « Le Responsable » de l'attestation d'authenticité

**Filtres, recherche, tri, pagination**

- Aucun filtre, aucune recherche, aucun tri, aucune pagination : la page affiche exactement 4 cartes dans un ordre figé

**Données manipulées**

- professional_signataires (tenant_id, cle, nom, qualite, fonction, updated_at — migration 0087)
- Valeurs par défaut codées en dur côté API (DEFAULTS dans professional-signataires.service.ts) et côté web (constantes de apps/web/src/lib/diplome-format.ts)

**Endpoints API appelés**

- GET /api/v1/professional/signataires
- PUT /api/v1/professional/signataires/:cle (cle ∈ attestation_reussite, diplome_gauche, diplome_droite, authenticite)

**Permissions / garde-fous**

GET et PUT /signataires sont protégés par requireAdmin (admin, super_admin, administrateur) avec contrôle du contexte tenant ; la clé est validée par SignataireCleSchema (422 si inconnue) et le corps par SignataireUpdateInputSchema. Aucune traçabilité de l'auteur de la modification n'est enregistrée (la table ne stocke qu'updated_at). Côté web, l'entrée de menu est filtrée par canSeeHref('admin', href) ; la page ne contrôle aucun rôle elle-même.

**Statistiques déjà affichées**

- Aucune statistique, aucun compteur, aucun graphique : la page est un pur formulaire de configuration

**Statistiques exploitables et aujourd'hui absentes**

- Date de dernière modification de chaque signataire (professional_signataires.updated_at, déjà en base mais non exposée par le DTO) : savoir si les noms imprimés sont à jour avant une session de délivrance
- Nombre d'emplacements encore sur les valeurs par défaut IPAM (comparaison de la ligne en base avec DEFAULTS) : alerte de conformité pour un établissement nouvellement créé
- Volume de documents officiels émis sous chaque signataire : diplômes octroyés (student_professional_diplomas.date_obtention) postérieurs à professional_signataires.updated_at — mesure l'exposition juridique d'un signataire sortant
- Nombre de diplômes et d'attestations d'authenticité émis depuis le dernier changement de direction (croisement updated_at / date_obtention / authenticite_annee)
- Répartition des documents par type émis sur la période (attestations de réussite éligibles, diplômes obtenus, attestations d'authenticité numérotées) pour dimensionner la charge de signature à venir

**Dettes UI/UX constatées**

- Un bouton 'Enregistrer' par carte et aucun enregistrement global : modifier les 4 signataires demande 4 soumissions distinctes
- Le badge 'Enregistré' est piloté par un unique état savedCle, donc effacé dès qu'on touche un champ d'une autre carte : la confirmation disparaît alors que la donnée est bien enregistrée
- Aucune détection de modifications non enregistrées : quitter la page ou naviguer ailleurs perd silencieusement les saisies, sans avertissement
- Aucune prévisualisation : l'administrateur ne voit jamais le rendu réel sur le document, seulement une description textuelle de l'emplacement
- Impossible de distinguer visuellement une valeur enregistrée en base d'une valeur par défaut servie par le serveur : les champs sont pré-remplis à l'identique dans les deux cas
- Les valeurs par défaut sont des noms de personnes réelles d'un établissement précis (IPAM) codés en dur côté API et côté front : un autre établissement qui n'a rien configuré imprime ces noms sur ses documents officiels sans aucune alerte
- Aucune traçabilité : ni auteur ni historique des modifications, alors qu'il s'agit du paramètre le plus sensible juridiquement de tout le module (aucune colonne d'auteur dans la table)
- Aucun état d'erreur de chargement (signatairesQuery.isError non traité) : un échec du GET laisse des formulaires vides que l'enregistrement écraserait
- L'erreur de validation ('Le nom est requis.') s'affiche dans une alerte en haut de page, sans mise en évidence du champ ni du bloc concerné, et sans scroll automatique
- Aucun garde-fou sur le contenu : pas de longueur maximale, pas de normalisation de casse, aucune vérification du nombre de lignes des champs multilignes du diplôme (le PDF n'en attend que deux)
- Aucun support d'image : ni signature manuscrite scannée ni cachet, alors que les documents officiels générés en dépendent en pratique
- Les autres éléments imprimés sur les documents (nom de l'établissement, adresse de pied de page, logos, lieu 'Abidjan') restent codés en dur dans diplome-format.ts et ne sont pas configurables sur cette page, ce qui en fait une configuration à moitié faite

---
## 3. Synthèse transverse

### 3.1 Ce que le profil owner contient déjà

**14 pages** sous `apps/web/src/app/owner/` — `dashboard`, `finances`, `finances/professionnel`, `finances/rapport`, `academique`, `pedagogie`, `assiduite`, `referentiel`, `personnes`, `recrutement`, `staff`, `formations`, `alertes`, `acces` — mais **12 entrées seulement dans la sidebar** : `/owner/finances/rapport` n'est atteignable que par un bouton, et `/owner/acces` n'est listé que sous `isAdmin` (`Sidebar.tsx:1808`), donc **invisible pour un owner non-admin**.

**24 routes API** dans `apps/api/src/routes/owner/index.ts` (21 GET, 3 PATCH), montées sur `/api/v1/owner`, gardées par `requireOwner` ou `requireOwnerOrAdmin` (`apps/api/src/middlewares/requireOwner.ts`).

**Un socle statistique déjà solide et fiable** : `owner-{dashboard,finances,finances-pro,academic,pedagogie,assiduite,referentiel,personnes,recrutement,staff,formations,payroll,alerts-feed}.service.ts`, contrats Zod dans `packages/contracts/src/owner-stats.schema.ts` (655 lignes).

**Une palette data-viz rigoureuse et documentée** — `--viz-series-1..8`, `--viz-good/warning/serious/critical`, rampe séquentielle avec encres appariées, définie dans `globals.css` pour `:root` **et** `.dark`. C'est le seul système de design vraiment abouti de l'application, et il doit servir de socle. Ses règles : l'ordre des slots est le mécanisme d'accessibilité daltonisme, la couleur suit l'entité (`seriesColorFor`) et non le rang, 8 séries maximum puis « Autres », toute couleur de statut est doublée d'un libellé.

**Wrappers de graphiques existants** : `components/owner/charts/` — `BarChartCard`, `LineChartCard`, `DonutChartCard`, `ChartCard`, `VizTooltip`, `HeatmapGrid`, sur recharts.

**Export CSV** sur 5 pages (`pedagogie`, `finances/professionnel`, `assiduite`, `personnes`, `recrutement`) via `ExportCsvButton` et `owner-stats-csv.service.ts`. **Export PDF** sur une seule (`/owner/finances/rapport`).

**Moteur d'alertes** : table `owner_pilotage_alerts` + `syncOwnerPilotageAlerts()` (9 règles idempotentes, dont 6 propres au module professionnel), acquittement par `PATCH /alerts/:id/acknowledge`.

### 3.2 Les 15 dettes récurrentes (351 constats sur 22 pages)

| # | Dette | Ampleur | Exemples représentatifs |
| --- | --- | --- | --- |
| 1 | **Chiffres faux affichés comme vrais** | 5 pages | `/academic` : les 4 KPI sont une constante en dur (`stats`, lignes 56-93). Parents : les 4 KPI sont calculés sur la page courante (10 lignes) alors que la pagination affiche le vrai total juste en dessous. Cycles : KPI calculés sur les 20 premières lignes. Filières : le KPI « Cours » est faux au-delà de 20 matières. |
| 2 | **Plafonds silencieux + filtrage client** | 22 constats | `limit=20` (cycles, cours), `limit=100` (salles), `pageSize=500` (sessions, inscriptions), `pageSize=1000` (UE, ECUE, étudiants), `useAllAdminEnrollments` boucle jusqu'à 50 000 lignes avant le premier rendu. Recherche et filtres refaits en mémoire alors que l'API les supporte déjà en querystring. |
| 3 | **Accessibilité** | 35 constats | Boutons-icônes avec `title` seul, sans `aria-label`. Onglets en `<button>` nus, sans `role="tab"`/`aria-selected`, non reflétés dans l'URL. Modales sans Échap, sans piège de focus, sans `role="dialog"`. Lignes de tableau cliquables sans `tabIndex` ni gestion clavier. Combobox maison sans rôle ARIA. |
| 4 | **Confirmations et retours natifs** | 31 constats | `window.confirm` pour toutes les suppressions, `alert()` pour les erreurs, `window.prompt` pour la réouverture d'un lot de sessions et pour le motif de révocation d'un diplôme — alors que `ConfirmationDialog` existe et que **trois** systèmes de toasts sont déjà montés. |
| 5 | **États d'erreur non traités** | 27 constats | `isError` ignoré sur UE (sessions), ECUE, Attestations, Diplômes, Signataires, `/academic` : un échec réseau affiche le même écran que « aucun résultat ». Faux négatif trompeur pour un décideur. |
| 6 | **Couleurs en dur, thème sombre cassé** | 24 constats | `bg-gray-50`, `text-gray-900`, `bg-white` (93 fichiers) hors tokens. Surtout : `darkMode:['class']` est configuré et `ThemeProvider` pose bien `dark`/`light`, mais **aucune règle `.light` n'existe** — les tokens `:root` sont un thème sombre, choisir « clair » ne change rien. |
| 7 | **Chargement bloquant** | 20 constats | Les 14 pages owner font `return <Loader2/>` plein écran pendant `isLoading` : le bloc Filtres disparaît à **chaque** changement de filtre. Aucun skeleton, aucun `placeholderData`/`keepPreviousData`. |
| 8 | **`isPending` global partagé** | 8 pages | Une suppression met en spinner et désactive le bouton correspondant de **toutes** les cartes. Sur `/owner/acces`, tous les boutons « Enregistrer » de la table passent en spinner simultanément. |
| 9 | **Capacités API existantes non branchées** | 12 constats | `PUT /programmes/:id/approve` (workflow d'approbation entier inaccessible), `PATCH /emploi-temps/{id}` (on doit supprimer puis recréer), `POST /:id/reset-password` et `/send-credentials` (enseignants, parents), `hourlyRate` affiché et exporté mais absent des formulaires, `bilan_type_id` affiché mais éditable nulle part, `useAddEcueToUe`/`useUpdateUeEcueLink` existants mais onglet Composition en lecture seule. |
| 10 | **Absence d'export** | 18 constats | Ni CSV ni PDF sur : cycles, filières, parents, UE, ECUE, semestres, inscrits, paiements (journal de caisse), présences, conduite, notes, diplômes. |
| 11 | **Doublons de chemins divergents** | 6 pages | Modale d'édition sur le détail **et** route `/[id]/edit`, avec deux comportements post-sauvegarde différents (rester sur place vs rediriger). Sur les salles, les deux chemins de création n'utilisent même pas le même formulaire : `/new` force `capacity=30` en dur, ce qui fausse le KPI « Capacité totale ». |
| 12 | **Incohérence de charte** | transverse | Deux dialectes visuels (« gradient » sur l'académique/professionnel, « sobre » dans l'owner), deux bibliothèques de composants concurrentes (`components/ui` 217 fichiers vs `packages/ui` 376 fichiers, souvent mélangées dans le même fichier), trois systèmes de toasts, Ant Design dont le `ConfigProvider` en thème **clair codé en dur** enveloppe toute l'application. Sur une même page, la liste est orange, le formulaire violet et la fiche rose. |
| 13 | **Heuristiques textuelles fragiles** | 6 constats | La **Conduite** est détectée par `libelle ILIKE 'conduite%' OR code ILIKE '%EC-CON%'` — renommer l'UE casse silencieusement la facturation et la page Conduite. Le bouton « Bulletin BTS » repose sur une regex sur le **nom** de la filière. Les groupes de diplômes reposent sur `^(LICENCE|MASTER) <n> <spécialité>$` : les BTS n'ont donc aucun diplôme possible. Le cycle des attestations est déduit par regex sur le libellé. |
| 14 | **Multi-tenant contourné** | 4 constats | `use-academic-years.ts` envoie `X-Tenant: 'imhotepacademy'` et un `X-User-Id` **codés en dur**. `useStudents` appelle `createApiHeaders()` sans session (retombe sur `'imhotepdata'`) et contourne le rewrite Next. L'export Word du planning contient l'en-tête institutionnel d'un seul établissement. Les signataires par défaut sont des **noms de personnes réelles** d'un établissement précis, imprimés sur les documents officiels de tout tenant non configuré. |
| 15 | **Fuite de mots de passe en clair** | 3 endpoints | `initialPassword` est renvoyé par `GET /api/v1/teachers`, `/students` et `/parents` pour **chaque fiche, sans filtrage par rôle** — le commentaire du code le dit explicitement, et la variable `canViewPasswords` est calculée puis ignorée. À traiter comme un défaut de sécurité, pas comme une dette UX. |

**Trois bugs bloquants confirmés**, à corriger avant toute refonte :

1. `apps/web/src/app/professionnel/admin/bulletins/[studentId]/page.tsx` est un **fichier vide de 0 octet** commité tel quel, alors que la page Historique génère des liens « Consulter » vers cette route en `target="_blank"` : l'onglet s'ouvre sur rien.
2. `apps/web/src/app/professionnel/admin/notes/historique/page.tsx` lit `d.valeur` et `examen.valeur` (lignes 344 et 351) alors que l'API renvoie `note` : les colonnes « Devoirs (/20) » et « Examen (/20) » affichent **toujours** « — ».
3. `apps/web/src/app/academic/classrooms/[id]/edit/page.tsx` lit `classroom.name` sur l'enveloppe `{ data: Classroom }` : le formulaire d'édition s'ouvre **entièrement vide** au lieu d'être pré-rempli.

Et **deux effets de bord d'écriture sur des actions de lecture** : `GET /owner/alerts` déclenche `syncOwnerPilotageAlerts()`, et sélectionner un cycle sur la page Diplômes déclenche un `POST ensure-diploma` qui **supprime puis réinsère** toutes les exigences.

### 3.3 Contraintes techniques non négociables

| Contrainte | Détail |
| --- | --- |
| **Catalogue de menus** | `ADMIN_MENU_CATALOG` (`packages/contracts/src/admin-roles.schema.ts`) pilote la sidebar **et** la page Accès **et** la table `admin_role_menus`. Les `key` sont persistées : elles ne changent jamais. Le découpage en groupes de la sidebar doit rester identique. |
| **Filtrage fail-open** | `useAdminMenuAccess()` interroge `GET /api/v1/admin/access/me/menus` avec `retry:false` et `allowAll=true` tant que la requête n'a pas répondu. Volontaire — à préserver. |
| **RLS multi-tenant** | L'API fait `SELECT set_config('app.tenant_id', $1, true)` avant chaque requête. Côté web, `lib/fetch-interceptor.ts` **patche `window.fetch`** et injecte `X-Tenant`, `Authorization` (refresh à T-5 min), `X-User-Id`, `X-Academic-Year-Id`. Tout client HTTP tiers (axios, ky) contournerait ce mécanisme et **casserait la RLS**. |
| **CSP** | `middleware.ts` impose `connect-src 'self' http://localhost:4000 http://localhost:3000` et `font-src 'self' data:` — toute police, CDN ou API externe ajoutée sera bloquée. |
| **Data fetching** | React Query 5.85.3 exclusivement, `staleTime` 60 s, `queryKey` incluant le `tenantId`, `enabled: !!session && tenantId !== 'no-tenant'`, types via `@ecoledigitale/contracts`. |
| **Prisma inutilisable pour les stats** | Les tables du module professionnel n'existent **que** dans `infra/scripts/migrations/0061-0094` ; elles sont absentes de `schema.prisma` (15 modèles). Tout doit passer en **SQL brut via `pg.Pool`**. |
| **Build aveugle** | `next.config.js` a `typescript.ignoreBuildErrors:true` **et** `eslint.ignoreDuringBuilds:true` : le build ne détecte aucune régression de types. Vérifier par `type-check` manuel, en connaissant le bruit préexistant. |
| **Récupération de chunks** | `ChunkErrorBoundary` + `lib/chunk-error-handler.ts` initialisé avant React + script `pnpm fix-chunks` : système maison à préserver. |
| **Contrôle d'accès client-only** | `app/owner/layout.tsx` fait un `router.replace('/unauthorized')` ; le middleware ne fait **aucune** authentification. Les pages `/academic/*` et `/professionnel/admin/*` n'ont même pas ce garde-fou. |
| **Pas de `pnpm install`** | L'utilisateur s'en charge lui-même. |

### 3.4 Ce sur quoi on ne peut pas s'appuyer

- **`professional_bulletins` n'a pas de Row-Level Security** (migration 0083) : seul un `WHERE tenant_id = $1` isole les données.
- **Les heures d'absence ne sont pas fiables** : `professional_ecue_seances.heure_debut/heure_fin` sont NULLABLE et il n'existe aucune colonne `duree`. `EXTRACT(EPOCH FROM (heure_fin - heure_debut))` vaut NULL dès que les heures ne sont pas saisies.
- **Aucun échéancier côté professionnel** : `professional_orders` porte un `montant_total` mais aucune date d'échéance. On peut dire « incomplet », jamais « en retard ». C'est le trou le plus coûteux du modèle financier.
- **Trois circuits de paiement sans clé commune** : `payment_transactions` (académique), `professional_payments` → `professional_orders` (pro), `paiements_professionnels`/`inscriptions_public` (catalogue). Aucun CA consolidé sans vue unifiée.
- **Trois pondérations divergentes** : `professional_ecue.credits`, `professional_ue_ecue.coefficient`, `professional_ue.nb_uv`. Seul `credits` est réellement utilisé par les bulletins.
- **`professional_semestres` n'a aucune colonne d'ordre ni d'année scolaire** : l'année est dérivée par un pivot septembre réimplémenté **quatre fois** dans le code, et le tri des semestres se fait par libellé.
- **Totaux financiers plafonnés** : `overdueCount`/`overdueAmount` sont sommés en TypeScript sur une requête `LIMIT 200` ; `issueCounts` du référentiel est un `rows.length` borné à 50 par type. Les montants affichés sont faux au-delà.
- **Dégradation silencieuse** : tous les services owner utilisent `safeQuery`/`safeNum` qui loguent un warn et renvoient `0` ou `[]` en cas d'échec SQL. Une requête cassée ne remonte jamais d'erreur — elle affiche zéro.
- **Aucune table d'attestations** : elles sont recalculées à la volée à chaque génération, sans date d'émission ni compteur ni référence persistée.
- **Aucune table d'audit sur le module professionnel** : aucun historique de changement de statut d'inscription, de cohorte ou de paiement au-delà de `created_at`/`updated_at`.

---

## 4. Plan de statistiques recommandé pour le compte propriétaire

**Principe directeur** : un propriétaire d'école en Afrique de l'Ouest pilote 4 questions, dans cet ordre : *est-ce que l'argent rentre ?* → *est-ce que les effectifs tiennent ?* → *est-ce que la machine pédagogique tourne ?* → *où est-ce que je perds de l'argent sans le voir ?*
Chaque indicateur ci-dessous est rattaché à une table/endpoint réellement présents dans l'inventaire et porte un marqueur :

- **[DISPONIBLE]** : la valeur est déjà calculée et renvoyée par un endpoint owner existant — il n'y a qu'à l'afficher.
- **[AGRÉGAT À CRÉER]** : les colonnes existent, la requête SQL est à écrire (service `owner-*.service.ts`).
- **[MIGRATION REQUISE]** : la colonne ou la table n'existe dans aucune migration (`infra/scripts/migrations`, dernier fichier `0094_student_sequence_number.sql`).

**Convention transverse assumée** : le périmètre « école » consolide les deux moteurs métier — le scolaire classique (`student_tuition_installments`, `payment_transactions`, `classes`, `student_period_course_averages`) et le professionnel/UE-ECUE (`professional_orders`, `professional_payments`, `professional_ue_sessions`, `professional_bulletins`). Aujourd'hui aucun écran owner ne consolide les deux : c'est la première dette à combler.

---

### 1. Les 8 KPI de la barre haute (le « pouls » de l'école)

Barre unique, persistante en haut de **toutes** les pages owner, alimentée par un seul endpoint `GET /api/v1/owner/pulse` (à créer), avec un horodatage « données au JJ/MM à HH:MM » et un bouton Actualiser. Les 4 KPI actuels (`KpiGrid.tsx`, libellés codés en dur) sont remplacés.

#### KPI 1 — Encaissements du mois (toutes activités)

- **Formule** : `SUM(payment_transactions.amount WHERE status='completed' AND date_trunc('month', COALESCE(processed_at, created_at)) = date_trunc('month', CURRENT_DATE))` **+** `SUM(professional_payments.montant WHERE statut='confirme' AND date_trunc('month', COALESCE(paid_at, created_at)) = mois courant)`
- **Source** : `payment_transactions` (déjà utilisé par `owner-dashboard.service.ts` pour `revenueCurrentMonth`) + `professional_payments` (utilisé par `owner-finances-pro.service.ts` pour `monthlyCollections`).
- **Comparaison** : M-1 (même nombre de jours écoulés, comparaison à date : `AND EXTRACT(day FROM date) <= EXTRACT(day FROM CURRENT_DATE)`) **et** M-12 (même mois de l'année scolaire précédente, le calendrier scolaire étant très saisonnier : pic septembre-octobre, creux juillet-août).
- **Seuil d'alerte** : ambre si `< 90 %` du même mois N-1 à date ; rouge si `< 75 %`.
- **Statut** : **[AGRÉGAT À CRÉER]** — les deux moitiés existent séparément (`revenueCurrentMonth` dashboard, `monthlyCollections` finances pro), aucune ne les additionne.

#### KPI 2 — Taux de recouvrement consolidé

- **Formule** : `100 × (SUM(student_tuition_installments.amount_paid) + SUM(professional_payments.montant WHERE statut='confirme')) / (SUM(student_tuition_installments.amount) + SUM(professional_orders.montant_total WHERE statut <> 'annulee'))`, borné à la fenêtre « année scolaire en cours » (`academic_years.start_date/end_date`, ou pivot septembre côté pro comme dans `resolvePeriod()`).
- **Source** : `student_tuition_installments` (`owner-finances.service.ts`) + `professional_orders` ⋈ `professional_payments` (`owner-finances-pro.service.ts`, CTE `PAID_PER_ORDER_CTE`).
- **Comparaison** : même date d'avancement de l'année scolaire N-1 (jour+mois), pas M-1 — un recouvrement de 40 % en octobre est excellent, en mai il est catastrophique.
- **Seuil d'alerte** : vert ≥ 85 %, ambre 70-85 %, rouge < 70 % — mêmes bornes que les `ReferenceLine` 60/80 déjà posées dans `RecoveryByCycleChart.tsx`, relevées car il s'agit ici du consolidé annuel.
- **Statut** : **[AGRÉGAT À CRÉER]** — les deux taux existent isolément (`finances.totals.recoveryRate` et `financesPro.totals.recoveryRate`), jamais fusionnés.

#### KPI 3 — Reste à recouvrer, dont > 60 jours

- **Formule** : `outstanding = SUM(GREATEST(0, amount − amount_paid))` sur `student_tuition_installments` où `status IN ('pending','partial','overdue')` **+** `SUM(GREATEST(0, professional_orders.montant_total − paid_per_order.paid))`. Sous-valeur critique : part dont `due_date < CURRENT_DATE − 60` (scolaire) ou `professional_enrollments.created_at < CURRENT_DATE − 60` (pro, faute de date d'échéance — cf. §5).
- **Source** : `student_tuition_installments.due_date/status`, `professional_orders.montant_total`, `professional_payments`, `professional_enrollments.created_at`.
- **Comparaison** : semaine précédente (variation en FCFA, pas en %) — c'est un stock, pas un flux ; le propriétaire veut savoir s'il se creuse.
- **Seuil d'alerte** : rouge si `reste à recouvrer > 1,5 × masse salariale enseignante mensuelle` (risque de rupture de paie) ; rouge aussi si la part > 60 j dépasse 30 % du reste total.
- **Statut** : **[AGRÉGAT À CRÉER]** — `overdueAmount` existe côté scolaire mais est **plafonné à 200 lignes** (`overdueSql LIMIT 200`, totaux sommés en TypeScript) : le montant affiché aujourd'hui est faux dès 200 impayés. À recalculer en SQL sans LIMIT.

#### KPI 4 — Effectif actif consolidé

- **Formule** : `COUNT(DISTINCT student_profiles.id WHERE status='active')` avec inscription sur l'année active (`student_enrollments.academic_year_id = année active`) **∪** `COUNT(DISTINCT professional_enrollments.student_id WHERE statut IN ('confirmee','terminee'))` — union sur `student_id` pour ne pas double-compter les étudiants inscrits aux deux moteurs.
- **Source** : `student_profiles`, `student_enrollments`, `academic_years`, `professional_enrollments` (tous déjà lus par `owner-personnes.service.ts` et `owner-dashboard.service.ts`).
- **Comparaison** : même date N-1 + delta vs début d'année scolaire (mesure de l'attrition en cours d'année). Le pattern `enrolledStudentsPrevMonth` existe déjà dans `ProfessionalSummaryCard`.
- **Seuil d'alerte** : rouge si perte nette > 3 % de l'effectif de rentrée depuis le 1er octobre.
- **Statut** : **[AGRÉGAT À CRÉER]** — corrige au passage l'incohérence documentée « Dashboard : Élèves inscrits » (`COUNT(*)` sur `student_profiles`, sans filtre de statut ni d'année) vs « Personnes : Étudiants actifs ».

#### KPI 5 — Taux de remplissage des cohortes

- **Formule** : `100 × SUM(nb_inscriptions_actives) / SUM(professional_ue_sessions.capacite_max)` sur les sessions dont `date_debut <= CURRENT_DATE <= date_fin`, **+** volet scolaire `100 × SUM(classes.studentCount) / SUM(classes.max_students)`.
- **Source** : `professional_ue_sessions.capacite_max` et l'agrégat `nb_inscriptions_actives` **déjà renvoyé** par `GET /api/v1/professional/ue-sessions` ; `classes.max_students` + `studentCount` **déjà renvoyés** par `GET /api/v1/classes`.
- **Comparaison** : même semestre de l'année précédente (`date_debut` pivot septembre).
- **Seuil d'alerte** : ambre < 70 % (cohorte peu rentable), rouge < 50 % (arbitrage fusion/annulation de cohorte) ; ambre aussi > 100 % (surbooking salle).
- **Statut** : **[DISPONIBLE côté données, AGRÉGAT À CRÉER côté owner]** — la donnée transite déjà dans l'UI admin sans être ni affichée ni consolidée.

#### KPI 6 — Taux de présence 30 jours

- **Formule** : `100 × COUNT(*) FILTER (WHERE statut IN ('present','retard')) / COUNT(*)` sur `professional_ecue_attendance` ⋈ `professional_ecue_seances` où `se.date >= CURRENT_DATE − 30`, agrégé **en heures** et non en pointages : `SUM(durée_séance) FILTER(présent) / SUM(durée_séance)` avec `durée = EXTRACT(EPOCH FROM (heure_fin − heure_debut))/3600` ; volet scolaire via `teacher_attendance_records` ⋈ `teacher_attendance_sessions`.
- **Source** : `professional_ecue_attendance`, `professional_ecue_seances` (`owner-assiduite.service.ts`), `teacher_attendance_records` (`owner-dashboard.service.ts`, `attendanceRate`).
- **Comparaison** : 30 jours glissants précédents (J-60 → J-31).
- **Seuil d'alerte** : vert ≥ 85 %, ambre 70-85 %, rouge < 70 % (réutilise les paliers `HeatmapGrid.stepFor` 50/70/85, ici sémantiquement corrects).
- **Statut** : **[DISPONIBLE]** en version « pointages » (`assiduite.kpis.presenceRate`) ; **[AGRÉGAT À CRÉER]** en version « heures », qui est la seule qui a un sens économique (1 h d'absence en atelier ≠ 1 h en CM). `heures_total` est déjà renvoyé par `/professional/presences/history` et jamais affiché.

#### KPI 7 — Taux de réussite du dernier semestre clos

- **Formule** : `100 × COUNT(*) FILTER (WHERE data->>'decision' = 'admis') / COUNT(*)` sur `professional_bulletins` du semestre le plus récent (CTE `last_semestre` sur `MAX(generated_at)`), restreint aux cohortes ≥ 5 étudiants (`OWNER_PEDAGOGIE_MIN_COHORT`) ; volet scolaire `100 × COUNT(moyenne >= 10) / COUNT(*)` sur `student_period_course_averages` (CTE `per_student`).
- **Source** : `professional_bulletins` (`owner-pedagogie.service.ts`), `student_period_course_averages` (`owner-academic.service.ts`).
- **Comparaison** : même semestre de la promotion précédente (S1 N vs S1 N-1), jamais S1 vs S2.
- **Seuil d'alerte** : ambre < 70 %, rouge < 55 % ; **et** alerte inverse ambre si > 97 % (suspicion de notation complaisante — un taux de réussite quasi parfait est un signal de qualité, pas une bonne nouvelle).
- **Statut** : **[DISPONIBLE]** — `pedagogie.kpis.successRate` et `dashboard.professional.successRateLastSemester` existent déjà.

#### KPI 8 — Solde net d'exploitation du mois

- **Formule** : `encaissements du mois (KPI 1) − SUM(teacher_payments.amount WHERE status IN ('calculated','approved','paid') AND COALESCE(calculated_at, created_at) ∈ mois courant) − SUM(teacher_assignments.course_amount)` pour les vacataires non encore facturés.
- **Source** : `teacher_payments` (`owner-finances.service.ts`, `payrollSql`), `teacher_assignments.course_amount`, plus KPI 1.
- **Comparaison** : M-1 et moyenne des 3 derniers mois (lissage des mois de rentrée).
- **Seuil d'alerte** : rouge si solde négatif deux mois consécutifs ; ambre si le ratio `masse salariale / encaissements` dépasse 60 %.
- **Statut** : **[AGRÉGAT À CRÉER]** pour la partie salaires+encaissements ; **[MIGRATION REQUISE]** pour un vrai résultat d'exploitation (loyer, énergie, fournitures, amortissements ne sont dans aucune table — cf. §5). Le libellé doit dire **« Solde encaissements − salaires »**, pas « marge », tant que les charges ne sont pas modélisées.

---

### 2. Tableaux de bord par domaine

Chaque domaine = un onglet ou une ancre de page, 4 à 8 indicateurs maximum, tous filtrables par le filtre global (année scolaire · cycle/filière · période) qui n'existe pas encore et doit être introduit une fois pour toutes (aujourd'hui : `useState` local répliqué sur 6 pages, deux vocabulaires d'année `academicYearId` UUID vs `anneeScolaire` libellé).

#### 2.1 Structure académique (catalogue & capacité)

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Effectif et remplissage par cycle** [AGRÉGAT À CRÉER] | `Σ student_enrollments` / `Σ classes.max_students` par `programmes.cycle_id` | `student_enrollments` ⋈ `classes` ⋈ `programmes` ⋈ `cycles` | Barres horizontales groupées (effectif) + point de capacité — l'écart barre/point se lit sans calcul mental | Ouvrir ou fermer une classe à la rentrée suivante |
| **Cycles/filières coquilles vides** [AGRÉGAT À CRÉER] | `cycles LEFT JOIN programmes HAVING COUNT(programmes)=0` ; `programmes LEFT JOIN courses HAVING COUNT=0` ; `programmes LEFT JOIN classes HAVING COUNT=0` | `cycles`, `programmes`, `courses`, `classes` | Liste d'anomalies avec lien direct vers la fiche (pas de graphique : c'est une file de travail) | Nettoyer le catalogue commercial avant campagne d'inscription |
| **Filières sans grille tarifaire** [AGRÉGAT À CRÉER] | `programmes` sans ligne `cycles_frais` correspondante | `cycles_frais` (`GET /api/v1/cycle-fees`) vs `programmes` | Compteur rouge + liste | Trou de facturation : chaque inscrit sur ces filières est facturé 0 |
| **Chiffre d'affaires théorique du catalogue** [AGRÉGAT À CRÉER] | `Σ (cycles_frais.inscription + scolarite + annexes + autres) × effectif de la filière` | `cycles_frais` + `student_enrollments` | Barres empilées par filière (composantes du tarif), triées par contribution décroissante | Repérer les 3 filières qui font 70 % du CA et protéger celles-là en priorité |
| **Écart maquette : UV déclarées vs crédits ECUE** [DISPONIBLE] | `sumNbUv <> sumCredits` par filière | `owner-referentiel.service.ts`, champs `sumNbUv` / `sumCredits` déjà renvoyés | Table avec surlignage ambre (déjà implémentée sur `/owner/referentiel`) | Corriger la maquette avant génération des bulletins, sinon crédits faux sur documents officiels |
| **Filières bloquées en validation** [AGRÉGAT À CRÉER] | `COUNT(programmes WHERE status IN ('draft','review'))` + `AVG(CURRENT_DATE − updated_at)` ; délai de validation `approved_at − created_at` | `programmes.status`, `updated_at`, `approved_at`, `approved_by` | Barres d'ancienneté par tranche (0-7 j / 7-30 j / >30 j) | Relancer nommément le responsable pédagogique ; un draft de >30 j = filière non vendable |
| **Fraîcheur du référentiel** [AGRÉGAT À CRÉER] | `COUNT(cycles/programmes créés ou modifiés sur 30 et 90 j)` | `cycles.created_at/updated_at`, `programmes.created_at/updated_at` | Sparkline mensuelle | Détecter un catalogue figé depuis 2 ans (= décrochage de l'offre) |
| **Cycles archivés portant des filières actives** [AGRÉGAT À CRÉER] | `cycles.status='archived'` ⋈ `programmes.status='active'` | `cycles`, `programmes` | Liste d'incohérences (à fusionner avec les 9 `ISSUE_META` de `/owner/referentiel`, qui passeraient à 10) | Incohérence de catalogue visible côté public : corriger sous 48 h |

#### 2.2 Personnes (élèves, enseignants, familles)

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Effectif actif par filière et statut** [DISPONIBLE] | `COUNT(DISTINCT student_id)` par `programmes` ; `student_profiles.status` | `owner-personnes.service.ts` `headcountByFiliere`, `STUDENT_SCOPE_CTE` | Barres horizontales (déjà en place) + segmentation par statut en empilé | Décider les ouvertures de classes et le dimensionnement des salles |
| **Étudiants sans inscription sur l'année active** [AGRÉGAT À CRÉER] | `student_profiles.status='active'` LEFT JOIN `student_enrollments` sur `academic_year_id` actif `WHERE se.id IS NULL` | `student_profiles`, `student_enrollments`, `academic_years` | Compteur rouge + liste exportable | File de relance de réinscription : c'est du CA récupérable à coût quasi nul |
| **Ratio étudiants / enseignant par filière** [AGRÉGAT À CRÉER] | `effectif filière / COUNT(DISTINCT professional_session_ecue_teachers.enseignant_id)` de la filière | `professional_enrollments`, `professional_session_ecue_teachers`, `teachers` | Barres avec ligne de référence à la cible de l'école (ex. 25) | Recruter ou redéployer : un ratio à 8 = filière déficitaire, un ratio à 60 = risque qualité |
| **Enseignants sans affectation active** [AGRÉGAT À CRÉER] | `teachers.status='active'` LEFT JOIN `teacher_assignments` (`status='active'`) + `professional_session_ecue_teachers` `WHERE aucun` | `teachers`, `teacher_assignments`, `professional_session_ecue_teachers` | Liste nominative + coût mensuel associé (`hourly_rate`) | Capacité payée non utilisée : redéployer ou ne pas renouveler |
| **Pyramide des anciennetés & départs à anticiper** [AGRÉGAT À CRÉER] | `EXTRACT(YEAR FROM AGE(teachers.hire_date))` par tranche ; affectations `teacher_assignments.datefin` à ≤ 60 j | `teachers.hire_date`, `teacher_assignments.datefin` | Pyramide horizontale (déjà un pattern `agePyramid` dans `/owner/personnes`) + liste des échéances | Préparer les renouvellements de contrat avant la rentrée, pas après |
| **Couverture familles** [DISPONIBLE] | `studentsWithoutParent`, `parentsWithoutChild`, `teachersWithoutAccount`, `studentsWithoutBirthDate` | `owner-personnes.service.ts` bloc `coverage` | 4 jauges compactes (une par trou), pas un donut | Un élève sans parent rattaché = famille injoignable en cas d'impayé ou d'incident |
| **Contacts d'urgence et contact principal manquants** [AGRÉGAT À CRÉER] | `student_parents.is_primary_contact` / `emergency_contact` absents pour un élève | `student_parents` | Compteur rouge par classe | Risque juridique direct ; à traiter avant chaque sortie/voyage |
| **Taux d'activation des comptes** [DISPONIBLE partiellement] | `COUNT(users WHERE initial_password IS NOT NULL)` / total, par rôle (élève, parent, enseignant) | `users.initial_password`, `users.is_active` | Entonnoir : comptes créés → identifiants générés → mot de passe changé | Un parent qui n'active pas son compte ne verra ni bulletin ni relance de paiement — c'est un canal de recouvrement gratuit perdu. **Attention** : aucune colonne ne trace l'*envoi* des identifiants (cf. §5) |

#### 2.3 Programme (UE / ECUE)

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Santé par UE** [DISPONIBLE] | Étudiants, moyenne, `validationRate`, `eliminatedRate`, `session2Rate` par UE | `owner-pedagogie.service.ts` `ueHealth` (`professional_ecue_results`) | Table triable + colonne « barre dans la cellule » pour le taux de validation | Cibler une UE dont le taux de validation < 60 % : problème d'enseignant, de volume horaire ou de niveau d'entrée |
| **ECUE les plus échouantes** [DISPONIBLE] | `failed = validee=false`, `eliminated = eliminee`, `HAVING evaluated >= 5`, top 15 | `professional_ecue_results` ⋈ `professional_ecue` | Barres horizontales empilées (échecs / éliminatoires) — déjà en place, mais **augmenter `width` de l'axe Y** (150 px actuellement, tronque `CODE — Libellé`) | Décider un soutien, un changement d'enseignant ou une refonte du programme |
| **UE sans ECUE / ECUE orphelines / crédits nuls** [DISPONIBLE] | 9 `kind` d'incohérences déjà calculés | `owner-referentiel.service.ts` (`issues`, `issueCounts` — attention `LIMIT 50` par type, donc `issueCounts` est plafonné) | Liste par gravité (critical/warning/info) + **compteur réel non plafonné** (à corriger en `COUNT(*)` séparé) | File de travail du responsable pédagogique, avec date butoir avant génération des bulletins |
| **Couverture pédagogique : ECUE sans support de cours** [AGRÉGAT À CRÉER] | `100 × COUNT(ECUE sans ligne professional_ecue_materials) / COUNT(ECUE actives)` ; nb moyen de supports/ECUE | `professional_ecue_materials`, `professional_ecue` | Jauge + liste des ECUE à zéro support | Argument commercial et qualité : une ECUE sans support est invendable en formation continue |
| **Taux de consultation réel des supports** [AGRÉGAT À CRÉER] | `COUNT(DISTINCT student_id ayant ouvert ≥ 1 support) / effectif inscrit à l'ECUE` | `professional_ecue_material_views` ⋈ `professional_enrollments` | Barres horizontales par ECUE, ligne de référence à 50 % | Support jamais ouvert = temps enseignant gaspillé ou support introuvable dans l'UI |
| **Mutualisation des ECUE** [DISPONIBLE] | `COUNT(DISTINCT ue_id) > 1` par ECUE | `professional_ue_ecue` (`ecueMutualisation`, `LIMIT 20`) | Barres horizontales (en place) | Une ECUE mutualisée sur 5 UE justifie un enseignant dédié à plein temps plutôt que 5 vacations |
| **ECUE obligatoires sans enseignant** [DISPONIBLE] | Session `ouvert|complet|en_cours` + `est_obligatoire` + `NOT EXISTS professional_session_ecue_teachers` | `owner-assiduite.service.ts` `unassignedEcue` (`LIMIT 50`) | Carte rouge en tête de page (en place) + compteur non tronqué | Risque opérationnel immédiat : cours non assuré, remboursement possible |
| **Volume horaire planifié vs crédits déclarés par ECUE** [AGRÉGAT À CRÉER] | `Σ (heure_fin − heure_debut)` sur `professional_emploi_temps` par ECUE, rapporté à `professional_ecue.credits` | `professional_emploi_temps`, `professional_ecue.credits` | Nuage de points (crédits en X, heures planifiées en Y) — révèle d'un coup les ECUE sur/sous-dotées | Rééquilibrer la maquette : une ECUE à 2 crédits et 60 h coûte plus qu'elle ne rapporte |

#### 2.4 Sessions & Planning

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Taux de remplissage par session** [DISPONIBLE non affiché] | `nb_inscriptions_actives / capacite_max` | `GET /professional/ue-sessions` (agrégat déjà calculé par `adminListSessions`) | Barres horizontales triées croissant, seuils colorés 50/70 (`recoveryColor` réutilisable) | Fusionner, annuler ou promouvoir une cohorte **avant** sa date de début |
| **Sessions ouvertes à zéro inscrit** [DISPONIBLE non affiché] | `nb_inscriptions_actives = 0 AND statut IN ('ouvert','complet')` | `professional_ue_sessions`, `professional_enrollments` | Liste rouge avec `date_debut` et jours restants | Décision go/no-go : chaque session vide ouverte immobilise une salle et un enseignant |
| **Occupation des salles** [DISPONIBLE] | `Σ heures planifiées / (salles actives × 72 h)` (`OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK`) | `professional_emploi_temps` ⋈ `classrooms` | Heatmap jour × heure (en place) — **mais recalibrer `stepFor`** : les seuils 50/70/85 sont ceux de la présence, pour l'occupation 85 % est une saturation, pas une réussite | Arbitrer un investissement immobilier vs une réorganisation des créneaux |
| **Salles jamais utilisées** [DISPONIBLE] | `roomUsage` avec `heures/semaine = 0` (LEFT JOIN volontaire) | `classrooms` LEFT JOIN `professional_emploi_temps` | Table (en place, `slice(0,20)` à remplacer par une pagination) | Actif immobilier dormant : sous-louer, reconvertir ou fermer |
| **Conflits de planning (salle / enseignant)** [AGRÉGAT À CRÉER] | Auto-jointure `professional_emploi_temps` sur (`classroom_id` ou `enseignant_id`, `jour`) avec chevauchement `heure_debut/heure_fin` et recoupement `date_debut/date_fin` | `professional_emploi_temps` | Liste rouge (aucune détection n'existe aujourd'hui à la création d'un créneau) | Bug opérationnel qui se voit en salle : à bloquer à la saisie, pas à constater |
| **Créneaux sans salle ou sans enseignant** [AGRÉGAT À CRÉER] | `COUNT(classroom_id IS NULL)` / `COUNT(enseignant_id IS NULL)` sur le semestre | `professional_emploi_temps` | Deux compteurs + barre de complétude du planning par semestre | Indicateur « prêt pour la rentrée » : doit atteindre 0 à J-7 |
| **Couverture du planning** [AGRÉGAT À CRÉER] | `COUNT(DISTINCT ECUE programmées) / COUNT(ECUE du semestre)` | `professional_ue_ecue` vs `professional_emploi_temps` | Jauge par semestre | Combien de matières n'ont toujours pas d'horaire |
| **Écart planifié vs tenu** [AGRÉGAT À CRÉER] | `Σ heures professional_ecue_seances tenues / Σ heures professional_emploi_temps` sur la même fenêtre | `professional_emploi_temps` (planifié) vs `professional_ecue_seances` (tenu) | Courbe hebdomadaire des deux séries superposées | Mesure du respect du programme : un écart durable > 15 % justifie un remboursement partiel ou une sanction |

#### 2.5 Inscriptions & Paiements

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Entonnoir d'inscription complet** [DISPONIBLE partiel] | `registration_requests reçues → validées → comptes créés → identifiants générés` **puis** `professional_enrollments créées → confirmées → payées → terminées` | `owner-recrutement.service.ts` `funnel` + `owner-finances-pro.service.ts` `enrollmentFunnel` | Entonnoir unique en 8 étapes (aujourd'hui 2 entonnoirs sur 2 pages, avec 2 implémentations CSS dupliquées) | Identifier l'étape qui fuit : si 200 demandes → 40 payées, le problème n'est pas le marketing |
| **Courbe de trésorerie** [AGRÉGAT À CRÉER] | Encaissements par jour/semaine/mois, `payment_transactions.processed_at` + `professional_payments.paid_at` | `payment_transactions`, `professional_payments` | Courbe cumulée avec la même période N-1 en série grisée | Anticiper le mois où la caisse ne couvrira pas la paie |
| **Répartition par mode de règlement** [DISPONIBLE] | `SUM(montant)` par `professional_payments.mode` (espèces / mobile money / virement / autre) | `owner-finances-pro.service.ts` `byPaymentMode` | Donut avec encaissé au centre (en place) | Négocier les frais Mobile Money, sécuriser le circuit espèces (risque de fuite de caisse) |
| **Balance âgée des impayés** [AGRÉGAT À CRÉER] | Reste dû ventilé en 0-30 / 31-60 / 61-90 / >90 j, base `student_tuition_installments.due_date` (scolaire) et `professional_enrollments.created_at` (pro) | `student_tuition_installments`, `professional_orders`, `professional_payments`, `professional_enrollments` | Barres empilées par tranche d'âge, une pile par filière | Prioriser les relances : la probabilité de recouvrement s'effondre après 90 j |
| **Top débiteurs** [DISPONIBLE] | `due − paid > 0,5` (`OWNER_FINANCES_PRO_SETTLED_EPSILON`), top 20 | `topUnpaid` (`per_student` ⋈ `student_profiles` ⋈ `users`) | Table (en place) + montant cumulé du top 20 en % du reste total | Décider les convocations familles et les blocages d'accès aux examens |
| **Délai inscription → premier paiement** [AGRÉGAT À CRÉER] | `AVG(MIN(professional_payments.paid_at) − professional_enrollments.created_at)` par filière | `professional_enrollments`, `professional_payments` | Barres horizontales par filière + médiane | Ajuster la politique d'acompte : au-delà de 30 j, exiger un acompte à l'inscription |
| **Commandes « payées » sans ligne de paiement** [AGRÉGAT À CRÉER] | `professional_orders.statut='payee'` avec `COUNT(professional_payments)=0` | `professional_orders`, `professional_payments` | Liste rouge (contrôle d'écart de caisse) | Détection de fraude ou d'erreur de saisie : chaque ligne est un encaissement fantôme |
| **Journal de caisse exportable** [AGRÉGAT À CRÉER] | Liste des reçus émis sur la période : `receipt_number`, montant, mode, étudiant, encaisseur | `professional_payments.receipt_number/receipt_url` | Table paginée + export CSV **et PDF** (aujourd'hui seul le rapport financier a un PDF) | Contrôle interne mensuel et pièce comptable ; indispensable en audit |

#### 2.6 Suivi & Évaluation

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Taux de réussite et décisions par filière** [DISPONIBLE] | `admis / rattrapage / ajourne` par filière | `owner-pedagogie.service.ts` `decisionsByFiliere` (`professional_bulletins`) | Barres empilées 100 % (en place) — passer en part relative pour comparer des filières d'effectifs différents | Fermer, refondre ou renforcer une filière dont le taux d'ajournement dépasse 25 % |
| **Évolution de la moyenne par semestre** [DISPONIBLE] | `AVG(moyenne_session)` par (semestre, filière), domaine `[0,20]`, max 8 séries | `professional_bulletins`, `averagesBySemestre` | Courbes (en place) — **attention** : tri par libellé, aucune colonne d'ordre sur `professional_semestres` (cf. §5) | Détecter une chute de niveau d'une promotion et intervenir avant le diplôme |
| **Avancement de la saisie des notes** [AGRÉGAT À CRÉER] | `COUNT(ECUE avec notes saisies) / COUNT(ECUE attendues)` par UE, par ECUE et **par enseignant** | `professional_ecue_notes`, `professional_session_ecue_teachers` | Barres horizontales nominatives par enseignant, triées croissant | Relancer nommément les 3 enseignants qui bloquent la génération de tous les bulletins |
| **Avancement de la saisie des conduites** [DISPONIBLE non affiché] | `nb_conduites_manquantes` déjà agrégé par filière par `listConduiteFilieres` | `professional_ecue_notes` sur l'ECUE Conduite | Liste des semestres classés par « nombre de conduites manquantes » croissant | Débloquer en priorité les semestres où il ne manque que 2 ou 3 conduites |
| **Taux d'appels effectués par enseignant** [AGRÉGAT À CRÉER] | `COUNT(séances avec ≥ 1 pointage) / COUNT(séances passées)` par `enseignant_id` | `professional_ecue_seances`, `professional_ecue_attendance` (`callRate` existe en global) | Barres horizontales nominatives + ligne de référence à 90 % | Indicateur de discipline pédagogique : sans appel, aucune donnée d'assiduité n'est fiable |
| **Corrélation assiduité / résultats** [AGRÉGAT À CRÉER] | Nuage (heures d'absence en X, moyenne en Y) par étudiant, avec droite de tendance | `professional_ecue_attendance` × `professional_ecue_results.moyenne` | Nuage de points, un point par étudiant, couleur par décision | Justifier auprès des familles la politique d'assiduité avec un chiffre, pas un discours |
| **Distribution des notes de conduite** [AGRÉGAT À CRÉER] | Histogramme des notes de conduite par filière/semestre | `professional_ecue_notes` (nature `examen` sur ECUE Conduite) | Histogramme par filière, superposé | Repérer les notateurs anormalement généreux ou sévères (tous à 15/20 = notation non discriminante) |
| **Devoirs corrigés** [DISPONIBLE] | `100 × COUNT(status='graded') / COUNT(*)` | `assignment_submissions` (`owner-academic.service.ts`) | Jauge + série mensuelle | Un taux < 70 % signale une surcharge enseignante ou un désengagement |

#### 2.7 Documents officiels

| Indicateur | Formule | Source | Visualisation | Actionnabilité |
|---|---|---|---|---|
| **Bulletins définitifs vs provisoires** [DISPONIBLE] | `finalBulletinRate = COUNT(statut='definitif') / COUNT(*)` | `professional_bulletins` (`owner-pedagogie.service.ts` `kpis`) | Jauge par semestre + liste des semestres à 0 bulletin (bandeau ambre déjà présent) | Un semestre sans bulletin définitif bloque diplômes, attestations et réinscriptions |
| **Pipeline de diplomation par filière** [AGRÉGAT À CRÉER] | `diplômes octroyés / candidats` et distribution du champ `pourcentage` des candidats | `GET /professional/diplomas/:id/candidates` (`statut_octroi`, `pourcentage`), `uv_required` | Entonnoir par filière : candidats → éligibles (100 % UV) → octroyés | Détecter les étudiants éligibles jamais diplômés — dossier fini, document non émis, client mécontent |
| **UE bloquantes pour le diplôme** [AGRÉGAT À CRÉER] | Fréquence des UE présentes dans `ue_restantes` sur l'ensemble des candidats d'un diplôme | `GET /professional/diplomas/:id/students/:studentId/progress` | Barres horizontales des UE les plus fréquemment manquantes | Ouvrir une session de rattrapage sur les 2 UE qui bloquent 80 % de la promotion |
| **Reçus émis vs paiements enregistrés** [AGRÉGAT À CRÉER] | `COUNT(professional_payments WHERE receipt_number IS NULL) / COUNT(*)` | `professional_payments.receipt_number` | Compteur rouge + liste | Paiement sans reçu = contentieux garanti avec la famille |
| **Identifiants générés vs transmis** [MIGRATION REQUISE] | `COUNT(users.initial_password IS NOT NULL)` comme proxy ; l'envoi n'est **pas** tracé (documenté dans `owner-personnes.service.ts`) | `users.initial_password` | Entonnoir en 3 étapes dont la dernière est explicitement marquée « non mesurée » | Tant que la colonne d'envoi n'existe pas, ne pas prétendre mesurer la transmission (cf. §5) |
| **Complétude des dossiers pour édition de documents** [AGRÉGAT À CRÉER] | Part d'élèves sans date/lieu de naissance, sans matricule, sans photo — champs obligatoires des PDF | `student_profiles.date_of_birth`, `place_of_birth`, `student_matricule`, `birth_certificate_number` | Barres de complétude par champ, triées | Un champ manquant = un diplôme non imprimable le jour de la cérémonie |
| **Volume et disponibilité des exports** [DISPONIBLE partiel] | Nombre d'exports générés, et disponibilité du moteur PDF (503 si Chrome absent, `PDFGenerationService`) | `GET /api/v1/owner/reports/financial` | Badge d'état du service PDF dans l'écran d'export | Le propriétaire doit savoir que le PDF est cassé **avant** le conseil d'administration |

---

### 3. Indicateurs avancés (fort ROI propriétaire)

#### 3.1 Cohortes & rétention

- **Rétention inter-semestres (pro)** — `étudiants inscrits au semestre N+1 / étudiants ayant terminé le semestre N`, par filière et par promotion. Source : `professional_enrollments` (`student_id`, `statut`) ⋈ `professional_ue_sessions.date_debut` ⋈ `professional_semestre_sessions`. **[AGRÉGAT À CRÉER]** — entièrement calculable, aucune colonne ne manque.
- **Réinscription annuelle (scolaire)** — `élèves présents en N-1 ET en N / élèves présents en N-1`, par cycle. Source : `student_enrollments.academic_year_id` + `student_profiles.status`. **[AGRÉGAT À CRÉER]**.
- **Courbe de survie de cohorte** (rentrée = 100 %, décroissance mois par mois) : **[AGRÉGAT À CRÉER]** approximable via `professional_enrollments.statut='annulee'` + `updated_at`, mais **[MIGRATION REQUISE]** pour être exacte — aucune table n'historise les changements de statut d'un élève (départ, transfert, exclusion) ni leur date ni leur motif.

#### 3.2 LTV élève

- **Formule** : `LTV = panier moyen annuel × durée moyenne de présence (en années)`. Panier annuel = `Σ (cycles_frais composantes)` (scolaire) + `Σ professional_orders.montant_total` (pro) par étudiant. Durée = `AVG(date de dernière inscription − date de première inscription)` par cohorte de sortie.
- **Source** : `cycles_frais`, `professional_orders`, `student_enrollments.enrollment_date`, `professional_enrollments.created_at`.
- **Statut** : **[AGRÉGAT À CRÉER]** pour une LTV « réalisée » (basée sur l'encaissé, la plus honnête) ; **[MIGRATION REQUISE]** pour une LTV prédictive fiable, qui exige l'historique de statut ci-dessus et une date de sortie explicite.
- **Corollaire immédiat** : **détection des fratries** (`student_parents` groupé par `parent_id` avec ≥ 2 enfants) → base de calcul d'une remise fratrie et mesure de la LTV **par famille**, qui est la bonne unité économique en Afrique de l'Ouest. **[AGRÉGAT À CRÉER]**.

#### 3.3 Recouvrement par échéance

- **Formule** : par rang d'échéance (1re, 2e, 3e tranche), `taux payé à l'échéance` et `taux payé à +30 j`. Source : `student_tuition_installments` (`due_date`, `amount`, `amount_paid`, `status`).
- **Statut** : **[AGRÉGAT À CRÉER]** côté scolaire — tout est en base.
- Côté professionnel : **[MIGRATION REQUISE]**. `professional_orders` porte un `montant_total` mais **aucune date d'échéance ni échéancier** : impossible de dire si un paiement est « en retard », seulement s'il est « incomplet ». C'est le trou le plus coûteux du modèle de données financier.

#### 3.4 Marge par filière

- **Formule** : `revenu encaissé de la filière − (coût enseignant direct + quote-part des charges fixes)`.
  - Revenu : **[DISPONIBLE]** — `recoveryByFiliere` répartit déjà l'encaissé au prorata (`owner-finances-pro.service.ts`, CTE `enrollment_share`).
  - Coût enseignant direct : **[AGRÉGAT À CRÉER]** — `teacher_assignments.course_amount` + `teaching_hours.hours_taught × teachers.hourly_rate` + `teacher_payments.amount`, rattachés à la filière via `professional_session_ecue_teachers` ⋈ `professional_ue.filiere_id`.
  - Charges fixes (loyer, énergie, administratif, amortissements) : **[MIGRATION REQUISE]** — aucune table de dépenses n'existe.
- **Verdict honnête à afficher dans l'UI** : tant que la table de dépenses n'existe pas, l'indicateur doit s'appeler **« marge brute pédagogique »** et non « marge », avec la méthodologie en `hint` — le profil owner a déjà l'habitude de documenter ses écarts (encart ambre `includesConduite`).

#### 3.5 Taux d'occupation des salles

- **Formule** : `Σ heures planifiées / (salles actives × 72 h)` — **[DISPONIBLE]** (`owner-assiduite.service.ts`, `roomOccupancyRate`, constantes `OPEN_HOURS_PER_DAY=12`, `OPEN_DAYS=6`).
- **Enrichissement à créer** : adéquation capacité/effectif — comparer `classrooms.capacity` à l'effectif de la session occupant le créneau (`professional_emploi_temps.classroom_id` → `ue_session_id` → `COUNT(professional_enrollments)`). **[AGRÉGAT À CRÉER]** : révèle les cours à 12 étudiants dans un amphi de 120 places.
- **Capacité perdue** : `Σ capacity` des salles en `status='maintenance'` ou hors service. **[AGRÉGAT À CRÉER]**.

#### 3.6 Charge enseignante

- **Heures/semaine par enseignant** — **[DISPONIBLE]** (`teacherLoad`, `LIMIT 30`, à dé-plafonner).
- **Coût horaire réel par filière** — `Σ (heures × hourly_rate) / heures` par filière : **[AGRÉGAT À CRÉER]** (`teachers.hourly_rate`, `professional_emploi_temps`, `professional_ue.filiere_id`).
- **Heures déclarées vs validées et délai de validation** — `teaching_hours.hours_taught`, `validated_at`, `validated_by` : **[AGRÉGAT À CRÉER]**. Un écart déclaré/validé important = litige de paie en préparation.
- **Surcharge/sous-emploi** — seuils : ambre > 22 h/semaine, rouge > 28 h ; ambre < 6 h (vacataire sous-utilisé mais rémunéré au forfait). **[AGRÉGAT À CRÉER]**.

#### 3.7 Détection du risque de décrochage

- **Score composite par étudiant** (0-100), calculé sur 4 signaux tous disponibles :
  1. heures d'absence sur 30 j (`professional_ecue_attendance` × durée séance) — poids 35 % ;
  2. moyenne courante < 10 ou ≥ 1 note éliminatoire < 5 (`professional_ecue_results.moyenne`, `eliminee`) — poids 30 % ;
  3. reste à payer > 0 depuis > 45 j (`professional_orders` − `professional_payments`) — poids 25 % ;
  4. aucune consultation de support de cours sur 30 j (`professional_ecue_material_views.opened_at`) — poids 10 %.
- **Statut** : **[AGRÉGAT À CRÉER]** — les 4 signaux sont en base, aucune migration n'est nécessaire pour la version 1. Sortie : liste nominative triée, exportable, avec le motif dominant par étudiant.
- **Actionnabilité** : c'est le seul indicateur qui produit une **liste d'appels téléphoniques à passer cette semaine**. Un décrochage évité = une année de scolarité conservée = la meilleure ligne de CA de l'école.

#### 3.8 Prévision de trésorerie (13 semaines)

- **Entrées prévues** : `Σ student_tuition_installments (amount − amount_paid) WHERE due_date ∈ [J, J+13 semaines]`, pondéré par le taux de recouvrement historique observé sur le même rang d'échéance (§3.3). **[AGRÉGAT À CRÉER]** côté scolaire.
- **Entrées prévues côté pro** : **[MIGRATION REQUISE]** — sans échéancier sur `professional_orders`, la prévision se réduit à une extrapolation du rythme des 8 dernières semaines de `professional_payments.paid_at` (acceptable en v1, à annoncer comme telle).
- **Sorties prévues** : `teacher_payments` en `calculated`/`approved` non payés + `teacher_assignments.course_amount` des affectations actives sur la période. **[AGRÉGAT À CRÉER]**. Les charges non salariales manquent (**[MIGRATION REQUISE]**).
- **Visualisation** : courbe de solde cumulé hebdomadaire avec bande d'incertitude (scénario 70 % / 85 % / 100 % de recouvrement) et ligne de zéro. Le point où la courbe croise zéro est **le chiffre le plus important du tableau de bord**.

---

### 4. Alertes & signaux faibles

Socle existant : table `owner_pilotage_alerts` + `syncOwnerPilotageAlerts()` appelé par `GET /api/v1/owner/alerts`, acquittement par `PATCH /alerts/:id/acknowledge`. Trois corrections préalables : afficher les sévérités en français (aujourd'hui `high`/`medium`/`low` bruts), corriger le bouton « Acquitter » de `AlertsPanel.tsx:36-38` qui est en réalité un lien, et ajouter le domaine + le lien profond vers l'écran d'action.

| # | Alerte | Règle de déclenchement | Gravité | Source | Statut |
|---|---|---|---|---|---|
| 1 | **Trésorerie sous le seuil de paie** | `encaissements 30 j prévus + solde estimé < masse salariale du mois` | Critique | `payment_transactions`, `professional_payments`, `teacher_payments` | [AGRÉGAT À CRÉER] |
| 2 | **Impayé > 90 jours** | `student_tuition_installments.due_date < CURRENT_DATE − 90 AND amount > amount_paid` | Critique | `student_tuition_installments` | [AGRÉGAT À CRÉER] (le seuil actuel du dashboard est 60 j sur `overdueCount`) |
| 3 | **Taux de recouvrement d'une filière < 50 %** | `recoveryByFiliere.rate < 50` avec effectif ≥ 10 | Critique | `owner-finances-pro.service.ts` `recoveryByFiliere` | [DISPONIBLE] |
| 4 | **ECUE obligatoire sans enseignant sur session ouverte** | `unassignedEcue` non vide sur une session dont `date_debut <= CURRENT_DATE + 7 j` | Critique | `professional_session_ecue_teachers`, `professional_ue_sessions` | [DISPONIBLE] |
| 5 | **Session ouverte à 0 inscrit à J-7** | `nb_inscriptions_actives = 0 AND date_debut − CURRENT_DATE <= 7` | Élevée | `professional_ue_sessions`, `professional_enrollments` | [DISPONIBLE non affiché] |
| 6 | **Cohorte sous 50 % de remplissage à J-7** | `nb_inscriptions_actives / capacite_max < 0,5` | Élevée | idem | [DISPONIBLE non affiché] |
| 7 | **Commande `payee` sans paiement** | `professional_orders.statut='payee' AND COUNT(professional_payments)=0` | Critique (fraude/caisse) | `professional_orders`, `professional_payments` | [AGRÉGAT À CRÉER] |
| 8 | **Paiement sans reçu depuis > 48 h** | `professional_payments.receipt_number IS NULL AND paid_at < now() − 48 h` | Élevée | `professional_payments` | [AGRÉGAT À CRÉER] |
| 9 | **Classe/filière sous la moyenne de risque** | `AVG(moyenne) < 10` sur `student_period_course_averages` (`OWNER_ACADEMIC_RISK_GRADE_THRESHOLD`) | Élevée | `owner-academic.service.ts` `atRiskClasses` | [DISPONIBLE] |
| 10 | **Chute du taux de présence** | `présence 7 j < présence 30 j − 10 points` sur une filière | Élevée | `professional_ecue_attendance` × `professional_ecue_seances` | [AGRÉGAT À CRÉER] |
| 11 | **Étudiant à risque de décrochage** | score composite §3.7 ≥ 70 | Élevée | 4 sources §3.7 | [AGRÉGAT À CRÉER] |
| 12 | **Appels non faits par un enseignant** | `taux d'appels < 60 %` sur 30 j, séances passées ≥ 5 | Moyenne | `professional_ecue_seances`, `professional_ecue_attendance` | [AGRÉGAT À CRÉER] |
| 13 | **Conduites manquantes bloquant les bulletins** | `nb_conduites_manquantes > 0` sur un semestre dont toutes les sessions sont `termine` | Élevée | `professional_ecue_notes`, `listConduiteFilieres` | [DISPONIBLE non affiché] |
| 14 | **Notes non saisies à J+15 de fin de session** | ECUE d'une session `termine` sans aucune ligne `professional_ecue_notes` depuis 15 j | Élevée | `professional_ecue_notes`, `professional_ue_sessions.date_fin` | [AGRÉGAT À CRÉER] |
| 15 | **Conflit de planning** | même `enseignant_id` ou `classroom_id`, même `jour`, plages horaires et périodes qui se chevauchent | Moyenne | `professional_emploi_temps` | [AGRÉGAT À CRÉER] |
| 16 | **Filière sans grille tarifaire avec des inscrits** | `programmes` sans `cycles_frais` mais avec ≥ 1 `student_enrollments` | Critique | `cycles_frais`, `programmes`, `student_enrollments` | [AGRÉGAT À CRÉER] |
| 17 | **Écart maquette UV ≠ crédits ECUE** | `sumNbUv <> sumCredits` sur une filière ayant des bulletins à générer | Moyenne | `owner-referentiel.service.ts` | [DISPONIBLE] |
| 18 | **Paie en attente de validation > 10 jours** | `teacher_payments.status='calculated' AND approved_at IS NULL AND calculated_at < now() − 10 j` | Moyenne | `teacher_payments` (`payrollPending`) | [DISPONIBLE non temporisé] |
| 19 | **Demandes d'inscription en attente > 7 jours** | `registration_requests.status='pending' AND created_at < now() − 7 j` | Moyenne | `registration_requests` | [DISPONIBLE] (`kpis.pending`, sans critère d'âge) |
| 20 | **Taux de réussite anormalement élevé** | `successRate > 97 %` sur une cohorte ≥ 20 | Faible (signal faible) | `professional_bulletins` | [AGRÉGAT À CRÉER] |
| 21 | **Support de cours jamais consulté 30 j après dépôt** | `professional_ecue_materials.created_at < now() − 30 j` sans `professional_ecue_material_views` | Faible | `professional_ecue_materials`, `..._views` | [AGRÉGAT À CRÉER] |
| 22 | **Salle active à 0 h/semaine sur 4 semaines** | `roomUsage.weeklyHours = 0` persistant | Faible | `classrooms`, `professional_emploi_temps` | [DISPONIBLE] |

**Règles de gouvernance des alertes** : une alerte n'est utile que si elle est (a) datée, (b) chiffrée, (c) cliquable vers l'écran qui permet d'agir, (d) acquittable avec traçabilité, (e) auto-résolue quand la condition disparaît. Le plafond `LIMIT 50` sur les alertes non acquittées doit devenir un regroupement par type avec compteur, sinon 200 impayés noient les 3 alertes critiques.

---

### 5. Ce qui manque en base

| Indicateur souhaité | Donnée manquante | Migration suggérée |
|---|---|---|
| Recouvrement par échéance et balance âgée côté professionnel | Aucune date d'échéance ni échéancier sur `professional_orders` (seulement `montant_total`) | `0095_professional_payment_schedule.sql` : table `professional_order_installments (id, tenant_id, order_id, rang, montant, due_date, status)` + backfill à partir de `professional_orders.montant_total` et `professional_ue_sessions.date_debut` |
| Marge par filière, résultat d'exploitation réel, prévision de trésorerie complète | Aucune table de dépenses (loyer, énergie, fournitures, amortissements, charges administratives) | `0096_expenses.sql` : `expense_categories` + `expenses (id, tenant_id, category_id, programme_id NULL, amount, currency, incurred_on, paid_on, supplier, notes)` avec RLS |
| Taux de redoublement, progression des cohortes | `student_profiles.is_repeating` n'existe dans **aucune** migration (limite documentée dans `owner-personnes.service.ts`) | `0097_student_repeating_flag.sql` : `ALTER TABLE student_profiles ADD COLUMN is_repeating boolean NOT NULL DEFAULT false` + index partiel |
| Courbe de survie de cohorte, taux d'abandon daté, motif de départ | Aucun historique des changements de statut élève (`student_profiles.status` est écrasé) | `0098_student_status_history.sql` : `student_status_history (id, tenant_id, student_id, old_status, new_status, reason_code, reason_text, changed_by, changed_at)` + trigger sur `student_profiles` |
| Taux de transmission des identifiants (≠ génération) | Aucune colonne ne trace l'**envoi** des identifiants, seulement leur génération (`users.initial_password`) | `0099_credentials_delivery.sql` : `ALTER TABLE users ADD COLUMN credentials_sent_at timestamptz, ADD COLUMN credentials_sent_channel text CHECK (in ('email','sms','whatsapp','paper'))` — les services `student-credentials-email.ts` / `teacher-credentials-email.ts` les alimentent |
| Tri chronologique fiable des semestres, évolution S1→S2→S3 | `professional_semestres` n'a aucune colonne d'ordre (tri par libellé aujourd'hui) | `0100_semestre_ordering.sql` : `ALTER TABLE professional_semestres ADD COLUMN ordre smallint` + backfill par extraction numérique du libellé |
| Isolation multi-tenant du pilotage pédagogique | `professional_bulletins` **n'a pas de RLS** (documenté, migration 0083) — seul un `WHERE tenant_id = $1` protège | `0101_rls_professional_bulletins.sql` : `ENABLE ROW LEVEL SECURITY` + policy tenant, alignée sur les autres tables `professional_*` |
| Occupation réelle des salles côté scolaire | `professional_emploi_temps` ne couvre que le module pro ; le scolaire n'a pas de grille horaire exploitée, et `classroom_reservations` n'est écrite par aucune UI | `0102_classroom_usage.sql` : soit alimenter `classroom_reservations` depuis les écrans de planning, soit vue matérialisée `classroom_usage_weekly` unifiant `professional_emploi_temps` + `classroom_reservations` |
| Coût enseignant rattaché à une filière | `teacher_payments` et `teaching_hours` ne portent ni `programme_id` ni `ue_id` : le rattachement passe par des jointures fragiles | `0103_payroll_cost_center.sql` : `ALTER TABLE teacher_payments ADD COLUMN programme_id uuid REFERENCES programmes(id)`, idem `teaching_hours` |
| Capacité réelle d'une classe (remplissage scolaire) | `classes.max_students` existe mais n'est jamais contrôlé ni obligatoire → nombreux NULL | `0104_classes_capacity_not_null.sql` : backfill puis `SET NOT NULL` + `CHECK (max_students > 0)` |
| Fiabilité des totaux financiers | Les totaux `overdueCount`/`overdueAmount` sont sommés en TypeScript sur une requête `LIMIT 200` | Pas de migration : correctif dans `owner-finances.service.ts` — requête d'agrégat séparée sans `LIMIT`, et idem pour `issueCounts` (`LIMIT 50`) dans `owner-referentiel.service.ts` |
| Performance des tableaux de bord consolidés | Les KPI de la barre haute agrègent 6-8 tables volumineuses à chaque chargement | `0105_owner_pulse_matview.sql` : vue matérialisée `owner_pulse_daily` rafraîchie toutes les 15 min (`REFRESH MATERIALIZED VIEW CONCURRENTLY`), avec colonne `computed_at` exposée dans l'UI comme « données au … » |

---

#### Séquencement recommandé

1. **Sprint 1 — le pouls** : endpoint `/owner/pulse` + les 8 KPI (6 sur 8 sont des agrégats à écrire sur des colonnes existantes), filtre global unique (année · cycle/filière · période) partagé par toutes les pages, correction du bouton « Acquitter » trompeur et du plafond `LIMIT 200` sur les totaux financiers.
2. **Sprint 2 — l'argent** : balance âgée, courbe de trésorerie, journal de caisse, commandes payées sans paiement, alertes 1-3 et 7-8. Migration `0095` (échéancier pro) en parallèle.
3. **Sprint 3 — le remplissage** : taux de remplissage des cohortes et des classes (données déjà disponibles, jamais affichées), sessions vides, conflits de planning, alertes 4-6 et 15.
4. **Sprint 4 — la qualité et le risque** : score de décrochage, avancement de saisie notes/conduites par enseignant, corrélation assiduité/résultats, alertes 10-14.
5. **Sprint 5 — l'économie** : marge brute pédagogique par filière, LTV famille, rétention, prévision 13 semaines — conditionné aux migrations `0096` (dépenses) et `0098` (historique de statut).


---

## 5. Prompt à donner à Claude Code pour la refonte

> Copier-coller le bloc ci-dessous tel quel dans une nouvelle session Claude Code, à la racine du dépôt.

````markdown
# Refonte du profil Propriétaire (owner) — EcoleDigitale

## Contexte

Monorepo pnpm : Fastify API (`apps/api`), Next.js 15 App Router (`apps/web`), contrats Zod
(`packages/contracts`), PostgreSQL avec RLS, migrations SQL dans `infra/scripts/migrations`.

Lis **impérativement** `docs/refonte-owner-menus-et-statistiques.md` avant de coder :
il documente les 22 pages du périmètre (fonctionnalités réelles, endpoints, dettes constatées),
l'inventaire de l'existant owner, et le plan de statistiques à implémenter. Ne redécouvre pas
ce qui y est déjà écrit ; vérifie seulement que le code n'a pas changé depuis.

## Objectif

Faire du profil owner un **vrai compte propriétaire** : un poste de pilotage qui répond, dans
cet ordre, à quatre questions — *est-ce que l'argent rentre ?* → *est-ce que les effectifs
tiennent ?* → *est-ce que la machine pédagogique tourne ?* → *où est-ce que je perds de
l'argent sans le voir ?*

Deux volets indissociables :

1. **Le menu** est réduit aux deux sections `Structure Académique` et `Module Professionnel`
   du catalogue, moins trois entrées.
2. **Les statistiques** couvrent l'intégralité de ce périmètre, avec une refonte UI/UX.

## Volet 1 — Le menu (à faire en premier, c'est la fondation)

Le menu cible est **exactement** `ADMIN_MENU_CATALOG`
(`packages/contracts/src/admin-roles.schema.ts`, ligne 32), sections `Structure Académique`
et `Module Professionnel`, **moins** ces trois entrées :

| Clé à retirer | Libellé | Route |
| --- | --- | --- |
| `academic.bilan_types` | Types de Bilan | `/annee-academique/types-de-bilan` |
| `academic.courses` | Matières | `/academic/courses` |
| `people.registrations` | Inscriptions en ligne | `/academic/registrations` |

Structure finale (22 pages) :

```
Structure Académique
  Cycles & Programmes : Vue d'ensemble · Cycles · Filières
  Personnes           : Enseignants · Étudiants · Parents
Module Professionnel
  Programme           : UE · ECUE · Semestres
  Sessions & Planning : Sessions · Salles de classe · Planning des cours
  Étudiants           : Inscriptions · Étudiants inscrits · Paiements
  Suivi & Évaluation  : Présences · Conduite · Notes · Bulletins
  Documents officiels : Attestations de réussite · Diplômes · Signataires
```

Règles impératives :

- Les `key` des entrées conservées **ne changent jamais** (elles sont persistées dans
  `admin_role_menus.menu_key`).
- Le découpage en groupes de la sidebar (`Sidebar.tsx`) doit rester **strictement aligné** sur
  les groupes du catalogue — c'est le même classement qui s'affiche sur `/owner/acces`.
- Écris une migration qui supprime les lignes `admin_role_menus` devenues orphelines pour les
  trois clés retirées, et vérifie qu'aucun rôle ne se retrouve sans aucun menu visible.
- Ne casse pas le fail-open de `useAdminMenuAccess()` (`retry:false`, `allowAll=true` tant que
  la requête n'a pas répondu) : c'est volontaire.
- Avant de retirer `/academic/courses` du menu, vérifie qu'aucune page conservée n'y renvoie
  par un lien ; sinon transforme ces liens en navigation contextuelle depuis la fiche Filière.

## Volet 2 — Les statistiques

Implémente la **section 4** de `docs/refonte-owner-menus-et-statistiques.md`. Elle contient,
pour chaque indicateur : la formule exacte, la table ou l'endpoint source, la visualisation
recommandée, la décision que le chiffre déclenche, et un marqueur de faisabilité :

- `[DISPONIBLE]` — la valeur est déjà renvoyée par un endpoint owner : il n'y a qu'à l'afficher.
- `[AGRÉGAT À CRÉER]` — les colonnes existent, la requête SQL est à écrire.
- `[MIGRATION REQUISE]` — la donnée n'existe dans aucune migration.

**Respecte ces marqueurs.** N'invente aucun indicateur qui n'est pas adossé à une source réelle.
Si une donnée manque, écris la migration décrite en section 4.5 ou marque explicitement
l'indicateur comme non mesuré dans l'UI — ne l'approxime pas en silence.

Ordre de livraison (section 4, « Séquencement recommandé ») :

1. **Le pouls** — endpoint `GET /api/v1/owner/pulse` + les 8 KPI de la barre haute, filtre
   global unique (année · cycle/filière · période) partagé par toutes les pages, correction du
   plafond `LIMIT 200` qui rend les totaux financiers faux, correction du bouton « Acquitter »
   d'`AlertsPanel.tsx:36-38` qui est en réalité un lien.
2. **L'argent** — balance âgée, courbe de trésorerie, journal de caisse exportable, détection
   des commandes `payee` sans ligne de paiement. Migration `0095` (échéancier professionnel).
3. **Le remplissage** — taux de remplissage des cohortes et des classes (les données transitent
   déjà dans l'API sans jamais être affichées), sessions ouvertes à zéro inscrit, conflits de
   planning.
4. **La qualité et le risque** — score de décrochage, avancement de la saisie des notes et des
   conduites **par enseignant nommé**, corrélation assiduité/résultats.
5. **L'économie** — marge brute pédagogique par filière, LTV par famille, rétention
   inter-semestres, prévision de trésorerie 13 semaines.

## Volet 3 — UI/UX

### Ce qu'il faut garder

- **La palette data-viz** (`--viz-*` dans `globals.css`, définie pour `:root` **et** `.dark`) et
  ses wrappers `components/owner/charts/`. C'est le seul système de design abouti du dépôt.
  Ses règles ne se négocient pas : l'ordre des slots est le mécanisme d'accessibilité daltonisme,
  la couleur suit l'entité (`seriesColorFor`) et non le rang, 8 séries maximum puis « Autres »,
  toute couleur de statut est doublée d'un libellé.
- Le dialecte visuel « sobre » de l'espace owner (Card + `muted-foreground`), pas le dialecte
  « gradient » des pages académiques.
- React Query, `lib/fetch-interceptor.ts`, `ChunkErrorBoundary`.

### Ce qu'il faut corriger — dettes transverses

Ces 15 dettes sont détaillées en section 3.2 du document, avec leurs occurrences :

1. **Chiffres faux affichés comme vrais.** `/academic` affiche 4 KPI codés en dur. Parents,
   Cycles et Filières calculent leurs KPI sur la page courante ou sur les 20 premières lignes.
   Toute valeur affichée doit venir d'un `COUNT` serveur, jamais d'un `array.length` client.
2. **Plafonds silencieux.** `limit=20`, `limit=100`, `pageSize=500`, `pageSize=1000`,
   `useAllAdminEnrollments` qui boucle jusqu'à 50 000 lignes. Passe en pagination serveur —
   l'API accepte déjà les filtres en querystring sur la plupart de ces routes.
3. **Accessibilité.** `aria-label` sur les boutons-icônes, `role="tab"`/`aria-selected` sur les
   onglets (et onglet actif dans l'URL pour permettre le deep-link), Échap et piège de focus sur
   les modales, navigation clavier sur les lignes de tableau cliquables et les combobox maison.
4. **Confirmations natives.** Remplace tous les `window.confirm`/`alert`/`prompt` par
   `ConfirmationDialog` et **un seul** système de toasts (choisis-en un des trois montés
   aujourd'hui et retire les deux autres).
5. **États d'erreur non traités.** `isError` doit produire un écran distinct de l'état vide, avec
   un bouton qui fait un `refetch()` React Query — jamais un `window.location.reload()`.
6. **Thème sombre cassé.** `darkMode:['class']` est configuré, `ThemeProvider` pose bien la
   classe, mais aucune règle `.light` n'existe : les tokens `:root` sont un thème sombre et
   choisir « clair » ne change rien. À réparer avant tout travail de couleur. Élimine les
   `bg-white`/`text-gray-*` en dur au profit des tokens.
7. **Chargement bloquant.** Remplace les `return <Loader2/>` plein écran par des skeletons et
   `placeholderData: keepPreviousData` : le bloc Filtres ne doit jamais disparaître quand on
   change un filtre.
8. **`isPending` global.** Teste `mutation.variables === row.id` pour n'animer que la ligne
   concernée.
9. **Capacités API non branchées.** Le workflow d'approbation des filières
   (`PUT /programmes/:id/approve`), `PATCH /emploi-temps/{id}`, `POST /:id/reset-password`,
   `/send-credentials`, `hourlyRate`, `bilan_type_id`, `useAddEcueToUe` : tout existe côté API
   et n'est exposé nulle part.
10. **Exports.** CSV sur toutes les listes du périmètre, PDF sur le journal de caisse et les
    rapports. Aujourd'hui : 5 pages sur 22.
11. **Doublons de chemins.** Choisis modale **ou** route `/[id]/edit`, pas les deux. Sur les
    salles, les deux chemins de création n'utilisent même pas le même formulaire — `/new` force
    `capacity=30` en dur, ce qui fausse le KPI « Capacité totale ».
12. **Charte.** Un seul dialecte visuel, une seule bibliothèque de composants
    (`components/ui` **ou** `packages/ui`, choisis et documente), un seul système de toasts.
    Le `ConfigProvider` Ant Design en thème **clair codé en dur** enveloppe toute l'application
    alors que 4 fichiers seulement l'utilisent : isole-le ou retire-le.
13. **Heuristiques textuelles fragiles.** La Conduite est détectée par
    `libelle ILIKE 'conduite%'`, le bouton « Bulletin BTS » par une regex sur le nom de filière,
    les groupes de diplômes par `^(LICENCE|MASTER) <n>` — ce qui prive les BTS de tout diplôme.
    Remplace par des colonnes explicites (`is_conduite`, `cycle_id`) via migration.
14. **Multi-tenant contourné.** `use-academic-years.ts` envoie `X-Tenant: 'imhotepacademy'` et un
    `X-User-Id` en dur. `useStudents` appelle `createApiHeaders()` sans session. L'export Word du
    planning contient l'en-tête d'un seul institut. Les signataires par défaut sont des **noms de
    personnes réelles** imprimés sur les documents officiels de tout tenant non configuré.
15. **Fuite de mots de passe.** `initialPassword` en clair est renvoyé par `GET /api/v1/teachers`,
    `/students` et `/parents` pour chaque fiche, sans filtrage par rôle — la variable
    `canViewPasswords` est calculée puis ignorée. **Traite ça en premier, c'est un défaut de
    sécurité.**

### Bugs bloquants à corriger avant la refonte

- `apps/web/src/app/professionnel/admin/bulletins/[studentId]/page.tsx` est un **fichier vide de
  0 octet**, alors que la page Historique y renvoie en `target="_blank"`.
- `apps/web/src/app/professionnel/admin/notes/historique/page.tsx` lit `d.valeur` et
  `examen.valeur` (lignes 344, 351) alors que l'API renvoie `note` : les colonnes « Devoirs » et
  « Examen » affichent toujours « — ».
- `apps/web/src/app/academic/classrooms/[id]/edit/page.tsx` lit `classroom.name` sur l'enveloppe
  `{ data }` : le formulaire s'ouvre vide au lieu d'être pré-rempli.
- `GET /owner/alerts` déclenche `syncOwnerPilotageAlerts()` et la page Diplômes déclenche un
  `POST ensure-diploma` destructif au simple affichage : deux écritures sur des actions de
  lecture. À déplacer vers un job planifié ou une action explicite.

### Principes de conception attendus

- **Une page owner répond à une question, pas à un domaine.** Chaque bloc porte le chiffre, sa
  comparaison, son seuil, et le lien profond vers l'écran qui permet d'agir.
- **Honnêteté des chiffres.** Tout indicateur approximé porte son hypothèse en `hint` visible.
  Tant que la table de dépenses n'existe pas, l'indicateur s'appelle « marge brute pédagogique »
  et non « marge ». Tant que l'envoi des identifiants n'est pas tracé, l'étape correspondante est
  marquée « non mesurée ».
- **Une alerte n'est utile que si elle est** datée, chiffrée, cliquable vers l'écran d'action,
  acquittable avec traçabilité, et auto-résolue quand la condition disparaît.
- **Aucune troncature silencieuse.** Si une liste est plafonnée, dis-le à l'écran avec le compte
  réel et propose l'export.
- **Français partout**, montants en FCFA via le helper canonique `formatFcfa`
  (`components/owner/charts/palette.ts`), dates en `fr-FR`.

## Contraintes techniques

| Contrainte | Détail |
| --- | --- |
| RLS | Toute requête passe par `set_config('app.tenant_id', ...)`. Côté web, `lib/fetch-interceptor.ts` patche `window.fetch` : **n'introduis aucun client HTTP tiers** (axios, ky), ça casserait la RLS. |
| CSP | `middleware.ts` bloque tout hôte externe (`connect-src`, `font-src`). Pas de CDN, pas de police distante. |
| Prisma | Les tables du module professionnel n'existent que dans `infra/scripts/migrations/0061-0094`, absentes de `schema.prisma`. Écris du **SQL brut via `pg.Pool`**, comme les services `owner-*` existants. |
| Contrats | Tout nouvel endpoint a son schéma Zod dans `packages/contracts/src/owner-stats.schema.ts`. |
| Build | `typescript.ignoreBuildErrors:true` et `eslint.ignoreDuringBuilds:true` : le build ne voit pas les régressions de types. Lance un `type-check` manuel et compare au bruit préexistant. |
| Dépendances | **Ne lance pas `pnpm install`** — l'utilisateur s'en charge. Signale-lui toute dépendance à ajouter. |
| Performance | Les KPI consolidés agrègent 6-8 tables volumineuses. Prévois la vue matérialisée `owner_pulse_daily` (section 4.5) rafraîchie toutes les 15 min, avec un `computed_at` affiché comme « données au … ». |

## Méthode de travail attendue

1. Commence par un plan : ce que tu changes, dans quel ordre, et ce que tu ne touches pas.
2. Livre par lots vérifiables, pas d'un bloc. Le lot 1 (menu + sécurité `initialPassword` +
   les 3 bugs bloquants) doit être livrable et testable seul.
3. Pour chaque nouvel agrégat, montre la requête SQL et le chiffre obtenu sur la base de dev
   avant de brancher l'UI.
4. Ne supprime aucune page hors périmètre : elles restent accessibles par URL, elles sortent
   seulement du menu.
5. Signale explicitement tout indicateur que tu n'as pas pu implémenter et pourquoi.
````
