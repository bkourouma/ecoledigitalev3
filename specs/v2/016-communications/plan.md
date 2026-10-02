# Plan d'implémentation — communications : messagerie interne et annonces (016)

**Spec** : `spec.md` · **Modèle** : `data-model.md` · **Parité** : `parity.md` · **Décisions à arbitrer** : `open-questions.md`

## 1. Résumé

Module backend `messaging` (schéma Postgres `messaging`, migrations `1600-1699`), contrats `packages/contracts/src/v2/messaging.ts`, adaptateurs `platform/adapters/{people,academic}-messaging.ts`, écrans `/v2/messages/*` et `/v2/announcements/*`, cloche de notifications. Pack : PRIMARY, SECONDARY, HIGHER, VIRTUAL. Aucune dépendance de manifeste (`dependsOn: []`).

## 2. Architecture

```
http/plugin.ts ──▶ application/*.ts ──▶ domain/*.ts (pur)      infrastructure/*-repository.ts (SQL, Tx)
   gardes RBAC         cas d'usage          policy, annonces,           in-memory-ports.ts (tests)
   limiteur HTTP       (deps, ctx, input)   texte, magic-bytes          audit-adapter.ts
                          │
                          ├── ports.ts : PeopleDirectory · AudienceDirectory · StoragePort · AuditPort · NotificationChannel (contrat)
                          └── port-registry.ts : app.messagingPorts (API) · setMessagingWorkerPorts (worker)

platform/adapters : people-messaging.ts (people + academic + rbac + iam) · academic-messaging.ts (audiences) · storage.ts
subscribers.ts : attendance.absence.recorded / late.recorded -> messages système      jobs.ts : annonces programmées · purge
```

- **Autorisation** : `domain/policy.ts` (fonctions pures, 24 tests) ; les capacités RBAC sont lues par `http/guards.ts` (`capsFor`) ; les profils et liens viennent des ports.
- **Transaction unique par cas d'usage** : écriture -> notifications -> événements d'outbox -> audit (en dernier). Un échec métier annule tout (`inTx`).
- **Diffusions** : insertions par lots (`unnest`), une requête par table, jamais une par destinataire.
- **Aucune FK inter-schémas** ; clés composites `(tenant_id, id)` entre nos tables.

## 3. Lots (tous livrés)

| Lot | Contenu | Preuve |
|---|---|---|
| L1 | Spec, contrats, migration `1600`, domaine pur, cas d'usage, HTTP, abonnés, jobs, lectures d'audience dans `people` | `test/unit/*` (56), `type-check:v2`, `check:boundaries`, catalogue d'événements, contrats d'événements |
| L2 | Intégration réelle : RLS A/B (toutes les tables avec vraies données), matrice parent / enseignant / élève / administration, diffusions, pièces jointes, annonces, notifications, modération, quotas, messages système, atomicité | `test/integration/messaging.integration.test.ts` (66) |
| L3 | HTTP réel par rôle (gardes simulées), erreurs stables, 429 | `test/integration/http.integration.test.ts` (12) |
| L4 | Adaptateurs réels people + academic + rbac, assemblage sur Postgres migré par tous les modules | `apps/api/test/adapters/messaging.integration.test.ts` (14) |
| L5 | Écrans web, client typé, i18n `v2Messaging*`, cloche | tests Vitest / RTL |
| L6 | Documentation (README du module, `platform-assembly.md`, ce dossier), reconstruction du worker | gates |

## 4. Extensions additives des autres modules

| Module | Extension | Raison |
|---|---|---|
| people | `application/audience.ts` + `infrastructure/audience-repo.ts` : `listAudienceOfStudents`, `searchAudienceIdentities` (lectures seules, aucune coordonnée) | le DTO des tuteurs ne porte pas l'identité du compte ; la messagerie en a besoin pour joindre les tuteurs d'une classe |
| plateforme | `apps/api/test/events-catalog.test.ts` : verbe irrégulier `sent` ; `apps/api/test/events-contracts/messaging.contracts.ts` | nom d'événement `messaging.message.sent` demandé par la spec ; contrat des événements consommés |
| rbac | **aucune** — demande consignée (Q-01) | périmètre |

## 5. Risques et parades

| Risque | Parade |
|---|---|
| Divulgation de l'existence d'un compte | refus identique « destinataire non autorisé » pour un compte inconnu, inactif ou interdit (hors `send.any`) |
| Inondation de la boîte de l'expéditeur par une diffusion | fils de l'expéditeur archivés à la création, désarchivés par la première réponse ; « envoyés » regroupe par diffusion |
| Spam | quotas en base (comptés par envoi, une diffusion = 1) + limiteur HTTP (Redis si configuré) + restriction par la modération |
| Fuite de contenu par événements / audit / notifications | aucun texte de message dans les payloads, les métadonnées d'audit ni les notifications (objet seulement) |
| Pièce déguisée | type réel sur les octets, types et taille paramétrables, nom assaini, stockage objet, URL signées courtes |
| Annonce vers une audience énorme | plafond `max_broadcast_participants`, `recipients_truncated`, aperçu de l'audience avant publication |
| Worker sans port | abonnés et jobs échouent FERMÉ ; la purge des pièces ne supprime la ligne que si l'objet est supprimé |

## 6. Déploiement

1. `pnpm db:v2:migrate` (migration `1600_messaging_init.sql` ; extensions `unaccent` et `pg_trgm` déjà requises par people).
2. `pnpm --filter @ecoledigitale/worker build` (abonnés et jobs embarqués).
3. Rôles : appliquer la PR rbac (Q-01), sinon accorder `messaging.read` / `messaging.send` à des rôles personnalisés.
4. Variables : aucune nouvelle ; le stockage d'objets est celui de `STORAGE_*`. Redis (`REDIS_URL`) recommandé pour le limiteur de débit multi-instances.
5. Web : menus servis par `rbac/me/navigation` (entrées déclarées au manifeste) ; routes `/v2/messages`, `/v2/announcements`.
