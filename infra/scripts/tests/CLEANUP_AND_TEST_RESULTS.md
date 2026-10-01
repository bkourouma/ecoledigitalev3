# Schedule Generation - Cleanup & Test Results ✅

## Execution Summary

**Status**: ✅ **SUCCESS**

The cleanup and test script has been successfully executed. All schedule data has been removed from the database and two test schedules have been created.

---

## What Was Done

### 1. ✅ Cleanup
All schedule-related data was deleted from the database:
- **scheduled_sessions**: Deleted
- **generated_schedules**: Deleted
- **schedule_generation_requests**: Deleted
- **time_slots**: Deleted

### 2. ✅ Time Slots Created
**15 time slots** were created for Monday-Friday:

| Day | Time Slots | Priority |
|-----|-----------|----------|
| Monday | 8:00-10:00, 10:00-12:00, 14:00-16:00 | 3, 3, 2 |
| Tuesday | 8:00-10:00, 10:00-12:00, 14:00-16:00 | 3, 3, 2 |
| Wednesday | 8:00-10:00, 10:00-12:00, 14:00-16:00 | 3, 3, 2 |
| Thursday | 8:00-10:00, 10:00-12:00, 14:00-16:00 | 3, 3, 2 |
| Friday | 8:00-10:00, 10:00-12:00, 14:00-16:00 | 3, 3, 2 |

### 3. ✅ Test Schedules Created

#### Test 1: Single Course Schedule
```
Course: Programmation Web avec PHP
Required Hours: 20 hours
Session Duration: 2 hours (120 minutes)
Sessions Needed: 10 sessions
Optimization Score: 85.5%
Status: APPROVED
Generation Request ID: 1725955f-734d-44f1-87f5-6c8e9786b98b
Generated Schedule ID: a0a8a839-11f8-4e7a-b9ff-8d4b3071180d
```

#### Test 2: Two Courses Schedule
```
Courses:
  1. Base de Données Relationnelles: 15 hours
  2. React Avancé et Architecture Front-end: 18 hours

Total Hours: 33 hours
Session Duration: 2 hours (120 minutes)
Sessions Needed: 17 sessions (8 for course 1 + 9 for course 2)
Optimization Score: 85.5%
Status: APPROVED
Generation Request ID: 0595c075-1c59-48fe-be3e-5bfcba05a61b
Generated Schedule ID: 67f87e35-b092-4fbb-bee5-8a4dd56fc322
```

---

## Test Data Details

### Tenant & Class
- **Tenant**: imhotepacademy (`6eb9c106-b650-4398-b6fa-091b6828c4ba`)
- **Class**: BTS-IDA-01 (`5038f1db-e2d1-4d03-b7dd-dc2e2871f921`)
- **User**: Test user (`550e8400-e29b-41d4-a716-446655440000`)

### Courses Used
1. **Programmation Web avec PHP** (`8ec86808-ae06-415f-abde-fb02ad339b22`)
2. **Base de Données Relationnelles** (`91119333-8e2b-42ca-a6a9-4c98c7f78a97`)
3. **React Avancé et Architecture Front-end** (`cf64c7b0-c0ff-4aec-83bc-de2f3bc3ed550`)

---

## Database Verification

### Row Counts
```sql
-- Time Slots
SELECT COUNT(*) FROM time_slots 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Result: 15

-- Generation Requests
SELECT COUNT(*) FROM schedule_generation_requests 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Result: 2

-- Generated Schedules
SELECT COUNT(*) FROM generated_schedules 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Result: 2
```

### Query to View Test Data
```sql
SELECT 
  sgr.id as request_id,
  sgr.selected_courses,
  gs.optimization_score,
  gs.is_approved,
  gs.created_at
FROM schedule_generation_requests sgr
LEFT JOIN generated_schedules gs ON sgr.id = gs.generation_request_id
WHERE sgr.tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba'
ORDER BY sgr.created_at DESC;
```

---

## How to Use the Test Data

### 1. View in Web UI
Navigate to: `http://localhost:3000/schedule-generation`

The test schedules should be visible in the schedule generation interface.

### 2. Test the API
Use the HTTP client at: `infra/scripts/tests/schedule-generation-api-tests.http`

Example requests:
```http
GET /api/v1/schedule-generation/1725955f-734d-44f1-87f5-6c8e9786b98b/result
GET /api/v1/schedule-generation/0595c075-1c59-48fe-be3e-5bfcba05a61b/result
```

### 3. Modify or Approve
- View the generated schedules
- Approve or reject them
- Modify the schedules as needed

---

## Scripts Available

### 1. JavaScript Script (Recommended)
**File**: `infra/scripts/tests/cleanup-and-test.js`

**Usage**:
```bash
cd apps/api
node ../../infra/scripts/tests/cleanup-and-test.js
```

**Advantages**:
- ✅ Automatic course ID detection
- ✅ Better error handling
- ✅ Detailed logging
- ✅ No password prompt

### 2. SQL Script
**File**: `infra/scripts/tests/schedule-generation-cleanup-and-test.sql`

**Usage**:
```bash
psql -U postgres -d dbecoledigitale -f infra/scripts/tests/schedule-generation-cleanup-and-test.sql
```

**Note**: Requires manual course ID updates

### 3. TypeScript Script
**File**: `infra/scripts/tests/schedule-generation-cleanup-and-test.ts`

**Usage**:
```bash
cd apps/api
npx ts-node ../../infra/scripts/tests/schedule-generation-cleanup-and-test.ts
```

---

## Cleanup Only

To delete all schedule data without creating new test data:

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

## Next Steps

1. **Test the UI**: Visit `http://localhost:3000/schedule-generation`
2. **Review the schedules**: Check the generated schedules
3. **Test the API**: Use the HTTP client to test endpoints
4. **Modify as needed**: Update the script for different test scenarios

---

## Troubleshooting

### Issue: "Class not found"
**Solution**: Update the `CLASS_ID` in the script to match your database

### Issue: "Course not found"
**Solution**: The script automatically fetches the first 3 courses from the database

### Issue: "Connection refused"
**Solution**: Ensure PostgreSQL is running and the `DATABASE_URL` is correct

### Issue: "Permission denied"
**Solution**: Check that the database user has proper permissions

---

## Files Created

1. ✅ `infra/scripts/tests/cleanup-and-test.js` - Main cleanup & test script
2. ✅ `infra/scripts/tests/schedule-generation-cleanup-and-test.ts` - TypeScript version
3. ✅ `infra/scripts/tests/schedule-generation-cleanup-and-test.sql` - SQL version
4. ✅ `infra/scripts/tests/SCHEDULE_GENERATION_TEST_README.md` - Detailed documentation
5. ✅ `infra/scripts/tests/CLEANUP_AND_TEST_RESULTS.md` - This file

---

## Summary

✅ **All schedules cleaned up**
✅ **15 time slots created**
✅ **Test 1 created**: Single course (20 hours)
✅ **Test 2 created**: Two courses (33 hours total)
✅ **Both schedules approved**
✅ **Ready for testing**

The system is now ready for testing the schedule generation feature!

