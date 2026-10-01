# Schedule Generation - Test Scripts & Documentation

## 📑 Documentation Index

### 🚀 Getting Started
- **[QUICK_START.md](./QUICK_START.md)** - Quick commands and reference
- **[EXECUTION_SUMMARY.md](./EXECUTION_SUMMARY.md)** - What was executed and results

### 📖 Full Documentation
- **[SCHEDULE_GENERATION_TEST_README.md](./SCHEDULE_GENERATION_TEST_README.md)** - Complete guide
- **[CLEANUP_AND_TEST_RESULTS.md](./CLEANUP_AND_TEST_RESULTS.md)** - Detailed results

---

## 🛠️ Available Scripts

### 1. JavaScript Script (Recommended) ⭐
**File**: `cleanup-and-test.js`

```bash
cd apps/api
node ../../infra/scripts/tests/cleanup-and-test.js
```

**Features**:
- ✅ Automatic course ID detection
- ✅ Comprehensive error handling
- ✅ Detailed logging
- ✅ No password prompts
- ✅ **Status**: ✅ TESTED & WORKING

### 2. TypeScript Script
**File**: `schedule-generation-cleanup-and-test.ts`

```bash
cd apps/api
npx ts-node ../../infra/scripts/tests/schedule-generation-cleanup-and-test.ts
```

### 3. SQL Script
**File**: `schedule-generation-cleanup-and-test.sql`

```bash
psql -U postgres -d dbecoledigitale -f infra/scripts/tests/schedule-generation-cleanup-and-test.sql
```

---

## 📊 What Gets Created

### Time Slots
- **15 total**: Monday-Friday, 3 slots per day
- **Hours**: 8:00-10:00, 10:00-12:00, 14:00-16:00
- **Priority**: High (3) for morning, Medium (2) for afternoon

### Test Schedule 1: Single Course
```
Course: Programmation Web avec PHP
Hours: 20 hours
Sessions: 10 (2 hours each)
Score: 85.5%
Status: APPROVED ✅
```

### Test Schedule 2: Two Courses
```
Course 1: Base de Données Relationnelles (15 hours)
Course 2: React Avancé et Architecture Front-end (18 hours)
Total: 33 hours
Sessions: 17 total
Score: 85.5%
Status: APPROVED ✅
```

---

## 🎯 Quick Commands

### Run the Script
```bash
cd apps/api
node ../../infra/scripts/tests/cleanup-and-test.js
```

### View in Web UI
```
http://localhost:3000/schedule-generation
```

### Test API
```bash
# Get schedule details
curl -X GET "http://localhost:3000/api/v1/schedule-generation/1725955f-734d-44f1-87f5-6c8e9786b98b/result" \
  -H "X-Tenant: 6eb9c106-b650-4398-b6fa-091b6828c4ba"
```

### Verify in Database
```bash
psql -U postgres -d dbecoledigitale -c "
SELECT COUNT(*) as time_slots FROM time_slots 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
"
```

---

## 📋 Test Data IDs

### Tenant & Class
- **Tenant**: imhotepacademy (`6eb9c106-b650-4398-b6fa-091b6828c4ba`)
- **Class**: BTS-IDA-01 (`5038f1db-e2d1-4d03-b7dd-dc2e2871f921`)

### Test Schedule 1
- **Request ID**: `1725955f-734d-44f1-87f5-6c8e9786b98b`
- **Schedule ID**: `a0a8a839-11f8-4e7a-b9ff-8d4b3071180d`

### Test Schedule 2
- **Request ID**: `0595c075-1c59-48fe-be3e-5bfcba05a61b`
- **Schedule ID**: `67f87e35-b092-4fbb-bee5-8a4dd56fc322`

---

## 🔄 Cleanup Only

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

## 🧪 Testing Workflow

1. **Run the script**
   ```bash
   node ../../infra/scripts/tests/cleanup-and-test.js
   ```

2. **Verify in database**
   ```bash
   psql -U postgres -d dbecoledigitale -c "SELECT COUNT(*) FROM time_slots WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';"
   ```

3. **View in Web UI**
   - Navigate to: `http://localhost:3000/schedule-generation`
   - You should see 2 test schedules

4. **Test API endpoints**
   - Use the curl commands above
   - Or use the HTTP client in `schedule-generation-api-tests.http`

5. **Approve/Modify schedules**
   - Click on a schedule to view details
   - Approve or modify as needed

---

## 📚 File Structure

```
infra/scripts/tests/
├── cleanup-and-test.js                              ⭐ Main script
├── schedule-generation-cleanup-and-test.ts          TypeScript version
├── schedule-generation-cleanup-and-test.sql         SQL version
├── schedule-generation-api-tests.http               API test file
├── README_SCHEDULE_GENERATION.md                    This file
├── QUICK_START.md                                   Quick reference
├── EXECUTION_SUMMARY.md                             Execution results
├── SCHEDULE_GENERATION_TEST_README.md               Full documentation
└── CLEANUP_AND_TEST_RESULTS.md                      Detailed results
```

---

## ✅ Checklist

- [x] Scripts created
- [x] Scripts tested
- [x] Test data created
- [x] Documentation written
- [x] Ready for testing

---

## 🆘 Troubleshooting

### Issue: "Connection refused"
**Solution**: Ensure PostgreSQL is running
```bash
# Check if running
psql -U postgres -c "SELECT 1"
```

### Issue: "Database does not exist"
**Solution**: Create the database
```bash
createdb -U postgres dbecoledigitale
```

### Issue: "Permission denied"
**Solution**: Check user permissions
```bash
psql -U postgres -d dbecoledigitale -c "SELECT current_user;"
```

---

## 📞 Support

For detailed information:
1. Read: `QUICK_START.md` for quick commands
2. Read: `SCHEDULE_GENERATION_TEST_README.md` for full documentation
3. Check: `CLEANUP_AND_TEST_RESULTS.md` for execution details
4. Review: `EXECUTION_SUMMARY.md` for what was created

---

## 🎉 You're All Set!

The schedule generation system is ready for testing:
- ✅ Database cleaned
- ✅ Test data created
- ✅ Schedules approved
- ✅ Documentation complete

**Start testing**: `http://localhost:3000/schedule-generation`

---

**Last Updated**: 2024-10-17
**Status**: ✅ READY FOR TESTING

