// Test: create a payment period then delete it and verify deletion
// Run with: node apps/api/tests/payment-periods-delete.test.js

const BASE_URL = 'http://localhost:4000/api/v1';
const TENANT = 'imhotepacademy';
const AUTH = 'Bearer dev-bypass-token';

async function req(method, path, body) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT,
    'Authorization': AUTH,
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let dataText = '';
  try {
    dataText = await res.text();
  } catch {}
  let data;
  try {
    data = dataText ? JSON.parse(dataText) : null;
  } catch (e) {
    data = { raw: dataText };
  }
  return { status: res.status, data };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

(async () => {
  try {
    console.log('1) Creating payment period...');
    // Use a far-future range to avoid overlapping with existing periods
    const start = new Date(Date.now() + 4000 * 24 * 60 * 60 * 1000); // ~11 years ahead
    const end = new Date(start.getTime() + 10 * 24 * 60 * 60 * 1000);
    const createBody = {
      name: `TEST-PERIOD-${Date.now()}`,
      description: 'Test period for delete validation',
      periodStart: isoDate(start),
      periodEnd: isoDate(end),
    };

    const createRes = await req('POST', '/payment-periods', createBody);
    console.log('   -> status:', createRes.status);
    if (createRes.status !== 201 || !createRes.data?.data?.id) {
      console.error('   ❌ Failed to create period:', createRes);
      process.exit(1);
    }
    const periodId = createRes.data.data.id;
    console.log('   ✅ Created period id:', periodId);

    console.log('2) Deleting payment period...');
    const deleteRes = await req('DELETE', `/payment-periods/${periodId}`);
    console.log('   -> status:', deleteRes.status);
    if (deleteRes.status !== 204) {
      console.error('   ❌ Failed to delete period:', deleteRes);
      process.exit(1);
    }
    console.log('   ✅ Deleted successfully (204)');

    console.log('3) Verifying it no longer exists (GET should be 404)...');
    const getRes = await req('GET', `/payment-periods/${periodId}`);
    console.log('   -> status:', getRes.status);
    if (getRes.status !== 404) {
      console.error('   ❌ Expected 404 after deletion, got:', getRes);
      process.exit(1);
    }
    console.log('   ✅ Verified 404 after deletion');

    console.log('\nAll checks passed ✅');
    process.exit(0);
  } catch (err) {
    console.error('Unhandled error:', err);
    process.exit(1);
  }
})();

