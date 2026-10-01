const { Pool } = require('pg');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: process.env.PGPASSWORD || (() => { throw new Error("PGPASSWORD est requis (mot de passe Postgres)"); })(),
  port: 5432,
});

async function syncEnrollmentFees() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Synchronisation des frais d\'inscription avec les frais du cycle...');
    console.log('   Enrollment ID: 07021987-fbe6-4dd4-ab9f-1dfe09122d48');
    console.log('');

    await client.query('BEGIN');

    // 1. Récupérer l'inscription et trouver le cycle
    const enrollmentQuery = `
      SELECT 
        se.id,
        se.student_id,
        se.class_id,
        se.fees as current_fees,
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
      await client.query('ROLLBACK');
      return;
    }
    
    const enrollment = enrollmentResult.rows[0];
    console.log('✅ Inscription trouvée:');
    console.log(`   Cycle ID: ${enrollment.cycle_id || 'NULL'}`);
    console.log(`   Frais actuels:`, JSON.stringify(enrollment.current_fees, null, 2));
    console.log('');

    if (!enrollment.cycle_id) {
      console.log('❌ Aucun cycle associé à cette classe.');
      await client.query('ROLLBACK');
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
      console.log('❌ Aucun frais configuré pour ce cycle.');
      console.log('   Veuillez d\'abord configurer les frais dans /admin/finances/scolarite');
      await client.query('ROLLBACK');
      return;
    }
    
    const cycleFees = cycleFeesResult.rows[0];
    console.log('✅ Frais du cycle trouvés:');
    console.log(`   Inscription: ${cycleFees.inscription} ${cycleFees.currency}`);
    console.log(`   Scolarité: ${cycleFees.scolarite} ${cycleFees.currency}`);
    console.log(`   Annexes: ${cycleFees.annexes} ${cycleFees.currency}`);
    console.log(`   Autres: ${cycleFees.autres} ${cycleFees.currency}`);
    console.log('');

    // 3. Préparer les nouveaux frais
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

    // 4. Mettre à jour les frais de l'inscription
    const updateQuery = `
      UPDATE student_enrollments
      SET fees = $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
      RETURNING fees
    `;
    
    const updateResult = await client.query(updateQuery, [
      JSON.stringify(newFees),
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48'
    ]);
    
    await client.query('COMMIT');
    
    console.log('✅ Frais d\'inscription mis à jour:');
    console.log(JSON.stringify(updateResult.rows[0].fees, null, 2));
    console.log('');

    // 5. Vérifier avec la fonction de validation
    console.log('🧪 Test de validation après mise à jour:');
    const validationQuery = `
      SELECT validate_payment_amount_detailed($1, $2, $3) as result
    `;
    
    const validationResult = await client.query(validationQuery, [
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48',
      'inscription',
      5000
    ]);
    
    if (validationResult.rows.length > 0) {
      const validation = validationResult.rows[0].result;
      console.log('   Résultat de validation pour 5000 XOF:');
      console.log(JSON.stringify(validation, null, 2));
      console.log('');
      
      if (validation.is_valid) {
        console.log('✅ La validation fonctionne maintenant !');
        console.log(`   Vous pouvez maintenant enregistrer un paiement de ${validation.requested_amount} XOF`);
      } else {
        console.log(`⚠️  La validation échoue: ${validation.message}`);
        if (validation.outstanding !== undefined) {
          console.log(`   Montant restant disponible: ${validation.outstanding} XOF`);
        }
      }
    }

    // 6. Test avec le montant configuré (10000)
    console.log('');
    console.log('🧪 Test de validation avec le montant configuré (10000 XOF):');
    const validationFullQuery = `
      SELECT validate_payment_amount_detailed($1, $2, $3) as result
    `;
    
    const validationFullResult = await client.query(validationFullQuery, [
      '07021987-fbe6-4dd4-ab9f-1dfe09122d48',
      'inscription',
      newFees.inscription
    ]);
    
    if (validationFullResult.rows.length > 0) {
      const validationFull = validationFullResult.rows[0].result;
      console.log('   Résultat de validation:');
      console.log(JSON.stringify(validationFull, null, 2));
      console.log('');
      
      if (validationFull.is_valid) {
        console.log('✅ La validation fonctionne avec le montant complet !');
      }
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('');
    console.error('❌ Erreur lors de la synchronisation:');
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

// Run the sync
syncEnrollmentFees().catch(console.error);

