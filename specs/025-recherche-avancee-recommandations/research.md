# Research: Phase 5 - Recherche Avancée et Gestion des Recommandations

**Date**: 2025-01-27  
**Feature**: Phase 5 - Recherche Avancée et Gestion des Recommandations  
**Branch**: `025-phase`

## Research Tasks

### 1. Search Engine Technology Choice

**Question**: Should we use Elasticsearch for enhanced search performance, or is PostgreSQL full-text search sufficient?

**Research Findings**:

**Option A: PostgreSQL Full-Text Search Only**
- **Pros**:
  - No additional infrastructure required (uses existing PostgreSQL)
  - Simpler deployment and maintenance
  - No additional service to monitor
  - Lower resource consumption
  - Sufficient for moderate search volumes (< 10,000 activities)
  - Native integration with existing database
  - Supports French language with proper configuration
- **Cons**:
  - Less flexible than Elasticsearch for complex queries
  - Performance may degrade with very large datasets (> 50,000 activities)
  - Limited advanced features (fuzzy matching, faceting, etc.)
  - Requires careful index management

**Option B: Elasticsearch Integration**
- **Pros**:
  - Superior performance for large datasets
  - Advanced features (fuzzy matching, faceting, aggregations)
  - Better relevance scoring
  - Horizontal scalability
  - Real-time indexing capabilities
- **Cons**:
  - Additional infrastructure and maintenance overhead
  - Requires data synchronization between PostgreSQL and Elasticsearch
  - Additional service to monitor and maintain
  - Higher resource consumption
  - More complex deployment
  - Potential data consistency issues if sync fails

**Decision**: **PostgreSQL Full-Text Search Only**

**Rationale**: 
- Current scale (hundreds to low thousands of activities) does not require Elasticsearch
- Simpler architecture aligns with project principles (simplicity, production-ready)
- PostgreSQL full-text search with proper indexes can handle the expected load
- Can migrate to Elasticsearch later if scale requires it
- Reduces operational complexity and infrastructure costs
- French language support is available in PostgreSQL with proper configuration

**Alternatives Considered**: Elasticsearch integration (rejected due to complexity and current scale), Algolia (rejected due to cost and external dependency), Meilisearch (rejected due to additional infrastructure)

**Implementation Notes**:
- Use PostgreSQL `tsvector` and `tsquery` for full-text search
- Create GIN indexes on searchable columns (titre, contenu_texte)
- Configure French language text search dictionary
- Use `MATCH ... AGAINST` or `to_tsvector` for relevance scoring
- Consider materialized views for complex search queries if performance becomes an issue

---

### 2. Search UI Library Choice

**Question**: Which library should we use for the search interface (autocomplete, filters, results display)?

**Research Findings**:

**Option A: Custom Implementation with Radix UI**
- **Pros**:
  - Full control over behavior and styling
  - Consistent with existing UI (Radix UI already in use)
  - No additional dependencies
  - Tailored to specific requirements
- **Cons**:
  - More development time
  - Need to implement accessibility features manually
  - More code to maintain

**Option B: react-select or downshift**
- **Pros**:
  - Mature libraries with accessibility built-in
  - Rich feature set (multi-select, search, async loading)
  - Well-documented and maintained
- **Cons**:
  - Additional dependency
  - May require customization to match design system
  - Potential bundle size increase

**Decision**: **Custom Implementation with Radix UI + TanStack Query**

**Rationale**:
- Radix UI is already in the project and provides accessible primitives
- TanStack Query handles async data fetching and caching
- Custom implementation allows full control over UX
- Can leverage existing design system components
- Minimal additional dependencies
- Better integration with existing codebase patterns

**Alternatives Considered**: react-select (rejected - additional dependency, may not match design), downshift (rejected - lower-level, requires more implementation), Headless UI (rejected - not in current stack)

**Implementation Notes**:
- Use Radix UI Combobox for autocomplete
- Use Radix UI Select for filter dropdowns
- Use TanStack Query for search API calls with debouncing
- Implement custom search input with debounced onChange
- Create reusable SearchAutocomplete component in packages/ui

---

### 3. Background Job Processing

**Question**: How should we implement background jobs for scheduled tasks (deadline checks, saved search alerts, scheduled reports)?

**Research Findings**:

