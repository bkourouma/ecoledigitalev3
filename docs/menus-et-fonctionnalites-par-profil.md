# EcoleDigitale — Menus et fonctionnalités par profil

**Document de présentation** — inventaire des menus activés et des fonctionnalités page par page, pour les cinq profils : **Administrateur**, **Propriétaire (Owner)**, **Enseignant (Teacher)**, **Étudiant (Student)** et **Parent**.

> Source : menu latéral (`apps/web/src/components/layout/Sidebar.tsx`) et pages Next.js actuelles.  
> Date : août 2026.  
> Usage : chaque titre de niveau 2 ou 3 peut devenir une diapositive PowerPoint.

---

## Comment utiliser ce document pour PowerPoint

| Diapositive | Contenu à reprendre |
|---|---|
| 1 | Titre + 5 profils |
| 2 | Tableau de comparaison (section 2) |
| 3 | Connexion et page d’atterrissage (section 3) |
| 4–6 | Arborescence des menus (section 4) |
| 7+ | Une diapositive par **groupe de menu**, avec les puces « Ce que l’on peut faire » |
| Fin | Matrice récapitulative + notes (menus personnalisables) |

**Convention des puces :**

- **Consulter** — lecture seule (listes, KPI, PDF).
- **Créer / Modifier / Supprimer** — saisie et administration.
- **Valider / Générer / Exporter** — actions de clôture ou de document.

---

## 1. Les cinq profils en une diapositive

| Profil | Rôle dans l’établissement | Nature de l’espace | Page d’arrivée après connexion |
|---|---|---|---|
| **Administrateur** (`admin`) | Gère le quotidien de l’école | Opérationnel : saisie, configuration, documents | `/tableau-de-bord` |
| **Propriétaire** (`owner`) | Dirige et pilote | Décisionnel : indicateurs, alertes, exports | `/owner/dashboard` |
| **Enseignant** (`teacher`) | Enseigne et évalue | Pédagogique : cours, présences, notes, paie | `/teacher/dashboard` |
| **Étudiant** (`student`) | Suit sa formation | Personnel : cours, devoirs, notes, paiements | `/student/courses` |
| **Parent** (`parent`) | Suit ses enfants | Consultation + messagerie | `/parent/children` |

Un compte peut porter plusieurs rôles. À la connexion, l’utilisateur choisit le **rôle actif** (`/select-role`) : le menu affiché est alors celui de ce rôle.

---

## 2. Comparaison globale (diapositive de synthèse)

| | Admin | Owner | Teacher | Student | Parent |
|---|:---:|:---:|:---:|:---:|:---:|
| Configurer l’école (cycles, filières, UE, salles) | Oui | Non | Non | Non | Non |
| Inscrire / encaisser / délivrer des documents | Oui | Non | Non | Auto-inscription | Non |
| Voir les KPI de direction | Non | Oui | Non | Non | Non |
| Faire l’appel et noter | Oui | Non | Oui | Non | Non |
| Rendre un devoir / consulter son bulletin | Non | Non | Non | Oui | Consulter l’enfant |
| Messagerie | Oui | Non | Oui | Oui | Oui |
| Gérer les accès et les rôles | Oui | Oui (page Accès) | Non | Non | Non |

---

## 3. Connexion et navigation commune

### 3.1 Connexion (`/login`)

- Choix de l’**établissement** (tenant).
- Saisie email / mot de passe.
- Redirection vers la page d’atterrissage du rôle actif.

### 3.2 Choix de rôle (`/select-role`)

- Affiché si le compte a plusieurs rôles.
- Le menu et les droits sont limités au rôle choisi.
- Le rôle peut être changé sans se reconnecter.

### 3.3 Pied de menu (tous les profils)

- Identité de l’utilisateur connecté (nom, email).
- **Settings** (bouton présent).
- **Logout** — déconnexion et invalidation du jeton.

---

## 4. Arborescence des menus activés

Les menus ci-dessous sont ceux **affichés par défaut**. Un administrateur peut retirer des entrées par rôle depuis **Accès → Menus par rôle**. Sans configuration, tout le catalogue ci-dessous est visible.

---

### 4.1 Menu Administrateur

```
Tableau de bord

Structure Académique
  ├── Cycles & Programmes
  │     ├── Cycles
  │     └── Filières
  └── Personnes
        ├── Enseignants
        ├── Étudiants
        └── Parents

Module Professionnel
  ├── Programme          → UE · ECUE · Semestres
  ├── Sessions & Planning → Classes · Salles · Planning des cours
  ├── Étudiants          → Inscriptions · Étudiants inscrits · Paiements
  ├── Suivi & Évaluation → Présences · Conduite · Notes · Rattrapages · Bulletins
  └── Documents officiels → Attestations · Diplômes · Signataires

Opérations Académiques
  ├── Année Académique   → Démarrer Année · Classes · Affectations Cours · Inscriptions
  ├── BTS                → Moyennes semestre
  ├── Post BTS           → Génération Planning · Calendrier Cours · Statistiques Planning
  ├── Catalogue Formations → Catalogue · Calendrier des Sessions · Page Publique
  └── Administration Pro → Gestion des Sessions · Créer une Session · Formateurs

Rémunération
  └── Configuration · Validation des séances · Bulletin de paiement · Historique

Finances Étudiantes
  └── Scolarité · Échéanciers · Paiements Étudiants · Rapports Financiers

Communication
  └── Messages

Administration
  └── Accès · Rôles · Utilisateurs
```

### 4.2 Menu Propriétaire (Owner)

Tous les blocs sont **dépliés** (pas de sous-menus repliables) : le dirigeant voit l’ensemble d’un coup d’œil.

```
Propriétaire
  └── Pilotage

Argent
  ├── Finances
  ├── Trésorerie
  ├── Recouvrement UE
  └── Économie

Effectifs
  ├── Personnes
  └── Remplissage

Pédagogie
  ├── Académique
  ├── Résultats
  ├── Assiduité
  └── Risque

Structure
  └── Référentiel
```

### 4.3 Menu Enseignant (Teacher)

```
Tableau de Bord

Mes Cours
  └── Gestion des Cours → Mes Cours · Planning · Présences · Notes

Mes Étudiants
  └── Liste des Étudiants · Communications

Évaluations
  └── Mes évaluations · Assigner un devoir · Corrections en Attente

Mes Rémunérations
  └── Heures Enseignées · Séances Professionnelles · Mes Paiements

Rapports & Analyses
  └── Dashboard Analytique

Profil
  └── Informations Personnelles
```

### 4.4 Menu Étudiant (Student)

```
Académique
  └── Mes Études → Mes Cours · Emploi du Temps · Devoirs · Mes Notes · Mon Bulletin · Module Professionnel

Communication
  └── Messages

Assistance
  └── Aide & Support → Tuteur IA · Support

Mes Finances
  └── Paiements & Reçus → Mes Paiements

Profil
  └── Mon Profil
```

### 4.5 Menu Parent

```
Suivi des Enfants
  └── Mes Enfants → Mes Enfants · Cours & Devoirs · Bulletins & Reçus · Messages · Parcours Professionnel · Diplômes de mon enfant
```

---

# PARTIE A — Administrateur (`admin`)

**Intention :** faire tourner l’établissement au quotidien — configurer, inscrire, noter, encaisser, délivrer.

