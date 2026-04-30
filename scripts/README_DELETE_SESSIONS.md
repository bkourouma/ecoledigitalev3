# Delete All Sessions Script

**File**: `scripts/delete-all-sessions.ps1`  
**Purpose**: Safely delete all schedule-related sessions from the database  
**Date**: 2025-01-27

## Overview

This PowerShell script provides a safe and controlled way to delete all sessions in the schedule generation system. It supports different deletion modes and includes safety features like confirmation prompts and dry-run mode.

## Usage

### Basic Usage

```powershell
# Delete sessions only (keeps generation requests)
.\scripts\delete-all-sessions.ps1

# Use explicit database URL
.\scripts\delete-all-sessions.ps1 -DatabaseUrl "postgresql://postgres:password@localhost:5432/dbecoledigitale"
```

### Advanced Options

```powershell
# Delete ALL related data including generation requests
.\scripts\delete-all-sessions.ps1 -DeleteAll

# Dry-run mode (show what would be deleted without actually deleting)
.\scripts\delete-all-sessions.ps1 -WhatIf

# Combine options
.\scripts\delete-all-sessions.ps1 -DeleteAll -WhatIf
```

## What Gets Deleted

### Default Mode (without -DeleteAll)

Deletes sessions but keeps generation requests:
- ✅ `session_instances` - All individual calendar dates
- ✅ `scheduled_sessions` - All weekly recurring templates

Keeps:
- ❌ `approved_schedules`
- ❌ `generated_schedules`
- ❌ `schedule_generation_requests`

### Delete All Mode (-DeleteAll)

Deletes everything in the schedule system:
- ✅ `student_attendance` - All attendance records
- ✅ `attendance_sessions` - All attendance sessions
- ✅ `session_instances` - All individual calendar dates
- ✅ `scheduled_sessions` - All weekly recurring templates
- ✅ `approved_schedules` - All approved schedules
- ✅ `generated_schedules` - All generated schedules
- ✅ `schedule_generation_requests` - All generation requests

## Safety Features

### 1. Confirmation Prompt
The script asks for confirmation before deleting (except in -WhatIf mode):
```
Are you sure you want to continue? (yes/no):
```

### 2. What-If Mode
Preview what would be deleted without actually deleting:
```powershell
.\scripts\delete-all-sessions.ps1 -WhatIf
```

### 3. Database Connection Validation
The script validates the database connection and shows connection details before proceeding.

### 4. State Reporting
Before and after deletion, the script reports counts from all affected tables:
```
CURRENT STATE:
  session_instances: 1250
  scheduled_sessions: 50
  approved_schedules: 3
  ...

FINAL STATE:
  session_instances: 0
  scheduled_sessions: 0
  ...
```

### 5. Error Handling
- Validates database URL format
- Checks for psql availability
- Reports SQL errors clearly
- Cleans up temporary files

## Environment Variables

You can set `DATABASE_URL` environment variable instead of using `-DatabaseUrl`:

```powershell
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/dbecoledigitale"
.\scripts\delete-all-sessions.ps1
```

## Examples

### Example 1: Preview deletion
```powershell
PS> .\scripts\delete-all-sessions.ps1 -DatabaseUrl "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -WhatIf

============================================
DELETE ALL SCHEDULE-RELATED SESSIONS
============================================

Database: dbecoledigitale
Host: localhost
User: postgres

WHAT-IF MODE: No data will actually be deleted

WARNING: This will delete all schedule-related data!

Mode: DELETE SESSIONS ONLY (keep generation requests)
```

### Example 2: Delete sessions only
```powershell
PS> .\scripts\delete-all-sessions.ps1
Are you sure you want to continue? (yes/no): yes

Executing deletion...

NOTICE:  CURRENT STATE:
NOTICE:    session_instances: 1250
NOTICE:    scheduled_sessions: 50
...

NOTICE:  DELETE COMPLETED

✓ DELETION COMPLETED SUCCESSFULLY
```

### Example 3: Delete everything
```powershell
PS> .\scripts\delete-all-sessions.ps1 -DeleteAll -DatabaseUrl "postgresql://postgres:password@localhost:5432/dbecoledigitale"
Mode: DELETE ALL (including generation requests)
Are you sure you want to continue? (yes/no): yes
...
```

## Error Handling

Common errors and solutions:

### Error: "No database connection string provided"
**Solution**: Provide `-DatabaseUrl` or set `DATABASE_URL` environment variable

### Error: "Invalid database URL format"
**Solution**: Use format: `postgresql://user:password@host:port/database`

### Error: "psql not found"
**Solution**: Install PostgreSQL client tools or add to PATH

### Error: "ERREUR: relation does not exist"
**Solution**: One or more tables don't exist yet. This is OK if database is fresh.

## Database Requirements

### Prerequisites
- PostgreSQL 12+ database
- Tables: `scheduled_sessions`, `session_instances`, etc.
- Proper foreign key constraints with CASCADE deletes

### Cascade Behavior
When deleting `scheduled_sessions`, all related `session_instances` are automatically deleted via foreign key cascade.

## Comparison with SQL Script

The original SQL script (`scripts/delete-all-session-instances.sql`) provides similar functionality:

| Feature | PowerShell Script | SQL Script |
|---------|-------------------|------------|
| Interactive | ✅ Yes | ❌ No |
| Confirmation | ✅ Prompt | ⚠️ Manual |
| What-If Mode | ✅ Yes | ❌ No |
| Status Reporting | ✅ Before/After | ✅ Before/After |
| Error Handling | ✅ Advanced | ⚠️ Basic |
| Configuration | ✅ Flexible | ⚠️ Edit file |
| Environment Vars | ✅ Supported | ❌ No |

## Related Scripts

- `scripts/delete-all-session-instances.sql` - SQL-only version
- `infra/scripts/migrations/0025_schedule_consolidation.sql` - Schema definition

## Support

For issues or questions, check:
- `SCHEDULE_CONSOLIDATION_SUMMARY.md` - Schema documentation
- Database migration files in `infra/scripts/migrations/`

## Security Notes

⚠️ **WARNING**: This script deletes data permanently!

**Recommendations**:
1. Always backup your database before running
2. Use `-WhatIf` first to preview deletions
3. Consider the `-DeleteAll` flag carefully
4. Test on development/staging before production

## License

Part of EcoleDigitale Platform

