# Hors ligne avancé : emploi du temps et saisie des notes (Phase E)

Complète le hors-ligne de l'appel (`docs/v2-attendance-schedule.md`, § « Appel hors ligne ») pour des enseignants en connectivité faible.
Rien n'est réécrit : tout réutilise `platform/offline/` (couche `idb.ts`, repli en mémoire, `fake-indexeddb` des tests, schéma
`tenant:utilisateur`, reprise avec attente croissante, mêmes principes d'idempotence). **Aucune règle métier côté client** : barème,
verrou de période, état de l'évaluation, appartenance à la classe, conflits sont décidés par l'API, inchangée (permissions et RLS
identiques ; le module `assess` n'a pas été modifié : il gère déjà `Idempotency-Key` et `rowVersion`).

## 1. Ce qui est hors ligne, et ce qui ne l'est pas

| Besoin | Hors ligne | Comment |
|---|---|---|
| Appel | oui (existant) | file `attendance_calls`, `POST /attendance/sync` |
| Emploi du temps de l'enseignant | **lecture seule** | copie `schedule_cache`, fraîcheur affichée |
| Saisie des notes | **oui** | brouillons `grade_drafts`, `PUT /assess/assessments/:id/grades` par lot idempotent |
| Autres écrans (`/v2/*`) | non | les pages privées ne sont jamais mises en cache (voir `public/sw.js`, inchangé hormis `CACHE_VERSION = v2`) |

Base IndexedDB `ed-offline`, **version 2** (migration additive : la version 1 reçoit `schedule_cache` et `grade_drafts`, `attendance_calls`
et `meta` ne sont pas touchés).

## 2. Architecture

```
platform/offline/
  idb.ts                    magasins attendance_calls, meta, schedule_cache, grade_drafts (v2) ; repli en mémoire
  owner.ts                  propriétaire tenant:utilisateur du jeton (même expiré pour les brouillons et la copie)
  schedule-cache.ts         ScheduleCache : copie minimale, isolation, élagage, fraîcheur
  browser-schedule-cache.ts accès partagé du navigateur
  OfflineSchedulePanel.tsx  copie affichée sur /offline (démarrage à froid sans réseau)
  grade-drafts.ts           GradeDrafts : brouillon par évaluation, lot en vol, conflits, verrouillage, limites
  grade-sync-manager.ts     GradeSyncManager : état observable, envoi, conflits, reprise, onApplied
  grade-sync-status.ts      describeSync : statut unique à annoncer (pur)
  GradeSyncProvider.tsx     écouteurs online/offline/visibilité, battement 60 s, Web Locks
  purge.ts                  purge à la déconnexion volontaire
app/v2/assessments/_components/
  GradeEntry.tsx            grille (fournisseur optionnel : sans lui, comportement en ligne inchangé)
  GradeSyncIndicator.tsx    indicateur role=status / aria-live=polite
  GradeConflictResolver.tsx résolution des conflits
app/v2/schedule/_components/
  offline-timetable.tsx     useOfflineTimetable + OfflineCopyNotice (TimetableScreen, mode « moi »)
```

Fournisseurs : `GradeSyncProvider` est monté dans `teacher/layout` (via `TeacherProviders`) **et** `assessments/layout` ; il est donc actif sur
toutes les pages du portail enseignant (la reprise d'envoi n'attend pas qu'on rouvre la grille).

## 3. Emploi du temps (lecture seule)

- **Quoi** : seulement « mon » emploi du temps (`/me/timetable`). Chaque fenêtre (semaine ou jour) affichée avec succès est enregistrée.
  Jamais celui d'une classe, d'un collègue, d'une salle, d'un élève ou d'un enfant.
- **Projection minimale** : identifiant, type, intitulé, classe, salle, horaires, statut, mode, indicateurs « à remplacer » / « dérogation »,
  lieu libre, plus les **libellés** de classe et de salle déjà à l'écran. **Jamais** : notes de séance, motif d'annulation, intervenants,
  noms d'élèves ou de collègues.
- **Quand elle est lue** : réseau injoignable (hors ligne, délai, 5xx, requête en pause) **et** aucune donnée à l'écran pour cette fenêtre.
  Bandeau « copie enregistrée il y a … », lecture seule, avertissement au-delà de 24 h, mention si la copie est incomplète (> 500 séances).
  Sans copie de la période : message explicite.
- **Démarrage à froid sans réseau** : le service worker redirige la navigation vers `/offline?from=…` (page publique précachée).
  `OfflineSchedulePanel` y affiche la copie la plus pertinente (celle qui couvre aujourd'hui), sélecteur de période, sans aucune requête.
- **Isolation et durée de vie** : clé `sched:<tenant:utilisateur>:<du>:<au>:<annulées>` ; relecture refusée si le propriétaire diffère ;
  les copies des autres propriétaires sont effaçables (`purgeForeign`) ; 8 fenêtres au plus par personne, fenêtres terminées depuis plus
  de 21 jours élaguées ; tout est effacé à la déconnexion volontaire.
- **Pas de chiffrement local**, même raisonnement que la file d'appel : une clé stockée dans le même navigateur ne protège pas d'un script
  de la page (XSS) ; la donnée est volontairement minimale, attribuée à une identité, éphémère et purgée.

## 4. Saisie des notes hors ligne

### Principe

La grille nominative reste **en mémoire de la page** (aucun nom d'élève sur l'appareil). Ce qui est gardé : `grades:<tenant:utilisateur>:<évaluation>`
→ pour chaque ligne modifiée : `enrollmentId`, état, note (**chaîne décimale**), commentaire, `baseVersion` (la `rowVersion` lue), horodatage.
La saisie est écrite sur l'appareil ~200 ms après chaque modification (et à `pagehide`), **avant** toute tentative d'envoi.

1. Ouverture de la feuille : **rapprochement** (`reconcile`) des brouillons avec la feuille lue du serveur.
   - même version → la saisie est restituée dans la grille (« N saisies hors ligne restaurées ») ;
   - valeur serveur déjà identique → abandonnée, rien à arbitrer ;
   - version différente → **conflit** : la grille garde la valeur du serveur, la saisie est mise de côté ;
   - évaluation plus en brouillon → brouillon **verrouillé** (grille en lecture seule).
2. Envoi (`syncAssessment` / `syncNow`) : `PUT /assess/assessments/:id/grades` avec `Idempotency-Key` = clé du **lot en vol**, lignes
   portant `rowVersion` = `baseVersion` (aucune pour une nouvelle note). Au plus 200 lignes par lot.
3. Succès : les lignes identiques à l'envoi sortent du brouillon (le brouillon est supprimé quand il est vide) ; une retape pendant le vol
   reste et prend la nouvelle `rowVersion` ; la grille suit via `onApplied`.

### Idempotence et reprise après coupure

Le **lot en vol** (clé + contenu exacts) est écrit sur l'appareil avant l'envoi. Coupure, plantage, rechargement, perte de la réponse :
le rejeu envoie *le même lot avec la même clé* → l'API répond `replayed: true` sans écrire de plus. Les saisies faites pendant le vol partent
dans un lot suivant (nouvelle clé). Réseau, délai, 429, 5xx : reprise automatique 5 s, 10 s, … 5 min ; événement `online`, retour d'onglet
et battement de 60 s relancent ; un seul envoi à la fois (file interne + Web Locks entre onglets quand disponibles).

### Conflits (jamais d'écrasement silencieux)

409 `assess.stale_grade` (lot refusé en entier) → les lignes périmées indiquées par l'API deviennent des conflits ; le gestionnaire relit
la feuille pour documenter la valeur du serveur et **les autres lignes repartent** dans un nouveau lot. Un conflit n'est **jamais renvoyé**
tant que la personne n'a pas choisi (le brouillon refuse d'ailleurs de reprendre une ligne en conflit, même si la grille la ré-enregistre) :

- **Garder la mienne** : la saisie repart basée sur la `rowVersion` *courante* du serveur (choix explicite) ; refusé si la valeur du serveur est inconnue ;
- **Prendre celle du serveur** : la saisie est abandonnée, la grille montre la valeur du serveur ;
- **Voir les deux** : comparaison détaillée (valeur, commentaire, heure de la saisie, version du serveur).

Cas « faux conflit » (un autre onglet a déjà envoyé la même valeur) : abandonné sans arbitrage.

### Évaluations figées et refus

409 `assess.grade_frozen` / `assess.period_locked` → brouillon **verrouillé**, conservé, sans nouvel essai (la grille est de toute façon
en lecture seule hors `DRAFT`). Autre refus définitif (400/403/404/422) → brouillon « en échec », conservé ; bouton « Réessayer l'envoi » ou
« Abandonner mes saisies hors ligne ». Rien n'est jamais supprimé sans geste de la personne (hors purge, § 6).

### Session expirée, changement d'identité

- Les brouillons restent attribués à l'identité du jeton **même expiré** (une saisie hors ligne dure plus qu'un jeton d'accès).
- Jeton expiré ou 401 : **rien n'est envoyé**, brouillons et lot en vol intacts, pas de boucle d'essais, message « Session expirée : reconnectez-vous
  avec le même compte… ». La reprise démarre dès qu'un jeton valide de la **même** identité existe (battement, `notifySessionRenewed`) avec la même clé.
- Une autre personne (autre utilisateur ou autre tenant) sur le même appareil ne **voit** ni n'**envoie** les brouillons : la clé de stockage contient
  le propriétaire (aucun remplacement possible), et chaque lecture filtre par propriétaire. L'API garde de toute façon la dernière barrière
  (jeton, tenant, `grade.enter`, affectation).

### Statut (accessibilité)

`GradeSyncIndicator` : zone `role="status"` `aria-live="polite"` (`aria-label` « Synchronisation des notes »), texte + icône (jamais la seule couleur).
États : **synchronisé** · **en attente** · **conflit** · **échec** (avec « Réessayer ») · hors ligne · envoi en cours · session expirée · évaluation figée ·
file locale pleine · stockage refusé. Le tableau des conflits a une légende, des en-têtes `scope`, des boutons nommés par élève et un titre qui reprend le focus.
Tests axe : `GradeEntryOffline.test.tsx` (tableau des conflits affiché) + balayage `pnpm test:a11y`.

### Limites de la file

25 évaluations en attente au plus, 1000 lignes par évaluation, 200 par lot. Au-delà : la saisie n'est **pas** gardée localement, un `role="alert"` le dit, et l'envoi
en ligne reste possible. Stockage indisponible (navigation privée) : repli en mémoire signalé, et l'alerte de fermeture de page (`beforeunload`) reste active.

## 5. Limites connues (assumées)

- **La grille doit avoir été ouverte en ligne** : la liste nominative n'est pas stockée. Hors ligne, un rechargement de la page n'affiche que `/offline`
  (avec la copie de l'emploi du temps) ; les saisies déjà faites sont en sécurité et se reprennent dès qu'on rouvre l'évaluation en ligne, ou s'envoient
  d'elles-mêmes depuis n'importe quelle page du portail enseignant dès que le réseau revient.
- **Emploi du temps** : seules les fenêtres consultées en ligne sont disponibles (pas de préchargement des semaines suivantes) ; pas de secours pour les rôles autres que « moi » ;
  les noms de collègues ne sont pas gardés.
- Le jeton ne peut pas se renouveler hors ligne : la reprise attend un jeton valide (connexion de la même personne).
- Les notes **publiées** ou en circuit de validation ne s'éditent pas hors ligne (corrections = demandes en ligne, inchangé).
- Pas d'envoi en arrière-plan quand l'application est fermée (pas de Background Sync) : l'envoi reprend à la prochaine ouverture du portail.
- `AttendanceOutbox` (appel) construit sa clé sans propriétaire (`occ:<id>`) : deux comptes sur le même appareil touchant la **même** séance se remplaceraient.
  Hors périmètre de cette tranche ; les brouillons de notes, eux, incluent le propriétaire dans la clé.

## 6. Déconnexion

`PortalShell` (« Se déconnecter ») et le menu de l'ancien shell appellent `purgeOfflineDataBestEffort()` (plafonnée à 1,5 s, jamais bloquante) :

- copie d'emploi du temps : **effacée** (tous propriétaires) ;
- brouillons déjà envoyés : inexistants (supprimés à l'envoi) ;
- brouillons **non envoyés** : **conservés** par défaut (travail non transmis ; invisibles pour toute autre identité) ; `purgeOfflineData({ discardUnsynced: true })`
  les efface aussi (appareil partagé).

Une session qui **expire** ou est **révoquée** (`IamSessionKeeper`) ne purge rien : les brouillons doivent survivre à la reconnexion.

## 7. Tests

`pnpm --filter @ecoledigitale/web exec vitest run src/platform/offline src/app/v2/assessments src/app/v2/schedule src/platform/pwa`

- `platform/offline/offline-advanced.test.ts` : cache d'emploi du temps (projection, isolation, élagage, purge), coupure + rechargement, rejeu idempotent
  (réponse perdue, saisie pendant le vol, 503, découpage), conflits (409, réouverture, faux conflit, valeur serveur illisible), évaluations figées, session expirée /
  autre identité / autre tenant / déconnecté, limites, purge, migration IndexedDB v1 → v2.
- `platform/offline/grade-sync-status.test.ts`, `OfflineSchedulePanel.test.tsx`.
- `app/v2/assessments/_components/GradeEntryOffline.test.tsx` (écran complet, faux serveur) et `grid-model.test.ts`.
- `app/v2/schedule/_components/TimetableOffline.test.tsx`.

## 8. Checklist de test manuel sur appareil (Android Chrome ou iOS Safari, PWA installée)

Prérequis : application servie en HTTPS (ou `NEXT_PUBLIC_PWA=1`), compte enseignant avec une évaluation `DRAFT` de 30 élèves et un emploi du temps publié.

1. [ ] **Emploi du temps** : ouvrir « Mon emploi du temps » en ligne (semaine courante + semaine suivante). Mode avion → changer de semaine : la copie s'affiche avec « il y a … » et « Lecture seule ». Une semaine jamais ouverte → message « aucune copie ».
2. [ ] **Démarrage à froid** : fermer l'application, mode avion, la rouvrir sur une page privée → page « Vous êtes hors ligne » **avec** la copie de l'emploi du temps et son horodatage. Aucune donnée d'élève affichée.
3. [ ] **Saisie coupée** : ouvrir la grille en ligne, mode avion, saisir 10 notes (dont ABS et une virgule : `12,5`). L'indicateur annonce « Hors ligne : N notes gardées… » (vérifier avec un lecteur d'écran : annonce polie, une seule).
4. [ ] **Reprise** : fermer l'application (balayer), désactiver le mode avion, rouvrir la grille : « N saisies hors ligne restaurées », valeurs identiques. Enregistrer → « Notes synchronisées à HH:MM ».
5. [ ] **Envoi automatique** : refaire 3, quitter la grille (liste des évaluations), couper le mode avion : l'envoi part seul (vérifier côté web qu'il n'y a pas de doublon, `replayed` dans les journaux API si la coupure a eu lieu pendant l'envoi).
6. [ ] **Réseau très lent / coupé en plein envoi** : limiter à « 2G » puis couper pendant l'enregistrement : « Envoi impossible… saisies conservées », nouvel essai automatique ; aucun doublon.
7. [ ] **Conflit** : sur l'appareil A (hors ligne) saisir 15 à Aka ; sur B (en ligne) saisir 5 à Aka. Reconnecter A : tableau « Notes modifiées par quelqu'un d'autre » avec « 15 » et « 5 » ; la grille montre 5 ; rien n'est renvoyé. Tester « Voir les deux », « Garder la mienne » (15 enregistré) puis refaire avec « Prendre celle du serveur » (5 conservé).
8. [ ] **Évaluation figée** : A hors ligne saisit ; sur B soumettre/valider l'évaluation ; reconnecter A : « Évaluation figée ou période verrouillée », saisies conservées, grille en lecture seule, « Abandonner mes saisies hors ligne » demande confirmation.
9. [ ] **Session expirée** : saisir hors ligne, attendre l'expiration du jeton (durée d'accès), reconnecter : « Session expirée… reconnectez-vous avec le même compte ». Se reconnecter avec le **même** compte → envoi sans perte. Refaire avec un **autre** compte : il ne voit pas les brouillons ; le premier les retrouve après sa reconnexion.
10. [ ] **Déconnexion** : après la copie d'emploi du temps, « Se déconnecter » → rouvrir `/offline` : plus de copie. Des brouillons non envoyés sont conservés (comportement documenté).
11. [ ] **Stockage** : navigation privée (iOS) → avertissement « stockage indisponible… saisies perdues si vous fermez cette page ».
12. [ ] **Taille** : saisir/importer sur plus de 25 évaluations hors ligne (ou simuler) : alerte « file hors ligne pleine » ; la grille reste utilisable en ligne.
13. [ ] **Deux onglets** : ouvrir deux onglets du portail, retour du réseau : une seule requête `PUT` par lot (Web Locks), pas de faux conflit.
