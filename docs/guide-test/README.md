# Guide de test utilisateur d'EcoleDigitale (version complète)

> **Pour tester pas à pas, commencez par [`docs/GUIDE_TEST_UTILISATEUR_COMPLET.md`](../GUIDE_TEST_UTILISATEUR_COMPLET.md)** : un parcours unique, étape par étape (qui se connecte, quel menu, quoi saisir, ce qu'on doit voir), en 24 phases par module. Les chapitres de ce dossier sont la **référence détaillée** par module (tous les écrans, cas invalides, droits, écarts constatés) ; chaque phase du parcours y renvoie en fin de phase.

Ce dossier est un guide de test **de bout en bout**, écran par écran, de la plateforme EcoleDigitale (v2) lancée **en local**. Il s'adresse à une personne non développeuse ou à un agent "Claude web" qui pilote Chrome. Il remplace, pour la v2, les parties à jour de l'ancien `docs/GUIDE_UTILISATEUR_TEST.md` (démonstration Docker) et reprend les leçons des rapports de testeurs `docs/qa/e2e/rapports/`.

Tout est rédigé en français. Les attendus ont été **lus dans le code** (écrans `apps/web/src/app/v2`, libellés `apps/web/messages/fr-CI.json`, contrats Zod `packages/contracts/src/v2`, droits `apps/api/src/modules/rbac/templates/system-roles.ts`, seed `scripts/seed-v2`). **Aucun scénario n'a été exécuté dans le navigateur par les rédacteurs** : un attendu qu'ils n'ont pas pu prouver est marqué "à vérifier en test" (section dédiée à la fin de chaque chapitre). Voir [Limites de ce guide](#limites-de-ce-guide).

## 1. Environnement de test

| Élément | Valeur |
|---|---|
| Démarrage | `demarrer-application.bat` à la racine du dépôt, ou : `pnpm dev:v2:setup` (une fois, Docker requis) puis `pnpm dev:v2`, puis `pnpm dev:v2:seed` pour créer les trois établissements de test |
| Application web | http://localhost:3000 (adresses du guide : `http://localhost:3000/v2/...`) |
| API | http://localhost:4000 (santé : `/api/v1/health`) |
| Base | `ecoledigitale_v2` (locale). **Ne touchez à aucune autre base.** |
| Connexion | page `http://localhost:3000/v2/login` : le panneau de droite (« Comptes par tenant ») liste les **37 comptes** de test (constaté dans le navigateur intégré : sur `/login` seul le formulaire s'affichait, sans panneau ; voir l'écart du chapitre 02) ; un clic remplit le formulaire ; pour les comptes à double authentification (MFA), le code du moment est proposé (il change toutes les 30 secondes, un code ne sert qu'une fois) |
| Opérateur de la plateforme | compte distinct de ces 37 comptes, connexion sur `/v2/platform/login` (voir chapitre 01) |
| Envois | aucun effet externe : e-mails, SMS et WhatsApp sont **simulés** ; le paiement en ligne utilise le fournisseur « Paiement simulé (démonstration) » |
| Règles de calcul | toutes les règles (moyennes, passage, BEPC, BAC, CEPE…) sont des **règles de démonstration** (bandeau/filigrane). Aucune règle officielle ivoirienne n'est livrée |

**Paiement simulé** : un montant dont les trois derniers chiffres sont `001` reste **en attente**, `013` **échoue**, tout autre montant **réussit**. Le fournisseur simulé n'apparaît dans l'écran de paiement en ligne que si le serveur web est lancé avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` (voir chapitre 12).

**Hors ligne / application installable** : en développement le service worker n'est pas enregistré par défaut ; lancer avec `NEXT_PUBLIC_PWA=1 pnpm dev:v2` pour les scénarios 22.25 à 22.27.

**Aucun mot de passe ni code MFA n'est écrit dans ce guide**, et il ne faut jamais en recopier dans un rapport.

## 2. Établissements et comptes

Trois établissements fictifs, 37 comptes (e-mails, rôles, MFA, élèves, tuteurs, matières, frais : voir [annexe-donnees-de-depart.md](annexe-donnees-de-depart.md)) :

- **Collège Le Baobab** (`secondaire-test`) : 12 comptes, classe 6e A.
- **École Les Palmiers** (`primaire-test`) : 13 comptes (dont l'instituteur de maternelle), classes CP1 A et Grande Section A.
- **Université Horizon** (`superieur-test`) : 12 comptes, Licence 1 A (UE/ECUE, crédits).

Rôles : propriétaire, directeur, directeur des études, responsable pédagogique, secrétariat, économe, enseignant (instituteur au primaire), éducateur, responsable des examens, chargé d'admissions, parent, élève (+ opérateur de la plateforme). L'e-mail des comptes suit `rôle@<slug>.test` (par exemple `econome@secondaire-test.test`).

## 3. Contenu du dossier

| Fichier | Contenu |
|---|---|
| [00-inventaire-ecrans.md](00-inventaire-ecrans.md) | les **301 écrans** de l'application : module, URL, rôles, fonctions, scénario qui les couvre (ou raison de non-couverture) |
| [01](01-plateforme-et-etablissement.md) Plateforme et établissement | console opérateur, organisations, abonnement, plans, profil, campus, mise en service, rôles et attributions, audit |
| [02](02-connexion-mfa-comptes.md) Connexion, MFA, comptes | page de connexion, MFA, verrouillage, mots de passe, sessions, membres, établissements |
| [03](03-structure-academique.md) Structure académique | années, périodes, programmes, curriculum, classes, offres, reconduction |
| [04](04-personnes.md) Personnes | élèves, tuteurs, personnel, inscriptions |
| [05](05-imports.md) Imports | gabarits et fichiers CSV/XLSX/XLS/ODS valides et en erreur |
| [06](06-presences.md) Présences | appel, validation, justificatifs, absences, alertes, personnel |
| [07](07-emploi-du-temps.md) Emploi du temps | salles, créneaux, séances, remplacements, générateur, export |
| [08](08-evaluations-notes.md) Évaluations et notes | création, saisie, relecture, publication, corrections |
| [09](09-regles-resultats.md) Règles et résultats | jeux de règles, résultats, surcharges, clôture, rattrapage |
| [10](10-bulletins-documents-officiels.md) Bulletins et documents officiels | identité, signataires, modèles, émission, vérification publique |
| [11](11-superieur.md) Supérieur | UE/ECUE, crédits, dispenses, rattrapage, diplômes, attestations |
| [12a](12a-finance-catalogue-factures.md), [12b](12b-finance-encaissements-recus.md), [12c](12c-finance-famille-rapprochement-pilotage.md) Finance | frais, factures, encaissements, reçus, remboursements, caisse, famille, rapports |
| [13](13-paie.md) Paie | configuration, périodes, bulletins de paie, quatre yeux |
| [14](14-documents-ged.md) Documents (GED) | dépôt, versions, recherche, confidentialité, quarantaine |
| [15](15-messagerie-notifications.md) Messagerie et notifications | messages, annonces, notifications, gabarits |
| [16](16-tableaux-de-bord-analytics.md) Tableaux de bord | direction, propriétaire, alertes, comparaisons |
| [17](17-admissions.md) Admissions | campagnes, candidatures, décisions, offres, portail public |
| [18](18-pack-primaire.md) Pack primaire | compétences, conseil des maîtres, bilan annuel |
| [19a](19a-vie-scolaire.md), [19b](19b-conseils-de-classe.md), [19c](19c-eleves-affectes-etat.md) Pack secondaire | vie scolaire, conseils de classe, élèves affectés par l'État |
| [20](20-examens.md) Examens | types, sessions, candidats, centres, notes, résultats, documents |
| [21](21-portails-parent-eleve-enseignant.md) Portails | parent, élève, enseignant |
| [22](22-accessibilite-mobile-pwa.md) Accessibilité, mobile, PWA | clavier, lecteur d'écran, 375 px, hors ligne |
| [23](23-parcours-de-bout-en-bout.md) Parcours de bout en bout | dix parcours (A à J) qui enchaînent les chapitres |
| [24](24-securite-isolation-droits.md) Sécurité, isolation, droits | matrice rôle × module, adresses interdites, isolation, quatre yeux, MFA, audit |
| [jeux-de-donnees/](jeux-de-donnees/README.md) | fichiers d'import et pièces d'exemple + [annexe-donnees.md](jeux-de-donnees/annexe-donnees.md) (index de tous les enregistrements fictifs créés, pour suivi et nettoyage) |

## 4. Ordre recommandé

1. Lire ce README et l'[annexe des données de départ](annexe-donnees-de-depart.md).
2. **Chapitres 02 puis 01** (connexion, console, abonnement) : tout le reste dépend des menus autorisés par l'abonnement.
3. **Mise en place de l'école** : 03 (structure) → 04 (personnes) → 05 (imports) → 17 (admissions) → 07 (emploi du temps).
4. **Vie de l'école** : 06 (appel) → 08 (évaluations et notes) → 09 (règles, résultats) → 10 (bulletins) → 12 (finance) → 13 (paie) → 14 (documents) → 15 (messagerie).
5. **Packs** : 18 (primaire), 19 (secondaire), 11 (supérieur), 20 (examens).
6. **Pilotage et portails** : 16 (tableaux de bord) → 21 (portails).
7. **Transversal** : 22 (accessibilité, mobile, PWA), 24 (sécurité).
8. **Parcours** du chapitre 23 (A, D, E d'abord ; B, C, F à J ensuite).
9. Actes **irréversibles en dernier** (publication, clôture, scellement, révocation, versement), une seule fois : chaque chapitre les signale "(Attention : action durable/irréversible)".

Les trois établissements sont indépendants : ils peuvent être testés en parallèle (une fenêtre par établissement, un navigateur ou profil par compte : deux fenêtres privées d'un même navigateur partagent la session).

## 5. Comment lire un scénario

Chaque scénario suit le même modèle :

```
#### X.Y Titre du scénario
Compte : <rôle> (<établissement>) · Où : menu "…" > "…" (`/v2/…`) · Prérequis : …
1. Action précise.
2. Cliquer « Créer » : remplir le formulaire :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
3. Cliquer "…".
Résultat attendu : message exact, ligne visible dans la liste, valeur persistée après rechargement.
Cas invalides : | Saisie | Message attendu |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour <rôle>
```

Conventions :

- Un texte entre guillemets français (comme le bouton Créer écrit avec les chevrons) = **libellé exact de l'interface** (vérifié contre `fr-CI.json` par le script de contrôle). `"Texte entre guillemets droits"` = nom d'un enregistrement créé, valeur à saisir, message du serveur ou texte absent de `fr-CI.json` (à comparer avec ce qui s'affiche). `` `Code` `` = URL, code ou valeur technique.
- **Données fictives uniquement** : noms ivoiriens inventés, e-mails en `@exemple.test`, téléphones factices. Chaque enregistrement créé porte le suffixe "test guide" ou le préfixe `TG-` ; l'index est dans [jeux-de-donnees/annexe-donnees.md](jeux-de-donnees/annexe-donnees.md).
- Chaque chapitre commence par ses **prérequis, comptes, droits (dont au moins 3 adresses à taper à la main qui doivent être refusées), données de départ**, et se termine par **Données créées, Écarts constatés, À vérifier en test, Non couvert**.
- Cases à cocher : une case par résultat (nominal, invalide, droit refusé). Cocher seulement après avoir **observé** le résultat attendu.
- Les **codes d'erreur bruts, anglais ou techniques** affichés à l'écran sont à consigner comme anomalies (mineures) : le guide les signale quand le code les laisse prévoir.

## 6. Échelle de sévérité

- **Bloquant** : page ou parcours inutilisable (page blanche, erreur technique), perte ou fuite de données, **faille d'isolation ou de droits** (voir ce qu'on ne devrait pas voir), action irréversible sans garde-fou. Prévenir sans attendre la fin de la session.
- **Majeur** : fonction importante qui échoue ou donne un résultat faux (contournable), droit manquant qui empêche un rôle de travailler, libellé qui induit en erreur sur une donnée officielle.
- **Mineur** : défaut d'affichage, libellé anglais ou technique, faute, message peu clair, lenteur ponctuelle.
- **Suggestion** : amélioration d'ergonomie ou de clarté, sans défaut avéré.

Un refus de droit attendu (403, « Accès refusé », "introuvable") n'est **pas** une anomalie ; un 500 n'est jamais attendu. La première visite d'une page peut être lente en mode développement : recharger une fois avant de signaler.

## 7. Modèle de rapport d'anomalie

Une anomalie = un constat, numéroté `C-<chapitre>-<nn>` (exemple `C-12-03`).

| Rubrique | Contenu |
|---|---|
| Titre | court et précis |
| Sévérité | Bloquant / Majeur / Mineur / Suggestion |
| Scénario du guide | numéro (ex. 12.28) |
| Compte / établissement | rôle affiché, établissement |
| Écran / URL | titre de la page et adresse sans identifiant sensible |
| Étapes pour reproduire | 1. … 2. … 3. … (depuis la connexion si nécessaire) |
| Résultat obtenu | messages recopiés mot pour mot |
| Résultat attendu | avec la référence du guide |
| Console / réseau | erreurs de console ; requêtes 4xx/5xx (méthode, adresse, code) |
| Reproductibilité | à chaque fois / parfois / une fois |
| Connu ? | non / oui (voir "Écarts constatés" du chapitre) |
| Suggestion | facultatif |

Ne jamais coller de mot de passe, code MFA, jeton, lien d'invitation ou de réinitialisation dans un rapport. Le modèle complet de session figure dans `docs/qa/e2e/MODELE-RAPPORT.md`.

## 8. Contrôle automatique du guide

```bash
node scripts/check-guide-test.mjs
```

Le script vérifie que (a) chaque route `/v2/...` citée existe dans l'App Router, (b) chaque libellé "…" cité existe dans `apps/web/messages/fr-CI.json` (les libellés présents seulement dans le code des écrans sont listés en avertissement), (c) chaque écran de l'App Router figure dans `00-inventaire-ecrans.md`. Il doit rester vert après toute modification du guide. Les fichiers et dossiers dont le nom commence par `_` sont ignorés.

## Limites de ce guide

- **Rédigé par lecture du code, pas par exécution.** Aucun scénario n'a été joué en entier dans le navigateur ; seul un échantillon d'écrans a été visité à la fin de la rédaction (voir le compte rendu de la tâche). Les valeurs calculées (moyennes, soldes, totaux) sont des calculs sur la chaîne de données du guide, à confirmer à l'écran.
- Des **défauts de l'application** ont été relevés pendant la rédaction (sections "Écarts constatés" de chaque chapitre) : ils ne sont pas corrigés ici. Certains peuvent empêcher un scénario d'aboutir (ex. création de diplôme au chapitre 11, signature du procès-verbal au chapitre 19b, formulaire public de candidature au chapitre 17).
- Ce que la démonstration ne permet pas de tester : paiements, e-mails, SMS et WhatsApp réels, passerelle de l'État, reversement des fonds partagés, OCR des PDF, envoi de courrier (invitations et réinitialisations de mot de passe inatteignables en local).
- Nettoyage : l'application ne supprime pas la plupart des objets créés. Pour repartir à neuf, recréer la base locale `ecoledigitale_v2` puis relancer `pnpm dev:v2:seed`.
