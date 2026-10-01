# Plan d'implémentation — 013-report-cards

**Statut** : Rédigé. Tranche du plan : **2.6** (« Bulletins snapshot + PDF serveur, relevés, diplômes, attestations, signataires »). Dépend de **2.4** (012) et **2.5** (011). Les tâches sont parallélisables ; chacune a un périmètre de fichiers disjoint.

## 1. Ordre et dépendances

```
Prérequis : kernel/TenantDb/outbox/worker (Phase 1) ; StoragePort (000/024 ou T-STORAGE ci-dessous) ;
            011 : résultats FINAL + closures + délibérations (au moins en faux) ; 012 : API rules (label_map, version)
                         │
 ┌──────────────┬────────┴────────┬──────────────────┬───────────────┐
 ▼              ▼                 ▼                  ▼               ▼
T-RC-DB       T-RC-SNAP-PURE   T-TEMPLATES        T-STORAGE       T-SIGN
(DDL,         (schéma Zod      (gabarits          (port S3/MinIO  (Ed25519, clés,
 triggers)     reportcard/1,    plateforme,        si absent)      canonisation, hash)
               hash canonique)  moteur sans logique)
 │              │                 │                  │               │
 └──────┬───────┴────────┬────────┴──────────────────┴───────────────┘
        ▼                ▼
   T-RC-DOMAIN      T-RENDER (worker : Puppeteer, QR, PDF, métadonnées)
   (snapshot,           │
    lots, remplacement) │
        └────────┬──────┘
                 ▼
        T-RC-HTTP ─► T-VERIFY (public : vérif., upload, clés publiques)
                 │
                 ├─► T-WEB-ADMIN (émission, liste, identité, modèles, aperçu)
                 └─► T-WEB-FAMILY (mes bulletins) ; T-WEB-VERIFY (page publique)
                 ▼
             T-E2E ─► T-CLEAN (suppression du legacy)
```

## 2. Tâches

### T-RC-DB — Schéma et déclencheurs (M)
- **Fichiers** : `modules/reportcards/migrations/1300-1304_*.sql`, `isolation-allowlist.reportcards.ts` (3 tables globales justifiées).
- **Fin** : `data-model.md` ; test d'isolation générique ; tests de triggers (UPDATE/DELETE d'un snapshot refusés, recalcul SQL du hash, supersession atomique, version vivante unique, `register_verification` impose le tenant courant).

### T-RC-SNAP-PURE — Schéma de snapshot et hash canonique (S)
- **Fichiers** : `packages/contracts/src/v2/reportcards.ts` (Zod `reportcard/1`), `modules/reportcards/domain/{snapshot,canonical}.ts` (pur).
- **Contenu** : types du snapshot ; canonisation JSON ; hash ; vecteurs de test partagés avec la fonction SQL.
- **Fin** : tests de propriété (ordre des clés indifférent), vecteurs identiques SQL/TypeScript.

