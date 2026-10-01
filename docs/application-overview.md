# EcoleDigitale - Documentation Fonctionnelle et Technique

Ce document décrit l'application EcoleDigitale a partir du code source actuel (`apps/api`, `apps/web` et migrations SQL).

## 1) Vue d'ensemble de l'application

EcoleDigitale est une plateforme de gestion scolaire multi-tenant (plusieurs etablissements/organisations sur une meme application) avec :
- un **back-end API Fastify** (`apps/api`)
- un **front-end Next.js** (`apps/web`)
- une **base PostgreSQL** avec isolation par tenant et politiques RLS

L'application couvre :
- gestion academique (cycles, programmes, cours, classes, inscriptions)
- suivi pedagogique (devoirs, soumissions, corrections, notes, moyennes, bulletins)
- assiduite et planning (presences, horaires, generation d'emploi du temps, salles)
- finances (paiements eleves, echeanciers, recus, remuneration enseignants)
- espaces par profil (administration, enseignant, etudiant, parent)
- module RSO (activites et tableaux de bord dedies)

## 2) Types de comptes et droits principaux

## Administration (`admin`)
- Configuration academique : cycles, programmes, cours, classes, annee academique
- Gestion des utilisateurs, enseignants, etudiants, parents
- Pilotage financier : echeanciers, paiements, rapports, recus
- Communication institutionnelle : annonces, messages admin

## Etudiant (`student`)
- Consultation des cours, devoirs, notes, emploi du temps, profil
- Soumission des devoirs (upload + finalisation)
- Consultation des messages et contenus pedagogiques
- Acces aux services et interfaces etudiants

## Parent (`parent`)
- Acces aux informations de ses enfants (notes, devoirs, paiements, documents)
- Parametres parent, urgence, suivi scolaire
- Messagerie parent-ecole

## Enseignant (`teacher`)
- Gestion de ses cours, presences et eleves
- Suivi des devoirs, corrections, evaluations, progression
- Suivi de ses heures d'enseignement et paiements

> Notes techniques :
> - Les roles explicites sont portes par `roles` + `user_roles`.
> - Le role `teacher` peut aussi etre infere depuis la table metier `teachers`.
> - Le role `formateur` n'a plus d'espace dedie : le portail formateur des formations professionnelles publiques a ete retire du code (le role reste en base, sans menu).
> - Authentification par JWT avec controle de validite et gestion de blacklist de tokens.

## 3) Schema de base de donnees (par domaine)

Le schema evolue via les migrations SQL dans `infra/scripts/migrations`.

## Socle multi-tenant et securite
- `tenants` : etablissements/organisations
- `roles` : roles par tenant
- `users` : comptes utilisateurs
- `user_roles` : association utilisateurs <-> roles
- `token_blacklist` : invalidation/revocation JWT

Mecanismes :
- isolation des donnees par `tenant_id`
- **Row Level Security (RLS)** activee sur les tables sensibles
- verifications de contexte tenant cote API

## Academique
- `cycles`, `programmes`, `teaching_units`, `courses`
- `teachers`, `course_assignments`, `teaching_hours`
- `academic_years`, `classes`, `enrollments`

## Vie etudiante / pedagogie
- `student_profiles`, `student_parents`
- `assignments`, `assignment_instances`, `assignment_submissions`
- tables d'evaluation/notes/moyennes (migrations d'evaluations et semestres)
- tables de bulletins/releves (`report_cards`, `transcripts` via migrations dediees)

## Assiduite et planning
- tables de presence (`attendance`, `attendance_sessions`, etc. selon migrations)
- generation d'emploi du temps (`schedule_generation`, tables simplifiees et consolidees)
- `classrooms` et reservations de salles

## Finance
- paiements eleves (`student_payments`), echeanciers (`tuition_schedules`)
- periodes de paiement (`payment_periods`, `simple_payment_periods`)
- configuration et paiement enseignant (`teacher_payment_configs`, `teacher_payments`)
- recus, notifications et rapports financiers

## Formations professionnelles publiques (retirees)
Le module « formations professionnelles » (catalogue public, sessions, inscriptions, paiements, portail formateur, portail public `apps/formation-pro-public`) a ete supprime du code. Ses tables (`formations_professionnelles`, `sessions_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `formateurs`, `entreprises_clientes`, `documents`, `export_jobs`, etc.) restent en base jusqu'au reset de la Phase 2. Detail : `docs/inventory/imhotep-removal-report.md`. Ne pas confondre avec le **module Professionnel** (`professional_*`, voir `docs/module-professionnel-overview.md`), conserve.

## 4) Endpoints API principaux

Base API : `/api/v1`

## Public / Auth
- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/social-login`
- `POST /auth/logout`
- `POST /auth/refresh`

## Academique (administration)
- `/cycles`
- `/programmes`
- `/courses`
- `/teachers`
- `/students`
- `/users`
- `/academic-years`
- `/semester-averages`
- `/academic-calendar-events`
- `/exam-schedules`
- `/report-cards`
- `/bilan-types`
- `/transcripts`
- `/attendance-reports`
- `/classes`
- `/class-courses`
- `/enrollments`

## Devoirs, evaluations et fichiers
- `/assignments`
- `/assignment-instances`
- `/ai-evaluations`
- `/courses/*/materials`
- `/files/*`
- `/teacher-assignments`
- `/teacher/*` (corrections, etc.)

## Presence, planning et salles
- `/attendance`
- `/sessions`
- `/schedule-generation`
- `/simple-schedule`
- `/classrooms`
- `/classroom-reservations`

## Finance
- `/payment-periods`
- `/simple-payment-periods`
- `/teacher-payment-configs`
- `/teacher-payments`
- `/course-hourly-rates`
- `/payment-reports`
- `/cycle-fees`
- `/teaching-hours`
- `/course-assignments`
- `/student-payments`
- `/tuition-schedules`
- `/receipts`
- `/notifications`
- `/financial-reports`

## Espaces par profil
- Etudiant :
  - `/student/courses`
  - `/student/assignments`
  - `/student/grades`
  - `/student/messages`
- Enseignant :
  - `/teacher` (cours)
  - `/teacher/assignments`
  - `/teacher/attendance`
  - `/teacher/students`
  - `/teacher/messages`
  - `/teacher/conversations`
- Parent :
  - `/parent/children`
  - `/parent/homework`
  - `/parent/grades`
  - `/parent/payments`
  - `/parent/messages`
  - `/parent/settings`
  - `/parent/academic`
  - `/parent/documents`
  - `/parent/emergency`
  - `/parents`

## Administration institutionnelle
- `/admin/announcements`
- `/admin/messages`

## RSO
- `/rso/*`

## 5) En-tetes et conventions importantes

Headers frequemment utilises :
- `X-Tenant` : contexte tenant (obligatoire pour l'isolation)
- `Authorization: Bearer <jwt>` : auth API
- `X-Dev-Auth` : present dans certaines collections de test locale
- `X-User-Id` : utilitaire dans certains tests internes

Conventions :
- isolation stricte tenant cote base et middleware
- validation schema (zod / schemas API)
- flux deverrouillage de session via token + blacklist

## 6) Emplacement du code source

- API : `apps/api/src`
- Front-end : `apps/web/src/app`
- Contrats et schemas partages : `packages/contracts/src`
- Migrations base de donnees : `infra/scripts/migrations`