**Page d’arrivée :** Tableau de bord (`/tableau-de-bord`).

---

## A.1 Tableau de bord

| | |
|---|---|
| **Menu** | Tableau de bord |
| **Route** | `/tableau-de-bord` |
| **À quoi ça sert** | Vue consolidée de l’établissement et accès rapide à toutes les sections. |

**Fonctionnalités**

- Consulter les indicateurs calculés en temps réel : étudiants, enseignants, parents, filières, UE / ECUE, cohortes, inscriptions, recouvrement module professionnel.
- Accéder aux écrans du menu via des cartes de raccourcis (même regroupement que la barre latérale).
- Lecture seule : aucune création ni modification sur cette page.

---

## A.2 Structure Académique

### A.2.1 Cycles

| | |
|---|---|
| **Menu** | Structure Académique → Cycles & Programmes → Cycles |
| **Route** | `/academic/cycles` |

**Fonctionnalités**

- Lister les cycles (Licence, Master, BTS, etc.) avec statistiques.
- Rechercher par texte ; filtrer par statut.
- **Créer**, **voir**, **modifier**, **supprimer** un cycle.
- Sous-pages : `/academic/cycles/new`, `/academic/cycles/[id]`, `/academic/cycles/[id]/edit`.

### A.2.2 Filières

| | |
|---|---|
| **Menu** | Structure Académique → Cycles & Programmes → Filières |
| **Route** | `/academic/programmes` |

**Fonctionnalités**

- Lister les filières (programmes) rattachées à un cycle.
- Filtrer par cycle.
- **Créer**, **voir**, **modifier**, **supprimer** une filière.
- Sous-pages : `/academic/programmes/new`, `/academic/programmes/[id]`, `/academic/programmes/[id]/edit`.

### A.2.3 Enseignants

| | |
|---|---|
| **Menu** | Structure Académique → Personnes → Enseignants |
| **Route** | `/academic/teachers` |

**Fonctionnalités**

- Annuaire des enseignants (recherche nom, email, matricule, spécialités).
- Pagination (10 / 50 / 100).
- **Créer**, **voir**, **modifier**, **supprimer**.
- **Exporter** la liste filtrée en PDF et Word.
- Consulter les affectations d’un enseignant (`/academic/teachers/[id]/assignments`).

### A.2.4 Étudiants

| | |
|---|---|
| **Menu** | Structure Académique → Personnes → Étudiants |
| **Route** | `/academic/students` |

**Fonctionnalités**

- Gestion des fiches étudiants (matricule, n° séquentiel).
- Recherche, pagination.
- **Créer**, **voir**, **modifier**, **supprimer**.
- Sous-pages : `/academic/students/new`, `/academic/students/[id]`, `/academic/students/[id]/edit`.

### A.2.5 Parents

| | |
|---|---|
| **Menu** | Structure Académique → Personnes → Parents |
| **Route** | `/academic/parents` |

**Fonctionnalités**

- Annuaire des parents ; statistiques (total, avec enfants).
- **Créer**, **voir**, **modifier**, **supprimer** (suppression bloquée s’il reste des enfants liés).
- **Assigner / désassigner** un enfant à un parent (`/academic/parents/assign`) : type de relation, contact principal, urgence, autorisation de récupération.

---

## A.3 Module Professionnel — Programme

### A.3.1 UE (Unités d’Enseignement)

| | |
|---|---|
| **Menu** | Module Professionnel → Programme → UE |
| **Route** | `/professionnel/admin/ue` |

**Fonctionnalités**

- Catalogue des UE (prix, UV, composition, prérequis).
- Filtrer par filière ; paginer.
- **Créer**, **voir**, **modifier**, **supprimer**.
- **Exporter** PDF / Word (colonnes configurables).

### A.3.2 ECUE

| | |
|---|---|
| **Menu** | Module Professionnel → Programme → ECUE |
| **Route** | `/professionnel/admin/matieres` |

**Fonctionnalités**

- Catalogue des ECUE (éléments constitutifs : pôle pédagogique, type de bilan).
- Filtrer par filière et UE.
- **Créer**, **voir**, **modifier**, **supprimer**.
- Les ECUE « Conduite » sont gérées sur la page Conduite, pas ici.

### A.3.3 Semestres

| | |
|---|---|
| **Menu** | Module Professionnel → Programme → Semestres |
| **Route** | `/professionnel/admin/semestres` |

**Fonctionnalités**

- Composer un semestre à partir d’UE, par filière.
- Filtrer par filière.
- **Créer**, **voir**, **modifier**, **supprimer**.
- **Exporter** la liste en PDF / Word.

---

## A.4 Module Professionnel — Sessions & Planning

### A.4.1 Classes (sessions / cohortes)

| | |
|---|---|
| **Menu** | Module Professionnel → Sessions & Planning → Classes |
| **Route** | `/professionnel/admin/sessions` |

**Fonctionnalités**

- Gérer les cohortes (sessions) : UE, semestre, dates, année scolaire.
- Onglets **actives** / **historique** ; filtres filière et année ; regroupement par lot.
- **Créer**, **voir**, **modifier**, **supprimer** (y compris par lot).
- **Exporter** une fiche PDF (session + inscrits par UE).
- Vue semestre : `/professionnel/admin/sessions/semestre/[id]`.

### A.4.2 Salles de classe

| | |
|---|---|
| **Menu** | Module Professionnel → Sessions & Planning → Salles de classe |
| **Route** | `/academic/classrooms` |

**Fonctionnalités**

- Référentiel des salles (recherche, salles actives).
- **Créer**, **modifier**, **supprimer**.
- **Exporter** en PDF.

### A.4.3 Planning des cours

| | |
|---|---|
| **Menu** | Module Professionnel → Sessions & Planning → Planning des cours |
| **Route** | `/professionnel/admin/planning` |

**Fonctionnalités**

- Construire l’emploi du temps hebdomadaire (créneaux ECUE + salle).
- Choisir filière puis semestre ; ajouter / supprimer des créneaux en brouillon.
- **Enregistrer en lot**.
- **Exporter** PDF / Word.
- Consultation lecture seule : `/professionnel/admin/planning/consultation`.

---

## A.5 Module Professionnel — Étudiants

### A.5.1 Inscriptions

| | |
|---|---|
| **Menu** | Module Professionnel → Étudiants → Inscriptions |
| **Route** | `/professionnel/admin/inscriptions` |

**Fonctionnalités**

- Inscrire **en masse** des étudiants à des sessions actives (sans paiement).
- Sélection multiple d’étudiants et de sessions.
- Exclusion automatique des sessions « Conduite » et des sessions terminées.

### A.5.2 Étudiants inscrits

| | |
|---|---|
| **Menu** | Module Professionnel → Étudiants → Étudiants inscrits |
| **Route** | `/professionnel/admin/inscrits` |

**Fonctionnalités**

- Suivre les inscriptions confirmées, groupées par étudiant et filière.
- Filtrer par filière, année scolaire ; rechercher.
- Consulter le détail (UE, statuts de paiement).

### A.5.3 Paiements (module professionnel)

| | |
|---|---|
| **Menu** | Module Professionnel → Étudiants → Paiements |
| **Route** | `/professionnel/admin/paiements` |

**Fonctionnalités**

