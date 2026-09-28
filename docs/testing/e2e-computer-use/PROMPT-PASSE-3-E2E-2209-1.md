# Prompt — troisième passe, campagne `E2E-2209-1`

> À coller dans Claude (web, extension navigateur).
> Rien d'autre à joindre pour les temps 1 et 2. Pour le temps 3, joindre
> `scenarios/S11-bareme-et-encaissement.md`.

---

Tu reprends une campagne de test sur EcoleDigitale en local (`http://localhost:3000`, tenant
`ecoledigitale`). Deux passes ont déjà eu lieu, treize défauts ont été corrigés depuis. Ta
mission : **vérifier ces corrections**, **finir ce qui était bloqué**, puis **ouvrir un
terrain neuf** si le temps le permet.

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → cliquer la
ligne du compte → **Se connecter**.

| Rôle | Compte | Mot de passe |
|---|---|---|
| Admin | `admin@ecoledigitale.local` | `Password@2025` |
| Enseignante | `awa.formatrice.e2e22091@example.test` | `zQmU?jXJGW9m` |
| Étudiante diplômée (Aminata) | `aminata.e2e22091@example.test` | `%hR5ae@@QXyb` |
| Étudiante ajournée (Chantal) | `chantal.e2e22091@example.test` | `zR58E6Y#WSxc` |
| Parent (Fatou) | `fatou.parente.e2e22091@example.test` | `@3H8Kjct#X2b` |

Trois pièges d'environnement, à ne pas confondre avec des bugs :

1. Une page servie pour la première fois met **jusqu'à une minute** à compiler.
2. L'API redémarre parfois seule. Une requête échoue alors, **et la page reste figée sur
   l'erreur même une fois l'API revenue** — rien ne réessaie. Avant de conclure qu'un écran
   est cassé : **recharge-le une fois**. Ce réflexe a déjà expliqué deux faux défauts.
3. Pour remplir un champ : clique dedans, tape au clavier, sors du champ. Valide par un clic
   sur le bouton, jamais par Entrée.

L'état actuel des données : classe **`L1 TESTOLOGIE E2E-2209-1`**, semestre
**`Semestre 1 E2E-2209-1` clôturé**, trois bulletins générés, diplômes `DIP-2026-000001`
(Aminata, obtenu), `000002` (Bakary, obtenu), `000003` (Chantal, **révoqué**).

---

## Temps 1 — Vérifier les corrections

Pour chacune, le geste et le résultat attendu. Dis-moi franchement laquelle tient et laquelle
ne tient pas : une correction annoncée mais non constatée est plus dangereuse qu'un bug connu.

