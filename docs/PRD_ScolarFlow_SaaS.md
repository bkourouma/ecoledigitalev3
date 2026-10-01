# PRD --- ScolarFlow SaaS

**Version :** 1.0\
**Date :** 30 septembre 2026\
**Marché initial :** Côte d'Ivoire\
**Extension cible :** Afrique francophone\
**Produit :** ScolarFlow\
**Type :** SaaS B2B2C de gestion éducative

------------------------------------------------------------------------

## 1. Vision du produit

**ScolarFlow** est une plateforme SaaS unifiée permettant de gérer
l'ensemble des activités pédagogiques, administratives, financières et
numériques d'un établissement d'enseignement.

Un seul produit doit pouvoir servir quatre catégories d'établissements :

  Pack                       Établissements
  -------------------------- -------------------------------------------
  **ScolarFlow Primary**     Maternelle et primaire
  **ScolarFlow Secondary**   Collège et lycée
  **ScolarFlow Higher**      Grandes écoles, universités, BTS
  **ScolarFlow Virtual**     Écoles virtuelles et centres de formation

Un même client peut activer plusieurs packs.

``` text
GROUPE SCOLAIRE EXCELLENCE
│
├── Maternelle
│   └── Primary
├── Primaire
│   └── Primary
├── Collège
│   └── Secondary
├── Lycée
│   └── Secondary
├── Grande École
│   └── Higher
└── Campus numérique
    └── Virtual
```

ScolarFlow doit être pensé comme **le système d'exploitation de
l'établissement**, et non comme un simple logiciel de calcul de notes.

------------------------------------------------------------------------

## 2. Problème à résoudre

Les établissements utilisent souvent plusieurs outils indépendants pour
gérer :

-   inscriptions ;
-   dossiers élèves et étudiants ;
-   notes ;
-   bulletins et relevés ;
-   emplois du temps ;
-   présences et absences ;
-   paiements ;
-   comptabilité scolaire ;
-   communication avec les parents ;
-   documents ;
-   enseignants ;
-   cours en ligne ;
-   examens ;
-   stages et soutenances.

Cette fragmentation provoque :

-   doubles saisies ;
-   erreurs ;
-   difficultés de suivi ;
-   perte de documents ;
-   manque de visibilité pour la direction ;
-   calculs manuels ;
-   difficultés de communication avec les familles ;
-   manque de traçabilité.

ScolarFlow doit devenir le **système central de l'établissement**.

------------------------------------------------------------------------

## 3. Objectifs produit

ScolarFlow doit permettre de :

1.  Digitaliser l'ensemble du cycle de vie d'un apprenant.
2.  Centraliser les activités pédagogiques, administratives et
    financières.
3.  Automatiser les calculs académiques.
4.  Gérer plusieurs établissements et campus dans une même organisation.
5.  Améliorer la communication
    établissement--enseignant--parent--apprenant.
6.  Fournir des tableaux de bord décisionnels.
7.  Proposer un environnement complet d'enseignement à distance.
8.  Intégrer progressivement des fonctions d'intelligence artificielle.
9.  Être configurable selon les règles éducatives ivoiriennes.
10. Permettre une extension vers d'autres pays africains sans réécriture
    du cœur du produit.

------------------------------------------------------------------------

## 4. Principe architectural fondamental

ScolarFlow ne doit pas être développé comme quatre applications
indépendantes.

``` text
                    SCOLARFLOW
                         │
                 ┌───────┴───────┐
                 │   SaaS Core   │
                 └───────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     Organisation    Utilisateurs   Abonnement
          │              │              │
          └──────────────┼──────────────┘
                         │
               Academic Rules Engine
                         │
       ┌─────────┬───────┼─────────┬─────────┐
       │         │       │         │
    Primary  Secondary Higher   Virtual
```

Les différences entre établissements sont gérées par :

-   packs ;
-   modules ;
-   fonctionnalités ;
-   Feature Flags ;
-   configurations ;
-   profils pays ;
-   règles académiques versionnées.

------------------------------------------------------------------------

## 5. Architecture multi-tenant

Chaque organisation cliente constitue un **Tenant**.

``` text
Tenant
├── Organisation
├── Établissements
│   ├── Campus
│   └── Sites
├── Utilisateurs
├── Abonnement
├── Modules
├── Configuration
└── Données
```

Exemples :

``` text
excellence.scolarflow.com
```

ou, pour une offre Enterprise :

``` text
portail.groupeexcellence.ci
```

### Exigences

-   Toutes les données métier doivent appartenir à un `tenantId`.
-   Aucun tenant ne doit accéder aux données d'un autre tenant.
-   L'isolation doit être appliquée côté backend et base de données.
-   Les administrateurs ScolarFlow doivent disposer d'outils
    d'administration contrôlés et audités.

------------------------------------------------------------------------

## 6. Structure organisationnelle

Le système doit supporter :

