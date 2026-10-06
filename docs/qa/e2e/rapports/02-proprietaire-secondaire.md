# Rapport de session 02 : Propriétaire / Collège Le Baobab
- Compte (rôle affiché, JAMAIS le mot de passe) : Propriétaire (compte `direction.generale@secondaire-test.test`, rôle actif affiché « Propriétaire », MFA)
- Établissement : Collège Le Baobab (démonstration), pack Secondaire, offre PROFESSIONAL
- Date et heure de début / durée : 6 oct. 2026, environ 12:05 / environ 1 h 10
- Version de l'application (commit ou version affichée, sinon « non affichée ») : non affichée
- Navigateur : Chrome (Windows, piloté par Claude dans Chrome), mode développement Next.js

Remarque d'environnement : à l'ouverture de `/login`, Chrome avait pré-rempli le formulaire avec une adresse e-mail qui n'est pas un compte de test. Elle n'a pas été utilisée ; seul le compte Propriétaire du panneau « Comptes par tenant » a servi.

## Parcours exécutés
| Parcours | Résultat (✅ / ⚠️ / ❌) | Constats liés | Remarque |
|---|---|---|---|
| P1. Connexion MFA et arrivée | ⚠️ | C-02-03, C-02-05 | Code redemandé à chaque connexion ✅ ; code faux refusé (« Code invalide. Vérifiez l'heure de votre téléphone. ») ✅ et tracé `login.failed` ✅ ; « Rôle actif : Propriétaire » ✅. Test « code déjà utilisé » non concluant (code remplacé automatiquement par un nouveau avant l'envoi). |
| P2. Profil et marque | ⚠️ | C-02-11 | Nom commercial et couleur modifiés, en-tête mis à jour, puis rétablis (vérifié après rechargement). |
| P3. Abonnement, usage, fonctionnalité non incluse | ⚠️ | C-02-03, C-02-04, C-02-05 | Plan, pack, 34 fonctionnalités, « Aucun usage mesuré ». `/v2/primary/classe` : message « non incluse », mais la navigation du pack Primaire reste visible. |
| P4. Rôles et attributions | ✅ | (C-02-05, C-02-14) | Clone « Surveillant test » créé, 1 permission retirée (15 → 14), attribué puis révoqué. Retrait du dernier propriétaire refusé (« Action refusée : l'établissement doit toujours conserver au moins un propriétaire. »). Rôle système verrouillé. |
| P5. Membres : inviter, suspendre, rétablir | ⚠️ | C-02-05, C-02-07 | Invitation, suspension (« Suspendu »), rétablissement OK. Lien d'invitation non affiché : non testé. |
| P6. Sécurité du compte et sessions | ⚠️ | C-02-05 | Écrans disponibles, politique « 12 caractères minimum » affichée, sessions « 2 étapes ». Export d'audit non exécuté (téléchargement). |
| P7. Journal d'audit | ⚠️ | C-02-05, C-02-06 | Filtre invalide refusé (« La fin de période doit suivre le début. »), chaîne intègre (427 entrées vérifiées, aucune anomalie). Détail d'entrée introuvable depuis l'écran. |
| P8. Tableaux de bord et alertes | ❌ | C-02-01, C-02-03, C-02-10, C-02-12, C-02-13 | Effectifs/présences incohérents (C-02-01). Scolarité, trésorerie, pédagogie, admissions, vie scolaire cohérents. Règle créée, alerte acquittée. |
| P9. Paie : réglages propriétaire | ✅ | | Seuil propriétaire modifié (500 000) puis rétabli (vide), vérifié après rechargement. Trace d'audit de la modification non vérifiée. |
| P10. Messagerie et annonces | ⚠️ | C-02-02, C-02-08 | Annonce épinglée avec accusé publiée, suivi des accusés visible. Journal des notifications : 67 échecs d'e-mail. |
| P11. Vues propres au Secondaire | ⚠️ | C-02-09 | Agrégats cohérents avec « Vie scolaire » (2 incidents, 1 mesure). « Effets des décisions » vide alors que le tableau de bord annonce 1 effet en attente. |

## Constats
### C-02-01 : Effectifs et présences : les répartitions (149) contredisent les totaux (14 inscriptions, 9 élèves)
- Sévérité : Majeur
- Écran / URL : `/v2/direction/effectifs`
- Étapes pour reproduire : se connecter en Propriétaire, ouvrir « Effectifs et présences », année en cours, lire les blocs du haut puis « Répartition des inscriptions » et « Inscriptions par origine ».
- Résultat obtenu : le haut de page indique « Élèves en scolarité 9 », « 14 inscription(s) tous statuts confondus », « Inscriptions confirmées 9 ». Les répartitions donnent : sexe Filles 86 + Garçons 63 = 149 ; niveau 6e = 149 ; financement Famille 138 + Affecté par l'État 11 = 149 ; statut Active 99 + En attente 50 ; origine Saisie manuelle 128 + Admission 21. Le tableau « Effectifs par classe » donne 6e A : 9 élèves (6 filles, 3 garçons). La liste « Élèves » compte bien 14 dossiers (9 actifs, 5 en attente).
- Résultat attendu : toutes les répartitions totalisent 14 inscriptions (9 actives, 5 en attente) et reprennent la liste « Élèves ».
- Console / réseau : aucune erreur de console. Capture réseau non exploitable.
- Suggestion de correction : vérifier l'agrégation des répartitions (somme multipliée ou jointure dupliquée, par exemple les valeurs 99/50 pour 9/5) et ajouter un test comparant ces totaux au nombre d'inscriptions.

### C-02-02 : Alertes de direction : e-mails en échec « template_error » (67 échecs au journal)
- Sévérité : Majeur
- Écran / URL : `/v2/notifications` (Journal des envois)
- Étapes pour reproduire : ouvrir « Journal des notifications », fenêtre 30 j.
- Résultat obtenu : compteurs Envoyé 14, Échec 67, Non envoyé 97, Simulé 16. Les e-mails du gabarit `analytics_alert (version 0)` (origine `analytics.alert_raised`, 6 oct. 2026, 11:45) sont en « Échec » : « template_error — La variable « appUrl » doit être un chemin interne (/…) ou une adresse https. », tentatives 0 sur 5. Seule la copie « Application » est « Envoyé ».
- Résultat attendu : l'e-mail de l'alerte est produit (en statut « Simulé » en environnement de test) sans erreur de gabarit.
- Suggestion de correction : en local, `appUrl` est probablement une adresse `http://localhost` refusée par la règle « chemin interne ou https » ; accepter l'adresse locale en mode développement ou fournir un chemin interne. Les messages d'erreur du journal devraient aussi être rédigés en français lisible.

### C-02-03 : Messages « non inclus dans l'offre » affichés à tort pendant le chargement
- Sévérité : Mineur
- Écran / URL : `/v2/audit`, `/v2/direction/effectifs`, `/v2/analytics/alertes/regles`, `/v2/primary/classe` (message « Établissement inconnu »), `/v2/access/assignments`
- Résultat obtenu : pendant plusieurs secondes, le menu est en squelette et la page affiche « Le pilotage de la direction n'est pas inclus dans l'offre de votre établissement. » ou « Cette fonctionnalité n'est pas incluse dans votre offre. » (audit), puis la vraie page apparaît. Sur « Attributions de rôles », « La liste des membres n'est pas accessible avec vos droits » et des UUID s'affichent brièvement avant les adresses e-mail. Sur `/v2/primary/classe`, « Établissement inconnu… » apparaît avant le message « non incluse ».
- Résultat attendu : un état de chargement neutre tant que l'abonnement et les droits ne sont pas connus.
- Suggestion de correction : ne rendre le message « non inclus » qu'une fois les droits d'accès et l'abonnement chargés.

### C-02-04 : Fonctionnalité non incluse (`/v2/primary/classe`) : menu du pack Primaire visible et erreur d'hydratation
- Sévérité : Mineur
- Résultat obtenu : message « Cette fonctionnalité n'est pas incluse dans l'abonnement de votre établissement. » (OK, sans donnée), mais la page affiche aussi les onglets du pack Primaire et un bandeau « Impossible de vérifier si les règles employées sont des règles de démonstration… » hors de propos.
- Console / réseau : 2 erreurs de console : « Hydration failed because the server rendered HTML didn't match the client », composant `ClassScreen` / `LoadingBlock` (`role="alert"` côté serveur contre `role="status"` côté client).
- Suggestion de correction : masquer les onglets et la bannière de règles quand la fonctionnalité n'est pas incluse ; rendre le même bloc côté serveur et côté client.

### C-02-05 : Codes techniques et libellés anglais affichés à l'utilisateur
- Sévérité : Mineur
- Écran / URL : `/v2/account/sessions`, `/v2/admin/members`, `/v2/settings/subscription`, `/v2/audit`
- Résultat obtenu : « rôle owner · 2 étapes » ; rôles bruts `owner`, `directeur_etudes`, `responsable_pedagogique`, `admissions_officer`, `teacher` ; offre « PROFESSIONAL » et groupes de fonctionnalités `academic (2)`, `admissions (4)`… ; actions et entités d'audit brutes `membership.changed`, `rbac.assignment.granted`, `role_assignment` ; clés techniques des permissions sous chaque libellé.
- Résultat attendu : libellés français, les clés techniques restant en aide secondaire.
- Suggestion de correction : table de traduction des rôles, groupes de fonctionnalités et actions d'audit.

### C-02-06 : Journal d'audit : acteur illisible et aucun accès au détail d'une entrée
- Sévérité : Mineur
- Écran / URL : `/v2/audit`
- Résultat obtenu : colonne « Acteur » = « Utilisateur 01a110ee-… » (UUID), « Changements » = « 1 champ » / « 6 champs » sans détail ; aucune ligne ne mène au détail (la page `/v2/audit/<id>` existe mais n'est reliée à rien, « Chargement en cours… » pour un identifiant inexistant).
- Résultat attendu : acteur nommé, détail accessible depuis la liste, entrée inexistante avec message « introuvable » clair.

### C-02-07 : Invitation : message affirmant un envoi d'e-mail, statut « Actif » immédiat
- Sévérité : Mineur
- Écran / URL : `/v2/admin/members`
- Résultat obtenu : « Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail. » alors que les envois sont simulés. Le membre apparaît aussitôt « Actif ». Le lien d'invitation n'est affiché nulle part.
- Résultat attendu : statut « Invité » tant que le mot de passe n'est pas défini ; message cohérent avec le mode simulé.

### C-02-08 : Annonce : cible affichée par identifiant partiel, effectif des destinataires à clarifier
- Sévérité : Mineur
- Écran / URL : `/v2/announcements/<id>`
- Résultat obtenu : « Ciblage : Classe (01a110ee…) — Élèves, Parents et tuteurs » ; « Destinataires : 2 » alors que la classe compte 9 élèves actifs ; l'auteur est affiché « direction.generale ».
- Résultat attendu : nom de la classe ; effectif expliqué ; auteur nommé.

### C-02-09 : Incohérence « Effets en attente » entre Vie scolaire et Effets des décisions
- Sévérité : Mineur
- Écran / URL : `/v2/schoollife` et `/v2/councils/effets`
- Résultat obtenu : « 1 Effets en attente d'une décision » sur « Vie scolaire » ; « Aucun effet ne correspond à ces filtres. » sur « Effets des décisions » (tous statuts).
- Résultat attendu : le même effet apparaît dans les deux écrans.

### C-02-10 : Fraîcheur des données : message contradictoire et périmètres bruts
- Sévérité : Mineur
- Écran / URL : `/v2/owner/fraicheur`
- Résultat obtenu : « Aucune donnée n'a encore été calculée pour cet écran. » au-dessus d'un tableau de sources toutes « À jour » ; périmètres `*`, `2026-09-01..2026-09-01` ou UUID. Des lignes « Présences des élèves » alors que « Effectifs et présences » indique « Aucun appel soumis ».

### C-02-11 : Profil et marque : sélecteurs de couleur noirs quand la couleur est vide
- Sévérité : Mineur
- Écran / URL : `/v2/settings`
- Résultat obtenu : pastilles noires (`#000000`) alors que les champs sont vides et l'aperçu bleu.

### C-02-12 : Scolarité : libellé « Avances et trop-perçus » sans valeur
- Sévérité : Mineur
- Écran / URL : `/v2/owner/scolarite`
- Résultat attendu : « 0 F CFA » ou libellé masqué.

### C-02-13 : Étiquettes de dates abrégées ou tronquées dans les graphiques
- Sévérité : Mineur
- Écran / URL : `/v2/owner/tresorerie`, `/v2/direction/effectifs`
- Résultat obtenu : axes « 25-10 … 26-10 » ; « Inscriptions créées par mois » affiche « 2026- » (étiquette tronquée).
- Résultat attendu : mois au format français (« oct. 2025 »).

### C-02-14 : Éditeur de rôles : permissions de modules non souscrits, indicateur « taux d'absence » absent
- Sévérité : Suggestion
- Écran / URL : `/v2/access/roles/<id>`, `/v2/analytics/alertes/regles`
- Résultat obtenu : l'éditeur propose les permissions « Pack Primaire » (0 sur 27) et « Enseignement supérieur » (0 sur 18) alors que l'offre est « Secondaire ». Pour les alertes, aucun indicateur « taux d'absence » : seul « Taux de présence des élèves ». « Responsable des admissions » (règles d'alerte) diffère de « Chargé d'admissions » ailleurs (écart déjà connu).
- Suggestion de correction : filtrer les permissions par abonnement ; préciser « présence » dans l'aide du seuil.

## Données créées (fictives)
| Type | Libellé / référence | Écran |
|---|---|---|
| Rôle personnalisé (clone de « Chargé d'admissions », 14 permissions) | Surveillant test (`surveillant_test`), conservé | `/v2/access/roles` |
| Attribution | Surveillant test attribué à un compte de test puis révoqué | `/v2/access/assignments` |
| Membre invité | `invite.test@exemple.test`, rôle Enseignant, suspendu puis rétabli (reste « Actif ») | `/v2/admin/members` |
| Règle d'alerte | « Absences élevées (test QA) » : taux de présence sous 85 % sur 30 jours | `/v2/analytics/alertes/regles` |
| Alerte acquittée | « Taux de recouvrement bas » passée en « Accusée de réception » | `/v2/analytics/alertes` |
| Annonce épinglée | « Réunion des parents : rentrée (test QA) », cible 6e A, accusé demandé | `/v2/announcements` |
| Réglages modifiés puis rétablis | Nom commercial et couleur ; seuil de validation propriétaire de la paie (500000 puis vide) | `/v2/settings`, `/v2/payroll/configuration/settings` |

Aucune action irréversible n'a été exécutée.

## Points non testés et pourquoi
- Export CSV du journal d'audit : non exécuté (téléchargement non validé).
- Code MFA « déjà utilisé » : test non concluant (le champ se remplit automatiquement avec un nouveau code).
- Lien d'invitation : aucun lien affiché, boîte locale non accessible.
- Traces d'audit des connexions réussies et de la modification du seuil de paie : non vérifiées.
- Clavier (Tab, Échap) : non concluant avec l'outil de pilotage.
- Console et réseau : console relevée ; l'outil réseau n'a listé aucune requête `/api`.
- Recherche dans les PDF : aucun PDF indexé dans la graine, résultat non exploitable.
- Isolation entre établissements : seul un identifiant fictif a été ouvert ; `/v2/platform/tenants` renvoie bien vers `/v2/platform/login` (✅).
- Réinitialisation de la MFA, révocation de sessions d'autres membres, changement de mot de passe : non touchés volontairement.
- Règles de démonstration : bandeau présent sur le tableau de bord, « Indicateurs » et « Pédagogie » ; aucune conclusion réglementaire tirée.

## Traitement par le développeur (2026-10-06)
| Constat | Verdict | Action |
|---|---|---|
| C-02-01 | **Faux positif de lecture** (à reclasser Mineur : accessibilité). L'API renvoie les bons chiffres (`/api/v1/analytics/enrollment` : filles 8, garçons 6, total 14 ; actives 9, en attente 5). Le texte de la page colle le nombre d'inscriptions et la colonne « En scolarité » sans séparateur : « 8 » + « 6 » se lit « 86 », « 12 » + « 8 confirmée(s) » se lit « 128 ». | À faire : séparer visuellement et pour les lecteurs d'écran les deux valeurs de chaque ligne (libellés « inscriptions » / « en scolarité »). |
| C-02-02 | **Défaut réel corrigé.** La variable intégrée `appUrl` valait `http://localhost:3000` (V2_APP_BASE_URL) et la règle « chemin interne ou https » la refusait : gabarit en erreur. | `apps/api/src/modules/notifications/domain/templating.ts` : l'adresse de base configurée par l'exploitant est acceptée telle quelle ; toute autre adresse reste soumise à la règle. Tests notifications verts (82). |
| C-02-03 à C-02-14 | Confirmés à traiter (Mineur / Suggestion). | À planifier dans la prochaine passe de corrections. |
