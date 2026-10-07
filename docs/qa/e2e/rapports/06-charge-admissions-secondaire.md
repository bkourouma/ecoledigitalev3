# Rapport de session 06 : Chargé d'admissions / Collège Le Baobab (secondaire-test)

- Compte : Chargé d'admissions (admissions@secondaire-test.test), sans MFA
- Établissement : Collège Le Baobab (démonstration)
- Date : 7 octobre 2026, après-midi
- Navigateur : Chrome (Claude in Chrome), http://localhost:3000, mode développement ; navigation privée impossible avec cet outil

Rappel : règles de démonstration ; aucun document officiel produit.

## Parcours exécutés
| Parcours | Résultat | Constats | Remarque |
|---|---|---|---|
| P1 Pipeline et liste | ✅ | C-06-01 | 10 dossiers au départ, pipeline = liste ; seule la décision « En étude » est proposée (correctif des droits vérifié) |
| P2 Candidature, consentement, pièces, entretien | ⚠️ | C-06-02, C-06-03, C-06-04 | Refus sans consentement (409) ; consentement avec liste de versions OK ; dossier 2026-00011 « Déposée » ; pièces : fonction non trouvée ; entretien planifié puis annulé |
| P3 Doublons, prospects, liste d'attente, conflit | ⚠️ | C-06-05, C-06-06 | Doublon exact refusé à la création, aucun écran de résolution ; prospect créé ; conflit à deux onglets géré avec message clair |
| P4 Rapports de recrutement | ⚠️ | C-06-07 | Entonnoir et capacités cohérents ; « Reçues 10 » contredit « Sources 12 » |
| P5 Pages publiques | ✅ | — | Vérification : réponse neutre (404 + « Inconnu ») pour 3 codes ; formulaire public fermé ; suivi de dossier non testé |
| P6 Négatifs de droits | ✅ | — | `/v2/admissions/settings`, `/settings/workflow`, `/v2/students`, `/v2/finance` refusés ; pas de bouton Admis/Refusé |
| P7 Offre (reprise) | ⏭️ | — | Décision « Admis » du directeur absente sur le dossier de test |

## Constats
### C-06-01 : Éléments du pipeline et des rapports non francisés ou ambigus — Mineur
Rapport « Sources » : « WALK_IN » ; capacités et prospects : niveau « 6E » (code) ; le texte du pipeline dit « ouvrez-le pour décider » alors que ce rôle ne décide pas ; « Campagnes » visible dans les onglets. Renvoi C-04-11.

### C-06-02 : Message d'erreur avec code brut, orthographe et alerte périmée — Mineur
Alerte « le consentement parental est requis avant l'étape SUBMITTED » (minuscule initiale, code technique) ; elle reste affichée après l'enregistrement du consentement, de même que « Dossier passé à l'étape « Candidature reçue » » après l'entretien et son annulation ; le consentement s'affiche « Traitement des données · vv1 » (double v). POST …/transition → 409 (attendu).

### C-06-03 : Aucun moyen de modifier un entretien planifié — Mineur
Seul « Renseigner » existe (Planifié, Réalisé, Absent, Annulé ; résultat Pas de résultat, Admis, Non admis, Sans objet) ; modifier la date ou le lieu : fonction non trouvée. Le mot « Admis » du résultat du test prête à confusion avec la décision d'admission.

### C-06-04 : Pièces du dossier impossibles à ajouter — Mineur
« Aucune pièce n'est demandée pour ce dossier. », aucun bouton de dépôt (même constat que C-04-12).