``` text
Organisation
│
├── Établissement 1
│   ├── Campus Abidjan
│   └── Campus Bouaké
│
└── Établissement 2
    └── Campus Yamoussoukro
```

Une organisation peut donc gérer plusieurs :

-   établissements ;
-   cycles ;
-   campus ;
-   marques ;
-   programmes.

------------------------------------------------------------------------

## 7. Personas et rôles

### 7.1 Super Admin ScolarFlow

Peut notamment :

-   créer et suspendre des tenants ;
-   administrer les abonnements ;
-   gérer les plans ;
-   consulter l'utilisation ;
-   gérer les Feature Flags ;
-   administrer les règles nationales ;
-   superviser les services ;
-   gérer le support ;
-   consulter les audits autorisés.

### 7.2 Fondateur / Propriétaire

Dispose d'une vue consolidée sur les établissements de son organisation.

### 7.3 Directeur

Administre son établissement et consulte les indicateurs.

### 7.4 Directeur des études

Gère l'activité académique, les programmes, résultats et validations.

### 7.5 Secrétariat

Gère :

-   inscriptions ;
-   dossiers ;
-   documents ;
-   attestations ;
-   opérations administratives.

### 7.6 Économe / Comptable

Gère :

-   frais ;
-   factures ;
-   paiements ;
-   caisse ;
-   créances ;
-   reçus ;
-   rapports financiers.

### 7.7 Enseignant

Gère :

-   classes ;
-   présences ;
-   notes ;
-   cours ;
-   devoirs ;
-   appréciations.

### 7.8 Éducateur

Gère :

-   présence ;
-   retards ;
-   discipline ;
-   vie scolaire ;
-   convocations.

### 7.9 Parent / Tuteur

Suit ses enfants et leurs situations académique, administrative et
financière.

### 7.10 Élève / Étudiant

Accède à son environnement scolaire ou universitaire.

### 7.11 Responsable pédagogique

Gère :

-   programmes ;
-   enseignants ;
-   évaluations ;
-   résultats ;
-   contenus pédagogiques.

------------------------------------------------------------------------

## 8. Domaines fonctionnels

ScolarFlow est structuré autour d'au moins 24 modules.

  \#   Module
  ---- ----------------------
  01   Organisation
  02   Admissions
  03   Élèves / Étudiants
  04   Parents / Tuteurs
  05   Personnel
  06   Années académiques
  07   Classes / Promotions
  08   Matières / UE
  09   Emplois du temps
  10   Présences
  11   Évaluations
  12   Notes
  13   Bulletins / Relevés
  14   Conseils & décisions
  15   Vie scolaire
  16   Examens
  17   Finance
  18   Communication
  19   Documents
  20   LMS
  21   Bibliothèque
  22   Transport / Cantine
  23   Analytics
  24   ScolarFlow AI

Les modules peuvent être activés selon le pack et l'abonnement.

------------------------------------------------------------------------

## 9. Admissions

### Workflow

``` text
Prospect
   ↓
Candidature
   ↓
Dossier
   ↓
Pièces justificatives
   ↓
Étude
   ↓
Test / entretien (optionnel)
   ↓
Admis
   ↓
Paiement
   ↓
Inscription
   ↓
Matricule
   ↓
Classe / Promotion
```

### Statuts

``` text
DRAFT
SUBMITTED
UNDER_REVIEW
MISSING_DOCUMENT
ACCEPTED
REJECTED
WAITLISTED
ENROLLED
```

L'établissement doit pouvoir personnaliser son processus d'admission.

------------------------------------------------------------------------

## 10. Dossier apprenant

Un `Student` possède un dossier permanent contenant notamment :

-   identité ;
-   photo ;
-   sexe ;
-   date et lieu de naissance ;
-   nationalité ;
-   matricule interne ;
-   matricule national éventuel ;
-   contacts ;
-   adresse ;
-   parents et tuteurs ;
-   historique scolaire ;
-   documents ;
-   contacts d'urgence ;
-   informations administratives pertinentes.

Un changement de classe ou d'année ne crée jamais un nouvel élève.

L'historique des inscriptions est géré séparément via `Enrollment`.

------------------------------------------------------------------------

## 11. Année académique

``` text
AcademicYear
2026-2027
│
├── Période 1
├── Période 2
├── Période 3
└── ...
```

Les périodes doivent être configurables :

-   compositions ;
-   trimestres ;
-   semestres ;
-   sessions ;
-   modules ;
-   autres découpages.

Aucune périodicité ne doit être codée en dur.

------------------------------------------------------------------------

# PARTIE II --- PACK PRIMARY

## 12. ScolarFlow Primary

Le profil Côte d'Ivoire doit permettre de configurer notamment :

``` text
Maternelle
├── Petite Section
├── Moyenne Section
└── Grande Section

Primaire
├── CP1
├── CP2
├── CE1
├── CE2
├── CM1
└── CM2
```

