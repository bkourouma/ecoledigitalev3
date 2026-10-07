# Rapport de session 04 : Secrétariat / Collège Le Baobab (secondaire-test)

- **Compte** : Secrétariat (secretariat@secondaire-test.test), MFA validé
- **Établissement** : Collège Le Baobab (démonstration), tenant secondaire-test
- **Date** : 6 octobre 2026, après-midi ; durée non chronométrée
- **Navigateur** : Chrome (Claude in Chrome), http://localhost:3000, mode développement

> Rappel : règles du pack secondaire = règles de DÉMONSTRATION. Le seul écran officiel rencontré (conseil de classe) porte le bandeau ; aucun PV ni bulletin généré.

## Parcours exécutés
| Parcours | Résultat | Remarque |
|---|---|---|
| P1 Élèves : recherche, fiche, tuteurs, fratrie | ✅ | C-04-13, C-04-14 |
| P2 Création élève + tuteur, contrôles | ⚠️ | Création et contrôles OK ; seuls KOUASSI et COULIBALY Fatou créés |
| P3 Inscription, double inscription refusée, statuts | ⚠️ | Seule l'action « Annuler » existe (C-04-15) ; annulation non exécutée |
| P4 Imports (4 formats) | ⚠️ | 4 formats validés jusqu'à l'aperçu (4 à créer, 1 en erreur chacun), aucun exécuté ; C-04-08, C-04-09, C-04-10 |
| P5 Admissions : candidature TRAORE Aminata | ⚠️ | Candidature déposée ; consentement bloquant (C-04-01) ; pièce impossible (C-04-12) ; bouton « Refusé » présent (C-04-04) ; `/v2/admissions/settings` refusé ✅ |
| P6 Suivi des appels, justificatifs | ❌ | Listes vides, aucune fonction de dépôt (C-04-06) |
| P7 Bulletins, émission | ✅ | Pré-contrôle « 9 éligibles » ; rien généré (C-04-18) |
| P8 GED | ⚠️ | Dépôt, format refusé, recherche PDF ✅ ; doublon = 500 (C-04-02) ; partage (C-04-07) ; message au personnel impossible (C-04-05) |
| P9 Élèves affectés | ⚠️ | Lecture ✅, dossier de test enregistré ✅ ; bandeau d'erreur (C-04-03) |
| P10 Conseils de classe | ✅ | Séance planifiée ; bandeau démonstration présent ; C-04-19 |
| P11 URL interdites | ✅ | 7 sur 7 refusées |
| Partie C Isolation croisée | ⏭️ | Identifiants non fournis |

## Constats
### C-04-01 — Consentement parental impossible sans connaître la « version du texte »
- **Gravité** : Majeur
- **Étapes** : Admissions > Candidatures > TRAORE Aminata (2026-00010) > « Consigner un consentement » > tuteur Fatou COULIBALY, mode « Document papier », référence « REG-TEST-QA-001 ».
- **Obtenu** : le champ « Version du texte accepté » est libre, sans liste ni exemple. « v1 (test QA) » et « 1 » refusés (« Version du texte de consentement inconnue ou retirée. », POST `/api/v1/admissions/applications/<id>/consents` en 400). Seule « v1 » (devinée) passe.
- **Attendu** : une liste des versions en vigueur, présélectionnée.
- **Suggestion** : remplacer le champ texte par une liste des versions actives.

### C-04-02 — Dépôt d'un doublon dans la GED : erreur 500 générique
- **Gravité** : Majeur
- **Étapes** : GED > Déposer un document > même PDF, même élève, visibilité « Personnel seulement ».
- **Obtenu** : « Une erreur est survenue. Veuillez réessayer. » ; POST `/api/v1/documents/documents` en 500 ; aucun doublon créé.
- **Attendu** : doublon signalé clairement (même empreinte SHA-256), avec choix de continuer ou non.
- **Suggestion** : traiter la contrainte d'unicité de l'empreinte et renvoyer un message métier.

