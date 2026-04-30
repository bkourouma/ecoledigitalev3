const { Pool } = require('pg');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: 'DevMick@2003',
  port: 5432,
});

async function updateEnrollmentFees() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Mise à jour des frais d\'inscription...');
    console.log('   Enrollment ID: 07021987-fbe6-4dd4-ab9f-1dfe09122d48');
    console.log('');

    // 1. Récupérer l'inscription et trouver le cycle
    const enrollmentQuery = `
      SELECT 
        se.id,
        se.student_id,
        se.class_id,
        se.fees,
        c.programme_id,
        p.cycle_id
      FROM student_enrollments se
      JOIN classes c ON se.class_id = c.id
      LEFT JOIN programmes p ON c.programme_id = p.id
      WHERE se.id = $1
    `;
    
    const enrollmentResult = await client.query(enrollmentQuery, [
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48'
    ]);
    
    if (enrollmentResult.rows.length === 0) {
      console.log('❌ Inscription non trouvée.');
      return;
    }
    
    const enrollment = enrollmentResult.rows[0];
    console.log('✅ Inscription trouvée:');
    console.log(`   Classe ID: ${enrollment.class_id}`);
    console.log(`   Programme ID: ${enrollment.programme_id || 'NULL'}`);
    console.log(`   Cycle ID: ${enrollment.cycle_id || 'NULL'}`);
    console.log('');

    if (!enrollment.cycle_id) {
      console.log('⚠️  Aucun cycle associé à cette classe.');
      console.log('   Vous devez d\'abord associer un cycle à la classe.');
      return;
    }

    // 2. Récupérer les frais du cycle
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
    
    const cycleFeesResult = await client.query(cycleFeesQuery, [enrollment.cycle_id]);
    
    if (cycleFeesResult.rows.length === 0) {
      console.log('⚠️  Aucun frais configuré pour ce cycle.');
      console.log('   Vous devez d\'abord configurer les frais du cycle dans /admin/finances/scolarite');
      return;
    }
    
    const cycleFees = cycleFeesResult.rows[0];
    console.log('✅ Frais du cycle trouvés:');
    console.log(`   Inscription: ${cycleFees.inscription}`);
    console.log(`   Scolarité: ${cycleFees.scolarite}`);
    console.log(`   Annexes: ${cycleFees.annexes}`);
    console.log(`   Autres: ${cycleFees.autres}`);
    console.log(`   Currency: ${cycleFees.currency}`);
    console.log('');

    // 3. Mettre à jour les frais de l'inscription
    const newFees = {
      inscription: Number(cycleFees.inscription) || 0,
      scolarite: Number(cycleFees.scolarite) || 0,
      annexes: Number(cycleFees.annexes) || 0,
      autres: Number(cycleFees.autres) || 0,
      currency: cycleFees.currency || 'XOF',
      total: (Number(cycleFees.inscription) || 0) + 
             (Number(cycleFees.scolarite) || 0) + 
             (Number(cycleFees.annexes) || 0) + 
             (Number(cycleFees.autres) || 0)
    };

    const updateQuery = `
      UPDATE student_enrollments
      SET fees = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING fees
    `;
    
    const updateResult = await client.query(updateQuery, [
      JSON.stringify(newFees),
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48'
    ]);
    
    console.log('✅ Frais d\'inscription mis à jour:');
    console.log(JSON.stringify(updateResult.rows[0].fees, null, 2));
    console.log('');

    // 4. Vérifier avec la fonction de validation
    console.log('🧪 Test de validation après mise à jour:');
    const validationQuery = `
      SELECT validate_payment_amount_detailed($1, $2, $3) as result
    `;
    
    const validationResult = await client.query(validationQuery, [
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48',
      'inscription',
      newFees.inscription
    ]);
    
    if (validationResult.rows.length > 0) {
      const validation = validationResult.rows[0].result;
      console.log('   Résultat de validation:');
      console.log(JSON.stringify(validation, null, 2));
      console.log('');
      
      if (validation.is_valid) {
        console.log('✅ La validation fonctionne maintenant !');
      } else {
        console.log(`⚠️  La validation échoue encore: ${validation.message}`);
      }
    }

  } catch (error) {
    console.error('');
    console.error('❌ Erreur lors de la mise à jour:');
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

// Run the update
updateEnrollmentFees().catch(console.error);

