# Prompt — cinquième passe, campagne `E2E-2209-1`

> À coller dans Claude (web, extension navigateur). **Autonome : rien à joindre.**

---

Tu reprends la campagne de test d'EcoleDigitale en local (`http://localhost:3000`, tenant
`ecoledigitale`). La quatrième passe a été exploitée : trois corrections sont à revérifier,
et un point resté injouable l'est maintenant. Passe courte, ciblée.

> **Mise à jour en cours de passe** — deux changements voulus, à ne pas signaler comme des
> régressions : les **quatre vrais signataires** ont été remis en place (fin des noms
> « E2E »), et la mention **« totalisant 13/13 UV » a été retirée du diplôme**. Les
> documents reviennent à leur texte d'avant le test pour les crédits et les UV.

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → cliquer la
ligne du compte → **Se connecter**.

| Rôle | Compte | Mot de passe |
|---|---|---|
| Admin | `admin@ecoledigitale.local` | `Password@2025` |
| Étudiante diplômée (Aminata) | `aminata.e2e22091@example.test` | `%hR5ae@@QXyb` |
| Étudiante ajournée (Chantal) | `chantal.e2e22091@example.test` | `zR58E6Y#WSxc` |
| Parent (Fatou) | `fatou.parente.e2e22091@example.test` | `@3H8Kjct#X2b` |

Pièges d'environnement : une page servie pour la première fois met jusqu'à une minute à
compiler ; une page qui a échoué reste figée sur son erreur même une fois l'API revenue —
**recharge avant de conclure** ; remplis les champs au clavier, valide par un clic. Si
l'application entière devient injoignable, arrête-toi et dis-le : l'API tourne sous
supervision de mon côté, je la relance.

---

## 1. Le bulletin dans l'espace étudiant

La passe 4 a trouvé un document qui s'ouvrait **vide** : identité correcte, tableau sans une
ligne, total « — ». Cause : l'espace étudiant envoyait au gabarit de style BTS les données du
relevé LMD, qui n'ont pas la même forme. Il reçoit désormais les mêmes données que
l'administration — vérifiées identiques octet pour octet côté serveur.

> Aminata → `/student/documents` → onglet Bulletins → **Voir**. Attendu, **à l'identique du
> bulletin édité côté admin** :
> - le tableau des disciplines **rempli** (les mêmes lignes que côté admin) ;
> - **Total des points 184,39** · **Moyenne semestrielle 14,18** · **Rang 1er** ;
> - **Décision du jury : ADMIS** ;
> - Spécialité `TESTOLOGIE E2E-2209-1`, Niveau `LICENCE 1`.
>
> Puis Chantal → même chemin → **Décision du jury : AJOURNÉ**, tableau lui aussi rempli.
>
> Le plus sûr pour conclure : ouvre le même bulletin côté admin
> (`/professionnel/admin/bulletins`) et compare ligne à ligne. Tout écart est une anomalie.

---

## 2. Le diplôme — trois chemins, un seul texte

La passe 4 a trouvé que le diplôme édité depuis la **fiche** du diplôme n'avait pas
« totalisant 13/13 UV », alors que la version téléchargée par l'étudiante l'avait. Il existait
deux copies du code d'édition côté admin ; seule l'une avait été corrigée.

> Génère le diplôme d'Aminata **par les trois chemins** et compare :
> 1. admin → `/professionnel/admin/diplomes` (la **liste**) → bouton de génération ;
> 2. admin → `/professionnel/admin/diplomes` → ouvrir la **fiche** du diplôme → bouton
>    **Diplôme** dans l'onglet des étudiants ;
> 3. Aminata → `/student/diplomes` → **Télécharger mon diplôme**.
>
> Sur les **trois** PDF, le même texte :
> - **`Réf. DIP-2026-000001`** en pied de page ;
> - matricule **`IPAM-L1TST01-0061`** ;
> - née le **15 juin 2005** à **Abidjan** ;
> - les **vrais signataires**, remis en place : **PROFESSEUR PENE BI GUIME CREPIN** à gauche,
>   **CELESTE BAH, Enseignant - chercheur** à droite.
>
> **Pas de mention d'UV sur le diplôme** : la phrase « totalisant 13/13 UV » a été retirée
> volontairement, pour revenir au texte d'avant le test. Son absence est attendue.
>
> Sur la fiche, génère aussi l'**attestation** d'Aminata : elle doit être **identique à la
> passe 3** (même texte, sans UV), signée **Celeste BAH**, qualité **Enseignant Chercheur**.