### Fonctions principales

-   classes ;
-   instituteurs ;
-   matières ;
-   coefficients ;
-   évaluations ;
-   compositions ;
-   notes ;
-   moyennes ;
-   rangs ;
-   appréciations ;
-   absences ;
-   bulletins ;
-   décisions ;
-   bilan annuel ;
-   préparation CEPE ;
-   archivage des années.

Le fonctionnement existant de ScolarFlow doit être absorbé et migré vers
ce pack.

------------------------------------------------------------------------

## 13. Academic Rules Engine --- Primaire

Les formules académiques ne doivent jamais être codées directement dans
le frontend.

Exemple :

``` text
RuleSet
Country: CI
EducationLevel: PRIMARY
AcademicYear: 2026-2027

AnnualAverageRule
PromotionRule
RankingRule
RoundingRule
AssessmentRule
```

Le profil Côte d'Ivoire doit permettre de représenter :

-   règles de calcul des moyennes ;
-   MGA ;
-   seuils ;
-   passage ;
-   redoublement ;
-   intervention du Conseil des maîtres ;
-   règles de classement ;
-   arrondis.

Chaque règle doit être versionnée.

------------------------------------------------------------------------

## 14. CEPE

Le CM2 doit disposer d'un espace dédié aux examens officiels.

Fonctions :

-   candidats ;
-   inscription ;
-   numéro candidat ;
-   centre ;
-   examens blancs ;
-   résultats ;
-   admission ;
-   documents ;
-   exports ;
-   statistiques.

------------------------------------------------------------------------

# PARTIE III --- PACK SECONDARY

## 15. ScolarFlow Secondary

Structure générale :

``` text
COLLÈGE
├── 6e
├── 5e
├── 4e
└── 3e
    ↓
   BEPC

LYCÉE
├── 2nde
├── 1ère
└── Terminale
    ↓
    BAC
```

------------------------------------------------------------------------

## 16. Séries et spécialités

Le système doit permettre de configurer :

-   séries générales ;
-   séries techniques ;
-   séries professionnelles ;
-   options ;
-   langues ;
-   spécialités.

Aucune liste ne doit être figée dans le code.

------------------------------------------------------------------------

## 17. Évaluations secondaires

Types configurables :

``` text
Interrogation
Devoir
Composition
Examen blanc
Projet
Oral
TP
Autre
```

Chaque type peut définir :

-   coefficient ;
-   barème ;
-   période ;
-   poids ;
-   matière ;
-   enseignant ;
-   date ;
-   règles de publication.

------------------------------------------------------------------------

## 18. Calculs secondaires

Hiérarchie :

``` text
Note
 ↓
Moyenne matière
 ↓
Moyenne période
 ↓
Moyenne annuelle
 ↓
Décision
```

Le profil réglementaire ivoirien peut contenir les formules de MGA
applicables.

Ces formules sont stockées dans le `RuleSet` et ne doivent pas être
immuables dans le code.

------------------------------------------------------------------------

## 19. Conseil de classe

``` text
Conseil
│
├── Classe
├── Période
├── Participants
├── Résultats
├── Absences
├── Discipline
├── Appréciations
├── Propositions
├── Décisions
└── PV
```

Décisions configurables :

-   passage ;
-   redoublement ;
-   orientation ;
-   réorientation ;
-   exclusion ;
-   avis requis ;
-   autre décision.

Le système doit pouvoir générer automatiquement un PV.

------------------------------------------------------------------------

## 20. Élèves affectés par l'État

Créer un modèle `StudentFundingType`.

``` text
PRIVATE
STATE_ASSIGNED
SCHOLARSHIP
COMPANY
STAFF_CHILD
OTHER
```

Pour un élève affecté, prévoir notamment :

-   référence d'affectation ;
-   année ;
-   établissement ;
-   montant État ;
-   montant parent ;
-   présence ;
-   contrôles ;
-   situation financière ;
-   historique des créances ;
-   documents.

Prévoir une couche d'intégration future avec des plateformes publiques
lorsqu'une interface technique officielle est disponible.

------------------------------------------------------------------------

## 21. Examens nationaux

Créer un moteur générique `ExaminationManagement`.

Il doit pouvoir gérer notamment :

``` text
CEPE
BEPC
BAC
BTS
```

Fonctions :

-   candidats ;
-   éligibilité ;
-   inscriptions ;
-   pièces ;
-   numéro candidat ;
-   centre ;
-   examens blancs ;
-   résultats ;
-   statistiques ;
-   exports.

------------------------------------------------------------------------

# PARTIE IV --- PACK HIGHER

## 22. ScolarFlow Higher

Structure :

``` text
Établissement
   ↓
Campus
   ↓
Faculté / École
   ↓
Département
   ↓
Programme
   ↓
Diplôme
   ↓
Niveau
   ↓
Semestre
   ↓
UE
   ↓
ECUE
```

