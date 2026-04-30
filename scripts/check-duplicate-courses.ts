/**
 * Script pour vérifier et supprimer les cours dupliqués
 * 
 * Usage:
 *   npx tsx scripts/check-duplicate-courses.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkAndRemoveDuplicateCourses() {
  console.log('🔍 Vérification des cours dupliqués\n');
  
  try {
    // Rechercher les cours dupliqués par code
    const duplicateQuery = `
      SELECT 
        code,
        name,
        COUNT(*) as count,
        array_agg(id ORDER BY created_at) as ids,
        array_agg(created_at ORDER BY created_at) as created_dates
      FROM courses
      WHERE code = 'DV-DASH-002'
      GROUP BY code, name
      HAVING COUNT(*) > 1
    `;

    const duplicateResult = await pool.query(duplicateQuery);

    if (duplicateResult.rows.length === 0) {
      console.log('✅ Aucun cours dupliqué trouvé avec le code DV-DASH-002');
      await pool.end();
      return;
    }

    console.log(`⚠️  Cours dupliqués trouvés:\n`);
    
    duplicateResult.rows.forEach((row, index) => {
      console.log(`Cours ${index + 1}:`);
      console.log(`  - Code: ${row.code}`);
      console.log(`  - Nom: ${row.name}`);
      console.log(`  - Nombre de doublons: ${row.count}`);
      console.log(`  - IDs: ${row.ids.join(', ')}`);
      console.log(`  - Dates de création: ${row.created_dates.join(', ')}`);
      console.log('');
    });

    // Afficher les détails complets de chaque cours
    const detailsQuery = `
      SELECT 
        id,
        code,
        name,
        description,
        status,
        starts_at,
        ends_at,
        created_at,
        updated_at,
        tenant_id
      FROM courses
      WHERE code = 'DV-DASH-002'
      ORDER BY created_at ASC
    `;

    const detailsResult = await pool.query(detailsQuery);

    console.log(`📋 Détails complets des cours:\n`);
    detailsResult.rows.forEach((course, index) => {
      console.log(`Cours ${index + 1}:`);
      console.log(`  - ID: ${course.id}`);
      console.log(`  - Code: ${course.code}`);
      console.log(`  - Nom: ${course.name}`);
      console.log(`  - Statut: ${course.status}`);
      console.log(`  - Période: ${course.starts_at ? new Date(course.starts_at).toLocaleDateString('fr-FR') : 'N/A'} - ${course.ends_at ? new Date(course.ends_at).toLocaleDateString('fr-FR') : 'N/A'}`);
      console.log(`  - Créé le: ${course.created_at ? new Date(course.created_at).toLocaleDateString('fr-FR') : 'N/A'}`);
      console.log(`  - Tenant ID: ${course.tenant_id}`);
      console.log('');
    });

    // Vérifier les relations (assignments, enrollments, etc.)
    if (detailsResult.rows.length > 0) {
      const courseIds = detailsResult.rows.map(c => c.id);
      
      console.log(`🔗 Vérification des relations:\n`);
      
      // Vérifier les assignments
      const assignmentsQuery = `
        SELECT 
          course_id,
          COUNT(*) as assignment_count
        FROM assignments
        WHERE course_id = ANY($1)
        GROUP BY course_id
      `;
      const assignmentsResult = await pool.query(assignmentsQuery, [courseIds]);
      
      assignmentsResult.rows.forEach(row => {
        const course = detailsResult.rows.find(c => c.id === row.course_id);
        console.log(`  - Cours ${course?.name} (${course?.id}): ${row.assignment_count} devoirs`);
      });

      // Vérifier les enrollments
      const enrollmentsQuery = `
        SELECT 
          course_id,
          COUNT(*) as enrollment_count
        FROM student_enrollments se
        JOIN classes c ON se.class_id = c.id
        WHERE c.course_id = ANY($1)
        GROUP BY course_id
      `;
      const enrollmentsResult = await pool.query(enrollmentsQuery, [courseIds]);
      
      enrollmentsResult.rows.forEach(row => {
        const course = detailsResult.rows.find(c => c.id === row.course_id);
        console.log(`  - Cours ${course?.name} (${course?.id}): ${row.enrollment_count} inscriptions`);
      });

      // Vérifier les classes
      const classesQuery = `
        SELECT 
          course_id,
          COUNT(*) as class_count
        FROM classes
        WHERE course_id = ANY($1)
        GROUP BY course_id
      `;
      const classesResult = await pool.query(classesQuery, [courseIds]);
      
      classesResult.rows.forEach(row => {
        const course = detailsResult.rows.find(c => c.id === row.course_id);
        console.log(`  - Cours ${course?.name} (${course?.id}): ${row.class_count} classes`);
      });
    }

    // Identifier le cours à supprimer (généralement le plus récent ou celui sans relations)
    console.log(`\n🗑️  Identification du cours à supprimer:\n`);
    
    const coursesToDelete = detailsResult.rows
      .map(course => ({
        ...course,
        hasRelations: false, // Sera mis à jour après vérification
      }))
      .sort((a, b) => {
        // Trier par date de création (le plus récent en premier)
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });

    // Vérifier les relations pour chaque cours
    for (const course of coursesToDelete) {
      const hasAssignments = await pool.query(
        'SELECT COUNT(*) FROM assignments WHERE course_id = $1',
        [course.id]
      );
      const hasEnrollments = await pool.query(
        'SELECT COUNT(*) FROM student_enrollments se JOIN classes c ON se.class_id = c.id WHERE c.course_id = $1',
        [course.id]
      );
      const hasClasses = await pool.query(
        'SELECT COUNT(*) FROM classes WHERE course_id = $1',
        [course.id]
      );

      course.hasRelations = 
        parseInt(hasAssignments.rows[0].count) > 0 ||
        parseInt(hasEnrollments.rows[0].count) > 0 ||
        parseInt(hasClasses.rows[0].count) > 0;
    }

    // Trouver le cours à supprimer (le plus récent sans relations, ou le plus récent si tous ont des relations)
    const courseToDelete = coursesToDelete.find(c => !c.hasRelations) || coursesToDelete[0];

    if (courseToDelete) {
      console.log(`Cours identifié pour suppression:`);
      console.log(`  - ID: ${courseToDelete.id}`);
      console.log(`  - Code: ${courseToDelete.code}`);
      console.log(`  - Nom: ${courseToDelete.name}`);
      console.log(`  - Créé le: ${courseToDelete.created_at ? new Date(courseToDelete.created_at).toLocaleDateString('fr-FR') : 'N/A'}`);
      console.log(`  - A des relations: ${courseToDelete.hasRelations ? 'Oui' : 'Non'}`);
      console.log('');

      // Demander confirmation (dans un vrai script, on utiliserait readline)
      console.log(`⚠️  ATTENTION: Cette opération va supprimer le cours et toutes ses relations!`);
      console.log(`Pour supprimer le cours, exécutez:`);
      console.log(`  DELETE FROM courses WHERE id = '${courseToDelete.id}';`);
      console.log('');
      console.log(`Ou utilisez le script de suppression: npx tsx scripts/remove-duplicate-course.ts ${courseToDelete.id}`);
    }

  } catch (error) {
    console.error('❌ Erreur lors de la vérification:', error);
  } finally {
    await pool.end();
  }
}

// Exécuter la vérification
checkAndRemoveDuplicateCourses().catch(console.error);

