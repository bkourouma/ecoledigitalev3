# Research: Phase 4 - Gestion des Médias et Documents

**Date**: 2025-11-30  
**Feature**: Phase 4 - Gestion des Médias et Documents  
**Plan**: [plan.md](./plan.md)

## Technology Decisions

### 1. Image Processing Library

**Decision**: Use Sharp for image processing (compression, resizing, thumbnail generation, EXIF extraction)

**Rationale**:
- Sharp is the industry standard for Node.js image processing
- High performance (uses libvips, written in C++)
- Excellent TypeScript support
- Supports all required formats (JPEG, PNG, GIF, WebP, BMP)
- Built-in EXIF metadata extraction
- Automatic format conversion and optimization
- Well-maintained and widely used in production

**Alternatives Considered**:
- **Jimp**: Pure JavaScript, slower performance, less feature-rich
- **ImageMagick/GraphicsMagick bindings**: More complex setup, heavier dependencies, overkill for our needs
- **Canvas**: Browser-focused, not ideal for server-side processing

**Implementation Notes**:
- Install: `pnpm add sharp`
- Use for: Image compression (quality 85%), resizing (max 2048px), thumbnail generation (300x300px), EXIF extraction
- Error handling: Wrap in try-catch, fallback to original if processing fails

---

### 2. Video Processing

**Decision**: Use fluent-ffmpeg (Node.js wrapper for FFmpeg) for video thumbnail generation and metadata extraction

**Rationale**:
- FFmpeg is the industry standard for video processing
- fluent-ffmpeg provides a clean Node.js API
- Supports all required formats (MP4, WebM, MOV, OGG)
- Can extract metadata (duration, dimensions, codec, bitrate)
- Can generate thumbnails at specific timestamps
- Well-documented and maintained

**Alternatives Considered**:
- **ffmpeg-static**: Bundled FFmpeg binary, but larger package size
- **node-ffmpeg**: Less maintained, fewer features
- **Cloud video processing services**: Adds cost and dependency, not needed for basic thumbnails

**Implementation Notes**:
- Install: `pnpm add fluent-ffmpeg @types/fluent-ffmpeg`
- System requirement: FFmpeg must be installed on server (`apt-get install ffmpeg` or similar)
- Use for: Video thumbnail generation (1-second mark), metadata extraction (duration, dimensions, codec)
- Error handling: Check if FFmpeg is available, handle processing failures gracefully

---

### 3. PDF Generation

**Decision**: Extend existing Puppeteer-based PDF generation from Phase 3

**Rationale**:
- Already integrated and working in Phase 3
- Puppeteer provides excellent HTML-to-PDF conversion
- Supports complex layouts, images, tables, headers/footers
- Can handle large documents with proper memory management
- Professional output quality
- No need to introduce new dependency

**Alternatives Considered**:
- **PDFKit**: Lower-level, more code required, less suitable for HTML conversion
- **jsPDF**: Browser-focused, not ideal for server-side
- **wkhtmltopdf**: External dependency, less flexible

**Implementation Notes**:
- Already installed from Phase 3
- Extend existing `activite-export.service.ts` to include media galleries
- Add options for watermark, page format, orientation
- Handle large PDFs with proper memory management and timeouts

---

### 4. Word (DOCX) Export

**Decision**: Use `docx` library for Word document generation

**Rationale**:
- Pure JavaScript/TypeScript implementation
- Excellent TypeScript support
- Can create complex documents with tables, images, formatting
- No external dependencies (no need for Microsoft Word)
- Well-documented and maintained
- Produces standard DOCX files compatible with Microsoft Word and LibreOffice

**Alternatives Considered**:
- **officegen**: Less maintained, fewer features
- **docxtemplater**: Template-based, not suitable for dynamic content generation
- **mammoth**: Converts DOCX to HTML, not for generation

**Implementation Notes**:
- Install: `pnpm add docx`
- Use for: Converting activity content to Word format with preserved structure (headings, paragraphs, lists, tables, images)
- Structure: Create Document with Sections, Paragraphs, Tables, Images
- Images: Embed images as Media objects with proper dimensions

