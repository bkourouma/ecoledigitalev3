# Module `higher` — enseignement supérieur (spec v2/019)

Registre de crédits (capitalisation), prérequis entre UE, rattrapage (session 2), diplômes rattachés à un nœud de cycle,
octrois (automatique, manuel, forcé), révocation et ré-octroi exceptionnel, documents officiels (**données** immuables),
signataires à emplacements **datés**, compteurs de numérotation sans trou, dettes d'UE.

- Pack `HIGHER`, schéma Postgres `higher`, migrations **1400-1409**, préfixe d'API `/api/v1/higher`.
- `dependsOn: ["rbac", "rules"]` : `requirePermission` (rbac) et l'API d'évaluation de règles `app.rules` (rules). Curriculum,
  inscriptions, étudiants, résultats et signataires sont des **UUID sans clé étrangère**, lus par des **ports**.
- **Aucune formule ni seuil réglementaire** : l'éligibilité au diplôme, la moyenne de cycle, la mention et l'état d'UE sont des
  règles du contrat `credit-semester@1` (`diplome_eligible`, `moyenne_annuelle`, `mention_diplome`, `etat_ue`). Le module construit
  le contexte (dédoublonnage par UE, crédits **figés** du registre), délègue, et fige les sorties dans l'octroi (version de règle,
  empreintes). Un test d'architecture interdit un seuil littéral et l'import du moteur.

## Ce que le module ne fait pas

| Sujet | Où |
|---|---|
| Calcul des notes, validation d'une UE, état LMD, session retenue (la session 2 **remplace** la session 1, décision 2026-10-01) | `results` / `rules` |
| PDF, scellement (signature), QR, page de vérification publique | `reportcards` (013) — lit le snapshot, renseigne `recordDocumentSeal` / `recordDocumentRender` |
| Structure du curriculum, inscriptions, classes | `academic` (004) |
| Frais de rattrapage | 014 (événement `higher.resit.registered`) |

## Modèle de données (13 tables, toutes `tenant_id` + RLS forcée, allowlist vide)

