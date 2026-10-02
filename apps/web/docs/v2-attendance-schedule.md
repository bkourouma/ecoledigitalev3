# Écrans v2 : présences et emploi du temps

Routes `/v2/attendance/*` et `/v2/schedule/*` (nouvelle arborescence, pages legacy intactes). Tout passe par le client API typé
de `platform/api` (schémas Zod de `packages/contracts/src/v2/{attendance,scheduling}.ts`), `usePermission` / `useFeature` et les
gardes serveur ; **aucune règle métier côté client** : statuts, fenêtre de correction, couverture des justificatifs, conflits de
planification, génération des séances, validité d'un créneau sont décidés par l'API, l'écran affiche ses messages tels quels.

## Routes

| Route | Écran | Garde serveur |
|---|---|---|
| `/v2/attendance/call` | « Mes séances à faire » (séances du jour, appel journalier, file locale) | `attendance.take` ou `.manage` |
| `/v2/attendance/call/occurrence/<id>` · `/call/daily/<classe>?date=` | **L'appel en deux gestes** | idem |
| `/v2/attendance` | Assiduité par classe et période, surcharge tracée, recalcul | `attendance.read` |
| `/v2/attendance/sessions` | Suivi des appels : validation (unitaire et en lot), réouverture et annulation motivées | `attendance.read` |
| `/v2/attendance/absences` | Absences à justifier, dépôt de justificatif, export CSV | `attendance.report.read` |
| `/v2/attendance/justifications` | File de décision : pièces, acceptation, rejet motivé, révocation motivée, dépôt | `attendance.justification.read` |
| `/v2/attendance/compliance` | Appels non faits (taux et séances sans appel) | `attendance.report.read` |
| `/v2/attendance/alerts` | Règles d'alerte de l'établissement (lecture, édition par `attendance.settings.manage`) | `attendance.read` |
| `/v2/attendance/conflicts` | Arbitrage des conflits de synchronisation | `attendance.manage` + fonction `attendance.offline` |
| `/v2/attendance/staff` · `/staff/me` | Présence et congés du personnel (direction / espace personnel) | `attendance.staff.read` / `own.*` + fonction `attendance.staff` |
| `/v2/attendance/children[/<id>]` · `/me` | Absences et dépôt de justificatif (parent / élève) | `attendance.child.read` / `self.read` |
| `/v2/attendance/student/<id>` | Fiche d'absences, récapitulatif de période, données de l'attestation (impression) | `attendance.read` |
| `/v2/schedule` | Emploi du temps : moi, mes enfants, classe, enseignant, salle, élève ; semaine (colonnes ≥ md, liste par jour sur mobile) et jour | l'une des 4 permissions `schedule.*.read` |
| `/v2/schedule/today` | « Aujourd'hui » de l'enseignant : appel et notes en un geste | `schedule.own.read` |
| `/v2/schedule/occurrences` | Séances ponctuelles : création avec aperçu des conflits en direct et aide au placement, report, salle, remplacement, annulation, rétablissement, constat | `schedule.read` |
| `/v2/schedule/replacements` | Séances à remplacer et remplaçants proposés | `schedule.manage` |
| `/v2/schedule/timetables[/<id>]` | Patrons récurrents : créneaux par jour, alternance A/B, conflits du brouillon, publication, génération | `schedule.read` |
| `/v2/schedule/rooms` | Salles, état de service, équipements (fonction `scheduling.equipment`), occupation | `schedule.read` |
| `/v2/schedule/export` | iCalendar : téléchargement, jetons d'abonnement révocables | l'une des 4 permissions `schedule.*.read` |

`platform/admin/menu.ts` (`LEGACY_TO_V2_HREF`) réécrit les entrées du portail admin des manifestes vers ces routes.

## Appel hors ligne

Architecture : `platform/offline/` (indépendant de React, testé avec un faux IndexedDB, `platform/test/fake-indexeddb.ts`).

- `idb.ts` : couche mince au-dessus d'IndexedDB, **repli en mémoire** si le stockage est indisponible (l'écran avertit alors que la file
  ne survivra pas à un rechargement).