Le moteur doit pouvoir gérer des organisations LMD ainsi que des
programmes spécifiques comme le BTS.

------------------------------------------------------------------------

## 23. UE, ECUE et crédits

Entités principales :

``` text
Program
Semester
TeachingUnit
CourseUnit
Credit
Coefficient
Prerequisite
Assessment
Grade
```

Hiérarchie :

``` text
ECUE
 ↓
UE
 ↓
Semestre
 ↓
Année
 ↓
Diplôme
```

Le système doit gérer :

-   crédits acquis ;
-   crédits requis ;
-   compensation ;
-   capitalisation ;
-   prérequis ;
-   validation ;
-   rattrapage ;
-   progression ;
-   diplomation.

Les règles restent configurables par établissement et programme.

------------------------------------------------------------------------

## 24. BTS

Workflow :

``` text
Étudiant
 ↓
Formation BTS
 ↓
1re année
 ↓
2e année
 ↓
Examen
 ↓
Admissibilité
 ↓
Stage
 ↓
Rapport
 ↓
Évaluation maître de stage
 ↓
Soutenance
 ↓
Jury
 ↓
Résultat
```

Fonctions spécifiques :

-   inscription BTS ;
-   suivi de formation ;
-   examen ;
-   admissibilité ;
-   stage ;
-   rapport ;
-   soutenance ;
-   jury ;
-   résultat final.

------------------------------------------------------------------------

## 25. Stages

Modèle :

``` text
Internship

Student
Company
Supervisor
AcademicSupervisor
StartDate
EndDate
Topic
Status
Documents
Evaluation
Report
Defense
```

Le système doit permettre d'identifier :

-   étudiants sans stage ;
-   stages en cours ;
-   stages terminés ;
-   rapports manquants ;
-   évaluations manquantes ;
-   soutenances à programmer.

------------------------------------------------------------------------

## 26. Soutenances

Gestion :

-   étudiant ;
-   rapport ;
-   thème ;
-   date ;
-   heure ;
-   salle ;
-   jury ;
-   président ;
-   encadreur ;
-   membres ;
-   notes ;
-   observations ;
-   décision.

Documents générés :

-   PV de soutenance ;
-   résultat ;
-   attestation éventuelle.

------------------------------------------------------------------------

# PARTIE V --- PACK VIRTUAL

## 27. ScolarFlow Virtual

Le pack Virtual constitue un véritable LMS.

``` text
Course
 ↓
Module
 ↓
Chapter
 ↓
Lesson
```

Une `Lesson` peut contenir :

-   vidéo ;
-   texte ;
-   PDF ;
-   présentation ;
-   audio ;
-   lien ;
-   quiz ;
-   exercice ;
-   classe virtuelle ;
-   SCORM dans une version ultérieure.

------------------------------------------------------------------------

## 28. Progression LMS

Modèles :

``` text
Enrollment
Progress
LessonProgress
WatchProgress
QuizAttempt
AssignmentSubmission
CourseCompletion
Certificate
```

Exemple de dashboard :

``` text
Formation : Développement Web
Progression : 67 %
18/27 leçons terminées
Quiz : 74 %
Temps : 23h42
```

------------------------------------------------------------------------

## 29. Classes virtuelles

Architecture provider-based :

``` text
VirtualClassProvider
├── Google Meet
├── Microsoft Teams
├── Zoom
├── Jitsi
└── Custom
```

ScolarFlow ne doit dépendre d'aucun fournisseur unique.

L'application doit gérer :

-   planification ;
-   invitations ;
-   rappels ;
-   liens ;
-   présence ;
-   durée de connexion si disponible ;
-   replay ;
-   documents associés.

------------------------------------------------------------------------

# PARTIE VI --- MODULES TRANSVERSAUX

## 30. Finance

Le module financier est un composant majeur de ScolarFlow.

### Catalogue de frais

``` text
Inscription
Scolarité
Cantine
Transport
Uniforme
Documents
Examens
Activités
Soutenance
Bibliothèque
Autres
```

Un frais peut dépendre :

-   établissement ;
-   campus ;
-   classe ;
-   filière ;
-   niveau ;
-   année ;
-   type d'étudiant.

------------------------------------------------------------------------

## 31. Facturation

Entités :

``` text
Fee
FeeSchedule
Invoice
InvoiceLine
Payment
Receipt
Refund
Discount
Scholarship
CreditNote
CashRegister
```

Modes de paiement :

-   espèces ;
-   chèque ;
-   virement ;
-   carte ;
-   Mobile Money ;
-   paiement en ligne.

Prévoir une abstraction `PaymentProvider` pour intégrer différents
opérateurs et agrégateurs.

------------------------------------------------------------------------

## 32. Échéanciers

Exemple :

``` text
Scolarité : 500 000 FCFA

Inscription       100 000
15 octobre        150 000
15 janvier        150 000
15 mars           100 000
```

Dashboard financier :