| Table | Rôle | Invariants en base |
|---|---|---|
| `settings` | durée de validité des crédits (`credit_validity_months`, NULL = sans limite) | |
| `diploma_definitions`, `diploma_requirements` | diplômes (`curriculum_node_id`, `grade_code` en donnée) et exigences | code unique par tenant ; `uv_required > 0` ; suppression refusée s'il existe un octroi |
| `credit_ledger` | acquisitions : **une seule `ACQUIRED` par (étudiant, UE)** ; `ACQUIRED -> REVOKED \| EXPIRED` | contenu immuable, jamais supprimé ; révocation refusée si un octroi non révoqué s'appuie dessus (`higher.credit_in_use`) |
| `ue_debts` | UE non validée en état `DEBT` (levée à l'acquisition) | une dette ouverte par (étudiant, UE) |
| `ue_prerequisites` | graphe de prérequis | déclencheur différé anti-cycle (parcours borné à 200) |
| `resit_windows`, `resit_registrations` | fenêtres et inscriptions de rattrapage | une fenêtre ouverte par classe × période ; une inscription par (inscription, ECUE, période) |
| `number_counters` + `higher.next_number()` | `DIPLOMA`, `AUTHENTICITY`, `ATTESTATION` par année (année `0` = séquence continue d'un motif sans année) | ne recule jamais, jamais supprimé ; n'avance que de 1 **sauf si l'établissement a désactivé « sans trou »** (1409) ; **dans la transaction de l'octroi : une annulation ne consomme pas de numéro** |
| `numbering_settings` (1409) | motif de numérotation et réglage « sans trou » par nature de document et par établissement (Q-24) | RLS ; absence de ligne = motif historique + sans trou |
| `diploma_awards` | octrois : snapshot des exigences, sorties de règles, version de règle | un seul `OBTAINED` par (définition, étudiant) ; révocation terminale et motivée (≥ 10 car.) ; forcé motivé (≥ 20) ; contenu figé ; ré-octroi exige prédécesseur + décision écrite |
| `official_documents` | snapshots immuables `diploma/1`, `attestation-success/1`, `attestation-authenticity/1` + SHA-256 + code de vérification | immuable hors statut / scellement (une fois) / rendu / publication / révocation ; la révocation d'un octroi révoque ses documents (déclencheur) |
| `official_document_slots` | emplacements `DIPLOMA_LEFT`, `DIPLOMA_RIGHT`, `ATTESTATION_SUCCESS`, `AUTHENTICITY` → signataire, avec dates | `EXCLUDE` anti-chevauchement ; historique conservé (clôture, jamais de suppression) |

## Ports (enregistrés par `registerHigherPorts(app, ports)` ; `registerHigherWorkerPorts(ports)` pour le worker)

| Port | Fournisseur | Rôle |
|---|---|---|
| `CreditsSourcePort` | `results` (011) | lignes d'UE `FINAL` publiées (validée, état, session, jury, crédits figés) et candidats au rattrapage — **jamais recalculés ici** |
| `ResitSessionPort` | `results` / `assess` | déverrouille la **seule** session 2 de la période (et la reverrouille) |
| `CycleResultsPort` | `results` | moyennes de semestre FINAL du cycle (`complete: false` ⇒ mention `PENDING`) |
| `CurriculumPort`, `EnrollmentDirectory` | `academic` (004) | UE d'un cycle / programme (crédits, programme d'appartenance), inscriptions du cycle, dernière inscription (année du diplôme) |
| `StudentDirectory`, `ActorDirectory` | `people` (008) | identité d'impression, compte ↔ étudiant, tutelle, nom d'affichage |
| `SignatoryDirectory`, `InstitutionPort` | `reportcards` (013) | signataires (nom, qualité, fonction, actif) et identité de l'établissement |
| `DiplomaRulesPort` | `rules` | `createRulesAdapter(() => app.rules)` : branché par défaut sur le module rules ; sans jeu de règles actif ⇒ `rules.no_active_ruleset` (aucune valeur implicite) |

Un port non branché **échoue fermé** (`higher.port_unavailable`). Les implémentations mémoire (`inMemoryPorts()`) servent aux tests ;
`ScriptedRules` ne contient aucune formule (le test lui dicte ses décisions).

## API publique (`index.ts`)

`checkPrerequisites`, `getCreditSummary`, `listDebts`, `listAcquiredUe` (004, 013, 025) ; cas d'usage `capitalizePeriod`,
`awardDiploma`, `revokeAward`, `issueAwardDocument`, `issueSuccessAttestation`, `openResitWindow`… ; lecture d'un document
(`getDocument`) et écriture du scellement / rendu (`recordDocumentSeal`, `recordDocumentRender`) pour 013.

## Routes (`/api/v1/higher`)

| Domaine | Routes | Permission |
|---|---|---|
| Diplômes | `GET\|POST /diplomas`, `POST /diplomas/from-curriculum`, `GET\|PATCH\|DELETE /diplomas/:id`, `GET\|PUT /diplomas/:id/requirements`, `POST /diplomas/:id/sync`, `GET /diplomas/:id/candidates`, `GET /diplomas/:id/students/:studentId/progress` | `higher.diploma.read` / `.manage` |
| Octrois | `GET /diplomas/:id/awarded`, `GET /awards/:id`, `POST /diplomas/:id/awards`, `POST /diplomas/:id/recompute`, `POST /awards/:id/revoke` | `higher.award.read` / `.create` / `.force` / `.revoke` |
| Documents | `POST /awards/:id/documents`, `GET /attestations/roster`, `POST /attestations`, `GET /documents`, `GET /documents/:id`, `POST /documents/:id/publish\|revoke`, `GET\|PUT /document-slots` | `higher.document.issue` / `.read`, `higher.slot.manage` |
| Crédits | `GET /students/:id/credits\|diplomas\|pathway\|prerequisites-check` | `higher.credits.read` / `.diploma.read`, ou soi-même / tuteur lié |
| Prérequis | `GET\|PUT /ue/:nodeId/prerequisites` | `higher.prerequisite.manage` |
| Rattrapage | `GET\|POST /resit-windows`, `GET /resit-windows/:id`, `POST /resit-windows/:id/close`, `GET /resit-candidates` | `higher.resit.manage` |
| Étudiant / tuteur | `GET /me/credits\|pathway\|diplomas\|resits\|documents`, `GET /children/:studentId/…` | `higher.self.read` / `higher.child.read` (+ tutelle vérifiée) |
| Réglages | `GET\|PUT /settings` | `higher.settings.manage` |
| Numérotation libre (Q-24) | `GET /numbering`, `PUT /numbering/:counterKey` (`DIPLOMA`, `AUTHENTICITY`, `ATTESTATION`), `POST /numbering/:counterKey/advance` | `higher.settings.manage` |

Features (`requireFeature`) : `higher.diplomas`, `higher.session2`, `higher.prerequisites`, `higher.attestations`.
L'enseignant n'a **aucune** permission `higher.*` ; un document inconnu ou d'autrui répond 403 (pas d'énumération).

