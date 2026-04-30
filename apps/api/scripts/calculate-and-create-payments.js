// Calculate and create payments manually for the period
const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || 'postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale';

async function calculateAndCreatePayments() {
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
    const userId = '634a57fe-2007-4ecb-ae5b-f9e3152a24fb'; // Default admin user
    const periodId = '56dd20cc-a494-4aca-85cf-c80121c7d00a';
    
    // Get period
    const periodRes = await client.query(`
      SELECT period_start, period_end FROM payment_periods WHERE id = $1 AND tenant_id = $2
    `, [periodId, tenantId]);
    
    if (periodRes.rows.length === 0) {
      console.error('Period not found');
      return;
    }
    
    const periodStart = periodRes.rows[0].period_start;
    const periodEnd = periodRes.rows[0].period_end;
    const periodStartStr = periodStart instanceof Date 
      ? periodStart.toISOString().split('T')[0] 
      : new Date(periodStart).toISOString().split('T')[0];
    const periodEndStr = periodEnd instanceof Date 
      ? periodEnd.toISOString().split('T')[0] 
      : new Date(periodEnd).toISOString().split('T')[0];
    
    console.log(`\n=== Calcul des paiements pour la période ===`);
    console.log(`Période: ${periodStartStr} → ${periodEndStr}\n`);
    
    // Get all active teachers
    const teachersRes = await client.query(`
      SELECT id, first_name, last_name
      FROM teachers
      WHERE tenant_id = $1 AND status = 'active'
      ORDER BY first_name, last_name
    `, [tenantId]);
    
    console.log(`Enseignants trouvés: ${teachersRes.rows.length}\n`);
    
    await client.query('BEGIN');
    
    let calculated = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const teacher of teachersRes.rows) {
      try {
        console.log(`\n--- Traitement: ${teacher.first_name} ${teacher.last_name} (${teacher.id}) ---`);
        
        // Get payment config
        const configRes = await client.query(`
          SELECT * FROM teacher_payment_configs 
          WHERE tenant_id = $1 AND teacher_id = $2 
          AND effective_from <= $3 
          AND (effective_to IS NULL OR effective_to >= $4)
          ORDER BY effective_from DESC
          LIMIT 1
        `, [tenantId, teacher.id, periodEnd, periodStart]);
        
        if (configRes.rows.length === 0) {
          console.log(`  ⚠️  Pas de configuration de paiement`);
          skipped++;
          continue;
        }
        
        const config = configRes.rows[0];
        const configType = config.config_type;
        const monthlySalary = parseFloat(config.monthly_salary) || 0;
        const hourlyRate = parseFloat(config.default_hourly_rate) || 0;
        
        console.log(`  Config: type=${configType}, salary=${monthlySalary}, hourlyRate=${hourlyRate}`);
        
        // Get teaching hours
        const hoursRes = await client.query(`
          SELECT th.*, ca.course_id
          FROM teaching_hours th
          JOIN course_assignments ca ON th.assignment_id = ca.id
          WHERE th.tenant_id = $1
          AND ca.teacher_id = $2
          AND th.validated_at IS NOT NULL
          AND DATE(th.validated_at) BETWEEN $3::date AND $4::date
        `, [tenantId, teacher.id, periodStartStr, periodEndStr]);
        
        console.log(`  Heures validées: ${hoursRes.rows.length} enregistrement(s)`);
        
        let totalHours = 0;
        hoursRes.rows.forEach(row => {
          totalHours += parseFloat(row.hours_taught) || 0;
        });
        console.log(`  Total heures: ${totalHours}h`);
        
        // Calculate payment
        let paymentType = 'salary';
        let baseAmount = 0;
        let totalAmount = 0;
        let calculationDetails = {};
        
        if (configType === 'salary') {
          // Salary-based: monthly salary regardless of hours
          baseAmount = monthlySalary;
          totalAmount = monthlySalary;
          calculationDetails = {
            type: 'salary',
            monthlySalary: monthlySalary,
            totalHours: totalHours,
            note: 'Salaire mensuel fixe'
          };
        } else if (configType === 'hourly') {
          // Hourly-based: hours × rate
          paymentType = 'hourly';
          baseAmount = totalHours * hourlyRate;
          totalAmount = baseAmount;
          calculationDetails = {
            type: 'hourly',
            totalHours: totalHours,
            hourlyRate: hourlyRate,
            baseAmount: baseAmount
          };
        } else if (configType === 'mixed') {
          // Mixed: salary + (hours × rate)
          paymentType = 'mixed';
          baseAmount = monthlySalary;
          const hourlyAmount = totalHours * hourlyRate;
          totalAmount = monthlySalary + hourlyAmount;
          calculationDetails = {
            type: 'mixed',
            monthlySalary: monthlySalary,
            totalHours: totalHours,
            hourlyRate: hourlyRate,
            hourlyAmount: hourlyAmount,
            totalAmount: totalAmount
          };
        }
        
        console.log(`  Calcul: ${paymentType}, montant = ${totalAmount} FCFA`);
        
        // Check if payment exists
        const existingRes = await client.query(`
          SELECT id FROM teacher_payments
          WHERE tenant_id = $1 AND teacher_id = $2 AND payment_period_id = $3 AND payment_type = $4
        `, [tenantId, teacher.id, periodId, paymentType]);
        
        if (existingRes.rows.length > 0) {
          // Update existing payment
          const paymentId = existingRes.rows[0].id;
          
          // Delete existing hour details
          await client.query(`
            DELETE FROM payment_hour_details WHERE tenant_id = $1 AND payment_id = $2
          `, [tenantId, paymentId]);
          
          // Update payment
          await client.query(`
            UPDATE teacher_payments
            SET base_amount = $1,
                overtime_amount = 0,
                bonus_amount = 0,
                deductions = 0,
                total_amount = $2,
                calculation_details = $3,
                updated_at = NOW()
            WHERE id = $4
          `, [baseAmount, totalAmount, JSON.stringify(calculationDetails), paymentId]);
          
          // Insert hour details
          for (const hourRow of hoursRes.rows) {
            await client.query(`
              INSERT INTO payment_hour_details
              (tenant_id, payment_id, teaching_hours_id, hours_count, hourly_rate, amount, is_overtime)
              VALUES ($1, $2, $3, $4, $5, $6, false)
            `, [
              tenantId,
              paymentId,
              hourRow.id,
              hourRow.hours_taught,
              hourlyRate || 0,
              (parseFloat(hourRow.hours_taught) || 0) * (hourlyRate || 0)
            ]);
          }
          
          updated++;
          console.log(`  ✅ Paiement mis à jour (ID: ${paymentId})`);
        } else {
          // Create new payment
          const insertRes = await client.query(`
            INSERT INTO teacher_payments
            (tenant_id, teacher_id, payment_period_id, payment_config_id, payment_type, base_amount,
             overtime_amount, bonus_amount, deductions, total_amount, calculation_details, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, $7, $8, $9)
            RETURNING id
          `, [
            tenantId,
            teacher.id,
            periodId,
            config.id,
            paymentType,
            baseAmount,
            totalAmount,
            JSON.stringify(calculationDetails),
            userId
          ]);
          
          const paymentId = insertRes.rows[0].id;
          
          // Insert hour details
          for (const hourRow of hoursRes.rows) {
            await client.query(`
              INSERT INTO payment_hour_details
              (tenant_id, payment_id, teaching_hours_id, hours_count, hourly_rate, amount, is_overtime)
              VALUES ($1, $2, $3, $4, $5, $6, false)
            `, [
              tenantId,
              paymentId,
              hourRow.id,
              hourRow.hours_taught,
              hourlyRate || 0,
              (parseFloat(hourRow.hours_taught) || 0) * (hourlyRate || 0)
            ]);
          }
          
          calculated++;
          console.log(`  ✅ Paiement créé (ID: ${paymentId})`);
        }
      } catch (error) {
        console.error(`  ❌ Erreur pour ${teacher.first_name} ${teacher.last_name}:`, error.message);
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`\n=== Résumé ===`);
    console.log(`Créés: ${calculated}`);
    console.log(`Mis à jour: ${updated}`);
    console.log(`Ignorés: ${skipped}\n`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

calculateAndCreatePayments();

