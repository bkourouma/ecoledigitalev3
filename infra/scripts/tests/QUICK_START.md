# Schedule Generation - Quick Start Guide

## 🚀 Quick Commands

### Run the Cleanup & Test Script
```bash
cd apps/api
node ../../infra/scripts/tests/cleanup-and-test.js
```

**What it does**:
- ✅ Deletes all existing schedules
- ✅ Creates 15 time slots (Mon-Fri, 8:00-16:00)
- ✅ Creates test schedule with 1 course (20 hours)
- ✅ Creates test schedule with 2 courses (33 hours)

**Expected output**:
```
✅ Deleted scheduled_sessions
✅ Deleted generated_schedules
✅ Deleted schedule_generation_requests
✅ Deleted time_slots
✨ Created 15 time slots
✅ Created generation request: [UUID]
✅ Created generated schedule: [UUID]
✅ Script completed successfully!
```

---

## 📊 Test Data Created

### Test 1: Single Course
- **Course**: Programmation Web avec PHP
- **Hours**: 20 hours
- **Sessions**: 10 (2 hours each)
- **Score**: 85.5%
- **Status**: APPROVED

### Test 2: Two Courses
- **Course 1**: Base de Données Relationnelles (15 hours)
- **Course 2**: React Avancé et Architecture Front-end (18 hours)
- **Total Hours**: 33 hours
- **Sessions**: 17 total
- **Score**: 85.5%
- **Status**: APPROVED

---

## 🌐 View in Web UI

1. Open: `http://localhost:3000/schedule-generation`
2. You should see the test schedules listed
3. Click on a schedule to view details
4. Approve or modify as needed

---

## 🧪 Test the API

### Get Schedule Details
```bash
curl -X GET "http://localhost:3000/api/v1/schedule-generation/1725955f-734d-44f1-87f5-6c8e9786b98b/result" \
  -H "X-Tenant: 6eb9c106-b650-4398-b6fa-091b6828c4ba" \
  -H "X-User-Id: 550e8400-e29b-41d4-a716-446655440000"
```

### List Time Slots
```bash
curl -X GET "http://localhost:3000/api/v1/schedule-generation/time-slots" \
  -H "X-Tenant: 6eb9c106-b650-4398-b6fa-091b6828c4ba"
```

---

## 🗑️ Cleanup Only

To delete all schedules without creating new ones:

```bash
cd apps/api
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:<mot-de-passe>@localhost:5432/dbecoledigitale' });
(async () => {
  const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
  await pool.query('DELETE FROM scheduled_sessions WHERE tenant_id = \$1', [TENANT_ID]);
  await pool.query('DELETE FROM generated_schedules WHERE tenant_id = \$1', [TENANT_ID]);
  await pool.query('DELETE FROM schedule_generation_requests WHERE tenant_id = \$1', [TENANT_ID]);
  await pool.query('DELETE FROM time_slots WHERE tenant_id = \$1', [TENANT_ID]);
  console.log('✅ Cleanup complete');
  await pool.end();
})();
"
```

---

## 📋 Database Verification

### Check if data was created
```sql
-- Connect to database
psql -U postgres -d dbecoledigitale

-- Check time slots
SELECT COUNT(*) FROM time_slots 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Expected: 15

-- Check schedules
SELECT COUNT(*) FROM generated_schedules 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Expected: 2

-- View details
SELECT 
  sgr.id as request_id,
  jsonb_array_length(sgr.selected_courses) as course_count,
  gs.optimization_score,
  gs.is_approved
FROM schedule_generation_requests sgr
LEFT JOIN generated_schedules gs ON sgr.id = gs.generation_request_id
WHERE sgr.tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
```

---

## 🔧 Troubleshooting

### Script fails with "Connection refused"
```bash
# Check if PostgreSQL is running
psql -U postgres -c "SELECT 1"

# If not running, start it (Windows)
pg_ctl -D "C:\Program Files\PostgreSQL\15\data" start
```

### Script fails with "Database does not exist"
```bash
# Create the database
createdb -U postgres dbecoledigitale
```

### Script fails with "Permission denied"
```bash
# Check database user permissions
psql -U postgres -d dbecoledigitale -c "SELECT current_user;"
```

---

## 📁 Related Files

- **Main Script**: `infra/scripts/tests/cleanup-and-test.js`
- **SQL Version**: `infra/scripts/tests/schedule-generation-cleanup-and-test.sql`
- **TypeScript Version**: `infra/scripts/tests/schedule-generation-cleanup-and-test.ts`
- **Full Documentation**: `infra/scripts/tests/SCHEDULE_GENERATION_TEST_README.md`
- **Results**: `infra/scripts/tests/CLEANUP_AND_TEST_RESULTS.md`

---

## 📞 Support

For issues or questions:
1. Check the full documentation: `SCHEDULE_GENERATION_TEST_README.md`
2. Review the results: `CLEANUP_AND_TEST_RESULTS.md`
3. Check the database directly using the SQL queries above

---

## ✅ Checklist

- [ ] Run the cleanup & test script
- [ ] Verify data in database
- [ ] View schedules in web UI
- [ ] Test API endpoints
- [ ] Approve/modify schedules
- [ ] Test schedule generation feature

**You're all set! 🎉**

