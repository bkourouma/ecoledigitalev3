# Parité legacy -> v2 — Messagerie interne, annonces, notifications in-app (spec 016)

## 0. En-tête

**Objet.** Inventaire de ce que le legacy EcoleDigitale fait en matière de messagerie, d'annonces et de notifications, et, pour chaque élément, son sort dans la v2 : **conservé**, **amélioré**, **abandonné** (avec justification) ou **hors module** (avec le chantier porteur). Le module `messaging` remplace **huit mécanismes isolés** du legacy par un modèle unique (conversations -> messages -> pièces jointes ; annonces ciblées ; notifications in-app ; modération).

**Sources lues.** `routes/{parent,admin,teacher,student}-messages.ts`, `routes/teacher-conversations.ts`, `routes/admin-announcements.ts`, `routes/admin-email.ts`, `routes/notifications-inbox.ts`, `routes/parent-settings.ts` (préférences), `services/{message-delivery,message-email-definitions,message-email-templates,notifications-dispatch.service,whatsapp-delivery-log}.ts`, migrations `infra/scripts/migrations/{0029,0031,0057,0058,0102,0103}_*.sql`, `docs/menus-et-fonctionnalites-par-profil.md`.

**Légende.** conservé = règle métier reproduite ; amélioré = reproduite avec correction ; abandonné = non reprise (justifiée) ; hors module -> chantier = porté ailleurs.

## 1. Tables legacy

| ID | Table legacy | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| T-01 | `teacher_messages` (enseignant -> parent, sans fil) | amélioré | `conversations` DIRECT + `messages` | un fil par paire / élève / objet ; **tous** les tuteurs (legacy : `LIMIT 1`) ; lecture réelle |
| T-02 | `parent_teacher_conversations` + `conversation_messages` | amélioré | `conversations` DIRECT + `participants` + `messages` | `read_at` par message jamais écrit côté parent -> `last_read_seq` par participant ; statuts `archived` / `closed` sans endpoint -> archivage par utilisateur |
| T-03 | `parent_school_conversations` + `parent_school_conversation_messages` | amélioré | `conversations` GROUP « à l'administration » | un fil partagé avec les contacts de l'administration (paramétrés) ; plus de fil « sans propriétaire » ni de relais vers chaque admin plafonné à 30 par le code (le plafond de 30 contacts est conservé) |
| T-04 | `admin_teacher_messages`, `admin_student_messages` (sens unique) | amélioré | `conversations` BROADCAST (un fil privé par destinataire) | les destinataires **peuvent répondre** (legacy : sens unique, élève non lisible) |
| T-05 | `teacher_student_messages`, `student_replies` (écriture seule) | amélioré | `conversations` DIRECT enseignant <-> élève | legacy : INSERT sans SELECT, destinataire injoignable dans l'application |
| T-06 | `establishment_inbound_messages` (enseignant / élève -> établissement) | amélioré | GROUP « à l'administration » | boîte réelle, lue par les contacts ; accusés par participant |
| T-07 | `school_announcements` | amélioré | `announcements` + `targets` + `recipients` | cibles, publication / expiration, pièces, accusés, notifications (legacy : tout parent / enseignant voit tout, aucun accusé) |
| T-08 | `announcement_reads` (jamais alimentée) | amélioré | `announcement_recipients` (`read_at`, `acknowledged_at`) | accusés réels par destinataire |
| T-09 | `teacher_announcements` (code mort) | abandonné | — | aucune route ; remplacé par `publish_class` |
| T-10 | `notifications` parent (aucun INSERT dans le code) | abandonné | `notifications` | table vide en pratique ; remplacée |
| T-11 | `notification_preferences` (parent, jamais consultée) | amélioré | `notification_preferences` (tous rôles, appliquées) | appliquées à l'insertion des notifications |
| T-12 | `app_notifications` (boîte générique) | amélioré | `notifications` | compteur d'occurrences, lien interne seulement, dédoublonnage |
| T-13 | `event_invitations` (lue / RSVP, jamais créée) | hors module -> calendrier (017/024) | — | aucune création côté établissement dans le legacy ; non repris ici |
| T-14 | `app_email_delivery_log`, `app_whatsapp_delivery_log`, `admin_email_messages` / `_recipients` | hors module -> canaux externes | — | journal d'envoi des canaux externes |
| T-15 | `tenants.settings_json.adminMessageEmailTemplates` | hors module -> canaux externes | `system_templates` pour les messages système internes | gabarits d'e-mail HTML = autre chantier ; gabarits internes en table |
| T-16 | `payment_notifications` (e-mail / SMS **simulés**) | abandonné | — | implémentation factice ; rappels de paiement : 014 / 015 par événements |
| T-17 | DDL à la volée dans les routes (`CREATE TABLE IF NOT EXISTS`) | abandonné | migrations `1600_*` | schéma migré, RLS forcée |

