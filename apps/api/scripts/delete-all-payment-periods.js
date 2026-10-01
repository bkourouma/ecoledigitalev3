// Delete recursively all payment periods (and related teacher_payments) for a tenant
// Usage: node apps/api/scripts/delete-all-payment-periods.js [tenantSlug]
// Default tenantSlug: imhotepacademy

const { Pool } = require('pg');

const DEFAULT_CONN = process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();
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
    const beforePeriods = await client.query(`SELECT COUNT(*) FROM payment_periods WHERE tenant_id = $1`, [tenantId]);
    const beforePayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [tenantId]);
    console.log(`Before - periods: ${beforePeriods.rows[0].count}, payments: ${beforePayments.rows[0].count}`);

    await client.query('BEGIN');

    // Disable triggers (audit, etc.) for this transaction to avoid FK issues in audit logs
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // Clean audit logs referencing payments in this tenant (defensive)
    try {
      await client.query(
        `DELETE FROM payment_audit_log WHERE tenant_id = $1 AND payment_id IN (
           SELECT id FROM teacher_payments WHERE tenant_id = $1
         )`,
        [tenantId]
      );
    } catch {}

    // Delete related teacher_payments first (period-scoped)
    await client.query(
      `DELETE FROM teacher_payments WHERE payment_period_id IN (SELECT id FROM payment_periods WHERE tenant_id = $1)`,
      [tenantId]
    );

    // Then delete periods
    await client.query(`DELETE FROM payment_periods WHERE tenant_id = $1`, [tenantId]);

    // Restore triggers
    await client.query("SET LOCAL session_replication_role = 'origin'");

    await client.query('COMMIT');

    const afterPeriods = await client.query(`SELECT COUNT(*) FROM payment_periods WHERE tenant_id = $1`, [tenantId]);
    const afterPayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [tenantId]);
    console.log(`After  - periods: ${afterPeriods.rows[0].count}, payments: ${afterPayments.rows[0].count}`);

    return {
      before: { periods: Number(beforePeriods.rows[0].count), payments: Number(beforePayments.rows[0].count) },
      after: { periods: Number(afterPeriods.rows[0].count), payments: Number(afterPayments.rows[0].count) },
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
      console.log('Completed:', res);
      process.exit(0);
    })
    .catch((err) => {
      process.exit(1);
    });
}