- Encaisser les frais du module professionnel (par étudiant / filière).
- Filtrer par filière, année, statut (non réglé / partiel / soldé).
- **Enregistrer un paiement** (partiel ou solde ; espèces, mobile, virement).
- Consulter l’historique des règlements.
- **Générer un reçu PDF**.

---

## A.6 Module Professionnel — Suivi & Évaluation

### A.6.1 Présences

| | |
|---|---|
| **Menu** | Module Professionnel → Suivi & Évaluation → Présences |
| **Route** | `/professionnel/admin/presences` |

**Fonctionnalités**

- Synthèse des appels et absences par étudiant (taux d’absence en heures).
- Filtres : filière, année, statut de session, semestre, recherche.
- **Exporter** en PDF.
- Détail par étudiant ou par séance.

### A.6.2 Conduite

| | |
|---|---|
| **Menu** | Module Professionnel → Suivi & Évaluation → Conduite |
| **Route** | `/professionnel/admin/conduite` |

**Fonctionnalités**

- Saisir la note de conduite (/20) par semestre.
- Filtrer par filière et semestre (cohortes à finaliser).
- Voir le récapitulatif des présences.
- Saisie avec enregistrement automatique ; suppression d’une note.

### A.6.3 Notes

| | |
|---|---|
| **Menu** | Module Professionnel → Suivi & Évaluation → Notes |
| **Route** | `/professionnel/admin/notes` |

**Fonctionnalités**

- Saisir les notes de **session 1** (devoirs, examens) sur les cohortes actives.
- Filtrer filière → semestre → session ; grille par ECUE.
- **Recalculer** la session ; **enregistrer tout**.
- **Clôturer le semestre** (passage en historique).
- Consulter l’historique des cohortes terminées (`/professionnel/admin/notes/historique`) — lecture seule, export PDF / Word.

### A.6.4 Rattrapages

| | |
|---|---|
| **Menu** | Module Professionnel → Suivi & Évaluation → Rattrapages |
| **Route** | `/professionnel/admin/notes/rattrapages` |

**Fonctionnalités**

- Session 2 : rattrapage des ECUE non validées.
- Filtrer les rattrapages en attente.
- **Saisir la note d’examen S2** (recalcul automatique).
- **Exporter** en PDF.

### A.6.5 Bulletins

| | |
|---|---|
| **Menu** | Module Professionnel → Suivi & Évaluation → Bulletins |
| **Route** | `/professionnel/admin/bulletins` |

**Fonctionnalités**

- Générer et clôturer les bulletins semestriels (LMD / BTS).
- Filtrer par filière et semestre.
- **Recalculer** ; **générer** (provisoire ou définitif) ; **clôturer**.
- **PDF individuel**, **PDF BTS** (L1 / L2), **PDF de tous les bulletins**.
- Archives : `/professionnel/admin/bulletins/historique`.

---

## A.7 Module Professionnel — Documents officiels

### A.7.1 Attestations de réussite

| | |
|---|---|
| **Menu** | Module Professionnel → Documents officiels → Attestations de réussite |
| **Route** | `/professionnel/admin/attestations` |

**Fonctionnalités**

- Lister les étudiants selon l’éligibilité (UE requises validées).
- Filtrer par cycle, filière, année, statut ; rechercher.
- Voir la barre de progression.
- **Générer l’attestation PDF** par étudiant ; **exporter la liste** en PDF.

### A.7.2 Diplômes

| | |
|---|---|
| **Menu** | Module Professionnel → Documents officiels → Diplômes |
| **Route** | `/professionnel/admin/diplomes` |

**Fonctionnalités**

- Délivrer les diplômes de cycle (Licence, Master, etc.).
- Filtrer par grade, cycle, année, statut (tous / éligibles / obtenus).
- **Configurer le cycle** ; **attribuer un diplôme**.
- **PDF diplôme** ; **attestation d’authenticité** ; **export liste PDF**.

### A.7.3 Signataires

| | |
|---|---|
| **Menu** | Module Professionnel → Documents officiels → Signataires |
| **Route** | `/professionnel/admin/signataires` |

**Fonctionnalités**

- Personnaliser les signataires des documents officiels (nom, qualité, fonction).
- **Enregistrer** par rôle de signataire.

---

## A.8 Opérations Académiques — Année Académique

### A.8.1 Démarrer Année

| | |
|---|---|
| **Menu** | Opérations Académiques → Année Académique → Démarrer Année |
| **Route** | `/annee-academique/demarrer` |

**Fonctionnalités**

- **Créer**, **activer**, **modifier**, **supprimer** une année académique.
- Gérer les **périodes** (semestres / trimestres) : dates, CRUD.

### A.8.2 Classes (année académique)

| | |
|---|---|
| **Menu** | Opérations Académiques → Année Académique → Classes |
| **Route** | `/annee-academique/ajouter-classe` |

**Fonctionnalités**

- Gérer les classes de l’année active (effectifs, cours).
- Rechercher ; filtrer par filière.
- **Créer**, **voir**, **modifier**, **supprimer**.

### A.8.3 Affectations Cours

| | |
|---|---|
| **Menu** | Opérations Académiques → Année Académique → Affectations Cours |
| **Route** | `/academic/assignments` |

**Fonctionnalités**

- Affecter un enseignant à un cours et à une classe.
- Filtrer par enseignant, classe, statut ; rechercher.
- **Créer**, **modifier**, **supprimer**.
- **Générer les créneaux manquants** pour les affectations actives.

### A.8.4 Inscriptions (année académique)

| | |
|---|---|
| **Menu** | Opérations Académiques → Année Académique → Inscriptions |
| **Route** | `/annee-academique/inscription` |

**Fonctionnalités**

- Inscrire les étudiants aux classes de l’année active.
- Rechercher ; filtrer par classe ; afficher les montants.
- **Créer**, **modifier**, **supprimer**.
- Alerte s’il n’y a pas d’année active.

---

## A.9 Opérations Académiques — BTS

### A.9.1 Moyennes semestre

| | |
|---|---|
| **Menu** | Opérations Académiques → BTS → Moyennes semestre |
| **Route** | `/annee-academique/moyennes-semestre` |

**Fonctionnalités**

- Matrice de notes BTS par classe / période / cours.
- **Saisir** notes et heures ; **sauvegarder**.
- **Importer / exporter Excel**.
- **Générer** certificats de présence PDF (classe ou individuel) et relevés de notes PDF.

---

## A.10 Opérations Académiques — Post BTS

### A.10.1 Génération Planning

| | |
|---|---|
| **Menu** | Opérations Académiques → Post BTS → Génération Planning |
| **Route** | `/simple-schedule` |

**Fonctionnalités**

- Générer un emploi du temps simplifié.
- Choisir la classe et la date de début.
- Composer les créneaux (jour × horaire × cours × enseignant).
- **Générer le planning**.

### A.10.2 Calendrier Cours

| | |
|---|---|
| **Menu** | Opérations Académiques → Post BTS → Calendrier Cours |
| **Route** | `/schedule-generation/calendar` |

**Fonctionnalités**

- Visualiser les séances générées, semaine par semaine.
- Choisir la classe ; consulter les statistiques.
- **Supprimer une séance**.

### A.10.3 Statistiques Planning

| | |
|---|---|
| **Menu** | Opérations Académiques → Post BTS → Statistiques Planning |
| **Route** | `/schedule-generation/stats` |