### C-04-03 — « Élèves affectés » : bandeau « Action non autorisée » alors que la page fonctionne
- **Gravité** : Majeur
- **Obtenu** : bandeau « Action non autorisée. » au-dessus d'une liste qui s'affiche normalement ; le formulaire « Enregistrer un dossier » fonctionne.
- **Réseau** : `GET /api/v1/tenancy/institutions` en 403 (même cause que C-03-01) ; la liste `/api/v1/stateassign/assignments` répond 200.
- **Suggestion** : ne pas appeler cette liste pour ce rôle, ou accorder la lecture minimale.

### C-04-04 — Boutons de décision visibles sur une candidature pour le secrétariat
- **Gravité** : Majeur (à confirmer : clic non testé)
- **Obtenu** : « En étude », « Refusé », « Retiré par la famille », « Dossier en double » ; pas de bouton « Admis ».
- **Attendu** : pas de bouton Admis/Refusé pour ce rôle.
- **Suggestion** : masquer les décisions non autorisées, ou confirmer par la matrice des droits.

### C-04-05 — Messagerie : aucune écriture possible
- **Gravité** : Majeur
- **Obtenu** : boîte vide, aucun bouton « Nouveau message » ; `/v2/messages/new` affiche « Vous ne pouvez pas envoyer de message pour le moment. »
- **Attendu** : un moyen d'écrire à un collègue, ou un message expliquant pourquoi c'est impossible pour ce rôle.

### C-04-06 — Justificatifs d'absence : dépôt introuvable
- **Gravité** : Majeur
- **Obtenu** : listes vides, aucun bouton de dépôt. Aucun bouton de décision visible (conforme).
- **Attendu** : une action de dépôt pour le secrétariat, selon le parcours.

### C-04-07 — Partage d'un document « Personnel seulement » avec un tuteur, sans avertissement
- **Gravité** : Majeur (à confirmer : visibilité réelle côté tuteur non testée)
- **Obtenu** : « Document partagé avec COULIBALY Fatou. » sans mise en garde, alors que la visibilité indique que l'élève et les tuteurs ne le voient pas. La recherche « Partager avec » ne trouve que des tuteurs, aucun membre du personnel.
- **Suggestion** : avertir ou bloquer ; rendre les comptes du personnel trouvables.

### C-04-08 — Assistant d'import figé sur « Validation en cours 0 / 5 »
- **Gravité** : Majeur
- **Obtenu** : l'écran reste à « 0 / 5 (0 %) » plusieurs dizaines de secondes alors que le serveur a fini (POST `.../validate` 202) ; l'aperçu n'apparaît qu'après rechargement de la page (`/v2/imports/<id>`). Constaté sur les 4 formats.
- **Attendu** : progression mise à jour puis passage automatique à l'aperçu.
- **Réseau** : une seule lecture du job après `/validate`, pas de relecture périodique.

### C-04-09 — Messages d'import avec codes techniques et numéro de ligne ambigu — Mineur
« … n'est pas une date valide … imports.invalid_date », « Classe « 6E-Z » inconnue … imports.reference_unknown ». La 5e ligne de données est appelée « Ligne 6 » (en-tête comptée).

### C-04-10 — Import de démonstration « Prêt à importer » avec 15 lignes sur 15 en erreur — Mineur
Statut « Prêt à importer » alors que toutes les lignes sont en erreur, code brut `imports.options_invalid`.

### C-04-11 — Fiche candidature : codes anglais et étape incohérente — Mineur
« Fatou COULIBALY (MOTHER) », « Prise en charge PRIVATE », « Origine WALK_IN » ; état « Brouillon » mais étape « Candidature reçue ». Renvoi C-02-05.

### C-04-12 — Aucune pièce demandée : impossible de joindre l'acte de naissance — Mineur
« Aucune pièce n'est demandée pour ce dossier. », aucun bouton de dépôt.

