# Guide de test de la démonstration EcoleDigitale v2

> Guide utilisateur complet (non technique, par rôle, module et parcours, avec cases à cocher) : [`docs/GUIDE_UTILISATEUR_TEST.md`](GUIDE_UTILISATEUR_TEST.md). Le présent document reste la référence technique de la démonstration.

Ce guide permet de tester l'application v2 sur votre machine en **une commande** (`pnpm demo:up`), avec trois établissements
de démonstration, des comptes de test pour chaque rôle et des données riches (année en cours, notes, résultats, bulletins PDF,
factures, admissions, conseils…). Tout est local : aucun envoi réel (e-mail, SMS, WhatsApp), aucun paiement réel, aucun appel
réseau sortant.

> Les règles de calcul des packs Primaire et Secondaire sont des **jeux de démonstration** (`placeholder`) : aucune règle
> officielle (moyennes, passage, BEPC, BAC, CEPE…) n'est inventée. Les écrans concernés affichent le bandeau « règles de
> démonstration » et les documents officiels portent le filigrane « démonstration ».

## 1. Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Docker Desktop | récent, démon démarré | Postgres 17 et Redis 7 tournent dans deux conteneurs `ed-demo-pg` et `ed-demo-redis`. Au premier lancement, Docker télécharge les images `postgres:17-alpine` et `redis:7-alpine` si elles sont absentes (seul accès réseau de la démonstration). |
| Node.js | 18 ou plus (20+ recommandé) | |
| pnpm | 9 ou plus | `pnpm install` à la racine du dépôt (une seule fois). |
| Chrome, Chromium ou Edge | facultatif | Rendu des bulletins PDF par le worker. Edge, présent sous Windows, suffit ; sinon `REPORTCARDS_CHROME_PATH=<chemin du navigateur>`. |

Ressources : comptez ~2 Go de mémoire pour la pile (Postgres, Redis, API, worker, Next.js en développement).

## 2. Commandes

| Commande | Effet |
|---|---|
| `pnpm demo:up` | Démarre tout (conteneurs, migrations, données, API, worker, web), affiche l'URL, le chemin des identifiants et le tableau « rôle -> ce qu'il peut tester ». Reste au premier plan : **Ctrl+C** arrête proprement la démonstration (données conservées). |
| `pnpm demo:up -- --detach` | Idem, mais rend la main et laisse la pile tourner en arrière-plan. |
| `pnpm demo:down` | Arrête processus et conteneurs. Les données (volume `ed-demo-pgdata`) et les identifiants sont conservés : le `demo:up` suivant redémarre en moins d'une minute. |
| `pnpm demo:reset` | Supprime les conteneurs `ed-demo-*`, les volumes `ed-demo-*` et le dossier `.demo/`. Le `demo:up` suivant repart de zéro avec de nouveaux secrets et mots de passe. **Ne touche à aucune autre ressource Docker.** |
| `pnpm demo:status` | État des conteneurs, processus, ports et URL. |
| `pnpm demo:totp <e-mail>` | Code MFA courant d'un compte (ex. `pnpm demo:totp direction.generale@demo-secondaire.test`). Variante : `pnpm demo:totp demo-secondaire proprietaire`. |
| `pnpm demo:smoke` | Test de fumée automatisé sur la pile démarrée (connexions, routes clés, isolation entre établissements). |

Durées mesurées (Windows 11, Docker Desktop, images en cache) : premier `pnpm demo:up` environ **3 minutes** (dont 2 min 10 de données de démonstration pour les trois établissements) ;
`pnpm demo:up` suivant (données conservées) environ **40 secondes** ; `pnpm demo:smoke` : 191 contrôles en 15 à 25 secondes. Sans image Docker en cache, ajoutez le téléchargement de `postgres:17-alpine` et `redis:7-alpine`.

Ports (liés à `127.0.0.1` uniquement) : web **3100**, API **4100**, worker **8112**, Postgres **15432**, Redis **16379**. Si un port est
occupé, le suivant libre est choisi automatiquement (le tableau de démarrage donne les ports réels ; `pnpm demo:status` aussi).
`--web-port=N` et `--api-port=N` imposent un port.

