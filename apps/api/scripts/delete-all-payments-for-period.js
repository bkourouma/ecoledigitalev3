// Delete all payments for a specific period
const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || 'postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale';

async function deleteAllPaymentsForPeriod() {
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
    const periodId = '56dd20cc-a494-4aca-85cf-c80121c7d00a';
    
    console.log(`\n=== Suppression des paiements pour la période ===`);
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Period ID: ${periodId}\n`);
    
    await client.query('BEGIN');
    
    // First, get count of payments to delete
    const countRes = await client.query(`
      SELECT COUNT(*) as count
      FROM teacher_payments
      WHERE tenant_id = $1 AND payment_period_id = $2
    `, [tenantId, periodId]);
    
    const count = parseInt(countRes.rows[0].count);
    console.log(`Paiements trouvés: ${count}`);
    
    if (count === 0) {
      console.log('Aucun paiement à supprimer.');
      await client.query('ROLLBACK');
      return;
    }
    
    // Disable triggers temporarily
    await client.query("SET LOCAL session_replication_role = 'replica'");
    
    try {
      // Delete payment audit logs
      const auditRes = await client.query(`
        DELETE FROM payment_audit_log 
        WHERE tenant_id = $1 
        AND payment_id IN (
          SELECT id FROM teacher_payments 
          WHERE tenant_id = $1 AND payment_period_id = $2
        )
      `, [tenantId, periodId]);
      console.log(`Logs d'audit supprimés: ${auditRes.rowCount}`);
    } catch (err) {
      console.log(`Note: Erreur lors de la suppression des logs d'audit (peut être normal): ${err.message}`);
    }
    
    // Delete payment hour details
    const detailsRes = await client.query(`
      DELETE FROM payment_hour_details
      WHERE tenant_id = $1
      AND payment_id IN (
        SELECT id FROM teacher_payments 
        WHERE tenant_id = $1 AND payment_period_id = $2
      )
    `, [tenantId, periodId]);
    console.log(`Détails d'heures supprimés: ${detailsRes.rowCount}`);
    
    // Delete payments
    const paymentsRes = await client.query(`
      DELETE FROM teacher_payments
      WHERE tenant_id = $1 AND payment_period_id = $2
    `, [tenantId, periodId]);
    console.log(`Paiements supprimés: ${paymentsRes.rowCount}`);
    
    // Re-enable triggers
    await client.query("SET LOCAL session_replication_role = 'origin'");
    
    await client.query('COMMIT');
    
    console.log(`\n✅ Suppression terminée avec succès !\n`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de la suppression:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

deleteAllPaymentsForPeriod();

