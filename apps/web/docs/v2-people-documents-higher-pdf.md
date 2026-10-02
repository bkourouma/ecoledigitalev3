# Écrans v2 : pièces d'élève et PDF des diplômes / attestations

Même conventions que `v2-academic-people.md` et `v2-academic-rollover-settings.md` : hooks typés `platform/v2/*`, contrats Zod de
`packages/contracts/src/v2/{people,higher}.ts`, aucune règle métier côté client (l'écran affiche ce que l'API décide et lui envoie les actions ;
ses messages d'erreur sont affichés tels quels).

| Route | Écran | Permission | Fonction |
|---|---|---|---|
| `/v2/students/[id]` onglet « Pièces » | pièces de l'élève | lecture `student.sensitive.read` (sensible, auditée), écriture `student.update` | |
| `/v2/higher/documents` | colonne « PDF », télécharger, relancer, lien de vérification | `higher.document.read` (relance : `higher.document.issue`) | `higher.diplomas` |
| `/v2/higher/diplomas/[id]` onglet octrois | « Documents émis » par octroi (à la demande) avec PDF | `higher.document.read` | `higher.diplomas` |
| `/v2/higher/me/documents` | mes documents officiels (étudiant) et ceux de mes enfants (tuteur) | `higher.self.read` ou `higher.child.read` | |

## Pièces d'élève (`platform/v2/documents.ts`, `students/_components/StudentDocuments.tsx`)

- **Lecture** : `GET /students/:id/documents?includeHistory=&expiry=`. Sans `student.sensitive.read`, l'écran affiche « Accès restreint » **sans appeler l'API** ;
  un 403 du serveur (authentification renforcée…) donne le même état avec le message de l'API, pas une erreur. Le rappel « chaque consultation est enregistrée »
  est affiché discrètement. Pas de relecture au retour de fenêtre (chaque lecture est auditée).
- **Liste** : cartes par type (lisibles à 375 px), version, taille, dates, badge d'échéance **piloté par `expiryState`** (Valide / Bientôt échue / Échue /
  Sans échéance ; `daysLeft` est seulement affiché, aucun calcul de date), filtre « à renouveler » (`expiry=EXPIRING|EXPIRED`), bascule d'historique
  (`includeHistory=true` : versions remplacées et pièces retirées, sans action possible).
- **Dépôt** : `PUT /students/:id/documents?typeCode=&fileName=&title=&issuedOn=&expiresOn=` avec le **fichier en corps binaire brut**
  (`Content-Type` = type du fichier). Le client API (`platform/api/client.ts`) transmet désormais un `Blob` / `ArrayBuffer` tel quel (jeton et tenant
  inchangés, aucun en-tête inventé) ; `useApiAction` accepte un `timeoutMs` (120 s pour un fichier). Contrôles de commodité : un fichier, PDF / JPEG / PNG / WebP,
  8 Mo, dates (contrat Zod). Le type réel (octets magiques) et les doublons restent à l'API ; **409 `people.document_exists`** : message du serveur et bouton
  « Remplacer la pièce existante ».
- **Remplacement** `PUT .../documents/:docId` (nouvelle version), **métadonnées** `PATCH` (champs modifiés seulement, date vidée = `null`), **retrait**
  `POST .../remove` avec motif (≥ 5 caractères, boîte `ReasonDialog`), **consultation** : `GET .../url` demandé au clic, URL signée ouverte aussitôt
  (`window.open`, `noopener`), **jamais conservée ni affichée**.
- Sans `student.update` : consultation seule (aucun bouton d'écriture).
- Tests : `StudentDocuments.test.tsx` (octets et paramètres vérifiés exactement, permissions, 409 doublon, 400 format, 403, échéances, historique) et
  `platform/api/client-binary.test.ts`. Le faux client de test (`platform/test/render.tsx`) consigne désormais les corps binaires (`Uint8Array`).

## PDF des diplômes et attestations (`platform/v2/higher-documents.ts`, `higher/_components/DocumentPdf.tsx`)

- `GET /higher/documents/:id/pdf` : **200 `READY`** (URL signée de 5 minutes, émission auditée, ouverte aussitôt, jamais affichée) ou **202**
  `PENDING` / `RENDERING` / `FAILED` ; **409 `higher.document_revoked`** : message du serveur. Le contrat n'a pas encore de schéma pour cette réponse : il est décrit
  dans `higher-documents.ts` (`higherPdfResponseSchema`).
- **État « PDF »** lu dans le DTO : Prêt (`RENDERED`) / En préparation (`PENDING`, `RENDERING`) / Échec (`FAILED`) / Révoqué (document révoqué, l'emporte).
  Mention « Scellé » (`sealed`) et lien `/v2/verify/{verificationCode}` (page publique, sans donnée personnelle) à côté de chaque document.
- **Télécharger le PDF** : sur 202, « en préparation » et relecture toutes les **3 s, 20 fois au plus** (une minute), puis invitation à revenir ; quand le
  PDF devient prêt, **pas d'ouverture automatique** (un onglet ouvert hors d'un clic est bloqué par les navigateurs) : le bouton redevient actif. Sur
  `FAILED` : bouton **Relancer** (`POST .../render`, 202, suivi de la reprise) seulement avec `higher.document.issue`, sinon « contactez le secrétariat ».
  Un document révoqué n'a pas de bouton.
- Écrans : colonne PDF et boutons dans `DocumentsScreen` ; `AwardDocuments` dans l'onglet des octrois du diplôme (liste chargée à la demande, filtrée par
  octroi) ; page `/v2/higher/me/documents` (étudiant : `GET /me/documents` ; tuteur : un bloc par enfant, `GET /children/:studentId/documents`),
  entrée « Mes documents » dans `HigherNav`.
- Tests : `HigherPdf.test.tsx` (états, polling à temps simulé, limite de relectures, relance, 409, 403, permissions, étudiant et tuteur).

## Écarts et points à arbitrer

- Le schéma de la réponse `GET /documents/:id/pdf` manque dans `packages/contracts` (voir plus haut).
- Les documents des enfants passent par `useMyChildren` (`GET /people/children`, permission `student.child.read`) : un tuteur qui n'aurait que `higher.child.read`
  verrait la liste vide.
- Menu du portail : les entrées (`/v2/higher/me/documents`) restent à déclarer dans les manifestes d'API pour apparaître dans le menu latéral.
- Pas d'aperçu intégré du fichier (PDF / image) : ouverture dans un nouvel onglet par URL signée.
