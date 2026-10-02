# Plan d'implémentation — communications : messagerie interne et annonces (016)

**Spec** : `spec.md` · **Modèle** : `data-model.md` · **Parité** : `parity.md` · **Décisions à arbitrer** : `open-questions.md`

## 1. Résumé

Module backend `messaging` (schéma Postgres `messaging`, migrations `1700-1799`), contrats `packages/contracts/src/v2/messaging.ts`, adaptateurs `platform/adapters/{people,academic}-messaging.ts`, écrans `/v2/messages/*` et `/v2/announcements/*`, cloche de notifications. Pack : PRIMARY, SECONDARY, HIGHER, VIRTUAL. Aucune dépendance de manifeste (`dependsOn: []`).

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
| L1 | Spec, contrats, migration `1700`, domaine pur, cas d'usage, HTTP, abonnés, jobs, lectures d'audience dans `people` | `test/unit/*` (56), `type-check:v2`, `check:boundaries`, catalogue d'événements, contrats d'événements |
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
| rbac | `templates/system-roles.ts` : permissions `messaging.*` accordées aux rôles système (+ justification du motif `messaging.*` pour la direction) ; `test/system-roles.test.ts` : oracle et liste des modules | la suite complète refuse un module sans matrice de rôles ; sans cela personne (hors propriétaire) n'a accès |
| plateforme | `apps/api/test/scaffold.test.ts` | la prochaine plage libre n'est plus codée en dur (1700 après `messaging`) |

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

1. `pnpm db:v2:migrate` (migration `1700_messaging_init.sql` ; extensions `unaccent` et `pg_trgm` déjà requises par people).
2. `pnpm --filter @ecoledigitale/worker build` (abonnés et jobs embarqués).
3. Rôles : les modèles système portent déjà `messaging.*` ; les établissements existants reçoivent les nouvelles permissions à la prochaine synchronisation rbac.
4. Variables : aucune nouvelle ; le stockage d'objets est celui de `STORAGE_*`. Redis (`REDIS_URL`) recommandé pour le limiteur de débit multi-instances.
5. Web : menus servis par `rbac/me/navigation` (entrées déclarées au manifeste) ; routes `/v2/messages`, `/v2/announcements`.

---

# Partie B — Plan du module `notifications` (canaux externes)

## 7. Résumé

Module backend `notifications` (schéma Postgres `notifications`, migration `1800`, packs PRIMARY / SECONDARY / HIGHER / VIRTUAL, `dependsOn: ["messaging"]`), contrats `packages/contracts/src/v2/notifications.ts`, adaptateurs `platform/adapters/{people,sources}-notifications.ts`, écrans `/v2/notifications/*` et `/v2/account/notifications`. Dépendances npm : `nodemailer` (déjà présent), `web-push` ; en développement `smtp-server`, `mailparser`.

## 8. Architecture

```
événement (outbox) ─▶ abonné `notifications.on.<événement>` ─▶ règles de l'établissement ─▶ AudienceResolver (ports)
                                                                                   │
job relances (07:00) ─ OverdueSource (finance) ─▶ paliers ─┐                       ▼
job alertes (07:30) ─ ports results / people / finance ─────┼──▶ enqueueInTx : consentement, heures calmes, suppression,
envoi manuel (API) ─────────────────────────────────────────┘     plafonds, rendu du gabarit (version figée) ─▶ `deliveries`
                                                                                   │
job envoi (15 s) ─ réclamation SKIP LOCKED ─ relecture (consentement, relance toujours due) ─ canal ─▶ issue ─▶ journal
                          canaux : IN_APP (messaging) · EMAIL (SMTP) · SMS (HTTP générique) · WHATSAPP (WaSender) · PUSH (VAPID)
```

- **Couches** : `domain/` pur (catalogue, gabarits, rendu, consentement, heures calmes, paliers, lecteurs d'événements, règles livrées) ; `application/` (cas d'usage, ports, envoi) ; `infrastructure/` (SQL, canaux) ; `http/` (plugin, gardes).
- **Ports** (`application/ports.ts`) : `RecipientDirectory`, `OverdueSource`, `GradeSource`, `TeachingLoadSource`, `AnnouncementFeed` ; `ChannelAdapter` / `ChannelRegistry`. Port absent = échec fermé `notifications.port_unavailable`. Appels séquentiels (connexion partagée).
- **Transactions** : mise en file dans la transaction de l'abonné / du job (donnée + événement + audit ensemble) ; l'**envoi réseau jamais dans une transaction** de donnée.

## 9. Lots (tous livrés)

