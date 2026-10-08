# Prompt : générer le guide de test complet d'EcoleDigitale (à coller dans une nouvelle conversation Claude Code)

> Ouvrir Claude Code dans `D:\EcoleDigitaleV3`, puis coller tout ce qui suit la ligne `---`.

---

Tu es le lead technique et rédacteur QA du projet **EcoleDigitale** (jamais « ScolarFlow » : le PRD se trompe de nom), une plateforme SaaS multi-établissements de gestion scolaire pour la Côte d'Ivoire (monorepo pnpm : `apps/api` Fastify + SQL, `apps/web` Next 15, `apps/worker`, `packages/*`). Réponds et rédige en **français**.

## 1. Objectif

Produire un **guide de test utilisateur de bout en bout**, en Markdown, couvrant **tous les modules réellement implémentés**, qu'une personne non développeuse (ou un agent « Claude web » pilotant Chrome) peut suivre écran par écran dans l'application lancée en local, avec **des jeux de données réalistes prêts à saisir pour chaque formulaire**, les résultats attendus exacts et les contrôles négatifs.

Il doit permettre de suivre le **workflow complet** d'une école : mise en place de l'établissement → année et structure → personnes → admissions et inscriptions → emploi du temps → appel → évaluations et notes → règles et résultats → bulletins → finance et paiements → paie → documents → messagerie → vie scolaire / conseils / examens → tableaux de bord → portails parent, élève, enseignant.

## 2. Ce qui existe déjà (à lire d'abord, ne pas repartir de zéro à l'aveugle)

- `docs/GUIDE_UTILISATEUR_TEST.md` (~7 000 lignes, chapitres C01 à C22, parcours A à H, sécurité, modèle de rapport) : **base à auditer et améliorer**, pas à ignorer. Repère ses lacunes : écrans non couverts, jeux de données absents ou vagues, attendus faux ou périmés.
- `docs/qa/e2e/` : workflow de test par rôle (35 sessions `sessions/NN-<rôle>-<pack>.md`, `README.md`, `MODELE-RAPPORT.md`, `RAPPORT-CONSOLIDE.md`) et **rapports réels de testeurs** `rapports/02..13-*.md` avec, pour chacun, une table « Traitement par le développeur » : ce sont les **leçons apprises** (attendus erronés, règles de conception mal comprises, défauts corrigés). Exploite-les pour ne pas réécrire des attendus faux.
- Sources de vérité fonctionnelles : `docs/PRD_EcoleDigitale_SaaS.md`, `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`, `docs/ETAT_IMPLEMENTATION.md`, `specs/v2/*` (000 à 033, `REPONSES-METIER.md`, `DECISIONS-METIER.md`, `QUESTIONS-A-VALIDER.md`), README de chaque module dans `apps/api/src/modules/*/README.md`.
- Sources de vérité techniques : écrans `apps/web/src/app/v2/**` (routes), libellés exacts `apps/web/messages/fr-CI.json`, schémas Zod `packages/contracts/src/v2/*.ts` (champs obligatoires, longueurs, formats, énumérations), droits `apps/api/src/modules/rbac/templates/system-roles.ts`.

## 3. Environnement de test (à documenter en tête du guide)

- Démarrage : `demarrer-application.bat` ou `pnpm dev:v2:setup` puis `pnpm dev:v2` (+ `pnpm dev:v2:seed`) ; web http://localhost:3000, API http://localhost:4000. Base locale `ecoledigitale_v2`. Ne touche à aucune autre base.
- Page `/login` : panneau de droite listant **37 comptes de test réels** (clic = formulaire rempli ; code MFA pré-rempli). Trois établissements : **Collège Le Baobab** (`secondaire-test`, 12 rôles), **École Les Palmiers** (`primaire-test`, 13 rôles), **Université Horizon** (`superieur-test`, 12 rôles). Lis `scripts/dev-v2/seed.ts` pour la liste exacte des comptes, rôles, MFA, élèves, classes, périodes et données de départ. **Ne jamais écrire de mot de passe ni de code MFA dans le guide.**
- Règles de démonstration : tous les jeux de règles de calcul (moyennes, passage, BEPC, BAC, CEPE...) sont des **règles de démonstration**, signalées par un bandeau et un filigrane. N'invente **jamais** une règle officielle ivoirienne.
- Paiement : fournisseur simulé « Paiement simulé (démonstration) » (montant se terminant par 001 = en attente, par 013 = échec, sinon succès). Aucun effet externe réel (e-mail, SMS, paiement).