**Fonctionnalités**

- Analytics du planning d’une classe : sessions, heures, cours, enseignants.
- Répartition par statut ; détail par cours et par enseignant.

---

## A.11 Catalogue et Administration des formations professionnelles

*(Formations courtes / e-learning, distinctes du module LMD professionnel.)*

### A.11.1 Catalogue

| | |
|---|---|
| **Menu** | Opérations Académiques → Catalogue Formations → Catalogue |
| **Route** | `/formations-professionnelles/catalogue` |

**Fonctionnalités**

- Parcourir le catalogue (recherche, filtres, tri, pagination).
- **Créer / modifier** une formation (admin).
- Consulter la fiche formation et ses sessions.

### A.11.2 Calendrier des Sessions

| | |
|---|---|
| **Menu** | Opérations Académiques → Catalogue Formations → Calendrier des Sessions |
| **Route** | `/formations-professionnelles/sessions` |

**Fonctionnalités**

- Consulter les sessions ouvertes (filtres formation, mode, statut).
- Accéder à la fiche session et au lien d’inscription.

### A.11.3 Page Publique

| | |
|---|---|
| **Menu** | Opérations Académiques → Catalogue Formations → Page Publique |
| **Route** | `/formations-professionnelles/public` |

**Fonctionnalités**

- Vitrine publique des formations (présentation, achat en ligne).
- Ouvrir la page publique d’une formation.

### A.11.4 Gestion des Sessions

| | |
|---|---|
| **Menu** | Opérations Académiques → Administration Pro → Gestion des Sessions |
| **Route** | `/formations-professionnelles/admin/sessions` |

**Fonctionnalités**

- Back-office des sessions : filtres, tri, pagination, sélection multiple.
- **Voir**, **modifier**, **supprimer**.

### A.11.5 Créer une Session

| | |
|---|---|
| **Menu** | Opérations Académiques → Administration Pro → Créer une Session |
| **Route** | `/formations-professionnelles/admin/sessions/creer` |

**Fonctionnalités**

- Assistant (wizard) multi-étapes pour créer une session.

### A.11.6 Formateurs

| | |
|---|---|
| **Menu** | Opérations Académiques → Administration Pro → Formateurs |
| **Route** | `/formations-professionnelles/admin/formateurs` |

**Fonctionnalités**

- Gérer les comptes formateurs des formations courtes.
- **Créer**, **voir**, **modifier**, **supprimer**.
- **Réinitialiser le mot de passe** (affichage temporaire).

---

## A.12 Rémunération des enseignants

### A.12.1 Configuration

| | |
|---|---|
| **Menu** | Rémunération → Configuration |
| **Route** | `/payments/teacher-configs` |

**Fonctionnalités**

- Définir les barèmes de paie (salaire fixe, horaire, mixte).
- Filtrer par enseignant.
- **Créer**, **modifier**, **supprimer** une configuration.
- Indicateurs actif / expiré.

### A.12.2 Validation des séances

| | |
|---|---|
| **Menu** | Rémunération → Validation des séances |
| **Route** | `/professionnel/admin/remuneration/seances` |

**Fonctionnalités**

- Valider les séances professionnelles payables.
- Filtrer par cohorte, enseignant, statut.
- Détecter les chevauchements et les séances manquantes par rapport à l’emploi du temps.
- **Valider** (unitaire ou lot) ; **ajuster la durée** ; **créer une séance comptable**.

### A.12.3 Bulletin de paiement

| | |
|---|---|
| **Menu** | Rémunération → Bulletin de paiement |
| **Route** | `/professionnel/admin/remuneration/bulletins` |

**Fonctionnalités**

- Calculer et archiver les bulletins de paie.
- Vue de tous les enseignants et de l’état de leur configuration.
- **Créer une période** ; **calculer** ; **archiver** (lot ou individuel).

### A.12.4 Historique des paiements

| | |
|---|---|
| **Menu** | Rémunération → Historique des paiements |
| **Route** | `/professionnel/admin/remuneration/historique` |

**Fonctionnalités**

- Consulter les bulletins archivés.
- Filtrer par enseignant, période, statut (payé / impayé).
- **Marquer comme versé** ; **exporter en PDF**.

---

## A.13 Finances étudiantes (scolarité académique)

### A.13.1 Scolarité

| | |
|---|---|
| **Menu** | Finances Étudiantes → Scolarité |
| **Route** | `/admin/finances/scolarite` |

**Fonctionnalités**

- Définir le barème des frais par couple **cycle + filière**.
- Saisir inscription, scolarité, annexes, autres.
- **Enregistrer**.

### A.13.2 Échéanciers

| | |
|---|---|
| **Menu** | Finances Étudiantes → Échéanciers |
| **Route** | `/admin/finances/tuition-schedules` |

**Fonctionnalités**

- Créer des plans de paiement échelonné.
- Rechercher ; filtrer par statut.
- **Créer**, **modifier**, **supprimer**.
- **Générer les échéances** pour les étudiants.

### A.13.3 Paiements Étudiants

| | |
|---|---|
| **Menu** | Finances Étudiantes → Paiements Étudiants |
| **Route** | `/admin/finances/student-payments` |

**Fonctionnalités**

- Encaisser la scolarité académique (hors module professionnel).
- Choisir classe puis étudiant.
- Onglets résumé / échéances / historique.
- **Encaisser** (type de frais, montant, mode) ; **télécharger le reçu PDF**.

### A.13.4 Rapports Financiers

| | |
|---|---|
| **Menu** | Finances Étudiantes → Rapports Financiers |
| **Route** | `/admin/finances/reports` |

**Fonctionnalités**

- Hub des rapports : revenus par type, état par étudiant, performance par classe, évolution mensuelle.
- Accès aux sous-pages `/admin/finances/reports/revenue`, `/students`, `/classes`, `/monthly`.

---

## A.14 Communication

### A.14.1 Messages

| | |
|---|---|
| **Menu** | Communication → Messages |
| **Route** | `/admin/messages` |

**Fonctionnalités**

- Messagerie email de l’établissement.
- Onglets **Nouveau message**, **Boîte de réception**, **Historique**.
- Réponse pré-remplie.
- Alerte si l’email n’est pas configuré.

---

## A.15 Administration

### A.15.1 Accès

| | |
|---|---|
| **Menu** | Administration → Accès |
| **Route** | `/owner/acces` |

**Fonctionnalités**

- Onglet **Utilisateurs** : attribuer ou retirer les rôles socle (owner, admin, enseignant, étudiant, parent, formateur).
- Onglet **Menus par rôle** : retirer des entrées de menu pour un rôle.
- Sauvegarde par utilisateur / par rôle.

### A.15.2 Rôles

| | |
|---|---|
| **Menu** | Administration → Rôles |
| **Route** | `/admin/roles` |

**Fonctionnalités**

- Créer des **rôles administratifs personnalisés** (ex. scolarité, pédagogie).
- Cocher les menus du catalogue autorisés pour ce rôle.
- **Créer**, **modifier**, **supprimer** un rôle.

### A.15.3 Utilisateurs

| | |
|---|---|
| **Menu** | Administration → Utilisateurs |
| **Route** | `/admin/utilisateurs` |

**Fonctionnalités**

