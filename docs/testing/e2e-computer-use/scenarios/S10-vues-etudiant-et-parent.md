# S10 — Vues aval : étudiant et parent

| | |
|---|---|
| **Rôles** | Administrateur (étape 1), Étudiant (2-3), Parent (4-5) |
| **Prérequis** | S08 (A et B diplômés, C révoqué) |
| **Produit** | Confirmation que le diplôme est visible du bon côté, et invisible du mauvais |
| **Budget** | ~45 appels d'outils |

> Un diplôme que l'administration voit mais que l'étudiant ne voit pas n'est pas délivré. C'est
> ce scénario qui distingue « octroyé en base » de « délivré ».

---

## Préalable sur les identifiants

Les comptes étudiant et parent créés par la campagne ont un mot de passe **généré par le
serveur** et envoyé par e-mail à des adresses en `.test`, non routables.

Trois cas, dans cet ordre de préférence :

1. Le mot de passe a été relevé lors de la création (S03) → l'utiliser.
2. Sinon, l'administrateur peut-il le réinitialiser depuis la fiche de l'étudiant ? Si oui, le
   faire et le noter — c'est le chemin qu'un vrai établissement utilisera.
3. Sinon : **s'arrêter sur cette étape** et signaler « point à vérifier par un humain — comptes
   étudiant/parent non accessibles sans boîte mail ». Jouer alors les étapes 2 à 5 avec un
   compte étudiant **préexistant** du tenant, uniquement pour vérifier que les pages chargent
   sans erreur, et dire clairement dans le rapport que **la visibilité du diplôme du run n'a pas
   pu être vérifiée de bout en bout**. Ne jamais présenter ce repli comme une validation.

Le troisième cas est en lui-même une anomalie **MAJEURE** à relever une fois pour la campagne :
un parcours de test complet doit pouvoir se vérifier côté bénéficiaire.

---

## Étapes

### 1. Rattacher un parent (administrateur)
`/academic/parents/new` → *Prénom* `Fatou`, *Nom* `Parente <TAG>`, e-mail
`fatou.parente.<tag>@example.test`. Puis `/academic/parents/assign` : rattacher ce parent à
**Aminata (A)**.

Si le rattachement échoue, l'étape 4 n'a plus d'objet : le dire, et poursuivre avec les étapes
2 et 3.

### 2. Espace étudiant — Aminata (diplômée)
Se connecter avec le compte de A. Attendu : redirection vers `/student/courses`.
Aller sur `/student/diplomes`.

| Point | Attendu |
|---|---|
| Section « Diplômes obtenus » | le diplôme du cycle `TESTOLOGIE <TAG>` y figure |
| Progression | cohérente avec un parcours achevé |
| Téléchargement | possible, et le document porte bien le nom d'Aminata |

Un diplôme octroyé en S08 et **absent** de cet écran est une anomalie **BLOQUANTE** : c'est
exactement le symptôme d'une délivrance qui n'aboutit pas jusqu'au bénéficiaire.

Relever aussi le chiffre de crédits affiché : s'il vaut 0, le rapprocher des anomalies de S01,
S07 et S08 — c'est la même cause vue depuis l'écran de l'étudiant, et c'est là qu'elle sera la
plus visible pour un utilisateur réel.

### 3. Espace étudiant — Chantal (révoquée)
Se déconnecter, se connecter avec le compte de C. `/student/diplomes`.

Attendu : **aucun diplôme obtenu**. Le diplôme forcé puis révoqué en S08 ne doit apparaître ni
comme obtenu, ni comme téléchargeable. S'il reste visible ou téléchargeable, c'est **MAJEUR** —
un document révoqué continuerait de circuler.

> Si l'étape 8 de S08 n'a pas pu révoquer (dialogue natif non pilotable), l'écrire ici : on
> s'attend alors à voir le diplôme forcé, et ce **n'est pas** une anomalie de ce scénario.

### 4. Espace parent
Se connecter avec le compte parent, aller sur `/parent/professionnel/diplomes` et sélectionner
Aminata.

| Point | Attendu |
|---|---|
| Sélecteur d'enfant | Aminata présente, et **elle seule** |
| Diplôme | visible, en lecture seule |
| Actions d'octroi ou de révocation | **absentes** |

Tout enfant qui n'est pas rattaché à ce parent et qui apparaît dans le sélecteur est une
anomalie **BLOQUANTE de confidentialité** : la signaler comme telle, en nommant précisément ce
qui a fuité, et sans copier de données personnelles d'un autre élève dans le rapport.

### 5. Contrôle de cloisonnement
Toujours connecté en parent, tenter d'ouvrir directement `/professionnel/admin/diplomes`.

Attendu : pas de données. Relever ce qui se passe **exactement** :
- refus explicite ou redirection → correct ;
- page qui s'affiche **vide, sans message** → anomalie **MINEURE** d'ergonomie à signaler, car
  les pages de ce module ne sont pas protégées côté écran mais uniquement côté serveur : rien
  ne fuite, mais l'utilisateur ne comprend pas ce qui lui arrive ;
- **des données visibles** → anomalie **BLOQUANTE de sécurité**, à remonter immédiatement.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Mots de passe générés non affichés | Voir le préalable. Ne jamais présenter un repli sur un autre compte comme une validation. |
| Trois connexions successives | Bien se déconnecter entre chaque rôle, sinon les écrans s'affichent vides sans erreur. |
| Page admin vide au lieu d'un refus | Comportement connu du module : MINEURE, pas une faille — sauf si des données apparaissent. |