- `attendance-outbox.ts` : la file. Une entrée par appel (clé `occ:<séance>` ou `day:<classe>:<date>`).
- `outbox-manager.ts` : état observable, envoi par lot, reprise avec attente croissante (5 s doublées, 5 min au plus), un seul envoi à
  la fois. Seule route appelée : `POST /api/v1/attendance/sync` (fonction `attendance.offline`).
- `OutboxProvider.tsx` : écoute `online` / `offline`, la visibilité de l'onglet et un battement de 60 s tant que des pointages attendent.

**Ce qui est stocké sur l'appareil, et pourquoi sans chiffrement** : uniquement des identifiants techniques (UUID de séance, classe,
élève), un code de statut, des minutes de retard et des horodatages. **Aucun nom, photo, note libre ni motif.** La liste nominative de
l'appel n'existe qu'en mémoire de la page. Un appareil volé ne révèle donc que des UUID inexploitables sans jeton, tenant et
permission. Un chiffrement local (WebCrypto) dont la clé serait conservée dans le même navigateur ne protégerait pas contre un
script de la page (XSS) et compliquerait la reprise ; il n'a pas été jugé justifié. Chaque entrée est rattachée à `tenant:utilisateur` :
une autre personne qui se connecte sur le même appareil ne voit ni n'envoie jamais les pointages d'autrui.

**Idempotence** : chaque séance et chaque pointage porte un `clientId` (UUID). Le `clientId` d'un pointage est **renouvelé à chaque
modification** (l'API refuse le même identifiant avec un autre contenu) ; rejouer un lot identique ne crée donc jamais de doublon et un
pointage modifié pendant l'envoi reste en file et repart. `deviceId` stable par appareil, `clockOffsetMs` déduit de `receivedAt`.

**Résultats de l'API** : `APPLIED` / `UNCHANGED` / `REPLAYED` quittent la file ; `CONFLICT` (séance verrouillée, fenêtre dépassée, saisie
plus ancienne) quitte la file, l'appel passe « à vérifier » avec la liste nominative en mémoire et un lien vers l'arbitrage ; `REJECTED`
est signalé et jamais rejoué ; une séance rejetée (annulée, droits) garde ses pointages avec « Réessayer » / « Abandonner » ; une
soumission refusée (élèves non pointés) conserve les pointages ; une erreur 401 conserve tout et n'arme aucune reprise automatique.

**Service worker** : `public/sw.js` est inchangé et ses règles sont respectées : il ne met jamais en cache `/api/`, une requête
authentifiée, une page ou un flux RSC. La file est un stockage applicatif explicite (pas un cache de réponses). Test Playwright de
non-régression : aucun chemin `/api/` ni `/v2/` dans les caches.

