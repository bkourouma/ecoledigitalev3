/**
 * Generate comprehensive audit documentation by analyzing codebase
 */

const fs = require('fs');
const path = require('path');

// Database schema mapping
const DB_SCHEMA = {
  // Core tables
  tenants: ['id', 'slug', 'name', 'settings_json', 'created_at', 'updated_at'],
  users: ['id', 'tenant_id', 'email', 'first_name', 'last_name', 'password_hash', 'created_at', 'updated_at'],
  roles: ['id', 'tenant_id', 'key', 'name', 'created_at', 'updated_at'],
  user_roles: ['id', 'user_id', 'role_id', 'created_at'],
  
  // Academic module
  cycles: ['id', 'tenant_id', 'name', 'code', 'type', 'duration_months', 'description', 'certification_level', 'status', 'created_at', 'updated_at'],
  programmes: ['id', 'tenant_id', 'cycle_id', 'name', 'code', 'version', 'description', 'objectives', 'ects_credits', 'academic_year', 'status', 'approved_by', 'approved_at', 'created_at', 'updated_at'],
  teaching_units: ['id', 'tenant_id', 'programme_id', 'name', 'code', 'ects_credits', 'semester', 'is_mandatory', 'created_at', 'updated_at'],
  courses: ['id', 'tenant_id', 'teaching_unit_id', 'name', 'code', 'description', 'objectives', 'hours_total', 'hours_theory', 'hours_practical', 'delivery_mode', 'prerequisites', 'evaluation_methods', 'resources', 'status', 'created_at', 'updated_at'],
  
  // Teacher management
  teachers: ['id', 'tenant_id', 'user_id', 'employee_number', 'first_name', 'last_name', 'email', 'phone', 'specialties', 'bio', 'qualifications', 'hire_date', 'contract_type', 'hourly_rate', 'status', 'created_at', 'updated_at'],
  course_assignments: ['id', 'tenant_id', 'course_id', 'teacher_id', 'academic_year', 'semester', 'hours_assigned', 'start_date', 'end_date', 'created_at', 'updated_at'],
  teaching_hours: ['id', 'tenant_id', 'assignment_id', 'session_date', 'hours_taught', 'session_type', 'notes', 'validated_by', 'validated_at', 'created_at'],
  
  // Student management
  student_profiles: ['id', 'tenant_id', 'user_id', 'student_number', 'current_year', 'status', 'bio', 'date_of_birth', 'place_of_birth', 'nationality', 'address', 'phone', 'emergency_phone', 'is_active', 'created_at', 'updated_at'],
  student_parents: ['id', 'tenant_id', 'student_id', 'parent_id', 'relationship_type', 'is_primary_contact', 'emergency_contact', 'can_pickup', 'notes', 'created_at'],
  
  // Academic operations
  academic_years: ['id', 'tenant_id', 'name', 'start_date', 'end_date', 'is_current', 'created_at', 'updated_at'],
  classes: ['id', 'tenant_id', 'academic_year_id', 'programme_id', 'name', 'code', 'level', 'max_students', 'status', 'created_at', 'updated_at'],
  class_courses: ['id', 'tenant_id', 'class_id', 'course_id', 'teacher_id', 'academic_year_id', 'start_date', 'end_date', 'created_at', 'updated_at'],
  enrollments: ['id', 'tenant_id', 'student_id', 'class_id', 'academic_year_id', 'enrollment_date', 'status', 'created_at', 'updated_at'],
  
  // Attendance
  session_instances: ['id', 'tenant_id', 'class_course_id', 'classroom_id', 'teacher_id', 'start_time', 'end_time', 'date', 'status', 'notes', 'created_at', 'updated_at'],
  attendance_records: ['id', 'tenant_id', 'session_instance_id', 'student_id', 'status', 'recorded_by', 'recorded_at', 'notes', 'created_at', 'updated_at'],
  
  // Assignments and evaluations
  assignments: ['id', 'tenant_id', 'class_course_id', 'title', 'description', 'type', 'max_points', 'due_date', 'status', 'created_by', 'created_at', 'updated_at'],
  assignment_instances: ['id', 'tenant_id', 'assignment_id', 'student_id', 'submitted_at', 'file_url', 'status', 'score', 'feedback', 'graded_by', 'graded_at', 'created_at', 'updated_at'],
  evaluation_questions: ['id', 'tenant_id', 'assignment_id', 'question_text', 'question_type', 'points', 'options', 'correct_answer', 'order_index', 'created_at', 'updated_at'],
  
  // Payments - Teacher
  payment_periods: ['id', 'tenant_id', 'name', 'start_date', 'end_date', 'status', 'created_at', 'updated_at'],
  teacher_payment_configs: ['id', 'tenant_id', 'teacher_id', 'base_rate', 'overtime_rate', 'effective_from', 'effective_to', 'created_at', 'updated_at'],
  teacher_payments: ['id', 'tenant_id', 'teacher_id', 'payment_period_id', 'total_hours', 'gross_amount', 'deductions', 'net_amount', 'status', 'paid_at', 'created_at', 'updated_at'],
  course_hourly_rates: ['id', 'tenant_id', 'course_id', 'rate', 'effective_from', 'effective_to', 'created_at', 'updated_at'],
  
  // Payments - Student
  cycle_fees: ['id', 'tenant_id', 'cycle_id', 'academic_year', 'total_amount', 'installments', 'created_at', 'updated_at'],
  tuition_schedules: ['id', 'tenant_id', 'student_id', 'academic_year_id', 'total_amount', 'amount_paid', 'amount_due', 'status', 'created_at', 'updated_at'],
  student_payments: ['id', 'tenant_id', 'student_id', 'tuition_schedule_id', 'amount', 'payment_date', 'payment_method', 'status', 'receipt_number', 'created_at', 'updated_at'],
  receipts: ['id', 'tenant_id', 'student_payment_id', 'receipt_number', 'issue_date', 'pdf_url', 'created_at'],
  
  // Infrastructure
  classrooms: ['id', 'tenant_id', 'name', 'code', 'capacity', 'building', 'floor', 'equipment', 'status', 'created_at', 'updated_at'],
  classroom_reservations: ['id', 'tenant_id', 'classroom_id', 'session_instance_id', 'start_time', 'end_time', 'status', 'created_at', 'updated_at'],
  materials: ['id', 'tenant_id', 'course_id', 'title', 'description', 'type', 'file_url', 'file_size', 'mime_type', 'uploaded_by', 'created_at', 'updated_at'],
  notifications: ['id', 'tenant_id', 'user_id', 'type', 'title', 'message', 'data', 'read', 'created_at']
};

