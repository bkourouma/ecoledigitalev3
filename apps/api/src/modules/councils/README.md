# Module `councils` — conseils de classe du secondaire

Spec : `specs/v2/006-secondary/` (spec, data-model, plan, open-questions). Schéma Postgres `councils`, migrations `2100`-`2105`.

## Principe

Le module **orchestre, il ne calcule rien**. Les moyennes, le passage, le redoublement, le BEPC et le BAC sont calculés par `results` et `rules`. Le conseil fige un instantané des faits (`council-facts/1`), recueille des propositions et des décisions **humaines**, scelle un procès-verbal (PV) et déclenche des effets idempotents chez les modules voisins par leurs API publiques. Quorum, rôles exigés, signataires, types de décision et parcours d'orientation sont des **données** (tables de référence instanciées depuis le modèle de pack). Aucune règle officielle ivoirienne n'est inventée : le modèle livré (`templates/CI/secondary.json`) contient le mécanisme et des paramètres vides ou marqués `isPlaceholder`; l'écran affiche « règles de démonstration » tant que le tenant n'a pas validé les siens.

## Tables (schéma `councils`)

- Référence : `participant_roles`, `council_types`, `decision_types` (+ `student_status`, migration 2105), `settings`.
- Séances : `councils`, `council_participants`, `agenda_items` (instantané figé), `proposals`, `decisions`, `council_events` (journal), `effects`.
- PV : `minutes` (versions, scellement), `minutes_signatures`, `unlock_requests`.
- Orientation : `orientation_paths`, `orientation_files`, `series_transfers`.
- RLS sur toutes les tables, gardes de cohérence en SQL (`2104_councils_guards.sql`).

## Routes (`/api/v1/councils`)

Référence et réglages (`/reference`, `/participant-roles`, `/council-types`, `/decision-types`, `/settings`), séances (`/councils`, `/:id/prepare|convoke|open|close|cancel|reopen`), participants et présences, ordre du jour (`/agenda/:itemId`, rebuild, review), propositions et décisions (`/proposals/:id/*`, `/decisions/:id/withdraw`), PV (`/councils/:id/minutes`, `/minutes/:id/pdf|sign|signatures/paper|revoke`), déverrouillage motivé (`/unlock-requests`), effets (`/effects`, retry, apply, skip, revert), orientation (`/orientation-paths`, `/orientation-files`, `/series-transfers`), vues portail (`/me/decisions`, `/children/:studentId/decisions`), synthèse de classe.

## Permissions (`manifest.ts`)

`council.read`, `.manage`, `.prepare`, `.session.run`, `.proposal.write`, `.decision.record`, `.minutes.generate|read|sign|revoke`, `.unlock.request|approve`, `.effect.manage`, `.exclusion.apply`, `.settings.manage`, `.orientation.read|manage|override`, `.self.read`, `.child.read`. Les gardes sont dans `http/guards.ts` ; l'accès aux données (périmètre enseignant, tutelle) est revérifié côté serveur à chaque requête.

## Événements

Publiés : `councils.council.{created,convoked,opened,closed,signed,reopened,cancelled,review_needed}`, `councils.quorum.waived`, `councils.decision.{recorded,withdrawn}`, `councils.minutes.{generated,rendered,signed,superseded,revoked}`, `councils.unlock.{requested,approved,rejected}`, `councils.effect.{applied,failed,reverted,awaiting_human}`, `councils.orientation.file_decided`, `councils.series_transfer.{planned,applied,cancelled}`. Consommés : `tenancy.institution.created`, `results.period.reopened`, `reportcards.official_document.rendered`. Schémas Zod : `packages/contracts/src/v2/councils.ts`.

## Abonnés et jobs

Abonnés : `councils.instantiate-reference-data`, `councils.render-minutes`, `councils.on-minutes-rendered`, `councils.revert-on-results-reopened`. Jobs : `councils.apply-effects` (30 s, rejoue les effets PENDING/FAILED chacun dans sa transaction, sous l'identité de l'humain qui a décidé), `councils.expire-unlock-requests` (05:40).

## Ports (adaptateurs dans `apps/api/src/platform/adapters/*-councils.ts`)

`academic`, `outcomes`, `resultsRead`, `resultsWrite`, `ruleCodes`, `attendance`, `schoollife`, `staff`, `family`, `studentStatus`, `notifications`, `documents`, `storage`, `templates`. Sans adaptateur : échec fermé `councils.port_unavailable` (409). Câblage dans `PlatformPorts.councils` (API et worker).

## Décisions de conception

- Effets appliqués dans la transaction du conseil avec savepoints ; les effets d'exclusion (tout effet non NOTIFY d'un type qui exige un humain) restent `AWAITING_HUMAN` jusqu'à un acte humain.
- Décisions de résultats et distinctions : retirées uniquement par l'abonné `results.period.reopened` (voir demandes ci-dessous).
- Un transfert de série devient irréversible une fois appliqué ; visibilité tuteur « après notification » = effet NOTIFY appliqué.
- Conseil de portée ANNÉE : état de la dernière période d'enseignement ; un conseil de PÉRIODE ne peut pas utiliser un type PASSAGE (portée ANNÉE).
- Rôles d'affectation : HOMEROOM -> professeur principal, LEAD et CO_TEACHER -> enseignant.
- `decisionRef` d'une issue académique est toujours un UUID (décision ou transfert).
- `evaluateCouncilQuorum` n'est pas utilisé : `secondary-annual@1` n'a pas de règle `quorum_conseil`; le quorum est une donnée (`check_quorum`).

## Demandes de changement aux modules voisins (non faites ici)

1. **rbac** : retirer les clés `council.*` de la liste des permissions réservées et attribuer aux rôles système les permissions du manifeste (direction : tout sauf `.proposal.write`; censeur/principal : `.manage`, `.prepare`, `.session.run`, `.decision.record`, `.minutes.*`; professeur principal : `.read`, `.proposal.write`; enseignant : `.read` limité par périmètre; élève `.self.read`; parent `.child.read`).
2. **results** : exposer un retrait de décision/distinction (aujourd'hui seule la réouverture de période les retire).
3. **rules** : table `label_map` des codes d'appréciation pour libeller les propositions.
4. **academic** : marquer une issue d'inscription comme irréversible après la rentrée de l'année suivante.
5. **reportcards** : réédition du PV à l'écoute de `councils.council.reopened`.
6. **web** : sélecteur de participant externe (`personId`), formulaire de vœux et consentement tuteur (routes API prêtes : `/orientation-files/:id/wishes|consent`).

## Points à arbitrer

- Règles officielles (MGA, passage, redoublement, BEPC, BAC) : à saisir par un expert métier; rien n'est livré en dur.
- Identité de l'humain pour le rejeu des effets : décision d'architecture (la transaction ne permet pas de changer d'identité); à confirmer.
- Gabarit du PV : mise en page officielle à fournir.

## Tests

`apps/api/src/modules/councils/test` (DDL, cycle de vie, séance, effets, isolation, portails, rendu du PV, HTTP, unitaires) et `apps/api/test/adapters/councils.integration.test.ts`. Intégration avec `TEST_DATABASE_URL`.