### C-06-05 : Doublon : refus brut à la création, pas de résolution, détection sans effet — Majeur
(1) Recréer KOUASSI Yao Jean-Marc, même naissance, même tuteur : POST /admissions/applications → 409 « Une candidature vivante existe déjà pour cet enfant dans cette campagne. » sans lien vers le dossier existant. (2) « Yao Jeanmarc KOUASSI » né le 15/05/2012 (un jour d'écart) : dossier 2026-00012 créé, « Aucun doublon détecté » avant et après « Relancer la détection ». Attendu : doublon proposé avec choix (fusionner, ignorer, ouvrir le dossier existant) ; « vivante » → « en cours ».

### C-06-06 : Promotion de liste d'attente visible pour le chargé d'admissions — Suggestion (à confirmer avec la matrice des droits)
`/v2/admissions/waitlist` (niveau 6e) : « 10 places libres », un dossier « À classer » (Grâce HIEN), boutons « Promouvoir le premier de la liste » et « Promouvoir » visibles (émission d'offre). Monter/Descendre réservés à la direction (conforme). Non cliqué. La promotion d'un dossier non classé contredit « ne sont jamais promus d'office ».

### C-06-07 : Rapports : « Reçues » et « Sources » en désaccord — Mineur
Entonnoir : Reçues 10 = 12 dossiers − 2 brouillons (statuts : Brouillon 2, Déposée 3, À l'étude 1, Pièce manquante 1, Acceptée 1, Refusée 1, Liste d'attente 1, Inscrit 2). « Sources » : WALK_IN reçues 12 (brouillons compris). Capacités 6E : 13 places = 10 libres + 3 retenues (1 acceptée + 2 inscrits). « Traitées 5 » : définition non affichée.

## Données créées (fictives)
Candidature 2026-00011 KOUASSI Yao Jean-Marc (6E, 14/05/2012), tuteur COULIBALY Fatou, « Déposée » ; consentement v1, document papier, réf. REG-TEST-QA-06-001 ; entretien 14/10/2026 10:00 « Annulé » ; candidature 2026-00012 Yao Jeanmarc KOUASSI (15/05/2012, « Brouillon », sans consentement) ; prospect AKA Koffi Michel (6e, état « Nouveau »). Le dossier 2026-00002 (Brice ASSI) est passé de « Inscription en attente de paiement » à « Inscrit » sans action de cette session.

## Identifiants relevés (isolation croisée)
- Campagne RENTREE-6E : `01a110ee-d3fd-76c1-b367-118323a55da5`
- Candidature 2026-00010 : `/v2/admissions/applications/01a111c3-e26d-767d-aa02-09523c4c8311`
- Candidature 2026-00011 : `/v2/admissions/applications/01a11675-8202-77c5-bf94-1cdc5ce6a461`
- Candidature 2026-00012 : `/v2/admissions/applications/01a11678-cd3b-721a-bcec-eaf6db5d4494`

## Points non testés
P7 (offre, lien de réponse, acceptation publique, double réponse) ; pièces ; modification de la date d'un entretien ; résolution de doublon ; page publique de suivi (adresse `/v2/track` supposée, 404) ; champ « leurre » (formulaire public fermé) ; navigation privée ; notifications simulées (aucune offre émise) ; boutons « Promouvoir », « Convertir », « Retirer par la famille » ; clavier ; libellé du rôle sous « Mon compte ».

## Décisions attendues du développeur
1. Faire décider « Admis » le dossier 2026-00011 par le directeur (session 11), ou autoriser une offre sur un dossier de la graine. 2. Fournir l'adresse de la page publique de suivi et ouvrir le lien public de candidature. 3. Confirmer « Promouvoir » (C-06-06) et la détection de doublons proches (C-06-05). 4. Reprendre la session 05 (économe) ?

## Traitement par le développeur (2026-10-07)
| Constat | Verdict | Action |
|---|---|---|
| C-06-02 (« vv1 ») | **Corrigé** : `DossierMisc.tsx` n'ajoute plus un second « v ». | Tests admissions web verts (45). |
| C-06-02 (message SUBMITTED, alertes périmées) | Confirmé : le message vient d'un déclencheur SQL en anglais technique ; les alertes ne sont pas effacées à l'action suivante. | À corriger (traduire le message côté API, effacer les alertes). |
| C-06-05 | À cadrer : la détection actuelle n'a pas de variante « un jour d'écart / graphie proche » ; l'écran de résolution n'est proposé que si un doublon est détecté. | Décision métier sur les seuils (non officiels). |
| C-06-06 | À confirmer : la promotion émet une offre (droit du rôle) ; interdire la promotion d'un dossier non classé. | À corriger après décision. |
| C-06-07 | À corriger : une seule définition de « reçues ». | À planifier. |
| 2026-00002 passé « Inscrit » | **Normal** : l'économe a réglé les frais de ASSI Brice en session 05 ; l'inscription est confirmée par le paiement (O-01). | — |
| C-06-01, C-06-03, C-06-04 | Confirmés (Mineur). | À planifier. |
