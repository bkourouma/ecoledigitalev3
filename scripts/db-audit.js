/**
 * Comprehensive Database Audit Script
 * 
 * This script performs a systematic audit of all API endpoints,
 * mapping them to database tables and columns.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE = process.env.API_URL || 'http://localhost:4000';
const WEB_BASE = process.env.WEB_URL || 'http://localhost:3000';

// Mot de passe commun des comptes de démonstration : à fournir par l'environnement (apps/api/.env ou shell).
const SEED_PASSWORD = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());

// Test accounts
const ACCOUNTS = {
  admin: {
    email: 'admin@imhotepacademy.fr',
    password: SEED_PASSWORD,
    tenant: 'imhotepacademy',
    role: 'admin'
  },
  teacher: {
    email: 'teacher@imhotepacademy.fr', // Need to find actual teacher account
    password: SEED_PASSWORD,
    tenant: 'imhotepacademy',
    role: 'teacher'
  },
  student: {
    email: 'student@imhotepacademy.fr',
    password: SEED_PASSWORD,
    tenant: 'imhotepacademy',
    role: 'student'
  }
};

// Route definitions with database mappings
const ROUTE_MAPPINGS = {
  '/api/v1/cycles': {
    table: 'cycles',
    columns: ['id', 'tenant_id', 'name', 'code', 'type', 'duration_months', 'description', 'certification_level', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List cycles', params: ['page', 'limit', 'status', 'type'] },
      POST: { action: 'Create cycle', body: ['name', 'code', 'type', 'durationMonths', 'description', 'certificationLevel'] },
    }
  },
  '/api/v1/programmes': {
    table: 'programmes',
    columns: ['id', 'tenant_id', 'cycle_id', 'name', 'code', 'version', 'description', 'objectives', 'ects_credits', 'academic_year', 'status', 'approved_by', 'approved_at', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List programmes', params: ['page', 'limit', 'cycleId', 'status'] },
      POST: { action: 'Create programme', body: ['cycleId', 'name', 'code', 'description', 'objectives', 'ectsCredits', 'academicYear'] },
    }
  },
  '/api/v1/courses': {
    table: 'courses',
    columns: ['id', 'tenant_id', 'teaching_unit_id', 'name', 'code', 'description', 'objectives', 'hours_total', 'hours_theory', 'hours_practical', 'delivery_mode', 'prerequisites', 'evaluation_methods', 'resources', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List courses', params: ['page', 'limit', 'teachingUnitId', 'status'] },
      POST: { action: 'Create course', body: ['teachingUnitId', 'name', 'code', 'description', 'hoursTotal', 'deliveryMode'] },
    }
  },
  '/api/v1/teachers': {
    table: 'teachers',
    columns: ['id', 'tenant_id', 'user_id', 'employee_number', 'first_name', 'last_name', 'email', 'phone', 'specialties', 'bio', 'qualifications', 'hire_date', 'contract_type', 'hourly_rate', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List teachers', params: ['page', 'limit', 'status', 'contractType'] },
      POST: { action: 'Create teacher', body: ['firstName', 'lastName', 'email', 'phone', 'contractType'] },
    }
  },
  '/api/v1/students': {
    table: 'student_profiles',
    join: 'users',
    columns: ['id', 'tenant_id', 'user_id', 'student_number', 'current_year', 'status', 'bio', 'date_of_birth', 'place_of_birth', 'nationality', 'address', 'phone', 'emergency_phone', 'is_active', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List students', params: ['page', 'limit', 'status', 'currentYear'] },
      POST: { action: 'Create student', body: ['userId', 'dateOfBirth', 'placeOfBirth', 'nationality'] },
    }
  },
  '/api/v1/academic-years': {
    table: 'academic_years',
    columns: ['id', 'tenant_id', 'name', 'start_date', 'end_date', 'is_current', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List academic years', params: ['page', 'limit'] },
      POST: { action: 'Create academic year', body: ['name', 'startDate', 'endDate', 'isCurrent'] },
    }
  },
  '/api/v1/classes': {
    table: 'classes',
    columns: ['id', 'tenant_id', 'academic_year_id', 'programme_id', 'name', 'code', 'level', 'max_students', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List classes', params: ['page', 'limit', 'academicYearId', 'programmeId'] },
      POST: { action: 'Create class', body: ['academicYearId', 'programmeId', 'name', 'code', 'level', 'maxStudents'] },
    }
  },
  '/api/v1/enrollments': {
    table: 'enrollments',
    columns: ['id', 'tenant_id', 'student_id', 'class_id', 'academic_year_id', 'enrollment_date', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List enrollments', params: ['page', 'limit', 'classId', 'studentId', 'academicYearId'] },
      POST: { action: 'Create enrollment', body: ['studentId', 'classId', 'academicYearId', 'enrollmentDate'] },
    }
  },
  '/api/v1/attendance': {
    table: 'attendance_records',
    columns: ['id', 'tenant_id', 'session_instance_id', 'student_id', 'status', 'recorded_by', 'recorded_at', 'notes', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List attendance records', params: ['page', 'limit', 'sessionInstanceId', 'studentId'] },
      POST: { action: 'Record attendance', body: ['sessionInstanceId', 'studentId', 'status', 'notes'] },
    }
  },
  '/api/v1/assignments': {
    table: 'assignments',
    columns: ['id', 'tenant_id', 'class_course_id', 'title', 'description', 'type', 'max_points', 'due_date', 'status', 'created_by', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List assignments', params: ['page', 'limit', 'classCourseId', 'status'] },
      POST: { action: 'Create assignment', body: ['classCourseId', 'title', 'description', 'type', 'maxPoints', 'dueDate'] },
    }
  },
  '/api/v1/payment-periods': {
    table: 'payment_periods',
    columns: ['id', 'tenant_id', 'name', 'start_date', 'end_date', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List payment periods', params: ['page', 'limit', 'status'] },
      POST: { action: 'Create payment period', body: ['name', 'startDate', 'endDate'] },
    }
  },
  '/api/v1/teacher-payments': {
    table: 'teacher_payments',
    columns: ['id', 'tenant_id', 'teacher_id', 'payment_period_id', 'total_hours', 'gross_amount', 'deductions', 'net_amount', 'status', 'paid_at', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List teacher payments', params: ['page', 'limit', 'teacherId', 'paymentPeriodId', 'status'] },
      POST: { action: 'Create teacher payment', body: ['teacherId', 'paymentPeriodId', 'totalHours', 'grossAmount'] },
    }
  },
  '/api/v1/student-payments': {
    table: 'student_payments',
    columns: ['id', 'tenant_id', 'student_id', 'amount', 'payment_date', 'payment_method', 'status', 'receipt_number', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List student payments', params: ['page', 'limit', 'studentId', 'status'] },
      POST: { action: 'Record student payment', body: ['studentId', 'amount', 'paymentDate', 'paymentMethod'] },
    }
  },
  '/api/v1/classrooms': {
    table: 'classrooms',
    columns: ['id', 'tenant_id', 'name', 'code', 'capacity', 'building', 'floor', 'equipment', 'status', 'created_at', 'updated_at'],
    methods: {
      GET: { action: 'List classrooms', params: ['page', 'limit', 'status'] },
      POST: { action: 'Create classroom', body: ['name', 'code', 'capacity', 'building', 'floor'] },
    }
  },
  '/api/v1/schedule-generation': {
    table: 'session_instances',
    join: 'class_courses',
    columns: ['id', 'tenant_id', 'class_course_id', 'classroom_id', 'teacher_id', 'start_time', 'end_time', 'date', 'status', 'created_at', 'updated_at'],
    methods: {
      POST: { action: 'Generate schedule', body: ['academicYearId', 'classId', 'startDate', 'endDate'] },
      GET: { action: 'List schedule', params: ['classId', 'teacherId', 'startDate', 'endDate'] },
    }
  }
};

// Test results storage
const auditResults = [];

/**
 * Authenticate and get session token
 */