### T-SIGN — Signature et clés (S)
- **Fichiers** : `modules/reportcards/domain/signing.ts`, `infrastructure/key-provider.ts`.
- **Contenu** : Ed25519 via `node:crypto`, `KeyProvider` (secret d'environnement), publication des clés publiques, rotation, vérification.
- **Fin** : vecteurs de test ; clé privée jamais journalisée (test) ; aucun secret dans le dépôt (scan).

### T-STORAGE — Port de stockage (S) — *seulement si absent de 000/024*
- **Fichiers** : `packages/kernel/src/storage.ts` (interface), `modules/reportcards/infrastructure/storage-s3.ts` (adaptateur S3/MinIO).
- **Contenu** : `put(key, bytes, contentType) → { sha256, size }`, `get`, `exists`, `signedUrl(key, ttl)`, chiffrement au repos.
- **Fin** : tests contre MinIO éphémère ; aucun chemin disque local.

### T-TEMPLATES — Gabarits plateforme et moteur sans logique (L)
- **Fichiers** : `modules/reportcards/templates/{primary,secondary,higher-credits,higher-coef,transcript-credits}/*`, `domain/template-engine.ts`.
- **Contenu** : portage de la mise en page du legacy en gabarits **génériques** (sans IPAM/IMHOTEP) ; moteur de substitution sans logique (composants autorisés, boucles bornées) ; validation à la publication (liste noire des balises/URLs) ; `options_schema` ; emplacements de signature ; polices embarquées.
- **Fin** : test d'injection ; rendu des 5 gabarits sur jeux fictifs ; aucune occurrence « IPAM »/« IMHOTEP » (grep).
- **Dépend de** : la fourniture de **modèles officiels** (sinon gabarits génériques, Q-32) ; la mise en page legacy est la référence fonctionnelle (`bulletin-pdf.ts`, `bulletin-pdf-bts.ts`, `report-card-template.service.ts`).

### T-RC-DOMAIN — Émission, lots, remplacement, révocation, accès (L)
- **Fichiers** : `modules/reportcards/{domain,application,infrastructure}/*`.
- **Contenu** : contrôle préalable ; constitution du snapshot (lecture `results` API publique, ports absences/tutelle/impayés, branding, signataires, gabarit) ; transaction d'émission (snapshot + index de vérification + événements + audit) ; lots idempotents ; `reissue`, `revoke`, `publish`, `withdraw` ; contrôle d'accès famille ; options impayés ; relevé cumulé ; port `DocumentRenderer` pour 019/032.
- **Fin** : AC1-AC3, AC6-AC8 ; `expectAudited` ; idempotence ; 100 snapshots ≤ 10 s.

### T-RENDER — Rendu PDF dans le worker (L)
- **Fichiers** : `modules/reportcards/{jobs.ts,subscribers.ts}`, `infrastructure/renderer/*`.
- **Contenu** : pool Puppeteer (concurrence bornée, redémarrage sur fuite), JS désactivé, réseau coupé (interception de requêtes + test), images en data URI depuis `StoragePort`, QR (SVG) + code texte, métadonnées PDF (date = émission), fusion de PDF (classe), équité entre tenants, retries, `FAILED` explicite ; calcul du hash du PDF ; stockage.
- **Fin** : 100 bulletins ≤ 120 s sur 2 vCPU (à mesurer) ; non-régression visuelle ; conteneur sans accès réseau sortant (test).

### T-RC-HTTP — Plugin Fastify (M)
- **Fichiers** : `modules/reportcards/http/*`.
- **Fin** : routes de la spec §8 ; matrice d'accès ; URL signées ; limitation de débit des routes publiques ; aucune SQL dans `http/`.

### T-VERIFY — Vérification publique (M)
- **Contenu** : endpoint public (via `SystemDb` avec raison puis lecture du tenant), réponses minimales, uniformité des erreurs, journal, upload de fichier, clés publiques `/.well-known`, politique Q-31 paramétrable.
- **Fin** : tests de minimisation et de débit ; vérification hors ligne avec la clé publique.

### T-WEB-ADMIN / T-WEB-FAMILY / T-WEB-VERIFY — Écrans (L) — *après 033-web-foundation*
- Émission (assistant + suivi), liste, identité & signataires, modèles + aperçu fictif ; « Mes bulletins » ; page publique de vérification (accessible, légère, sans JavaScript lourd).
- **Fin** : Playwright par portail ; zéro calcul métier dans le web.

### T-E2E — Année simulée (M)
- Clôture de période → lot → publication → téléchargement famille → réouverture → réémission → vérification de l'ancien code (« remplacé »).

### T-CLEAN — Suppression du legacy (M) — *règle de sortie de tranche*
- Supprimer `report-card-template.service.ts`, la route `/report-cards/pdf` de `semester-averages.ts`, `report-cards.ts`, `transcripts.ts`, les générateurs jsPDF `bulletin-pdf*.ts`, `BulletinView.tsx` (logique de présentation), les tables `report_cards`, `transcripts`, `professional_bulletins`, les constantes d'identité IPAM/IMHOTEP.
- **Fin** : grep « IPAM|IMHOTEP » vide ; golden/visuel verts.

## 3. Risques

| # | Risque | P / I | Atténuation |
|---|---|---|---|
| R1 | **Injection via gabarit/données** exécutée dans Chromium (SSRF, lecture de fichiers, XSS) | moyenne / **forte** | Pas de HTML libre tenant en V1 ; gabarits plateforme revus ; moteur sans logique ; JS désactivé, réseau coupé ; échappement systématique ; test dédié ; conteneur sans route sortante. |
| R2 | Rendu lent ou instable de Puppeteer à grande échelle (mémoire, zombies) | moyenne / moyenne | Pool borné, recyclage, timeouts, file par tenant, mesure à T-RENDER ; plan B : service de rendu séparé. |
| R3 | Absence des **modèles officiels** (primaire/secondaire) | forte / moyenne | Gabarits génériques, options, gabarits ajoutés par versions sans livraison de code ; liste des documents à obtenir. |
| R4 | `StoragePort` non livré à temps | moyenne / forte | T-STORAGE inclus ; adaptateur S3/MinIO prévu au plan §3.10. |
| R5 | Dérive entre hash SQL et applicatif | faible / forte | Vecteurs partagés, test croisé en CI. |
| R6 | Perte de la clé privée de signature | faible / forte | Procédure de rotation, deux clés actives, sauvegarde du secret hors base ; les documents signés restent vérifiables par les clés publiques conservées. |
| R7 | Enjeu de protection des données de mineurs (vérification publique) | moyenne / forte | Minimisation par défaut, code non devinable, limitation de débit, avis juridique (Q-31). |
| R8 | Réclamations « ce n'est pas le même bulletin qu'avant » (cascade d'arrondis supprimée) | moyenne / moyenne | Écarts documentés (012 E2), simulation avant bascule, golden de 2.0 avec tolérance de ±0,01 sur la moyenne de semestre. |
| R9 | Volumétrie des PDF | faible / faible | ~150 Ko/bulletin ; politique de rétention des rendus intermédiaires. |
| R10 | Les 5 générateurs jsPDF encore branchés sur le portail pendant la transition | moyenne / moyenne | Bascule des écrans **avant** suppression ; T-CLEAN final. |

## 4. Estimation relative

S ≈ 1-2 sem., M ≈ 3-5, L ≈ 6-10. Cumul : **XL** (M+S+S+S+L+L+L+M+M+L+M+M). Chemin critique : T-RC-SNAP-PURE → T-RC-DOMAIN → T-RENDER → T-E2E → T-CLEAN ; T-TEMPLATES en parallèle (long).

## 5. Définition de fini

CI verte (unitaires, intégration, isolation, `dependency-cruiser`, lint R2) ; test d'injection vert ; non-régression visuelle ; manifeste à jour (permissions, features, événements) ; audit présent ; migrations sur base vide et incrémentale ; documentation d'exploitation (rotation de clé, reprise de lot, purge des rendus) ; anciens artefacts supprimés pour la tranche.
