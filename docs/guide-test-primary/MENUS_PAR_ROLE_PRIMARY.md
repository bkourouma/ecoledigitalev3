# Pack Primaire : les menus de chaque rôle

Guide simple : pour chaque rôle qui travaille avec le pack Primaire, la liste des pages auxquelles il a accès, avec leur lien et ce qu'elles permettent de faire.

Adresse de base en développement : `http://localhost:3000`.
Connexion : `/v2/login` (le panneau « Comptes par tenant » remplit le formulaire).

> Les accès sont tirés des droits des rôles dans le code (`apps/api/src/modules/rbac/templates/system-roles.ts`) et des gardes des pages (`apps/web/src/app/v2/primary/_components/guards.ts`).

---

## Les 10 pages du pack Primaire

| Page | Lien | À quoi elle sert |
| :--- | :--- | :--- |
| **Ma classe** | `/v2/primary/classe` | Vos classes, leurs périodes et les gestes du jour : appel, compétences, conseil. |
| **Compétences** | `/v2/primary/competences` | Évaluer chaque élève, compétence par compétence (NA, EA, AC), pour une période. |
| **Appréciations** | `/v2/primary/appreciations` | Banque de phrases pour rédiger l'appréciation d'un bulletin. |
| **Conseil des maîtres** | `/v2/primary/conseil` | Préparer le conseil, noter les présents, décider élève par élève, produire le procès-verbal. |
| **Avancement** | `/v2/primary/direction` | Tableau de bord : où en est chaque classe (saisie, validation, bilans scellés). |
| **Bilans annuels** | `/v2/primary/bilans` | Préparer, sceller et réémettre le bilan annuel d'une classe. |
| **Archives** | `/v2/primary/archives` | Préparer puis geler l'archive d'une année scolaire. |
| **États** | `/v2/primary/etats` | Rapports en tableau avec export CSV. |
| **Paramètres** | `/v2/primary/parametres` | Réglages du pack, échelles d'appréciation et référentiels de compétences. |
| **Bulletin et compétences** | `/v2/primary/mon-enfant` | Pour la famille : bulletin et compétences de l'enfant. |

---

## 1. Propriétaire

Compte : `direction.generale@<école>.test` (MFA). **Tous les droits.**

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Avancement | `/v2/primary/direction` | Suivre l'état de toutes les classes. |
| Conseil des maîtres | `/v2/primary/conseil` | Gérer les conseils et valider les décisions. |
| Bilans annuels | `/v2/primary/bilans` | Préparer, sceller, réémettre les bilans. |
| Archives | `/v2/primary/archives` | Préparer et geler l'archive d'une année. |
| États | `/v2/primary/etats` | Obtenir les rapports et les exporter. |
| Paramètres | `/v2/primary/parametres` | Régler le pack, créer échelles et référentiels, publier. |
| Ma classe, Compétences, Appréciations | `/v2/primary/classe`, `/competences`, `/appreciations` | Accessibles par l'adresse (le menu latéral ne les affiche pas : ce sont des outils d'instituteur). Dans Appréciations, il crée les phrases. |

Seule page qui ne le concerne pas : **Bulletin et compétences** (réservée à la famille).

## 2. Directeur

Compte : `directeur@<école>.test` (MFA). **Mêmes pages que le propriétaire**, avec les mêmes usages.
Différence : il ne gère ni l'abonnement ni la définition des rôles (hors pack Primaire).

## 3. Directeur des études

Il pilote la pédagogie. Il n'a **pas** accès aux Paramètres.

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Ma classe | `/v2/primary/classe` | Voir les classes (lecture de toutes les classes). |
| Compétences | `/v2/primary/competences` | Consulter les évaluations (lecture seule). |
| Appréciations | `/v2/primary/appreciations` | Créer, activer et désactiver les phrases de la banque. |
| Conseil des maîtres | `/v2/primary/conseil` | Préparer et gérer le conseil. |
| Avancement | `/v2/primary/direction` | Suivre l'état des classes. |
| Bilans annuels | `/v2/primary/bilans` | Lire et préparer les bilans (il ne scelle pas). |
| Archives | `/v2/primary/archives` | Préparer l'archive d'une année (il ne la gèle pas). |
| États | `/v2/primary/etats` | Obtenir les rapports. |

Droits sur les référentiels (créer, publier) : il les a dans le code, mais la page qui les porte, Paramètres, lui est fermée.

## 4. Instituteur

Il s'occupe de **sa** classe uniquement.

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Ma classe | `/v2/primary/classe` | Voir ses classes et lancer l'appel, les compétences, le conseil. |
| Compétences | `/v2/primary/competences` | Évaluer ses élèves (NA, EA, AC), enregistrer, puis valider la grille. |
| Appréciations | `/v2/primary/appreciations` | Piocher dans la banque pour rédiger ses appréciations (lecture seule). |
| Conseil des maîtres | `/v2/primary/conseil` | Préparer le conseil de sa classe. |
| Bilans annuels | `/v2/primary/bilans` | Lire le bilan de sa classe (il ne le prépare pas, ne le scelle pas). |
| Archives | `/v2/primary/archives` | Consulter les archives. |

## 5. Secrétariat

Lecture seulement.

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Ma classe | `/v2/primary/classe` | Voir les classes. |
| Compétences | `/v2/primary/competences` | Consulter les évaluations. |
| Avancement | `/v2/primary/direction` | Voir l'état des classes. |
| Bilans annuels | `/v2/primary/bilans` | Lire les bilans. |
| Archives | `/v2/primary/archives` | Consulter les archives. |
| États | `/v2/primary/etats` | Obtenir les rapports. |

## 6. Parent

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Bulletin et compétences | `/v2/primary/mon-enfant` | Choisir son enfant, lire ses compétences et ses bilans annuels publiés. |

## 7. Élève

| Page | Lien | Ce qu'il y fait |
| :--- | :--- | :--- |
| Bulletin et compétences | `/v2/primary/mon-enfant` | Lire ses propres compétences et son bilan. |

---

## Récapitulatif : qui voit quoi

| Page | Propriétaire | Directeur | Dir. des études | Instituteur | Secrétariat | Parent | Élève |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Ma classe | oui | oui | oui | oui | oui | | |
| Compétences | oui | oui | lecture | saisie | lecture | | |
| Appréciations | gère | gère | gère | lecture | | | |
| Conseil des maîtres | oui | oui | oui | oui | | | |
| Avancement | oui | oui | oui | | oui | | |
| Bilans annuels | oui | oui | oui | lecture | lecture | | |
| Archives | oui | oui | oui | consultation | consultation | | |
| États | oui | oui | oui | | oui | | |
| Paramètres | oui | oui | | | | | |
| Bulletin et compétences | | | | | | oui | oui |

## Rôles sans accès au pack Primaire

Enseignant (secondaire), Éducateur, Économe, Responsable pédagogique, Responsable des examens, Chargé d'admissions, Personnel : ils servent aux autres modules (finance, admissions, examens…).

## À savoir

- Le menu latéral du propriétaire n'affiche que : Pack Primaire (Avancement), Conseil des maîtres, Bilans annuels, Archives, États, Paramètres. **Ma classe, Compétences et Appréciations** s'ouvrent par leur adresse (ou depuis l'espace enseignant).
- Une page est refusée si le rôle n'a pas l'un des droits qu'elle exige. L'API reste la barrière réelle sur les données.
- Comptes existants dans l'école de test « Les Cocotiers » : propriétaire et directeur seulement. Les autres s'ajoutent avec `pnpm dev:v2:add-account`.