### C-04-13 — Assistant de création d'élève et de tuteur : champs et libellés — Mineur
Pas de téléphone ni d'e-mail pour le tuteur ; aide du champ sexe du tuteur : « Obligatoire pour un élève » ; date « 2012-05-14 » au récapitulatif.

### C-04-14 — Libellés techniques sur de nouveaux écrans — Mineur
« ACTIVE à WITHDRAWN », « DEMO-COLLEGE-6E-0015 · PENDING · PRIVATE », identifiant au lieu du nom dans l'assistant d'inscription, « L'apprenant a déjà une inscription vivante… ». Renvois C-02-05, C-03-06, C-03-07.

### C-04-15 — Inscription « En attente » : seule l'annulation est proposée — Mineur
Suspendre, reprendre, transférer, confirmer : fonction non trouvée pour cet état.

### C-04-16 — Menu et accueil plus larges que le menu attendu — Mineur (à confirmer avec la matrice des droits)
Emploi du temps, Campagnes, Listes d'attente, Prospects, Recrutement, Créances sur l'État, États des affectations, Canaux d'envoi, et plusieurs écrans Finance (Encaissements, Paiements en ligne, À rapprocher, Remboursements, Remises et bourses).

### C-04-17 — Détails d'ergonomie des fenêtres — Mineur
Échap ne ferme pas la fenêtre de changement de statut quand une liste déroulante a le focus ; priorité d'un contact d'urgence à 100 par défaut alors que l'aide dit « 0 = appelé en premier ».

### C-04-18 — Bulletins : « Générer » et « Réémettre » accessibles, pré-contrôle ambigu — Suggestion
Le pré-contrôle annonce « Tout est prêt » alors que 9 bulletins « Publié » existent déjà.

### C-04-19 — Conseil de classe : message transitoire et accès aux actions — Mineur
« Établissement inconnu… » pendant environ 10 s (C-02-03). Le secrétariat voit « Modifier », « Annuler la séance », « Passer en mode séance » (non cliqués).

### C-04-20 — Divers — Suggestion
Historique de la GED : « par secretariat » (identifiant de connexion) au lieu du nom.

## Imports (P4) par format
| Format | Envoi | Colonnes | Aperçu | Exécuté |
|---|---|---|---|---|
| .csv | ✅ | ✅ | 4 à créer, 1 en erreur (31/02/2012) | Non |
| .xlsx | ✅ | ✅ | 4 à créer, 1 en erreur (classe 6E-Z inconnue) | Non |
| .xls | ✅ | ✅ | 4 à créer, 1 en erreur (31/02/2012) | Non |
| .ods | ✅ | ✅ | 4 à créer, 1 en erreur (31/02/2012) | Non |

Faux fichiers : fichier vide (400) ✅ ; .odt renommé en .ods (400) ✅ ; colonne obligatoire « Nom » non associée : message en ligne ✅.

## URL tentées
`/v2/admissions/settings`, `/v2/finance/payments/new`, `/v2/finance/cash`, `/v2/staff/new`, `/v2/payroll/history`, `/v2/access/roles`, `/v2/schoollife`, `/v2/examinations` : Accès refusé ✅. `/v2/messages/new` : C-04-05. `/v2/documents/search` : recherche PDF fonctionnelle ✅.

## Données créées (fictives)
Élève KOUASSI Yao Jean-Marc (6e A) ; tuteur COULIBALY Fatou ; inscription DEMO-COLLEGE-6E-0015 (En attente) ; candidature 2026-00010 TRAORE Aminata (déposée, consentement « REG-TEST-QA-001 ») ; 4 imports validés non exécutés ; document GED « Attestation de fréquentation (modèle test QA) » partagé avec COULIBALY Fatou ; dossier d'affectation AFF-TEST-QA-0001 ; conseil de classe « Conseil test QA (secrétariat) » (6e A, T1, 10/11/2026 15:00).
Non créés : élèves TRAORE et N'GUESSAN, tuteur AKA Koffi Michel, justificatif, message au personnel.