## Événements publiés (payload `{ v: 1, … }`, schémas Zod dans `packages/contracts/src/v2/higher.ts`)

`higher.credits.capitalized`, `.credits.revoked`, `.credits.expired`, `.credits.revocation_blocked`, `higher.ue.debt_detected`,
`higher.resit.window_opened|window_closed|registered`, `higher.diploma.eligible|awarded|revoked`, `higher.document.issued`.

Consommés : `results.period.closed` (capitalisation, dettes, issue des rattrapages) et `higher.credits.capitalized` (éligibilité).
**Deux abonnés distincts, deux transactions** : la panne de l'évaluation d'éligibilité ne touche jamais la capitalisation et se
rejoue (R-HIG-10).

## Audit (`runtime.auditPort`, même transaction, en dernier)

`higher.award.created|forced|revoked` (sensible), `higher.document.issued|published|revoked` (sensible), `higher.slot.assigned`
(sensible), `higher.diploma.created|updated|deleted|synced|requirements_replaced`, `higher.prerequisite.set`,
`higher.resit_window.opened|closed|cancelled`, `higher.ledger.capitalized|expired`, `higher.settings.updated`, `higher.numbering.updated|advanced` (sensibles). Mapping vers
`audit.record` : `higher/infrastructure/audit-adapter.ts` (`sensitive` ⇒ sévérité `notice`).

## Jobs

`higher.expire-credits` (03:20) : passe `EXPIRED` les acquisitions périmées (réglage `credit_validity_months`), épargne celles d'un
diplôme octroyé.

## Numérotation libre par établissement (Q-24)

Décision du propriétaire : l'établissement choisit le **motif** de ses références (préfixe, année, séquence) ; la garantie « sans trou » devient un **réglage**.

