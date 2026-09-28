# Campagne E2E `E2E-2209-1` — Programme → Diplôme
### Rapport final

**Dates** : 22 et 23/09/2026 · **Environnement** : développement local (web `:3000`, API `:4000`,
base `dbecoledigitale`, tenant `ecoledigitale`)
**Exécution** : agents Claude pilotant un navigateur (Sonnet 5 puis Claude web avec l'extension
Chrome) · **Analyse et correctifs** : Claude Code (Opus)
**État du code** : ⚠️ **aucun dépôt Git** (`.git` absent depuis la restauration). Les correctifs
existent uniquement dans l'arbre de travail, sans historique ni diff versionné. Voir §8.

---

## 1. Verdict

**Le parcours « de la création du programme à la délivrance du diplôme » fonctionne de bout
en bout.** Programme → UE et ECUE → semestre → ouverture de classe → inscriptions → présences →
notes → conduite → rattrapage → bulletins → clôture → **diplôme délivré, signé et visible par
l'étudiante dans son espace**.

Il ne fonctionnait pas au départ. La première passe s'est arrêtée à l'étape des présences : une
cohorte correctement inscrite était invisible de toute la scolarité. Cinq passes et vingt
correctifs plus loin, la dernière passe n'a relevé **aucune anomalie bloquante ni majeure**.

Deux réserves de périmètre, à lire avant tout le reste :

- **Le parcours académique classique n'a pas été joué** (scénarios S15-S16). Il ne délivre de
  toute façon aucun diplôme — seul le module professionnel le fait —, mais il n'est pas testé.
- **Le volet financier n'est testé qu'en partie** : les encaissements (S11) le sont et sont
  corrects ; les commissions, la rémunération des formateurs et le paiement en ligne
  (S12 à S14) ne le sont pas.

