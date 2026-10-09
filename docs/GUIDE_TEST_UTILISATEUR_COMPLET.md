# 🧭 Guide de test — EcoleDigitale

Parcours complet, **étape par étape**, de la mise en place d'une école jusqu'aux portails des familles. Chaque étape indique **qui se connecte, quel menu ouvrir, quoi faire, quelles données saisir et ce que l'on doit voir**.

- Application : <http://localhost:3000> (connexion : <http://localhost:3000/v2/login>) · API : <http://localhost:4000>
- Parcours principal : **Collège Le Baobab** (`secondaire-test`), classe **6e A**, année **2026-2027**. Le **primaire** (École Les Palmiers) et le **supérieur** (Université Horizon) ont chacun leur phase (22 et 23).
- Date de référence : **J = jeudi 8 octobre 2026**. Si vous testez un autre jour, gardez les mêmes écarts de dates (séances "du jour", échéances à 20 jours, etc.).
- Le guide compte **24 phases** et **441 étapes**. Chaque phase correspond à un module : suivez-les **dans l'ordre** (les données d'une phase servent aux suivantes), ou jouez une phase isolée si sa ligne "Précondition" est remplie. Les actes **irréversibles** sont signalés "⚠️ Irréversible" et placés en fin de phase.
- Tout est fictif : noms ivoiriens inventés, e-mails en `@exemple.test`, téléphones factices. Aucun e-mail, SMS ni paiement réel n'est émis.
- **Ce guide a été rédigé en lisant le code, sans rejouer chaque scénario.** Un attendu suivi de *(à vérifier)* n'est pas prouvé : notez ce que vous voyez. Les cas fins de chaque module (statuts rares, droits détaillés, qualité transversale) sont dans les chapitres de référence [`docs/guide-test/`](guide-test/README.md), cités en fin de chaque phase ("📚 Pour aller plus loin").

## Sommaire

Chaque phase est dans **son propre fichier** (aperçu rapide) : cliquez sur le lien de la phase, puis suivez le lien "Suivant →" en bas de page.

