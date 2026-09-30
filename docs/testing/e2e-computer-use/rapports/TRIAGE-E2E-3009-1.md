# Tri du rapport `E2E-3009-1` (nouveau tenant `test-30091`, production)

## Acte 00 — création du tenant

| Constat | Verdict | Suite |
|---|---|---|
| Panneau « Comptes par tenant » absent de `/login` | Attendu sur la version déployée | La production tourne encore avec le correctif du 29/09 (panneau coupé par défaut). Le commit qui le **réactive** (`SHOW_TECHNICAL_ACCOUNTS: ${…:-true}`) n'est pas déployé, ou le `.env` de production contient `SHOW_TECHNICAL_ACCOUNTS=false`. Après déploiement, retirer cette ligne du `.env`. En attendant, les comptes du tenant se saisissent au clavier (`admin@test-30091.local` / `Password@2025`) |
| **ANO-A00-01** — refus d'un slug invalide en JSON brut | **Corrigé** | L'API traduit désormais l'erreur de validation en français (slug et nom), et le formulaire vérifie le slug avant l'envoi. Un slug déjà pris répond « Un tenant avec ce slug existe déjà » au lieu du message SQL |
| Boutons « Désactiver » et « Supprimer » silencieux en cas d'échec | **Corrigé** (trouvé en cherchant A00-01) | Ils rechargeaient la liste sans rien dire. Une erreur s'affiche maintenant. Important pour le nettoyage : un échec de suppression du tenant de test se voit |

## Suppression d'un tenant plein de données

Test sur une base temporaire : la suppression d'un tenant qui contient un commercial, des
provenances d'étudiants liées à ce commercial (lien `ON DELETE RESTRICT`) réussit, quel que soit
l'ordre de création des liens. Ce test ne couvre pas les autres tables : à confirmer par la
répétition à blanc du script de nettoyage après suppression réelle.

Le tenant de référence `ecoledigitale` ne peut pas être supprimé (« The reference tenant cannot
be deleted »).

---

# Actes 00.2 à 3.2 — tenant `test-30091`

## Ce qui a bien fonctionné
- Connexion à `admin@test-30091.local`, session sur le bon tenant.
- Menu **complet** (Scolarité, Paiements, Finances étudiantes) : cela confirme que l'écart
  ANO-A1-01 du run E2E-2909-1 vient de la configuration « Menus par rôle » d'`ecoledigitale`.
