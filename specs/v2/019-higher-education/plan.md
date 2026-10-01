# Plan d'implémentation — 019-higher-education

**Statut** : Rédigé. Tranches du plan : **2.5** (rattrapage, crédits) et **2.6** (diplômes, attestations, signataires) ; dépend de **2.1** (curriculum), **2.4** (012), **2.5** (011) et de **013** pour le rendu. Tâches parallélisables, périmètres de fichiers disjoints.

## 1. Ordre et dépendances

```
Prérequis : 004 (curriculum cycle/UE/ECUE, registre d'inscriptions aux cours) — ou ports + faux ; 011 (résultats FINAL, closures, openResitSession) ;
            012 (contrat credit-semester@1 + règles diplome_eligible, mention_diplome, eligible_rattrapage, etat_ue) ;
            013 (DocumentRenderer, sceller/signer, registre des signataires)
                        │
 ┌──────────────┬───────┴────────┬───────────────────┐
 ▼              ▼                ▼                   ▼
T-H-DB        T-H-PORTS       T-H-CHAR            T-H-NUM
(DDL +        (CurriculumTree, (caractérisation:   (compteurs sans trou,
 triggers)     ResultsReader,   figer sorties        next_number, tests de
               SigPort, ...)    legacy diplômes)     concurrence)
 │              │                │                   │
 └──────┬───────┴───────┬────────┴───────────────────┘
        ▼               ▼
   T-H-LEDGER      T-H-PREREQ ──────────────┐
   (capitalisation,                         │
    révocation, blocage diplôme)            ▼
        │                              T-H-RESIT
        ▼                              (fenêtres, candidats, déverrouillage session 2, notes S2)
   T-H-DIPLOMA
   (définitions, sync, éligibilité, octroi auto/manuel/forcé, révocation, mention)
        │
        ▼
   T-H-DOCS  (documents officiels : snapshots, emplacements, authenticité, attestations)
        │
        ▼
   T-H-HTTP ─► T-H-WEB (admin, étudiant, parent) ─► T-H-E2E ─► T-H-CLEAN
```

## 2. Tâches