- **Motif** : texte fixe (`A-Z a-z 0-9 . _ / # -`) + au plus un jalon d'année `{YYYY}` / `{YY}` + **exactement un** jalon de séquence `{SEQ}` / `{SEQ:n}` (largeur 1 à 9). Exemples : `DIP-{YYYY}-{SEQ:6}` (défaut livré, = format historique), `UNI/{YY}-D{SEQ:4}`, `CERT{SEQ:5}`. Un motif ne peut pas se terminer par `/D<chiffres>` (suffixe des duplicata) ni être identique à celui d'une autre nature.
- **Défaut** : sans ligne `numbering_settings`, les trois formats historiques (`DIP-AAAA-NNNNNN`, `AUTH/AAAA/NNN`, `ATT-AAAA-NNNNNN`) et la garantie sans trou s'appliquent : **aucun changement pour un établissement qui ne touche à rien**.
- **Unicité (contrainte, pas convention)** : `UNIQUE (tenant, référence)` sur les octrois, `UNIQUE (tenant, nature, référence)` sur les documents, `UNIQUE (tenant, année, séquence)` sur les octrois ; la référence émise est immuable (1408) ; le numéro vient du compteur transactionnel (verrou de ligne jusqu'au COMMIT). Un motif **sans année** utilise une **séquence continue** (compteur d'année 0) pour ne pas repartir à 1 chaque janvier.
- **Changer de motif** ne vaut que pour les documents **futurs** ; les références déjà émises ne bougent jamais. Réglage sensible : audit `higher.numbering.updated` (avant / après).
- **« Sans trou » (compromis documenté)** : *activé* (défaut, y compris pour les trois natures déjà livrées) : le compteur n'avance que de 1, l'API d'avance est refusée (`higher.numbering_gapless`, 409) et le déclencheur de la base refuse tout saut. *Désactivé* : l'établissement peut **avancer** le compteur (`POST /numbering/:key/advance`, motif ≥ 10 caractères, audit sensible `higher.numbering.advanced`) pour reprendre un registre papier ou réserver des numéros ; les trous ainsi créés sont **voulus et tracés**. Dans les deux cas, un compteur ne **recule** jamais, et une transaction annulée ne consomme aucun numéro.
- Permission : `higher.settings.manage` (existante). Aucun événement nouveau.

## Décisions de conception à connaître

- **Doublon et unicité** : l'insertion au registre est idempotente (`ON CONFLICT … DO NOTHING`) ; rejouer un événement n'ajoute ni
  écriture ni événement.
- **Reclôture** : une UE devenue non validée révoque l'écriture issue de la version précédente, **sauf** si un diplôme octroyé s'appuie
  dessus — l'opération est alors bloquée et signalée (`higher.credits.revocation_blocked`) ; la révocation du diplôme est un acte
  distinct (jamais automatique).
- **Durée de validité** : paramètre d'établissement ; une acquisition périmée ne compte plus (prérequis, éligibilité) et est remplacée à
  la recapitalisation.
- **Exigence retirée du curriculum** : plus exigée pour qui ne l'a pas acquise, comptée pour qui l'a acquise (« l'écriture reste »).
- **Date d'obtention** = date de la dernière acquisition nécessaire (jamais « aujourd'hui »), nullable seulement pour un octroi forcé
  sans acquisition ; **année académique** = dernière inscription du cycle.
- **Mention** : `PENDING` si un semestre du cycle n'a pas de résultat FINAL — l'octroi **automatique** attend ; le manuel et le forcé
  s'enregistrent avec la mention `PENDING`.
- **Ré-octroi** (Q-22) : interdit en automatique ; en manuel il exige la permission `higher.award.force`, une décision écrite
  référencée (≥ 20 car.) et le lien vers l'octroi révoqué.
- **Duplicata** d'un diplôme : nouvelle émission liée (`/D1`…), l'original passe `SUPERSEDED` ; l'attestation d'authenticité est
  idempotente (un numéro `AUTH/AAAA/NNN` par octroi).

## Tests

```bash
pnpm exec vitest run --config apps/api/src/modules/higher/vitest.config.ts            # unitaires (l'intégration s'ignore sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/higher/vitest.config.ts
pnpm test:isolation
```

Intégration (Postgres réel) : capitalisation (idempotence, reclôture, validité, 100 étudiants), octrois (auto / manuel / forcé /
révocation / ré-octroi, **1 000 octrois concurrents sans trou**), documents (signataires datés, immuabilité, authenticité),
prérequis et rattrapage bout en bout, isolation A/B des 12 tables et invariants SQL, **règles réelles** (table de vérité ≥ 30 cas de
`evaluateDiplomaEligibility`, mentions 10/12/14/16/18), API HTTP via le registre de modules, scénarios de caractérisation
BTS / LMD.