- Gérer les comptes administrateurs de l’établissement.
- **Créer** un utilisateur (nom, email, mot de passe, rôle admin).
- **Changer le rôle** d’un compte existant.

---

## A.16 Synthèse Administrateur (diapositive)

| Domaine | Actions typiques |
|---|---|
| Structure | CRUD cycles, filières, enseignants, étudiants, parents |
| Module pro | Catalogue UE/ECUE, cohortes, planning, inscriptions, encaissement, notes, bulletins, diplômes |
| Année académique | Année, classes, affectations, inscriptions BTS / Post-BTS |
| Formations courtes | Catalogue, sessions, formateurs |
| Paie enseignants | Configurer, valider les séances, calculer, archiver, marquer versé |
| Finances élèves | Barèmes, échéanciers, encaissement, rapports |
| Gouvernance | Accès, rôles, utilisateurs, messagerie |

---

# PARTIE B — Propriétaire (`owner`)

**Intention :** piloter l’établissement — voir, comparer, exporter, alerter. Ce n’est **pas** l’espace de saisie des notes ou des inscriptions.

**Page d’arrivée :** Pilotage (`/owner/dashboard`).

Les écrans partagent une **barre de filtres** : période, année scolaire, cycle, filières.

---

## B.1 Pilotage

| | |
|---|---|
| **Menu** | Propriétaire → Pilotage |
| **Route** | `/owner/dashboard` (alias `/owner`) |

**Fonctionnalités**

- Consulter les KPI de tête : CA du mois, taux de recouvrement, effectif étudiants, taux d’assiduité.
- Graphique de recouvrement par cycle.
- Panneau d’**alertes** prioritaires.
- Quatre cartes de synthèse : académique, RH, formations courtes, module professionnel.
- Lecture seule.

---

## B.2 Argent

### B.2.1 Finances

| | |
|---|---|
| **Menu** | Argent → Finances |
| **Route** | `/owner/finances` |

**Fonctionnalités**

- Suivre le recouvrement de la scolarité académique, les impayés, la masse salariale.
- KPI : attendu / perçu, taux de recouvrement, retards, masse salariale.
- Tableaux : recouvrement par classe, extraits d’impayés, rémunérations enseignants.
- **Valider** un paiement enseignant au statut « calculated » (seule action d’écriture de cet espace finances).
- Lien vers l’export du rapport financier.

### B.2.2 Trésorerie

| | |
|---|---|
| **Menu** | Argent → Trésorerie |
| **Route** | `/owner/finances/tresorerie` |

**Fonctionnalités**

- Vue cash-flow scolarité + module professionnel.
- Totaux : encaissé, attendu, reste à recouvrer, dont échu.
- Graphiques : balance âgée, encaissements par mode, courbe vs N-1.
- Tableau des impayés par filière (tranches 0–30–60–90+ jours).
- Journal de caisse (recherche, pagination).
- Alertes d’anomalies (commande payée sans paiement, encaissement sans reçu).
- **Exporter le journal en CSV**.

### B.2.3 Recouvrement UE

| | |
|---|---|
| **Menu** | Argent → Recouvrement UE |
| **Route** | `/owner/finances/professionnel` |

**Fonctionnalités**

- Piloter le CA et les encaissements des inscriptions UE (module LMD).
- KPI : CA attendu, encaissé, taux, reste à recouvrer, étudiants non soldés.
- Graphiques : mensuel, modes de paiement, par filière, par UE, entonnoir.
- Top 20 des impayés.
- Filtres mode / état de règlement ; **export CSV**.

### B.2.4 Économie

| | |
|---|---|
| **Menu** | Argent → Économie |
| **Route** | `/owner/economie` |

**Fonctionnalités**

- Lire la rentabilité pédagogique, la rétention, la prévision de trésorerie.
- KPI : encaissé, marge brute, familles / fratries, semaine de rupture.
- Courbe de prévision 13 semaines (prudent / médian / optimiste).
- Tableaux : marge par filière, rétention inter-semestres, valeur par famille.
- **Export CSV**. Bandeau d’avertissement si les charges ne sont pas saisies.

---

## B.3 Effectifs

### B.3.1 Personnes

| | |
|---|---|
| **Menu** | Effectifs → Personnes |
| **Route** | `/owner/personnes` |

**Fonctionnalités**

- Voir la démographie : étudiants, enseignants, parents actifs, ratio élèves/enseignants.
- Graphiques : sexe, contrats, pyramide des âges, effectifs par filière, nationalités.
- Couverture des données (sans parent, sans date de naissance, enseignant sans compte).
- Tableau enseignants (contrat, ancienneté, ECUE, filières).
- **Export CSV**.

### B.3.2 Remplissage

| | |
|---|---|
| **Menu** | Effectifs → Remplissage |
| **Route** | `/owner/remplissage` |

**Fonctionnalités**

- Taux de remplissage des cohortes et des classes.
- Alertes cohortes urgentes (< 14 jours, mal remplies) et cohortes vides.
- Conflits d’emploi du temps (salle / enseignant).
- Complétude du planning (créneaux sans salle ou sans enseignant).
- **Export CSV**.

---

## B.4 Pédagogie

### B.4.1 Académique

| | |
|---|---|
| **Menu** | Pédagogie → Académique |
| **Route** | `/owner/academique` |

**Fonctionnalités**

- Performance du module académique classique.
- KPI devoirs corrigés ; classes à risque (moyenne sous le seuil).
- Tableaux de moyennes par classe ; graphique par période.
- Heatmap d’assiduité (8 semaines) ; réussite par programme.
- Tri des colonnes. Pas de saisie de notes.

### B.4.2 Résultats

| | |
|---|---|
| **Menu** | Pédagogie → Résultats |
| **Route** | `/owner/pedagogie` |

**Fonctionnalités**

- Pilotage pédagogique du **module professionnel LMD**.
- KPI : taux de réussite, moyenne, crédits validés, rattrapage, bulletins définitifs.
- Graphiques : décisions par filière, évolution des moyennes, ECUE échouées, poids de la session 2.
- Tableau de santé par UE.
- Filtres semestre / statut / catégorie UE ; **export CSV**.

### B.4.3 Assiduité

| | |
|---|---|
| **Menu** | Pédagogie → Assiduité |
| **Route** | `/owner/assiduite` |

**Fonctionnalités**

- Présences, occupation des salles, charge enseignante.
- KPI : présence, heures d’absence, appels effectués, occupation, heures planifiées.
- Alerte ECUE sans enseignant.
- Heatmaps assiduité et occupation ; top absents ; charge enseignants.
- **Export CSV**.

### B.4.4 Risque

| | |
|---|---|
| **Menu** | Pédagogie → Risque |
| **Route** | `/owner/risque` |

**Fonctionnalités**

- Décrochage, retard de saisie, corrélation assiduité / résultats.
- KPI : à rappeler, à surveiller, enseignants en retard, étudiants suivis.
- Liste d’appels (score, motif, contact, absences, moyenne, reste dû) avec lien téléphone.
- Tableau d’avancement de saisie par enseignant ; nuage de points assiduité vs moyenne.
- **Exporter la liste d’appels en CSV**.

---

## B.5 Structure

### B.5.1 Référentiel

| | |
|---|---|
| **Menu** | Structure → Référentiel |
| **Route** | `/owner/referentiel` |

**Fonctionnalités**

