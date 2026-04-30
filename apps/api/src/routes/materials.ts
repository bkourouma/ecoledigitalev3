import { FastifyInstance, FastifyRequest } from "fastify";
import {
  CourseMaterialSchema,
  CreateCourseMaterialSchema,
  UpdateCourseMaterialSchema,
  MaterialQuerySchema,
  MaterialWithMetadataSchema,
  FileUploadResponseSchema,
  SUPPORTED_FILE_TYPES,
  getFileCategory,
  getMaxFileSize,
  isDocumentType
} from "@ecoledigitale/contracts";
import { getFileStorageService } from "../services/fileStorage";
import { getTextExtractionService } from "../services/textExtraction";
import { getEmbeddingsService } from "../services/embeddings";
import mimeTypes from 'mime-types';

// Extend FastifyRequest to include our custom properties
interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export async function materialsRoutes(fastify: FastifyInstance) {

  const fileStorageService = getFileStorageService();
  const textExtractionService = getTextExtractionService();
  // EmbeddingsService is optional - only used if OPENAI_API_KEY is configured
  const embeddingsService = getEmbeddingsService();

  // POST /api/v1/courses/:courseId/materials - Upload course materials
  fastify.post("/:courseId/materials", {
    schema: {
      params: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { courseId } = request.params as { courseId: string };

      try {
        // First, try to find the course directly
        let actualCourseId = courseId;
        let courseResult = await fastify.pg.query(
          `SELECT id, name FROM courses WHERE id = $1 AND tenant_id = $2`,
          [courseId, request.tenantId]
        );

        // If not found, check if it's a class_course_id and resolve to course_id
        if (courseResult.rows.length === 0) {
          const classCourseResult = await fastify.pg.query(
            `SELECT cc.course_id, c.name
             FROM class_courses cc
             JOIN courses c ON cc.course_id = c.id
             WHERE cc.id = $1 AND cc.tenant_id = $2`,
            [courseId, request.tenantId]
          );

          if (classCourseResult.rows.length === 0) {
            return reply.status(404).send({
              error: "Course Not Found",
              message: "Course not found or access denied",
            });
          }

          actualCourseId = classCourseResult.rows[0].course_id;
          courseResult = { rows: [{ id: actualCourseId, name: classCourseResult.rows[0].name }] };
        }

        // Get multipart data
        const data = await (request as any).file();
        if (!data) {
          return reply.status(400).send({
            error: "No File",
            message: "No file provided in the request",
          });
        }

        // Get additional fields
        const title = data.fields?.title?.value || data.filename || 'Untitled';
        
        // Validate file type
        const mimeType = data.mimetype;
        const supportedTypes = Object.values(SUPPORTED_FILE_TYPES);
        
        if (!supportedTypes.includes(mimeType as any)) {
          return reply.status(400).send({
            error: "Unsupported File Type",
            message: `File type ${mimeType} is not supported`,
          });
        }

        // Validate file size
        const maxSize = getMaxFileSize(mimeType);
        const fileBuffer = await data.toBuffer();
        
        if (fileBuffer.length > maxSize) {
          return reply.status(400).send({
            error: "File Too Large",
            message: `File size exceeds limit of ${Math.round(maxSize / (1024 * 1024))}MB`,
          });
        }

        // Upload to local file storage
        const uploadResult = await fileStorageService.uploadFile(fileBuffer, {
          tenantId: request.tenantId,
          courseId,
          fileName: data.filename,
          contentType: mimeType,
          metadata: {
            uploadedBy: request.user?.id || 'unknown',
            originalTitle: title,
          },
        });

        // Insert material record
        const materialResult = await fastify.pg.query(
          `INSERT INTO course_materials (
            tenant_id, course_id, title, file_name, file_type, file_size,
            minio_key, uploaded_by, processing_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, title, file_name, file_type, file_size, processing_status, created_at`,
          [
            request.tenantId,
            actualCourseId, // Use the resolved course ID
            title,
            data.filename,
            mimeType,
            fileBuffer.length,
            uploadResult.key,
            request.user?.id || '634a57fe-2007-4ecb-ae5b-f9e3152a24fb', // Fallback to admin user for testing
            'pending'
          ]
        );

        const material = materialResult.rows[0];

        // Mark all files as completed for now (disable text extraction temporarily)
        await fastify.pg.query(
          `UPDATE course_materials
           SET processing_status = $1, processed_at = NOW()
           WHERE id = $2`,
          ['completed', material.id]
        );

        const response = {
          id: material.id,
          title: material.title,
          fileName: material.file_name,
          fileType: material.file_type,
          fileSize: material.file_size,
          processingStatus: material.processing_status,
          message: "File uploaded successfully",
        };

        return reply.status(201).send(response);

      } catch (error) {
        fastify.log.error(`Material upload error: ${error}`);
        return reply.status(500).send({
          error: "Upload Failed",
          message: "Failed to upload material",
        });
      }
    },
  });

  // GET /api/v1/courses/:courseId/materials - List course materials
  fastify.get("/:courseId/materials", {
    schema: {
      params: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          fileType: { type: "string" },
          processingStatus: { type: "string", enum: ["pending", "processing", "completed", "failed"] },
          search: { type: "string" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          sortBy: { type: "string", enum: ["createdAt", "title", "fileSize"], default: "createdAt" },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { courseId } = request.params as { courseId: string };
      const query = request.query as any;

      try {
        // First, try to find the course directly
        let actualCourseId = courseId;
        let courseResult = await fastify.pg.query(
          `SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`,
          [courseId, request.tenantId]
        );

        // If not found, check if it's a class_course_id and resolve to course_id
        if (courseResult.rows.length === 0) {
          const classCourseResult = await fastify.pg.query(
            `SELECT cc.course_id
             FROM class_courses cc
             WHERE cc.id = $1 AND cc.tenant_id = $2`,
            [courseId, request.tenantId]
          );

          if (classCourseResult.rows.length === 0) {
            return reply.status(404).send({
              error: "Course Not Found",
              message: "Course not found or access denied",
            });
          }

          actualCourseId = classCourseResult.rows[0].course_id;
        }

        // Build query conditions
        let whereConditions = ["cm.tenant_id = $1", "cm.course_id = $2"];
        let queryParams: any[] = [request.tenantId, actualCourseId];
        let paramIndex = 3;

        if (query.fileType) {
          whereConditions.push(`cm.file_type = $${paramIndex}`);
          queryParams.push(query.fileType);
          paramIndex++;
        }

        if (query.processingStatus) {
          whereConditions.push(`cm.processing_status = $${paramIndex}`);
          queryParams.push(query.processingStatus);
          paramIndex++;
        }

        if (query.search) {
          whereConditions.push(`(cm.title ILIKE $${paramIndex} OR cm.file_name ILIKE $${paramIndex})`);
          queryParams.push(`%${query.search}%`);
          paramIndex++;
        }

        // Calculate pagination
        const page = query.page || 1;
        const limit = query.limit || 20;
        const offset = (page - 1) * limit;

        // Build ORDER BY clause
        const sortBy = query.sortBy || 'createdAt';
        const sortOrder = query.sortOrder || 'desc';

        // Map camelCase to snake_case for database columns
        const sortByMap: Record<string, string> = {
          'createdAt': 'created_at',
          'title': 'title',
          'fileSize': 'file_size'
        };

        const dbSortBy = sortByMap[sortBy] || 'created_at';
        const orderBy = `cm.${dbSortBy} ${sortOrder.toUpperCase()}`;

        // Get materials with metadata
        const materialsQuery = `
          SELECT 
            cm.*,
            u.first_name || ' ' || u.last_name as uploaded_by_name,
            c.name as course_name
          FROM course_materials cm
          LEFT JOIN users u ON cm.uploaded_by = u.id
          LEFT JOIN courses c ON cm.course_id = c.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ${orderBy}
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);

        const materialsResult = await fastify.pg.query(materialsQuery, queryParams);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM course_materials cm
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await fastify.pg.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        // Format materials with additional metadata
        const materials = materialsResult.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          courseId: row.course_id,
          title: row.title,
          fileName: row.file_name,
          fileType: row.file_type,
          fileSize: row.file_size,
          minioKey: row.minio_key,
          contentText: row.content_text,
          embedding: row.embedding,
          uploadedBy: row.uploaded_by,
          uploadedByName: row.uploaded_by_name || 'Unknown',
          courseName: row.course_name,
          processingStatus: row.processing_status,
          processingError: row.processing_error,
          processedAt: row.processed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          canEdit: true, // TODO: Implement proper permission checks
          canDelete: true, // TODO: Implement proper permission checks
        }));

        return reply.send({
          materials,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });

      } catch (error) {
        fastify.log.error(`Materials list error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve materials",
        });
      }
    },
  });

  // GET /api/v1/materials/:materialId - Get material details
  fastify.get("/materials/:materialId", {
    schema: {
      params: {
        type: "object",
        required: ["materialId"],
        properties: {
          materialId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { materialId } = request.params as { materialId: string };

      try {
        const materialResult = await fastify.pg.query(
          `SELECT
            cm.*,
            u.first_name || ' ' || u.last_name as uploaded_by_name,
            c.name as course_name
          FROM course_materials cm
          LEFT JOIN users u ON cm.uploaded_by = u.id
          LEFT JOIN courses c ON cm.course_id = c.id
          WHERE cm.id = $1 AND cm.tenant_id = $2`,
          [materialId, request.tenantId]
        );

        if (materialResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Material Not Found",
            message: "Material not found or access denied",
          });
        }

        const row = materialResult.rows[0];
        const material = {
          id: row.id,
          tenantId: row.tenant_id,
          courseId: row.course_id,
          title: row.title,
          fileName: row.file_name,
          fileType: row.file_type,
          fileSize: row.file_size,
          minioKey: row.minio_key,
          contentText: row.content_text,
          embedding: row.embedding,
          uploadedBy: row.uploaded_by,
          uploadedByName: row.uploaded_by_name || 'Unknown',
          courseName: row.course_name,
          processingStatus: row.processing_status,
          processingError: row.processing_error,
          processedAt: row.processed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          canEdit: true, // TODO: Implement proper permission checks
          canDelete: true, // TODO: Implement proper permission checks
        };

        return reply.send(material);

      } catch (error) {
        fastify.log.error(`Material details error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve material details",
        });
      }
    },
  });

  // GET /api/v1/materials/:materialId/content - Serve file content
  fastify.get("/materials/:materialId/content", {
    schema: {
      params: {
        type: "object",
        required: ["materialId"],
        properties: {
          materialId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          download: { type: "boolean", default: false },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { materialId } = request.params as { materialId: string };
      const { download } = request.query as { download?: boolean };

      try {
        // Get material info
        const materialResult = await fastify.pg.query(
          `SELECT minio_key, file_name, file_type, file_size
           FROM course_materials
           WHERE id = $1 AND tenant_id = $2`,
          [materialId, request.tenantId]
        );

        if (materialResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Material Not Found",
            message: "Material not found or access denied",
          });
        }

        const material = materialResult.rows[0];

        // Check if minio_key exists
        if (!material.minio_key) {
          return reply.status(404).send({
            error: "File Not Found",
            message: "Material file not found in storage",
          });
        }

        // Get file URL from local storage
        let fileUrl: string;
        try {
          fileUrl = fileStorageService.getPublicUrl(
          material.minio_key,
          `${request.protocol}://${request.hostname}/api/v1`
        );
        } catch (urlError: any) {
          fastify.log.error(`Failed to generate file URL: ${urlError}`);
          return reply.status(500).send({
            error: "URL Generation Failed",
            message: "Failed to generate download URL",
          });
        }

        if (download) {
          try {
            // Get file buffer instead of stream for better compatibility
            const fileBuffer = await fileStorageService.getFileBuffer(material.minio_key);
            
            if (!fileBuffer || fileBuffer.length === 0) {
              return reply.status(404).send({
                error: "File Not Found",
                message: "File is empty or does not exist",
              });
            }
            
            // Set proper content type
            const contentType = material.file_type || 'application/octet-stream';
            reply.type(contentType);
            
            // Set Content-Length header
            reply.header('Content-Length', fileBuffer.length.toString());
            
            // Encode filename properly for Content-Disposition header (RFC 5987)
            const encodedFilename = encodeURIComponent(material.file_name);
            reply.header('Content-Disposition', `attachment; filename="${material.file_name}"; filename*=UTF-8''${encodedFilename}`);
            
            // Send buffer directly instead of stream
            return reply.send(fileBuffer);
          } catch (bufferError: any) {
            // CRITICAL FIX: Reset headers if file reading fails
            reply.removeHeader('Content-Type');
            reply.removeHeader('Content-Disposition');
            reply.removeHeader('Content-Length');
            fastify.log.error(`File buffer error: ${bufferError}`);
            return reply.status(500).send({
              error: "File Read Failed",
              message: bufferError?.message || "Failed to read file",
            });
          }
        } else {
          // Return URL for client-side handling
          return reply.send({
            downloadUrl: fileUrl,
            fileName: material.file_name,
            fileType: material.file_type,
            fileSize: material.file_size,
          });
        }

      } catch (error: any) {
        fastify.log.error(`Material content error: ${error}`);
        fastify.log.error(`Error details: ${error?.message || error}`);
        fastify.log.error(`Stack trace: ${error?.stack || 'No stack trace'}`);
        return reply.status(500).send({
          error: "Content Access Failed",
          message: error?.message || "Failed to access material content",
        });
      }
    },
  });

  // DELETE /api/v1/materials/:materialId - Delete material
  fastify.delete("/materials/:materialId", {
    schema: {
      params: {
        type: "object",
        required: ["materialId"],
        properties: {
          materialId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { materialId } = request.params as { materialId: string };

      try {
        // Get material info before deletion
        const materialResult = await fastify.pg.query(
          `SELECT minio_key, file_name FROM course_materials
           WHERE id = $1 AND tenant_id = $2`,
          [materialId, request.tenantId]
        );

        if (materialResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Material Not Found",
            message: "Material not found or access denied",
          });
        }

        const material = materialResult.rows[0];

        // Delete from database first
        await fastify.pg.query(
          `DELETE FROM course_materials WHERE id = $1 AND tenant_id = $2`,
          [materialId, request.tenantId]
        );

        // Delete from local storage only if minio_key exists
        if (material.minio_key) {
        try {
          await fileStorageService.deleteFile(material.minio_key);
        } catch (error) {
          // Log error but don't fail the request
          fastify.log.warn(`Failed to delete file from storage: ${error}`);
          }
        }

        return reply.send({
          message: "Material deleted successfully",
          fileName: material.file_name,
        });

      } catch (error: any) {
        fastify.log.error(`Material deletion error: ${error}`);
        fastify.log.error(`Error details: ${error?.message || error}`);
        fastify.log.error(`Stack trace: ${error?.stack || 'No stack trace'}`);
        return reply.status(500).send({
          error: "Deletion Failed",
          message: error?.message || "Failed to delete material",
        });
      }
    },
  });


}
