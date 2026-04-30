# Schedule Generation - Cleanup & Test Scripts

This directory contains scripts to clean up all schedule data from the database and create test schedules.

## Overview

The scripts will:
1. **Delete all schedule-related data** from the database (for the test tenant)
2. **Create time slots** (Monday-Friday, 8:00-16:00)
3. **Create two test schedules**:
   - **Test 1**: One course (Math - 20 hours)
   - **Test 2**: Two courses (English 15h + French 18h)

## Test Data

### Tenant & Class
- **Tenant ID**: `6eb9c106-b650-4398-b6fa-091b6828c4ba` (imhotepacademy)
- **Class ID**: `A50e8400-e29b-41d4-a716-446655440001` (IDA 1A)
- **User ID**: `550e8400-e29b-41d4-a716-446655440000` (Test user)

### Courses
- **Math**: `850e8400-e29b-41d4-a716-446655440001`
- **English**: `850e8400-e29b-41d4-a716-446655440002`
- **French**: `850e8400-e29b-41d4-a716-446655440003`

### Time Slots Created
- **Monday-Friday**: 3 slots per day
  - 8:00-10:00 (Priority 3 - High)
  - 10:00-12:00 (Priority 3 - High)
  - 14:00-16:00 (Priority 2 - Medium)
- **Total**: 15 time slots

## Usage

### Option 1: Using SQL Script (Recommended for Quick Testing)

Execute the SQL script directly in your database:

```bash
# Using psql
psql -U postgres -d ecoledigitale -f infra/scripts/tests/schedule-generation-cleanup-and-test.sql

# Or using your database client
# Copy and paste the contents of schedule-generation-cleanup-and-test.sql
```

**Advantages**:
- ✅ Fast execution
- ✅ No dependencies
- ✅ Direct database access

### Option 2: Using TypeScript Script

Run the TypeScript script:

```bash
# From the project root
cd apps/api

# Install dependencies (if needed)
npm install

# Run the script
npx ts-node ../../infra/scripts/tests/schedule-generation-cleanup-and-test.ts
```

**Requirements**:
- Node.js and npm installed
- `DATABASE_URL` environment variable set
- `.env` file configured

## What Gets Created

### Test Schedule 1: Single Course
```
Course: Math
Required Hours: 20 hours
Session Duration: 2 hours (120 minutes)
Sessions Needed: 10 sessions
Optimization Score: 85.5%
Status: APPROVED
```

### Test Schedule 2: Two Courses
```
Courses:
  - English: 15 hours
  - French: 18 hours
Total Hours: 33 hours
Session Duration: 2 hours (120 minutes)
Sessions Needed: 17 sessions (8 for English + 9 for French)
Optimization Score: 82.0%
Status: APPROVED
```

## Verification

After running the script, verify the data was created:

```sql
-- Check time slots
SELECT COUNT(*) FROM time_slots 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Expected: 15

-- Check generation requests
SELECT COUNT(*) FROM schedule_generation_requests 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Expected: 2

-- Check generated schedules
SELECT COUNT(*) FROM generated_schedules 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
-- Expected: 2

-- View details
SELECT 
  sgr.id as request_id,
  sgr.selected_courses,
  gs.optimization_score,
  gs.is_approved
FROM schedule_generation_requests sgr
LEFT JOIN generated_schedules gs ON sgr.id = gs.generation_request_id
WHERE sgr.tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba'
ORDER BY sgr.created_at;
```

## Cleanup Only

If you only want to delete schedule data without creating new test data:

```sql
DELETE FROM scheduled_sessions 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';

DELETE FROM generated_schedules 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';

DELETE FROM schedule_generation_requests 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';

DELETE FROM time_slots 
WHERE tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
```

## Troubleshooting

### Script fails with "table does not exist"
- Ensure migrations have been run: `npm run migrate`
- Check that the database is properly initialized

### No data appears after running
- Verify the tenant ID is correct
- Check that the database connection is working
- Ensure the script completed without errors

### Foreign key constraint errors
- Make sure the class, courses, and users exist in the database
- Verify the IDs match your database setup

## Next Steps

After creating test data, you can:

1. **View the schedules** in the UI at `http://localhost:3000/schedule-generation`
2. **Test the API** using the HTTP client in `infra/scripts/tests/schedule-generation-api-tests.http`
3. **Modify the schedules** through the web interface
4. **Approve/reject** the generated schedules

## Notes

- The scripts use hardcoded IDs for the test tenant (imhotepacademy)
- Modify the IDs if you want to test with a different tenant
- The generated schedules are marked as `APPROVED` by default
- Time slots are set to `is_active = true`
- All data is created with the current timestamp