## 4. Méthode de travail (obligatoire)

1. **Inventaire** : parcours `apps/web/src/app/v2/**` pour lister TOUS les écrans (route, rôle(s) autorisé(s), fonctions : liste, création, modification, action d'état, export, import). Produis d'abord `docs/guide-test/00-inventaire-ecrans.md` (tableau module → écran → URL → rôle → formulaires/actions). Le guide doit couvrir 100 % de cet inventaire ; ce qui n'est pas implémenté ou pas atteignable va dans une section « Non couvert / limites connues ».
2. **Pour chaque formulaire** : lis le schéma Zod et le composant, relève les champs (libellé EXACT de `fr-CI.json`), obligatoires/facultatifs, formats, bornes ; puis écris un **tableau de saisie champ → valeur** avec des données **réalistes ivoiriennes et fictives** : prénoms et noms (KOUASSI, KONÉ, TRAORE, YAO, DIABATE, BAMBA, COULIBALY...), téléphones `+225 07 xx xx xx xx` / `05` / `01` en valeurs factices, communes (Abidjan : Cocody, Yopougon, Abobo ; Bouaké ; Yamoussoukro...), adresses e-mail en `@exemple.test`, dates de naissance cohérentes avec le niveau, montants en F CFA entiers, matricules et codes classes cohérents avec l'établissement. Donne à chaque enregistrement un nom **unique et reconnaissable** (suffixe « test guide ») pour éviter les collisions et permettre le nettoyage.
3. **Jeux invalides** : pour chaque formulaire important, ajoute 2 à 4 saisies invalides (champ vide, format faux, doublon, chevauchement de dates, montant négatif, motif trop court...) avec le **message d'erreur attendu** lu dans le code ou les messages, pas deviné.
4. **Vérifie chaque attendu dans le code ou les tests** (routes, états, droits, messages). Si tu ne peux pas le vérifier, écris « à vérifier en test » : n'affirme jamais un comportement non prouvé. Les rapports `docs/qa/e2e/rapports` montrent les erreurs fréquentes : un attendu rédigé de mémoire (par exemple « le parent dépose un document ») était faux.
5. **Imports** : fournis de vrais fichiers d'exemple dans `docs/guide-test/jeux-de-donnees/` (CSV, et XLSX si faisable) correspondant aux importeurs réels (`apps/api/src/modules/imports`) : un fichier valide, un fichier avec erreurs de lignes attendues. Documente le gabarit de colonnes tel que l'application le fournit.
6. **Chaînes de dépendances** : une donnée créée dans un chapitre doit être réutilisée dans les suivants (même élève, même classe, même facture). Indique en tête de chaque chapitre : prérequis (données, états), compte à utiliser, établissement.
7. **Parcours de bout en bout par persona** en plus des chapitres par module : au minimum (a) rentrée d'un élève secondaire de l'admission au bulletin et au paiement, (b) incident de vie scolaire jusqu'à l'information de la famille, (c) conseil de classe et procès-verbal, (d) primaire : compétences, conseil des maîtres, bilan annuel, (e) supérieur : UE/ECUE, relevé, rattrapage, diplôme, (f) facturation → paiement → reçu → remboursement (quatre yeux), (g) paie d'un enseignant, (h) élève affecté par l'État, (i) examens (session, candidats, centres, notes, résultats, documents), (j) abonnement, rôles et audit côté propriétaire/plateforme.
8. **Sécurité et droits** : pour chaque rôle, liste les accès autorisés et au moins 3 adresses à taper à la main qui doivent être refusées ; isolation entre établissements (aucune donnée d'un autre établissement) ; séparation des tâches (quatre yeux) ; MFA ; journal d'audit.
9. **Qualité transversale** : français partout (pas de code technique brut), états vides, chargement, erreurs, accessibilité clavier (Tab, Échap), mobile, hors ligne/PWA.
10. **Contrôle automatique** : écris un petit script (`scripts/check-guide-test.mjs`) qui vérifie que (a) chaque route `/v2/...` citée existe dans l'App Router, (b) chaque libellé entre guillemets français cité existe dans `fr-CI.json`. Corrige le guide jusqu'à zéro écart et rapporte honnêtement ce qui reste.

## 5. Format attendu

Dossier `docs/guide-test/` :
- `README.md` : mode d'emploi, environnement, comptes (sans mot de passe), ordre recommandé des chapitres, convention de cases à cocher, échelle de sévérité, modèle de rapport d'anomalie.
- `00-inventaire-ecrans.md`.
- Un fichier par chapitre/module (`01-plateforme-et-etablissement.md`, `02-connexion-mfa-comptes.md`, `03-structure-academique.md`, `04-personnes.md`, `05-imports.md`, `06-presences.md`, `07-emploi-du-temps.md`, `08-evaluations-notes.md`, `09-regles-resultats.md`, `10-bulletins-documents-officiels.md`, `11-superieur.md`, `12-finance-paiements.md`, `13-paie.md`, `14-documents-ged.md`, `15-messagerie-notifications.md`, `16-tableaux-de-bord-analytics.md`, `17-admissions.md`, `18-pack-primaire.md`, `19-pack-secondaire.md`, `20-portails-parent-eleve-enseignant.md`, `21-accessibilite-mobile-pwa.md`, `22-parcours-de-bout-en-bout.md`, `23-securite-isolation-droits.md`) ; adapte la liste à l'inventaire réel.
- `jeux-de-donnees/` : fichiers CSV/XLSX + `annexe-donnees.md` (index de TOUS les enregistrements fictifs créés par le guide, avec chapitre d'origine, pour suivi et nettoyage).

Modèle d'un pas de test (à respecter partout) :

```
#### X.Y Titre du scénario
Compte : <rôle> (<établissement>) · Où : menu « … » > « … » (`/v2/…`) · Prérequis : …
1. Action précise.
2. « Créer » : remplir le formulaire :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | … | … | oui |
3. Cliquer « … ».
Résultat attendu : message exact « … », ligne visible dans la liste, valeur persistée après rechargement.
Cas invalides : | Saisie | Message attendu |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour <rôle>
```

## 6. Limites et règles (non négociables)

- Pas de `git push`, de PR, de changement de remote, de réécriture d'historique ni de suppression de branche. Commits locaux autorisés, par lots cohérents.
- Aucun secret réel dans le dépôt, les journaux ou le guide (`node scripts/check-secrets.mjs` doit rester vert). Ne désactive ni n'affaiblis le scan de secrets.
- Aucune opération sur une autre base que `ecoledigitale_v2` ; ne supprime pas les tables héritées ni Prisma ; pas d'installation de logiciel système.
- Données et effets 100 % fictifs ; aucun envoi réel (e-mail, SMS, paiement).
- Ne modifie pas le code de l'application pour « faire coller » le guide. Si tu trouves un défaut ou un écran inatteignable, note-le dans une section « Écarts constatés » (écran, constat, gravité) ; ne le corrige pas dans cette tâche, sauf coquille de documentation.
- Rapporte honnêtement : ce qui est couvert, ce qui ne l'est pas, ce qui est « à vérifier ». Ne prétends pas avoir exécuté les scénarios dans le navigateur si tu ne l'as pas fait ; tu peux toutefois lancer l'application et vérifier un échantillon d'écrans avec le navigateur intégré, et le dire.

## 7. Organisation

Le travail est grand : commence par l'inventaire et un plan chapitre par chapitre, puis exécute-le en parallélisant par groupes de modules (sous-agents en worktrees isolés si disponibles), en fusionnant et en relisant toi-même chaque chapitre. Valide avec le script de contrôle du point 4.10. Termine par un compte rendu : fichiers produits, couverture (écrans couverts / total), écarts constatés, éléments « à vérifier ».
