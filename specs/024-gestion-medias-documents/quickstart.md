# Quick Start: Phase 4 - Gestion des Médias et Documents

**Feature**: Phase 4 - Gestion des Médias et Documents  
**Date**: 2025-11-30  
**Plan**: [plan.md](./plan.md)  
**Spec**: [spec.md](./spec.md)

## Overview

This guide provides a quick start for developers implementing Phase 4 media and document management. Phase 4 extends Phase 3 activity management with comprehensive media capabilities including secure file uploads, automatic image compression, video thumbnail generation, professional PDF/Word/Excel exports, and quota management.

## Prerequisites

- Phase 3 (Activity Management) must be fully implemented
- Node.js 18+ and pnpm installed
- PostgreSQL 14+ database running
- FFmpeg installed on server (for video processing): `apt-get install ffmpeg`

## Installation

### 1. Install Dependencies

```bash
# Image processing
pnpm add sharp

# Video processing
pnpm add fluent-ffmpeg @types/fluent-ffmpeg

# Word export
pnpm add docx

# Excel export
pnpm add exceljs

# Drag & drop uploads (frontend)
pnpm add react-dropzone
```

### 2. Run Database Migrations

```bash
# Run Phase 4 migrations
psql "postgresql://postgres:password@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0024_rso_phase4_medias.sql
psql "postgresql://postgres:password@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0024_rso_phase4_quotas.sql
```

### 3. Configure Environment Variables

Add to `apps/api/.env`:
```env
# Media storage
RSO_MEDIAS_UPLOAD_DIR=uploads/aspci/medias
RSO_EXPORTS_UPLOAD_DIR=uploads/aspci/exports

# Media processing
RSO_IMAGE_MAX_SIZE_MB=10
RSO_VIDEO_MAX_SIZE_MB=100
RSO_DOCUMENT_MAX_SIZE_MB=20
RSO_IMAGE_COMPRESSION_QUALITY=85
RSO_IMAGE_MAX_DIMENSION=2048
RSO_THUMBNAIL_SIZE=300

# Quota defaults
RSO_DEFAULT_QUOTA_MB=1000
RSO_QUOTA_WARNING_THRESHOLD=80

# Export settings
RSO_EXPORT_EXPIRY_DAYS=30
```

## Quick Implementation Guide

### Backend: Media Upload Endpoint

```typescript
// apps/api/src/routes/rso/medias.ts
import { FastifyInstance } from 'fastify';
import { MediaService } from '../../services/rso/medias/media.service';

export async function mediasRoutes(fastify: FastifyInstance) {
  const mediaService = new MediaService(fastify);

  fastify.post('/api/v1/rso/formateur/medias/upload', {
    preHandler: [fastify.authenticateRSO],
    handler: async (request, reply) => {
      const data = await request.file(); // @fastify/multipart
      const userId = request.user.id;
      const tenantId = 'aspci';

      const media = await mediaService.uploadMedia({
        file: data,
        userId,
        tenantId,
      });

      return reply.status(201).send({ media });
    },
  });
}
```

### Backend: Media Processing Service

```typescript
// apps/api/src/services/rso/medias/media-processing.service.ts
import sharp from 'sharp';

export class MediaProcessingService {
  async processImage(filePath: string, options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }) {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    // Generate optimized version
    const optimizedPath = filePath.replace(/(\.[^.]+)$/, '_optimized$1');
    await image
      .resize(options.maxWidth || 2048, options.maxHeight || 2048, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: options.quality || 85 })
      .toFile(optimizedPath);

    // Generate thumbnail
    const thumbnailPath = filePath.replace(/(\.[^.]+)$/, '_thumb$1');
    await sharp(filePath)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    return {
      original: { path: filePath, size: metadata.width, height: metadata.height },
      optimized: { path: optimizedPath },
      thumbnail: { path: thumbnailPath },
    };
  }
}
```

### Frontend: Media Uploader Component

```typescript
// apps/web/src/components/rso/medias/MediaUploader.tsx
'use client';

import { useDropzone } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import { uploadMedia } from '@/lib/rso/medias';

export function MediaUploader({ activityId }: { activityId?: number }) {
  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadMedia(files, activityId),
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      uploadMutation.mutate(acceptedFiles);
    },
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
      'video/*': ['.mp4', '.webm', '.mov'],
      'application/pdf': ['.pdf'],
    },
    maxSize: 100 * 1024 * 1024, // 100 MB
    maxFiles: 10,
  });

  return (
    <div {...getRootProps()} className="border-2 border-dashed p-8">
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Déposez les fichiers ici...</p>
      ) : (
        <p>Glissez-déposez vos fichiers ici ou cliquez pour sélectionner</p>
      )}
      {uploadMutation.isPending && <p>Upload en cours...</p>}
    </div>
  );
}
```

### Frontend: Media Library API Client