- **Cloisonnement des recherches** (étudiants, enseignants, UE d'`ecoledigitale`) : aucun résultat.
- Actes 1 et 2 sans anomalie ; matricules IPAM `-0001/-0002/-0003` (numérotation propre au tenant).

## ANO-A00-02 — classes copiées rattachées aux filières d'un autre établissement

**Verdict : confirmé, corrigé.** Vrai défaut d'intégrité entre établissements.

**Cause.** `cloneReferenceTable` recopiait chaque colonne des classes, y compris `filiere_id` et
`approved_by`, sans les remapper. Les classes du nouveau tenant pointaient donc vers des filières
et un compte de l'établissement de référence. La liste des classes joignait les filières sans
vérifier l'établissement, et affichait leurs noms.

**Reproduit puis corrigé** sur une base temporaire, avec la vraie fonction de copie :

| | Classes vers une filière d'un autre tenant | `approved_by` copié |
|---|---|---|
| Ancien code | 2 sur 3 | 1 |
| Code corrigé | **0** | **0** |

Le rejeu de la copie reste idempotent.

**Correctifs.**
- La copie clone aussi les **filières** et rattache chaque classe copiée à la copie de sa filière
  (ou à rien).
- Les colonnes qui désignent un compte (`approved_by`…) sont vidées à la copie.
- Quatre jointures vers `filieres` vérifient désormais l'établissement
  (`programmes.ts` ×2, `professional-payment.service.ts`, `professional-enrollment.service.ts`).

**Réparation des tenants déjà créés** : `infra/scripts/repair-cross-tenant-references.sql`
(répétition à blanc avec `-v commit=0`, application avec `-v commit=1`). Testé sur une base
temporaire : la répétition à blanc ne modifie rien, l'application répare, le rejeu ne trouve plus
rien, les établissements sains restent intacts. À lancer avec un rôle qui contourne la RLS, après
sauvegarde. Il concerne **tout tenant créé avant le correctif**, pas seulement `test-30091`.

**Conséquence pour le scénario** : un tenant créé avec le code corrigé aura des filières
(copiées) ; `test-30091`, créé avec l'ancien code, n'en a aucune. Attentes corrigées dans le
scénario (acte 00.3).

## ANO-A00-03 — signataires du tenant neuf identiques à ceux d'`ecoledigitale`

**Verdict : pas une fuite entre établissements. Comportement voulu, mais risqué pour un vrai
établissement.**

- La table est bien cloisonnée par établissement (politique RLS `professional_signataires`).
- `ProfessionalSignatairesService.list` **complète par des valeurs par défaut codées en dur** (des
  personnes réelles) quand un établissement n'a pas de ligne : c'est écrit et assumé dans le code
  (« servent de repli… pour que les documents restent corrects en toutes circonstances »).
- L'écran ne distingue pas « enregistré » de « valeur par défaut ».
- L'espace propriétaire, lui, **le détecte** : son écran Documents affiche « ATTENTION : N
  signataire(s) portent encore le nom livré par défaut… ».

C'est donc mon scénario qui était faux : il annonçait des cartes vides, et disait de ne rien
modifier si le tenant « en avait déjà ». **Corrigé** : à l'acte 4.2, remplacer et enregistrer les
quatre cartes quoi qu'elles affichent, et vérifier à l'acte 18 que le bandeau a disparu.

**Décision qui te revient** (pas de changement de code fait) : pour un **vrai** nouvel
établissement, faut-il que les signataires démarrent **vides** plutôt que de reprendre des noms de
personnes réelles ? Recommandation : oui, avec un message « À renseigner avant d'éditer un diplôme »
à l'édition. Coût : les établissements sans ligne enregistrée verraient leurs documents sortir sans
signataire jusqu'à saisie. À décider avant de le faire.

## Restes du run précédent copiés dans le tenant

La copie a repris le cycle `LICENCE E2E-2909-1` et la classe `TESTOLOGIE E2E-2909-1`, laissés
dans `ecoledigitale`. **Nettoyer ce run d'abord** (script de nettoyage, tag `E2E-2909-1`) avant de
créer un autre tenant de test.

## Acte 3 en cours
- 3.3 (parent) : l'alerte native est à lire et à fermer par l'humain.
- Doublons enseignant et matricule, puis 3.4 (mots de passe) : à jouer avec l'humain.

---

## ANO-A3-02 — alertes natives du navigateur : remplacées par des messages dans la page

**Décision de l'utilisateur** : oui. Corrigé sur les formulaires du parcours.

Une alerte native bloque l'onglet, disparaît sans laisser de trace et ne peut être ni lue ni
fermée par l'agent de test : c'est ce qui faisait perdre le texte des messages de doublon.

| Écran | Avant | Après |
|---|---|---|
| Nouvel enseignant (`/academic/teachers/new`) | alerte sur toute erreur de création (dont doublon d'e-mail) | message rouge dans la page |
| Nouvel étudiant (`/academic/students/new`) | alertes : e-mail existant, doublon de matricule, échec de création, **échec d'envoi du diplôme** | message rouge dans la page ; échec d'envoi du diplôme : bandeau jaune avec « Ouvrir la fiche de l'étudiant » et « Retour à la liste », création désactivée pour éviter de recréer l'étudiant |
| Nouveau parent (`/academic/parents/new`) | alertes : échec de création, identifiant non renvoyé, assignations en échec, **e-mail des identifiants non parti** | message rouge pour l'échec de création ; sinon bandeau jaune avec « Assigner des enfants » et « Continuer vers la liste » |
| Assigner des étudiants aux parents (`/academic/parents/assign`) | alertes de validation, de succès et d'erreur ; confirmation native du retrait | messages dans la page ; confirmation du retrait par une boîte de dialogue de l'application |

Composant partagé : `components/ui/form-message.tsx` (la page défile jusqu'au message ; rouge =
`role="alert"`, jaune et vert = `role="status"`).

**Effet à connaître pendant le run** : sur un établissement sans SMTP, la création d'un parent ne
retourne plus toute seule à la liste. Il faut cliquer « Continuer vers la liste ». Le scénario
(acte 3.3) le dit.

**Reste des alertes natives** (hors parcours, non modifiées) : listes enseignants, étudiants et
parents (suppression, export PDF/Word), modification d'un étudiant, fiche étudiant (ouverture du
diplôme), et huit formulaires académiques génériques (« Erreur lors de l'enregistrement… »). À
traiter au besoin.

---

# Actes 4 à 12.3 — tenant `test-30091`

## Ce qui a fonctionné (versions corrigées vérifiées en production)
- Doublons enseignant et matricule : bandeau rouge dans la page, aucun doublon créé.
- Fenêtre « Nouveau commercial » qui se ferme ; confirmation « Supprimer ce créneau ? » ;
  étudiants retirés de la liste après inscription ; signataires remplacés et persistants.
- Encaissements : 5 reçus, refus (0, dépassement, référence en double), verrou « frais d'inscription »
  (Chantal en attente après paiement partiel, confirmée après le second) ; commission 10 000.
- Notes, conduite, rattrapages et décisions : toutes les valeurs attendues (14,60 · 14,77 · 11,17 ·
  12,28 · 8,72) ; « Calcul bloqué » sans conduite.

## Corrigé dans le code

| Constat | Correction |
|---|---|
| L'agent bloqué sur la confirmation native « Clôturer le semestre » | Les confirmations « Clôturer le semestre » (Notes), « Clôturer » (Bulletins) et « Forcer l'octroi » (Diplômes) sont des dialogues de la page. La révocation d'un diplôme ouvre un dialogue avec un champ « Motif » obligatoire (refus « Le motif de révocation est requis. ») à la place de `window.prompt` |
| **C11** — bandeau « BULLETIN PROVISOIRE — en attente de Session 2 » sur le relevé d'une étudiante ajournée | Le bandeau n'apparaît que si la session 2 est encore à venir (`statut_etudiant = session2`). Vérifié en générant de vrais PDF : ajournée = pas de bandeau, session 2 à venir = bandeau, admise = pas de bandeau. L'info-bulle du badge « Provisoire » ne promet plus la session 2 à un étudiant qui l'a déjà passée |
| **C18** — référence `REL-…` du relevé absente du PDF | Calculée par l'API depuis toujours, jamais dessinée (même défaut que le diplôme, corrigé en campagne 1). Imprimée maintenant au pied du relevé, LMD et BTS. Vérifié sur PDF |
| **C10** — coefficient d'un devoir saisi mais sans effet | Une mention l'annonce sous le champ : « Indicatif : n'entre pas dans le calcul de la note de la matière, qui prend la moyenne simple des devoirs ». Le calcul n'est pas modifié |

## Pas corrigé, et pourquoi

**C19 — l'identité de l'IPAM sur tous les documents d'un tenant de test.** Nom, logo, adresse, téléphone,
site et e-mail sont des constantes du code (`bulletin-format.ts`, et leurs équivalents pour
diplômes, attestations, reçus, fiches de paie, emploi du temps). Un nouvel établissement imprime donc
les documents de l'IPAM. C'est une **fonctionnalité** (identité par établissement : stockage, écran
d'administration, lecture par une dizaine de générateurs PDF), pas un correctif. À décider.

**Lenteur des pages** (Présences 20 s, Conduite 40 s, Rattrapages 65 s, Corrections 10 à 25 s). Les
requêtes en cause sont légères et le tenant de test ne contient que 3 étudiants : les données n'expliquent
pas ces durées. Cause probable **hors code applicatif** (base, réseau entre les conteneurs, charge du
serveur). Rien changé à l'aveugle. Mesure demandée à l'agent : durée de chaque appel API des pages lentes
(`read_network_requests`), pour séparer « l'API répond lentement » de « la page attend autre chose ».

**« ANNÉE ACADÉMIQUE 2025-2026 » sur le PDF du planning alors que le semestre court d'août à novembre
2026.** Pas un défaut : l'année scolaire pivote au 1er septembre, et le paramètre `DEBUT` du run
(J − 30) est tombé le **31/08/2026**, donc rattaché à 2025-2026. Choisir un début au 1er septembre
ou après évite le cas.

**Filtres non conservés et libellé de classe incohérent** (mineurs) : non traités.
