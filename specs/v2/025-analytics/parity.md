# Parité avec l'espace propriétaire legacy — 025-analytics

Référence : `docs/guide-utilisateur-espace-proprietaire-owner.md` (menus), `docs/statistiques-owner-requirements.md` (écrans de statistiques), `apps/api/src/routes/owner/index.ts` (endpoints) et `apps/web/src/app/owner/*` (pages). Légende : **✅** couvert · **◐** partiel (écart dit) · **❌** manque (raison) · **⏭** hors périmètre de 025 (autre module ou action, pas un indicateur).

Principes de lecture : le legacy lit directement les tables de l'application (module Professionnel `professional_*`, `payment_transactions`…) et embarque ses règles (seuil 10/20, pondérations 0,4/0,6, validation de semestre, « Conduite » par `ILIKE`). La v2 ne reprend **aucune** de ces règles dans `analytics` : elles sont dans `rules` / `results` / `finance`, et `analytics` lit leurs sorties. Les divergences ci-dessous sont donc des écarts de **source**, pas de calcul.

## 1. Menus du guide utilisateur

| Menu legacy | Écran v2 | État | Écart |
|---|---|---|---|
| Pilotage | `/v2/direction` | ✅ | cartes effectifs, présence du jour, moyenne générale, enseignants présents, scolarité recouvrée, créances ; état en toutes lettres ; `asOf` |
| Finances | `/v2/owner/scolarite` + `/v2/owner/tresorerie` | ✅ | recouvrement, impayés, courbe, créances âgées, caisse |
| Rapport financier (CSV / PDF) | boutons « Exporter (CSV) » de chaque écran | ◐ | CSV seulement (BOM, `;`) ; **PDF non repris** |
| Académique | `/v2/owner/pedagogie` | ✅ | moyennes par classe et par période, réussite, assiduité (voir `/v2/direction/effectifs`) |
| RH (enseignants, heures, paies en attente) | `/v2/owner/pedagogie` (charge d'enseignement) + `/v2/owner/paie` | ◐ | heures **prévues** et contractuelles ; pas d'heures **validées**, ni de « cours sans titulaire », ni de liste de paies en attente de validation |
| Formations | — | ⏭ | module de formations courtes supprimé du périmètre v2 (Imhotep, décision D7) |
| Alertes (acquitter) | — | ❌ | pas d'alertes propriétaire en v2 ; les alertes d'assiduité restent dans `attendance` |
| Accès (rôles) | — | ⏭ | écrans `rbac` / `iam` |

## 2. Endpoints `/api/v1/owner/*`

| Legacy | v2 (`/api/v1/analytics/*`) | État | Écart |
|---|---|---|---|
| `GET /pulse` | `overview` + `finance/summary` | ✅ | KPI du pouls : effectif, présence, résultats, enseignants, recouvrement, créances ; **comparaison à la période précédente non reprise** ; statuts via seuils d'affichage réglables (`settings`) |
| `GET /scolarite` | `finance/summary`, `finance/receivables?by=class` | ◐ | facturé / encaissé / reste par classe ✅ ; **barème, « trous de facturation », écart commandé/dû, entonnoir demande→paiement non repris** (nécessitent un port de lecture des barèmes de finance) |
| `GET /tresorerie` | `treasury/collections`, `treasury/aged` | ◐ | courbe d'encaissements (jour / semaine / mois) ✅, balance âgée par apprenant ✅ ; **répartition par mode de règlement, délai de paiement par classe, anomalies de caisse détaillées non reprises** (le reporting de finance ne les expose pas) |
| `GET /tresorerie/journal` (caisse) | `treasury/cash` | ◐ | sessions : fonds, attendu, compté, écart ✅ ; **journal des mouvements par session non repris** |
| `GET /finances`, `/finances/professionnel` (+ export) | `finance/summary`, `finance/receivables`, export CSV | ◐ | recouvrement et impayés ✅ ; **CA par UE, entonnoir d'inscriptions UE, filtre par semestre / mode / état de règlement non repris** (le modèle UE/ECUE « professionnel » est remplacé par le cœur académique v2) |
| `GET /academic`, `/pedagogie` (+ export) | `pedagogy/results` (+ export CSV) | ✅ / ◐ | ✅ moyenne générale, taux de validation, décisions, distribution des moyennes, matières à faible validation, poids de la session 2, UE (niveau `UE`) ; ◐ pas de « Top 15 ECUE échouées » trié côté serveur (le tableau est triable côté écran), **pas de rattrapages détaillés ni d'état des bulletins** |
| `GET /assiduite` (+ export) | `attendance`, `pedagogy/teaching-load` (+ exports) | ◐ | taux de présence global, par jour, par classe ✅ ; **top des étudiants les plus absents (nominatif), occupation des salles, charge hebdomadaire planifiée, séances sans enseignant non repris** (scheduling : pas de port agrégé) |
| `GET /personnes` (+ export) | `enrollment` | ◐ | sexe, niveau, financement, campus, classe, redoublants ✅ ; **pyramide des âges, nationalités, contrats d'enseignants, couverture parents/comptes non repris** (champs sensibles de `people` non exposés en agrégat) |
| `GET /recrutement` (+ export) | `enrollment` (entonnoir d'admission) | ◐ | inscriptions créées → confirmées → annulées par source ✅ ; **demandes en ligne (en attente / rejetées, délai de traitement, motifs de rejet) non repris** : pas de source v2 |
| `GET /prospection` (+ export) | — | ⏭ | CRM commercial : hors 025 |
| `GET /economie` | `charges` | ❌ | **aucun module de charges / comptabilité en v2** : l'API et l'écran déclarent le manque (`MODULE_MISSING`) ; marges par filière, rétention, compte de résultat non mesurés |
| `GET/POST/PATCH/DELETE /charges*`, `/charges/categories`, `/charges/cohortes` | — | ❌ | saisie des charges : même manque (module à créer, specs 014/015) |
| `GET /risque` | — | ❌ | signaux d'élèves/enseignants « à risque » (nominatifs, croisés) : hors 025 v1 (données personnelles ; à reprendre avec les alertes) |
| `GET /remplissage` | `enrollment` (effectif par classe) | ◐ | effectifs par classe ✅ ; **taux de remplissage vs capacité, cohortes, conflits de planning, couverture non repris** (capacité non lue) |
| `GET /programme` | — | ❌ | statistiques cycles / filières / matières : à reprendre depuis `academic` (curriculum) |
| `GET /referentiel` | — | ❌ | « santé du catalogue » (UE sans ECUE, crédits incohérents…) : ces anomalies du modèle professionnel n'existent plus par construction (validation du curriculum d'`academic`) |
| `GET /documents` | — | ⏭ | documents (bulletins, pièces) : module `reportcards` |
| `GET /payroll`, `/staff` | `payroll/mass` (+ export) | ◐ | masse par période et statut (calculés + arrêtés + payés ; annulés et contestés à part) ✅ ; **par enseignant, cours sans titulaire non repris** |
| `PATCH /payroll/:id/validate` | — | ⏭ | action de validation : reste dans `payroll` (seuil propriétaire, quatre yeux) |
| `GET /stats/filters` | `scopes` | ✅ | établissements, campus, années, périodes, classes (année scolaire = **table `academic`**, plus dérivée d'un pivot de septembre) |
| `GET /reports/financial` | `export/<jeu>.csv` | ◐ | CSV audité par jeu de données ; PDF non repris |
| `GET /roles/assignable`, `/users`, `PATCH /users/:id/roles` | — | ⏭ | `rbac` / `iam` |
| `GET /alerts`, `PATCH /alerts/:id/acknowledge`, `GET /dashboard`, `/finances`, `/academic`, `/staff`, `/formations` (spec 027) | — | ◐ / ⏭ | tableaux de synthèse repris par `overview` ; alertes et formations : voir §1 |

## 3. Pages web legacy `apps/web/src/app/owner/*`

| Page legacy | Page v2 | État |
|---|---|---|
| `dashboard`, `page` | `/v2/direction`, `/v2/owner` | ✅ |
| `pedagogie` (+ `ResultatsScolaire`, `ResultatsProfessionnel`, `Rattrapages`, `Bulletins`) | `/v2/owner/pedagogie` | ◐ (rattrapages détaillés et état des bulletins non repris) |
| `scolarite` | `/v2/owner/scolarite` | ◐ (barème et trous de facturation non repris) |
| `finances`, `finances/tresorerie`, `finances/professionnel`, `finances/rapport` | `/v2/owner/tresorerie`, `/v2/owner/scolarite` | ◐ |
| `economie` (+ `SaisieCharges`) | `/v2/owner/charges` | ❌ (manque déclaré) |
| `remuneration` (`MasseSalariale`, `Configuration`) | `/v2/owner/paie` | ◐ (la configuration de paie reste dans `payroll`) |
| `assiduite` (`Presences`, `Conduite`) | `/v2/direction/effectifs` | ◐ (la conduite est une UE de `results`, vue dans la pédagogie) |
| `personnes`, `recrutement`, `remplissage` | `/v2/direction/effectifs` | ◐ |
| `academique`, `programme`, `referentiel`, `structure`, `ouvertures` | — | ❌ / ⏭ |
| `risque`, `prospection`, `documents`, `staff`, `acces` | — | ❌ / ⏭ |

## 4. Règles legacy NON reprises (et pourquoi)

| Règle legacy | Traitement v2 |
|---|---|
| Seuil de validation 10, élimination 5, poids 0,4/0,6, validation de semestre à 20 crédits | dans `rules` (jeux `CI-HIGHER-*`) ; `analytics` lit `validated` du FINAL. Décision métier du 2026-10-01 : un semestre est validé si **toutes** les UE le sont |
| « Conduite » détectée par `ILIKE 'conduite%'` | donnée du curriculum (`gradingMode DIRECT`, nœud transversal) ; aucune heuristique textuelle |
| Mentions (`<10 Insuffisant`…) calculées au front | `mention_code` produit par `results` ; non recalculé |
| Année scolaire dérivée par pivot de septembre | années réelles d'`academic` (`dim_year`) |
| `payment_transactions` / `professional_payments.statut = 'confirme'` | `finance.payments` (`CONFIRMED`) via les rapports de finance ; l'encaissé ne se lit **jamais** sur le statut d'une commande |
| Effets de bord de lecture (clôture des sessions, réécriture des matricules) | aucune lecture d'`analytics` n'écrit dans une source |
| Seuils de feux 85/70 et 80/60 % | valeurs d'affichage par défaut, réglables par établissement |

## 5. Preuve de parité

- Chaque agrégat v2 est comparé à son calcul direct sur la source (`test/refresh.integration.test.ts` sur une année simulée ; `test/adapters/analytics.integration.test.ts` sur les vrais modules avec les règles nationales).
- Les scénarios de caractérisation (`tests/characterization/scenarios`) sont rejoués par `results` (`test/parity`) : les moyennes, rangs et décisions que lit `analytics` sont **ceux** dont la parité avec le legacy est déjà établie.
