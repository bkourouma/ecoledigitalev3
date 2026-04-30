# Research: Catalogue de Formations Professionnelles

**Date**: 2025-11-14  
**Feature**: 016-catalogue-formations-pro  
**Phase**: 0 - Research & Technical Decisions

## Overview

This document consolidates research findings and technical decisions for implementing the professional training catalog module. All research questions from the specification and planning phase have been resolved.

---

## 1. PDF Generation Library

### Decision: Use Puppeteer for PDF Generation

**Rationale**:
- **Server-side generation**: PDFs should be generated on the backend to avoid client-side performance issues and ensure consistent output
- **HTML-to-PDF conversion**: Puppeteer provides excellent HTML/CSS rendering capabilities, allowing us to use existing React components or HTML templates
- **Professional output**: Puppeteer uses Chromium's rendering engine, ensuring high-quality PDFs with proper fonts, layouts, and styling
- **Template flexibility**: Can reuse existing UI components or create dedicated PDF templates
- **Production-ready**: Widely used in production environments, well-documented, and actively maintained

**Alternatives Considered**:
- **PDFKit**: Lower-level library requiring manual layout calculations. More complex for rich content like training programs.
- **jsPDF**: Client-side library, not suitable for server-side generation. Limited styling capabilities.
- **PDFMake**: Document-based approach, less flexible for complex layouts with images and rich formatting.
- **HTML-to-PDF services**: External dependencies add latency and cost. Prefer self-hosted solution for control and performance.

**Implementation Approach**:
- Create PDF generation service in `apps/api/src/services/pdf-generation.service.ts`
- Use HTML templates with Tailwind CSS classes (or dedicated PDF stylesheet)
- Template includes: Imhotep Data logo, training title, description, objectives, program content, prerequisites, pricing, contact information
- Generate PDF on-demand when user requests download
- Cache generated PDFs temporarily (optional optimization for frequently accessed trainings)

**Performance Considerations**:
- PDF generation is async operation (target: <5 seconds per PDF)
- Consider queue system (BullMQ) if generation becomes bottleneck
- Implement timeout handling (30 seconds max)
- Error handling with user-friendly messages

---

## 2. Full-Text Search Implementation

### Decision: PostgreSQL Full-Text Search with GIN Indexes

**Rationale**:
- **Native PostgreSQL support**: No additional dependencies or services required
- **Performance**: GIN indexes provide fast full-text search on large datasets
- **Accent handling**: PostgreSQL's `unaccent` extension can handle French accents (é, è, à, etc.)
- **Weighted search**: Can prioritize matches in title (weight 3) vs description (weight 1)
- **Existing infrastructure**: Database already supports full-text search, no new services needed
- **Cost-effective**: No additional infrastructure costs

**Alternatives Considered**:
- **Elasticsearch**: Overkill for 500+ trainings. Adds infrastructure complexity and operational overhead.
- **Algolia/Meilisearch**: External service adds cost and dependency. Good for larger scale but unnecessary here.
- **Client-side filtering**: Not scalable, requires loading all data. Poor performance with 500+ items.
- **LIKE queries**: Too slow for large datasets, no relevance ranking.

**Implementation Approach**:
- Create full-text search index on `formations_professionnelles` table:
  ```sql
  CREATE INDEX idx_formations_pro_fts ON formations_professionnelles 
  USING GIN (to_tsvector('french', 
    COALESCE(titre, '') || ' ' || 
    COALESCE(description_courte, '') || ' ' || 
    COALESCE(description_complete, '')
  ));
  ```
- Search query using `ts_query` with French language configuration
- Weighted search: title matches score higher than description matches
- Handle special characters and accents via `unaccent` extension (if available) or normalization
- Combine with filter conditions (themes, price, etc.) in WHERE clause

**Search Query Pattern**:
```sql
SELECT *, 
  ts_rank_cd(
    to_tsvector('french', titre || ' ' || description_courte),
    plainto_tsquery('french', $1)
  ) as relevance
FROM formations_professionnelles
WHERE tenant_id = $2
  AND actif = true
  AND to_tsvector('french', titre || ' ' || description_courte) @@ plainto_tsquery('french', $1)
ORDER BY relevance DESC, titre ASC
```

---

## 3. Catalog Access: Public vs Authenticated

### Decision: Public Catalog Access (No Authentication Required)