---

## 3. Le reçu à deux numéros

La passe 4 a relevé que le reçu de solde d'Aminata (200 000 répartis sur deux UE, donc deux
numéros en base) n'imprimait que `REC-PRO-2026-000004 (+1)`. L'abréviation reste dans les
**listes à l'écran** — c'est voulu — mais le **reçu imprimé** doit porter les deux numéros.

> Ouvre ce reçu de solde par les **trois** chemins où il existe :
> 1. admin → `/admin/finances/student-payments` → Aminata → onglet **Transactions** → **Reçu** ;
> 2. Aminata → `/student/documents` → onglet des reçus ;
> 3. Fatou → espace parent → documents / reçus d'Aminata *(seulement si Fatou est bien
>    rattachée à Aminata ; sinon, dis-le et passe)*.
>
> Attendu sur le PDF : **`N° REC-PRO-2026-000004 · REC-PRO-2026-000005`**, lisible, dans la
> pastille, sans déborder. Dans les listes à l'écran, la forme courte `… (+1)` reste
> normale.
>
> Vérifie aussi que le **premier** reçu (50 000, un seul numéro `000003`) n'a pas changé.

---

## 4. La confirmation d'inscription — enfin jouable

Point jamais vérifié : l'écran d'inscription en lot exclut tout étudiant déjà inscrit
quelque part, et tu refusais à juste titre d'ajouter un étudiant tant que S11 était en
cours. S11 est bouclé : **tu peux maintenant créer des données.**

> **a.** `/academic/students/new` → crée `Test Confirmation E2E-2209-1`, matricule
> `E2E-2209-1-K`, e-mail `test.confirmation.e2e22091@example.test` (upload du diplôme
> obligatoire : n'importe quel petit PDF).
>
> **b.** `/professionnel/admin/inscriptions` → classe `L1 TESTOLOGIE E2E-2209-1` → coche
> **une seule** session (Comptabilité) → coche cet étudiant → **Enregistrer les
> inscriptions**. Attendu : la confirmation **« 1 inscription créée »** apparaît **juste
> au-dessus du bouton**, sans que tu aies à défiler.
>
> **c.** Le chemin pour ajouter une UE à un étudiant déjà inscrit : ouvre la fiche de la
> session **Droit** du run (`/professionnel/admin/sessions` → la session Droit → sa fiche →
> onglet **Inscrits**). Son panneau d'inscription doit te **proposer** `Test Confirmation` — inscrit ailleurs mais
> pas à cette session-là — et **ne pas proposer** Aminata, Bakary ni Chantal, déjà inscrits
> à celle-ci. Inscris-le. C'est la réponse à ta question de la passe 4 : l'écran en lot
> accueille une cohorte, la fiche de session complète un parcours.

---

## Ce que j'attends en retour

Une ligne par point : OK ou KO. Sur un KO : URL, geste, attendu, constaté, et la requête en
cause si tu la vois. À la fin : le tableau des quatre points, les anomalies classées, **ce que
tu n'as pas pu vérifier**, et les données créées (au moins un étudiant et deux inscriptions
au point 4).

> Pour information : la chaîne du **parcours académique classique** (S15-S16) n'a toujours
> pas été jouée. Ce n'est pas l'objet de cette passe ; elle fera l'objet de la suivante.
