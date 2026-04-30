# Research: Phase 6 - Gestion des Incidents

**Feature**: Phase 6 - Gestion des Incidents  
**Date**: 2025-01-27  
**Status**: Complete

## Research Questions & Decisions

### 1. File Upload Library: Multer vs Fastify-Multipart

**Question**: Which library should be used for handling file uploads in Fastify for incident evidence files (photos, videos, documents)?

**Decision**: Use `@fastify/multipart` (Fastify's official multipart plugin) for file upload handling.

**Rationale**:
- **Native Integration**: `@fastify/multipart` is the official Fastify plugin, designed specifically for Fastify's architecture
- **Streaming Support**: Handles large files (up to 100 MB) efficiently with streaming, preventing memory issues
- **Type Safety**: Better TypeScript support and integration with Fastify's type system
- **Validation**: Built-in support for file validation (size, MIME types) that integrates with Zod schemas
- **Performance**: More efficient than multer for Fastify applications, designed for async/await patterns

**Alternatives Considered**:
1. **Multer**: Rejected because it's Express-specific and requires adapters for Fastify, adding unnecessary complexity
2. **Manual multipart parsing**: Rejected because it's error-prone and doesn't handle edge cases well
3. **@fastify/multipart**: Selected as the optimal choice for Fastify-based applications

**Implementation Notes**:
- Use `@fastify/multipart` with `limits` configuration for file size validation
- Integrate with Zod schemas for additional validation
- Use streaming for large files to prevent memory issues
- Store files in MinIO/S3 with proper access control

---

### 2. PDF Generation Library: PDFKit vs Puppeteer

**Question**: Which library should be used for generating professional PDF reports for incidents with images, tables, and formatted text?

**Decision**: Use **Puppeteer** for PDF generation.

**Rationale**:
- **HTML/CSS Rendering**: Puppeteer uses headless Chrome, allowing use of HTML/CSS for complex layouts (better than PDFKit's programmatic API)
- **Image Handling**: Better support for embedding images from various sources (URLs, base64, file paths)
- **Professional Formatting**: Can leverage CSS for professional layouts, tables, headers, footers, page breaks
- **Consistency**: Renders exactly as it would appear in a browser, ensuring consistent output
- **Maintenance**: Easier to maintain and update layouts using HTML/CSS rather than programmatic PDF generation
- **Template Reusability**: HTML templates can be reused for email reports or web previews

**Alternatives Considered**:
1. **PDFKit**: Rejected because it requires programmatic layout which is harder to maintain and less flexible for complex reports
2. **jsPDF**: Rejected because it has limited support for complex layouts and image embedding
3. **Puppeteer**: Selected as optimal for professional, maintainable PDF reports

**Implementation Notes**:
- Create HTML templates for incident reports with CSS styling
- Use Puppeteer to render HTML to PDF with proper page breaks and formatting
- Handle image embedding from MinIO/S3 URLs or base64 encoding
- Configure PDF options (format: A4, margins, print background graphics)
- Cache rendered PDFs temporarily for performance (optional)

---

### 3. Image Processing and Thumbnail Generation

**Question**: How should we handle image processing and thumbnail generation for evidence photos?

**Decision**: Use **Sharp** library for image processing and thumbnail generation.

**Rationale**:
- **Performance**: Sharp is built on libvips, one of the fastest image processing libraries
- **Memory Efficiency**: Processes images in streams, handling large files efficiently
- **Format Support**: Supports all required formats (JPEG, PNG) and can convert between formats
- **Thumbnail Generation**: Built-in thumbnail generation with quality and size options
- **Metadata Extraction**: Can extract EXIF data for incident reports if needed
- **Node.js Native**: Pure Node.js implementation, no external dependencies

**Alternatives Considered**:
1. **Jimp**: Rejected because it's slower and has higher memory usage for large images
2. **ImageMagick (imagemagick npm)**: Rejected because it requires external binaries and is harder to deploy
3. **Sharp**: Selected as the optimal choice for performance and ease of use

**Implementation Notes**:
- Generate thumbnails (e.g., 300x300px) for images during upload
- Store thumbnails in MinIO/S3 alongside original files
- Use Sharp for format validation and conversion if needed
- Extract image metadata (dimensions, file size) for database storage

---

### 4. Full-Text Search Implementation

**Question**: How should full-text search be implemented for incident search (title, descriptions)?

**Decision**: Use **PostgreSQL full-text search** with GIN indexes.

**Rationale**:
- **Native Support**: PostgreSQL has built-in full-text search capabilities (tsvector, tsquery)
- **Performance**: GIN indexes provide fast full-text search even with large datasets (1000+ incidents)
- **No External Dependencies**: No need for Elasticsearch or other search engines, reducing complexity
- **Integration**: Works seamlessly with existing PostgreSQL database and RLS policies
- **French Language Support**: PostgreSQL supports French language stemming and stop words
- **Ranking**: Built-in ranking functions (ts_rank) for relevance scoring

**Alternatives Considered**:
1. **Elasticsearch**: Rejected because it adds infrastructure complexity and is overkill for this use case
2. **LIKE/ILIKE queries**: Rejected because they're slow and don't support relevance ranking
3. **PostgreSQL full-text search**: Selected as optimal balance of performance and simplicity

**Implementation Notes**:
- Create FULLTEXT indexes on `titre`, `description_courte`, `description_detaillee` columns
- Use `to_tsvector('french', ...)` for French language support
- Implement search queries using `tsquery` with ranking
- Combine full-text search with regular filters (status, type, etc.) for comprehensive search

---

### 5. Kanban Drag-and-Drop Library

**Question**: Which library should be used for the Kanban view with drag-and-drop status changes?

**Decision**: Use **@dnd-kit/core** with **@dnd-kit/sortable**.

**Rationale**:
- **Modern & Maintained**: @dnd-kit is actively maintained and designed for React 18+
- **Accessibility**: Built with accessibility in mind (keyboard navigation, screen reader support)
- **Performance**: More performant than react-beautiful-dnd, especially with many items
- **Flexibility**: More flexible API for custom drag handles and drop zones
- **TypeScript**: Excellent TypeScript support with proper type definitions
- **Touch Support**: Better mobile/touch support for tablet use

**Alternatives Considered**:
1. **react-beautiful-dnd**: Rejected because it's less maintained and has performance issues with many items
2. **react-dnd**: Rejected because it's more complex and overkill for simple Kanban functionality
3. **@dnd-kit**: Selected as the modern, performant, and accessible choice

**Implementation Notes**:
- Use @dnd-kit/core for drag-and-drop functionality
- Use @dnd-kit/sortable for sortable lists within columns
- Implement optimistic UI updates with rollback on API failure
- Add visual feedback during drag operations
- Support keyboard navigation for accessibility

---

### 6. Dashboard Chart Library

**Question**: Which library should be used for dashboard charts (evolution, distribution by type)?

**Decision**: Use **Recharts** for dashboard visualizations.

**Rationale**:
- **React Native**: Built specifically for React, integrates seamlessly with React components
- **Declarative API**: Easy to use declarative API that fits React patterns
- **Responsive**: Built-in responsive design support
- **Customizable**: Highly customizable with good documentation
- **TypeScript**: Excellent TypeScript support
- **Performance**: Good performance for typical dashboard use cases (not thousands of data points)

**Alternatives Considered**:
1. **Chart.js with react-chartjs-2**: Rejected because it requires more configuration and is less React-native
2. **Victory**: Rejected because it's heavier and more complex for simple charts
3. **Recharts**: Selected as the React-native, easy-to-use choice

**Implementation Notes**:
- Use Recharts for bar charts (monthly evolution), pie charts (distribution by type)
- Implement responsive charts that work on mobile and desktop
- Use consistent color scheme matching RSO-PFSO design system
- Add tooltips and legends for better UX

---

### 7. Scheduled Task System

**Question**: How should scheduled tasks (delay detection, statistics aggregation) be implemented?

**Decision**: Use **node-cron** with a dedicated worker process or Fastify plugin.

**Rationale**:
- **Simple & Reliable**: node-cron is a proven, reliable library for cron job scheduling
- **No External Dependencies**: Doesn't require external task queues (Redis, RabbitMQ) for basic scheduling
- **Flexible**: Supports cron expressions for flexible scheduling
- **Integration**: Can run within Fastify application or as separate worker process
- **Monitoring**: Easy to add logging and monitoring for scheduled tasks

**Alternatives Considered**:
1. **External cron (system cron)**: Rejected because it's harder to deploy and monitor in containerized environments
2. **Bull/BullMQ (Redis queues)**: Rejected because it adds infrastructure complexity and is overkill for simple scheduled tasks
3. **node-cron**: Selected as the simple, reliable choice for this use case

**Implementation Notes**:
- Use node-cron for scheduling delay detection (hourly) and statistics aggregation (daily at 23:00)
- Run scheduled tasks within Fastify application or as separate worker process
- Add comprehensive logging for scheduled task execution
- Implement error handling and retry logic for failed tasks
- Consider using Fastify's lifecycle hooks for task initialization

---

### 8. Notification System Integration

**Question**: Should we create a new notification system or reuse existing infrastructure from previous phases?

**Decision**: Reuse and extend existing notification infrastructure from previous phases.

**Rationale**:
- **Consistency**: Maintains consistent notification patterns across the RSO-PFSO module
- **Code Reuse**: Leverages existing notification service and database tables
- **User Experience**: Users get notifications in the same place they're used to
- **Maintenance**: Single notification system is easier to maintain and update

**Implementation Notes**:
- Extend existing notification service to support incident-specific notification types
- Add new notification types: `incident_nouveau`, `incident_changement_statut`, `incident_assignation`, `incident_retard`
- Integrate with existing email service for critical incident notifications
- Use existing notification database tables with new `entite_type` and `entite_id` fields

---

### 9. File Storage Path Structure

**Question**: How should evidence files be organized in MinIO/S3 storage?

**Decision**: Use hierarchical path structure: `rso/incidents/{incident_id}/medias/{media_id}/{filename}`

**Rationale**:
- **Organization**: Clear organization by incident, making it easy to find and manage files
- **Isolation**: Each incident's files are isolated in their own directory
- **Scalability**: Supports large numbers of incidents without performance issues
- **Backup/Restore**: Easier to backup or restore specific incident files
- **Access Control**: Can implement access control at the incident level

**Implementation Notes**:
- Store original files: `rso/incidents/{incident_id}/medias/{media_id}/original/{filename}`
- Store thumbnails: `rso/incidents/{incident_id}/medias/{media_id}/thumbnail/{filename}`
- Use UUIDs for media IDs to prevent collisions
- Implement cleanup logic for deleted incidents (soft delete handling)

---

### 10. Incident Code Generation Strategy

**Question**: How should unique incident codes be generated (format: INC-YYYY-CODE_INSTALLATION-XXX)?

**Decision**: Use database sequence or auto-increment with year and installation code prefix.

**Rationale**:
- **Uniqueness**: Database sequences guarantee uniqueness even with concurrent requests
- **Performance**: Sequences are fast and don't require table locks
- **Format Compliance**: Easy to format with year and installation code
- **Readability**: Sequential numbers make codes easy to read and reference

**Implementation Notes**:
- Create a sequence per installation per year: `seq_incidents_{installation_code}_{year}`
- Or use a single sequence with proper formatting and validation
- Format: `INC-{YYYY}-{INSTALLATION_CODE}-{SEQUENCE_NUMBER}` (e.g., INC-2024-PAD_COM-001)
- Validate installation code exists and is active before generating code
- Handle year transitions (new sequence for new year)

---

## Summary of Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| File Upload | @fastify/multipart | Native Fastify integration, streaming support |
| PDF Generation | Puppeteer | HTML/CSS rendering, professional layouts |
| Image Processing | Sharp | Performance, thumbnail generation |
| Full-Text Search | PostgreSQL FTS | Native, performant, no external dependencies |
| Kanban Drag-Drop | @dnd-kit/core | Modern, accessible, performant |
| Dashboard Charts | Recharts | React-native, easy to use |
| Scheduled Tasks | node-cron | Simple, reliable, no external dependencies |
| Notifications | Extend existing | Consistency, code reuse |
| File Storage | MinIO/S3 (existing) | Reuse existing infrastructure |
| Code Generation | Database sequences | Uniqueness, performance |

All technology choices align with existing RSO-PFSO infrastructure and maintain consistency with previous phases.

