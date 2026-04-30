# Security Review - Phase 5

**Date**: 2025-01-27  
**Feature**: Phase 5 - Recherche Avancée et Gestion des Recommandations

## Authentication ✅

### Middleware
- **RSO Auth Middleware** (`apps/api/src/plugins/rso-auth-middleware.ts`):
  - Applied to all routes starting with `/api/v1/rso`
  - Validates JWT tokens via `verifyRSOToken`
  - Loads user from `rso_users` table
  - Verifies user is active (`statut = 'actif'`)
  - Returns 401 if token is missing or invalid

### Route Protection
- **All Phase 5 routes** use `RSOModuleRequest` interface which requires authentication
- Routes verified:
  - ✅ Search routes (`/api/v1/rso/search/*`)
  - ✅ Tag routes (`/api/v1/rso/tags/*`, `/api/v1/rso/admin/tags/*`)
  - ✅ Notification routes (`/api/v1/rso/notifications/*`)
  - ✅ Saved search routes (`/api/v1/rso/recherches-enregistrees/*`)
  - ✅ Scheduled report routes (`/api/v1/rso/rapports-planifies/*`)
  - ✅ Dashboard routes (`/api/v1/rso/recommandations/dashboard/*`)
  - ✅ Recommendation history route (`/api/v1/rso/formateur/recommandations/:id/historique`)

## Authorization ✅

### Permission Checks
- **All routes** use `checkPermission(user.role, module, action)` before processing requests
- Permission checks verified in:
  - ✅ Search routes: `gestion_activites:read`
  - ✅ Tag routes: `gestion_tags:read/create/update/delete` (admin only)
  - ✅ Notification routes: User ownership verification
  - ✅ Saved search routes: User ownership verification
  - ✅ Scheduled report routes: User ownership verification
  - ✅ Dashboard routes: `gestion_activites:read`
  - ✅ Recommendation routes: `gestion_activites:read/create/update/delete`

### User Ownership Verification
- **Notifications**: Users can only access their own notifications (filtered by `user_id`)
- **Saved Searches**: Users can only access their own saved searches (filtered by `user_id`)
- **Scheduled Reports**: Users can only access their own reports (filtered by `user_id`)

## Row Level Security (RLS) ✅

### RLS Policies Created
All new tables have RLS enabled and policies defined in migration `0025_rso_phase5_search_recommendations.sql`:

1. **rso_tags**:
   - Policy: Tags are shared within tenant (ASPCI tenant only)
   - Enforced via application logic with `app.tenant_id` setting

2. **rso_activites_tags**:
   - Policy: Isolated by activity's tenant
   - Uses join with `rso_activites` and `rso_installations` to verify tenant

3. **rso_recherches_enregistrees**:
   - Policy: Isolated by user's tenant
   - Users can only see their own saved searches within tenant

4. **rso_notifications**:
   - Policy: Isolated by user's tenant
   - Users can only see their own notifications within tenant

5. **rso_rapports_planifies**:
   - Policy: Isolated by user's tenant
   - Users can only see their own scheduled reports within tenant

6. **rso_recommandations_historique**:
   - Policy: Isolated by recommendation's tenant
   - Uses join with `rso_recommandations`, `rso_activites`, and `rso_installations` to verify tenant

### Tenant Context Setting
- All service methods set tenant context: `SELECT set_config('app.tenant_id', $1, true)`
- This ensures RLS policies can filter by tenant correctly

## Input Validation ✅

### Zod Schemas
All Phase 5 endpoints use Zod schemas for validation:

- ✅ **Search**: `SearchQuerySchema`, `SearchAutocompleteQuerySchema`
- ✅ **Tags**: `CreateTagSchema`, `UpdateTagSchema`, `ActivityTagsSchema`
- ✅ **Notifications**: `NotificationListQuerySchema`, `MarkNotificationReadSchema`
- ✅ **Saved Searches**: `CreateSavedSearchSchema`, `UpdateSavedSearchSchema`, `SavedSearchListQuerySchema`
- ✅ **Scheduled Reports**: `CreateScheduledReportSchema`, `UpdateScheduledReportSchema`, `ScheduledReportListQuerySchema`
- ✅ **Recommendations**: `CreateRecommendationSchema`, `UpdateRecommendationSchema`, `UpdateRecommendationStatusSchema`, `RecommendationListQuerySchema`

### Query Sanitization
- **Search queries**: Sanitized in `sanitizeSearchQuery()` function
- **SQL injection prevention**: All queries use parameterized statements ($1, $2, etc.)
- **Full-text search**: Special characters escaped before creating `tsquery`

## Rate Limiting ✅

### Notification Creation
- **Rate limit**: 10 notifications per minute per user
- **Implementation**: In-memory Map with sliding window
- **Error handling**: Returns user-friendly error message when limit exceeded

## Security Best Practices ✅

1. **No hardcoded credentials**: All credentials from environment variables
2. **Error messages**: Generic error messages to avoid information leakage
3. **Logging**: Sensitive data not logged (passwords, tokens)
4. **CORS**: Configured appropriately for production
5. **HTTPS**: Required in production (handled by reverse proxy)
6. **Input sanitization**: All user inputs validated and sanitized
7. **SQL injection prevention**: Parameterized queries only
8. **XSS prevention**: Output encoding in frontend components

## Summary

**Status**: ✅ **PASS**

All security requirements are met:
- ✅ Authentication required for all Phase 5 endpoints
- ✅ Authorization checks in place with permission system
- ✅ RLS policies enforced for all new tables
- ✅ Input validation with Zod schemas
- ✅ Query sanitization and SQL injection prevention
- ✅ Rate limiting for notification creation
- ✅ User ownership verification for user-specific resources

## Recommendations

1. **Consider adding** request rate limiting at API level (e.g., using `@fastify/rate-limit`)
2. **Monitor** notification creation patterns to adjust rate limits if needed
3. **Audit logs**: Consider adding audit logging for sensitive operations (tag deletion, report execution)
4. **Session management**: Ensure JWT tokens have appropriate expiration times
5. **Regular security audits**: Schedule periodic security reviews