Fichiers générés (tous sous `.demo/`, **ignoré par git**, jamais committé) :

- `credentials.md` : adresses, comptes, mots de passe, secrets MFA (lisible) ; `credentials.json` : les mêmes, pour les scripts ;
- `secrets.json` : secrets d'exécution (clés JWT, chiffrement MFA et coffre de paiement, signature des bulletins, HMAC d'audit…) ;
- `logs/` : `api.log`, `worker.log`, `web.log`, `seed.log`, `migrate.log` ;
- `mailbox.jsonl` : « boîte aux lettres » locale (invitations, liens de réinitialisation de mot de passe) ;
- `objects/` : stockage des fichiers (bulletins PDF…), `import-templates/` : fichiers modèles CSV/XLSX.

## 3. Se connecter

Ouvrez `http://localhost:3100/v2/login`. L'établissement par défaut est `demo-secondaire` ; pour entrer dans un autre, utilisez son
sous-domaine (les navigateurs résolvent `*.localhost` vers votre machine) :

- Secondaire : `http://demo-secondaire.localhost:3100/v2/login`
- Primaire : `http://demo-primaire.localhost:3100/v2/login`
- Supérieur : `http://demo-superieur.localhost:3100/v2/login`
- Console de la plateforme (super-admin) : `http://localhost:3100/v2/platform/login`