**Rationale**:
- **User Experience**: Prospective learners should be able to browse training catalog without creating accounts
- **Discovery**: Public access enables better SEO and discoverability
- **Lower barrier**: Reduces friction for users exploring training options
- **Industry standard**: Most training catalogs are publicly accessible
- **Security**: Training information is not sensitive data; enrollment requires authentication (separate feature)

**Alternatives Considered**:
- **Authenticated only**: Would reduce discoverability and create unnecessary friction for browsing
- **Hybrid (public browse, auth for details)**: Adds complexity without clear benefit; all training info is non-sensitive

**Implementation Approach**:
- Catalog browsing endpoints: No authentication required
- Training detail pages: No authentication required
- PDF download: No authentication required (training information is public)
- Enrollment functionality (future): Will require authentication (out of scope for this feature)
- Rate limiting: Apply to PDF generation endpoint to prevent abuse

**Security Considerations**:
- Only active trainings are visible (`actif = true` filter)
- Tenant isolation still enforced via RLS (users only see their tenant's trainings)
- No sensitive data exposed (pricing, schedules are public information)
- PDF generation rate limiting to prevent abuse

---

## 4. Recommendation Algorithm

### Decision: Similarity-Based Recommendations with Scoring

**Rationale**:
- **Simple and effective**: Theme matching is the strongest indicator of similarity
- **No ML required**: Rule-based algorithm is sufficient for current scale (500+ trainings)
- **Fast computation**: Can be calculated in SQL query, no external services needed
- **Transparent**: Users can understand why trainings are recommended
- **Maintainable**: Easy to adjust scoring weights as needed

**Algorithm**:
1. **Theme matching** (score +3 per matching theme): Trainings with shared themes are most similar
2. **Skill level matching** (score +2): Same level (Débutant/Intermédiaire/Avancé) indicates similar audience
3. **Duration similarity** (score +1): Similar duration (±2 days) suggests comparable depth
4. **Price range similarity** (score +1): Similar price range (±30%) suggests comparable value proposition

**Implementation Approach**:
- SQL query calculates similarity score for each candidate training
- Exclude the current training from results
- Filter to only active trainings
- Sort by score DESC, limit to 4 recommendations
- Fallback: If no similar trainings found, show most popular trainings (by session enrollment count)

**SQL Pattern**:
```sql
WITH similarity_scores AS (
  SELECT 
    f2.id,
    f2.titre,
    -- Calculate similarity score
    (CASE WHEN f2.themes && $1::jsonb THEN 
      (SELECT COUNT(*) FROM jsonb_array_elements_text(f2.themes) 
       WHERE value = ANY(SELECT jsonb_array_elements_text($1::jsonb))) * 3 
     ELSE 0 END) +
    (CASE WHEN f2.niveau = $2 THEN 2 ELSE 0 END) +
    (CASE WHEN ABS(f2.duree_jours - $3) <= 2 THEN 1 ELSE 0 END) +
    (CASE WHEN f2.prix_ttc BETWEEN $4 * 0.7 AND $4 * 1.3 THEN 1 ELSE 0 END) as score
  FROM formations_professionnelles f2
  WHERE f2.tenant_id = $5
    AND f2.actif = true
    AND f2.id != $6  -- Exclude current training
)
SELECT * FROM similarity_scores
WHERE score > 0
ORDER BY score DESC, titre ASC
LIMIT 4;
```

**Future Enhancements** (out of scope):
- Machine learning-based recommendations using user behavior
- Collaborative filtering based on enrollment patterns
- A/B testing different recommendation algorithms

---

## 5. Filter State Management

### Decision: URL Parameters + Session Storage Hybrid

**Rationale**:
- **URL parameters**: Enable shareable links with filter state, better UX for bookmarking
- **Session storage**: Preserve filter state during navigation, improve UX for returning users
- **Best of both**: Combines benefits of shareability and persistence
- **Existing patterns**: Next.js supports URL search params natively, sessionStorage is standard browser API

**Alternatives Considered**:
- **URL parameters only**: Requires encoding complex filter states, can create very long URLs
- **Session storage only**: Not shareable, users can't bookmark filtered views
- **Local storage**: Persists across sessions, but filters may become stale
- **State management (Zustand/Redux)**: Overkill for filter state, adds complexity

**Implementation Approach**:
- **Primary**: URL search parameters (`?search=python&themes=data-science&prix_min=100000`)
- **Secondary**: Session storage as fallback for complex filter states
- **Synchronization**: On page load, check URL params first, then session storage, then defaults
- **Debouncing**: Search input debounced (300ms) before updating URL params
- **Next.js integration**: Use `useSearchParams()` hook for reading, `router.push()` for updating

**URL Parameter Structure**:
```
/formations-professionnelles/catalogue?
  search=python
  &themes=data-science,analytics
  &duree_min=3
  &duree_max=10
  &prix_min=100000
  &prix_max=500000
  &niveau=intermediaire
  &mode=presentiel,distanciel
  &certification=true
  &sort=prix_asc
  &page=1
```

---

## 6. Performance Optimization Strategies

### Decision: Multiple Optimization Techniques

**Rationale**:
- **Pagination**: Essential for handling 500+ trainings without performance degradation
- **Debouncing**: Reduces API calls during search input
- **Caching**: Reduces database load for frequently accessed data
- **Lazy loading**: Improves initial page load time
- **Skeleton loaders**: Better perceived performance

**Implementation Approach**:

1. **Pagination**:
   - Default: 20 items per page
   - Maximum: 100 items per page (admin override)
   - Offset-based pagination (simple, sufficient for current scale)

2. **Search Debouncing**:
   - 300ms delay before triggering API call
   - Cancel previous request if new search initiated
   - Use React `useDebounce` hook or custom implementation

3. **Caching**:
   - API response caching: 5 minutes for catalog listings (stale-while-revalidate pattern)
   - PDF caching: Store generated PDFs temporarily (24 hours) to avoid regeneration
   - Use TanStack Query's built-in caching with appropriate staleTime

4. **Lazy Loading**:
   - Images in training cards: Lazy load with `loading="lazy"` attribute
   - Similar trainings: Load after main content
   - PDF preview: Load on demand

5. **Database Optimization**:
   - Indexes already in place from Phase 1 (themes GIN index, slug index, actif index)
   - Query optimization: Use EXPLAIN ANALYZE to verify query plans
   - Connection pooling: Already handled by Fastify PostgreSQL plugin

---

## 7. Error Handling Strategy

### Decision: Graceful Degradation with User-Friendly Messages

**Rationale**:
- **User experience**: Errors should not break the entire catalog experience
- **Transparency**: Users should understand what went wrong and how to proceed
- **Recovery**: Provide clear paths to retry or adjust filters

**Implementation Approach**:

1. **API Errors**:
   - Network errors: "Unable to load trainings. Please check your connection and try again."
   - Server errors (500): "Something went wrong. Please try again later."
   - Not found (404): "Training not found. It may have been removed or the link is incorrect."
   - Validation errors (400): Show specific field errors

2. **Empty States**:
   - No results: "No trainings match your search. Try adjusting your filters."
   - No sessions: "No upcoming sessions scheduled. Contact us for more information."

3. **PDF Generation Errors**:
   - Timeout: "PDF generation is taking longer than expected. Please try again or contact support."
   - Generation failure: "Unable to generate PDF. Please try again or contact support for assistance."

4. **Error Boundaries**:
   - React Error Boundaries for component-level errors
   - Fallback UI: Show error message with retry button
   - Log errors to console (development) or error tracking service (production)

---

## Summary of Technical Decisions

| Decision Area | Choice | Rationale |
|--------------|--------|-----------|
| PDF Generation | Puppeteer | Server-side, high-quality output, template flexibility |
| Full-Text Search | PostgreSQL FTS | Native support, no additional services, good performance |
| Catalog Access | Public (no auth) | Better UX, industry standard, non-sensitive data |
| Recommendations | Rule-based scoring | Simple, effective, maintainable, no ML required |
| Filter State | URL params + session storage | Shareable links + persistence |
| Performance | Pagination + caching + debouncing | Handles 500+ trainings efficiently |
| Error Handling | Graceful degradation | User-friendly messages, recovery paths |

---

## Dependencies to Add

### Backend (apps/api/package.json)
- `puppeteer`: ^21.0.0 (PDF generation)

### Frontend (apps/web/package.json)
- No new dependencies required (uses existing Next.js, React, TanStack Query)

### Database
- PostgreSQL `unaccent` extension (optional, for better accent handling in search)

---

## Next Steps

1. **Phase 1 - Design & Contracts**:
   - Create data-model.md (extract entities from Phase 1 schema)
   - Define API contracts in `packages/contracts/src/formations-pro.ts`
   - Create quickstart.md with API usage examples

2. **Phase 2 - Implementation**:
   - Implement API endpoints following research decisions
   - Create frontend components with filter state management
   - Integrate PDF generation service
   - Add error handling and loading states

---

**Research Status**: ✅ Complete - All technical decisions resolved, ready for Phase 1 design