| | |
|---|---|
| Passes jouées | 7 (plus une passe d'amorçage par agents) |
| Défauts corrigés | 23, dont **une faille de sécurité** (passe 6) |
| Défauts écartés après analyse | 6 (artefacts de test, comportements voulus) |
| Décisions métier prises | 5 |
| Décisions encore ouvertes | 6 |
| Scénarios non joués | **Aucun dans le périmètre du module professionnel.** Seuls restent la génération, l'archivage et le versement de la paie (S13, étapes 4 à 6) : gestes collectifs, à jouer sur une copie isolée de la base |

---

## 1 bis. Passe 6 — ce qu'elle change

La passe 6 visait les volets jamais joués : tunnel d'inscription public (S14), parcours
académique (S15-S16), commissions (S12) et rémunération (S13). Elle a produit **la découverte
la plus sérieuse de la campagne**, et conduit à **recentrer le périmètre** sur le module
professionnel IPAM.

### La faille de sécurité — corrigée

**Constaté** : le testeur signalait qu'un parent voyait les boutons d'édition du catalogue de
formations. L'analyse a révélé bien pire : les routes d'écriture du catalogue
(`/api/v1/formations-pro`) **n'avaient aucun contrôle d'accès**. Le module est enregistré en
« accès public » parce que la *lecture* du catalogue l'est ; ses six routes de création,
modification et **suppression** — formations et sessions — l'étaient donc aussi. Une requête
**anonyme**, portant seulement l'en-tête `X-Tenant`, atteignait le gestionnaire.

**Preuve** (requêtes réelles, aucune donnée touchée) :

| Tentative d'écriture | Avant | Après |
|---|---|---|
| Anonyme, sans jeton | acceptée — une suppression allait jusqu'à « Formation introuvable » | **401** |
| Parent connecté | acceptée | **403** |
| Anonyme avec un corps de création complet et valide | — | **401**, et rien n'est créé |
| Administrateur | acceptée | toujours acceptée |
| Lecture publique du catalogue | ouverte | toujours ouverte |

**Correctif** : une garde administrateur appliquée aux six routes, reprenant exactement les
règles de la seule route du fichier qui en avait une. `apps/api/src/routes/formations-pro.ts`.
Le fichier voisin `sessions-pro` a été audité dans la foulée : ses neuf routes d'écriture sont
protégées.

**À retenir** : cette faille existe vraisemblablement sur **tout environnement déployé** avec ce
code. Le correctif doit y être porté en priorité, avant toute autre chose de ce rapport.

### Recentrage du périmètre — décision de l'utilisateur

> « On doit se concentrer sur le module professionnel IPAM. »

Le **tunnel d'inscription public** et le **parcours académique** sont mis de côté. Leurs
défauts sont consignés, **non corrigés** (§10 bis). Seule exception, validée explicitement : la
table des relevés de notes, créée par une migration (`0035`) jamais appliquée en local, a été
installée — opération purement additive.

---

## 1 ter. Passe 7 — le module professionnel est entièrement couvert

**Commissions de prospection — conformes.** Sur les trois paiements réels d'Aminata, les
commissions valent exactement 5 000 + 10 000 + 10 000 = **25 000**, portées au franc près par
l'écran. L'assiette est bien le paiement encaissé, une commission par paiement. Le **taux est
figé** : passer le commercial de 10 % à 20 % n'a rien réécrit. Le règlement annonce le montant
exact de la ligne cochée ; une ligne réglée n'est plus proposée.

La protection contre un **double règlement**, non rejouée par prudence, a été vérifiée dans le
code : elle existe à deux niveaux — le service exclut toute ligne déjà réglée et recalcule le
montant depuis la base ; un **index d'unicité** par paiement bloque le doublon même en cas de
requêtes simultanées.

**Rémunération — la validation des séances fonctionne**, sans toucher aux autres séances de
l'enseignante, y compris sur un semestre clôturé.

**Deux écrans prévus par la spec 031 sont absents.** Cochés comme faits dans
`specs/031-remuneration-professionnelle/tasks.md`, ils n'existent pas dans le code :

- **T038 — la gestion des tarifs horaires par ECUE** (et son entrée de menu, T020). L'API, le
  service, les hooks et le refus des chevauchements existent ; l'écran, non. Les 96 tarifs en base
  viennent d'un script. **Un administrateur ne peut fixer aucun tarif par ECUE.**
- **La liste des séances validées.** L'outil partagé sait la produire, aucune page ne l'appelle.
  Une séance validée disparaît de tout écran jusqu'au calcul du bulletin. Le message de validation,
  qui promettait « elles rejoignent l'historique », a été corrigé pour ne plus renvoyer vers un
  écran inexistant.

Faute de dépôt Git, impossible de dire s'ils ont été perdus à la restauration ou retirés
volontairement. **Décision** : la tarification telle qu'elle est gérée aujourd'hui convient ; ces
écrans ne seront pas construits. `tasks.md` de la spec 031 les marque pourtant comme faits
(T020, T038) : à corriger pour qu'un lecteur futur ne s'y fie pas.

---

## 2. Déroulé de la campagne

| Passe | Pilote | Où elle s'est arrêtée | Apport principal |
|---|---|---|---|
| 0 | Agents Sonnet | Socle partiel (cycle → 2 ECUE) | Mise au point du dispositif de test ; trois blocages d'environnement |
| 1 | Claude web | Étape 6.1 (présences) | **Le bloquant** : inscrits invisibles de la scolarité |
| 2 | Claude web | Bout de la chaîne | Onze anomalies, dont **une note modifiable après clôture** |
| 3 | Claude web | Bout de la chaîne | Vérification de 13 correctifs ; défauts des documents imprimés |
| 4 | Claude web | Bout de la chaîne + **S11** | Volet financier conforme ; une régression de ma part détectée |
| 5 | Claude web | Bout de la chaîne | Tout tient ; trois défauts résiduels, tous de mon fait, corrigés |
| 6 | Claude web | S14, S15, S16, S12 partiel | **Faille de sécurité sur le catalogue** ; défauts du tunnel public et de l'académique, mis de côté par décision |
| 7 | Claude web | S12 et S13 (périmètre réduit) | **Aucune anomalie bloquante ni majeure.** Commissions justes au franc près, taux bien figé ; deux écrans de la spec 031 absents |

La passe 0 a été abandonnée au profit d'un pilotage par l'extension Chrome après trois
incidents d'amorçage, tous liés à l'outillage et non au produit : champs React qui partaient
vides quand on les remplissait par programme, redémarrages spontanés de l'API, chute du
serveur web. Le protocole a été enrichi en conséquence (`00-protocole-agent.md` §9 et §10).

---

## 3. Défauts corrigés

Classés par gravité. Pour chacun : ce qui était constaté, la cause établie dans le code, le
correctif. **Tous ont été revérifiés à l'exécution** lors d'une passe ultérieure, sauf
mention contraire.

### 3.1 Bloquants et graves

**① Une cohorte inscrite était invisible de toute la scolarité.**
*Constaté* : présences, notes, conduite, bulletins et attestations annonçaient « 0 inscrit »
pour une classe de trois étudiants.
*Cause* : la règle « une inscription n'ouvre la scolarité qu'une fois les frais d'inscription
soldés » est **voulue** et documentée. Mais elle n'était évaluée **qu'au moment d'un
encaissement**. Une classe **sans** frais d'inscription au barème ne déclenchait donc jamais
d'encaissement, donc jamais de confirmation : ses inscrits restaient en attente pour toujours,
contrairement à ce que le code promettait lui-même en commentaire.
*Correctif* : la règle est extraite dans un module partagé et évaluée **dès la création** de
l'inscription.
*Fichiers* : `professional-inscription-gate.ts` (nouveau), `professional-enrollment.service.ts`,
`professional-payment.service.ts`.
*Données* : migration de rattrapage `0127` pour les lignes déjà créées. Sa portée a été mesurée
avant application : 6 lignes confirmées (la cohorte de test) ; les 3 lignes d'un étudiant réel
qui **doit** des frais sont restées bloquées. Le verrou métier fonctionne donc toujours.

**② Une note restait modifiable après la clôture du semestre.**
*Constaté* : sur un semestre clôturé, une note d'examen a pu être modifiée et le calcul
relancé ; la moyenne d'UE a bougé, contredisant un bulletin déjà généré.
*Cause* : la clôture n'était vérifiée qu'à la régénération des bulletins, pas à la saisie.
*Correctif* : verrou côté serveur sur les **quatre** points d'écriture (saisie, modification,
suppression d'une note, recalcul), puis côté écran (bannière, boutons désactivés, tableau
entier en lecture seule). Le verrou interroge les deux chemins qui rattachent une cohorte à
son semestre ; n'en interroger qu'un aurait laissé passer toutes les cohortes créées par lot.
Aucun faux positif sur les 105 semestres ouverts de la base.
*Fichiers* : `professional-cloture-guard.ts` (nouveau), `professional-results.service.ts`,
`professional-bulletin.service.ts`, `professionnel/admin/notes/page.tsx`.