```typescript
// apps/web/src/lib/rso/medias.ts
import { RSOMedia, RSOMediaListResponse } from '@ecoledigitale/contracts/rso/medias';

export async function listMedia(
  filters?: {
    typeMedia?: string;
    activiteId?: number;
    search?: string;
    page?: number;
  }
): Promise<RSOMediaListResponse> {
  const params = new URLSearchParams();
  if (filters?.typeMedia) params.append('typeMedia', filters.typeMedia);
  if (filters?.activiteId) params.append('activiteId', String(filters.activiteId));
  if (filters?.search) params.append('search', filters.search);
  if (filters?.page) params.append('page', String(filters.page));

  const response = await fetch(`/api/v1/rso/formateur/medias?${params}`, {
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'X-Tenant': 'aspci',
    },
  });

  if (!response.ok) throw new Error('Failed to fetch media');
  return response.json();
}
```

## Key Implementation Points

### 1. File Upload Flow

1. **Client**: User selects/drops files → `MediaUploader` component
2. **Client**: Validate files (type, size) → Show progress
3. **API**: Receive multipart/form-data → Validate (MIME type, size, quota)
4. **API**: Check quota → Block if would exceed
5. **API**: Save file to storage → Generate unique filename
6. **API**: Process media (async):
   - Images: Compress, generate thumbnail, extract EXIF
   - Videos: Generate thumbnail, extract metadata
7. **API**: Save media record to database
8. **API**: Update quota
9. **API**: Return media info to client

### 2. Quota Management

- **Pre-check**: Before upload begins, verify `quotaUtiliseMo + fileSize < quotaTotalMo`
- **Update**: After successful upload, atomically update `quotaUtiliseMo`
- **Calculation**: `quotaUtiliseMo = SUM(tailleOctets) / (1024 * 1024)` for all non-deleted media
- **Warning**: Show warning when `quotaUtiliseMo / quotaTotalMo > 0.8`

### 3. Media Processing

- **Images**: Use Sharp for compression (quality 85%), resizing (max 2048px), thumbnails (300x300px)
- **Videos**: Use FFmpeg for thumbnail generation (1-second mark), metadata extraction
- **Async**: Process in background, update status in database
- **Error handling**: If processing fails, mark status as 'erreur', keep original file

### 4. Export Generation

- **PDF**: Extend existing Puppeteer-based export from Phase 3, add media galleries
- **Word**: Use `docx` library to create DOCX with preserved structure
- **Excel**: Use `exceljs` to create XLSX with activity list data
- **Async**: For large exports, generate asynchronously, notify when ready
- **Cleanup**: Auto-delete exports after 30 days

## Testing

### Unit Tests

```typescript
// apps/api/src/services/rso/medias/__tests__/media-processing.test.ts
import { MediaProcessingService } from '../media-processing.service';
import sharp from 'sharp';

describe('MediaProcessingService', () => {
  it('should compress image and generate thumbnail', async () => {
    const service = new MediaProcessingService();
    const result = await service.processImage('/path/to/image.jpg', {
      maxWidth: 2048,
      quality: 85,
    });

    expect(result.optimized).toBeDefined();
    expect(result.thumbnail).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// apps/api/src/routes/rso/__tests__/medias.test.ts
import { build } from '../../../../test-utils';

test('POST /medias/upload should upload and process image', async () => {
  const app = build();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/rso/formateur/medias/upload',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
    payload: formData, // multipart/form-data
  });

  expect(response.statusCode).toBe(201);
  const body = JSON.parse(response.body);
  expect(body.medias).toHaveLength(1);
  expect(body.medias[0].statut).toBe('traite');
});
```

## Common Issues and Solutions

### Issue: FFmpeg not found

**Solution**: Install FFmpeg on server:
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

### Issue: Sharp installation fails

**Solution**: Install system dependencies:
```bash
sudo apt-get install libvips-dev
```

### Issue: Quota not updating

**Solution**: Ensure quota update is in same database transaction as media insert:
```typescript
await client.query('BEGIN');
await client.query('INSERT INTO rso_activites_medias ...');
await client.query('UPDATE rso_quotas_utilisateurs SET quota_utilise_mo = ...');
await client.query('COMMIT');
```

### Issue: Large file uploads timeout

**Solution**: Increase timeout in Fastify config:
```typescript
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
});
```

## Next Steps

1. **Implement core services**: Media upload, processing, quota management
2. **Create API routes**: Media CRUD, export generation, quota management
3. **Build frontend components**: Uploader, library, gallery, quota dashboard
4. **Add scheduled jobs**: Media cleanup (orphaned files, expired exports)
5. **Write tests**: Unit, integration, E2E
6. **Documentation**: API documentation, user guide

## Resources

- **Plan**: [plan.md](./plan.md) - Full implementation plan
- **Data Model**: [data-model.md](./data-model.md) - Database schema
- **API Contract**: [contracts/medias-api.md](./contracts/medias-api.md) - API endpoints
- **TypeScript Contracts**: [contracts/medias.contracts.ts](./contracts/medias.contracts.ts) - Type definitions
- **Research**: [research.md](./research.md) - Technology decisions

