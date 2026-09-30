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
