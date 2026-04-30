/**
 * Script direct pour supprimer le cours dupliqué "Visualisation de Données et Tableaux de Bord" (DV-DASH-002)
 * 
 * Ce script:
 * 1. Trouve tous les cours avec le code DV-DASH-002
 * 2. Vérifie leurs relations (assignments, classes, enrollments)
 * 3. Supprime le cours le plus récent sans relations (ou le plus récent si tous ont des relations)
 * 
 * Usage:
 *   npx tsx scripts/remove-duplicate-course-direct.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function removeDuplicateCourse() {
  console.log('🔍 Recherche du cours dupliqué: DV-DASH-002\n');
  
  try {
    // Trouver tous les cours avec le code DV-DASH-002
    const coursesQuery = `
      SELECT 
        id,
        code,
        name,
        status,
        created_at,
        updated_at,
        tenant_id
      FROM courses
      WHERE code = 'DV-DASH-002'
      ORDER BY created_at ASC
    `;

    const coursesResult = await pool.query(coursesQuery);

    if (coursesResult.rows.length === 0) {
      console.log('✅ Aucun cours trouvé avec le code DV-DASH-002');
      await pool.end();
      return;
    }

    if (coursesResult.rows.length === 1) {
      console.log('✅ Un seul cours trouvé, pas de doublon');
      console.log(`  - ID: ${coursesResult.rows[0].id}`);
      console.log(`  - Nom: ${coursesResult.rows[0].name}`);
      await pool.end();
      return;
    }

    console.log(`⚠️  ${coursesResult.rows.length} cours trouvés avec le code DV-DASH-002:\n`);
    
    const courses = coursesResult.rows;
    
    // Vérifier les relations pour chaque cours
    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      console.log(`Cours ${i + 1}:`);
      console.log(`  - ID: ${course.id}`);
      console.log(`  - Nom: ${course.name}`);
      console.log(`  - Statut: ${course.status}`);
      console.log(`  - Créé le: ${course.created_at ? new Date(course.created_at).toLocaleDateString('fr-FR') : 'N/A'}`);
      
      // Vérifier les devoirs
      const assignmentsCheck = await pool.query(
        'SELECT COUNT(*) as count FROM assignments WHERE course_id = $1',
        [course.id]
      );
      const assignmentsCount = parseInt(assignmentsCheck.rows[0].count);
      
      // Vérifier les classes
      const classesCheck = await pool.query(
        'SELECT COUNT(*) as count FROM classes WHERE course_id = $1',
        [course.id]
      );
      const classesCount = parseInt(classesCheck.rows[0].count);
      
      // Vérifier les inscriptions
      const enrollmentsCheck = await pool.query(
        'SELECT COUNT(*) as count FROM student_enrollments se JOIN classes c ON se.class_id = c.id WHERE c.course_id = $1',
        [course.id]
      );
      const enrollmentsCount = parseInt(enrollmentsCheck.rows[0].count);
      
      console.log(`  - Devoirs: ${assignmentsCount}`);
      console.log(`  - Classes: ${classesCount}`);
      console.log(`  - Inscriptions: ${enrollmentsCount}`);
      console.log(`  - Total relations: ${assignmentsCount + classesCount + enrollmentsCount}`);
      console.log('');
      
      // Ajouter les compteurs au cours
      (course as any).assignmentsCount = assignmentsCount;
      (course as any).classesCount = classesCount;
      (course as any).enrollmentsCount = enrollmentsCount;
      (course as any).totalRelations = assignmentsCount + classesCount + enrollmentsCount;
    }

    // Identifier le cours à supprimer (le plus récent sans relations, ou le plus récent si tous ont des relations)
    const coursesSorted = courses.sort((a, b) => {
      // Trier par nombre de relations (moins de relations en premier)
      if ((a as any).totalRelations !== (b as any).totalRelations) {
        return (a as any).totalRelations - (b as any).totalRelations;
      }
      // Si même nombre de relations, prendre le plus récent
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

    const courseToDelete = coursesSorted[0];

    console.log(`\n🗑️  Cours identifié pour suppression:`);
    console.log(`  - ID: ${courseToDelete.id}`);
    console.log(`  - Nom: ${courseToDelete.name}`);
    console.log(`  - Créé le: ${courseToDelete.created_at ? new Date(courseToDelete.created_at).toLocaleDateString('fr-FR') : 'N/A'}`);
    console.log(`  - Relations: ${(courseToDelete as any).totalRelations}`);
    console.log('');

    // Supprimer le cours (même s'il a des relations, car c'est un doublon)
    console.log(`🗑️  Suppression du cours dupliqué...\n`);

    if ((courseToDelete as any).totalRelations > 0) {
      console.log(`⚠️  ATTENTION: Ce cours a ${(courseToDelete as any).totalRelations} relation(s)!`);
      console.log(`La suppression va également supprimer:`);
      if ((courseToDelete as any).assignmentsCount > 0) {
        console.log(`  - ${(courseToDelete as any).assignmentsCount} devoir(s)`);
      }
      if ((courseToDelete as any).classesCount > 0) {
        console.log(`  - ${(courseToDelete as any).classesCount} classe(s)`);
      }
      if ((courseToDelete as any).enrollmentsCount > 0) {
        console.log(`  - ${(courseToDelete as any).enrollmentsCount} inscription(s)`);
      }
      console.log('');
      console.log(`⚠️  Suppression en cours malgré les relations (cours dupliqué)...\n`);
    } else {
      console.log(`✅ Aucune relation trouvée, suppression du cours...\n`);
    }

    await pool.query('BEGIN');

    try {
      // Supprimer d'abord les relations si nécessaire (CASCADE devrait le faire automatiquement)
      // Mais on vérifie d'abord si on peut supprimer directement
      
      const deleteResult = await pool.query(
        'DELETE FROM courses WHERE id = $1',
        [courseToDelete.id]
      );

      if (deleteResult.rowCount === 0) {
        throw new Error('Aucun cours supprimé');
      }

      await pool.query('COMMIT');

      console.log(`✅ Cours supprimé avec succès!`);
      console.log(`  - ID supprimé: ${courseToDelete.id}`);
      console.log(`  - Nom: ${courseToDelete.name}`);
      console.log(`  - Code: ${courseToDelete.code}`);
      if ((courseToDelete as any).totalRelations > 0) {
        console.log(`  - Relations supprimées: ${(courseToDelete as any).totalRelations}`);
      }

    } catch (error: any) {
      await pool.query('ROLLBACK');
      
      // Si l'erreur est due à des contraintes de clé étrangère, on essaie de supprimer les relations d'abord
      if (error.code === '23503' || error.message?.includes('foreign key')) {
        console.log(`⚠️  Erreur de contrainte de clé étrangère détectée.`);
        console.log(`Tentative de suppression des relations d'abord...\n`);
        
        await pool.query('BEGIN');
        
        try {
          // Supprimer les inscriptions d'abord
          if ((courseToDelete as any).enrollmentsCount > 0) {
            await pool.query(`
              DELETE FROM student_enrollments 
              WHERE class_id IN (
                SELECT id FROM classes WHERE course_id = $1
              )
            `, [courseToDelete.id]);
          }
          
          // Supprimer les classes
          if ((courseToDelete as any).classesCount > 0) {
            await pool.query('DELETE FROM classes WHERE course_id = $1', [courseToDelete.id]);
          }
          
          // Supprimer les devoirs
          if ((courseToDelete as any).assignmentsCount > 0) {
            await pool.query('DELETE FROM assignments WHERE course_id = $1', [courseToDelete.id]);
          }
          
          // Maintenant supprimer le cours
          const deleteResult = await pool.query(
            'DELETE FROM courses WHERE id = $1',
            [courseToDelete.id]
          );

          if (deleteResult.rowCount === 0) {
            throw new Error('Aucun cours supprimé');
          }

          await pool.query('COMMIT');

          console.log(`✅ Cours et relations supprimés avec succès!`);
          console.log(`  - ID supprimé: ${courseToDelete.id}`);
          console.log(`  - Nom: ${courseToDelete.name}`);
          console.log(`  - Code: ${courseToDelete.code}`);
          
        } catch (error2) {
          await pool.query('ROLLBACK');
          throw error2;
        }
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await pool.end();
  }
}

// Exécuter la suppression
removeDuplicateCourse().catch(console.error);