// Page-to-endpoint mappings
const PAGE_MAPPINGS = {
  '/academic/cycles': {
    description: 'Gestion des cycles académiques',
    endpoints: [
      { method: 'GET', path: '/api/v1/cycles', action: 'Load cycles list', tables: ['cycles'] },
      { method: 'POST', path: '/api/v1/cycles', action: 'Create new cycle', tables: ['cycles'] },
      { method: 'PUT', path: '/api/v1/cycles/:id', action: 'Update cycle', tables: ['cycles'] },
      { method: 'DELETE', path: '/api/v1/cycles/:id', action: 'Delete cycle', tables: ['cycles', 'programmes'] }
    ]
  },
  '/academic/programmes': {
    description: 'Gestion des programmes académiques',
    endpoints: [
      { method: 'GET', path: '/api/v1/programmes', action: 'Load programmes list', tables: ['programmes', 'cycles'] },
      { method: 'POST', path: '/api/v1/programmes', action: 'Create new programme', tables: ['programmes'] },
      { method: 'PUT', path: '/api/v1/programmes/:id', action: 'Update programme', tables: ['programmes'] },
      { method: 'DELETE', path: '/api/v1/programmes/:id', action: 'Delete programme', tables: ['programmes'] }
    ]
  },
  '/academic/courses': {
    description: 'Gestion des cours',
    endpoints: [
      { method: 'GET', path: '/api/v1/courses', action: 'Load courses list', tables: ['courses', 'teaching_units'] },
      { method: 'POST', path: '/api/v1/courses', action: 'Create new course', tables: ['courses'] },
      { method: 'PUT', path: '/api/v1/courses/:id', action: 'Update course', tables: ['courses'] },
      { method: 'DELETE', path: '/api/v1/courses/:id', action: 'Delete course', tables: ['courses'] }
    ]
  },
  '/academic/teachers': {
    description: 'Gestion des enseignants',
    endpoints: [
      { method: 'GET', path: '/api/v1/teachers', action: 'Load teachers list', tables: ['teachers', 'users'] },
      { method: 'POST', path: '/api/v1/teachers', action: 'Create new teacher', tables: ['teachers'] },
      { method: 'PUT', path: '/api/v1/teachers/:id', action: 'Update teacher', tables: ['teachers'] },
      { method: 'DELETE', path: '/api/v1/teachers/:id', action: 'Delete teacher', tables: ['teachers'] }
    ]
  },
  '/academic/teachers/:id/assignments': {
    description: 'Affectations d\'un enseignant',
    endpoints: [
      { method: 'GET', path: '/api/v1/course-assignments', action: 'Load teacher assignments', tables: ['course_assignments', 'courses', 'teachers'] },
      { method: 'POST', path: '/api/v1/course-assignments', action: 'Create assignment', tables: ['course_assignments'] }
    ]
  },
  '/academic/students': {
    description: 'Gestion des étudiants',
    endpoints: [
      { method: 'GET', path: '/api/v1/students', action: 'Load students list', tables: ['student_profiles', 'users'] },
      { method: 'POST', path: '/api/v1/students', action: 'Create new student', tables: ['users', 'student_profiles'] },
      { method: 'PUT', path: '/api/v1/students/:id', action: 'Update student', tables: ['student_profiles'] },
      { method: 'DELETE', path: '/api/v1/students/:id', action: 'Delete student', tables: ['student_profiles', 'users'] }
    ]
  },
  '/academic/classrooms': {
    description: 'Gestion des salles de classe',
    endpoints: [
      { method: 'GET', path: '/api/v1/classrooms', action: 'Load classrooms list', tables: ['classrooms'] },
      { method: 'POST', path: '/api/v1/classrooms', action: 'Create classroom', tables: ['classrooms'] },
      { method: 'PUT', path: '/api/v1/classrooms/:id', action: 'Update classroom', tables: ['classrooms'] },
      { method: 'DELETE', path: '/api/v1/classrooms/:id', action: 'Delete classroom', tables: ['classrooms'] }
    ]
  },
  '/annee-academique/demarrer': {
    description: 'Démarrage nouvelle année académique',
    endpoints: [
      { method: 'POST', path: '/api/v1/academic-years', action: 'Create academic year', tables: ['academic_years'] },
      { method: 'GET', path: '/api/v1/academic-years', action: 'Load academic years', tables: ['academic_years'] }
    ]
  },
  '/annee-academique/ajouter-classe': {
    description: 'Ajout d\'une classe',
    endpoints: [
      { method: 'POST', path: '/api/v1/classes', action: 'Create class', tables: ['classes'] },
      { method: 'GET', path: '/api/v1/programmes', action: 'Load programmes for selection', tables: ['programmes'] }
    ]
  },
  '/annee-academique/inscription': {
    description: 'Inscription des étudiants',
    endpoints: [
      { method: 'POST', path: '/api/v1/enrollments', action: 'Enroll student', tables: ['enrollments'] },
      { method: 'GET', path: '/api/v1/students', action: 'Load students', tables: ['student_profiles', 'users'] },
      { method: 'GET', path: '/api/v1/classes', action: 'Load classes', tables: ['classes'] }
    ]
  },
  '/annee-academique/classes/:id': {
    description: 'Détails d\'une classe',
    endpoints: [
      { method: 'GET', path: '/api/v1/classes/:id', action: 'Load class details', tables: ['classes', 'enrollments'] },
      { method: 'GET', path: '/api/v1/class-courses', action: 'Load class courses', tables: ['class_courses', 'courses'] }
    ]
  },
  '/academic/assignments': {
    description: 'Gestion des devoirs',
    endpoints: [
      { method: 'GET', path: '/api/v1/assignments', action: 'Load assignments', tables: ['assignments'] },
      { method: 'POST', path: '/api/v1/assignments', action: 'Create assignment', tables: ['assignments'] },
      { method: 'PUT', path: '/api/v1/assignments/:id', action: 'Update assignment', tables: ['assignments'] },
      { method: 'DELETE', path: '/api/v1/assignments/:id', action: 'Delete assignment', tables: ['assignments'] }
    ]
  },
  '/academic/assignments/assign': {
    description: 'Affectation des devoirs aux classes',
    endpoints: [
      { method: 'POST', path: '/api/v1/assignment-instances', action: 'Assign to students', tables: ['assignment_instances'] },
      { method: 'GET', path: '/api/v1/assignments', action: 'Load assignments', tables: ['assignments'] }
    ]
  },
  '/academic/evaluations': {
    description: 'Gestion des évaluations',
    endpoints: [
      { method: 'GET', path: '/api/v1/assignments', action: 'Load evaluations', tables: ['assignments'] },
      { method: 'GET', path: '/api/v1/evaluation-questions', action: 'Load questions', tables: ['evaluation_questions'] }
    ]
  },
  '/attendance': {
    description: 'Gestion des présences',
    endpoints: [
      { method: 'GET', path: '/api/v1/attendance', action: 'Load attendance records', tables: ['attendance_records', 'session_instances'] },
      { method: 'POST', path: '/api/v1/attendance', action: 'Record attendance', tables: ['attendance_records'] },
      { method: 'PUT', path: '/api/v1/attendance/:id', action: 'Update attendance', tables: ['attendance_records'] }
    ]
  },
  '/payments/periods': {
    description: 'Périodes de paiement enseignants',
    endpoints: [
      { method: 'GET', path: '/api/v1/payment-periods', action: 'Load payment periods', tables: ['payment_periods'] },
      { method: 'POST', path: '/api/v1/payment-periods', action: 'Create payment period', tables: ['payment_periods'] },
      { method: 'PUT', path: '/api/v1/payment-periods/:id', action: 'Update payment period', tables: ['payment_periods'] }
    ]
  },
  '/payments/teacher-configs': {
    description: 'Configuration rémunération enseignants',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher-payment-configs', action: 'Load teacher configs', tables: ['teacher_payment_configs'] },
      { method: 'POST', path: '/api/v1/teacher-payment-configs', action: 'Create config', tables: ['teacher_payment_configs'] },
      { method: 'PUT', path: '/api/v1/teacher-payment-configs/:id', action: 'Update config', tables: ['teacher_payment_configs'] }
    ]
  },
  '/payments/teaching-hours': {
    description: 'Saisie des heures d\'enseignement',
    endpoints: [
      { method: 'GET', path: '/api/v1/teaching-hours', action: 'Load teaching hours', tables: ['teaching_hours', 'course_assignments'] },
      { method: 'POST', path: '/api/v1/teaching-hours', action: 'Record teaching hours', tables: ['teaching_hours'] },
      { method: 'POST', path: '/api/v1/teaching-hours/batch', action: 'Batch record hours', tables: ['teaching_hours'] }
    ]
  },
  '/payments/calculate': {
    description: 'Calcul des paiements enseignants',
    endpoints: [
      { method: 'POST', path: '/api/v1/teacher-payments/calculate', action: 'Calculate payments', tables: ['teacher_payments', 'teaching_hours', 'teacher_payment_configs'] },
      { method: 'GET', path: '/api/v1/teacher-payments', action: 'Load payments', tables: ['teacher_payments'] }
    ]
  },
  '/admin/finances/student-payments': {
    description: 'Gestion paiements étudiants',
    endpoints: [
      { method: 'GET', path: '/api/v1/student-payments', action: 'Load student payments', tables: ['student_payments', 'student_profiles'] },
      { method: 'POST', path: '/api/v1/student-payments', action: 'Record payment', tables: ['student_payments', 'receipts'] },
      { method: 'GET', path: '/api/v1/tuition-schedules', action: 'Load tuition schedules', tables: ['tuition_schedules'] }
    ]
  },
  '/admin/finances/tuition-schedules': {
    description: 'Échéanciers de scolarité',
    endpoints: [
      { method: 'GET', path: '/api/v1/tuition-schedules', action: 'Load schedules', tables: ['tuition_schedules', 'student_profiles'] },
      { method: 'POST', path: '/api/v1/tuition-schedules', action: 'Create schedule', tables: ['tuition_schedules'] },
      { method: 'PUT', path: '/api/v1/tuition-schedules/:id', action: 'Update schedule', tables: ['tuition_schedules'] }
    ]
  },
  '/admin/finances/reports': {
    description: 'Rapports financiers',
    endpoints: [
      { method: 'GET', path: '/api/v1/financial-reports/revenue', action: 'Revenue report', tables: ['student_payments', 'tuition_schedules'] },
      { method: 'GET', path: '/api/v1/financial-reports/teacher-costs', action: 'Teacher costs report', tables: ['teacher_payments'] },
      { method: 'GET', path: '/api/v1/financial-reports/summary', action: 'Financial summary', tables: ['student_payments', 'teacher_payments'] }
    ]
  },
  '/schedule-generation': {
    description: 'Génération d\'emploi du temps',
    endpoints: [
      { method: 'POST', path: '/api/v1/schedule-generation/generate', action: 'Generate schedule', tables: ['session_instances', 'class_courses', 'classrooms'] },
      { method: 'GET', path: '/api/v1/schedule-generation/requests', action: 'Load generation requests', tables: ['schedule_generation_requests'] },
      { method: 'GET', path: '/api/v1/session-instances', action: 'Load sessions', tables: ['session_instances'] }
    ]
  },
  '/teacher/dashboard': {
    description: 'Tableau de bord enseignant',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher/courses', action: 'Load my courses', tables: ['class_courses', 'courses', 'classes'] },
      { method: 'GET', path: '/api/v1/teacher/assignments', action: 'Load my assignments', tables: ['assignments', 'assignment_instances'] },
      { method: 'GET', path: '/api/v1/teacher/attendance/sessions', action: 'Load my sessions', tables: ['session_instances'] }
    ]
  },
  '/teacher/courses': {
    description: 'Mes cours (enseignant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher/courses', action: 'Load my courses', tables: ['class_courses', 'courses', 'classes'] },
      { method: 'GET', path: '/api/v1/teacher/courses/:id', action: 'Course details', tables: ['class_courses', 'courses', 'enrollments'] }
    ]
  },
  '/teacher/assignments': {
    description: 'Mes devoirs (enseignant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher/assignments', action: 'Load my assignments', tables: ['assignments', 'assignment_instances'] },
      { method: 'POST', path: '/api/v1/assignments', action: 'Create assignment', tables: ['assignments'] }
    ]
  },
  '/teacher/corrections': {
    description: 'Corrections (enseignant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher/corrections', action: 'Load submissions to grade', tables: ['assignment_instances', 'assignments', 'student_profiles'] },
      { method: 'PUT', path: '/api/v1/assignments/:assignmentId/submissions/:id', action: 'Grade submission', tables: ['assignment_instances'] }
    ]
  },
  '/teacher/attendance': {
    description: 'Présences (enseignant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/teacher/attendance', action: 'Load my sessions', tables: ['session_instances', 'class_courses'] },
      { method: 'POST', path: '/api/v1/attendance', action: 'Record attendance', tables: ['attendance_records'] },
      { method: 'GET', path: '/api/v1/attendance', action: 'Load attendance records', tables: ['attendance_records'] }
    ]
  },
  '/student/dashboard': {
    description: 'Tableau de bord étudiant',
    endpoints: [
      { method: 'GET', path: '/api/v1/student/courses', action: 'Load my courses', tables: ['enrollments', 'class_courses', 'courses'] },
      { method: 'GET', path: '/api/v1/student/assignments', action: 'Load my assignments', tables: ['assignment_instances', 'assignments'] },
      { method: 'GET', path: '/api/v1/student/grades', action: 'Load my grades', tables: ['assignment_instances'] }
    ]
  },
  '/student/courses': {
    description: 'Mes cours (étudiant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/student/courses', action: 'Load my courses', tables: ['enrollments', 'class_courses', 'courses', 'materials'] }
    ]
  },
  '/student/assignments': {
    description: 'Mes devoirs (étudiant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/student/assignments', action: 'Load my assignments', tables: ['assignment_instances', 'assignments'] },
      { method: 'POST', path: '/api/v1/assignments/:assignmentId/submissions/upload', action: 'Submit assignment', tables: ['assignment_instances'] }
    ]
  },
  '/student/grades': {
    description: 'Mes notes (étudiant)',
    endpoints: [
      { method: 'GET', path: '/api/v1/student/grades', action: 'Load my grades', tables: ['assignment_instances', 'assignments', 'class_courses'] }
    ]
  }
};