-   facturé ;
-   encaissé ;
-   restant ;
-   retard ;
-   taux de recouvrement ;
-   créances par classe ;
-   créances par étudiant ;
-   évolution des encaissements.

------------------------------------------------------------------------

## 33. Présences

### Élèves

Statuts :

``` text
PRESENT
ABSENT
LATE
EXCUSED
EARLY_LEAVE
```

### Personnel

Gérer :

-   présence ;
-   retard ;
-   absence ;
-   congé.

Extensions futures :

-   QR Code ;
-   badge ;
-   biométrie.

------------------------------------------------------------------------

## 34. Vie scolaire

Gérer :

-   retards ;
-   absences ;
-   incidents ;
-   sanctions ;
-   avertissements ;
-   encouragements ;
-   exclusions temporaires ;
-   convocations ;
-   observations.

Toutes les actions sensibles doivent être historisées.

------------------------------------------------------------------------

## 35. Emploi du temps

Le moteur doit détecter automatiquement :

-   conflit enseignant ;
-   conflit classe ;
-   conflit salle ;
-   conflit équipement.

Objets principaux :

``` text
Teacher
Class
Subject
Room
TimeSlot
Schedule
```

------------------------------------------------------------------------

## 36. Portail Parent

Le parent doit pouvoir suivre plusieurs enfants.

Fonctions :

-   résultats ;
-   bulletins ;
-   absences ;
-   retards ;
-   emploi du temps ;
-   paiements ;
-   reçus ;
-   devoirs ;
-   annonces ;
-   messages ;
-   documents.

Exemple :

``` text
Bonjour Mme Koffi

MES ENFANTS

Ange — CE2 A
Moyenne : ...
Absences : ...
Scolarité : ...

Marie — 5e B
Moyenne : ...
Absences : ...
Scolarité : ...
```

------------------------------------------------------------------------

## 37. Portail Enseignant

Dashboard :

``` text
AUJOURD'HUI

08:00  5e A   Mathématiques
10:00  4e B   Mathématiques
14:00  3e A   Mathématiques
```

Actions rapides :

-   Faire l'appel
-   Saisir les notes
-   Ajouter un devoir
-   Déposer un cours
-   Saisir les appréciations
-   Consulter l'emploi du temps

------------------------------------------------------------------------

## 38. Communication

Canaux :

``` text
IN_APP
EMAIL
SMS
WHATSAPP
PUSH
```

Templates :

-   absence ;
-   retard ;
-   paiement ;
-   impayé ;
-   résultat ;
-   convocation ;
-   annonce ;
-   cours ;
-   urgence.

Tous les envois doivent être journalisés.

------------------------------------------------------------------------

## 39. Gestion documentaire

GED légère intégrée.

``` text
StudentDocument
TeacherDocument
InstitutionDocument
AcademicDocument
FinancialDocument
```

Fonctions :

-   catégories ;
-   versions ;
-   dates d'expiration ;
-   permissions ;
-   historique ;
-   stockage objet ;
-   prévisualisation ;
-   téléchargement contrôlé.

------------------------------------------------------------------------

## 40. Ressources humaines

Gestion :

-   enseignants ;
-   administratifs ;
-   vacataires ;
-   contrats ;
-   qualifications ;
-   autorisations ;
-   disponibilités ;
-   charges horaires ;
-   documents ;
-   affectations.

------------------------------------------------------------------------

# PARTIE VII --- INTELLIGENCE ET ANALYTICS

## 41. ScolarFlow AI

L'IA doit être transversale mais rester un **assistant**.

### Enseignant

-   générer une interrogation ;
-   proposer des exercices ;
-   proposer une appréciation ;
-   résumer les performances.

### Direction

-   identifier les baisses de performance ;
-   résumer les indicateurs ;
-   analyser l'absentéisme.

### Finance

-   identifier les créances anciennes ;
-   expliquer l'évolution du recouvrement ;
-   préparer des relances.

### Étudiant

-   expliquer une leçon ;
-   créer des exercices de révision ;
-   résumer un contenu.

### Parent

-   expliquer un bulletin ;
-   résumer les performances de l'enfant.

### Higher

-   identifier les étudiants ayant des crédits manquants ;
-   résumer la progression vers le diplôme.

**L'IA ne prend jamais automatiquement une décision académique
réglementaire.**

------------------------------------------------------------------------

## 42. Analytics

Dashboard Direction :

``` text
1 247 élèves

Présence aujourd'hui       91,4 %
Moyenne générale           12,3
Enseignants présents       96 %
Scolarité recouvrée        73 %
Créances               28 450 000 FCFA
```

Indicateurs :

-   effectifs ;
-   répartition par sexe ;
-   niveaux ;
-   performances ;
-   absences ;
-   redoublements ;
-   paiements ;
-   enseignants ;
-   admissions ;
-   progression LMS ;
-   résultats par matière.

------------------------------------------------------------------------

