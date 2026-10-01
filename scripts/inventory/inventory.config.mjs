// Configuration de l'inventaire d'impact (tâche 0.6 du plan).
// Les règles ci-dessous classent chaque table (domaine fonctionnel + module cible
// du plan §5.1 / tranche Phase 2). Premier motif qui correspond gagne.
// Pour reclasser une table : ajouter une ligne dans OVERRIDES (prioritaire).

export const DOMAINS = [
  'académique-classique',
  'professionnel',
  'finance-legacy',
  'finance-pro',
  'remuneration',
  'imhotep',
  'rso',
  'owner',
  'messagerie',
  'auth/rbac',
  'audit',
  'autre',
];

// [motif, domaine, module cible, tranche du plan]
// Modules cibles : voir PLAN §3.2 / §3.12 et §5.1. Valeurs spéciales :
//   REMOVE:imhotep  = supprimé avec Imhotep (D7)
//   HORS-PLAN:rso   = non couvert par le plan (à trancher)
//   LEGACY-ARCHIVE  = zombie / obsolète, à ne pas porter
export const TABLE_RULES = [
  // ---- Imhotep (formation professionnelle publique) ----
  [/^(formations_professionnelles|sessions_professionnelles|session_formateurs|formateurs|formateur_indisponibilites|notifications_formateurs|session_attendance|support_session_associations|support_telechargements|supports_cours|entreprises_clientes|inscriptions_professionnelles|paiements_professionnels|codes_promo|reservations_temporaires|documents|export_jobs)$/, 'imhotep', 'REMOVE:imhotep', 'D7'],
  [/_aspci$/, 'imhotep', 'LEGACY-ARCHIVE', 'D7'],
  [/^(live_sessions|live_session_recordings|live_session_attendances|live_session_webhook_events)$/, 'imhotep', 'REMOVE:imhotep', 'D7 (à vérifier : parentType professionnelle)'],
  [/^(public_users|accounts|user_sessions|verification_tokens|inscriptions_public)$/, 'imhotep', 'REMOVE:imhotep', 'D7 (Prisma, portail public)'],
  // ---- RSO ----
  [/^rso_/, 'rso', 'HORS-PLAN:rso', 'hors plan'],
  // ---- Auth / RBAC / plateforme ----
  [/^(users|roles|user_roles|token_blacklist)$/, 'auth/rbac', 'iam', '1 (spec 002-auth-rbac)'],
  [/^(admin_roles|admin_role_menus|user_admin_roles|role_menu_denials)$/, 'auth/rbac', 'iam', '1 (RBAC granulaire)'],
  [/^(tenants)$/, 'autre', 'platform-tenancy', '1 (spec 001/003)'],
  [/^super_admin_users$/, 'auth/rbac', 'iam', '1 (spec 002)'],
  [/^super_admin_audit_logs$/, 'audit', 'audit', '1 (module audit)'],
  [/^(payment_audit_log)$/, 'audit', 'audit', '1/3 (triggers conservés en filet)'],
  [/^(teacher_assignments_audit)$/, 'audit', 'audit', '2.2'],
  [/^student_status_history$/, 'professionnel', 'students-guardians', '2.2'],
  [/^registration_requests$/, 'autre', 'students-guardians', '2.2 (à vérifier : admissions)'],
  // ---- Messagerie / notifications ----
  [/^(conversation_messages|parent_teacher_conversations|parent_school_conversations|parent_school_conversation_messages|parent_school_messages|teacher_messages|admin_student_messages|admin_teacher_messages|teacher_student_messages|teacher_announcements|school_announcements|announcement_reads|event_invitations|notifications|notification_preferences|app_notifications|app_email_delivery_log|app_whatsapp_delivery_log|establishment_inbound_messages|student_replies|admin_email_messages|admin_email_recipients|payment_notifications)$/, 'messagerie', 'communications', '3 (spec 016)'],
  // ---- Rémunération des enseignants (spec 031) ----
  [/^(payment_periods|payment_period_teachers|teacher_payment_configs|teacher_payments|payment_hour_details|course_hourly_rates|professional_ecue_hourly_rates)$/, 'remuneration', 'payroll', '2.7 (spec 031 / 032-payroll-port)'],
  // ---- Finance ----
  [/^(tuition_payment_schedules|student_tuition_installments|payment_transactions|payment_receipts|cycles_frais)$/, 'finance-legacy', 'finance', '3'],
  [/^(expenses|expense_categories)$/, 'finance-legacy', 'finance', '3 (charges ; lues par owner-charges)'],
  [/^(professional_orders|professional_payments|professional_order_installments)$/, 'finance-pro', 'finance', '3'],
  // ---- Prospection / commissions (liées aux inscriptions de l'école, pas à Imhotep) ----
  [/^(commerciaux|student_provenances|commissions_versements)$/, 'owner', 'finance (commissions) + analytics', '3 (à trancher : voir imhotep-removal-inventory)'],
  // ---- Professionnel : curriculum ----
  [/^(filieres|professional_classe_noms|professional_ue|professional_ecue|professional_ue_ecue|professional_ue_prerequisites|professional_ue_sessions|professional_semestres|professional_semestre_sessions|professional_semestre_ue)$/, 'professionnel', 'academic-core', '2.1'],
  [/^(professional_enrollments|professional_student_matricules)$/, 'professionnel', 'students-guardians', '2.2'],
  [/^professional_session_ecue_teachers$/, 'professionnel', 'teachers-staff', '2.2'],
  [/^(professional_ecue_seances|professional_emploi_temps|professional_course_plannings)$/, 'professionnel', 'scheduling', '2.3'],
  [/^professional_ecue_attendance$/, 'professionnel', 'attendance', '2.3'],
  [/^(professional_assignments|professional_assignment_submissions|professional_assignment_questions|professional_assignment_question_answers|professional_ecue_notes|professional_ecue_results|student_professional_ue_results)$/, 'professionnel', 'assessments-grades', '2.5'],
  [/^(professional_ecue_materials|professional_ecue_material_views)$/, 'professionnel', 'documents (LMS après V1)', '2.5/3'],
  [/^(professional_bulletins|professional_diplomas|professional_diploma_requirements|student_professional_diplomas|professional_signataires)$/, 'professionnel', 'report-cards', '2.6'],
  // ---- Académique classique ----
  [/^(academic_years|academic_year_periods|cycles|programmes|classes|class_courses|courses|bilan_types)$/, 'académique-classique', 'academic-core', '2.1'],
  [/^(student_profiles|student_parents|student_enrollments|emergency_contacts)$/, 'académique-classique', 'students-guardians', '2.2'],
  [/^(teachers|teacher_assignments)$/, 'académique-classique', 'teachers-staff', '2.2'],
  [/^(student_attendance|attendance_sessions|attendance_reports|teacher_attendance_records|teacher_attendance_sessions|student_period_attendance_summaries)$/, 'académique-classique', 'attendance', '2.3'],
  [/^(time_slots|session_instances|classrooms|classroom_reservations|exam_schedules|academic_calendar_events)$/, 'académique-classique', 'scheduling', '2.3'],
  [/^(assignments|assignment_instances|assignment_submissions|evaluation_questions|evaluation_question_responses|homework_annotations|student_period_course_averages|ai_document_processing|ai_generated_questions|ai_generation_usage)$/, 'académique-classique', 'assessments-grades', '2.5'],
  [/^(report_cards|transcripts)$/, 'académique-classique', 'report-cards', '2.6'],
  [/^(course_materials)$/, 'académique-classique', 'documents (LMS après V1)', '2.5/3'],
  [/^(student_dashboard_configs|dashboard_widgets|dashboard_templates)$/, 'académique-classique', 'analytics (portail élève)', '2.8'],
  [/^(course_assignments|teaching_hours)$/, 'remuneration', 'payroll', '2.7 (heures académiques ; table connue seulement de la chaîne Prisma)'],
  [/^teaching_units$/, 'académique-classique', 'LEGACY-ARCHIVE', 'zombie (supprimée par 0005 côté SQL, encore dans le baseline Prisma)'],
];

// Reclassements manuels (priorité absolue) : table -> [domaine, module, tranche]
export const OVERRIDES = {};

export const FALLBACK = ['autre', 'À CLASSER', '?'];

// ------------------- Analyse du code -------------------
export const SCAN = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql'],
  // Répertoires ignorés (nom exact de dossier)
  ignoreDirs: new Set(['node_modules', '.next', 'dist', 'build', 'out', '.git', '.claude', 'coverage', '.turbo', 'playwright-report', 'test-results']),
  // Chemins ignorés (préfixe relatif)
  ignorePrefixes: [
    'infra/scripts/migrations/', // définitions, pas des usages
    'apps/api/prisma/migrations/',
    'scripts/inventory/', // l'outil lui-même
    'docs/',
    'specs/',
    'apps/api/downloaded_file',
  ],
  maxFileBytes: 2_000_000,
};