## Identifiants relevés (isolation croisée, partie C)
- Élève : `/v2/students/01a111a2-7263-72b4-ac85-3e2178fe0df0`
- Facture : `/v2/finance/invoices/01a110ef-6e4e-73c2-be72-bc57c19c5bad`
- Candidature : `/v2/admissions/applications/01a111c3-e26d-767d-aa02-09523c4c8311`

## Points non testés
Exécution des imports, annulation d'inscription, retrait d'élève de test ; téléchargements (gabarit, erreurs d'import, export CSV, PDF des bulletins) ; rejeu et modèle de correspondance ; justificatif et pièce (fonctions non trouvées) ; message au personnel et partage interne ; clic sur « Refusé », « Générer / Réémettre », boutons du conseil ; partie C.

## Décisions attendues du développeur
1. Exécuter les imports (quels fichiers) ? 2. Annuler l'inscription de KOUASSI ou retirer l'élève de test ? 3. Autoriser les téléchargements ? 4. Fournir des identifiants d'un autre établissement (partie C) ? 5. Créer les élèves TRAORE, N'GUESSAN et le tuteur AKA Koffi Michel ? 6. Confirmer les droits attendus (« Refusé », menu élargi) ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-04-01 | **Défaut réel corrigé.** Le champ était prérempli avec la version lue dans les réglages d'admission, que le secrétariat ne peut pas lire (champ vide, version à deviner). | `DossierMisc.tsx` : liste de choix des versions de consentement en vigueur (`GET /admissions/consent-texts`, lisible avec `admission.read`), la plus récente présélectionnée. Tests admissions web verts (45). |
| C-04-02 | **Défaut réel corrigé, et plus large que le doublon.** Reproduit en direct : tout dépôt de document échouait en 500 `TX_IDENTITY_SWITCH` (le calcul du quota du plan ouvrait sa propre session à l'intérieur de la transaction du tenant ; le dépôt de la session n'avait réussi que grâce à un cache chaud). | `documents/application/uploads.ts` et `quarantine.ts` : le quota du plan est calculé AVANT toute transaction. Re-testé en direct : dépôt 201, doublon 409 « Ce fichier existe déjà dans cette catégorie pour cette personne. ». Tests documents unitaires verts (96). Une pièce « Repro doublon » a été déposée par ce test sur l'élève KOUASSI (donnée fictive). |
| C-04-03 | **Défaut réel corrigé** (même cause que C-03-01 : liste des établissements en 403). | `tenancy.institution.read` accordée au secrétariat, à l'économe, à l'éducateur, au responsable pédagogique, au responsable des examens et au chargé d'admissions (lecture seule) ; oracle RBAC mis à jour (309 tests verts). |
| C-04-04 | **Défaut réel corrigé.** Le secrétariat ne porte pas `admission.decide` : l'API aurait refusé la décision, mais l'écran affichait quand même les boutons. | `ApplicationDetailScreen.tsx` : seules les transitions dont l'utilisateur détient la permission (et `admission.decide` pour une décision formelle) sont proposées ; test ajouté. |
| C-04-05 | À instruire : la règle d'initiation de la messagerie refuse l'écriture au secrétariat (aucun destinataire autorisé par ses règles). À confirmer avec le cadrage Q-13 et les règles de portée. | Non traité. |
| C-04-06, C-04-12 | Fonctions absentes de l'interface du secrétariat (dépôt de justificatif d'absence ; pièces demandées par campagne). | À cadrer. |
| C-04-07 | À confirmer côté tuteur : le partage d'un document réservé au personnel doit être refusé ou signalé. | À instruire. |
| C-04-08 | À confirmer : la relecture périodique existe (toutes les 1,5 s), mais React Query la suspend quand l'onglet n'est pas au premier plan, ce qui est probablement le cas d'un navigateur piloté. | À revérifier onglet au premier plan. |
| C-04-09 à C-04-20 | Confirmés (Mineur / Suggestion). | À planifier. |