Les **mots de passe sont dans `.demo/credentials.md`** (aléatoires, générés à l'exécution). Les comptes marqués MFA demandent un code à
6 chiffres : `pnpm demo:totp <e-mail>`. Un code ne sert qu'une fois : si une connexion vient de le consommer, attendez le suivant (30 s).

Après la connexion, chaque rôle arrive sur son écran v2 (propriétaire : `/v2/owner`, direction : `/v2/direction`, enseignant :
`/v2/teacher`, instituteur : `/v2/primary`, parent : `/v2/parent`, élève : `/v2/student`, etc.). Le menu est piloté par l'API.

## 4. Comptes par rôle

| Rôle | MFA | Ce qu'il peut tester |
|---|---|---|
| Propriétaire (`direction.generale@<établissement>.test`) | oui | Tout l'établissement : paramètres, rôles, abonnement, finance, tableaux de bord de direction |
| Directeur (`directeur@…`) | oui | Validations (appels, notes), résultats, conseils, mesures de vie scolaire, alertes |
| Directeur des études (`etudes@…`) | oui | Programmes, emplois du temps, résultats, bulletins, conseils de classe |
| Responsable pédagogique (`pedagogie@…`) | oui | Relecture et approbation des évaluations |
| Secrétariat (`secretariat@…`) | oui | Dossiers élèves, inscriptions, imports, dossiers d'élèves affectés par l'État |
| Économe (`econome@…`) | oui | Factures, règlements, paiement en ligne SANDBOX, rapprochement, relances |
| Enseignant (`enseignant@…`, secondaire et supérieur) | non | Appel, saisie des notes, emploi du temps, portail enseignant |
| Instituteur (`enseignant@…` du primaire, CP1) et instituteur de la maternelle (`instituteur.maternelle@…`) | non | Appel journalier, compétences, conseil des maîtres, bilan annuel |
| Éducateur (`educateur@…`) | non | Incidents, observations, propositions de mesures, appel |
| Responsable des examens (`examens@…`) | non | Sessions d'examen, candidats, examen blanc |
| Chargé d'admissions (`admissions@…`) | non | Campagnes, candidatures, offres, passage à l'inscription |
| Parent (`parent@…`) | non | Portail famille : enfants, résultats, bulletins, factures, paiement SANDBOX |
| Élève (`eleve@…`) | non | Portail élève : emploi du temps, notes, bulletins |
| Opérateur de la plateforme | non | Organisations, abonnements, fonctionnalités, impersonation |

Les adresses exactes et les mots de passe figurent dans `.demo/credentials.md`.

## 5. Ce que contient la démonstration

**Collège Le Baobab (Secondaire).** Classe de 6e A : 14 inscriptions (9 confirmées dont une issue du circuit d'admission, 5 en attente de paiement), 6 tuteurs (fratries), 3 enseignants,
4 matières à coefficients, emploi du temps et séances générées, 2 appels validés, notes complètes du trimestre 1 (devoir et composition
par matière, circuit saisie -> relecture -> validation -> publication), **résultats du trimestre 1 calculés** (jeu de démonstration), **9 bulletins PDF
signés et publiés**, trimestre 2 verrouillé avec un **conseil de classe ouvert**, vie scolaire (incidents, notes, 3 mesures dont une exclusion à valider et
une à appliquer), dossier d'**élève affecté par l'État** (facture scindée, créance), **session d'examen officielle et examen blanc**, 9 candidatures
d'admission à tous les statuts, factures et règlements variés (virement, mobile money, paiements en ligne SANDBOX), annonces, 3 règles d'alerte, import d'élèves prêt à exécuter.

**École Les Palmiers (Primaire).** Classe de CP1 A (12 élèves, notes, résultats du semestre 1, 8 bulletins PDF du primaire) et **Grande Section A** (maternelle) :
5 enfants inscrits par le circuit d'admission, appel journalier, évaluation par compétences sans note, résultats par compteurs de compétences, conseil des maîtres tenu
(décisions humaines), procès-verbal, **5 bilans annuels** dont 3 SCELLÉS (PDF signés, filigrane « démonstration »).

**Université Horizon (Supérieur, LMD).** Classe L1-A : 12 étudiants, curriculum UE / ECUE crédité, notes complètes du semestre 1, **résultats du semestre 1** (semestre validé = toutes
les UE), relevés de notes PDF signés, candidatures d'admission, factures et règlements.

## 6. Parcours de test recommandés

### Primaire : admission -> inscription -> appel -> compétences -> conseil des maîtres -> bilan (`demo-primaire`)

1. **Admission** (chargé d'admissions) : `/v2/admissions/applications` — 13 dossiers à tous les statuts (5 inscrits, les autres du dépôt au refus) ; ouvrez-en un, avancez-le, émettez une offre, observez les notifications mises en file (journal `/v2/notifications`).
2. **Inscription** (secrétariat / économe) : une candidate « inscription en attente de paiement » ; enregistrez le règlement des frais d'inscription (`/v2/finance/payments/new`) : l'inscription est confirmée **par événement**, le dossier devient ENROLLED.
3. **Appel journalier** (instituteur de la maternelle) : `/v2/attendance/call` — l'appel du jour de GS-A est fait ; rouvrez-le ou créez celui d'une autre date ; la direction le valide (séparation des tâches).
4. **Compétences** (instituteur) : `/v2/primary` — grille de compétences de GS-A, saisie en lot, validation par la direction ; une compétence « non évaluée » reste non évaluée (jamais zéro).
5. **Conseil des maîtres** : décisions de la direction (promotion / maintien) avec justification obligatoire en cas d'écart ; l'instituteur propose mais ne décide pas ; feuille de présence et procès-verbal PDF.
6. **Bilan annuel** (direction) : 3 bilans scellés (PDF), 2 prêts à sceller ; le scellement est irréversible (version vivante unique) ; vérification publique via le code du document (`/v2/verify`).

### Secondaire : notes -> résultats -> vie scolaire -> affectés État -> conseil de classe -> examens (`demo-secondaire`)

1. **Notes** (enseignant -> responsable pédagogique -> direction) : `/v2/assessments` — créez un contrôle, saisissez, soumettez, relisez, approuvez, publiez ; une note publiée est immuable.
2. **Résultats** (direction) : `/v2/results` — trimestre 1 clos (résultats FINAL, jeu de démonstration), trimestre 2 verrouillé ; essayez la réouverture motivée.
3. **Bulletins** (direction des études / propriétaire) : `/v2/reportcards` — les 9 bulletins PDF, lot d'émission, publication, vérification publique.
4. **Vie scolaire** (éducateur, direction) : `/v2/schoollife` — incidents, mesures ; une exclusion proposée attend la validation de la direction (quatre yeux : le proposant ne valide pas) ; l'effet sur le statut de l'élève est **appliqué par un humain**.
5. **Élèves affectés par l'État** (secrétariat, direction, économe) : `/v2/stateassign` — dossier vérifié, facture scindée famille / État, créance sur l'État ; enregistrez le versement de l'État (paiement d'un financeur) et observez le rapprochement.
6. **Conseil de classe** (direction) : `/v2/councils` — séance ouverte pour le trimestre 2 : propositions, décisions, procès-verbal.
7. **Examens** (responsable des examens) : `/v2/examinations` — session officielle (candidats, éligibilité), examen blanc calculé par la règle de démonstration ; aucun document officiel pour un examen blanc.

### Supérieur : relevés et crédits (`demo-superieur`)

Résultats du semestre 1 (`/v2/results`), relevés de notes PDF (`/v2/reportcards`), crédits capitalisés et rattrapage (`/v2/higher`).

### Transverses

- **Finance et paiement SANDBOX** (économe, parent) : `/v2/finance` — factures, règlements ; côté parent, `/v2/finance/me` : payez en ligne avec le fournisseur `sandbox` (déterministe, sans réseau : un montant se terminant par `001` reste en attente, par `013` échoue, sinon réussit).
- **Bulletins PDF** : téléchargement (URL signée courte), vérification publique d'un document sans connexion (`/v2/verify` ou `GET /api/v1/public/verify/<code>`).
- **Imports** (secrétariat) : `/v2/imports` — un import d'élèves validé vous attend (aperçu, puis exécution avec confirmation) ; modèles CSV/XLSX de chaque importeur dans `.demo/import-templates/`.
- **Portails** : parent (`/v2/parent`), élève (`/v2/student`), enseignant (`/v2/teacher`) : résultats, bulletins, emploi du temps, absences, scolarité.
- **Tableaux de bord de direction et alertes** (propriétaire, directeur) : `/v2/direction`, `/v2/analytics` — effectifs, présence, résultats, scolarité ; trois règles d'alerte sont configurées et évaluées toutes les 15 minutes par le worker (les premières alertes apparaissent après un passage).
- **Hors ligne** : lancez `ED_DEMO_PWA=1 pnpm demo:up` (service worker activé en développement), connectez-vous en enseignant, ouvrez l'emploi du temps et l'appel, puis coupez le réseau (outils du navigateur) : la consultation et la saisie se mettent en file et se rejouent au retour du réseau. Remarque : le cache du service worker peut masquer vos modifications de code en développement ; désinscrivez-le (outils du navigateur) si besoin.
- **Console de la plateforme** : organisations, abonnements, fonctionnalités par plan, impersonation (acte audité).
- **Messagerie et annonces** : `/v2/messages`, `/v2/announcements` — une annonce épinglée avec accusé de réception ; aucun envoi externe (journal `/v2/notifications`, statut SIMULATED).
- **Mot de passe oublié / invitations** : aucun e-mail n'est envoyé ; ouvrez `.demo/mailbox.jsonl` et suivez le champ `link`.

## 7. Limites connues

- **Règles de démonstration** : Primaire et Secondaire utilisent des jeux `placeholder` ; les barèmes officiels (MGA, CEPE, BEPC, BAC, passage…) ne sont pas livrés. Le Supérieur utilise le jeu de la plateforme (`CI-HIGHER-LMD`, portage du calcul historique).
- **Aucun envoi réel** : e-mail et WhatsApp non configurés, SMS Orange en mode `sandbox` (aucun appel réseau), simulation des notifications (statut SIMULATED). Invitations et réinitialisations : boîte aux lettres locale.
- **Paiements** : seul le fournisseur `sandbox` (déterministe, en mémoire du processus) est utilisé ; Orange Money, MTN MoMo, Wave, CinetPay et TresorPay ne sont pas configurés. Un paiement SANDBOX « en attente » créé dans l'interface est réglé par la sandbox de l'API.
- **Pas de passerelle de l'État** pour les élèves affectés : tout est saisi à la main.
- **Next.js en mode développement** (choisi pour sa fiabilité sous Windows) : la première visite de chaque page compile (quelques secondes à une minute) ; les visites suivantes sont rapides.
- **Pages historiques (legacy)** : l'API de démonstration n'expose que les routes v2 ; les anciennes pages (`/parent/children`, `/tableau-de-bord`…) ne fonctionnent pas. Utilisez les écrans `/v2/...` (l'atterrissage après connexion y mène).
- **Données seedées à une date donnée** : l'année scolaire courante commence le 1er septembre ; la démonstration clôt le trimestre / semestre 1 de façon accélérée.
- Les alertes de direction et les relances sont évaluées par des tâches planifiées (15 min, quotidiennes) : elles n'apparaissent pas instantanément.

## 8. Dépannage

| Symptôme | Cause probable et remède |
|---|---|
| « Docker est introuvable ou son démon n'est pas démarré » | Lancez Docker Desktop, attendez qu'il soit prêt, relancez `pnpm demo:up`. |
| Port occupé | Le script choisit le port libre suivant ; sinon `--web-port=3200`. |
| `Une démonstration est déjà en cours` | `pnpm demo:down`, puis `pnpm demo:up`. |
| Le seed échoue (« le tenant existe déjà », état incohérent) | `pnpm demo:reset` puis `pnpm demo:up` : seuls les conteneurs et volumes `ed-demo-*` et le dossier `.demo/` sont supprimés. Journal : `.demo/logs/seed.log`. |
| Les bulletins PDF restent « en cours » ou en échec | Aucun navigateur Chromium trouvé par le worker : installez Chrome/Edge ou définissez `REPORTCARDS_CHROME_PATH`. Journal : `.demo/logs/worker.log`. |
| Page blanche ou erreur de compilation Next.js | Journal `.demo/logs/web.log` ; relancez `pnpm demo:down` puis `pnpm demo:up`. |
| Connexion refusée sur un compte MFA | Code déjà utilisé : attendez 30 s ; l'horloge de la machine doit être exacte. |
| Après la connexion, la page tourne sans fin | Vous êtes sur une page historique : ouvrez `/v2/...` (voir §3). |
| « Des ressources Docker de démonstration existent mais .demo/secrets.json est absent » | Les noms `ed-demo-*` sont uniques par machine : une démonstration lancée depuis une autre copie du dépôt a laissé ses conteneurs ou volumes. `pnpm demo:reset` (supprime uniquement `ed-demo-*`) puis `pnpm demo:up`. |
| Mot de passe perdu | `.demo/credentials.md` (régénéré seulement par `demo:reset`). |
| Nettoyage complet | `pnpm demo:reset`. Les images Docker `postgres:17-alpine` et `redis:7-alpine` restent en cache (`docker rmi` pour les retirer, à votre initiative). |

## 9. Pour les développeurs

- Orchestration : `scripts/demo/cli.mjs` (+ `lib/`), API de démonstration `scripts/demo/api-server.ts` (plateforme v2 assemblée, sans base legacy), seed `scripts/demo/seed.ts` et
  `scripts/seed-v2/demo/*` (scénario de base `scripts/seed-v2/scenario.ts` + prolongement par pack), test de fumée `scripts/demo/smoke.ts`.
- `pnpm demo:seed -- --packs=SECONDARY --suffix=-t1` ajoute un établissement de test (autres slugs) sans toucher aux comptes ; `pnpm demo:restart-web` relance le web.
- Garde-fou Docker : toute opération de création, d'arrêt ou de suppression passe par `assertDemoName` (noms `ed-demo-*` uniquement).