- Santé de la chaîne cycle → filière → UE → ECUE.
- KPI : volumes et crédits moyens par semestre.
- Panneau d’**incohérences** (ECUE sans crédits, UE sans ECUE, sans enseignant, prix nul, etc.).
- Tableau par filière ; graphique de mutualisation des ECUE.
- Filtre par catégorie d’UE. Lecture seule.

---

## B.6 Pages existantes hors menu (à mentionner en annexe PPT)

Ces pages restent accessibles par URL, mais **n’apparaissent plus** dans le menu propriétaire :

| Page | Route | Rôle |
|---|---|---|
| Recrutement | `/owner/recrutement` | Entonnoir des demandes d’inscription |
| RH / Staff | `/owner/staff` | Synthèse RH et paies en attente |
| Formations | `/owner/formations` | KPI des formations courtes |
| Alertes | `/owner/alertes` | Liste d’alertes, acquittement |
| Accès | `/owner/acces` | Rôles et menus (aussi au menu **admin**) |
| Rapport financier | `/owner/finances/rapport` | Export PDF / CSV paramétrable |

---

## B.7 Synthèse Propriétaire (diapositive)

| Bloc | Question que le dirigeant se pose | Réponse de l’écran |
|---|---|---|
| Pilotage | « Où en est l’école aujourd’hui ? » | 4 KPI + alertes |
| Argent | « Est-ce que l’argent rentre ? » | Recouvrement, trésorerie, UE, marge |
| Effectifs | « Les classes sont-elles remplies ? » | Démographie + remplissage |
| Pédagogie | « Les étudiants réussissent-ils ? Qui décroche ? » | Résultats, assiduité, risque |
| Structure | « Le référentiel tient-il la route ? » | Incohérences du catalogue |

---

# PARTIE C — Enseignant (`teacher`)

**Intention :** enseigner, faire l’appel, évaluer, suivre sa rémunération.

**Page d’arrivée :** Tableau de bord (`/teacher/dashboard`).

---

## C.1 Tableau de Bord

| | |
|---|---|
| **Menu** | Tableau de Bord |
| **Route** | `/teacher/dashboard` |

**Fonctionnalités**

- Vue d’activité personnelle : cours actifs, heures validées / en attente, paiements versés / en attente.
- Listes : 5 cours récents, 5 dernières sessions, synthèse des paiements.
- Raccourcis vers cours, heures, paiements, profil.

---

## C.2 Gestion des Cours

### C.2.1 Mes Cours

| | |
|---|---|
| **Menu** | Mes Cours → Gestion des Cours → Mes Cours |
| **Route** | `/teacher/courses` |

**Fonctionnalités**

- Lister les ECUE professionnelles affectées (cartes : code, UE, filière, inscrits, séances).
- Rechercher ; filtrer par statut (en cours / terminée).
- Ouvrir une session : `/teacher/courses/[id]`.

**Sur le détail d’une session (`/teacher/courses/[id]`) — 5 onglets**

1. **Détails** — UE, filière, dates, effectif.
2. **Séances** — créer / supprimer une séance ; lancer l’appel.
3. **Supports** — déposer et gérer les fichiers pédagogiques.
4. **Évaluations** — créer et corriger devoirs / examens.
5. **Résultats** — grille, recalcul, validation des notes ECUE.

### C.2.2 Planning des Cours

| | |
|---|---|
| **Menu** | Mes Cours → Gestion des Cours → Planning des Cours |
| **Route** | `/teacher/schedule` |

**Fonctionnalités**

- Consulter son emploi du temps hebdomadaire (ECUE, salle, horaires).
- Filtrer par filière.

### C.2.3 Présences

| | |
|---|---|
| **Menu** | Mes Cours → Gestion des Cours → Présences |
| **Route** | `/teacher/attendance` |

**Fonctionnalités**

- Historique des appels (date, ECUE, filière, présents / absents).
- Filtrer par filière et statut de session.
- **Nouvelle présence**.
- Feuille d’appel d’une séance (`/teacher/attendance/[seanceId]`) : marquer présent / absent / retard / excusé ; enregistrer ; réinitialiser.

### C.2.4 Notes

| | |
|---|---|
| **Menu** | Mes Cours → Gestion des Cours → Notes |
| **Route** | `/professionnel/admin/notes` |

**Fonctionnalités**

- Même grille de notes que l’administrateur, limitée aux cohortes de l’enseignant.
- Saisir / modifier / supprimer les notes de session 1.
- Recalculer. (La clôture de semestre reste une action d’administration.)

---

## C.3 Mes Étudiants

### C.3.1 Liste des Étudiants

| | |
|---|---|
| **Menu** | Mes Étudiants → Liste des Étudiants |
| **Route** | `/teacher/students` |

**Fonctionnalités**

- Annuaire des étudiants des ECUE affectées.
- Filtrer par filière ; rechercher.
- Ouvrir la fiche (`/teacher/students/[id]`) : identité, contact, programme, notes, progression — **consultation**.

### C.3.2 Communications

| | |
|---|---|
| **Menu** | Mes Étudiants → Communications |
| **Route** | `/teacher/communications` |

**Fonctionnalités**

- Trois onglets :
  - messages **parents** (créer / lire) ;
  - diffusion aux **élèves** ;
  - **annonces** de l’école / administration.

---

## C.4 Évaluations

### C.4.1 Mes évaluations

| | |
|---|---|
| **Menu** | Évaluations → Mes évaluations |
| **Route** | `/teacher/assignments/create` |

**Fonctionnalités**

- Créer une évaluation (en ligne, PDF, ou assistée par IA).
- Filtrer par type, statut, session.
- Éditer, corriger, supprimer ; gérer les questions.
- Voir les compteurs soumis / notés.

### C.4.2 Assigner un devoir

| | |
|---|---|
| **Menu** | Évaluations → Assigner un devoir |
| **Route** | `/academic/assignments/assign` |

**Fonctionnalités**

- Dupliquer une évaluation vers d’autres ECUE / cohortes.
- Assistant en 3 étapes : source → cibles → confirmation.

### C.4.3 Corrections en Attente

| | |
|---|---|
| **Menu** | Évaluations → Corrections en Attente |
| **Route** | `/teacher/corrections` |

**Fonctionnalités**

- File de correction transversale.
- Filtrer ; ouvrir la correction ; télécharger les copies.
- Compteurs soumis / notés / en attente par évaluation.

---

## C.5 Mes Rémunérations

### C.5.1 Heures Enseignées

| | |
|---|---|
| **Menu** | Mes Rémunérations → Heures Enseignées |
| **Route** | `/teacher/hours` |

**Fonctionnalités**

- Suivre les heures du **module académique** (déclaration mensuelle).
- Éditer / sauvegarder un brouillon ; exporter.
- KPI : brouillon, en attente, validées, montant.

### C.5.2 Séances Professionnelles

| | |
|---|---|
| **Menu** | Mes Rémunérations → Séances Professionnelles |
| **Route** | `/teacher/professional-seances` |

**Fonctionnalités**

- Consulter les séances du **module professionnel** validées pour la paie.
- Voir durée, caractère payable, et l’état des paiements pro (provisoire / approuvé / payé).

### C.5.3 Mes Paiements

| | |
|---|---|
| **Menu** | Mes Rémunérations → Mes Paiements |
| **Route** | `/teacher/payments` |