---

### 5. Excel (XLSX) Export

**Decision**: Use `exceljs` library for Excel spreadsheet generation

**Rationale**:
- Pure JavaScript implementation
- Excellent TypeScript support
- Can create complex spreadsheets with formatting, formulas, multiple sheets
- No external dependencies
- Well-documented and maintained
- Produces standard XLSX files compatible with Microsoft Excel and LibreOffice
- Supports large datasets efficiently

**Alternatives Considered**:
- **xlsx (SheetJS)**: More complex API, less TypeScript support
- **node-xlsx**: Less maintained, fewer features
- **fast-csv**: CSV only, not XLSX format

**Implementation Notes**:
- Install: `pnpm add exceljs`
- Use for: Exporting activity lists to Excel with columns for all relevant fields
- Structure: Create Workbook, add Worksheet, add rows with data
- Formatting: Apply styles, column widths, headers

---

### 6. File Upload Handling

**Decision**: Use `@fastify/multipart` (Fastify's built-in multipart support) for file uploads

**Rationale**:
- Native Fastify plugin, well-integrated
- Handles multipart/form-data efficiently
- Supports streaming for large files
- Built-in file validation options
- TypeScript support
- Already used in existing codebase patterns

**Alternatives Considered**:
- **multer**: Express-focused, not compatible with Fastify
- **busboy**: Lower-level, more code required
- **formidable**: More complex, overkill for our needs

**Implementation Notes**:
- Already available in Fastify ecosystem
- Configure limits: max file size (100MB for videos), max files (10 simultaneous)
- Validate: MIME type, file extension, file size before processing
- Stream files directly to storage to avoid memory issues with large files

---

### 7. Drag & Drop Upload Component

**Decision**: Use `react-dropzone` for drag & drop file upload functionality

**Rationale**:
- Industry standard React library for file uploads
- Excellent drag & drop support
- Built-in file validation
- Progress tracking support
- Accessible and well-documented
- Works well with TanStack Query for API calls
- TypeScript support

**Alternatives Considered**:
- **Custom implementation**: More code, less tested, accessibility concerns
- **react-uploader**: Less popular, fewer features
- **uppy**: More complex, overkill for our needs

**Implementation Notes**:
- Install: `pnpm add react-dropzone`
- Use for: Drag & drop zone, file selection, progress display
- Integration: Combine with TanStack Query mutations for upload API calls
- Validation: Client-side validation before upload (type, size)

---

### 8. Image Gallery Component

**Decision**: Use custom React component with Tailwind CSS and Radix UI primitives

**Rationale**:
- Matches existing design system (Radix UI, Tailwind CSS)
- Full control over layout and behavior
- Lightweight (no additional dependencies)
- Responsive design with Tailwind grid
- Lightbox functionality can use Radix Dialog
- Consistent with existing component patterns

**Alternatives Considered**:
- **react-image-gallery**: Additional dependency, less customization
- **react-photo-gallery**: More complex, overkill for our needs
- **swiper**: Carousel-focused, not ideal for grid galleries

**Implementation Notes**:
- Build custom component using Radix UI Dialog for lightbox
- Use Tailwind CSS grid for responsive layout (2 cols mobile, 3 tablet, 4 desktop)
- Implement image lazy loading for performance
- Add keyboard navigation (arrow keys) for lightbox

---

### 9. Storage Organization

**Decision**: Organize media files by year/month/type structure: `uploads/aspci/medias/{year}/{month}/{type}/{uuid_filename}`

**Rationale**:
- Follows existing pattern from Phase 3 (`uploads/aspci/activites/{year}/{activity_id}/`)
- Efficient for cleanup (can delete by year/month)
- Prevents directory from becoming too large
- Easy to locate files by date
- Maintains tenant isolation (aspci prefix)
- UUID filenames prevent collisions and security issues

**Alternatives Considered**:
- **Flat structure**: Would become unmanageable with many files
- **By user**: Less efficient, harder to manage
- **By activity only**: Doesn't support media library (media can be reused)

**Implementation Notes**:
- Generate path: `uploads/aspci/medias/{YYYY}/{MM}/{type}/{uuid}.{ext}`
- Type: 'image', 'video', 'document', 'audio'
- Store original filename in database for display
- Create directories recursively as needed

---

### 10. Quota Management

**Decision**: Track quota usage in database table (`rso_quotas_utilisateurs`) with real-time calculation

**Rationale**:
- Database ensures consistency across requests
- Can query quota status efficiently
- Supports quota adjustments by administrators
- Can track quota history if needed
- Prevents race conditions with database transactions
- Easy to generate statistics and reports

**Alternatives Considered**:
- **In-memory cache**: Not persistent, lost on restart
- **File-based**: Less efficient, harder to query
- **External service**: Adds complexity, not needed

**Implementation Notes**:
- Store quota in MB (decimal precision for accuracy)
- Update quota atomically with file upload (database transaction)
- Pre-check quota before upload begins (prevent wasted uploads)
- Calculate quota from sum of file sizes in `rso_activites_medias` table
- Cache quota in memory for performance (invalidate on upload/delete)

---

### 11. Media Cleanup Strategy

**Decision**: Implement soft delete with 30-day retention period, scheduled cleanup job

**Rationale**:
- Soft delete allows recovery of accidentally deleted media
- 30-day retention provides safety buffer
- Scheduled job runs daily to clean up expired soft-deleted files
- Prevents immediate data loss
- Allows for audit trail

**Alternatives Considered**:
- **Hard delete immediately**: Risk of data loss, no recovery
- **Manual cleanup**: Error-prone, forgotten tasks
- **Longer retention**: Wastes storage space

**Implementation Notes**:
- Mark media as deleted with `deleted_at` timestamp
- Hide from UI but keep in database
- Scheduled job (node-cron) runs daily at 2 AM
- Delete files where `deleted_at < NOW() - INTERVAL '30 days'`
- Also clean up orphaned files (media from deleted activities)

---

### 12. Print Optimization

**Decision**: Use CSS print media queries and print-specific stylesheets

**Rationale**:
- Standard web approach, no additional dependencies
- Works with browser's native print functionality
- Can hide navigation, add headers/footers via CSS
- Responsive to different paper sizes
- Easy to maintain and debug

**Alternatives Considered**:
- **PDF generation for printing**: Unnecessary, users can print PDFs directly
- **Print-specific page**: More complex, duplicate content

**Implementation Notes**:
- Add `@media print` CSS rules
- Hide navigation elements, show only content
- Add page breaks for tables and images
- Optimize colors for printing (if needed)
- Use browser's print preview for testing

---

## Integration Points

### Phase 3 Integration

- **Extend `rso_activites_medias` table**: Add fields for thumbnail paths, optimized image paths, video metadata, EXIF data, processing status
- **Enhance PDF export**: Include media galleries in PDF exports from Phase 3
- **Reuse upload infrastructure**: Extend existing image upload endpoint from Phase 3
- **Activity media association**: Media already linked to activities via `activite_id`

### Existing Services

- **File storage**: Reuse existing file storage patterns from Phase 3 (`uploads/aspci/activites/`)
- **Authentication**: Use existing RSO authentication middleware
- **Permission system**: Media access respects activity permissions from Phase 3
- **Activity service**: Extend `ActiviteService` with media-related methods

---

## Performance Considerations

### Image Processing

- Process images asynchronously to avoid blocking upload
- Use Sharp's streaming API for large images
- Cache processed images (optimized, thumbnails) to avoid reprocessing
- Limit concurrent image processing to prevent server overload

### Video Processing

- Generate thumbnails asynchronously (don't block upload)
- Use FFmpeg's fast seek for thumbnail generation
- Cache video metadata to avoid reprocessing
- Consider queue system for video processing if volume is high

### PDF Generation

- Use Puppeteer's page pool for concurrent PDF generation
- Implement timeout (30 seconds) to prevent hanging
- Stream large PDFs to avoid memory issues
- Cache generated PDFs if same content requested (optional)

### Quota Management

- Cache quota in memory (Redis or in-memory cache) for performance
- Update quota asynchronously after file upload completes
- Pre-check quota before upload to prevent wasted transfers
- Batch quota updates if multiple files uploaded

---

## Security Considerations

### File Upload Security

- Validate MIME type (server-side, not just client-side)
- Validate file extension
- Scan file content (magic number validation)
- Limit file size before upload begins
- Sanitize filenames (remove special characters, prevent directory traversal)
- Use UUID for stored filenames (prevent guessing)

### File Access Security

- Verify user permissions before serving media files
- Use signed URLs for temporary access (optional, for future)
- Prevent direct file access (serve through API with permission checks)
- Log media access for audit trail

### Export Security

- Verify user permissions before generating exports
- Validate export options (prevent path traversal in filenames)
- Rate limit export generation to prevent abuse
- Clean up generated exports after expiration

---

## Dependencies Summary

### New Dependencies

```json
{
  "sharp": "^0.33.0",           // Image processing
  "fluent-ffmpeg": "^2.1.2",    // Video processing
  "docx": "^8.5.0",              // Word export
  "exceljs": "^4.4.0",           // Excel export
  "react-dropzone": "^14.2.3"    // Drag & drop uploads
}
```

### System Dependencies

- **FFmpeg**: Required for video processing (`apt-get install ffmpeg` or similar)
- **libvips**: Usually installed with Sharp, but may need system package on some systems

### Existing Dependencies (Reused)

- **puppeteer**: Already installed from Phase 3 (PDF generation)
- **@fastify/multipart**: Fastify plugin for file uploads
- **pg**: PostgreSQL driver (already installed)
- **zod**: Validation (already installed)

---

## Testing Strategy

### Unit Tests

- Image compression logic (Sharp operations)
- Video thumbnail generation (FFmpeg operations)
- Quota calculation and enforcement
- Export generation (PDF, Word, Excel)
- File validation logic

### Integration Tests

- File upload end-to-end (upload → processing → storage → database)
- Media library filtering and search
- Export generation with media
- Quota enforcement during upload
- Permission checks for media access

### E2E Tests (Playwright)

- Drag & drop file upload workflow
- Media gallery creation and management
- PDF export with media galleries
- Quota dashboard and warnings
- Media library search and filters

---

## Migration Strategy

### Database Migrations

1. **Extend `rso_activites_medias` table**: Add new columns (thumbnail paths, optimized paths, metadata, processing status)
2. **Create `rso_documents_exports` table**: For export tracking
3. **Create `rso_quotas_utilisateurs` table**: For quota management
4. **Migrate existing media**: If any media exists from Phase 3, update with new fields

### Data Migration

- Existing media from Phase 3: Generate thumbnails and optimized versions in background job
- Initialize quotas: Calculate initial quota usage from existing media files
- Set default quotas: 1000 MB per user (configurable)

---

## Monitoring and Observability

### Metrics to Track

- Media upload success/failure rate
- Image processing time (compression, thumbnail generation)
- Video processing time (thumbnail generation)
- PDF generation time
- Quota usage trends
- Storage usage by type (images, videos, documents)
- Export generation success/failure rate

### Logging

- Log all media uploads (file type, size, user, activity)
- Log media processing results (success, failure, processing time)
- Log quota changes (updates, warnings, overruns)
- Log export generation (format, size, generation time)
- Log media deletions and cleanup operations

---

## Future Enhancements (Out of Scope for Phase 4)

- CDN integration for media distribution
- Advanced video processing (transcoding, streaming)
- AI-powered media tagging and categorization
- Media versioning and rollback
- Bulk media operations
- Media sharing between users
- Advanced analytics on media usage