**Mode de fonctionnement** (fonction `attendance.offline` active) : tout passe par la file, même en ligne (aucune perte si le réseau
coupe pendant l'envoi) ; l'envoi part tout de suite quand le réseau est là (et sert d'enregistrement automatique des pointages d'un
appel ouvert). Fonction absente : enregistrement direct (`PUT /sessions/:id/records` puis `POST /sessions/:id/submit`).

### Limites assumées

- **L'écran d'appel doit avoir été ouvert en ligne** : la liste nominative n'est pas persistée et une navigation hors ligne est
  redirigée par le service worker vers `/offline` (aucune page privée n'est cachée). Une fois ouvert, l'écran fonctionne sans réseau
  tant que la page n'est pas rechargée ; les pointages restent en file et partent à la reconnexion.
- Pas de *Background Sync* : le service worker n'a pas accès au jeton (stockage de la page) ; l'envoi se fait à l'ouverture de la page,
  au retour du réseau, au retour de l'onglet et au battement de 60 s.
- Pas de note ni de pièce en saisie hors ligne ; `EXCUSED` (absence justifiée) n'est proposé qu'en ligne et seulement aux personnes
  qui peuvent décider (`markWithJustification`), le statut est sinon le résultat d'un justificatif accepté.
- La liste d'appel ne montre pas de photos (l'API de la séance n'en fournit pas) ; pas de « Tout absent » (parité legacy manquante).

## Tests

`pnpm --filter @ecoledigitale/web test` (Vitest + Testing Library, faux client API, faux IndexedDB) :

- `platform/offline/offline.test.ts` : file, idempotence, reprise, rejeu, conflits, rejets, 401, aucune donnée nominative stockée ;
- `attendance/_components/CallScreen.test.tsx` : l'appel en deux gestes, hors ligne puis reconnexion, rechargement, conflit, séance rejetée, mode direct ;
- `attendance/_components/Management.test.tsx` et `schedule/_components/Schedule.test.tsx` : écrans de gestion, corps de requête exacts,
  règles de forme du contrat, permissions, états vides ;
- `attendance/messages-coverage.test.ts` : toutes les clés i18n et énumérations.

Playwright : `PW_CHANNEL=msedge pnpm --filter @ecoledigitale/web exec playwright test -c playwright.attendance.config.ts` (Next seul, sans API) :
garde serveur de toutes les routes à 375 px et sur bureau. Les parcours authentifiés exigent NextAuth, le RBAC et l'API v2 : à écrire
avec l'infrastructure complète (appel avec `context.setOffline(true)`, reconnexion, justification parent puis acceptation direction).

## Parité legacy manquante

- Validation des séances pour la paie (file « à valider », dérogation de durée, chevauchements validés, séances comptables) : l'API
  est prête, écran non livré.
- Calendrier de l'établissement (fériés, vacances, fermetures) et paramètres de planification (fuseau, politique de conflit, ouverture) ;
  paramétrage des statuts, motifs, types de congé et politiques d'appel : API prête, écrans non livrés (seules les règles d'alerte sont éditables).
- Clonage d'un emploi du temps ; glisser-déposer du constructeur (remplacé par une grille par jour et un formulaire accessible).
- Impression / PDF de l'emploi du temps (l'export iCalendar est livré) ; attestation d'assiduité : données et impression navigateur, pas de PDF.
- Liste des élèves en alerte : l'API publie des événements `attendance.alert.*` mais n'expose aucune lecture ; l'écran affiche les règles.

## Points à arbitrer

1. **Référentiels illisibles par les profils qui en ont besoin** : `reference/justification-reasons`, `status-definitions`, `settings`,
   `leave-types` exigent `attendance.read` ou `settings.manage`. Un parent ou un élève (dépôt de justificatif) et un enseignant qui n'a que
   `attendance.take` n'y accèdent pas : repli sur les motifs, types de congé et statuts du modèle d'établissement (les statuts ajoutés par
   l'établissement ne sont pas proposés à ces profils). Proposition : ouvrir ces lectures à `*.justify` et `attendance.take`.
2. **Noms absents des rapports** : lignes d'absences, justificatifs, récapitulatifs, conflits ne portent que des identifiants. Les noms viennent
   de requêtes annexes (annuaire de la classe choisie, `GET people/students/:id`). Proposition : `displayName` dans ces DTO.
3. **Ouvrir un appel écrit** : la liste d'appel passe par `POST /sessions` (crée une séance `OPEN`). Une lecture seule de la liste d'une
   séance non ouverte éviterait des séances ouvertes par simple consultation.
4. **`/scheduling/me/today` ne porte pas `attendanceSubmitted`** : l'état de l'appel est reconstitué par `GET /attendance/sessions?date=`
   (requête en plus, droits `attendance.read` ou `.take`).
5. **Export CSV** : le client API ne renvoie que le corps ; `x-export-truncated` (5 000 lignes) n'est pas lisible, l'avertissement est permanent.
6. **Menus des manifestes** (portails livrés : `v2-portals.md`, menus statiques filtrés par permissions) : les entrées des portails enseignant, parent et élève (`/teacher/attendance`, `/enseignant/aujourdhui`,
   `/parent/attendance`, `/student/attendance`, `/parent/emploi-du-temps`…) pointent encore vers l'ancien site ; au basculement elles
   doivent viser `/v2/attendance/call`, `/v2/schedule/today`, `/v2/attendance/children`, `/v2/attendance/me`, `/v2/schedule`.
   « Saisir les notes » pointe vers `/teacher/evaluations` (entrée `assess.mine`) en attendant les écrans v2 du module d'évaluation.
7. **Reprise hors ligne après rechargement** : impossible sans mettre une page authentifiée en cache (interdit par les règles du service
   worker). Option à décider : instantané chiffré (WebCrypto) de la liste, ou liste de classe préchargée à l'ouverture de la journée.