async function authenticate(account) {
  try {
    const response = await axios.post(`${API_BASE}/api/v1/auth/login`, {
      email: account.email,
      password: account.password
    }, {
      headers: {
        'X-Tenant': account.tenant,
        'Content-Type': 'application/json'
      }
    });
    
    return {
      userId: response.data.userId,
      token: response.data.token,
      tenant: account.tenant
    };
  } catch (error) {
    console.error(`❌ Authentication failed for ${account.email}:`, error.message);
    return null;
  }
}

/**
 * Test an endpoint
 */
async function testEndpoint(route, method, auth, options = {}) {
  const url = `${API_BASE}${route}`;
  const headers = {
    'X-Tenant': auth.tenant,
    'X-User-Id': auth.userId,
    'Content-Type': 'application/json',
    ...(auth.token && { 'Authorization': `Bearer ${auth.token}` })
  };

  try {
    let response;
    switch (method) {
      case 'GET':
        response = await axios.get(url, { 
          headers, 
          params: options.params || {} 
        });
        break;
      case 'POST':
        response = await axios.post(url, options.body || {}, { headers });
        break;
      case 'PUT':
        response = await axios.put(url, options.body || {}, { headers });
        break;
      case 'DELETE':
        response = await axios.delete(url, { headers });
        break;
    }

    return {
      success: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      status: error.response?.status || 500,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Generate audit report
 */
function generateReport() {
  const reportPath = path.join(__dirname, '..', 'DB_AUDIT_REPORT.md');
  let markdown = `# Database Audit Report - ${new Date().toISOString()}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- Total Endpoints Tested: ${auditResults.length}\n`;
  markdown += `- Successful: ${auditResults.filter(r => r.success).length}\n`;
  markdown += `- Failed: ${auditResults.filter(r => !r.success).length}\n\n`;
  
  markdown += `## Detailed Results\n\n`;
  
  for (const result of auditResults) {
    const status = result.success ? '✅' : '❌';
    markdown += `### ${status} ${result.method} ${result.route}\n`;
    markdown += `- **Table**: ${result.table}\n`;
    markdown += `- **Columns**: ${result.columns.join(', ')}\n`;
    markdown += `- **Action**: ${result.action}\n`;
    markdown += `- **Status Code**: ${result.statusCode}\n`;
    if (!result.success) {
      markdown += `- **Error**: ${JSON.stringify(result.error, null, 2)}\n`;
    }
    markdown += `\n`;
  }

  fs.writeFileSync(reportPath, markdown);
  console.log(`\n📄 Report generated: ${reportPath}`);
}

/**
 * Main audit function
 */
async function runAudit() {
  console.log('🔍 Starting Database Audit...\n');

  // Authenticate as admin
  console.log('🔐 Authenticating as admin...');
  const adminAuth = await authenticate(ACCOUNTS.admin);
  if (!adminAuth) {
    console.error('❌ Failed to authenticate. Audit aborted.');
    return;
  }
  console.log('✅ Authenticated successfully\n');

  // Test each route
  for (const [route, mapping] of Object.entries(ROUTE_MAPPINGS)) {
    console.log(`\n📍 Testing ${route}...`);
    
    for (const [method, methodInfo] of Object.entries(mapping.methods)) {
      console.log(`  → ${method} ${route}`);
      
      const result = await testEndpoint(route, method, adminAuth, {
        params: method === 'GET' ? { page: 1, limit: 10 } : undefined
      });

      auditResults.push({
        route,
        method,
        table: mapping.table,
        columns: mapping.columns,
        action: methodInfo.action,
        success: result.success,
        statusCode: result.status,
        error: result.error
      });

      const icon = result.success ? '✅' : '❌';
      console.log(`    ${icon} ${result.status}`);
    }
  }

  // Generate report
  generateReport();
  
  console.log('\n✨ Audit completed!\n');
}

// Run audit
runAudit().catch(console.error);

