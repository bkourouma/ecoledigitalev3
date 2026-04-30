// Delete all teacher payments for a tenant
// Usage: node apps/api/scripts/delete-all-teacher-payments.js [tenantSlug]
// Default tenantSlug: imhotepacademy

const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || 'postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale';
const tenantSlug = process.argv[2] || 'imhotepacademy';

async function resolveTenantId(client, slugOrCode) {
  // Some DBs may not have a 'code' column; use slug only and fallback for known dev tenant
  const q = `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`;
  const r = await client.query(q, [slugOrCode]);
  if (r.rows.length > 0) return r.rows[0].id;
  if (slugOrCode === 'imhotepacademy') return '6eb9c106-b650-4398-b6fa-091b6828c4ba';
  throw new Error(`Tenant not found for '${slugOrCode}'`);
}

async function run(tenant) {
  const pool = new Pool({ connectionString: DEFAULT_CONN });
  const client = await pool.connect();
  try {
    console.log(`Connecting... tenant='${tenant}'`);
    const tenantId = await resolveTenantId(client, tenant);
    console.log(`Resolved tenantId: ${tenantId}`);

    // Count before
    const beforePayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [tenantId]);
    const beforeHourDetails = await client.query(
      `SELECT COUNT(*) FROM payment_hour_details WHERE tenant_id = $1`,
      [tenantId]
    );
    const beforeAuditLogs = await client.query(
      `SELECT COUNT(*) FROM payment_audit_log WHERE tenant_id = $1`,
      [tenantId]
    );
    console.log(`Before - payments: ${beforePayments.rows[0].count}, hour_details: ${beforeHourDetails.rows[0].count}, audit_logs: ${beforeAuditLogs.rows[0].count}`);

    await client.query('BEGIN');

    // Disable triggers (audit, etc.) for this transaction to avoid FK issues in audit logs
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // Delete audit logs first (they reference payments)
    try {
      await client.query(
        `DELETE FROM payment_audit_log WHERE tenant_id = $1 AND payment_id IN (
           SELECT id FROM teacher_payments WHERE tenant_id = $1
         )`,
        [tenantId]
      );
      console.log('Deleted payment audit logs');
    } catch (err) {
      console.log('Note: payment_audit_log table may not exist, skipping...');
    }

    // Delete payment hour details (they reference payments)
    await client.query(
      `DELETE FROM payment_hour_details WHERE tenant_id = $1 AND payment_id IN (
         SELECT id FROM teacher_payments WHERE tenant_id = $1
       )`,
      [tenantId]
    );
    console.log('Deleted payment hour details');

    // Delete all teacher payments for this tenant
    await client.query(`DELETE FROM teacher_payments WHERE tenant_id = $1`, [tenantId]);
    console.log('Deleted all teacher payments');

    // Restore triggers
    await client.query("SET LOCAL session_replication_role = 'origin'");

    await client.query('COMMIT');

    const afterPayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [tenantId]);
    const afterHourDetails = await client.query(
      `SELECT COUNT(*) FROM payment_hour_details WHERE tenant_id = $1`,
      [tenantId]
    );
    const afterAuditLogs = await client.query(
      `SELECT COUNT(*) FROM payment_audit_log WHERE tenant_id = $1`,
      [tenantId]
    );
    console.log(`After  - payments: ${afterPayments.rows[0].count}, hour_details: ${afterHourDetails.rows[0].count}, audit_logs: ${afterAuditLogs.rows[0].count}`);

    return {
      before: { 
        payments: Number(beforePayments.rows[0].count), 
        hourDetails: Number(beforeHourDetails.rows[0].count),
        auditLogs: Number(beforeAuditLogs.rows[0].count)
      },
      after: { 
        payments: Number(afterPayments.rows[0].count), 
        hourDetails: Number(afterHourDetails.rows[0].count),
        auditLogs: Number(afterAuditLogs.rows[0].count)
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Delete-all failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow import for tests
module.exports = { run };

if (require.main === module) {
  run(tenantSlug)
    .then((res) => {
      console.log('✅ Completed:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
}

