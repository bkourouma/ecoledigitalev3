// Get teacher assignments for imhotepacademy tenant
const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || 'postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale';

async function getTeacherAssignments() {
  const pool = new Pool({ connectionString: DEFAULT_CONN });
  const client = await pool.connect();
  try {
    // Get tenant ID
    const tenantRes = await client.query(`
      SELECT id FROM tenants WHERE slug = 'imhotepacademy' LIMIT 1
    `);
    
    if (tenantRes.rows.length === 0) {
      console.error('Tenant imhotepacademy not found');
      return;
    }
    
    const tenantId = tenantRes.rows[0].id;
    
    // Get all teacher assignments with details
    const result = await client.query(`
      SELECT 
        ta.id as assignment_id,
        ta.teacher_id,
        ta.datebut,
        ta.datefin,
        ta.contract_type,
        ta.course_amount,
        ta.status,
        ta.hours_validated,
        ta.validated_at,
        COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Unknown') as teacher_name,
        COALESCE(u.email, t.email) as teacher_email,
        c.name as course_name,
        c.code as course_code,
        cl.name as class_name,
        cl.code as class_code,
        -- Calculate estimated hours (2 hours per day)
        CASE 
          WHEN ta.course_amount IS NOT NULL THEN ROUND((ta.datefin - ta.datebut) * 2)::INTEGER
          ELSE 40
        END as estimated_hours
      FROM teacher_assignments ta
      LEFT JOIN class_courses cc ON cc.id = ta.class_course_id
      LEFT JOIN courses c ON c.id = cc.course_id
      LEFT JOIN classes cl ON cl.id = cc.class_id
      LEFT JOIN teachers t ON t.id = ta.teacher_id
      LEFT JOIN users u ON u.id = t.user_id
      WHERE ta.tenant_id = $1
        AND ta.status = 'active'
      ORDER BY teacher_name, ta.datebut
    `, [tenantId]);
    
    // Group by teacher
    const teachersMap = new Map();
    
    result.rows.forEach(row => {
      if (!teachersMap.has(row.teacher_id)) {
        teachersMap.set(row.teacher_id, {
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          teacherEmail: row.teacher_email,
          assignments: []
        });
      }
      
      teachersMap.get(row.teacher_id).assignments.push({
        assignmentId: row.assignment_id,
        courseName: row.course_name,
        courseCode: row.course_code,
        className: row.class_name,
        classCode: row.class_code,
        datebut: row.datebut,
        datefin: row.datefin,
        contractType: row.contract_type,
        courseAmount: row.course_amount,
        estimatedHours: row.estimated_hours,
        hoursValidated: row.hours_validated,
        validatedAt: row.validated_at,
        status: row.status
      });
    });
    
    const teachers = Array.from(teachersMap.values());
    
    console.log('\n=== ENSEIGNANTS AVEC AFFECTATIONS ===\n');
    console.log(`Total: ${teachers.length} enseignant(s)\n`);
    
    teachers.forEach((teacher, index) => {
      console.log(`${index + 1}. ${teacher.teacherName} (${teacher.teacherEmail})`);
      console.log(`   ID: ${teacher.teacherId}`);
      console.log(`   Affectations: ${teacher.assignments.length}\n`);
      
      teacher.assignments.forEach((assignment, aIndex) => {
        const isValidated = assignment.validatedAt && assignment.hoursValidated;
        const statusIcon = isValidated ? '✓' : '○';
        
        console.log(`   ${statusIcon} ${assignment.courseName} (${assignment.courseCode})`);
        console.log(`      Classe: ${assignment.className} (${assignment.classCode})`);
        console.log(`      Période: ${assignment.datebut} → ${assignment.datefin}`);
        console.log(`      Heures estimées: ${assignment.estimatedHours}h`);
        if (isValidated) {
          console.log(`      ✓ Validé: ${assignment.hoursValidated}h (${assignment.validatedAt})`);
        } else {
          console.log(`      ○ À valider`);
        }
        console.log(`      Assignment ID: ${assignment.assignmentId}\n`);
      });
      
      console.log('---\n');
    });
    
    // Summary
    const totalAssignments = teachers.reduce((sum, t) => sum + t.assignments.length, 0);
    const validatedAssignments = teachers.reduce((sum, t) => 
      sum + t.assignments.filter(a => a.validatedAt && a.hoursValidated).length, 0
    );
    const unvalidatedAssignments = totalAssignments - validatedAssignments;
    
    console.log('\n=== RÉSUMÉ ===\n');
    console.log(`Enseignants: ${teachers.length}`);
    console.log(`Total affectations: ${totalAssignments}`);
    console.log(`Affectations validées: ${validatedAssignments}`);
    console.log(`Affectations à valider: ${unvalidatedAssignments}\n`);
    
    // JSON output for easy copy-paste
    console.log('\n=== DONNÉES JSON ===\n');
    console.log(JSON.stringify(teachers, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

getTeacherAssignments();