## 2. Fonctions et endpoints

### 2.1 Parent

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| P-01 | `GET /parent/messages/teacher-messages` (filtres enfant, enseignant, dates, lu) | amélioré | `GET /conversations` (dossiers, recherche, non-lus) ; filtre par enfant via `aboutStudentId` |
| P-02 | `GET /parent/messages/announcements` (toutes les annonces, filtres, lu) | amélioré | `GET /announcements` (ciblées, non expirées, lu / non lu, historique) |
| P-03 | `GET /conversations`, `GET /conversations/:id` (ne marque pas lu) | amélioré | `GET /conversations`, `/:id`, `/:id/messages`, `POST /:id/read` |
| P-04 | `POST /conversations` : enfant lié (403), enseignant affecté à la classe de l'enfant (403) | conservé | R3 : enseignant affecté à une classe d'un de SES enfants |
| P-05 | `GET /teachers/:childId` (enseignants de l'enfant) | amélioré | `GET /recipients` (sélecteur : enseignants des classes de ses enfants + administration) |
| P-06 | `POST /conversations/:id/reply` (refuse `closed`, **accepte `archived`**) | amélioré | réponse refusée si fil fermé / réponses désactivées / restriction ; archivé = désarchivé par le message |
| P-07 | `POST /school-messages`, `/school-conversations/*` (préfixe `[Enfant concerné]`) | amélioré | GROUP `toAdministration` + `aboutStudentId` (champ structuré, plus de préfixe dans le texte) |
| P-08 | `GET /notifications`, `POST /notifications/:id/read` (table vide) | amélioré | `GET /notifications`, `POST /notifications/:id/read`, `read-all`, `me/unread` |
| P-09 | `GET /event-invitations`, `POST /event-invitations/:id/rsvp` | hors module -> calendrier | — |
| P-10 | `sendWhatsapp?`, `sendEmail?` à l'envoi | hors module -> canaux externes | préférences `external_channels` mémorisées ; port `NotificationChannel` |
| P-11 | Préférences de notification (`/parent/settings/notification-preferences`) | amélioré | `GET\|PUT /me/preferences`, appliquées, tous rôles |

### 2.2 Enseignant

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| E-01 | `POST /teacher/messages` : affectation (403), **premier parent seulement** | amélioré | R2 : élèves / tuteurs de SES classes ; **tous** les tuteurs |
| E-02 | `GET /teacher/messages` (envoyés, lu jamais mis à jour) | amélioré | dossier « envoyés » ; lu = `last_read_seq` du destinataire (non exposé à l'expéditeur : voir Q-09) |
| E-03 | `GET /teacher/messages/admin-messages` | amélioré | messages de l'administration = fils ordinaires (répondables) |
| E-04 | `POST /bulk-to-parents` (séquentiel, ignore silencieusement les non autorisés, premier parent) | amélioré | BROADCAST : refus explicite si un destinataire est interdit, rapport par nombre, fils privés, transaction unique |
| E-05 | `POST /to-establishment` | amélioré | GROUP `toAdministration` |
| E-06 | `POST /to-students` (écriture seule) | amélioré | DIRECT / BROADCAST vers les élèves de SES classes, **lisibles** |
| E-07 | `teacher-conversations.ts` (fils, marque lu à l'ouverture) | conservé | `POST /conversations/:id/read` explicite ; GET n'écrit pas |
| E-08 | Annonces de l'école vues par l'enseignant (sans état de lecture) | amélioré | boîte d'annonces avec lecture ; `publish_class` pour publier vers SES classes |

### 2.3 Élève

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| S-01 | `GET /student/messages/admin-messages` (aucun contrôle de rôle) | amélioré | boîte ordinaire, permission `messaging.self.read` |
| S-02 | `GET /student/messages/teacher-messages` : **l'élève lit les messages écrits à ses parents** | abandonné (fuite) | impossible : seuls les participants lisent |
| S-03 | `POST /reply-to-teacher`, `POST /to-teacher` (écriture seule), `POST /to-school` | amélioré | politique `student_policy` : `DISABLED`, `REPLY_ONLY`, `TEACHERS`, `TEACHERS_AND_ADMIN` (défaut : parité legacy) |
| S-04 | `GET /my-teachers` | amélioré | `GET /recipients` (enseignants de sa classe) |
| S-05 | Widgets « annonces / messages » du tableau de bord (**données factices**) | abandonné | remplacés par `GET /me/unread` et la cloche |

### 2.4 Administration

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| A-01 | `GET /admin/messages/conversations`, détail, réponse (fils partagés sans propriétaire ni non-lus) | amélioré | contacts de l'administration = participants du fil, non-lus par personne |
| A-02 | `GET /parents?search=`, `GET /students-by-class(-with-parents)` | amélioré | `GET /recipients?q=` (administration : tout compte) et `classroomId` |
| A-03 | `POST /conversations`, `POST /bulk-parent-conversations` (un fil par couple parent / enfant, séquentiel, sans transaction, sans plafond) | amélioré | BROADCAST : un fil privé **par destinataire** (dédoublonné), une transaction, plafond `max_broadcast_participants` |
| A-04 | `POST /send-to-teachers`, `/send-to-students` (`Promise.all` non borné) | amélioré | BROADCAST / audience par cibles, transaction unique, plafond |
| A-05 | `GET /admin/messages/teacher-messages` (supervision de tous les messages enseignant -> parent) | amélioré | `moderation.supervise` : liste sans contenu, lecture **avec motif obligatoire, auditée** |
| A-06 | `GET /delivery-log` | hors module -> canaux externes | — |
| A-07 | Annonces : `POST`, `GET`, `PUT /:id` (**n'importe quel admin modifie n'importe quelle annonce**), `DELETE` (suppression définitive) | amélioré | cycle `DRAFT -> SCHEDULED -> PUBLISHED -> WITHDRAWN` ; auteur ou gestionnaire ; retrait motivé et audité (jamais de suppression d'une annonce visible) |
| A-08 | Composeur e-mail admin (`/admin/email/send`, historique, boîte « établissement ») | hors module -> canaux externes | la boîte « à l'établissement » est le fil « à l'administration » |
| A-09 | `GET /messaging/email-config` | hors module -> canaux externes | — |

### 2.5 Notifications in-app et livraison

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| N-01 | `GET /notifications-inbox` (`unreadOnly`, type, curseur), `unread-count`, `:id/read`, `read-all` | conservé | mêmes opérations, curseur `(updated_at, id)` |
| N-02 | `dispatchNotification` (in-app + e-mail + WhatsApp, séquentiel) ; seul appelant : cours en direct | amélioré / hors module | création in-app dans la transaction ; e-mail / WhatsApp -> canaux externes |
| N-03 | Aucun message système pour absence / retard | amélioré | `attendance.absence.recorded` / `late.recorded` -> fil d'alertes des tuteurs |
| N-04 | Priorités `low`, `normal`, `high`, `urgent` | conservé | `LOW`, `NORMAL`, `HIGH`, `URGENT` (messages et annonces) |
| N-05 | Sujet <= 255 car., contenu sans maximum | amélioré | objet <= 200 car., corps borné par `message_max_length` (défaut 5 000, max 20 000) |

## 3. Règles implicites et défauts du legacy (B-xx)

| ID | Constat legacy | Traitement v2 |
|---|---|---|
| B-01 | Accusés de lecture inopérants presque partout | `last_read_seq` par participant, `announcement_recipients.read_at` |
| B-02 | Messages en écriture seule | toute écriture est lisible par son destinataire |
| B-03 | L'élève lit les messages destinés à ses parents | impossible (participants seulement) |
| B-04 | Un seul parent destinataire | tous les tuteurs joignables |
| B-05 | Annonces non ciblées, sans expiration, sans notification ; modification / suppression par n'importe quel admin | §6 de la spec |
| B-06 | DDL dans les routes | migrations |
| B-07 | `set_config('app.tenant_id', …, true)` hors transaction : filtre par `tenant_id` explicite seulement, lectures de fil sans filtre de tenant | `TenantDb.run` + RLS forcée, jointures composites `(tenant_id, id)` |
| B-08 | `endDate` exclut le jour de fin | curseurs d'instants, pas de dates calendaires |
| B-09 | Identifiants confondus (`teachers.id` / `users.id` / `student_profiles.id`) | une seule identité : l'identité IAM (`user_id`) ; élèves / classes en UUID via ports |
| B-10 | Statuts `closed` / `archived` sans endpoint | archivage par utilisateur ; `closed_at` réservé (aucune route en V1) |
| B-11 | Envois groupés sans transaction ni file | une transaction, plafond, idempotence (`clientId`) |
| B-12 | Gabarits annoncés sans API, charte IPAM codée en dur | gabarits internes en table + API ; e-mail -> canaux externes (branding par tenant) |
| B-13 | WhatsApp : aucune source de numéro pour un parent | canaux externes ; `people` expose les coordonnées par son API |
| B-14 | Rôles comparés à des libellés hétérogènes (`teacher` / `Enseignant`…) | permissions RBAC du manifeste |
| B-15 | Trois GET élève sans contrôle de rôle | `requirePermission` partout |
| B-16 | Aucune limitation de débit ; multipart de 1 Go | quotas en base + limiteur HTTP ; corps de pièce borné |

## 4. Manques de parité et écarts assumés

| Sujet | État | Décision |
|---|---|---|
| Canaux e-mail / SMS / WhatsApp / push, gabarits HTML, journal d'envoi | non repris | autre chantier ; port `NotificationChannel` déclaré (spec §11) |
| Invitations d'événements et RSVP | non repris | calendrier (017 / 024) |
| Composeur e-mail administration avec pièces jointes et historique par destinataire | non repris | canaux externes |
| Ajout de participants à un groupe existant ; synchronisation avec l'évolution d'une classe | non repris | V2 de la fonctionnalité (`open-questions.md` Q-11) |
| Accusé « vu par » exposé à l'expéditeur d'un message | non repris | décision de confidentialité (Q-09) |
| Filtre de contenu / mots interdits ; antivirus des pièces | non repris | hors V1 (Q-07, Q-08) |
| Durée de conservation des conversations ; anonymisation d'un élève dans les fils | non reprise | décision légale (Q-02) |
| Rappels de paiement | non repris | 014 / 015 (événements) |
| Rôles système : accorder `messaging.*` au personnel | **à faire dans rbac** | Q-01 ; sans cela, seuls direction, parents, élèves ont accès |

## 5. Synthèse

17 éléments de données legacy examinés : 10 améliorés, 4 abandonnés (code mort, vide, factice ou DDL à la volée), 3 renvoyés à d'autres chantiers. Tous les endpoints de messagerie, d'annonces et de notifications des quatre profils sont couverts ou explicitement renvoyés. Les 16 défauts relevés (B-01 à B-16) sont traités par construction ; aucun n'est reproduit.