### 3.2 Majeurs

**③ Comptes inutilisables sans serveur de messagerie.**
Un compte créé reçoit un mot de passe généré, envoyé par e-mail ; sans SMTP, il n'était jamais
affiché et aucun écran ne permettait de le réinitialiser. L'API savait le faire depuis
toujours, les hooks web existaient : **rien ne les appelait**. Ajout d'une action
« Réinitialiser le mot de passe » sur les fiches **enseignant, étudiant et parent**.
*Fichiers* : `components/academic/ResetPasswordAction.tsx` (nouveau) et les trois fiches.

**④ Le sexe saisi à la création n'était pas enregistré.**
Le formulaire le collectait, l'API savait l'écrire ; entre les deux, le hook web construisait
une charge utile en liste blanche **dont le champ était absent**. Les étudiantes apparaissaient
« Masculin » parce que la lecture remplace une valeur absente par « masculin » (voir §7, point 4).
*Fichier* : `lib/hooks/use-students.ts`. Les trois étudiantes de test ont été réparées.

**⑤ Rattachement parent-enfant impossible.**
Les listes d'étudiants et de parents étaient filtrées sur l'année académique active : 63
étudiants et 46 parents devenaient 0. Or le lien parent-enfant n'a **aucune dimension
annuelle** en base. Filtre retiré.
*Fichiers* : `academic/parents/assign/page.tsx`, `academic/parents/new/page.tsx`.

**⑥ Le diplômé ne pouvait pas télécharger son diplôme.**
Aucun téléchargement dans l'espace étudiant. Le correctif ne se réduisait pas à un bouton : la
route des signataires est réservée à l'administration, et un diplôme produit côté étudiant
serait sorti **sans signature**. Les signataires, le matricule et l'état civil voyagent
désormais avec l'attestation servie à l'étudiant lui-même.
*Fichiers* : `professional-diplomas.service.ts`, `student/diplomes/page.tsx`,
`use-professional-diplomas.ts`.

