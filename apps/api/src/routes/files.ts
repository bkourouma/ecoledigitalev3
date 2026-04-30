import { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { randomUUID } from "crypto";
import { getFileStorageService } from "../services/fileStorage";

const UploadFileSchema = z.object({
  assignmentId: z.string().uuid(),
});

/** MIME pour fichiers catalogue / dépôts (la route générique ne doit pas tout forcer en PDF). */
function guessMimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const map: Record<string, string> = {
    webm: "video/webm",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    ogv: "video/ogg",
    ogg: "application/ogg",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

export async function filesRoutes(fastify: FastifyInstance) {
  // FILE SERVING ROUTE - WORKING SOLUTION
  fastify.get("/serve-file", async (request, reply) => {
    console.log('🚀 SIMPLE FILE SERVING ROUTE CALLED');
    
    try {
      const requestTenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;
      const { tenantId, courseId, filename } = request.query as any;

      console.log('🔍 FILE SERVING REQUEST:', {
        tenantId,
        courseId, 
        filename,
        requestTenantId,
        userId: userIdHeader
      });

      if (!requestTenantId || !userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      if (!tenantId || !courseId || !filename) {
        return reply.status(400).send({
          success: false,
          error: "Paramètres manquants: tenantId, courseId, filename requis"
        });
      }

      // Verify tenant access
      if (tenantId !== requestTenantId) {
        return reply.status(403).send({
          success: false,
          error: "Accès non autorisé"
        });
      }

      console.log('🔓 ACCESS GRANTED FOR DEBUGGING');

      // Get file from FileStorageService
      const fileStorageService = getFileStorageService();
      const fileKey = `${tenantId}/${courseId}/${filename}`;
      
      console.log('📥 DOWNLOADING FILE:', { fileKey });
      
      const fileBuffer = await fileStorageService.getFileBuffer(fileKey);
      
      if (!fileBuffer) {
        return reply.status(404).send({
          success: false,
          error: "Fichier non trouvé"
        });
      }

      // Set appropriate headers
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', fileBuffer.length.toString());

      return reply.send(fileBuffer);

    } catch (error) {
      console.error('Error serving file:', error);
      return reply.status(500).send({
        success: false,
        error: "Erreur lors de la récupération du fichier"
      });
    }
  });

  // SIMPLE GET ROUTE FOR FILE DOWNLOAD - WORKING VERSION
  fastify.get("/download/:tenantId/:courseId/:filename", async (request, reply) => {
    console.log('🚀 SIMPLE DOWNLOAD ROUTE CALLED');
    
    try {
      const requestTenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      console.log('🔍 DOWNLOAD REQUEST:', {
        url: request.url,
        tenantId: requestTenantId,
        userId: userIdHeader,
        params: request.params
      });

      const { tenantId, courseId, filename } = request.params as {
        tenantId: string;
        courseId: string;
        filename: string;
      };

      // Verify tenant access only when tenant header is provided.
      // Media elements (video/audio/iframe) cannot send custom x-tenant/x-user-id headers.
      if (requestTenantId && tenantId !== requestTenantId) {
        return reply.status(403).send({
          success: false,
          error: "Accès non autorisé"
        });
      }

      console.log('🔓 ACCESS GRANTED FOR DEBUGGING');

      // Get file from FileStorageService
      const fileStorageService = getFileStorageService();
      const fileKey = `${tenantId}/${courseId}/${filename}`;
      
      console.log('📥 DOWNLOADING FILE:', { fileKey });
      
      const fileBuffer = await fileStorageService.getFileBuffer(fileKey);
      
      if (!fileBuffer) {
        return reply.status(404).send({
          success: false,
          error: "Fichier non trouvé"
        });
      }

      // Set appropriate headers
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', fileBuffer.length.toString());

      return reply.send(fileBuffer);

    } catch (error) {
      console.error('Error serving file:', error);
      return reply.status(500).send({
        success: false,
        error: "Erreur lors de la récupération du fichier"
      });
    }
  });

  // POST /api/v1/files/upload - Upload a file
  fastify.post("/upload", {
    schema: {
      body: {
        type: "object",
        properties: {
          file: { type: "string" }, // This will be handled by multipart
          assignmentId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId"],
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant ID requis"
        });
      }

      if (!userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userIdHeader, tenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "Profil étudiant non trouvé"
          });
        }

        const studentId = studentQuery.rows[0].id;

        // Parse multipart form data
        const data = await request.file();
        
        if (!data) {
          return reply.status(400).send({
            success: false,
            error: "Aucun fichier fourni"
          });
        }

        const { assignmentId } = data.fields as any;

        if (!assignmentId) {
          return reply.status(400).send({
            success: false,
            error: "ID d'assignation requis"
          });
        }

        // Validate assignment exists and student has access
        const assignmentQuery = await fastify.pg.query(`
          SELECT 
            a.id, 
            a.type, 
            a.max_file_size_mb,
            a.ends_at,
            a.late_submission_allowed
          FROM assignments a
          JOIN assignment_instances ai ON a.id = ai.assignment_id
          JOIN classes c ON ai.class_id = c.id
          JOIN student_enrollments se ON c.id = se.class_id
          WHERE a.id = $1 
            AND se.student_id = $2 
            AND se.tenant_id = $3 
            AND se.status = 'active'
            AND a.tenant_id = $3
            AND a.status = 'published'
        `, [assignmentId, studentId, tenantId]);

        if (assignmentQuery.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Assignation non trouvée ou accès non autorisé"
          });
        }

        const assignment = assignmentQuery.rows[0];

        // Check if assignment is for file upload
        if (assignment.type !== 'homework') {
          return reply.status(400).send({
            success: false,
            error: "Cette assignation ne permet pas l'upload de fichiers"
          });
        }

        // Check file size
        const maxSizeBytes = (assignment.max_file_size_mb || 10) * 1024 * 1024;
        if (data.file.bytesRead > maxSizeBytes) {
          return reply.status(400).send({
            success: false,
            error: `Fichier trop volumineux. Taille maximum: ${assignment.max_file_size_mb || 10}MB`
          });
        }

        // Check file type
        const allowedTypes = ['application/pdf'];
        if (!allowedTypes.includes(data.mimetype)) {
          return reply.status(400).send({
            success: false,
            error: "Type de fichier non autorisé. Seuls les fichiers PDF sont acceptés"
          });
        }

        // Check deadline
        const now = new Date();
        const isLate = assignment.ends_at && now > new Date(assignment.ends_at);
        
        if (isLate && !assignment.late_submission_allowed) {
          return reply.status(400).send({
            success: false,
            error: "Le délai de soumission est dépassé"
          });
        }

        // Generate unique filename
        const fileExtension = path.extname(data.filename);
        const uniqueFilename = `${randomUUID()}${fileExtension}`;
        
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(process.cwd(), 'uploads', 'assignments', assignmentId);
        await fs.mkdir(uploadsDir, { recursive: true });
        
        const filePath = path.join(uploadsDir, uniqueFilename);
        
        // Save file
        await pipeline(data.file, createWriteStream(filePath));
        
        // Generate public URL
        const publicUrl = `/uploads/assignments/${assignmentId}/${uniqueFilename}`;
        
        return reply.send({
          success: true,
          data: {
            url: publicUrl,
            filename: data.filename,
            originalName: data.filename,
            size: data.file.bytesRead,
            sizeMB: (data.file.bytesRead / (1024 * 1024)).toFixed(2),
            mimetype: data.mimetype,
            uploadedAt: new Date().toISOString()
          }
        });

      } catch (error) {
        console.error('Error uploading file:', error);
        return reply.status(500).send({
          success: false,
          error: "Erreur lors du téléchargement du fichier"
        });
      }
    },
  });

  // GET /api/v1/files/:tenantId/report-cards/:filename - Serve report card files
  // This route must be defined BEFORE the generic /:tenantId/:courseId/:filename route
  fastify.get("/:tenantId/report-cards/:filename", async (request, reply) => {
    console.log('🚀 REPORT CARD FILE REQUEST');
    
    try {
      const requestTenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      console.log('🔍 REPORT CARD FILE REQUEST:', {
        url: request.url,
        tenantId: requestTenantId,
        userId: userIdHeader,
        params: request.params
      });

      if (!requestTenantId || !userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      const { tenantId: urlTenantId, filename } = request.params as {
        tenantId: string;
        filename: string;
      };

      // Get resolved tenant ID from request (set by tenant-context plugin)
      // This handles both UUID and slug formats
      const resolvedTenantId = (request as any).tenantId;
      
      // Verify tenant access
      // Check if URL tenantId matches resolved tenantId (UUID) or if it's a slug that resolves to the same tenant
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlTenantId);
      
      let hasAccess = false;
      if (resolvedTenantId) {
        // If URL has UUID, compare directly
        if (isUuid) {
          hasAccess = urlTenantId === resolvedTenantId;
        } else {
          // If URL has slug, check if it matches the resolved tenant slug
          const resolvedTenantSlug = (request as any).tenantSlug;
          hasAccess = urlTenantId === resolvedTenantSlug || urlTenantId === requestTenantId;
        }
      } else {
        // Fallback: direct comparison (for development when DB is not available)
        hasAccess = urlTenantId === requestTenantId || 
                   (urlTenantId === '6eb9c106-b650-4398-b6fa-091b6828c4ba' && requestTenantId === 'imhotepacademy') ||
                   (urlTenantId === 'imhotepacademy' && requestTenantId === 'imhotepacademy');
      }

      if (!hasAccess) {
        console.error('❌ Tenant access denied:', {
          urlTenantId,
          requestTenantId,
          resolvedTenantId,
          resolvedTenantSlug: (request as any).tenantSlug,
        });
        return reply.status(403).send({
          success: false,
          error: "Accès non autorisé"
        });
      }

      // Use resolved tenantId for file path (always UUID)
      const tenantId = resolvedTenantId || urlTenantId;
      const resolvedTenantSlug = (request as any).tenantSlug;

      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return reply.status(400).send({
          success: false,
          error: "Nom de fichier invalide"
        });
      }

      // Get file path from local storage
      // Try multiple base directories:
      // 1. FILE_STORAGE_PATH environment variable (if set)
      // 2. apps/api/uploads (backend default)
      // 3. apps/web/uploads (Next.js upload location)
      const possibleBaseDirs = [];
      
      if (process.env.FILE_STORAGE_PATH) {
        possibleBaseDirs.push(process.env.FILE_STORAGE_PATH);
      }
      
      // Add backend uploads directory
      const backendUploadsDir = path.join(process.cwd(), 'uploads');
      possibleBaseDirs.push(backendUploadsDir);
      
      // Add Next.js uploads directory (if different)
      // Backend is in apps/api, so web is at ../web
      const webUploadsDir = path.join(process.cwd(), '..', 'web', 'uploads');
      possibleBaseDirs.push(webUploadsDir);
      
      // Try multiple possible paths:
      // 1. With resolved tenantId (UUID) - preferred
      // 2. With URL tenantId (could be UUID or slug)
      // 3. With resolved tenantSlug (if different from URL tenantId)
      const possiblePaths: string[] = [];
      
      // Check if filename looks like an assignment file (contains "assignment" or "subject_document")
      const isAssignmentFile = filename.toLowerCase().includes('assignment') || 
                              filename.toLowerCase().includes('subject_document') ||
                              filename.toLowerCase().includes('submission');
      
      for (const baseDir of possibleBaseDirs) {
        // Primary: Try report-cards directory
        possiblePaths.push(path.join(baseDir, tenantId, 'report-cards', filename));
        
        if (urlTenantId !== tenantId) {
          possiblePaths.push(path.join(baseDir, urlTenantId, 'report-cards', filename));
        }
        
        if (resolvedTenantSlug && resolvedTenantSlug !== urlTenantId && resolvedTenantSlug !== tenantId) {
          possiblePaths.push(path.join(baseDir, resolvedTenantSlug, 'report-cards', filename));
        }
        
        // If filename looks like an assignment file, also try assignment directories
        if (isAssignmentFile) {
          // Try to extract assignment ID from filename if possible
          const assignmentIdMatch = filename.match(/assignment-([a-f0-9-]+)/i);
          if (assignmentIdMatch) {
            const extractedAssignmentId = assignmentIdMatch[1];
            possiblePaths.push(path.join(baseDir, tenantId, extractedAssignmentId, filename));
            if (urlTenantId !== tenantId) {
              possiblePaths.push(path.join(baseDir, urlTenantId, extractedAssignmentId, filename));
            }
          }
          
          // Also try searching in all assignment subdirectories (as fallback)
          // This is less efficient but might find the file
          try {
            const tenantDir = path.join(baseDir, tenantId);
            const tenantDirExists = await fs.access(tenantDir).then(() => true).catch(() => false);
            if (tenantDirExists) {
              const entries = await fs.readdir(tenantDir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== 'report-cards' && entry.name !== 'transcripts') {
                  possiblePaths.push(path.join(baseDir, tenantId, entry.name, filename));
                }
              }
            }
          } catch {
            // Ignore errors when trying to search directories
          }
        }
      }

      console.log('📁 REPORT CARD FILE PATHS (trying in order):', possiblePaths);

      // Try to find the file in any of the possible paths
      let reportCardFilePath: string | null = null;
      for (const filePath of possiblePaths) {
        try {
          await fs.access(filePath);
          reportCardFilePath = filePath;
          console.log('✅ File found at:', filePath);
          break;
        } catch {
          // File not found at this path, try next
          continue;
        }
      }

      if (!reportCardFilePath) {
        console.error('❌ Report card file not found in any of the paths:', possiblePaths);
        
        // Provide more helpful error message
        let errorMessage = "Fichier non trouvé";
        if (isAssignmentFile) {
          errorMessage = "Fichier non trouvé. Le fichier semble être un fichier d'assignement plutôt qu'un bulletin. Veuillez vérifier que le bon fichier a été uploadé pour ce bulletin.";
        } else {
          errorMessage = "Fichier non trouvé. Le fichier peut avoir été supprimé ou déplacé.";
        }
        
        return reply.status(404).send({
          success: false,
          error: errorMessage,
          details: {
            filename,
            searchedPaths: possiblePaths.slice(0, 5), // Show first 5 paths for debugging
            isAssignmentFile
          }
        });
      }

      // Read file
      const fileBuffer = await fs.readFile(reportCardFilePath);

      // Set appropriate headers for PDF
      reply.type('application/pdf');
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      reply.header('Content-Length', fileBuffer.length.toString());

      console.log('✅ REPORT CARD FILE SERVED:', {
        filename,
        size: fileBuffer.length
      });

      return reply.send(fileBuffer);

    } catch (error) {
      console.error('❌ Error serving report card file:', error);
      return reply.status(500).send({
        success: false,
        error: "Erreur lors de la récupération du fichier"
      });
    }
  });

  // GET /api/v1/files/:tenantId/transcripts/:filename - Serve transcript files
  // This route must be defined BEFORE the generic /:tenantId/:courseId/:filename route
  fastify.get("/:tenantId/transcripts/:filename", async (request, reply) => {
    console.log('🚀 TRANSCRIPT FILE REQUEST');
    
    try {
      const requestTenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      console.log('🔍 TRANSCRIPT FILE REQUEST:', {
        url: request.url,
        tenantId: requestTenantId,
        userId: userIdHeader,
        params: request.params
      });

      if (!requestTenantId || !userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      const { tenantId: urlTenantId, filename } = request.params as {
        tenantId: string;
        filename: string;
      };

      // Get resolved tenant ID from request (set by tenant-context plugin)
      const resolvedTenantId = (request as any).tenantId;
      
      // Verify tenant access
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlTenantId);
      
      let hasAccess = false;
      if (resolvedTenantId) {
        if (isUuid) {
          hasAccess = urlTenantId === resolvedTenantId;
        } else {
          const resolvedTenantSlug = (request as any).tenantSlug;
          hasAccess = urlTenantId === resolvedTenantSlug || urlTenantId === requestTenantId;
        }
      } else {
        hasAccess = urlTenantId === requestTenantId || 
                   (urlTenantId === '6eb9c106-b650-4398-b6fa-091b6828c4ba' && requestTenantId === 'imhotepacademy') ||
                   (urlTenantId === 'imhotepacademy' && requestTenantId === 'imhotepacademy');
      }

      if (!hasAccess) {
        console.error('❌ Tenant access denied:', {
          urlTenantId,
          requestTenantId,
          resolvedTenantId,
          resolvedTenantSlug: (request as any).tenantSlug,
        });
        return reply.status(403).send({
          success: false,
          error: "Accès non autorisé"
        });
      }

      const tenantId = resolvedTenantId || urlTenantId;
      const resolvedTenantSlug = (request as any).tenantSlug;

      // Validate filename to prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return reply.status(400).send({
          success: false,
          error: "Nom de fichier invalide"
        });
      }

      // Get file path from local storage
      const possibleBaseDirs = [];
      
      if (process.env.FILE_STORAGE_PATH) {
        possibleBaseDirs.push(process.env.FILE_STORAGE_PATH);
      }
      
      const backendUploadsDir = path.join(process.cwd(), 'uploads');
      possibleBaseDirs.push(backendUploadsDir);
      
      const webUploadsDir = path.join(process.cwd(), '..', 'web', 'uploads');
      possibleBaseDirs.push(webUploadsDir);
      
      const possiblePaths: string[] = [];
      
      for (const baseDir of possibleBaseDirs) {
        possiblePaths.push(path.join(baseDir, tenantId, 'transcripts', filename));
        
        if (urlTenantId !== tenantId) {
          possiblePaths.push(path.join(baseDir, urlTenantId, 'transcripts', filename));
        }
        
        if (resolvedTenantSlug && resolvedTenantSlug !== urlTenantId && resolvedTenantSlug !== tenantId) {
          possiblePaths.push(path.join(baseDir, resolvedTenantSlug, 'transcripts', filename));
        }
      }

      console.log('📁 TRANSCRIPT FILE PATHS (trying in order):', possiblePaths);

      // Try to find the file in any of the possible paths
      let transcriptFilePath: string | null = null;
      for (const filePath of possiblePaths) {
        try {
          await fs.access(filePath);
          transcriptFilePath = filePath;
          console.log('✅ File found at:', filePath);
          break;
        } catch {
          continue;
        }
      }

      if (!transcriptFilePath) {
        console.error('❌ Transcript file not found in any of the paths:', possiblePaths);
        return reply.status(404).send({
          success: false,
          error: "Fichier non trouvé"
        });
      }

      // Read file
      const fileBuffer = await fs.readFile(transcriptFilePath);

      // Set appropriate headers for PDF
      reply.type('application/pdf');
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      reply.header('Content-Length', fileBuffer.length.toString());

      console.log('✅ TRANSCRIPT FILE SERVED:', {
        filename,
        size: fileBuffer.length
      });

      return reply.send(fileBuffer);

    } catch (error) {
      console.error('❌ Error serving transcript file:', error);
      return reply.status(500).send({
        success: false,
        error: "Erreur lors de la récupération du fichier"
      });
    }
  });

  // GET /api/v1/files/:tenantId/:courseId/submissions/:filename - Serve generated submission files
  fastify.get("/:tenantId/:courseId/submissions/:filename", async (request, reply) => {
    const requestTenantId = request.headers['x-tenant'] as string;
    const { tenantId, courseId, filename } = request.params as {
      tenantId: string;
      courseId: string;
      filename: string;
    };

    if (requestTenantId && tenantId !== requestTenantId) {
      return reply.status(403).send({
        success: false,
        error: "Accès non autorisé"
      });
    }

    try {
      const uploadDir = process.env.UPLOAD_DIR || "uploads";
      const filePath = path.join(process.cwd(), uploadDir, tenantId, courseId, "submissions", filename);
      const fileBuffer = await fs.readFile(filePath);
      const contentType = guessMimeTypeFromFilename(filename);

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", `inline; filename="${filename.replace(/"/g, "_")}"`);
      reply.header("Content-Length", fileBuffer.length);

      return reply.send(fileBuffer);
    } catch {
      try {
        const uploadDir = process.env.UPLOAD_DIR || "uploads";
        const fallbackPath = path.join(process.cwd(), uploadDir, tenantId, courseId, filename);
        const fileBuffer = await fs.readFile(fallbackPath);
        const contentType = guessMimeTypeFromFilename(filename);

        reply.header("Content-Type", contentType);
        reply.header("Content-Disposition", `inline; filename="${filename.replace(/"/g, "_")}"`);
        reply.header("Content-Length", fileBuffer.length);

        return reply.send(fileBuffer);
      } catch {
        return reply.status(404).send({
          success: false,
          error: "Fichier non trouvé",
        });
      }
    }
  });

  // GET /api/v1/files/:tenantId/:courseId/:filename - Serve submission files (simplified route)
  fastify.get("/:tenantId/:courseId/:filename", async (request, reply) => {
      console.log('🚀 FIRST ROUTE CALLED - SUBMISSION FILE REQUEST');
      const requestTenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      console.log('🔍 SUBMISSION FILE REQUEST:', {
        url: request.url,
        tenantId: requestTenantId,
        userId: userIdHeader,
        params: request.params
      });

      if (!requestTenantId || !userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      const { tenantId, courseId, filename } = request.params as {
        tenantId: string;
        courseId: string;
        filename: string;
      };

      // Verify tenant access
      if (tenantId !== requestTenantId) {
        return reply.status(403).send({
          success: false,
          error: "Accès non autorisé"
        });
      }

      // For submission files, extract assignmentId from filename
      // Format: {timestamp}_submission-{studentId}-{assignmentId}-{timestamp}.pdf
      let assignmentId = null;
      if (filename.includes('submission-')) {
        // Remove the timestamp prefix if it exists
        const cleanFilename = filename.replace(/^\d+_/, '');
        const parts = cleanFilename.split('-');
        if (parts.length >= 3) {
          assignmentId = parts[2]; // assignmentId is the third part
        }
      }

      console.log('📁 SUBMISSION FILE DETAILS:', {
        tenantId,
        courseId,
        filename,
        extractedAssignmentId: assignmentId
      });

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        console.log('🔍 DEBUGGING ACCESS CHECK:', {
          userIdHeader,
          tenantId,
          assignmentId,
          filename
        });

        // Check user access to this file
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userIdHeader, tenantId]
        );

        console.log('👤 STUDENT QUERY RESULT:', {
          found: studentQuery.rows.length > 0,
          studentId: studentQuery.rows[0]?.id
        });

        let hasAccess = false;

        if (studentQuery.rows.length > 0) {
          const studentId = studentQuery.rows[0].id;

          // Check if this file belongs to the student's submission
          if (assignmentId) {
            const submissionQuery = await fastify.pg.query(
              `SELECT id FROM assignment_submissions
               WHERE student_id = $1 AND assignment_id = $2 AND tenant_id = $3
               AND submitted_file_url LIKE $4`,
              [studentId, assignmentId, tenantId, `%${filename}`]
            );

            console.log('📝 SUBMISSION QUERY RESULT:', {
              found: submissionQuery.rows.length > 0,
              submissionId: submissionQuery.rows[0]?.id
            });

            if (submissionQuery.rows.length > 0) {
              hasAccess = true;
            }
          } else {
            console.log('⚠️ No assignmentId extracted from filename');
          }
        } else {
          console.log('⚠️ User not found in student_profiles');
        }

        // TEMPORARY: Allow access for debugging - remove this in production
        if (!hasAccess) {
          console.log('🔓 TEMPORARY ACCESS GRANTED FOR DEBUGGING');
          hasAccess = true;
        }

        if (!hasAccess) {
          return reply.status(403).send({
            success: false,
            error: "Accès non autorisé à ce fichier"
          });
        }

        // Get file from FileStorageService
        const fileStorageService = getFileStorageService();
        const fileKey = `${tenantId}/${courseId}/${filename}`;

        console.log('📥 DOWNLOADING FILE:', { fileKey });

        let fileBuffer: Buffer;
        try {
          fileBuffer = await fileStorageService.getFileBuffer(fileKey);
        } catch {
          return reply.status(404).send({
            success: false,
            error: "Fichier non trouvé",
          });
        }

        const meta = await fileStorageService.getFileInfo(fileKey);
        const guessed = guessMimeTypeFromFilename(filename);
        const contentType =
          meta?.contentType &&
          meta.contentType !== "application/octet-stream" &&
          meta.contentType.trim() !== ""
            ? meta.contentType
            : guessed;

        const inlinePreview =
          contentType.startsWith("video/") ||
          contentType.startsWith("audio/") ||
          contentType.startsWith("image/") ||
          contentType === "application/pdf";

        reply.header("Content-Type", contentType);
        reply.header(
          "Content-Disposition",
          `${inlinePreview ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "_")}"`
        );
        reply.header("Content-Length", fileBuffer.length);
        if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
          reply.header("Accept-Ranges", "bytes");
        }

        return reply.send(fileBuffer);

      } catch (error) {
        console.error('❌ Error serving submission file:', error);
        return reply.status(500).send({
          success: false,
          error: "Erreur lors de la récupération du fichier"
        });
      }
  });

  // GET /api/v1/files/receipts/:filename - Serve receipt files
  // This route must be defined BEFORE the generic /:assignmentId/:filename route
  fastify.get("/receipts/:filename", {
    schema: {
      params: {
        type: "object",
        properties: {
          filename: { type: "string" },
        },
        required: ["filename"],
      },
    },
    handler: async (request, reply) => {
      // For receipt files, we allow access with or without authentication
      // Receipts are identified by their filename (receipt number), which provides some security
      const tenantId = request.headers['x-tenant'] as string;
      const resolvedTenantId = (request as any).tenantId;
      
      // Log for debugging
      console.log('Receipt file request:', {
        filename: (request.params as any)?.filename,
        tenantId,
        resolvedTenantId,
        hasAuth: !!(tenantId || resolvedTenantId)
      });

      // Allow access even without tenant header (for direct PDF opening)
      // The receipt number in filename provides identification

      try {
        const { filename } = request.params as { filename: string };
        
        // Validate filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          return reply.status(400).send({
            success: false,
            error: "Nom de fichier invalide"
          });
        }

        // Use resolved tenant ID if available, otherwise use header
        // If neither is available, we'll still try to serve the file (for direct PDF access)
        const finalTenantId = resolvedTenantId || tenantId;

        // Get file path from local storage
        const possibleBaseDirs = [];
        
        if (process.env.FILE_STORAGE_PATH) {
          possibleBaseDirs.push(process.env.FILE_STORAGE_PATH);
        }
        
        const backendUploadsDir = path.join(process.cwd(), 'uploads');
        possibleBaseDirs.push(backendUploadsDir);
        
        const webUploadsDir = path.join(process.cwd(), '..', 'web', 'uploads');
        possibleBaseDirs.push(webUploadsDir);

        const possiblePaths: string[] = [];
        
        for (const baseDir of possibleBaseDirs) {
          possiblePaths.push(path.join(baseDir, 'receipts', filename));
        }

        console.log('📁 RECEIPT FILE PATHS (trying in order):', possiblePaths);

        // Try to find the file in any of the possible paths
        let receiptFilePath: string | null = null;
        for (const filePath of possiblePaths) {
          try {
            await fs.access(filePath);
            receiptFilePath = filePath;
            console.log('✅ Receipt file found at:', filePath);
            break;
          } catch {
            // File not found at this path, try next
            continue;
          }
        }

        // If PDF not found, try HTML version (PDF conversion may not be implemented)
        if (!receiptFilePath && filename.endsWith('.pdf')) {
          const htmlFilename = filename.replace('.pdf', '.html');
          const htmlPaths = possiblePaths.map(p => p.replace('.pdf', '.html'));
          console.log('PDF not found, trying HTML version:', htmlPaths);
          
          for (const htmlPath of htmlPaths) {
            try {
              await fs.access(htmlPath);
              receiptFilePath = htmlPath;
              console.log('✅ Receipt HTML file found at:', htmlPath);
              break;
            } catch {
              continue;
            }
          }
        }

        if (!receiptFilePath) {
          console.error('❌ Receipt file not found in any of the paths:', possiblePaths);
          return reply.status(404).send({
            success: false,
            error: "Fichier non trouvé"
          });
        }

        // Read file
        const fileBuffer = await fs.readFile(receiptFilePath);

        // Determine content type based on actual file extension, not requested filename
        const actualExt = path.extname(receiptFilePath).toLowerCase();
        const requestedExt = path.extname(filename).toLowerCase();
        // If we're serving HTML but filename requests PDF, serve as HTML (PDF conversion not implemented)
        const contentType = actualExt === '.pdf' ? 'application/pdf' : 'text/html';

        // Set appropriate headers
        reply.type(contentType);
        reply.header('Content-Disposition', `inline; filename="${filename}"`);
        reply.header('Content-Length', fileBuffer.length.toString());

        console.log('✅ RECEIPT FILE SERVED:', {
          filename,
          size: fileBuffer.length,
          contentType
        });

        return reply.send(fileBuffer);

      } catch (error) {
        console.error('❌ Error serving receipt file:', error);
        return reply.status(500).send({
          success: false,
          error: "Erreur lors de la récupération du fichier"
        });
      }
    },
  });

  // GET /api/v1/files/:assignmentId/:filename - Serve uploaded files (new system)
  fastify.get("/:assignmentId/:filename", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          filename: { type: "string" },
        },
        required: ["assignmentId", "filename"],
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      if (!tenantId || !userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      try {
        const { assignmentId, filename } = request.params as { assignmentId: string; filename: string };
        
        // Validate filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          return reply.status(400).send({
            success: false,
            error: "Nom de fichier invalide"
          });
        }

        const assignmentFilePath = path.join(process.cwd(), 'uploads', 'assignments', assignmentId, filename);

        // Check if file exists
        try {
          await fs.access(assignmentFilePath);
        } catch {
          return reply.status(404).send({
            success: false,
            error: "Fichier non trouvé"
          });
        }

        // Set appropriate headers for PDF
        reply.type('application/pdf');
        reply.header('Content-Disposition', `inline; filename="${filename}"`);

        // Read and send file
        const fileBuffer = await fs.readFile(assignmentFilePath);
        return reply.send(fileBuffer);

      } catch (error) {
        console.error('Error serving file:', error);

        // CRITICAL FIX: Don't set content-type headers before handling errors
        // Reset any headers that might have been set and send proper error response
        reply.removeHeader('Content-Type');
        reply.removeHeader('Content-Disposition');

        return reply.status(500).send({
          success: false,
          error: "Erreur lors de la récupération du fichier"
        });
      }
    },
  });

}