**Fonctionnalités**

- Historique de la rémunération académique.
- Filtrer par période et statut.
- Consulter le détail ; télécharger.

---

## C.6 Rapports & Analyses

### C.6.1 Dashboard Analytique

| | |
|---|---|
| **Menu** | Rapports & Analyses → Dashboard Analytique |
| **Route** | `/teacher/reports` |

**Fonctionnalités**

- Performance des classes et progression des élèves.
- Filtrer par classe et plage temporelle.
- Graphiques : barres par classe, complétion des devoirs, progression.

---

## C.7 Profil

### C.7.1 Informations Personnelles

| | |
|---|---|
| **Menu** | Profil → Informations Personnelles |
| **Route** | `/teacher/profile` |

**Fonctionnalités**

- Consulter la fiche enseignant : identité, contact, contrat (CDI / CDD / vacataire), spécialités, taux horaire.
- Statistiques personnelles (classes, étudiants, heures).
- Liens vers heures et paiements.

---

## C.8 Synthèse Enseignant (diapositive)

| Besoin | Menu | Action |
|---|---|---|
| Préparer le cours | Mes Cours | Supports, séances |
| Faire l’appel | Présences | Feuille d’appel |
| Noter | Notes / Évaluations | Grille + corrections |
| Contacter | Communications | Parents et élèves |
| Suivre sa paie | Rémunérations | Heures, séances pro, paiements |

---

# PARTIE D — Étudiant (`student`)

**Intention :** suivre sa formation, rendre ses devoirs, consulter notes et bulletin, payer, communiquer.

**Page d’arrivée :** Mes Cours (`/student/courses`).

---

## D.1 Mes Études

### D.1.1 Mes Cours

| | |
|---|---|
| **Menu** | Académique → Mes Études → Mes Cours |
| **Route** | `/student/courses` |

**Fonctionnalités**

- Voir ses inscriptions au module professionnel (cartes UE : statut, filière, dates, montant, ECUE).
- Filtrer par statut et programme.
- Ouvrir le détail (`/student/courses/[id]`) : infos, **supports**, **évaluations**, **visio** (si inscription confirmée).
- Lien vers l’auto-inscription.

### D.1.2 Emploi du Temps

| | |
|---|---|
| **Menu** | Académique → Mes Études → Emploi du Temps |
| **Route** | `/student/schedule` |

**Fonctionnalités**

- Grille hebdomadaire des sessions auxquelles l’étudiant est inscrit.
- Filtrer par filière.

### D.1.3 Devoirs

| | |
|---|---|
| **Menu** | Académique → Mes Études → Devoirs |
| **Route** | `/student/assignments` |

**Fonctionnalités**

- Lister les devoirs / évaluations (à faire, soumis, notés).
- Télécharger le sujet.
- Ouvrir le détail (`/student/assignments/[id]`) : consignes, **soumettre** (fichier, texte ou QCM), voir la correction et le feedback.

### D.1.4 Mes Notes

| | |
|---|---|
| **Menu** | Académique → Mes Études → Mes Notes |
| **Route** | `/student/grades` |

**Fonctionnalités**

- Relevé détaillé du module professionnel (grille ECUE).
- Filtrer par filière et semestre.
- Voir notes de devoirs / examen, statuts (validé, compensé, éliminatoire) et synthèse du semestre (moyenne, crédits, décision).

### D.1.5 Mon Bulletin

| | |
|---|---|
| **Menu** | Académique → Mes Études → Mon Bulletin |
| **Route** | `/student/bulletin` |

**Fonctionnalités**

- Consulter le bulletin officiel (aperçu PDF).
- Choisir le semestre.
- **Télécharger** un bulletin, l’ouvrir dans un nouvel onglet, ou télécharger tous.

### D.1.6 Module Professionnel (auto-inscription)

| | |
|---|---|
| **Menu** | Académique → Mes Études → Module Professionnel |
| **Route** | `/professionnel/etudiant` |

**Fonctionnalités**

- Catalogue des sessions ouvertes, groupées par lot.
- Choisir un programme.
- **S’inscrire** (une UE ou un lot entier) → statut « en attente de paiement ».
- Respect des prérequis (verrouillage si non remplis).

---

## D.2 Communication

### D.2.1 Messages

| | |
|---|---|
| **Menu** | Communication → Messages |
| **Route** | `/student/messages` |

**Fonctionnalités**

- Lire les messages de l’administration et des enseignants.
- Répondre (WhatsApp / email).
- **Écrire à l’école** ; **écrire à un enseignant**.

---

## D.3 Assistance

### D.3.1 Tuteur IA

| | |
|---|---|
| **Menu** | Assistance → Aide & Support → Tuteur IA |
| **Route** | `/student/ai-tutor` |

**Fonctionnalités**

- Assistant pédagogique conversationnel.
- Consulter des recommandations (révision, ressources, rappels).
- *Note : conversation illustrée côté client (données de démonstration).*

### D.3.2 Support

| | |
|---|---|
| **Menu** | Assistance → Aide & Support → Support |
| **Route** | `/student/support` |

**Fonctionnalités**

- Consulter la FAQ (recherche, filtre par catégorie).
- **Formulaire de contact** (sujet, message).
- Voir les coordonnées et horaires du support.

---

## D.4 Mes Finances

### D.4.1 Mes Paiements

| | |
|---|---|
| **Menu** | Mes Finances → Paiements & Reçus → Mes Paiements |
| **Route** | `/student-payments` |

**Fonctionnalités**

- Scolarité **académique** (hors module professionnel).
- Onglets : échéancier, historique, **payer en ligne**, reçus, détail des frais.
- KPI solde et retards.
- Télécharger les **reçus PDF**.

---

## D.5 Profil

### D.5.1 Mon Profil

| | |
|---|---|
| **Menu** | Profil → Mon Profil |
| **Route** | `/student/profile` |

**Fonctionnalités**

- Consulter la fiche (matricule, programme, année — lecture seule).
- **Modifier** prénom, nom, email, téléphone, adresse, date de naissance.
- Enregistrer / annuler.

---

## D.6 Pages hors menu étudiant

| Route | Statut |
|---|---|
| `/student/content` | Existe (supports récents) — section E-Learning **masquée** du menu |
| `/student/progress` | Entrée menu commentée — **page absente** |
| `/student/settings` | Entrée menu commentée |

---

## D.7 Synthèse Étudiant (diapositive)

| Besoin | Menu | Action |
|---|---|---|
| Voir mes UE | Mes Cours | Supports, visio, évaluations |
| Savoir où aller | Emploi du Temps | Grille semaine |
| Rendre un travail | Devoirs | Soumettre + voir la note |
| Connaître mes résultats | Mes Notes / Mon Bulletin | Grille + PDF officiel |
| M’inscrire | Module Professionnel | Auto-inscription |
| Payer | Mes Paiements | Échéancier + reçu |
| Demander de l’aide | Messages / Support / Tuteur IA | Contact et FAQ |

---

# PARTIE E — Parent (`parent`)

**Intention :** suivre la scolarité de ses enfants — notes, devoirs, documents, messages. Quasi exclusivement de la **consultation**, plus la messagerie.

**Page d’arrivée :** Mes Enfants (`/parent/children`).

---

