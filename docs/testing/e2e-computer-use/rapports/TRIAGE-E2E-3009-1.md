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