**1. Verrou de clôture — la plus importante.** Le semestre est clôturé ; les notes ne doivent
plus bouger.
> `/professionnel/admin/notes` → classe et semestre du run. Attendu : une **bannière ambrée**
> « Semestre clôturé le 22/09/2026 », le bouton **« Enregistrer et calculer » désactivé**, et
> « Clôturer le semestre » désactivé aussi. Puis **essaie quand même** de modifier une note :
> le serveur doit refuser avec un message nommant le semestre et sa date de clôture.
> *(Le refus serveur est déjà prouvé ; c'est l'affichage que je n'ai pas pu voir.)*

**2. Sexe enregistré à la création.** Le champ était perdu entre l'écran et l'API.
> `/academic/students/new` → crée un étudiant `Test Genre E2E-2209-1`, matricule
> `E2E-2209-1-G`, e-mail `test.genre.e2e22091@example.test`, **Sexe = Féminin**, upload du
> diplôme (prends n'importe quel petit PDF). Puis ouvre sa fiche : le sexe doit être
> **Féminin**. C'est le seul test de cette liste qui crée une donnée — signale-le-moi.

**3. Sexe des trois étudiantes réparé.**
> Fiches d'Aminata et Chantal : **Féminin**. Bakary : **Masculin**.

**4. Rattachement parent-enfant.** Le sélecteur était vide, les deux listes étaient filtrées
par une année académique sans rapport.
> `/academic/parents/assign` → le sélecteur **Étudiant** doit proposer des dizaines de noms
> (≈63), et le sélecteur **Parent** aussi (≈46). Rattache **Fatou Parente** à **Aminata**.

**5. Réinitialisation du mot de passe.** Existe maintenant sur les fiches enseignant,
étudiant **et parent**.
> Fiche de Bakary (`bakary.e2e22091@example.test`, qui n'a jamais eu de mot de passe
> utilisable) → **Réinitialiser le mot de passe** → note-le → **connecte-toi avec**.

**6. Retour visuel après enregistrement.** Le message s'affichait hors écran.
> `/professionnel/admin/inscriptions` → choisis la classe du run, coche une session et
> l'étudiant créé au point 2, puis enregistre. Attendu : la page **défile jusqu'au message de
> confirmation**, tu le vois sans remonter. *(Jamais vérifié à ce jour.)*

**7 et 8. Compteurs et filtre Classe.**
> `/professionnel/admin/attestations` et `/professionnel/admin/diplomes` doivent annoncer le
> **même nombre** d'étudiants pour la classe du run. Et le sélecteur **Classe** de
> `/professionnel/admin/matieres` doit proposer `LICENCE 1 TESTOLOGIE E2E-2209-1`.


**9. Le diplômé peut télécharger son diplôme.** L'espace étudiant n'offrait aucun
téléchargement.
> Connecte-toi en **Aminata** → `/student/diplomes` → bouton **Télécharger mon diplôme**.
> Le PDF doit s'ouvrir **avec ses deux signataires** (`Aya Gauche` à gauche, `Yao Droite` à
> droite) : c'est tout l'enjeu du correctif, un diplôme sans signature ne vaut rien.

**10. Le compteur de séance ne cache plus les retards.**
> Espace enseignant, liste des séances : la séance où Bakary était en retard doit afficher
> **`1P · 1A · 1R`** et non `1P · 1A`.

**11. Le message des écrans vides dit enfin pourquoi.**
> Difficile à provoquer maintenant que la cohorte est confirmée. Si tu tombes sur un écran
> annonçant « Aucun étudiant inscrit confirmé », il doit désormais nommer la cause : frais
> d'inscription non soldés.

**12. La colonne « Étudiant » ne recouvre plus le champ Examen.**
> `/professionnel/admin/notes`, **fenêtre étroite** (ou navigateur réduit à moins de 768 px) :
> la colonne doit défiler normalement au lieu de rester collée par-dessus les champs. Sur
> grand écran, elle reste collée comme avant.

**13. Le bouton de déblocage du cache.** *(seulement si l'écran d'erreur rouge réapparaît)*
> Il vidait le cache sans attendre, puis rechargeait sans le contourner. Il doit maintenant
> te sortir de l'erreur d'un seul clic.

---

## Temps 2 — Finir ce qui n'a jamais pu être vérifié

### 2.1 — Le contenu des PDF · **c'est le plus utile de toute cette passe**

Trois documents sortent, personne n'a jamais lu ce qu'il y a dedans. Ils s'ouvrent dans un
nouvel onglet : **ouvre-les et lis-les de tes yeux**.

Depuis `/professionnel/admin/diplomes`, fiche du diplôme :

| Document | À vérifier précisément |
|---|---|
| **Diplôme** d'Aminata | signataire de **gauche** = `Aya Gauche E2E-2209-1` / `Le Directeur Général` ; signataire de **droite** = `Yao Droite E2E-2209-1` / `Le Président du Jury` ; identité et matricule `E2E-2209-1-A` ; crédits imprimés ; aucune zone vide |
| **Attestation d'authenticité** | signée `Ama Authentique E2E-2209-1` / `Le Secrétaire Général` |
| **Attestation de réussite** (écran Attestations) | signataire `Koffi Signataire E2E-2209-1`, **avec sa qualité `Enseignant Chercheur`** — ce champ n'existe que sur ce document, et c'est justement celui qui peut se perdre |

Vérifie aussi sur le **bulletin PDF** d'Aminata les trois défauts déjà signalés : mention
« BTS » alors que la classe est une **Licence**, **décision « Admis » absente**, **crédits
absents**. Ils ne sont pas corrigés — je veux juste confirmation qu'ils sont bien là avant de
m'y attaquer.

### 2.2 — L'espace parent, jamais atteint

Connecte-toi en **Fatou** → `/parent/professionnel/diplomes` → sélectionne Aminata.

> Attendu : le diplôme visible **en lecture seule**, aucune action d'octroi ou de révocation,
> et surtout **aucun autre enfant** dans le sélecteur. Un enfant non rattaché qui apparaît est
> une fuite de confidentialité : signale-le sans recopier les données de l'élève concerné.

### 2.3 — L'étudiante révoquée

Connecte-toi en **Chantal** → `/student/diplomes`.

> Attendu : **aucun diplôme obtenu**, et **aucun bouton de téléchargement**. Le diplôme qui
> lui avait été forcé puis révoqué ne doit apparaître nulle part : un document révoqué qui
> reste téléchargeable continue de circuler.

---

## Temps 3 — Terrain neuf : le volet financier

**Seulement s'il te reste du temps et de l'attention.** Deux chaînes sur trois n'ont jamais
été jouées ; celle-ci est la plus riche. Déroule le scénario joint
`S11-bareme-et-encaissement.md` sur la classe du run.

Le cœur du test y est : l'encaissement partiel puis le solde, le bouton **« Tout »** qui doit
proposer le reste **exact**, le refus d'un trop-perçu, et l'unicité des numéros de reçu. Les
montants attendus sont dans la fiche.

**Aucun paiement réel.** Tout se fait par saisie administrative. Devant un vrai formulaire
bancaire ou d'opérateur : arrêt immédiat.

---

## Ce que j'attends en retour

Après chaque point, une ligne : OK ou KO. Quand c'est KO :

```
Point : 1 — bannière de clôture
URL : http://localhost:3000/professionnel/admin/notes
Geste : classe + semestre du run sélectionnés
Attendu : bannière ambrée + bouton « Enregistrer et calculer » désactivé
Constaté : aucune bannière, bouton actif
Requête : (si une requête est en cause) POST ... → code
```

Et à la fin, trois choses :

1. le tableau des huit corrections avec leur verdict ;
2. les anomalies nouvelles, classées bloquante / majeure / mineure ;
3. **ce que tu n'as pas pu vérifier** — la section la plus utile de tes deux rapports
   précédents, ne la sacrifie pas si le temps manque.

Rappelle-moi aussi les données que tu auras créées, pour qu'on sache quoi nettoyer.