## E.1 Mes Enfants

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Mes Enfants |
| **Route** | `/parent/children` |

**Fonctionnalités**

- Vue d’ensemble : cartes par enfant (classe, moyenne, assiduité, statut).
- KPI : enfants actifs, moyenne globale, points d’attention assiduité.
- Ouvrir la fiche enfant (`/parent/children/[childId]`) : notes par semestre / UE / ECUE, historique des présences.
- Emploi du temps de l’enfant : `/parent/children/[childId]/schedule` (navigation semaine précédente / suivante / courante).

---

## E.2 Cours & Devoirs

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Cours & Devoirs |
| **Route** | `/parent/homework` |

**Fonctionnalités**

- Choisir l’enfant.
- Onglet **Devoirs** : type, échéance, statut de rendu, note.
- Onglet **Notes** : grille ECUE (devoirs / examen / statuts / synthèse semestre).
- Consultation uniquement.

---

## E.3 Bulletins & Reçus

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Bulletins & Reçus |
| **Route** | `/parent/documents` |

**Fonctionnalités**

- Choisir l’enfant.
- Onglet **Bulletins** : bulletins par semestre, **télécharger / ouvrir le PDF** officiel.
- Onglet **Reçus** : reçus de paiements du module professionnel (n°, date, mode, montant).

---

## E.4 Messages

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Messages |
| **Route** | `/parent/messages` |

**Fonctionnalités**

- Conversations avec les **enseignants** (filtre par enfant).
- **Écrire à l’école**.
- Consultation et envoi de messages.

---

## E.5 Parcours Professionnel

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Parcours Professionnel |
| **Route** | `/parent/professionnel` |

**Fonctionnalités**

- Choisir l’enfant.
- KPI : inscriptions confirmées, total payé, reste dû.
- Tableaux : inscriptions UE (statut, dates, montant) et paiements (date, mode, montant).
- Lecture seule — le parent ne paie pas depuis cet écran.

---

## E.6 Diplômes de mon enfant

| | |
|---|---|
| **Menu** | Suivi des Enfants → Mes Enfants → Diplômes de mon enfant |
| **Route** | `/parent/professionnel/diplomes` |

**Fonctionnalités**

- Choisir l’enfant.
- Voir les diplômes **obtenus** et **en cours** (libellé, filière, statut, crédits / conditions).

---

## E.7 Pages hors menu parent

| Route | Statut |
|---|---|
| `/parent/dashboard` | Redirige vers `/parent/children` |
| `/parent/emergency` | Désactivée (contacts d’urgence) |
| `/parent/settings` | Existe mais **masquée** du menu |

---

## E.8 Synthèse Parent (diapositive)

| Besoin | Menu | Action |
|---|---|---|
| Qui sont mes enfants ? | Mes Enfants | Cartes + fiche + EDT |
| Qu’a-t-il à faire / comme notes ? | Cours & Devoirs | Devoirs + grille |
| Où est le bulletin / le reçu ? | Bulletins & Reçus | PDF |
| Contacter l’école | Messages | Enseignant ou administration |
| Où en est son parcours pro ? | Parcours / Diplômes | Inscriptions, paiements, diplômes |

---

# PARTIE F — Annexes pour la présentation

## F.1 Matrice « qui peut quoi » (diapositive de clôture)

| Fonctionnalité | Admin | Owner | Teacher | Student | Parent |
|---|:---:|:---:|:---:|:---:|:---:|
| Configurer cycles / filières / UE / ECUE | ● | ○ | — | — | — |
| Créer une classe / cohorte | ● | — | — | — | — |
| Inscrire un étudiant (admin) | ● | — | — | — | — |
| Auto-inscription aux UE | — | — | — | ● | — |
| Faire l’appel | ● | — | ● | — | Consulter |
| Saisir les notes | ● | — | ● | Consulter | Consulter |
| Générer bulletin / diplôme | ● | — | — | Télécharger | Télécharger |
| Encaisser (scolarité ou UE) | ● | — | — | Payer en ligne* | Consulter reçus |
| Valider la paie enseignants | ● | ● (finances) | Consulter | — | — |
| KPI de direction | — | ● | — | — | — |
| Messagerie | ● | — | ● | ● | ● |
| Gérer rôles et menus | ● | ● (Accès) | — | — | — |

**Légende :** ● action complète · ○ consultation / alerte · — non concerné  
\* Paiement en ligne = scolarité académique (`/student-payments`), pas l’encaissement UE admin.

---

## F.2 Deux « stacks » pédagogiques (à expliquer en 1 slide)

L’application fait cohabiter deux filières de gestion :

| | Module professionnel LMD | Module académique classique |
|---|---|---|
| **Exemples** | UE, ECUE, cohortes, bulletins LMD | Année, classes, BTS, scolarité |
| **Admin** | Section « Module Professionnel » | « Structure » + « Opérations Académiques » + « Finances Étudiantes » |
| **Enseignant** | Mes Cours, Notes, Séances pro | Heures enseignées, Mes paiements |
| **Étudiant** | Mes Cours, Mes Notes, Bulletin, auto-inscription | Devoirs, Mes Paiements |
| **Parent** | Cours & Devoirs, Parcours, Diplômes | Fiche enfant, bulletins |

---

## F.3 Personnalisation des menus (à dire en conclusion)

1. **Par défaut**, chaque profil voit **tout** le catalogue de son espace (ce document).
2. Un administrateur peut **retirer des menus** à un rôle socle : page **Administration → Accès → Menus par rôle**.
3. Il peut aussi créer des **rôles admin restreints** (scolarité, pédagogie…) : page **Administration → Rôles**, en cochant uniquement certains menus.
4. Le **propriétaire** voit toujours l’intégralité de **son** menu de pilotage (pas de sous-ensembles repliables).

---

## F.4 Plan de diapositives suggéré (environ 25 slides)

1. Titre — EcoleDigitale, 5 profils  
2. Comparaison globale (section 2)  
3. Connexion et atterrissage  
4. Arborescence Admin  
5. Admin — Structure académique  
6. Admin — Module pro Programme & Planning  
7. Admin — Module pro Étudiants & Paiements  
8. Admin — Notes, bulletins, diplômes  
9. Admin — Année, BTS, Post-BTS  
10. Admin — Rémunération & Finances  
11. Admin — Gouvernance (accès, rôles, users)  
12. Arborescence Owner  
13. Owner — Argent  
14. Owner — Effectifs & Pédagogie  
15. Owner — Risque & Référentiel  
16. Arborescence Teacher  
17. Teacher — Cours, présences, notes  
18. Teacher — Évaluations & paie  
19. Arborescence Student  
20. Student — Études, devoirs, bulletin  
21. Student — Finances, messages, aide  
22. Arborescence Parent  
23. Parent — Suivi enfants, documents, messages  
24. Matrice « qui peut quoi »  
25. Personnalisation des menus + questions  

---

## F.5 Profil hors périmètre (rappel)

Un sixième profil existe dans l’application : **Formateur** (`formateur`), dédié aux **formations professionnelles courtes** (planning, sessions, supports, catalogue). Il n’est pas détaillé ici, conformément à la demande (admin, owner, teacher, student, parent).

---

*Document généré à partir du code source EcoleDigitale V2 — menus activés dans `Sidebar.tsx` et fonctionnalités constatées dans les pages Next.js.*
