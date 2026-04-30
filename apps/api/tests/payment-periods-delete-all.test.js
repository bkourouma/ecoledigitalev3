// Test: delete all payment periods for a tenant, verify 0 remains
// Run with: node apps/api/tests/payment-periods-delete-all.test.js

const { run } = require('../scripts/delete-all-payment-periods');
const BASE_URL = 'http://localhost:4000/api/v1';
const TENANT = 'imhotepacademy';
const AUTH = 'Bearer dev-bypass-token';

async function req(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'X-Tenant': TENANT,
      'Authorization': AUTH,
    },
  });
  const data = await res.json();
  return { status: res.status, data };
}

(async () => {
  try {
    console.log('1) Purging all payment periods for tenant...');
    const result = await run(TENANT);
    console.log('   -> before:', result.before, 'after:', result.after);

    console.log('2) Verifying API list is empty...');
    const list = await req('/payment-periods?limit=1');
    console.log('   -> status:', list.status);
    if (list.status !== 200) {
      console.error('   ❌ Unexpected status from list:', list);
      process.exit(1);
    }
    const count = list.data?.pagination?.total ?? 0;
    console.log('   -> API reported total:', count);

    if (count !== 0) {
      console.error(`   ❌ Expected 0 periods, got ${count}`);
      process.exit(1);
    }

    console.log('\nAll checks passed ✅');
    process.exit(0);
  } catch (err) {
    console.error('Unhandled error:', err);
    process.exit(1);
  }
})();