/**
 * Generate the audit documentation
 */
function generateDocumentation() {
  let markdown = `# EcoleDigitale Database Audit Report\n\n`;
  markdown += `**Generated**: ${new Date().toISOString()}\n`;
  markdown += `**Tech Stack**: Frontend (Next.js + TypeScript), Backend (Fastify + PostgreSQL), Auth (NextAuth.js)\n\n`;
  
  markdown += `## Database Schema Summary\n\n`;
  markdown += `**Total Tables**: ${Object.keys(DB_SCHEMA).length}\n\n`;
  
  markdown += `### Tables by Category\n\n`;
  markdown += `#### Core Tables (4)\n`;
  markdown += `- tenants, users, roles, user_roles\n\n`;
  
  markdown += `#### Academic Module (4)\n`;
  markdown += `- cycles, programmes, teaching_units, courses\n\n`;
  
  markdown += `#### Teacher Management (3)\n`;
  markdown += `- teachers, course_assignments, teaching_hours\n\n`;
  
  markdown += `#### Student Management (2)\n`;
  markdown += `- student_profiles, student_parents\n\n`;
  
  markdown += `#### Academic Operations (5)\n`;
  markdown += `- academic_years, classes, class_courses, enrollments, materials\n\n`;
  
  markdown += `#### Attendance (2)\n`;
  markdown += `- session_instances, attendance_records\n\n`;
  
  markdown += `#### Assignments & Evaluations (3)\n`;
  markdown += `- assignments, assignment_instances, evaluation_questions\n\n`;
  
  markdown += `#### Teacher Payments (4)\n`;
  markdown += `- payment_periods, teacher_payment_configs, teacher_payments, course_hourly_rates\n\n`;
  
  markdown += `#### Student Payments (4)\n`;
  markdown += `- cycle_fees, tuition_schedules, student_payments, receipts\n\n`;
  
  markdown += `#### Infrastructure (3)\n`;
  markdown += `- classrooms, classroom_reservations, notifications\n\n`;
  
  markdown += `---\n\n`;
  markdown += `## Page-by-Page Audit\n\n`;
  
  markdown += `### Admin Account\n\n`;
  
  // Sort pages for better organization
  const adminPages = Object.entries(PAGE_MAPPINGS).filter(([url, ]) => 
    !url.includes('/teacher/') && !url.includes('/student/')
  );
  
  for (const [pageUrl, pageInfo] of adminPages) {
    markdown += `#### PageUrl: ${pageUrl}\n`;
    markdown += `**Description**: ${pageInfo.description}\n\n`;
    
    for (const endpoint of pageInfo.endpoints) {
      const tables = endpoint.tables.map(t => {
        const cols = DB_SCHEMA[t] || [];
        return `${t}(${cols.join(', ')})`;
      }).join(', ');
      
      markdown += `- **Action or Control**: "${endpoint.action}"\n`;
      markdown += `    - **What it does**: ${endpoint.action}\n`;
      markdown += `    - **Table and colonnes used or affected**: ${tables}\n`;
      markdown += `    - **Endpoint**: ${endpoint.method} ${endpoint.path}\n\n`;
    }
    
    markdown += `\n`;
  }
  
  markdown += `### Teacher Account\n\n`;
  
  const teacherPages = Object.entries(PAGE_MAPPINGS).filter(([url, ]) => 
    url.includes('/teacher/')
  );
  
  for (const [pageUrl, pageInfo] of teacherPages) {
    markdown += `#### PageUrl: ${pageUrl}\n`;
    markdown += `**Description**: ${pageInfo.description}\n\n`;
    
    for (const endpoint of pageInfo.endpoints) {
      const tables = endpoint.tables.map(t => {
        const cols = DB_SCHEMA[t] || [];
        return `${t}(${cols.join(', ')})`;
      }).join(', ');
      
      markdown += `- **Action or Control**: "${endpoint.action}"\n`;
      markdown += `    - **What it does**: ${endpoint.action}\n`;
      markdown += `    - **Table and colonnes used or affected**: ${tables}\n`;
      markdown += `    - **Endpoint**: ${endpoint.method} ${endpoint.path}\n\n`;
    }
    
    markdown += `\n`;
  }
  
  markdown += `### Student Account\n\n`;
  
  const studentPages = Object.entries(PAGE_MAPPINGS).filter(([url, ]) => 
    url.includes('/student/')
  );
  
  for (const [pageUrl, pageInfo] of studentPages) {
    markdown += `#### PageUrl: ${pageUrl}\n`;
    markdown += `**Description**: ${pageInfo.description}\n\n`;
    
    for (const endpoint of pageInfo.endpoints) {
      const tables = endpoint.tables.map(t => {
        const cols = DB_SCHEMA[t] || [];
        return `${t}(${cols.join(', ')})`;
      }).join(', ');
      
      markdown += `- **Action or Control**: "${endpoint.action}"\n`;
      markdown += `    - **What it does**: ${endpoint.action}\n`;
      markdown += `    - **Table and colonnes used or affected**: ${tables}\n`;
      markdown += `    - **Endpoint**: ${endpoint.method} ${endpoint.path}\n\n`;
    }
    
    markdown += `\n`;
  }
  
  return markdown;
}

// Generate and write the documentation
const documentation = generateDocumentation();
fs.writeFileSync(path.join(__dirname, '..', 'Actual_ReadMe.md'), documentation);

console.log('✨ Documentation generated: Actual_ReadMe.md');
console.log(`📊 Total pages documented: ${Object.keys(PAGE_MAPPINGS).length}`);
console.log(`📊 Total database tables: ${Object.keys(DB_SCHEMA).length}`);