**Option A: node-cron with in-process execution**
- **Pros**:
  - Simple implementation (no additional infrastructure)
  - No external dependencies beyond node-cron
  - Easy to debug and monitor
  - Sufficient for low-frequency tasks
- **Cons**:
  - Jobs run in same process (can affect API performance)
  - No job queue or retry mechanism
  - Limited scalability
  - Single point of failure

**Option B: Separate worker process with node-cron**
- **Pros**:
  - Jobs run in separate process (doesn't affect API)
  - Still simple (no external queue service)
  - Better isolation
- **Cons**:
  - Requires separate process management
  - No job queue or retry mechanism
  - Limited scalability

**Option C: Job queue (BullMQ, Agenda.js)**
- **Pros**:
  - Proper job queue with retry logic
  - Better error handling and monitoring
  - Scalable (can run multiple workers)
  - Job persistence (survives restarts)
- **Cons**:
  - Additional infrastructure (Redis for BullMQ)
  - More complex setup and maintenance
  - Overkill for current requirements

**Decision**: **node-cron with separate worker process (Option B)**

**Rationale**:
- Balances simplicity with isolation
- No additional infrastructure required (no Redis)
- Jobs don't affect API performance
- Sufficient for current requirements (daily/hourly tasks)
- Can migrate to job queue later if needed
- Aligns with production-ready principle (simple, reliable)

**Alternatives Considered**: In-process node-cron (rejected - affects API performance), BullMQ (rejected - requires Redis, overkill), Agenda.js (rejected - requires MongoDB, overkill)

**Implementation Notes**:
- Create separate worker process: `apps/api/src/worker.ts`
- Use node-cron for scheduling
- Jobs: check-echeances (daily at 8am), execute-saved-searches (hourly), execute-rapports-planifies (hourly), cleanup-notifications (weekly)
- Log all job executions and errors
- Use PM2 or similar for process management in production
- Consider adding job queue (BullMQ) in future if requirements grow

---

### 4. Notification Delivery Mechanism

**Question**: How should notifications be delivered to users (real-time WebSocket, polling, or hybrid)?

**Research Findings**:

**Option A: Polling (HTTP requests)**
- **Pros**:
  - Simple implementation
  - No additional infrastructure
  - Works with existing HTTP setup
  - Reliable and well-understood
- **Cons**:
  - Not truly real-time (delay based on poll interval)
  - Increased server load with frequent polling
  - Less efficient than push

**Option B: WebSocket (real-time push)**
- **Pros**:
  - True real-time delivery
  - Efficient (no polling overhead)
  - Better user experience
- **Cons**:
  - Additional infrastructure (WebSocket server)
  - More complex implementation
  - Connection management overhead
  - May require sticky sessions in load-balanced environments

**Option C: Hybrid (polling + optional WebSocket)**
- **Pros**:
  - Fallback to polling if WebSocket unavailable
  - Best of both worlds
- **Cons**:
  - Most complex implementation
  - Requires both mechanisms

**Decision**: **Polling with TanStack Query (Option A)**

**Rationale**:
- Simpler implementation aligns with project principles
- TanStack Query provides efficient polling with configurable intervals
- Sufficient for notification use case (1-minute delay acceptable per SC-008)
- No additional infrastructure required
- Can upgrade to WebSocket later if real-time becomes critical
- Reliable and well-tested approach

**Alternatives Considered**: WebSocket (rejected - additional complexity, not critical for notifications), Server-Sent Events (rejected - similar complexity to WebSocket), Hybrid (rejected - unnecessary complexity)

**Implementation Notes**:
- Use TanStack Query with `refetchInterval` for polling
- Poll every 30 seconds when user is active
- Reduce polling frequency when tab is inactive
- Use React Query's `useQuery` with appropriate stale time
- Consider WebSocket upgrade in future if real-time becomes critical

---

## Summary of Decisions

1. **Search Engine**: PostgreSQL Full-Text Search (no Elasticsearch)
2. **Search UI**: Custom implementation with Radix UI + TanStack Query
3. **Background Jobs**: node-cron with separate worker process
4. **Notifications**: Polling with TanStack Query (no WebSocket initially)

All decisions prioritize simplicity, maintainability, and alignment with existing infrastructure while meeting performance requirements. Future scalability paths are identified for each decision.