## 43. Alertes intelligentes

Exemples :

``` text
IF absence >= threshold
→ Alert parent

IF payment overdue >= X days
→ Alert finance

IF grade drop >= threshold
→ Alert teacher

IF teacher workload > threshold
→ Alert administration

IF required_document expires soon
→ Alert HR
```

Les seuils sont configurables.

------------------------------------------------------------------------

# PARTIE VIII --- SÉCURITÉ ET GOUVERNANCE

## 44. RBAC

Permissions granulaires.

Exemple :

``` text
student.read
student.create
student.update

grade.read
grade.enter
grade.validate
grade.publish

finance.invoice.read
finance.payment.create

report.export
```

Les rôles doivent être personnalisables par tenant.

------------------------------------------------------------------------

## 45. Workflow de validation des notes

``` text
DRAFT
 ↓
SUBMITTED
 ↓
REVIEWED
 ↓
APPROVED
 ↓
PUBLISHED
```

Une note publiée ne peut pas être modifiée silencieusement.

Toute correction crée un `GradeRevision` avec :

-   ancienne valeur ;
-   nouvelle valeur ;
-   auteur ;
-   justification ;
-   approbateur ;
-   date.

------------------------------------------------------------------------

## 46. Audit

Modèle :

``` text
AuditLog

tenantId
userId
action
entity
entityId
before
after
ip
device
timestamp
```

Les opérations sensibles, notamment notes et finances, doivent être
auditées.

------------------------------------------------------------------------

## 47. Sécurité

Exigences minimales :

-   TLS ;
-   MFA pour les comptes sensibles ;
-   isolation tenant ;
-   RBAC ;
-   rate limiting ;
-   gestion sécurisée des secrets ;
-   sauvegardes ;
-   journal d'audit ;
-   contrôle des uploads ;
-   sessions révocables ;
-   politiques de mot de passe ;
-   export contrôlé ;
-   procédures de restauration ;
-   protection des données personnelles.

------------------------------------------------------------------------

# PARTIE IX --- ARCHITECTURE TECHNIQUE

## 48. Stack recommandée

``` text
Frontend
Next.js
TypeScript
Tailwind CSS

Backend
NestJS

ORM
Prisma

Database
PostgreSQL

Cache
Redis

Jobs
BullMQ

Object Storage
S3 compatible

Auth
Sessions / JWT
MFA

Mobile
PWA puis Flutter si nécessaire

Testing
Vitest
Playwright

Observability
OpenTelemetry
```

L'architecture initiale recommandée est un **modular monolith**, afin
d'éviter des microservices prématurés.

------------------------------------------------------------------------

## 49. Organisation du repository

``` text
apps/
├── web
├── api
└── worker

packages/
├── auth
├── database
├── ui
├── shared
├── rules-engine
├── notifications
├── payments
└── ai
```

Modules backend :

``` text
modules/
├── tenant
├── organization
├── campus
├── auth
├── users
├── students
├── guardians
├── staff
├── admissions
├── academics
├── classes
├── subjects
├── schedule
├── attendance
├── assessment
├── grades
├── report-cards
├── examinations
├── finance
├── documents
├── communications
├── lms
├── internships
├── defenses
├── analytics
├── subscriptions
├── ai
└── audit
```

------------------------------------------------------------------------

## 50. Modèle de données principal

``` text
Tenant
Organization
Institution
Campus

User
Role
Permission

Student
Guardian
StudentGuardian

Staff
Teacher

AcademicYear
AcademicPeriod

EducationLevel
Program
GradeLevel
Classroom
Enrollment

Subject
Course
TeachingAssignment

Assessment
Grade
GradeRevision

Attendance

ReportCard
AcademicDecision

Invoice
Payment
Receipt

Document

Notification

LmsCourse
LmsModule
LmsLesson
CourseEnrollment
Quiz
QuizAttempt

Internship
Defense

RuleSet
Rule
RuleVersion

Subscription
Plan
Feature

AuditLog
```

------------------------------------------------------------------------

## 51. Academic Rules Engine

Le Rules Engine est un composant **P0**.

Hiérarchie :

``` text
Country
 ↓
Regulation
 ↓
EducationSystem
 ↓
AcademicYear
 ↓
Level
 ↓
RuleSet
```

Exemple :

``` text
CI
└── MENAET
    └── SECONDARY_GENERAL
        └── RuleSet v2026
            ├── annual-average
            ├── promotion
            ├── repetition
            ├── orientation
            └── grading
```

Chaque règle doit posséder notamment :

``` text
effectiveFrom
effectiveTo
version
source
status
configuration
```

Objectif : permettre d'intégrer une réforme réglementaire sans réécrire
l'application.

------------------------------------------------------------------------

## 52. Configuration pays

``` text
CountryProfile

country = CI
currency = XOF
locale = fr-CI
timezone = Africa/Abidjan
phone = +225
educationSystem = CI
```