### T-H-CHAR — Caractérisation du legacy (S)
- **Fichiers** : `tests/characterization/higher-diplomas/*`.
- **Contenu** : seeds (3 programmes Licence/Master, 30 UE, 20 étudiants aux profils variés) ; exécution du code actuel (`evaluateDiplomaEligibility`, `computeDiplomaProgress`, `tryAwardEligible`, attestations) ; figement JSON des sorties : éligibilité, progression, mentions, références.
- **Fin** : JSON rejouables ; liste des écarts attendus (numérotation, date d'obtention, signataires).

### T-H-DB — Schéma et déclencheurs (M)
- **Fichiers** : `modules/higher/migrations/1400-1406_*.sql`, `isolation-allowlist` (aucune table globale).
- **Fin** : `data-model.md` ; isolation générique ; tests de déclencheurs : ledger (unicité d'acquisition, révocation bloquée par diplôme), anti-cycle des prérequis, octrois (unicité, révocation terminale, forcé motivé), documents immuables, révocation propagée, `DELETE` refusés ; `EXCLUDE` des emplacements.

### T-H-PORTS — Ports et faux fournisseurs (S)
- `CurriculumTree` (UE d'un cycle/programme, crédits, catégorie, appartenance à un programme), `ResultsReader` (lignes `FINAL`, candidats de rattrapage, `openResitSession`), `DocumentSealer`/`DocumentRenderer` (013), `SignatoryDirectory` (013), `GuardianshipPort` (008), `EnrollmentDirectory`.
- **Fin** : `higher` testable sans 004/011/013 réels ; contract tests pour les fournisseurs.

### T-H-NUM — Numérotation sans trou (S)
- `higher.next_number`, tests de concurrence (1 000 appels, annulations de transaction), formats `DIP-AAAA-NNNNNN`, `AUTH/AAAA/NNN`, `ATT-AAAA-NNNNNN`.
- **Fin** : 0 doublon, 0 trou hors annulation ; une annulation ne consomme rien.

### T-H-LEDGER — Capitalisation (M)
- **Fichiers** : `modules/higher/{domain,application,infrastructure}/ledger/*`, abonné `results.period.closed|reopened`.
- **Contenu** : lecture des lignes UE `FINAL` ; création/révocation d'écritures ; blocage si diplôme octroyé ; événements `higher.credits.*` ; détection de dette (`etat_ue = DEBT`) ; idempotence.
- **Fin** : AC1.* ; 100 étudiants en ≤ 30 s ; rejeu d'événements ; réouverture.

### T-H-PREREQ — Prérequis (S)
- Cas d'usage `setPrerequisites`, `checkPrerequisites` (API publique), détection de cycle applicative + base ; avertissement sur inscrits impactés.
- **Fin** : AC2.* ; graphes de 50 UE sur 10 niveaux.

### T-H-RESIT — Rattrapage (M)
- **Contenu** : fenêtres, candidats (via `results`), inscriptions de rattrapage, déverrouillage de la seule session 2 (`assess`), événements, vues étudiant ; lien avec les évaluations `session_no = 2`.
- **Fin** : AC3.* ; scénario de bout en bout avec 011 (S1 clos → fenêtre → notes S2 → reclôture → capitalisation `session_obtained = 2` + dette).

### T-H-DIPLOMA — Diplômes et octrois (L)
- **Contenu** : définitions (`from-curriculum`, `sync`), exigences, progression, évaluation via `rules`, octroi automatique (abonné isolé), manuel, forcé (sensible, motif, MFA), révocation, ré-octroi exceptionnel, mention de cycle, `recompute` de masse.
- **Fin** : AC4-AC6 ; table de vérité de parité (≥ 30 cas) ; isolation de panne ; 1 000 octrois concurrents.

### T-H-DOCS — Documents officiels (M)
- **Contenu** : snapshots `diploma/1`, `attestation-success/1`, `attestation-authenticity/1` ; affectation des emplacements de signature datés ; refus d'émission sans signataire valide ; authenticité idempotente ; scellement et rendu via 013 ; publication à l'étudiant ; duplicata lié à l'original.
- **Fin** : AC7.* ; documents rendus et vérifiables par QR ; aucune valeur par défaut (grep).

### T-H-HTTP — Plugin Fastify (M)
- Routes de la spec §7, `requireFeature`, `requirePermission`, matrice d'accès (enseignant refusé, étudiant sur ses données, tuteur lié).
- **Fin** : tests d'intégration par route ; aucune SQL dans `http/`.

### T-H-WEB — Écrans (L) — *après 033-web-foundation*
- Administration (diplômes, candidats, documents, crédits d'un étudiant, rattrapages, prérequis, signataires), étudiant (parcours, rattrapages, diplômes), parent (lecture).
- **Fin** : Playwright par portail ; aucune logique de crédits/éligibilité dans le web.

### T-H-E2E — Parcours complet (M)
- Inscription d'un étudiant → trois semestres → clôtures → rattrapage → diplôme automatique → documents → vérification publique → révocation → « document révoqué ».

### T-H-CLEAN — Suppression du legacy (M)
- Supprimer services, tables, générateurs jsPDF listés en tête de `parity.md` ; mettre à jour l'inventaire ; lecteurs owner basculés sur les agrégats de `higher` (tranche 2.8).

## 3. Risques

| # | Risque | P / I | Atténuation |
|---|---|---|---|
| R1 | Le **registre d'inscriptions aux cours/UE** (rattrapage, dette, électives, à la carte) n'est pas fourni par 004 | **forte** / forte | Exigence explicite envoyée à l'architecte de 004 (spec §13) ; faux fournisseur ; sinon créer `higher.ue_registrations` (solution de repli, à arbitrer par le lead). |
| R2 | Ambiguïtés de règles : semestre validé, ré-octroi après révocation, mention | forte / moyenne | Q-01, Q-22, Q-05 ; comportement réel conservé par défaut. |
| R3 | Dépendance circulaire `results ↔ higher` (registre de cours / capitalisation) | moyenne / forte | Ports définis par le consommateur ; événements ; `dependency-cruiser`. |
| R4 | Panne de l'éligibilité qui bloque la capitalisation | moyenne / forte | Abonnés séparés, transactions propres, retries, DLQ ; test d'injection de panne. |
| R5 | Numérotation en concurrence ou après annulation | faible / forte | Compteur dans la transaction ; tests de charge. |
| R6 | Signataires non configurés bloquent l'émission le jour de la remise de diplômes | moyenne / moyenne | Contrôle préalable à la session d'impression (« documents bloqués : 3 ») ; alerte J-7 dans le tableau de bord. |
| R7 | Réouverture de période après octroi | moyenne / forte | Révocation d'écriture bloquée si diplôme ; procédure de révocation d'octroi distincte, auditée. |
| R8 | Volume de diplômes à émettre en une fois (promotion de 500) | faible / moyenne | Émission en lot dans le worker, file par tenant (013). |
| R9 | Gestion des équivalences/dispenses (non couverte par le legacy) demandée dès la V1 | moyenne / moyenne | `acquired_via` prévu ; écran non livré ; question à poser au propriétaire si besoin. |

## 4. Estimation relative

S ≈ 1-2 sem., M ≈ 3-5, L ≈ 6-10. Cumul : **XL** (S+M+S+S+M+S+M+L+M+M+L+M+M). Chemin critique : T-H-PORTS → T-H-LEDGER → T-H-DIPLOMA → T-H-DOCS → T-H-E2E.

## 5. Définition de fini

CI verte (unitaires, intégration, isolation, `dependency-cruiser`, lint R2) ; table de vérité de parité verte ; audit présent ; manifeste (permissions, features, événements) à jour ; migrations sur base vide et incrémentale ; documentation d'exploitation (émission de lot, rotation de signataires, révocation) ; anciens artefacts supprimés pour la tranche.