**⑦ Le diplôme ne portait ni sa référence, ni toujours le matricule.**
La référence était **reçue par le gabarit et jamais dessinée** ; le matricule dépendait de
l'appelant. Référence imprimée en pied de page ; matricule servi par le serveur. Il existait
**trois chemins** vers ce document (liste admin, fiche admin, espace étudiant), dont deux
copies du même code : ils produisent désormais le même document (même texte, même taille
à l'octet près, vérifiés en passe 5).
*Fichiers* : `lib/diplome-pdf.ts`, `professionnel/admin/diplomes/page.tsx` et `[id]/page.tsx`.

**⑧ Le bulletin était inaccessible à l'étudiant.**
Le bouton « Voir » tournait puis s'arrêtait sans un mot. Deux défauts superposés : la fonction
d'ouverture n'avait **pas de `catch`** (échec muet), et l'étudiant recevait toujours le gabarit
LMD là où l'administration édite un bulletin de mise en page BTS. Une route dédiée sert
désormais à l'étudiant **ses propres** données BTS — vérifiées identiques octet pour octet à
celles de l'administration.
*Fichiers* : `student/documents/page.tsx`, `lib/bulletin-pdf-bts.ts`,
`routes/professional.ts`, `professional-bulletin.service.ts`, `use-professional-bulletins.ts`.

**⑨ Le bulletin imprimait « BTS » sur l'identité d'une étudiante de Licence.**
Le gabarit de style BTS sert volontairement aux Licence 1 et 2 ; mais il imprimait aussi
« Spécialité BTS … » et « Niveau BTS 1 ». Gabarit conservé, **niveau et spécialité réels**
imprimés. En chemin, un octet de contrôle invisible s'était glissé dans une expression
régulière — le code compilait et aurait imprimé « LICENCE » sans chiffre ; détecté à
l'inspection des octets et réparé.
*Fichiers* : `lib/bulletin-format.ts`, `lib/bulletin-pdf-bts.ts`.

**⑩ La décision du jury n'apparaissait pas sur le bulletin.**
L'écran affichait « Décision du jury : ADMIS », le document n'en disait rien alors que les
données la contenaient. Ajoutée au tableau de synthèse. Garde-fou : la fonction de libellé
retombait sur « AJOURNÉ » pour toute valeur inconnue — une décision **absente** se serait
imprimée comme un échec.

**⑪ Le reçu d'un règlement réparti n'imprimait qu'un numéro sur deux.**
Un règlement de 200 000 réparti sur deux UE produit deux reçus en base ; le document imprimait
`REC-PRO-2026-000004 (+1)`. L'abréviation convient à une liste, pas à une pièce comptable.
Liste complète désormais imprimée, avec police adaptative. Le défaut existait en **trois**
endroits : scolarité admin, espace étudiant, espace parent.
*Fichiers* : `lib/scolarite-paiements.ts`, `lib/receipt-pdf.ts`, et les deux pages documents.

**⑫ Les signataires se concaténaient.**
La saisie s'ajoutait à la valeur existante (« Celeste BAHKoffi Signataire… ») : un
rafraîchissement en arrière-plan réécrivait le formulaire **pendant la frappe**. Une fiche en
cours de modification n'est plus jamais réécrite ; le contenu est sélectionné à la prise de
focus.
*Fichier* : `professionnel/admin/signataires/page.tsx`.

### 3.3 Mineurs

| # | Défaut | Correctif |
|---|---|---|
| ⑬ | Filtre « Classe » des écrans ECUE toujours vide | Même cause que ① — résolu sans code |
| ⑭ | Diplômes et Attestations comptaient la même cohorte différemment (3 contre 0) | Prédicat aligné (`professional-diplomas.service.ts`) |
| ⑮ | Aucun retour visuel après enregistrement (inscriptions, semestres, ECUE) | Confirmation affichée au niveau du bouton ; défilement vers le message ailleurs |
| ⑯ | Message « Aucun étudiant inscrit confirmé » qui ne disait pas pourquoi | Reformulé en trois endroits : il nomme les frais d'inscription non soldés |
| ⑰ | L'écran d'erreur « vider le cache » ne débloquait personne | Il n'attendait pas le vidage et rechargeait sans contourner le cache HTTP ; corrigé (`ChunkErrorBoundary`, `ChunkErrorRecovery`) |
| ⑱ | Colonne « Étudiant » figée recouvrant le champ Examen sur écran étroit | Collante seulement à partir de 768 px |
| ⑲ | Compteur de séance ignorant les retards (« 1P · 1A ») | Affiche retards et absences justifiées |
| ⑳ | Libellé « Choisir une classe » sur le sélecteur de semestre | « Choisissez d'abord une classe » |

### 3.4 Qualité et tests

- **11 tests unitaires** ajoutés sur les deux verrous (`professional-gardes.test.ts`), tous
  verts. Ils testent la logique de décision avec un client factice ; les tests d'intégration
  existants du dépôt écrivent dans la base de développement, d'où ce choix.
- **Typage** : aucune erreur introduite dans les fichiers touchés. Le gabarit BTS est passé de
  8 erreurs préexistantes à 0. (Le total global a aussi varié pour une autre raison : une
  autre session modifiait en parallèle les fichiers de l'espace propriétaire.)

### 3.5 Données réparées

- **Les quatre signataires réels ont été restaurés** (Celeste BAH, PROFESSEUR PENE BI GUIME
  CREPIN, CELESTE BAH Enseignant - chercheur, BAH CELESTE). Ils avaient été écrasés par les
  noms de test à la passe 1. Valeurs reprises de la migration `0087`, concordantes avec les
  valeurs par défaut du code et avec ce que le testeur avait lu à l'écran. *Réserve* : une
  personnalisation manuelle faite entre l'installation et le test ne serait retrouvable dans
  aucune de ces sources.
- Sexe des trois étudiantes de test.

---

## 4. Défauts écartés après analyse

Signalés comme anomalies, ils n'en étaient pas. Les consigner évite de les « corriger » plus
tard par erreur.

| Signalement | Conclusion |
|---|---|
| Boutons inertes sur la fiche diplôme, et « Détails » inertes | **Artefact d'automatisation.** Gestionnaires sains ; les mêmes boutons ont fonctionné au clic en passe 5 |
| Bulletin « de style BTS » pour une Licence | **Voulu** pour la mise en page ; seuls les libellés d'identité étaient fautifs (⑨) |
| Absence de crédits sur le bulletin | **Voulu** (commentaire explicite du code), confirmé par décision (§6) |
| Aucune séance générée depuis l'emploi du temps | **Voulu** : l'enseignant crée ses séances |
| Écran d'inscription en lot excluant les étudiants déjà inscrits | **Voulu** : c'est un écran d'accueil de cohorte ; une UE supplémentaire s'ajoute depuis la fiche de session (onglet Inscrits) |
| Erreurs 500 transitoires en fin de campagne | **Environnement** : rechargement de l'API ou recompilation du serveur web, notamment pendant mes propres modifications en cours de passe |

---

## 5. Ce que j'ai moi-même introduit, et corrigé

Par honnêteté, et parce que c'est instructif pour la suite : quatre défauts de la campagne sont
nés de mes correctifs.

1. **Bulletin étudiant vide** (passe 4) : j'avais changé de gabarit sans vérifier que les
   données avaient la bonne forme.
2. **Diplôme sans UV depuis la fiche** (passe 4) : j'avais corrigé l'une des deux copies du code.
3. **Page qui remontait après l'inscription** (passe 5) : deux correctifs successifs, le second
   plaçant la confirmation au bon endroit, le premier la faisant aussitôt quitter l'écran.
4. **« AJOURNÉ (provisoire) »** (passe 5) : j'avais accolé à la décision du jury le statut
   provisoire du semestre. Après rattrapage et clôture, « Ajourné » est définitif.

Tous ont été détectés par la passe suivante et corrigés. La leçon commune : **vérifier la forme
des données et tous les chemins vers un même document**, pas seulement celui qu'on vient de
toucher.

---

## 6. Décisions prises

| Décision | Tranchée par | Effet |
|---|---|---|
| Le paiement des **frais d'inscription** conditionne l'accès à la scolarité | Utilisateur, 22/09 | Verrou conservé ; seul le déclencheur manquant est corrigé (①) |
| **Crédits et UV** : ni sur le bulletin, ni sur l'attestation, ni sur le diplôme | Utilisateur, 23/09 | Documents conformes à leur texte d'avant le test |
| **Décision du jury** imprimée sur le bulletin | Utilisateur, 23/09 | ⑩ |
| Gabarit BTS conservé, **libellés d'identité réels** | Utilisateur, 23/09 | ⑨ |
| **Signataires réels** restaurés | Utilisateur, 23/09 | §3.5 |
| **Tarification actuelle conservée** : pas d'écran de tarifs par ECUE ni de liste des séances validées | Utilisateur, 23/09 | Les deux écrans de la spec 031 absents ne seront pas construits |
| **Règlement des commissions laissé tel quel** (sans confirmation, mode « espèces ») | Utilisateur, 23/09 | Aucun changement |

Les deux premières sont consignées dans la mémoire du projet pour qu'une session future ne les
défasse pas par zèle.

---

## 7. Décisions encore ouvertes

Aucune ne bloque le parcours. Toutes relèvent de l'établissement ou du modèle, pas d'un
correctif technique évident.

1. **Note de rattrapage repondérée par les devoirs de session 1.** Un 12/20 au rattrapage
   donne 9,60 (`devoirs × 0,4 + examen × 0,6`, avec les devoirs de session 1). L'UE n'est donc
   pas validée. L'étudiant peut rester bloqué par des devoirs qu'il n'a aucun moyen de repasser.
   *C'est la décision la plus lourde de conséquences de cette liste.*
2. **Le statut d'inscription suit les frais d'inscription, pas la scolarité.** Un étudiant peut
   être « Confirmé » sans avoir rien payé si sa classe n'a pas de frais d'inscription. Conforme
   à la décision du 22/09 ; à revoir seulement si la scolarité veut aussi faire dépendre l'accès
   du solde de scolarité.
3. **82 mots de passe sur 155 stockés en clair** (`users.initial_password`). Choix délibéré et
   protégé en lecture par un middleware, mais les dumps de base circulent entre production et
   local, et un dump ne connaît pas ce middleware.
4. **Un sexe absent s'affiche « Masculin ».** La lecture remplace NULL par `masculin` pour
   satisfaire un contrat non nullable. Une donnée manquante devient un fait sur un document
   officiel.
5. **Retard et absence justifiée dans les présences** : le retard ne compte pas en heures
   d'absence mais fait baisser le taux ; l'absence justifiée ne compte pas en heures. Constaté,
   jamais décidé.
6. **Documentation périmée** : `module-professionnel-diplomes-requirements.md` décrit un
   diplôme par matière et par programme ; le code implémente un diplôme par UE et par cycle.

---

## 8. Plan d'implémentation — ce qui reste à faire

Les vingt correctifs sont **déjà dans le code**. Ce qui suit est le travail restant, par ordre de
priorité.

| # | Action | Nature | Pourquoi maintenant |
|---|---|---|---|
| 0 | **Porter le correctif de sécurité du catalogue** sur tout environnement déployé | Sécurité | Écriture anonyme possible dans le catalogue de formations (§1 bis) |
| 1 | **Versionner le code** (réinitialiser un dépôt Git, commiter l'état actuel) | Technique | Vingt-deux correctifs sans historique ni moyen de les relire ou de les annuler un par un |
| 2 | **Appliquer la migration `0127`** sur tout autre environnement que le local | Données | Les classes sans frais d'inscription y ont vraisemblablement le même stock d'inscriptions bloquées |
| 3 | **Redémarrer l'API** après déploiement | Technique | Le rechargement à chaud ne prend pas les changements serveur de façon fiable |
| 4 | Trancher la **décision ouverte n° 1** (rattrapage) | Métier | Elle décide de qui obtient son diplôme |
| 5 | Jouer **S15-S16** (académique) | Test | Jamais joué ; la lecture du code y signale un filtre « BTS » codé en dur qui rend les bulletins impossibles pour tout autre cycle |
| 6 | Jouer **S12-S14** (financier) | Test | S14 est suspect à la lecture : montant affiché codé en dur sur la page de paiement, page de paiement simulé absente |
| 7 | Traiter les décisions ouvertes 2 à 6 | Métier / modèle | Sans urgence |
| 8 | Nettoyer les données de test (§10) | Données | Quand la campagne sera close |

**Nature des déploiements** : les correctifs ① ② ⑥ ⑦ ⑧ ⑭ touchent l'API (redémarrage requis) ;
① exige en plus la migration `0127` ; tous les autres sont purement front.

---

## 9. Ce qui n'a pas été testé

- **Parcours académique classique** (S15-S16).
- **Commissions, rémunération des formateurs, paiement en ligne** (S12-S14).
- **Mode production** : tout a été joué en développement. Les erreurs transitoires et les
  recompilations observées n'y existent pas, mais le build de production n'a pas été vérifié.
- **Écran étroit / mobile** : seul le recouvrement de la colonne des notes a été traité.
- **Deux gestes non automatisables**, faits à la main : l'upload de fichier et les boîtes de
  dialogue natives du navigateur.
- **Plusieurs utilisateurs simultanés**, charge, droits fins par rôle au-delà des cas
  enseignant, étudiant, parent et administrateur.

Deux fragilités d'environnement ont traversé toute la campagne et méritent un ticket à part :
une page qui échoue sur une erreur transitoire **reste figée sur l'erreur** même une fois le
service revenu (rien ne réessaie) ; et un appel à `/api/internal/jobs/claim` échoue en 404
plusieurs fois par minute, en boucle.

---

## 10 bis. Défauts connus, laissés de côté par décision

Constatés en passe 6, **non corrigés** : leur périmètre a été écarté (§1 bis). Ils sont listés
pour ne pas être redécouverts, ni oubliés le jour où ces volets reviendront.

**Tunnel d'inscription public** (`/formations-professionnelles/inscription/*`)
- **Page de paiement codée en dur** : elle affiche `INS-DATA-20250101-001`, « Formation Data
  Science », 150 000 FCFA, pour **tout** identifiant, même inexistant. Le serveur refuse ensuite
  le montant (garde-fou correct) mais en **500** au lieu d'un refus explicite, et l'écran reste
  muet. **Conséquence : toute formation dont le prix n'est pas 150 000 est impossible à payer en
  ligne.** La base, elle, porte les bons montants.
- **Tenant écrit en dur** (`imhotepdata`) dans le tunnel : il ne fonctionne pour aucun autre
  établissement.
- **Confirmation d'inscription en 500** : le code interroge une table `user_profiles` qu'**aucune
  migration ne crée** — du code qui pointe dans le vide, pas une migration oubliée.

**Parcours académique**
- **Modifier une classe d'année supprime en silence ses affectations d'enseignants** (perte de
  données : une affectation de 300 000 FCFA a disparu sans avertissement).
- Les cours d'une classe disparaissent du formulaire d'affectation ; « Ajouter cours » n'a pas de
  gestionnaire de clic.
- Une période est acceptée hors des bornes de son année, alors que l'affectation applique la borne.
- Aucune séance académique ne peut être créée tant que l'année active est échue ; le bouton
  « Nouvelle session » mène à une page inexistante (`/attendance/new`).
- Bulletins : le filtre « BTS » codé en dur est confirmé de fait (le cycle a dû être nommé ainsi).
- Mineurs : codes de matière mutilés par les accents, assiduité comptée en heures, faute
  « abscence », pages de la section Année académique absentes du menu, génération d'attestations
  de classe dépendante de LibreOffice.

---

## 10. Données de test — nettoyées le 23/09/2026

**Toutes les données de la campagne ont été supprimées.** Une recherche du tag `E2E-2209-1` sur
**chaque colonne texte de chaque table** ne trouve plus aucune ligne.

**Méthode.** Sauvegarde complète d'abord, puis répétitions à blanc — transaction annulée à la fin —
jusqu'à obtenir, table par table, la liste exacte de ce qui disparaîtrait. Validation seulement
après contrôle de chaque ligne de ce bilan. Script : `rapports/nettoyage-E2E-2209-1.sql`
(`-v commit=0` pour une répétition à blanc, `-v commit=1` pour l'exécution).

**Contrôles sur les données réelles, après coup** : les 3 inscriptions de l'étudiant réel *Cisse*
sont intactes ; le règlement de commission réel (2 500 FCFA) aussi ; le compte d'*Adjoua Brou*
existe toujours, seules ses affectations aux sessions de test sont parties ; les quatre
signataires réels sont en place ; l'année 2025-2026 a retrouvé ses deux périodes d'origine.

**Seule écriture ajoutée** : deux lignes dans le journal d'audit des affectations
(`teacher_assignments_audit`), trace normale de la suppression de deux affectations de test.

**Fichiers.** Les huit fichiers téléversés pendant les tests (diplômes des six étudiants de test,
rapport de présence, relevé orphelin) n'ont pas été effacés : ils ont été **déplacés** hors des
dossiers de l'application, dans `infra/backups/fichiers-E2E-2209-1/`.

**Pour tout restaurer** :
- base : `pg_restore --clean -d <base> infra/backups/avant-nettoyage-E2E-2209-1.dump` ;
- fichiers : remettre `api-students/*` sous `apps/api/uploads/students/` et `web/*` à leur place
  sous `apps/web/uploads/<tenant>/`.

**Conservé volontairement** : les migrations `0127` et `0035` (correctifs réels, pas des données
de test) et les quatre signataires réels restaurés.

L'inventaire détaillé qui suit est celui des données **au moment de la campagne** ; il n'existe
plus en base.

---

## 10 (historique). Données créées pendant la campagne

Tout porte le tag `E2E-2209-1`, sauf mention.

| Type | Contenu |
|---|---|
| Socle | Cycle, filière, classe `LICENCE 1 TESTOLOGIE E2E-2209-1` (`L1TST01`), 3 UE, 4 ECUE, semestre **clôturé**, salle `SE01` |
| Ouverture | 3 sessions, 3 créneaux d'emploi du temps, 3 séances avec présences |
| Personnes | Enseignante *Awa Formatrice* ; étudiants *Aminata*, *Bakary*, *Chantal*, *Test Genre*, *Test Confirmation* ; parent *Fatou Parente* |
| Scolarité | Inscriptions de ces étudiants ; notes de session 1 et 2 ; conduites ; 3 bulletins |
| Diplômes | `DIP-2026-000001` (Aminata, obtenu), `000002` (Bakary, obtenu), `000003` (Chantal, **révoqué**) |
| Paiements | Aminata : 50 000 puis 200 000 (reçus `REC-PRO-2026-000003` à `000005`) |
| Hors tag | Les deux ECUE de Comptabilité affectées à **Adjoua Brou**, compte de démonstration (effet de bord de la passe 1) ; mots de passe réinitialisés sur les comptes de test |

**Créé en passe 6** : un apprenant public et deux inscriptions au catalogue ; un socle académique complet (cycle `BTS E2E-2209-1`, filière, type de bilan, programme, deux matières, salle, classe d'année, étudiant *Diallo Academique*, inscription, deux affectations d'Awa Formatrice sur août 2026, moyennes, rapport de présence) ; **une période `Semestre 1 E2E-2209-1` ajoutée à la vraie année 2025-2026** ; le commercial *Moussa Commercial*. **Attention** : les deux affectations d'Awa sont de type « vacataire » avec un montant, sur août 2026 — elles entreraient dans une génération de paie d'août 2026.

**Créé en passe 7** : provenances d'Aminata (commercial, 10 %) et de Bakary (connaissance) ; trois règlements de commission (25 000 FCFA, pièces comptables — ne pas les supprimer sans décision) ; validation des trois séances du run au nom d'Adjoua Brou — **annulée ensuite** : les trois séances ont été dévalidées une par une (23/09/2026) pour qu'elles n'entrent pas dans la paie de septembre. Le test reste acquis, la validation ayant été constatée.

⚠️ **Avant toute génération de paie d'août 2026** : les deux affectations vacataires d'Awa Formatrice créées en passe 6 y entreraient. À nettoyer avant.

**Nettoyage** : dans l'ordre inverse de création (paiements et diplômes → inscriptions →
sessions → semestre → ECUE → UE → classe → filière → cycle), sinon les contraintes de clé
étrangère bloquent. **Aucun objet sans le tag ne doit être supprimé** — y compris l'étudiant
réel *Cisse*, dont les inscriptions sont restées en attente à juste titre.

---

*Fichiers de la campagne : `docs/testing/e2e-computer-use/` — protocole, scénarios S01-S16,
prompts des passes 3 à 5, registre de données.*
