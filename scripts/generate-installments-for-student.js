const { Pool } = require('pg');

// Database connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbecoledigitale',
  password: 'DevMick@2003',
  port: 5432,
});

async function generateInstallmentsForStudent() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Génération des échéances pour l\'étudiant...');
    console.log('   Étudiant: STU-IMH-TEST-001');
    console.log('');

    await client.query('BEGIN');

    // 1. Trouver l'étudiant et son inscription
    const studentQuery = `
      SELECT 
        sp.id as student_id,
        se.id as enrollment_id,
        se.fees,
        se.academic_year_id,
        se.class_id,
        cl.name as class_name,
        c.id as cycle_id,
        c.name as cycle_name
      FROM student_profiles sp
      JOIN users u ON sp.user_id = u.id
      JOIN student_enrollments se ON sp.id = se.student_id
      JOIN classes cl ON se.class_id = cl.id
      LEFT JOIN programmes p ON cl.programme_id = p.id
      LEFT JOIN cycles c ON p.cycle_id = c.id
      WHERE sp.student_number = 'STU-IMH-TEST-001'
        AND sp.tenant_id = (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1)
        AND se.status = 'active'
      ORDER BY se.created_at DESC
      LIMIT 1
    `;
    
    const studentResult = await client.query(studentQuery);
    
    if (studentResult.rows.length === 0) {
      console.log('❌ Étudiant non trouvé');
      await client.query('ROLLBACK');
      return;
    }
    
    const student = studentResult.rows[0];
    console.log('✅ Étudiant trouvé:');
    console.log(`   ID: ${student.student_id}`);
    console.log(`   Inscription ID: ${student.enrollment_id}`);
    console.log(`   Classe: ${student.class_name}`);
    console.log(`   Cycle: ${student.cycle_name}`);
    console.log(`   Frais scolarité: ${student.fees?.scolarite || 0} XOF`);
    console.log('');

    // 2. Trouver l'échéancier pour ce cycle
    const scheduleQuery = `
      SELECT 
        tps.id,
        tps.schedule_name,
        tps.academic_year_id,
        tps.class_id,
        tps.installments,
        cl.name as class_name,
        c.id as cycle_id,
        c.name as cycle_name
      FROM tuition_payment_schedules tps
      LEFT JOIN classes cl ON tps.class_id = cl.id
      LEFT JOIN programmes p ON cl.programme_id = p.id
      LEFT JOIN cycles c ON p.cycle_id = c.id
      WHERE tps.tenant_id = (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1)
        AND tps.academic_year_id = $1
        AND (
          (c.id = $2 AND tps.class_id IS NOT NULL)
          OR (tps.class_id = $3)
        )
      ORDER BY tps.created_at DESC
      LIMIT 1
    `;
    
    const scheduleResult = await client.query(scheduleQuery, [
      student.academic_year_id,
      student.cycle_id,
      student.class_id
    ]);
    
    if (scheduleResult.rows.length === 0) {
      console.log('❌ Aucun échéancier trouvé pour cet étudiant');
      await client.query('ROLLBACK');
      return;
    }
    
    const schedule = scheduleResult.rows[0];
    console.log('✅ Échéancier trouvé:');
    console.log(`   ID: ${schedule.id}`);
    console.log(`   Nom: ${schedule.schedule_name}`);
    console.log(`   Échéances configurées: ${schedule.installments?.length || 0}`);
    console.log('');

    // 3. Vérifier si les échéances existent déjà
    const existingQuery = `
      SELECT COUNT(*) as count
      FROM student_tuition_installments
      WHERE student_id = $1
        AND enrollment_id = $2
        AND schedule_id = $3
        AND tenant_id = (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1)
    `;
    
    const existingResult = await client.query(existingQuery, [
      student.student_id,
      student.enrollment_id,
      schedule.id
    ]);
    
    const existingCount = parseInt(existingResult.rows[0]?.count || '0', 10);
    
    if (existingCount > 0) {
      console.log(`⚠️  ${existingCount} échéance(s) existante(s) déjà pour cet étudiant`);
      console.log('   Suppression des échéances existantes...');
      
      await client.query(`
        DELETE FROM student_tuition_installments
        WHERE student_id = $1
          AND enrollment_id = $2
          AND schedule_id = $3
          AND tenant_id = (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1)
      `, [student.student_id, student.enrollment_id, schedule.id]);
    }

    // 4. Générer les échéances
    const installments = schedule.installments || [];
    const tuitionFee = parseFloat(student.fees?.scolarite || 0);
    
    if (tuitionFee === 0) {
      console.log('⚠️  Les frais de scolarité sont à 0. Impossible de générer les échéances.');
      await client.query('ROLLBACK');
      return;
    }
    
    console.log('📋 Génération des échéances...');
    let createdCount = 0;
    
    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      const amount = (tuitionFee * inst.percentage) / 100;
      
      const insertQuery = `
        INSERT INTO student_tuition_installments (
          tenant_id,
          student_id,
          enrollment_id,
          schedule_id,
          installment_number,
          installment_label,
          amount,
          due_date,
          status,
          amount_paid,
          late_fee
        ) VALUES (
          (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1),
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'pending',
          0,
          0
        )
        ON CONFLICT (tenant_id, enrollment_id, installment_number) 
        DO UPDATE SET
          schedule_id = EXCLUDED.schedule_id,
          installment_label = EXCLUDED.installment_label,
          amount = EXCLUDED.amount,
          due_date = EXCLUDED.due_date
      `;
      
      await client.query(insertQuery, [
        student.student_id,
        student.enrollment_id,
        schedule.id,
        i + 1,
        inst.label,
        amount,
        inst.dueDate,
      ]);
      
      createdCount++;
      console.log(`   ✅ ${inst.label}: ${amount.toLocaleString('fr-FR')} XOF (${inst.percentage}%) - ${inst.dueDate}`);
    }
    
    await client.query('COMMIT');
    
    console.log('');
    console.log(`✅ ${createdCount} échéance(s) générée(s) avec succès !`);
    console.log('');

    // 5. Vérifier les échéances générées
    const verifyQuery = `
      SELECT 
        sti.installment_number,
        sti.installment_label,
        sti.amount,
        sti.due_date,
        sti.status,
        sti.amount_paid
      FROM student_tuition_installments sti
      WHERE sti.student_id = $1
        AND sti.enrollment_id = $2
        AND sti.schedule_id = $3
        AND sti.tenant_id = (SELECT id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1)
      ORDER BY sti.installment_number
    `;
    
    const verifyResult = await client.query(verifyQuery, [
      student.student_id,
      student.enrollment_id,
      schedule.id
    ]);
    
    console.log('📊 Échéances générées:');
    verifyResult.rows.forEach((inst, index) => {
      const remaining = Number(inst.amount) - Number(inst.amount_paid);
      console.log(`   ${index + 1}. ${inst.installment_label} - ${Number(inst.amount).toLocaleString('fr-FR')} XOF - ${inst.due_date} - Reste: ${remaining.toLocaleString('fr-FR')} XOF`);
    });
    console.log('');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('');
    console.error('❌ Erreur lors de la génération:');
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

// Run the generation
generateInstallmentsForStudent().catch(console.error);

