/**
 * Script de débogage pour vérifier les notes des étudiants
 * 
 * Usage: 
 *   npx tsx apps/api/scripts/debug-student-grades.ts <student_id> <tenant_id>
 * 
 * Ce script vérifie:
 * 1. Les soumissions corrigées d'un étudiant
 * 2. Les notes calculées par la requête de progression
 * 3. Les différences entre les deux
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })(),
});

async function resolveTenantId(client: any, tenantSlugOrId: string): Promise<string> {
  // Check if it's already a UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantSlugOrId);
  if (isUuid) {
    return tenantSlugOrId;
  }
  
  // Try to resolve slug to UUID
  const result = await client.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [tenantSlugOrId]);
  if (result.rows.length > 0) {
    return result.rows[0].id;
  }
  
  // Fallback: known tenant mappings
  if (tenantSlugOrId === 'imhotepacademy') {
    return '6eb9c106-b650-4398-b6fa-091b6828c4ba';
  }
  
  throw new Error(`Tenant not found: ${tenantSlugOrId}`);
}

async function debugStudentGrades(studentId?: string, tenantId: string = 'imhotepacademy') {
  try {
    console.log('🔍 Début du débogage des notes étudiants\n');
    console.log(`Tenant (slug/id): ${tenantId}`);
    
    // Resolve tenant ID
    const client = await pool.connect();
    try {
      const resolvedTenantId = await resolveTenantId(client, tenantId);
      console.log(`Tenant ID résolu: ${resolvedTenantId}\n`);
      tenantId = resolvedTenantId;
    } finally {
      client.release();
    }
    
    if (studentId) {
      console.log(`Student ID: ${studentId}\n`);
    }

    // 1. Vérifier les soumissions corrigées directement
    console.log('='.repeat(80));
    console.log('1. SOUMISSIONS CORRIGÉES DIRECTEMENT');
    console.log('='.repeat(80));
    
    const submissionsQuery = `
      SELECT 
        s.id as submission_id,
        s.student_id,
        s.assignment_id,
        s.final_score,
        s.manual_score,
        s.graded_at,
        s.status,
        a.title as assignment_title,
        a.course_id,
        c.name as course_name,
        u.first_name || ' ' || u.last_name as student_name,
        sp.student_number as matricule
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      LEFT JOIN courses c ON a.course_id = c.id
      JOIN student_profiles sp ON s.student_id = sp.id
      JOIN users u ON sp.user_id = u.id
      WHERE s.tenant_id = $1
        AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
        ${studentId ? 'AND s.student_id = $2' : ''}
      ORDER BY s.graded_at DESC
      LIMIT 20
    `;

    const submissionsParams = studentId ? [tenantId, studentId] : [tenantId];
    const submissionsResult = await pool.query(submissionsQuery, submissionsParams);
    
    console.log(`\n✅ Trouvé ${submissionsResult.rows.length} soumissions corrigées:\n`);
    
    if (submissionsResult.rows.length > 0) {
      submissionsResult.rows.forEach((row, index) => {
        const grade = row.final_score || row.manual_score;
        console.log(`${index + 1}. ${row.student_name} (${row.matricule})`);
        console.log(`   Assignment: ${row.assignment_title}`);
        console.log(`   Course: ${row.course_name || 'N/A'}`);
        console.log(`   Grade: ${grade}/20`);
        console.log(`   Final Score: ${row.final_score || 'NULL'}, Manual Score: ${row.manual_score || 'NULL'}`);
        console.log(`   Graded At: ${row.graded_at || 'NULL'}`);
        console.log(`   Status: ${row.status}`);
        console.log('');
      });

      // Calculer la moyenne pour chaque étudiant
      const studentAverages = submissionsResult.rows.reduce((acc: any, row) => {
        const studentId = row.student_id;
        const grade = parseFloat(row.final_score) || parseFloat(row.manual_score) || 0;
        
        if (!acc[studentId]) {
          acc[studentId] = {
            name: row.student_name,
            matricule: row.matricule,
            grades: [],
            total: 0,
            count: 0
          };
        }
        
        acc[studentId].grades.push(grade);
        acc[studentId].total += grade;
        acc[studentId].count += 1;
        
        return acc;
      }, {});

      console.log('\n📊 MOYENNES CALCULÉES PAR ÉTUDIANT:');
      console.log('='.repeat(80));
      Object.values(studentAverages).forEach((student: any) => {
        const average = student.total / student.count;
        console.log(`${student.name} (${student.matricule}): ${average.toFixed(2)}/20`);
        console.log(`  Notes: [${student.grades.map((g: number) => g.toFixed(1)).join(', ')}]`);
        console.log(`  Nombre de notes: ${student.count}`);
        console.log('');
      });
    } else {
      console.log('❌ Aucune soumission corrigée trouvée\n');
    }

    // 1.5. Vérifier pourquoi l'étudiant avec des notes n'apparaît pas
    if (submissionsResult.rows.length > 0) {
      const studentWithGrade = submissionsResult.rows[0];
      console.log('='.repeat(80));
      console.log('1.5. VÉRIFICATION POURQUOI L\'ÉTUDIANT N\'APPARAÎT PAS');
      console.log('='.repeat(80));
      
      const checkQuery = await pool.query(`
        SELECT 
          sp.id as student_id,
          u.first_name || ' ' || u.last_name as student_name,
          sp.student_number,
          se.class_id,
          cl.name as class_name,
          se.status as enrollment_status,
          -- Check if student is in teacher assignments
          (SELECT COUNT(*) 
           FROM teacher_assignments ta
           JOIN class_courses cc ON ta.class_course_id = cc.id
           WHERE cc.class_id = se.class_id
             AND ta.tenant_id = $1
          ) as teacher_assignments_count,
          -- Check course
          c.id as course_id,
          c.name as course_name
        FROM student_profiles sp
        JOIN users u ON sp.user_id = u.id
        JOIN student_enrollments se ON sp.id = se.student_id
        JOIN classes cl ON se.class_id = cl.id
        LEFT JOIN assignments a ON a.course_id = (SELECT course_id FROM assignments WHERE id = $2 LIMIT 1)
        LEFT JOIN courses c ON a.course_id = c.id
        WHERE sp.id = $3
          AND se.tenant_id = $1
        LIMIT 1
      `, [tenantId, studentWithGrade.assignment_id, studentWithGrade.student_id]);
      
      if (checkQuery.rows.length > 0) {
        const check = checkQuery.rows[0];
        console.log(`\nÉtudiant: ${check.student_name} (${check.student_number})`);
        console.log(`Classe: ${check.class_name}`);
        console.log(`Statut d'inscription: ${check.enrollment_status}`);
        console.log(`Assignations d'enseignant pour cette classe: ${check.teacher_assignments_count}`);
        console.log(`Cours de la soumission: ${studentWithGrade.course_name}`);
        console.log('');
      }
    }

    // 2. Tester la requête de progression (similaire à l'API)
    console.log('='.repeat(80));
    console.log('2. REQUÊTE DE PROGRESSION (comme dans l\'API)');
    console.log('='.repeat(80));

    // Simuler un teacher_id pour la requête
    const teacherQuery = await pool.query(`
      SELECT id FROM teachers WHERE tenant_id = $1 LIMIT 1
    `, [tenantId]);

    if (teacherQuery.rows.length === 0) {
      console.log('❌ Aucun enseignant trouvé pour ce tenant\n');
      return;
    }

    const teacherId = teacherQuery.rows[0].id;
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 jours

    const progressQuery = `
      SELECT 
        sp.id as student_id,
        u.first_name,
        u.last_name,
        sp.student_number as matricule,
        cl.name as class_name,
        c.name as course_name,
        -- Current grade: average of all graded assignments
        COALESCE(
          (SELECT AVG(COALESCE(s.final_score, s.manual_score))
           FROM assignment_submissions s
           JOIN assignment_instances ai ON s.assignment_instance_id = ai.id
           JOIN assignments a ON ai.assignment_id = a.id
           WHERE s.student_id = sp.id
             AND s.tenant_id = $2
             AND ai.tenant_id = $2
             AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
          ), 0
        ) as current_grade,
        -- Alternative: direct query without assignment_instances
        COALESCE(
          (SELECT AVG(COALESCE(s.final_score, s.manual_score))
           FROM assignment_submissions s
           JOIN assignments a ON s.assignment_id = a.id
           WHERE s.student_id = sp.id
             AND s.tenant_id = $2
             AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
          ), 0
        ) as current_grade_direct
      FROM teacher_assignments ta
      JOIN class_courses cc ON ta.class_course_id = cc.id
      JOIN classes cl ON cc.class_id = cl.id
      JOIN courses c ON cc.course_id = c.id
      JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2 AND se.status = 'active'
      JOIN student_profiles sp ON se.student_id = sp.id AND sp.tenant_id = $2
      JOIN users u ON sp.user_id = u.id
      WHERE ta.teacher_id = $1
        AND ta.tenant_id = $2
        ${studentId ? 'AND sp.id = $3' : ''}
      ORDER BY u.last_name ASC, u.first_name ASC
      LIMIT 10
    `;

    const progressParams = studentId 
      ? [teacherId, tenantId, studentId]
      : [teacherId, tenantId];

    const progressResult = await pool.query(progressQuery, progressParams);
    
    console.log(`\n✅ Requête de progression retourne ${progressResult.rows.length} étudiants:\n`);
    
    progressResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.first_name} ${row.last_name} (${row.matricule})`);
      console.log(`   Classe: ${row.class_name}`);
      console.log(`   Cours: ${row.course_name}`);
      console.log(`   Note actuelle (via instances): ${parseFloat(row.current_grade).toFixed(2)}/20`);
      console.log(`   Note actuelle (directe): ${parseFloat(row.current_grade_direct).toFixed(2)}/20`);
      console.log('');
    });

    // 3. Comparer les deux méthodes
    console.log('='.repeat(80));
    console.log('3. COMPARAISON');
    console.log('='.repeat(80));
    
    if (submissionsResult.rows.length > 0 && progressResult.rows.length > 0) {
      const studentIdFromSubmissions = submissionsResult.rows[0].student_id;
      const matchingProgress = progressResult.rows.find((r: any) => r.student_id === studentIdFromSubmissions);
      
      if (matchingProgress) {
        const directAverage = Object.values(studentAverages).find((s: any) => 
          submissionsResult.rows[0].student_id === matchingProgress.student_id
        ) as any;
        
        if (directAverage) {
          const calculatedAvg = directAverage.total / directAverage.count;
          console.log(`\nÉtudiant: ${matchingProgress.first_name} ${matchingProgress.last_name}`);
          console.log(`Moyenne directe (soumissions): ${calculatedAvg.toFixed(2)}/20`);
          console.log(`Moyenne via instances: ${parseFloat(matchingProgress.current_grade).toFixed(2)}/20`);
          console.log(`Moyenne directe (sans instances): ${parseFloat(matchingProgress.current_grade_direct).toFixed(2)}/20`);
          
          if (Math.abs(calculatedAvg - parseFloat(matchingProgress.current_grade)) > 0.01) {
            console.log(`\n⚠️ DIFFÉRENCE DÉTECTÉE!`);
            console.log(`   La requête via instances ne correspond pas aux soumissions directes.`);
          } else {
            console.log(`\n✅ Les moyennes correspondent!`);
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await pool.end();
  }
}

// Récupérer les arguments de la ligne de commande
const args = process.argv.slice(2);
const studentId = args[0] || undefined;
const tenantId = args[1] || 'imhotepacademy';

debugStudentGrades(studentId, tenantId);

