# Quick Start Guide: Phase 3 - Gestion des Activités (CORE)

**Feature**: Phase 3 - Gestion des Activités (CORE)  
**Date**: 2025-11-30  
**Status**: Implementation Guide

## Prerequisites

- Phase 1 (Infrastructure et Authentification) must be complete
- Phase 2 (Gestion des Installations) must be complete
- Node.js 18+ and pnpm installed
- PostgreSQL 14+ running
- Existing RSO-PFSO tables from Phases 1 and 2
- ASPCI tenant already created

## Step 1: Database Migration

Run the database migration to create Phase 3 tables:

```bash
# From repository root
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0023_rso_phase3_activites.sql
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0023_rso_phase3_seed.sql
```

**Migration Scripts**:
- `infra/scripts/migrations/0023_rso_phase3_activites.sql` - Creates tables, indexes, and constraints
- `infra/scripts/migrations/0023_rso_phase3_seed.sql` - Seeds activity types (6 root types + 10 sub-types)

**What it creates**:
- `rso_activites` table with full-text search index
- `rso_types_activites` table with hierarchical structure
- `rso_recommandations` table
- `rso_activites_pfso_access` table for permissions
- `rso_activites_medias` table (prepared for Phase 4)
- Foreign key constraints and indexes
- RLS policies for tenant isolation
- Seed data (activity types hierarchy)

## Step 2: Install Dependencies

Install required npm packages for rich text editor, PDF generation, and HTML sanitization:

```bash
# From repository root

# Rich text editor (TinyMCE)
pnpm add @tinymce/tinymce-react

# PDF generation
pnpm add puppeteer
# OR alternative
pnpm add pdfkit @types/pdfkit

# HTML sanitization
pnpm add isomorphic-dompurify
pnpm add -D @types/dompurify

# Image processing (optional, for validation)
pnpm add sharp
```

## Step 3: Backend Implementation

### 3.1 Create Activity Service

Create `apps/api/src/services/rso/activites/activite.service.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { z } from "zod";
import DOMPurify from "isomorphic-dompurify";

export interface CreateActivityParams {
  installationId: number;
  typeActivite: string;
  sousType?: string | null;
  titre: string;
  dateActivite: string;
  // ... other fields
  createdBy: number;
  tenantId: string;
}

export class ActiviteService {
  constructor(private fastify: FastifyInstance) {}

  async create(params: CreateActivityParams) {
    const client = await this.fastify.pg.connect();
    try {
      await client.query("BEGIN");

      // Generate activity code
      const codeActivite = await this.generateCode({
        annee: new Date(params.dateActivite).getFullYear(),
        installationId: params.installationId,
        typeActivite: params.typeActivite,
        sousType: params.sousType,
      });

      // Insert activity
      const result = await client.query(
        `INSERT INTO rso_activites (
          code_activite, titre, annee_id, installation_id, type_activite, sous_type,
          date_activite, duree_minutes, lieu, nombre_participants,
          plateforme_visio, lien_visio, statut, visible_tous_pfso, created_by, tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          codeActivite, params.titre, params.anneeId, params.installationId,
          params.typeActivite, params.sousType, params.dateActivite,
          params.dureeMinutes, params.lieu, params.nombreParticipants,
          params.plateformeVisio, params.lienVisio, "brouillon",
          params.visibleTousPfso || false, params.createdBy, params.tenantId
        ]
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async generateCode(params: {
    annee: number;
    installationId: number;
    typeActivite: string;
    sousType?: string | null;
  }): Promise<string> {
    // Implementation: Query max sequence, increment, format
    // Format: ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN
  }

  async sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'img', 'a', 'blockquote', 'pre', 'code'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style'],
    });
  }
}
```

### 3.2 Create Activity Routes

Create `apps/api/src/routes/rso/activites.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { rsoAuthMiddleware } from "../../plugins/rso-auth-middleware";
import { ActiviteService } from "../../services/rso/activites/activite.service";

