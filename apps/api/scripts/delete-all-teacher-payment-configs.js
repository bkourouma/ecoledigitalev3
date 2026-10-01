// Delete all teacher payment configs for a tenant
// Usage: node apps/api/scripts/delete-all-teacher-payment-configs.js [tenantSlug]
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
    const beforeConfigs = await client.query(`SELECT COUNT(*) FROM teacher_payment_configs WHERE tenant_id = $1`, [tenantId]);
    const beforePaymentsWithConfig = await client.query(
      `SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1 AND payment_config_id IS NOT NULL`,
      [tenantId]
    );
    console.log(`Before - configs: ${beforeConfigs.rows[0].count}, payments with config: ${beforePaymentsWithConfig.rows[0].count}`);

    await client.query('BEGIN');

    // Disable triggers (audit, etc.) for this transaction to avoid FK issues in audit logs
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // Set payment_config_id to NULL in teacher_payments that reference these configs
    // This is safe because payment_config_id is nullable
    await client.query(
      `UPDATE teacher_payments 
       SET payment_config_id = NULL 
       WHERE tenant_id = $1 AND payment_config_id IN (
         SELECT id FROM teacher_payment_configs WHERE tenant_id = $1
       )`,
      [tenantId]
    );
    console.log('Updated teacher_payments to remove config references');

    // Delete all teacher payment configs for this tenant
    await client.query(`DELETE FROM teacher_payment_configs WHERE tenant_id = $1`, [tenantId]);
    console.log('Deleted all teacher payment configs');

    // Restore triggers
    await client.query("SET LOCAL session_replication_role = 'origin'");

    await client.query('COMMIT');

    const afterConfigs = await client.query(`SELECT COUNT(*) FROM teacher_payment_configs WHERE tenant_id = $1`, [tenantId]);
    const afterPaymentsWithConfig = await client.query(
      `SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1 AND payment_config_id IS NOT NULL`,
      [tenantId]
    );
    console.log(`After  - configs: ${afterConfigs.rows[0].count}, payments with config: ${afterPaymentsWithConfig.rows[0].count}`);

    return {
      before: { 
        configs: Number(beforeConfigs.rows[0].count), 
        paymentsWithConfig: Number(beforePaymentsWithConfig.rows[0].count) 
      },
      after: { 
        configs: Number(afterConfigs.rows[0].count), 
        paymentsWithConfig: Number(afterPaymentsWithConfig.rows[0].count) 
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