1. **Connexion, abonnement et rôles (propriétaire)** — étapes 1 à 14 — [ouvrir](guide-test-parcours/01-connexion-abonnement-roles.md)
2. **Structure académique** — étapes 15 à 28 — [ouvrir](guide-test-parcours/02-structure-academique.md)
3. **Personnes** : tuteurs, élèves, personnel, inscriptions et imports — étapes 29 à 53 — [partie 1](guide-test-parcours/03a-personnes-imports.md) · [partie 2](guide-test-parcours/03b-personnes-imports-suite.md)
4. **Admissions** : de la candidature à l'élève inscrit — étapes 54 à 73 — [ouvrir](guide-test-parcours/04-admissions.md)
5. **Finance** : frais, facture, encaissements, reçus — étapes 74 à 89 — [ouvrir](guide-test-parcours/05-finance.md)
6. **Emploi du temps** — étapes 90 à 108 — [ouvrir](guide-test-parcours/06-emploi-du-temps.md)
7. **Appel et présences** — étapes 109 à 127 — [ouvrir](guide-test-parcours/07-appel-presences.md)
8. **Évaluations et notes** — étapes 128 à 145 — [ouvrir](guide-test-parcours/08-evaluations-notes.md)
9. **Règles, résultats et bulletins** — étapes 146 à 172 — [partie 1](guide-test-parcours/09a-regles-resultats-bulletins.md) · [partie 2](guide-test-parcours/09b-regles-resultats-bulletins-suite.md)
10. **Vie scolaire** : de l'incident à l'information de la famille — étapes 173 à 189 — [ouvrir](guide-test-parcours/10-vie-scolaire.md)
11. **Conseil de classe et procès-verbal** — étapes 190 à 208 — [ouvrir](guide-test-parcours/11-conseil-de-classe.md)
12. **Élèves affectés par l'État** — étapes 209 à 224 — [ouvrir](guide-test-parcours/12-eleves-affectes-etat.md)
13. **Examens** : session, candidats, centres, notes, résultats — étapes 225 à 253 — [partie 1](guide-test-parcours/13a-examens.md) · [partie 2](guide-test-parcours/13b-examens-suite.md)
14. **Paie d'un enseignant** — étapes 254 à 272 — [ouvrir](guide-test-parcours/14-paie.md)
15. **Documents (GED)** — étapes 273 à 289 — [ouvrir](guide-test-parcours/15-documents-ged.md)
16. **Messagerie, annonces et notifications** — étapes 290 à 314 — [partie 1](guide-test-parcours/16a-messagerie.md) · [partie 2](guide-test-parcours/16b-messagerie-suite.md)
17. **Tableaux de bord et alertes** — étapes 315 à 331 — [ouvrir](guide-test-parcours/17-tableaux-de-bord.md)
18. **Portails parent, élève, enseignant ; paiement et remboursement** — étapes 332 à 351 — [ouvrir](guide-test-parcours/18-portails-paiement.md)
19. **Sécurité, droits et isolation** — étapes 352 à 375 — [ouvrir](guide-test-parcours/19-securite-isolation.md)
20. **Console de la plateforme (opérateur) et abonnement** — étapes 376 à 387 — [ouvrir](guide-test-parcours/20-console-plateforme.md)
21. **Accessibilité, mobile et hors ligne** — étapes 388 à 395 — [ouvrir](guide-test-parcours/21-accessibilite-mobile.md)
22. **École Les Palmiers (primaire)** : compétences, conseil des maîtres, bilan annuel — étapes 396 à 419 — [partie 1](guide-test-parcours/22a-primaire.md) · [partie 2](guide-test-parcours/22b-primaire-suite.md)
23. **Université Horizon (supérieur)** : UE/ECUE, relevé, rattrapage, diplôme — étapes 420 à 440 — [ouvrir](guide-test-parcours/23-superieur.md)
24. **Actes de fin de recette (irréversibles)** — étapes 441 à 441 — [ouvrir](guide-test-parcours/24-actes-de-fin.md)
25. **Bilan de la recette** (synthèse à remplir, comment consigner une anomalie) — [ouvrir](guide-test-parcours/99-bilan.md)

---

## Avant de commencer

### 1. Lancer l'application

Double-cliquer sur `demarrer-application.bat` (racine du dépôt), ou en ligne de commande :

```bash
pnpm dev:v2:setup
```

*(une seule fois, Docker requis)*

```bash
pnpm dev:v2
```