L'architecture doit permettre d'ajouter ultérieurement :

-   Sénégal ;
-   Mali ;
-   Burkina Faso ;
-   Bénin ;
-   Togo ;
-   Guinée ;
-   Cameroun ;
-   autres pays.

------------------------------------------------------------------------

# PARTIE X --- SAAS ET COMMERCIAL

## 53. Packs métier

``` text
PRIMARY
SECONDARY
HIGHER
VIRTUAL
```

Un tenant peut souscrire plusieurs packs.

------------------------------------------------------------------------

## 54. Offres commerciales

``` text
STARTER
PROFESSIONAL
ENTERPRISE
```

Exemple :

``` text
ScolarFlow Secondary Professional
```

Les Feature Flags contrôlent les fonctionnalités disponibles.

------------------------------------------------------------------------

## 55. Facturation SaaS

Critères possibles :

-   nombre d'apprenants actifs ;
-   nombre de campus ;
-   stockage ;
-   modules ;
-   SMS ;
-   consommation IA ;
-   LMS ;
-   utilisateurs administratifs.

Le modèle commercial privilégié est une facturation par **tranche
d'apprenants**, complétée par certaines options.

------------------------------------------------------------------------

## 56. Onboarding établissement

``` text
Créer compte
   ↓
Créer établissement
   ↓
Choisir pays
   ↓
Choisir type
   ↓
Choisir pack
   ↓
Choisir année scolaire
   ↓
Importer élèves
   ↓
Créer classes
   ↓
Importer enseignants
   ↓
Configurer finance
   ↓
GO LIVE
```

Objectif produit : permettre à un nouvel établissement d'être
opérationnel en moins d'une journée pour les configurations standards.

------------------------------------------------------------------------

## 57. Import Excel

Imports :

-   élèves ;
-   parents ;
-   enseignants ;
-   classes ;
-   matières ;
-   notes ;
-   soldes financiers.

Workflow :

``` text
Upload
 ↓
Mapping colonnes
 ↓
Validation
 ↓
Erreurs
 ↓
Preview
 ↓
Import
 ↓
Rapport
```

------------------------------------------------------------------------

## 58. Mobile First

Les principales opérations doivent être utilisables depuis un smartphone
:

-   appel ;
-   notes ;
-   consultation parent ;
-   paiements ;
-   devoirs ;
-   LMS ;
-   notifications.

Une PWA est prévue dès V1.

Une application Flutter pourra être ajoutée ultérieurement.

------------------------------------------------------------------------

## 59. Faible connectivité et offline

Certaines fonctions doivent progressivement supporter un fonctionnement
temporaire hors connexion.

Priorité :

1.  appel ;
2.  emploi du temps ;
3.  notes ;
4.  contenus LMS téléchargés.

Les données doivent être synchronisées lors du retour de la connexion.

------------------------------------------------------------------------

## 60. API

API REST versionnée :

``` text
/api/v1/
```

Domaines :

``` text
/auth
/students
/classes
/teachers
/grades
/attendance
/finance
/lms
/analytics
```

Webhooks :

``` text
student.created
student.enrolled
grade.published
payment.completed
invoice.overdue
attendance.absent
course.completed
```

------------------------------------------------------------------------

# PARTIE XI --- ROADMAP

## 61. Priorités

### P0 --- Indispensable

-   SaaS Core ;
-   multi-tenant ;
-   Auth/RBAC ;
-   établissement ;
-   années scolaires ;
-   apprenants ;
-   parents ;
-   enseignants ;
-   classes ;
-   matières ;
-   inscriptions ;
-   évaluations ;
-   notes ;
-   Rules Engine ;
-   bulletins ;
-   présences ;
-   finance ;
-   paiements ;
-   notifications ;
-   audit ;
-   imports.

### P1

-   emploi du temps ;
-   conseil de classe ;
-   examens ;
-   portail parents ;
-   portail enseignant ;
-   documents ;
-   analytics ;
-   affectés État ;
-   Higher/LMD ;
-   BTS ;
-   stages.

### P2

-   LMS complet ;
-   Virtual ;
-   classes virtuelles ;
-   bibliothèque ;
-   transport ;
-   cantine ;
-   IA ;
-   applications mobiles.

### P3

-   API partenaires ;
-   biométrie ;
-   offline avancé ;
-   BI avancée ;
-   intégrations ministérielles lorsqu'elles sont disponibles.

------------------------------------------------------------------------

## 62. Stratégie MVP

Il n'est pas recommandé de construire les quatre packs simultanément.

### ScolarFlow V1

``` text
SaaS Core
+
Primary
+
Secondary
+
Finance
+
Parents
+
Teachers
```

### ScolarFlow V1.5

``` text
Higher
+
LMD
+
BTS
+
Stages
+
Soutenances
```

### ScolarFlow V2

``` text
Virtual
+
LMS
+
AI
```

