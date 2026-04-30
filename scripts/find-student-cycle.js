const { Pool } = require('pg');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: 'DevMick@2003',
  port: 5432,
});

async function findStudentCycle() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Recherche du cycle de l\'étudiant...');
    console.log('   Student ID: 5ebf8d56-897b-4a69-80c1-51b0e754631d');
    console.log('   Email: student@imhotepacademy.fr');
    console.log('   Numéro: STU-IMH-TEST-001');
    console.log('');

    // Recherche complète: Étudiant → Inscription → Classe → Programme → Cycle
    const query = `
      SELECT 
        sp.id as student_id,
        sp.student_number,
        sp.current_year,
        u.email,
        u.first_name,
        u.last_name,
        se.id as enrollment_id,
        se.status as enrollment_status,
        se.enrollment_date,
        c.id as class_id,
        c.name as class_name,
        c.code as class_code,
        p.id as programme_id,
        p.name as programme_name,
        p.code as programme_code,
        cy.id as cycle_id,
        cy.name as cycle_name,
        cy.code as cycle_code,
        cy.type as cycle_type,
        cy.duration_months,
        cy.certification_level,
        cy.status as cycle_status
      FROM student_profiles sp
      JOIN users u ON sp.user_id = u.id
      JOIN student_enrollments se ON sp.id = se.student_id
      JOIN classes c ON se.class_id = c.id
      LEFT JOIN programmes p ON c.programme_id = p.id
      LEFT JOIN cycles cy ON p.cycle_id = cy.id
      WHERE (sp.id = $1 OR u.email = $2 OR sp.student_number = $3)
        AND se.status = 'active'
      ORDER BY se.created_at DESC
      LIMIT 1
    `;
    
    const result = await client.query(query, [
      '5ebf8d56-897b-4a69-80c1-51b0e754631d',
      'student@imhotepacademy.fr',
      'STU-IMH-TEST-001'
    ]);
    
    if (result.rows.length === 0) {
      console.log('❌ Aucun étudiant inscrit trouvé avec ces informations.');
      console.log('');
      console.log('💡 Vérification des inscriptions inactives...');
      
      // Vérifier aussi les inscriptions inactives
      const inactiveQuery = `
        SELECT 
          sp.id as student_id,
          sp.student_number,
          u.email,
          se.id as enrollment_id,
          se.status as enrollment_status
        FROM student_profiles sp
        JOIN users u ON sp.user_id = u.id
        JOIN student_enrollments se ON sp.id = se.student_id
        WHERE (sp.id = $1 OR u.email = $2 OR sp.student_number = $3)
        ORDER BY se.created_at DESC
        LIMIT 5
      `;
      
      const inactiveResult = await client.query(inactiveQuery, [
        '5ebf8d56-897b-4a69-80c1-51b0e754631d',
        'student@imhotepacademy.fr',
        'STU-IMH-TEST-001'
      ]);
      
      if (inactiveResult.rows.length > 0) {
        console.log(`   Trouvé ${inactiveResult.rows.length} inscription(s) (toutes inactives):`);
        inactiveResult.rows.forEach((row, index) => {
          console.log(`   ${index + 1}. ID: ${row.enrollment_id}, Statut: ${row.enrollment_status}`);
        });
      }
      return;
    }
    
    const student = result.rows[0];
    
    console.log('✅ Étudiant trouvé:');
    console.log(`   ID: ${student.student_id}`);
    console.log(`   Numéro: ${student.student_number}`);
    console.log(`   Nom: ${student.first_name || ''} ${student.last_name || ''}`);
    console.log(`   Email: ${student.email}`);
    console.log(`   Année actuelle: ${student.current_year}`);
    console.log('');
    
    console.log('📋 Inscription:');
    console.log(`   ID: ${student.enrollment_id}`);
    console.log(`   Statut: ${student.enrollment_status}`);
    console.log(`   Date: ${student.enrollment_date}`);
    console.log('');
    
    console.log('🏫 Classe:');
    console.log(`   ID: ${student.class_id}`);
    console.log(`   Nom: ${student.class_name}`);
    console.log(`   Code: ${student.class_code}`);
    console.log('');
    
    if (student.programme_id) {
      console.log('📚 Programme:');
      console.log(`   ID: ${student.programme_id}`);
      console.log(`   Nom: ${student.programme_name}`);
      console.log(`   Code: ${student.programme_code}`);
      console.log('');
    } else {
      console.log('⚠️  Aucun programme associé à cette classe.');
      console.log('');
    }
    
    if (student.cycle_id) {
      console.log('🎓 CYCLE TROUVÉ:');
      console.log(`   ID: ${student.cycle_id}`);
      console.log(`   Nom: ${student.cycle_name}`);
      console.log(`   Code: ${student.cycle_code}`);
      console.log(`   Type: ${student.cycle_type}`);
      console.log(`   Durée: ${student.duration_months} mois`);
      if (student.certification_level) {
        console.log(`   Niveau: ${student.certification_level}`);
      }
      console.log(`   Statut: ${student.cycle_status}`);
      console.log('');
      
      // Vérifier si les frais du cycle sont configurés
      const cycleFeesQuery = `
        SELECT 
          inscription,
          scolarite,
          annexes,
          autres,
          currency
        FROM cycles_frais
        WHERE cycle_id = $1
      `;
      
      const cycleFeesResult = await client.query(cycleFeesQuery, [student.cycle_id]);
      
      if (cycleFeesResult.rows.length > 0) {
        const fees = cycleFeesResult.rows[0];
        console.log('💰 Frais du cycle configurés:');
        console.log(`   Inscription: ${fees.inscription} ${fees.currency}`);
        console.log(`   Scolarité: ${fees.scolarite} ${fees.currency}`);
        console.log(`   Annexes: ${fees.annexes} ${fees.currency}`);
        console.log(`   Autres: ${fees.autres} ${fees.currency}`);
        console.log('');
      } else {
        console.log('⚠️  Aucun frais configuré pour ce cycle.');
        console.log('   Vous devez configurer les frais dans /admin/finances/scolarite');
        console.log('');
      }
      
      console.log('📊 RÉSUMÉ:');
      console.log(`   Étudiant: ${student.student_number} - ${student.email}`);
      console.log(`   Classe: ${student.class_name}`);
      console.log(`   Programme: ${student.programme_name || 'Non défini'}`);
      console.log(`   CYCLE: ${student.cycle_name} (${student.cycle_code})`);
      console.log('');
      
    } else {
      console.log('❌ Aucun cycle trouvé.');
      console.log('');
      console.log('💡 Pour trouver le cycle:');
      console.log('   1. La classe doit être associée à un programme');
      console.log('   2. Le programme doit être associé à un cycle');
      console.log('');
      console.log('   Vérification de la chaîne:');
      console.log(`   - Classe → Programme: ${student.programme_id ? '✅' : '❌'}`);
      console.log(`   - Programme → Cycle: ${student.cycle_id ? '✅' : '❌'}`);
      console.log('');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Erreur lors de la recherche:');
    console.error('');
    console.error('Error details:');
    console.error(error.message);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the search
findStudentCycle().catch(console.error);

