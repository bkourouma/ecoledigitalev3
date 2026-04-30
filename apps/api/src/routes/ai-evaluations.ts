import { FastifyInstance } from "fastify";
import { getTextExtractionService } from "../services/textExtraction";
import { getAIEvaluationService } from "../services/ai-evaluation.service";
import { getFileStorageService } from "../services/fileStorage";

export async function aiEvaluationsRoutes(fastify: FastifyInstance) {
  
  // GET /api/v1/ai-evaluations/courses/:courseId/documents - Get available documents for a course
  fastify.get("/courses/:courseId/documents", {
    schema: {
      params: {
        type: "object",
        properties: {
          courseId: { type: "string", format: "uuid" },
        },
        required: ["courseId"],
      },
    },
    handler: async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Get course materials that are PDFs and successfully processed
        const result = await fastify.pg.query(
          `SELECT id, title, file_name, file_type, file_size, created_at
           FROM course_materials 
           WHERE tenant_id = $1 AND course_id = $2 
           AND file_type = 'application/pdf' 
           AND processing_status = 'completed'
           ORDER BY created_at DESC`,
          [tenantId, courseId]
        );

        const documents = result.rows.map(row => ({
          id: row.id,
          title: row.title,
          file_name: row.file_name,
          file_type: row.file_type,
          file_size: row.file_size,
          created_at: new Date(row.created_at),
        }));

        reply.send({ documents });
      } catch (error) {
        fastify.log.error(error);
        reply.status(500).send({ 
          error: "Failed to fetch course documents",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    },
  });

  // POST /api/v1/ai-evaluations/extract-content - Extract text content from selected documents
  fastify.post("/extract-content", {
    schema: {
      body: {
        type: "object",
        required: ["documentIds", "courseId"],
        properties: {
          documentIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1
          },
          courseId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request, reply) => {
      const { documentIds, courseId } = request.body as { documentIds: string[], courseId: string };
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Validate that all documents exist and belong to the course
        const documentsResult = await fastify.pg.query(
          `SELECT id, title, file_name, minio_key, file_size
           FROM course_materials 
           WHERE tenant_id = $1 AND course_id = $2 AND id = ANY($3)
           AND file_type = 'application/pdf' AND processing_status = 'completed'`,
          [tenantId, courseId, documentIds]
        );

        if (documentsResult.rows.length !== documentIds.length) {
          return reply.status(400).send({ 
            error: "Some documents not found or not accessible" 
          });
        }

        const textExtractionService = getTextExtractionService();
        const fileStorageService = getFileStorageService();
        
        let combinedContent = '';
        let totalPages = 0;
        let totalWords = 0;
        let totalCharacters = 0;

        // Extract text from each document
        for (const doc of documentsResult.rows) {
          try {
            // Get file from storage
            const fileBuffer = await fileStorageService.getFileBuffer(doc.minio_key);
            
            // Extract text
            const extractionResult = await textExtractionService.extractText(
              fileBuffer,
              'application/pdf',
              doc.file_name
            );

            // Clean and validate text
            const cleanedText = textExtractionService.cleanText(extractionResult.text);
            const validation = textExtractionService.validateExtractedText(cleanedText);

            if (!validation.isValid) {
              fastify.log.warn(`Text extraction quality issues for ${doc.file_name}:`, validation.issues);
            }

            // Add document separator and content
            combinedContent += `\n\n=== Document: ${doc.title} ===\n\n${cleanedText}`;
            
            // Accumulate metadata
            if (extractionResult.metadata) {
              totalPages += extractionResult.metadata.pageCount || 0;
              totalWords += extractionResult.metadata.wordCount || 0;
              totalCharacters += extractionResult.metadata.characterCount || 0;
            }

          } catch (error) {
            fastify.log.error(`Failed to extract text from document ${doc.id}:`, error);
            // Continue with other documents, but log the error
            combinedContent += `\n\n=== Document: ${doc.title} ===\n\n[Error: Could not extract text from this document]`;
          }
        }

        // Trim the combined content
        combinedContent = combinedContent.trim();

        if (!combinedContent || combinedContent.length < 100) {
          return reply.status(400).send({ 
            error: "Insufficient content extracted from documents" 
          });
        }

        const response = {
          extractedContent: combinedContent,
          metadata: {
            totalPages,
            totalWords,
            totalCharacters,
            documentsProcessed: documentsResult.rows.length,
          },
        };

        reply.send(response);
      } catch (error) {
        fastify.log.error(error);
        reply.status(500).send({ 
          error: "Failed to extract content from documents",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    },
  });

  // POST /api/v1/ai-evaluations/generate-questions - Generate questions from extracted content
  fastify.post("/generate-questions", {
    schema: {
      body: {
        type: "object",
        required: ["extractedContent", "questionConfig"],
        properties: {
          extractedContent: { type: "string", minLength: 1 },
          questionConfig: {
            type: "object",
            properties: {
              mcq: { type: "number", minimum: 0, default: 0 },
              short_answer: { type: "number", minimum: 0, default: 0 },
              long_answer: { type: "number", minimum: 0, default: 0 },
              true_false: { type: "number", minimum: 0, default: 0 },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"], default: "medium" },
            },
            required: ["difficulty"],
          },
          courseContext: { type: "string" },
          aiInstructions: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { extractedContent, questionConfig, courseContext, aiInstructions } = request.body as {
        extractedContent: string;
        questionConfig: any;
        courseContext?: string;
        aiInstructions?: string;
      };
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        const aiService = getAIEvaluationService();

        // Check rate limits
        const canProceed = await aiService.checkRateLimit(tenantId);
        if (!canProceed) {
          return reply.status(429).send({ 
            error: "Rate limit exceeded",
            message: "Too many AI generation requests. Please try again later."
          });
        }

        // Validate total question count
        const totalQuestions = (questionConfig.mcq || 0) + 
                              (questionConfig.short_answer || 0) + 
                              (questionConfig.long_answer || 0) + 
                              (questionConfig.true_false || 0);

        if (totalQuestions === 0) {
          return reply.status(400).send({ 
            error: "At least one question type must be specified" 
          });
        }

        if (totalQuestions > 50) {
          return reply.status(400).send({ 
            error: "Maximum 50 questions can be generated at once" 
          });
        }

        // Generate questions
        const result = await aiService.generateQuestions({
          content: extractedContent,
          config: questionConfig,
          courseContext,
          aiInstructions,
        });

        // Update rate limits
        aiService.updateRateLimit(tenantId, result.metadata.tokensUsed);

        reply.send(result);
      } catch (error) {
        fastify.log.error(error);
        
        if (error instanceof Error && error.message.includes('Rate limit')) {
          reply.status(429).send({ 
            error: "Rate limit exceeded",
            message: error.message
          });
        } else if (error instanceof Error && error.message.includes('Content too')) {
          reply.status(400).send({ 
            error: "Invalid content",
            message: error.message
          });
        } else {
          reply.status(500).send({ 
            error: "Failed to generate questions",
            message: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    },
  });

  // GET /api/v1/ai-evaluations/rate-limit/:tenantId - Check current rate limit status
  fastify.get("/rate-limit", {
    handler: async (request, reply) => {
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        const aiService = getAIEvaluationService();
        const canProceed = await aiService.checkRateLimit(tenantId);
        
        reply.send({ 
          canProceed,
          message: canProceed ? "Rate limit OK" : "Rate limit exceeded"
        });
      } catch (error) {
        fastify.log.error(error);
        reply.status(500).send({ 
          error: "Failed to check rate limit",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    },
  });
}