Cette stratégie permet de capitaliser sur l'application ScolarFlow
existante et de réduire le risque projet.

------------------------------------------------------------------------

# PARTIE XII --- CRITÈRES DE RÉUSSITE

## 63. Critères de réussite fonctionnels

### Académique

Un établissement doit pouvoir réaliser toute une année scolaire sans
Excel pour calculer ses résultats.

### Finance

L'établissement doit connaître instantanément :

-   ce qui a été facturé ;
-   ce qui a été encaissé ;
-   ce qui reste dû ;
-   les créances en retard.

### Direction

Les principaux KPI doivent être accessibles en temps réel.

### Enseignant

L'appel et la saisie des notes doivent être utilisables depuis un
téléphone.

### Parent

Le parent doit pouvoir consulter :

-   résultats ;
-   absences ;
-   paiements ;
-   reçus ;
-   communications.

### SaaS

Un nouvel établissement standard doit pouvoir être créé sans
intervention d'un développeur ACC.

### Réglementation

Une règle académique doit pouvoir être modifiée et versionnée sans
nécessiter une nouvelle version applicative.

------------------------------------------------------------------------

## 64. Exigences non fonctionnelles

Le produit doit viser :

-   haute disponibilité ;
-   performances compatibles avec plusieurs milliers d'utilisateurs
    simultanés ;
-   isolation stricte des tenants ;
-   traçabilité ;
-   sauvegarde et restauration ;
-   responsive design ;
-   accessibilité ;
-   internationalisation ;
-   extensibilité ;
-   observabilité ;
-   testabilité ;
-   sécurité par défaut.

------------------------------------------------------------------------

## 65. Positionnement

Positionnement recommandé :

> **ScolarFlow --- Le système d'exploitation de votre établissement.**

Architecture fonctionnelle cible :

``` text
                    SCOLARFLOW
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
  ADMINISTRATION     ACADÉMIQUE          FINANCE
       │                 │                  │
       └─────────────┬───┴──────────────┬───┘
                     │                  │
                   PARENTS          ENSEIGNANTS
                     │                  │
                     └────────┬─────────┘
                              │
                           ÉLÈVES
                              │
                 ┌────────────┴───────────┐
                 │                        │
                LMS                      AI
                 │                        │
                 └────────────┬───────────┘
                              │
                         ANALYTICS
```

------------------------------------------------------------------------

## 66. Principes de développement

1.  **Multi-tenant dès le premier jour.**
2.  **Aucune règle académique importante codée en dur.**
3.  **Configuration avant personnalisation spécifique.**
4.  **Mobile First.**
5.  **API First pour les nouveaux domaines.**
6.  **Audit systématique des opérations sensibles.**
7.  **Feature Flags pour contrôler le déploiement des fonctionnalités.**
8.  **Modular Monolith avant microservices.**
9.  **Tests automatisés obligatoires sur les calculs académiques et
    financiers.**
10. **L'IA assiste mais ne remplace pas les décisions réglementaires
    humaines.**

------------------------------------------------------------------------

## 67. Découpage recommandé des spécifications de développement

Le PRD constitue la spécification maître.

Le développement peut ensuite être découpé en spécifications
indépendantes :

``` text
001-saas-core
002-auth-rbac
003-organization-campus
004-academic-core
005-primary
006-secondary
007-admissions
008-students-guardians
009-teachers-staff
010-attendance
011-assessments-grades
012-rules-engine
013-report-cards
014-finance
015-payments
016-communications
017-scheduling
018-examinations
019-higher-education
020-bts
021-internships-defenses
022-lms
023-virtual-school
024-documents
025-analytics
026-ai
027-subscriptions-billing
028-integrations
029-mobile-offline
030-security-audit
```

Chaque spécification devra ensuite contenir :

-   objectifs ;
-   périmètre ;
-   acteurs ;
-   User Stories ;
-   règles métier ;
-   critères d'acceptation ;
-   modèles de données ;
-   endpoints API ;
-   écrans ;
-   permissions ;
-   événements ;
-   tests ;
-   cas limites ;
-   dépendances.

------------------------------------------------------------------------

## 68. Conclusion

ScolarFlow doit évoluer d'une application de gestion des compositions du
primaire vers une **plateforme éducative SaaS complète et modulaire**.

Le cœur de la stratégie repose sur :

-   un SaaS Core multi-tenant ;
-   un Academic Rules Engine versionné ;
-   quatre packs métier ;
-   une architecture modulaire ;
-   une finance scolaire intégrée ;
-   des portails dédiés aux acteurs ;
-   un LMS natif ;
-   des fonctions d'IA transversales ;
-   une conception initialement adaptée à la Côte d'Ivoire mais
    extensible à l'Afrique francophone.

Le développement doit commencer par consolider le socle SaaS et les
packs **Primary + Secondary**, avant d'étendre progressivement le
produit vers **Higher** puis **Virtual**.