*(lance l'API, le site web et le worker ; le worker produit les PDF : bulletins, reçus, procès-verbaux)*

```bash
pnpm dev:v2:seed
```

*(crée les trois établissements de test dans la base locale `ecoledigitale_v2` ; sans effet sur un établissement déjà créé. Pour repartir à neuf : supprimer les établissements avec la console de la plateforme ou recréer la base locale `ecoledigitale_v2` puis relancer le seed. Ne touchez à aucune autre base.)*

Deux réglages facultatifs, à poser **avant** de lancer `pnpm dev:v2` :

| Variable | Pour quoi |
| :--- | :--- |
| `NEXT_PUBLIC_FINANCE_SANDBOX=1` | faire apparaître le fournisseur « Paiement simulé (démonstration) » dans le paiement en ligne (phases 5 et 18) |
| `NEXT_PUBLIC_PWA=1` | enregistrer le service worker pour les tests hors ligne (phase 21) |

### 2. Deux fenêtres de navigateur

| Fenêtre | Usage |
| :--- | :--- |
| **A** — normale | comptes de gestion : propriétaire, directeur, directeur des études, responsable pédagogique, secrétariat, économe, chargé d'admissions, responsable des examens |
| **B** — navigation privée | enseignant, éducateur, parent, élève |

On change de compte avec **« Se déconnecter »** (menu du compte, en haut à droite). Attention : deux fenêtres privées d'un même navigateur **partagent** la session.

### 3. Se connecter (aucun mot de passe à retenir)

1. Ouvrir `http://localhost:3000/v2/login`. Attendre quelques secondes : le panneau **« Comptes par tenant »** apparaît à droite (37 comptes, groupés par établissement).
2. Cliquer sur le compte voulu : e-mail et mot de passe se remplissent.
3. Pour un compte marqué **MFA**, cliquer **"Afficher le code MFA"** sous le compte : le code à 6 chiffres s'affiche (il change toutes les 30 secondes et ne sert qu'une fois ; il est aussi proposé à l'étape de vérification). Cliquer **« Se connecter »**, puis valider le code.

> Sur `/login` (ancienne adresse), le panneau des comptes n'apparaissait pas lors de la vérification de ce guide : utilisez `/v2/login`.
>
> **Ne copiez jamais** un mot de passe, un code MFA, un lien d'invitation ou de réinitialisation dans un rapport.

### 4. Comptes du Collège Le Baobab

| Rôle | E-mail | MFA |
| :--- | :--- | :---: |
| Propriétaire | `direction.generale@secondaire-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | oui |
| Responsable pédagogique | `pedagogie@secondaire-test.test` | oui |
| Secrétariat | `secretariat@secondaire-test.test` | oui |
| Économe | `econome@secondaire-test.test` | oui |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non |
| Éducateur | `educateur@secondaire-test.test` | non |
| Responsable des examens | `examens@secondaire-test.test` | non |
| Chargé d'admissions | `admissions@secondaire-test.test` | non |
| Parent (DIABATE Séka : voit Nadia et Salimata) | `parent@secondaire-test.test` | non |
| Élève (DIABATE Nadia) | `eleve@secondaire-test.test` | non |

École Les Palmiers : mêmes rôles en `…@primaire-test.test` (+ `instituteur.maternelle@primaire-test.test`) ; Université Horizon : `…@superieur-test.test`. Le détail (élèves, tuteurs, frais, matières de départ) est dans [`guide-test/annexe-donnees-de-depart.md`](guide-test/annexe-donnees-de-depart.md). L'**opérateur de la plateforme** (phase 20) a un compte distinct : ses identifiants sont communiqués par la personne qui lance l'environnement.

### 5. Fichiers fournis

Dans [`docs/guide-test/jeux-de-donnees/`](guide-test/jeux-de-donnees/README.md) :

| Fichiers | Utilisés dans |
| :--- | :--- |
| `01-students-*.csv`, `.xlsx`, `06-enrollments-*.csv` | phase 3 (imports d'élèves) |
| `17-piece-*` (acte de naissance, bulletin, photo, faux fichiers) | phase 4 (admissions) |
| `justificatif-*` (PDF, image, faux PDF) | phase 7 (justificatifs d'absence) |
| `logo-test-guide.png`, `signature-test-guide.png`, `pdf-etranger-test-guide.pdf` | phase 9 (bulletins) |
| `20-examens-*.csv` | phase 13 (examens) |
| `ged-*`, `ch15-piece-jointe-*` | phases 15 et 16 (documents, messagerie) |

### 6. Comment lire une étape

| Signe | Sens |
| :---: | :--- |
| 👤 | compte à utiliser (rôle, établissement, fenêtre) |
| 📂 | menu à ouvrir et adresse de la page |
| ✅ | ce que l'on doit voir (message exact, ligne de liste, chiffre) |
| ⚠️ *Test d'erreur* | saisie invalide à essayer, avec le message attendu |
| 🔒 *Test de droit* | adresse à taper à la main avec un compte qui n'y a pas droit |
| ⚠️ *Écart connu* | défaut déjà repéré en lisant le code : si vous le voyez, notez-le sans vous bloquer |
| ⚠️ Irréversible | action qui ne se défait pas : à jouer une seule fois |
| 📚 | où trouver les cas fins (chapitres de référence) |
| ☐ OK ☐ KO | à cocher en fin d'étape |

Un texte entre guillemets français (comme **« Créer »**) est un libellé de l'interface ; un texte entre guillemets droits ou en `code` est une valeur à saisir, un nom d'enregistrement ou un message du serveur.
