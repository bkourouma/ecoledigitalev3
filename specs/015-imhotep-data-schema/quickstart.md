# Quick Start: Imhotep Data Database Schema

**Date**: 2025-01-27  
**Feature**: 015-imhotep-data-schema

## Overview

This guide provides quick instructions for applying the Imhotep Data professional training database schema to your PostgreSQL database.

## Prerequisites

- PostgreSQL 14+ installed and running
- Database `dbecoledigitale` exists
- Existing migrations (0001-0036) have been applied
- Access to database with appropriate permissions

## Quick Start

### 1. Verify Existing Schema

Ensure all previous migrations are applied:

```bash
# Check existing tables
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -c "\dt"
```

You should see existing tables like `tenants`, `users`, `cycles`, `programmes`, `courses`, etc.

### 2. Apply Migration

Run the new migration:

```bash
# Apply Imhotep Data schema migration
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0037_imhotep_data_professional_training.sql
```

Or using the project's migration system:

```bash
pnpm migrate:imhotep-data
```

(Note: This script will need to be added to `package.json`)

### 3. Verify Migration

Check that new tables were created:

```bash
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -c "\dt *professionnel*"
```

Expected tables:
- `formations_professionnelles`
- `sessions_professionnelles`
- `formateurs`
- `session_formateurs`
- `entreprises_clientes`
- `inscriptions_professionnelles`
- `codes_promo`
- `paiements_professionnels`
- `supports_cours`

### 4. Verify RLS Policies

Check that RLS is enabled and policies exist:

```bash
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -c "
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE '%professionnel%';
"
```

All tables should show `rowsecurity = true`.

### 5. Test Tenant Isolation

Verify RLS policies work correctly:

```sql
-- Set tenant context
SET app.tenant_id = '<tenant-uuid>';

-- Try to query (should only return data for set tenant)
SELECT * FROM formations_professionnelles;

-- Try to insert (should succeed for correct tenant)
INSERT INTO formations_professionnelles (tenant_id, titre, slug, duree_jours, duree_heures, prix_ht, prix_ttc)
VALUES ('<tenant-uuid>', 'Test Formation', 'test-formation', 5, 35, 1000.00, 1200.00);

-- Try to query other tenant (should return empty)
SET app.tenant_id = '<other-tenant-uuid>';
SELECT * FROM formations_professionnelles; -- Should be empty
```

## Migration File Location

The migration file will be created at:
```
infra/scripts/migrations/0037_imhotep_data_professional_training.sql
```

## Rollback

If you need to rollback the migration:

```sql
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS supports_cours CASCADE;
DROP TABLE IF EXISTS paiements_professionnels CASCADE;
DROP TABLE IF EXISTS codes_promo CASCADE;
DROP TABLE IF EXISTS inscriptions_professionnelles CASCADE;
DROP TABLE IF EXISTS entreprises_clientes CASCADE;
DROP TABLE IF EXISTS session_formateurs CASCADE;
DROP TABLE IF EXISTS formateurs CASCADE;
DROP TABLE IF EXISTS sessions_professionnelles CASCADE;
DROP TABLE IF EXISTS formations_professionnelles CASCADE;

-- Drop ENUM types
DROP TYPE IF EXISTS session_professional_status CASCADE;
DROP TYPE IF EXISTS enrollment_type CASCADE;
DROP TYPE IF EXISTS enrollment_professional_status CASCADE;
DROP TYPE IF EXISTS promo_code_reduction_type CASCADE;
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS payment_professional_status CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS generate_enrollment_number(UUID) CASCADE;
DROP FUNCTION IF EXISTS generate_session_code(UUID, UUID) CASCADE;
```

## Next Steps

After applying the migration:

1. **Verify Data Isolation**: Test that RLS policies prevent cross-tenant data access
2. **Create Test Data**: Add sample professional training programs and sessions
3. **Test Relationships**: Verify foreign key constraints work correctly
4. **Test Generated Fields**: Verify enrollment numbers and session codes are auto-generated
5. **Performance Check**: Run queries to ensure indexes are being used

## Troubleshooting

### Error: "relation already exists"

The migration uses `CREATE TABLE IF NOT EXISTS`, so this shouldn't occur. If it does, check for partial migration and clean up manually.

### Error: "permission denied"

Ensure the database user has CREATE, ALTER, and DROP permissions.

### Error: "type already exists"

ENUM types use `CREATE TYPE IF NOT EXISTS` pattern. If error occurs, check for existing types and drop if needed.

### RLS Policies Not Working

Verify:
1. RLS is enabled: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
2. Policies exist: `SELECT * FROM pg_policies WHERE tablename = '<table>';`
3. Tenant context is set: `SHOW app.tenant_id;`

## Support

For detailed schema information, see:
- [data-model.md](./data-model.md) - Complete entity definitions
- [research.md](./research.md) - Technical decisions
- [plan.md](./plan.md) - Implementation plan