const createActivitySchema = z.object({
  installationId: z.number().int().positive(),
  typeActivite: z.string(),
  sousType: z.string().nullable().optional(),
  titre: z.string().min(10).max(255),
  dateActivite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dureeMinutes: z.number().int().positive().nullable().optional(),
  lieu: z.string().max(255).nullable().optional(),
  nombreParticipants: z.number().int().nonnegative().nullable().optional(),
  plateformeVisio: z.enum(['zoom', 'teams', 'meet', 'autre']).nullable().optional(),
  lienVisio: z.string().url().nullable().optional(),
  visibleTousPfso: z.boolean().default(false),
  pfsoAgentsIds: z.array(z.number().int().positive()).default([]),
});

export async function activiteRoutes(fastify: FastifyInstance) {
  const activiteService = new ActiviteService(fastify);

  // Apply authentication middleware
  fastify.addHook('preHandler', rsoAuthMiddleware);

  // Create activity
  fastify.post("/rso/formateur/activites", {
    schema: { body: createActivitySchema },
    handler: async (request: RSOModuleRequest, reply) => {
      const activity = await activiteService.create({
        ...request.body,
        createdBy: request.rsoUser!.id,
        tenantId: request.rsoUser!.tenantId,
      });
      return reply.code(201).send(activity);
    },
  });

  // List activities
  fastify.get("/rso/formateur/activites", {
    handler: async (request: RSOModuleRequest, reply) => {
      const filters = request.query;
      const activities = await activiteService.list({
        userId: request.rsoUser!.id,
        role: request.rsoUser!.role,
        tenantId: request.rsoUser!.tenantId,
        ...filters,
      });
      return activities;
    },
  });

  // Get activity details
  fastify.get("/rso/formateur/activites/:id", {
    handler: async (request: RSOModuleRequest, reply) => {
      const activity = await activiteService.getById(
        parseInt(request.params.id),
        request.rsoUser!.id,
        request.rsoUser!.role,
        request.rsoUser!.tenantId
      );
      if (!activity) {
        return reply.code(404).send({ error: "Activity not found" });
      }
      return activity;
    },
  });

  // Update activity content (draft auto-save)
  fastify.patch("/rso/formateur/activites/:id/draft", {
    handler: async (request: RSOModuleRequest, reply) => {
      const { contenuHtml } = request.body as { contenuHtml: string };
      const sanitized = await activiteService.sanitizeHtml(contenuHtml);
      const activity = await activiteService.updateDraft(
        parseInt(request.params.id),
        sanitized,
        request.rsoUser!.id,
        request.rsoUser!.tenantId
      );
      return activity;
    },
  });

  // Upload image
  fastify.post("/rso/formateur/activites/upload-image", {
    handler: async (request: RSOModuleRequest, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "No file provided" });
      }

      // Validate file
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (data.file.bytesRead > maxSize) {
        return reply.code(400).send({ error: "File too large (max 5MB)" });
      }

      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.code(400).send({ error: "Invalid file type" });
      }

      // Save file and return URL
      const url = await activiteService.uploadImage(
        data,
        request.rsoUser!.tenantId
      );
      return { url, filename: data.filename, size: data.file.bytesRead, mimeType: data.mimetype };
    },
  });
}
```

### 3.3 Create Permission Service

Create `apps/api/src/services/rso/activites/activite-permission.service.ts`:

```typescript
export class ActivitePermissionService {
  async updatePermissions(
    activiteId: number,
    visibleTousPfso: boolean,
    pfsoAgentsIds: number[],
    grantedBy: number,
    tenantId: string
  ) {
    const client = await this.fastify.pg.connect();
    try {
      await client.query("BEGIN");

      // Update visible_tous_pfso flag
      await client.query(
        `UPDATE rso_activites 
         SET visible_tous_pfso = $1 
         WHERE id = $2 AND tenant_id = $3`,
        [visibleTousPfso, activiteId, tenantId]
      );

      // Clear existing individual permissions
      await client.query(
        `DELETE FROM rso_activites_pfso_access 
         WHERE activite_id = $1`,
        [activiteId]
      );

      // Add new individual permissions
      if (!visibleTousPfso && pfsoAgentsIds.length > 0) {
        for (const userId of pfsoAgentsIds) {
          await client.query(
            `INSERT INTO rso_activites_pfso_access 
             (activite_id, user_id, granted_by, tenant_id)
             VALUES ($1, $2, $3, $4)`,
            [activiteId, userId, grantedBy, tenantId]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async checkPermission(
    activiteId: number,
    userId: number,
    userRole: string,
    userInstallationId: number | null,
    tenantId: string
  ): Promise<boolean> {
    // Implementation: Check visible_tous_pfso OR individual permission
  }
}
```

### 3.4 Create Search Service

Create `apps/api/src/services/rso/activites/activite-search.service.ts`:

```typescript
export class ActiviteSearchService {
  async search(params: {
    query: string;
    anneeId?: number;
    installationId?: number;
    typeActivite?: string;
    statut?: string;
    dateDebut?: string;
    dateFin?: string;
    userId: number;
    userRole: string;
    userInstallationId: number | null;
    tenantId: string;
    page: number;
    limit: number;
    sort: string;
  }) {
    const client = await this.fastify.pg.connect();
    try {
      // Build full-text search query with permission filters
      const searchQuery = `
        SELECT 
          a.*,
          i.nom_port as installation_nom,
          MATCH(a.titre, a.contenu_texte) AGAINST(? IN NATURAL LANGUAGE MODE) AS pertinence,
          ts_headline('french', a.contenu_texte, to_tsquery('french', ?)) as extrait
        FROM rso_activites a
        INNER JOIN rso_installations i ON a.installation_id = i.id
        WHERE 
          a.tenant_id = $1
          AND a.deleted_at IS NULL
          AND (
            (a.visible_tous_pfso = true AND a.installation_id = $2)
            OR a.id IN (SELECT activite_id FROM rso_activites_pfso_access WHERE user_id = $3)
            OR a.created_by = $4
            OR $5 = 'admin'
          )
          AND to_tsvector('french', a.titre || ' ' || COALESCE(a.contenu_texte, '')) 
              @@ to_tsquery('french', $6)
        ORDER BY pertinence DESC, a.date_activite DESC
        LIMIT $7 OFFSET $8
      `;

      const result = await client.query(searchQuery, [
        params.tenantId,
        params.userInstallationId,
        params.userId,
        params.userId,
        params.userRole,
        params.query,
        params.limit,
        (params.page - 1) * params.limit,
      ]);

      return result.rows;
    } finally {
      client.release();
    }
  }
}
```

## Step 4: Frontend Implementation

### 4.1 Install TinyMCE

```bash
pnpm add @tinymce/tinymce-react
```

### 4.2 Create Rich Text Editor Component

Create `apps/web/src/components/rso/activites/RichTextEditor.tsx`:

```typescript
import { Editor } from '@tinymce/tinymce-react';
import { useRef } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  onAutoSave?: (content: string) => void;
  activityId?: number;
}

export function RichTextEditor({ value, onChange, onAutoSave, activityId }: RichTextEditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorChange = (content: string) => {
    onChange(content);
  };

  return (
    <Editor
      apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
      onInit={(evt, editor) => {
        editorRef.current = editor;
      }}
      value={value}
      onEditorChange={handleEditorChange}
      init={{
        height: 600,
        language: 'fr_FR',
        plugins: [
          'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
          'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
          'insertdatetime', 'media', 'table', 'help', 'wordcount', 'save',
          'autosave', 'codesample'
        ],
        toolbar: 'undo redo | styles | bold italic underline | alignleft aligncenter alignright | outdent indent | numlist bullist | forecolor backcolor | table | link image media | code fullscreen',
        autosave_interval: '30s',
        autosave_prefix: `rso_activite_draft_${activityId || 'new'}`,
        images_upload_url: '/api/v1/rso/formateur/activites/upload-image',
        images_upload_handler: async (blobInfo, progress) => {
          const formData = new FormData();
          formData.append('file', blobInfo.blob(), blobInfo.filename());

          const response = await fetch('/api/v1/rso/formateur/activites/upload-image', {
            method: 'POST',
            body: formData,
            headers: {
              'Authorization': `Bearer ${getRSOToken()}`,
            },
          });

          const data = await response.json();
          return data.url;
        },
        setup: (editor) => {
          // Custom button for Google Maps
          editor.ui.registry.addButton('insertmap', {
            text: '🗺️ Carte',
            onAction: () => {
              // Open Google Maps modal
            },
          });
        },
      }}
    />
  );
}
```

### 4.3 Create Activity Form Page

Create `apps/web/src/app/rso/formateur/activites/creer/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { RichTextEditor } from '@/components/rso/activites/RichTextEditor';
import { createActivity } from '@/lib/rso/activites';

export default function CreerActivitePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    installationId: '',
    typeActivite: '',
    sousType: '',
    titre: '',
    dateActivite: '',
    // ... other fields
  });
  const [contenuHtml, setContenuHtml] = useState('');

  const createMutation = useMutation({
    mutationFn: createActivity,
    onSuccess: (data) => {
      router.push(`/rso/formateur/activites/${data.id}`);
    },
  });

  const handleSubmit = async () => {
    await createMutation.mutateAsync({
      ...formData,
      contenuHtml,
    });
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Créer une nouvelle activité</h1>
      
      {step === 1 && (
        <ActivityFormStep1 
          formData={formData}
          setFormData={setFormData}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <div>
          <RichTextEditor
            value={contenuHtml}
            onChange={setContenuHtml}
            activityId={createMutation.data?.id}
          />
          <button onClick={handleSubmit}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}
```

## Step 5: Testing

### 5.1 Test Activity Creation

```bash
# Start development servers
pnpm dev:api
pnpm dev:web

# Test via API
curl -X POST http://localhost:8011/api/v1/rso/formateur/activites \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant: aspci" \
  -H "Content-Type: application/json" \
  -d '{
    "installationId": 1,
    "typeActivite": "ENTRAINEMENT",
    "sousType": "T1",
    "titre": "Test Activity",
    "dateActivite": "2024-03-15"
  }'
```

### 5.2 Test Rich Text Editor

1. Navigate to `/rso/formateur/activites/creer`
2. Fill in activity form
3. Test rich text editor:
   - Format text (bold, italic, headings)
   - Insert table
   - Upload image
   - Insert video (YouTube URL)
   - Insert Google Maps
   - Create image gallery

### 5.3 Test Permissions

1. Create activity with `visibleTousPfso: true`
2. Verify PFSO agent can see it
3. Update permissions to individual agents only
4. Verify only selected agents can see it

## Step 6: Environment Variables

Add to `.env` files:

```bash
# TinyMCE API Key (get from https://www.tiny.cloud/)
NEXT_PUBLIC_TINYMCE_API_KEY=your_api_key_here

# Google Maps API Key (for map insertion)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key_here

# File upload settings
MAX_FILE_SIZE=5242880  # 5MB in bytes
UPLOAD_DIR=uploads/aspci/activites
```

## Next Steps

1. Implement recommendation management endpoints
2. Implement PDF export functionality
3. Implement advanced search UI
4. Add activity list with filters
5. Add permission management UI
6. Test all user flows end-to-end

## Troubleshooting

**Issue**: TinyMCE not loading
- Check API key is set in environment variables
- Verify network requests in browser console

**Issue**: Images not uploading
- Check file size limits (max 5MB)
- Verify file type is allowed
- Check server logs for errors

**Issue**: Full-text search not working
- Verify GIN index was created
- Check PostgreSQL full-text search is enabled
- Verify `contenu_texte` column is populated

**Issue**: Permissions not working
- Verify RLS policies are active
- Check permission queries include tenant_id
- Verify user roles are correct