| Lot | Contenu | Preuve |
|---|---|---|
| N1 | Spec, contrats, migration `1800`, domaine pur, cas d'usage, canaux, plugin HTTP, abonnés, jobs | `test/unit/*` (69), `test/channels/*` (25 : SMTP et HTTP simulés, Web Push chiffré déchiffré), `type-check:v2`, `check:boundaries` |
| N2 | Intégration réelle : RLS A/B, événement -> journal -> envoi, consentement, heures calmes, reprise, rebonds, relances, alertes, gabarits, envoi manuel, plafonds, confidentialité | `test/integration/notifications.integration.test.ts` (58) |
| N3 | HTTP réel par rôle, routes publiques signées, chargement par le registre | `test/unit/module.test.ts` (13), `test/integration/http.integration.test.ts` (9) |
| N4 | Adaptateurs réels people / academic / rbac / iam / finance / messaging, relances sur de vraies factures, assemblage | `apps/api/test/adapters/notifications.integration.test.ts` (7), `test/phase1/*`, contrats d'événements |
| N5 | Écrans web, client typé, i18n `v2Notifications*`, portails (messagerie par permission) | tests Vitest / RTL |
| N6 | Documentation (README, assemblage, ce dossier), reconstruction du worker | gates |

## 10. Extensions additives des autres modules

| Module | Extension | Raison |
|---|---|---|
| people | `application/contacts.ts` + `infrastructure/contacts-repo.ts` : `listNotificationContactsOfStudents / Staff / Identities` (lectures seules, jamais exposées par une route) | e-mail et téléphone d'un tuteur AVEC ou SANS compte, non disponibles dans l'audience de la messagerie (qui ne porte que des comptes) |
| finance | `application/overdue-feed.ts` : `listOverdueInstallments`, `isInstallmentOverdue` | relances et alertes par échéance ; arrêt dès paiement |
| messaging | `application/delivery-feed.ts` : `readAnnouncementForDelivery` | titre, extrait et destinataires figés d'une annonce, sans droit d'appelant (contexte système) |
| rbac | `templates/system-roles.ts` : `notifications.*` accordées (lecture / envoi au secrétariat et à la direction des études, lecture à l'économe, `own.manage` au personnel / enseignant / éducateur, `child.manage` aux parents, `self.manage` aux élèves) + justification de `notifications.*` pour la direction (urgence sensible) ; oracle de test aligné | la suite complète refuse un module sans matrice de rôles |
| plateforme | `platform/adapters/index.ts` (ports `notifications` API et worker), `test/events-contracts/notifications.contracts.ts` | assemblage et contrats d'événements |
| web | portails parent / élève / enseignant : le drapeau `NEXT_PUBLIC_V2_MESSAGING` est remplacé par la vérification de permission du module `messaging` | la messagerie est livrée |

## 11. Risques et parades

| Risque | Parade |
|---|---|
| Envoi réel involontaire en test | canaux testés contre SMTP et HTTP simulés ; canal non configuré = échec explicite ; simulation seulement demandée, jamais en production |
| Double envoi (événement rejoué, job lancé deux fois) | clé de remise `événement|règle|personne|canal`, registre des paliers, `ON CONFLICT DO NOTHING` |
| Fuite d'adresse | masque dans le journal, adresse effacée à l'état terminal, erreurs de fournisseur épurées, rien dans les événements ni l'audit |
| Spam / emballement d'une règle | plafonds (canal, destinataire, file), limiteur des routes publiques, urgence sensible et auditée |
| SMS coûteux | stratégie `FIRST_REACHABLE`, plafond journalier, coût journalisé quand le fournisseur le renvoie |
| Perte de consentement à la création d'un compte | clés de personne avec alias ; un refus sur une clé vaut pour toutes |
| Relance après paiement | relecture à l'envoi + annulation par `finance.invoice.paid` + échéance soldée non remontée |
| Panne du fournisseur | reprise avec backoff, bail expirable, état de santé par canal |

## 12. Déploiement

1. `pnpm db:v2:migrate` (migration `1800_notifications_init.sql`, après `1700` de `messaging`).
2. `pnpm --filter @ecoledigitale/worker build` (abonnés et jobs embarqués) ; le worker est **indispensable** à l'envoi.
3. Variables : voir `.env.example` (SMTP, `NOTIFICATIONS_*`, `SMS_HTTP_*`, `WASENDER_*`, VAPID). Production : `NOTIFICATIONS_UNSUBSCRIBE_SECRET` obligatoire pour l'e-mail ; `NOTIFICATIONS_WEBHOOK_SECRET` pour les accusés ; clés VAPID pour le push.
4. Rôles : les modèles système portent déjà `notifications.*` ; les établissements existants les reçoivent à la prochaine synchronisation rbac.
5. Web : menus servis par `rbac/me/navigation` ; routes `/v2/notifications/*`, `/v2/account/notifications`.
