/**
 * Script pour supprimer un cours dupliqué
 * 
 * Usage:
 *   npx tsx scripts/remove-duplicate-course.ts <course_id>
 * 
 * Exemple:
 *   npx tsx scripts/remove-duplicate-course.ts 123e4567-e89b-12d3-a456-426614174000
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function removeDuplicateCourse(courseId: string) {
  console.log(`🗑️  Suppression du cours dupliqué: ${courseId}\n`);
  
  try {
    // Vérifier que le cours existe
    const courseCheck = await pool.query(
      'SELECT id, code, name, created_at FROM courses WHERE id = $1',
      [courseId]
    );

    if (courseCheck.rows.length === 0) {
      console.error(`❌ Erreur: Le cours avec l'ID ${courseId} n'existe pas`);
      await pool.end();
      return;
    }

    const course = courseCheck.rows[0];
    console.log(`Cours trouvé:`);
    console.log(`  - ID: ${course.id}`);
    console.log(`  - Code: ${course.code}`);
    console.log(`  - Nom: ${course.name}`);
    console.log(`  - Créé le: ${course.created_at ? new Date(course.created_at).toLocaleDateString('fr-FR') : 'N/A'}`);
    console.log('');

    // Vérifier les relations avant suppression
    console.log(`🔗 Vérification des relations:\n`);

    const assignmentsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM assignments WHERE course_id = $1',
      [courseId]
    );
    const assignmentsCount = parseInt(assignmentsCheck.rows[0].count);

    const classesCheck = await pool.query(
      'SELECT COUNT(*) as count FROM classes WHERE course_id = $1',
      [courseId]
    );
    const classesCount = parseInt(classesCheck.rows[0].count);

    const enrollmentsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM student_enrollments se JOIN classes c ON se.class_id = c.id WHERE c.course_id = $1',
      [courseId]
    );
    const enrollmentsCount = parseInt(enrollmentsCheck.rows[0].count);

    console.log(`  - Devoirs (assignments): ${assignmentsCount}`);
    console.log(`  - Classes: ${classesCount}`);
    console.log(`  - Inscriptions (enrollments): ${enrollmentsCount}`);
    console.log('');

    if (assignmentsCount > 0 || classesCount > 0 || enrollmentsCount > 0) {
      console.log(`⚠️  ATTENTION: Ce cours a des relations!`);
      console.log(`La suppression va également supprimer:`);
      if (assignmentsCount > 0) {
        console.log(`  - ${assignmentsCount} devoir(s)`);
      }
      if (classesCount > 0) {
        console.log(`  - ${classesCount} classe(s)`);
      }
      if (enrollmentsCount > 0) {
        console.log(`  - ${enrollmentsCount} inscription(s)`);
      }
      console.log('');
      console.log(`Pour continuer, modifiez ce script et décommentez la ligne de suppression.`);
      await pool.end();
      return;
    }

    // Supprimer le cours (si pas de relations)
    console.log(`✅ Aucune relation trouvée, suppression du cours...\n`);

    await pool.query('BEGIN');

    try {
      // Supprimer le cours
      const deleteResult = await pool.query(
        'DELETE FROM courses WHERE id = $1',
        [courseId]
      );

      if (deleteResult.rowCount === 0) {
        throw new Error('Aucun cours supprimé');
      }

      await pool.query('COMMIT');

      console.log(`✅ Cours supprimé avec succès!`);
      console.log(`  - ID supprimé: ${courseId}`);
      console.log(`  - Nom: ${course.name}`);
      console.log(`  - Code: ${course.code}`);

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error);
  } finally {
    await pool.end();
  }
}

// Récupérer l'ID du cours depuis les arguments de la ligne de commande
const courseId = process.argv[2];

if (!courseId) {
  console.error('❌ Erreur: Veuillez fournir l\'ID du cours à supprimer');
  console.error('Usage: npx tsx scripts/remove-duplicate-course.ts <course_id>');
  process.exit(1);
}

// Exécuter la suppression
removeDuplicateCourse(courseId).catch(console.error);

