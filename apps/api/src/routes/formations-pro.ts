import { FastifyInstance } from "fastify";
import { FormationListQuerySchema } from "@ecoledigitale/contracts/src/formations-pro";
import { UploadSupportSchema } from "@ecoledigitale/contracts/src/formateurs";
import { FormationProService } from "../services/formation-pro.service";
import { PDFGenerationService } from "../services/pdf-generation.service";
import { SupportsCoursService } from "../services/supports-cours.service";
import { getTableName, usesSessionBasedProfessionalTraining } from "../utils/table-names";
import { extractTokenFromHeader, verifyToken } from "../services/jwt.service";
import { getFileStorageService } from "../services/fileStorage";

const ADMIN_ROLE_MARKERS = ["admin", "super_admin", "Administrateur"];

function isCatalogueAdmin(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((r) => ADMIN_ROLE_MARKERS.includes(r));
}

export async function formationsProRoutes(fastify: FastifyInstance) {
  const formationService = new FormationProService(fastify.pg as any);
  const pdfService = new PDFGenerationService();
  const supportsService = new SupportsCoursService(fastify.pg as any);

  const resolveAuthenticatedUser = (request: any) => {
    const token = extractTokenFromHeader(request.headers.authorization as string | undefined);
    if (!token) {
      throw new Error("AUTH_REQUIRED");
    }

    const payload = verifyToken(token);
    if (!request.tenantId || payload.tenantId !== request.tenantId) {
      throw new Error("TENANT_MISMATCH");
    }

    return payload;
  };

  // GET /api/v1/formations-pro/:slug/materials/public
  // Public listing: only metadata, no protected playback URL for local videos.
  fastify.get("/:slug/materials/public", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Public materials preview",
      params: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
        const { slug } = request.params as { slug: string };

        const formationsTable = getTableName(request.tenantId, "formations_professionnelles");
        const supportsTable = getTableName(request.tenantId, "supports_cours");
        const associationsTable = getTableName(request.tenantId, "support_session_associations");
        const sessionsTable = getTableName(request.tenantId, "sessions_professionnelles");
        const sessionMode = usesSessionBasedProfessionalTraining(request.tenantId);

        const formationResult = await client.query(
          `SELECT id, slug, titre FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2 AND actif = true LIMIT 1`,
          [request.tenantId, slug]
        );

        if (formationResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found",
          });
        }

        const formation = formationResult.rows[0];
        const supportsSql = sessionMode
          ? `
          SELECT DISTINCT
            sc.id,
            sc.titre,
            sc.description,
            sc.type_fichier,
            sc.video_provider,
            sc.url_thumbnail,
            sc.created_at
          FROM ${supportsTable} sc
          LEFT JOIN ${associationsTable} ssa ON ssa.support_id = sc.id AND ssa.tenant_id = sc.tenant_id
          LEFT JOIN ${sessionsTable} sp ON sp.id = ssa.session_id AND sp.tenant_id = ssa.tenant_id
          WHERE sc.tenant_id = $1
            AND sc.visible_apprenants = true
            AND (
              sc.formation_id = $2
              OR sp.formation_pro_id = $2
            )
          ORDER BY sc.created_at DESC
          `
          : `
          SELECT sc.id, sc.titre, sc.description, sc.type_fichier, sc.video_provider, sc.url_thumbnail, sc.created_at
          FROM ${supportsTable} sc
          WHERE sc.tenant_id = $1 AND sc.visible_apprenants = true AND sc.formation_id = $2
          ORDER BY sc.created_at DESC
          `;
        const supportsResult = await client.query(supportsSql, [request.tenantId, formation.id]);

        return reply.send({
          success: true,
          data: {
            formation,
            supports: supportsResult.rows.map((row: any) => ({
              id: row.id,
              titre: row.titre,
              description: row.description,
              type_fichier: row.type_fichier,
              is_video: row.type_fichier === "Video",
              video_provider: row.video_provider,
              thumbnail_url: row.url_thumbnail,
              created_at: row.created_at,
            })),
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "Failed to fetch public materials",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/formations-pro/:slug/materials/unlocked
  // Protected listing: requires paid enrollment to access video URLs.
  fastify.get("/:slug/materials/unlocked", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Unlocked materials for paid learners",
      params: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      let jwtPayload: any;
      try {
        jwtPayload = resolveAuthenticatedUser(request);
      } catch (error: any) {
        return reply.status(401).send({
          success: false,
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
        const { slug } = request.params as { slug: string };

        const formationsTable = getTableName(request.tenantId, "formations_professionnelles");
        const supportsTable = getTableName(request.tenantId, "supports_cours");
        const associationsTable = getTableName(request.tenantId, "support_session_associations");
        const sessionsTable = getTableName(request.tenantId, "sessions_professionnelles");
        const inscriptionsTable = getTableName(request.tenantId, "inscriptions_professionnelles");
        const paiementsTable = getTableName(request.tenantId, "paiements_professionnels");
        const sessionMode = usesSessionBasedProfessionalTraining(request.tenantId);

        const formationResult = await client.query(
          `SELECT id, slug, titre FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2 AND actif = true LIMIT 1`,
          [request.tenantId, slug]
        );

        if (formationResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found",
          });
        }

        const formation = formationResult.rows[0];

        const accessSql = sessionMode
          ? `
          SELECT 1
          FROM ${inscriptionsTable} i
          JOIN ${sessionsTable} s ON s.id = i.session_id AND s.tenant_id = i.tenant_id
          WHERE i.tenant_id = $1
            AND i.apprenant_id = $2
            AND i.statut = 'confirmee'
            AND s.formation_pro_id = $3
            AND EXISTS (
              SELECT 1
              FROM ${paiementsTable} p
              WHERE p.tenant_id = i.tenant_id
                AND p.inscription_id = i.id
                AND p.statut = 'valide'
            )
          LIMIT 1
          `
          : `
          SELECT 1
          FROM ${inscriptionsTable} i
          WHERE i.tenant_id = $1
            AND i.apprenant_id = $2
            AND i.statut = 'confirmee'
            AND i.formation_pro_id = $3
            AND EXISTS (
              SELECT 1
              FROM ${paiementsTable} p
              WHERE p.tenant_id = i.tenant_id
                AND p.inscription_id = i.id
                AND p.statut = 'valide'
            )
          LIMIT 1
          `;
        const accessResult = await client.query(accessSql, [
          request.tenantId,
          jwtPayload.userId,
          formation.id,
        ]);

        if (accessResult.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "PAYMENT_REQUIRED",
            message: "Access to video materials requires a validated payment",
          });
        }

        const unlockedSupportsSql = sessionMode
          ? `
          SELECT DISTINCT
            sc.id,
            sc.titre,
            sc.description,
            sc.type_fichier,
            sc.fichier_url,
            sc.video_provider,
            sc.video_id,
            sc.url_thumbnail,
            sc.created_at
          FROM ${supportsTable} sc
          LEFT JOIN ${associationsTable} ssa ON ssa.support_id = sc.id AND ssa.tenant_id = sc.tenant_id
          LEFT JOIN ${sessionsTable} sp ON sp.id = ssa.session_id AND sp.tenant_id = ssa.tenant_id
          WHERE sc.tenant_id = $1
            AND sc.visible_apprenants = true
            AND (
              sc.formation_id = $2
              OR sp.formation_pro_id = $2
            )
          ORDER BY sc.created_at DESC
          `
          : `
          SELECT sc.id, sc.titre, sc.description, sc.type_fichier, sc.fichier_url, sc.video_provider,
            sc.video_id, sc.url_thumbnail, sc.created_at
          FROM ${supportsTable} sc
          WHERE sc.tenant_id = $1 AND sc.visible_apprenants = true AND sc.formation_id = $2
          ORDER BY sc.created_at DESC
          `;
        const supportsResult = await client.query(unlockedSupportsSql, [request.tenantId, formation.id]);

        return reply.send({
          success: true,
          data: {
            formation,
            supports: supportsResult.rows.map((row: any) => ({
              id: row.id,
              titre: row.titre,
              description: row.description,
              type_fichier: row.type_fichier,
              is_video: row.type_fichier === "Video",
              video_provider: row.video_provider,
              video_id: row.video_id,
              thumbnail_url: row.url_thumbnail,
              playback_url:
                row.type_fichier === "Video" && row.video_provider === "vimeo"
                  ? row.fichier_url
                  : null,
              download_url: row.type_fichier === "Video" ? null : row.fichier_url,
              created_at: row.created_at,
            })),
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "Failed to fetch unlocked materials",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/formations-pro/videos/:supportId/playback?slug=:slug
  // Protected local-video playback endpoint (auth + paid access required)
  fastify.get("/videos/:supportId/playback", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Protected video playback",
      params: {
        type: "object",
        required: ["supportId"],
        properties: {
          supportId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      let jwtPayload: any;
      try {
        jwtPayload = resolveAuthenticatedUser(request);
      } catch {
        return reply.status(401).send({
          success: false,
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      const { supportId } = request.params as { supportId: string };
      const { slug } = request.query as { slug: string };

      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        const formationsTable = getTableName(request.tenantId, "formations_professionnelles");
        const supportsTable = getTableName(request.tenantId, "supports_cours");
        const associationsTable = getTableName(request.tenantId, "support_session_associations");
        const sessionsTable = getTableName(request.tenantId, "sessions_professionnelles");
        const inscriptionsTable = getTableName(request.tenantId, "inscriptions_professionnelles");
        const paiementsTable = getTableName(request.tenantId, "paiements_professionnels");
        const sessionMode = usesSessionBasedProfessionalTraining(request.tenantId);

        const formationResult = await client.query(
          `SELECT id FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2 AND actif = true LIMIT 1`,
          [request.tenantId, slug]
        );
        if (formationResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found",
          });
        }
        const formationId = formationResult.rows[0].id as string;

        const playbackAccessSql = sessionMode
          ? `
          SELECT 1
          FROM ${inscriptionsTable} i
          JOIN ${sessionsTable} s ON s.id = i.session_id AND s.tenant_id = i.tenant_id
          WHERE i.tenant_id = $1
            AND i.apprenant_id = $2
            AND i.statut = 'confirmee'
            AND s.formation_pro_id = $3
            AND EXISTS (
              SELECT 1
              FROM ${paiementsTable} p
              WHERE p.tenant_id = i.tenant_id
                AND p.inscription_id = i.id
                AND p.statut = 'valide'
            )
          LIMIT 1
          `
          : `
          SELECT 1
          FROM ${inscriptionsTable} i
          WHERE i.tenant_id = $1
            AND i.apprenant_id = $2
            AND i.statut = 'confirmee'
            AND i.formation_pro_id = $3
            AND EXISTS (
              SELECT 1
              FROM ${paiementsTable} p
              WHERE p.tenant_id = i.tenant_id
                AND p.inscription_id = i.id
                AND p.statut = 'valide'
            )
          LIMIT 1
          `;
        const accessResult = await client.query(playbackAccessSql, [
          request.tenantId,
          jwtPayload.userId,
          formationId,
        ]);
        if (accessResult.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "PAYMENT_REQUIRED",
            message: "Access to videos requires a validated payment",
          });
        }

        const playbackSupportSql = sessionMode
          ? `
          SELECT DISTINCT
            sc.id,
            sc.type_fichier,
            sc.fichier_url,
            sc.video_provider
          FROM ${supportsTable} sc
          LEFT JOIN ${associationsTable} ssa ON ssa.support_id = sc.id AND ssa.tenant_id = sc.tenant_id
          LEFT JOIN ${sessionsTable} sp ON sp.id = ssa.session_id AND sp.tenant_id = ssa.tenant_id
          WHERE sc.tenant_id = $1
            AND sc.id = $2
            AND sc.visible_apprenants = true
            AND sc.type_fichier = 'Video'
            AND (sc.formation_id = $3 OR sp.formation_pro_id = $3)
          LIMIT 1
          `
          : `
          SELECT sc.id, sc.type_fichier, sc.fichier_url, sc.video_provider
          FROM ${supportsTable} sc
          WHERE sc.tenant_id = $1
            AND sc.id = $2
            AND sc.visible_apprenants = true
            AND sc.type_fichier = 'Video'
            AND sc.formation_id = $3
          LIMIT 1
          `;
        const supportResult = await client.query(playbackSupportSql, [
          request.tenantId,
          supportId,
          formationId,
        ]);

        if (supportResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "SUPPORT_NOT_FOUND",
            message: "Video support not found",
          });
        }

        const support = supportResult.rows[0];
        if (support.video_provider === "vimeo") {
          return reply.redirect(support.fichier_url);
        }

        const keyMatch = String(support.fichier_url || "").match(/\/api\/v1\/files\/(.+)$/);
        if (!keyMatch?.[1]) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_FILE_URL",
            message: "Invalid local file URL",
          });
        }

        const fileStorage = getFileStorageService();
        const fileKey = keyMatch[1];
        const fileInfo = await fileStorage.getFileInfo(fileKey);
        if (!fileInfo) {
          return reply.status(404).send({
            success: false,
            error: "FILE_NOT_FOUND",
            message: "Video file not found",
          });
        }

        const stream = await fileStorage.getFileStream(fileKey);
        reply.header("Content-Type", fileInfo.contentType || "video/mp4");
        reply.header("Content-Length", String(fileInfo.size));
        reply.header("Accept-Ranges", "bytes");
        return reply.send(stream as any);
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "Failed to stream video",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/formations-pro - List formations with search, filters, sorting, pagination
  fastify.get("/", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "List professional training programs",
      description: "Get a paginated list of professional training programs with search, filtering, and sorting",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          search: { type: "string" },
          themes: { type: "string" },
          duree_min: { type: "number" },
          duree_max: { type: "number" },
          prix_min: { type: "number" },
          prix_max: { type: "number" },
          niveau: { type: "string", enum: ["Débutant", "Intermédiaire", "Avancé"] },
          mode: { type: "string" },
          certification: { type: "boolean" },
          sort: {
            type: "string",
            enum: ["pertinence", "prix_asc", "prix_desc", "titre_asc", "date_asc"],
            default: "pertinence",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                formations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      titre: { type: "string" },
                      slug: { type: "string" },
                      description_courte: { type: ["string", "null"] },
                      duree_jours: { type: ["number", "null"] },
                      duree_heures: { type: ["number", "null"] },
                      prix_ttc: { type: "number" },
                      niveau: { type: ["string", "null"] },
                      type_certification: { type: ["string", "null"] },
                      themes: { type: "array", items: { type: "string" } },
                      prochaine_session: {
                        type: ["object", "null"],
                        properties: {
                          date_debut: { type: "string" },
                          mode_formation: { type: "string" },
                        },
                      },
                      /** Résumé support catalogue (tenants sans sessions) — doit rester dans le schéma sinon la sérialisation l’omet. */
                      catalogue_support: {
                        oneOf: [
                          {
                            type: "object",
                            additionalProperties: false,
                            required: ["titre", "type_fichier"],
                            properties: {
                              titre: { type: "string" },
                              type_fichier: { type: "string" },
                              video_provider: { type: ["string", "null"] },
                            },
                          },
                          { type: "null" },
                        ],
                      },
                    },
                  },
                },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "number" },
                    limit: { type: "number" },
                    total: { type: "number" },
                    totalPages: { type: "number" },
                  },
                },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        500: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const query = FormationListQuerySchema.parse(request.query);
        
        // Debug: Log tenant ID being used
        fastify.log.info(`[Formations Pro] Searching with tenantId: ${request.tenantId}`);
        
        const { formations, total } = await formationService.searchFormations(
          request.tenantId,
          query
        );
        
        // Debug: Log results
        fastify.log.info(`[Formations Pro] Found ${total} formations for tenant ${request.tenantId}`);
        
        // Debug: Vérifier la première formation avant envoi
        if (formations.length > 0) {
          const firstFormation = formations[0];
          console.log('\n🔍 [ROUTE] First formation prochaine_session:');
          console.log('   Exists:', !!firstFormation.prochaine_session);
          console.log('   Is null:', firstFormation.prochaine_session === null);
          console.log('   Is undefined:', firstFormation.prochaine_session === undefined);
          console.log('   Type:', typeof firstFormation.prochaine_session);
          console.log('   Keys:', firstFormation.prochaine_session ? Object.keys(firstFormation.prochaine_session) : []);
          console.log('   Value:', JSON.stringify(firstFormation.prochaine_session));
          console.log('   Full object:', JSON.stringify(firstFormation, null, 2));
          
          fastify.log.info(`[Formations Pro] First formation prochaine_session:`, {
            exists: !!firstFormation.prochaine_session,
            isNull: firstFormation.prochaine_session === null,
            isObject: typeof firstFormation.prochaine_session === 'object',
            keys: firstFormation.prochaine_session ? Object.keys(firstFormation.prochaine_session) : [],
            value: JSON.stringify(firstFormation.prochaine_session),
          });
        }

        const page = query.page || 1;
        const limit = query.limit || 20;
        const totalPages = Math.ceil(total / limit);

        // Debug: Vérifier ce qui est réellement retourné avant sérialisation
        if (formations.length > 0) {
          const firstFormation = formations[0];
          console.log('\n🔍 [ROUTE] Avant reply.send():');
          console.log('   prochaine_session:', firstFormation.prochaine_session);
          console.log('   JSON stringify:', JSON.stringify(firstFormation.prochaine_session));
          console.log('   Type:', typeof firstFormation.prochaine_session);
          console.log('   Is null:', firstFormation.prochaine_session === null);
          
          // Vérifier si les propriétés existent
          if (firstFormation.prochaine_session && typeof firstFormation.prochaine_session === 'object') {
            console.log('   Has date_debut?', 'date_debut' in firstFormation.prochaine_session);
            console.log('   Has mode_formation?', 'mode_formation' in firstFormation.prochaine_session);
            console.log('   date_debut value:', firstFormation.prochaine_session.date_debut);
            console.log('   mode_formation value:', firstFormation.prochaine_session.mode_formation);
          }
        }

        const responseData = {
          success: true,
          data: {
            formations,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        };

        // Debug: Vérifier la réponse complète
        if (formations.length > 0) {
          console.log('\n🔍 [ROUTE] Response data (première formation):');
          console.log(JSON.stringify({
            titre: responseData.data.formations[0].titre,
            prochaine_session: responseData.data.formations[0].prochaine_session
          }, null, 2));
        }

        return reply.send(responseData);
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching formations",
        });
      }
    },
  });

  // POST /api/v1/formations-pro - Create a new formation
  fastify.post("/", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Create a new professional training program",
      description: "Create a new professional training program",
      body: {
        type: "object",
        required: ["titre", "prix_ttc"],
        properties: {
          titre: { type: "string", minLength: 1, maxLength: 255 },
          description_courte: { type: ["string", "null"] },
          objectifs: { type: "array", items: { type: "string" } },
          prerequis: { type: ["string", "null"] },
          public_cible: { type: ["string", "null"] },
          duree_jours: { type: ["number", "null"] },
          duree_heures: { type: ["number", "null"] },
          prix_ht: { type: ["number", "null"] },
          prix_ttc: { type: "number", minimum: 0 },
          type_certification: { type: ["string", "null"] },
          nom_certification: { type: ["string", "null"] },
          themes: { type: "array", items: { type: "string" } },
          niveau: { type: ["string", "null"], enum: ["Débutant", "Intermédiaire", "Avancé"] },
          carriere: { type: ["string", "null"] },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                slug: { type: "string" },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        500: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const body = request.body as any;

        // Get user ID from request (from JWT or header)
        const userId = (request as any).user?.id || (request.headers as any)?.['x-user-id'] || null;

        // Validate that at least one duration is provided
        if (!body.duree_jours && !body.duree_heures) {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Au moins une durée (jours ou heures) doit être renseignée",
          });
        }

        const result = await formationService.createFormation(request.tenantId, userId, {
          titre: body.titre,
          description_courte: body.description_courte || null,
          objectifs: body.objectifs || [],
          prerequis: body.prerequis || null,
          public_cible: body.public_cible || null,
          duree_jours: body.duree_jours || null,
          duree_heures: body.duree_heures || null,
          prix_ht: body.prix_ht || null,
          prix_ttc: body.prix_ttc,
          type_certification: body.type_certification || null,
          nom_certification: body.nom_certification || null,
          themes: body.themes || [],
          niveau: body.niveau || null,
          carriere: body.carriere || null,
        });

        return reply.status(201).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error("Error creating formation:", {
          error: error.message,
          stack: error.stack,
          code: error.code,
        });
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while creating the formation",
        });
      }
    },
  });

  // POST /api/v1/formations-pro/:formationId/catalogue-support — support unique PDF/vidéo (tenant sans sessions)
  fastify.post("/:formationId/catalogue-support", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Upload the single catalogue support (admin)",
      consumes: ["multipart/form-data"],
      params: {
        type: "object",
        required: ["formationId"],
        properties: {
          formationId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      if (usesSessionBasedProfessionalTraining(request.tenantId)) {
        return reply.status(400).send({
          success: false,
          error: "NOT_APPLICABLE",
          message: "Ce tenant utilise des sessions : ajoutez les supports côté formateur ou par session.",
        });
      }

      let payload: ReturnType<typeof verifyToken>;
      try {
        const token = extractTokenFromHeader((request.headers as any).authorization);
        if (!token) {
          return reply.status(401).send({
            success: false,
            error: "AUTH_REQUIRED",
            message: "Authentification requise",
          });
        }
        payload = verifyToken(token);
        if (payload.tenantId !== request.tenantId) {
          return reply.status(403).send({
            success: false,
            error: "TENANT_MISMATCH",
            message: "Token et contexte locataire incohérents",
          });
        }
        if (!isCatalogueAdmin(payload.roles)) {
          return reply.status(403).send({
            success: false,
            error: "FORBIDDEN",
            message: "Réservé aux administrateurs",
          });
        }
      } catch {
        return reply.status(401).send({
          success: false,
          error: "INVALID_TOKEN",
          message: "Jeton invalide ou expiré",
        });
      }

      const { formationId } = request.params as { formationId: string };
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(formationId)) {
        return reply.status(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Identifiant de formation invalide",
        });
      }

      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
        const formationsTable = getTableName(request.tenantId, "formations_professionnelles");
        const exists = await client.query(
          `SELECT id FROM ${formationsTable} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [request.tenantId, formationId]
        );
        if (exists.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Formation introuvable",
          });
        }
      } finally {
        client.release();
      }

      try {
        const fieldsMap = new Map<string, string[]>();
        let mainFileBuffer: Buffer | null = null;
        let mainFileName = "";
        let mainMimeType = "application/octet-stream";
        let thumbnailBuffer: Buffer | undefined;
        let thumbnailFileName: string | undefined;
        let thumbnailMimeType: string | undefined;

        for await (const part of (request as any).parts()) {
          if (part.type === "file") {
            const bufferedFile = await part.toBuffer();
            if (part.fieldname === "thumbnail_file") {
              thumbnailBuffer = bufferedFile;
              thumbnailFileName = part.filename || "thumbnail";
              thumbnailMimeType = part.mimetype || "application/octet-stream";
              continue;
            }
            if (part.fieldname === "file" || !mainFileBuffer) {
              mainFileBuffer = bufferedFile;
              mainFileName = part.filename || "support";
              mainMimeType = part.mimetype || "application/octet-stream";
            }
            continue;
          }
          const fieldValue = typeof part.value === "string" ? part.value : String(part.value ?? "");
          const existingValues = fieldsMap.get(part.fieldname) || [];
          existingValues.push(fieldValue);
          fieldsMap.set(part.fieldname, existingValues);
        }

        const getFirstFieldValue = (fieldName: string): string | undefined => {
          const values = fieldsMap.get(fieldName) || [];
          const trimmed = values.map((v) => v.trim()).filter(Boolean);
          return trimmed.length ? trimmed[0] : undefined;
        };

        const titre = getFirstFieldValue("titre") || mainFileName || "Support catalogue";
        const description = getFirstFieldValue("description");
        const video_provider = getFirstFieldValue("video_provider");
        const vimeo_url = getFirstFieldValue("vimeo_url");
        const thumbnail_url = getFirstFieldValue("thumbnail_url");
        const visible_apprenants = getFirstFieldValue("visible_apprenants") !== "false";

        if (!mainFileBuffer?.length && video_provider === "vimeo" && vimeo_url) {
          mainFileBuffer = Buffer.alloc(0);
          mainFileName = "vimeo.url";
          mainMimeType = "video/mp4";
        }

        if (!mainFileBuffer) {
          return reply.status(400).send({
            success: false,
            error: "NO_FILE",
            message: "Fichier PDF/vidéo requis, ou URL Vimeo avec video_provider=vimeo",
          });
        }
        const vimeoOnly =
          video_provider === "vimeo" &&
          Boolean(vimeo_url) &&
          mainFileBuffer.length === 0;
        if (!vimeoOnly && mainFileBuffer.length === 0) {
          return reply.status(400).send({
            success: false,
            error: "NO_FILE",
            message: "Le fichier transmis est vide",
          });
        }

        const metadata = UploadSupportSchema.parse({
          titre,
          description,
          formation_id: formationId,
          video_provider: video_provider || undefined,
          vimeo_url: vimeo_url || undefined,
          thumbnail_url: thumbnail_url || undefined,
          visible_apprenants,
        });

        const result = await supportsService.uploadSupport(
          mainFileBuffer,
          mainFileName,
          mainMimeType,
          {
            titre: metadata.titre,
            description: metadata.description,
            formation_id: formationId,
            video_provider: metadata.video_provider,
            vimeo_url: metadata.vimeo_url,
            thumbnail_url: metadata.thumbnail_url,
            thumbnail_file_buffer: thumbnailBuffer,
            thumbnail_file_name: thumbnailFileName,
            thumbnail_content_type: thumbnailMimeType,
            session_ids: [],
            visible_apprenants: metadata.visible_apprenants,
          },
          null,
          request.tenantId
        );

        return reply.status(201).send({ success: true, data: result });
      } catch (error: any) {
        fastify.log.error(error);
        const msg = error.message || "";
        if (
          msg.includes("FILE_TOO_LARGE") ||
          msg.includes("INVALID_FILE_TYPE") ||
          msg.includes("FORMATION_REQUIRED") ||
          msg.includes("INVALID_VIMEO_URL")
        ) {
          return reply.status(400).send({
            success: false,
            error: msg.split(":")[0] || "VALIDATION_ERROR",
            message: msg,
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: msg || "Erreur lors de l'upload du support",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/:slug - Get formation detail
  fastify.get("/:slug", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Get training program detail",
      description: "Get detailed information about a specific training program by slug",
      params: {
        type: "object",
        properties: {
          slug: { type: "string" },
        },
        required: ["slug"],
      },
      // Temporarily disable response schema validation to debug serialization issue
      // response: {
      //   200: { type: "object" },
      //   404: { type: "object" },
      //   500: { type: "object" },
      // },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { slug } = request.params as { slug: string };
        
        fastify.log.info(`[Formations Pro] Fetching formation by slug: ${slug} for tenant: ${request.tenantId}`);
        console.log(`[Formations Pro] DEBUG - Request params:`, { slug, tenantId: request.tenantId, tenantSlug: request.tenantSlug });
        
        let formation: any;
        try {
          formation = await formationService.getFormationBySlug(request.tenantId, slug);
          console.log(`[Formations Pro] DEBUG - Service returned:`, formation ? { id: formation.id, titre: formation.titre } : null);
        } catch (serviceError: any) {
          console.error(`[Formations Pro] DEBUG - Service error:`, {
            message: serviceError.message,
            stack: serviceError.stack,
            name: serviceError.name,
          });
          throw serviceError;
        }

        if (!formation) {
          fastify.log.info(`[Formations Pro] Formation not found: ${slug}`);
          console.log(`[Formations Pro] DEBUG - Returning 404 for slug: ${slug}, tenant: ${request.tenantId}`);
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found or inactive",
          });
        }

        fastify.log.info(`[Formations Pro] Formation found: ${formation.titre}`);
        console.log(`[Formations Pro] DEBUG - Returning success for formation:`, { id: formation.id, titre: formation.titre });
        
        // Ensure the response is properly structured
        const response = {
          success: true,
          data: formation,
        };
        
        console.log(`[Formations Pro] DEBUG - Response structure:`, {
          hasSuccess: 'success' in response,
          hasData: 'data' in response,
          dataKeys: formation ? Object.keys(formation) : [],
          responseString: JSON.stringify(response).substring(0, 200),
        });
        
        // Try to serialize the response to check for errors
        try {
          const testSerialization = JSON.stringify(response);
          console.log(`[Formations Pro] DEBUG - Serialization test successful, length: ${testSerialization.length}`);
          
          // Vérifier que la réponse n'est pas vide
          if (!response || Object.keys(response).length === 0) {
            console.error(`[Formations Pro] DEBUG - Response is empty before sending!`);
            return reply.status(500).send({
              success: false,
              error: "EMPTY_RESPONSE",
              message: "Response is empty",
            });
          }
          
          // Vérifier que formation n'est pas null/undefined
          if (!formation) {
            console.error(`[Formations Pro] DEBUG - Formation is null/undefined!`);
            return reply.status(500).send({
              success: false,
              error: "NULL_FORMATION",
              message: "Formation data is null",
            });
          }
        } catch (serializationError: any) {
          console.error(`[Formations Pro] DEBUG - Serialization error:`, serializationError);
          return reply.status(500).send({
            success: false,
            error: "SERIALIZATION_ERROR",
            message: "Failed to serialize formation data",
          });
        }
        
        console.log(`[Formations Pro] DEBUG - About to send response, response keys:`, Object.keys(response));
        console.log(`[Formations Pro] DEBUG - About to send response, formation keys:`, formation ? Object.keys(formation) : 'null');
        
        // Send response - use reply.send() directly like other routes
        // Fastify will automatically set status 200 and serialize JSON
        return reply.send(response);
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error fetching formation:`, error);
        console.error('❌ [Formations Pro] Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          slug,
          tenantId: request.tenantId,
          tenantSlug: request.tenantSlug,
        });
        
        // Ensure we always return a proper JSON response
        try {
          const errorResponse = {
            success: false,
            error: "INTERNAL_ERROR",
            message: error.message || "An error occurred while fetching formation detail",
          };
          
          console.log(`[Formations Pro] DEBUG - Sending error response:`, errorResponse);
          
          return reply.status(500).send(errorResponse);
        } catch (sendError: any) {
          console.error('❌ [Formations Pro] Failed to send error response:', sendError);
          // Last resort: try to send a plain text error
          return reply.status(500).type('application/json').send(JSON.stringify({
            success: false,
            error: "INTERNAL_ERROR",
            message: "An error occurred while fetching formation detail",
          }));
        }
      }
    },
  });

  // PUT /api/v1/formations-pro/:slug - Update formation
  fastify.put("/:slug", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Update training program",
      description: "Update an existing professional training program by slug",
      params: {
        type: "object",
        properties: {
          slug: { type: "string" },
        },
        required: ["slug"],
      },
      body: {
        type: "object",
        properties: {
          titre: { type: "string" },
          description_courte: { type: ["string", "null"] },
          objectifs: { type: "array", items: { type: "string" } },
          prerequis: { type: ["string", "null"] },
          public_cible: { type: ["string", "null"] },
          duree_jours: { type: ["number", "null"] },
          duree_heures: { type: ["number", "null"] },
          prix_ht: { type: ["number", "null"] },
          prix_ttc: { type: "number" },
          type_certification: { type: ["string", "null"] },
          nom_certification: { type: ["string", "null"] },
          themes: { type: "array", items: { type: "string" } },
          niveau: { 
            anyOf: [
              { type: "string", enum: ["Débutant", "Intermédiaire", "Avancé"] },
              { type: "null" }
            ]
          },
          carriere: { type: ["string", "null"] },
          actif: { type: "boolean" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { slug } = request.params as { slug: string };
        const body = request.body as any;

        fastify.log.info(`[Formations Pro] Updating formation: ${slug} for tenant: ${request.tenantId}`);

        // Validate that at least one duration is provided if both are being updated
        if (body.duree_jours !== undefined && body.duree_heures !== undefined) {
          if (!body.duree_jours && !body.duree_heures) {
            return reply.status(400).send({
              success: false,
              error: "VALIDATION_ERROR",
              message: "Au moins une durée (jours ou heures) doit être renseignée",
            });
          }
        }

        // Build update data object, only including fields that are present in the body
        const updateData: any = {};
        
        if (body.titre !== undefined) updateData.titre = body.titre;
        if (body.description_courte !== undefined) updateData.description_courte = body.description_courte;
        if (body.objectifs !== undefined) updateData.objectifs = body.objectifs;
        if (body.prerequis !== undefined) updateData.prerequis = body.prerequis;
        if (body.public_cible !== undefined) updateData.public_cible = body.public_cible;
        if (body.duree_jours !== undefined) updateData.duree_jours = body.duree_jours;
        if (body.duree_heures !== undefined) updateData.duree_heures = body.duree_heures;
        if (body.prix_ht !== undefined) updateData.prix_ht = body.prix_ht;
        if (body.prix_ttc !== undefined) updateData.prix_ttc = body.prix_ttc;
        if (body.type_certification !== undefined) updateData.type_certification = body.type_certification;
        if (body.nom_certification !== undefined) updateData.nom_certification = body.nom_certification;
        if (body.themes !== undefined) updateData.themes = body.themes;
        if (body.niveau !== undefined) updateData.niveau = body.niveau;
        if (body.carriere !== undefined) updateData.carriere = body.carriere;
        if (body.actif !== undefined) updateData.actif = body.actif;

        const result = await formationService.updateFormation(request.tenantId, slug, updateData);

        fastify.log.info(`[Formations Pro] Formation updated successfully: ${result.slug}`);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error updating formation:`, error);
        
        if (error.message === "Formation not found") {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while updating the formation",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/:id/sessions - Get formation sessions
  fastify.get("/:id/sessions", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Get training sessions for a formation",
      description: "Get all upcoming sessions for a specific training program",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
        },
      },
      response: {
        200: { type: "object" },
        404: { type: "object" },
        500: { type: "object" },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      if (!usesSessionBasedProfessionalTraining(request.tenantId)) {
        return reply.send({ success: true, data: { sessions: [], total: 0 } });
      }

      try {
        const { id } = request.params as { id: string };
        const query = request.query as { limit?: number };
        const limit = query.limit || 50;

        const { sessions, total } = await formationService.getFormationSessions(
          request.tenantId,
          id,
          limit
        );

        return reply.send({
          success: true,
          data: {
            sessions,
            total,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching sessions",
        });
      }
    },
  });

  // POST /api/v1/formations-pro/:id/sessions - Create a new session for a formation
  fastify.post("/:id/sessions", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Create training session",
      description: "Create a new training session for a professional training program",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          code_session: { type: "string" },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          horaires: { type: "string" },
          mode_formation: { type: "string", enum: ["presential", "remote", "hybrid", "elearning", "presentiel", "distanciel", "hybride"] },
          lieu: { type: "string" },
          lien_visio: { type: "string" },
          places_totales: { type: "number", minimum: 1 },
          prix_ht: { type: "number" },
          prix_ttc: { type: "number" },
          notes_internes: { type: "string" },
        },
        required: ["date_debut", "date_fin", "mode_formation", "places_totales"],
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      if (!usesSessionBasedProfessionalTraining(request.tenantId)) {
        return reply.status(404).send({
          success: false,
          error: "NOT_FOUND",
          message: "Les sessions ne sont pas utilisées pour ce tenant.",
        });
      }

      try {
        const { id } = request.params as { id: string };
        const body = request.body as any;

        // Get user ID from request (from JWT or header)
        const userId = (request as any).user?.id || (request.headers as any)?.['x-user-id'] || null;

        fastify.log.info(`[Formations Pro] Creating session for formation: ${id} for tenant: ${request.tenantId}`);

        // Validate dates
        const dateDebut = new Date(body.date_debut);
        const dateFin = new Date(body.date_fin);
        
        if (isNaN(dateDebut.getTime()) || isNaN(dateFin.getTime())) {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Les dates doivent être au format valide (YYYY-MM-DD)",
          });
        }

        if (dateFin < dateDebut) {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "La date de fin doit être postérieure à la date de début",
          });
        }

        // Map mode_formation to database enum value
        const modeMap: Record<string, "presential" | "remote" | "hybrid" | "elearning"> = {
          'presentiel': 'presential',
          'distanciel': 'remote',
          'hybride': 'hybrid',
          'presential': 'presential',
          'remote': 'remote',
          'hybrid': 'hybrid',
          'elearning': 'elearning',
        };
        const dbMode = modeMap[body.mode_formation?.toLowerCase()] || 'presential';

        const result = await formationService.createSession(request.tenantId, userId, {
          formation_pro_id: id,
          code_session: body.code_session,
          date_debut: body.date_debut,
          date_fin: body.date_fin,
          horaires: body.horaires,
          mode_formation: dbMode,
          lieu: body.lieu,
          lien_visio: body.lien_visio,
          places_totales: body.places_totales,
          prix_ht: body.prix_ht,
          prix_ttc: body.prix_ttc,
          notes_internes: body.notes_internes,
        });

        fastify.log.info(`[Formations Pro] Session created successfully: ${result.code_session}`);

        return reply.status(201).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error creating session:`, error);
        
        if (error.message === "Formation not found or inactive") {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Formation not found or inactive",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while creating the session",
        });
      }
    },
  });

  // PUT /api/v1/formations-pro/:id/sessions/:sessionId - Update a session
  fastify.put("/:id/sessions/:sessionId", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Update training session",
      description: "Update an existing training session",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          sessionId: { type: "string", format: "uuid" },
        },
        required: ["id", "sessionId"],
      },
      body: {
        type: "object",
        properties: {
          code_session: { type: "string" },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          horaires: { type: "string" },
          mode_formation: { type: "string", enum: ["presential", "remote", "hybrid", "elearning", "presentiel", "distanciel", "hybride"] },
          lieu: { type: "string" },
          lien_visio: { type: "string" },
          places_totales: { type: "number", minimum: 1 },
          prix_ht: { type: "number" },
          prix_ttc: { type: "number" },
          notes_internes: { type: "string" },
          statut: { type: "string", enum: ["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"] },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { sessionId } = request.params as { id: string; sessionId: string };
        const body = request.body as any;

        fastify.log.info(`[Formations Pro] Updating session: ${sessionId} for tenant: ${request.tenantId}`);

        // Map mode_formation if provided
        let dbMode: "presential" | "remote" | "hybrid" | "elearning" | undefined = undefined;
        if (body.mode_formation) {
          const modeMap: Record<string, "presential" | "remote" | "hybrid" | "elearning"> = {
            'presentiel': 'presential',
            'distanciel': 'remote',
            'hybride': 'hybrid',
            'presential': 'presential',
            'remote': 'remote',
            'hybrid': 'hybrid',
            'elearning': 'elearning',
          };
          dbMode = modeMap[body.mode_formation?.toLowerCase()] || 'presential';
        }

        const updateData: any = {};
        if (body.code_session !== undefined) updateData.code_session = body.code_session;
        if (body.date_debut !== undefined) updateData.date_debut = body.date_debut;
        if (body.date_fin !== undefined) updateData.date_fin = body.date_fin;
        if (body.horaires !== undefined) updateData.horaires = body.horaires;
        if (dbMode !== undefined) updateData.mode_formation = dbMode;
        if (body.lieu !== undefined) updateData.lieu = body.lieu;
        if (body.lien_visio !== undefined) updateData.lien_visio = body.lien_visio;
        if (body.places_totales !== undefined) updateData.places_totales = body.places_totales;
        if (body.prix_ht !== undefined) updateData.prix_ht = body.prix_ht;
        if (body.prix_ttc !== undefined) updateData.prix_ttc = body.prix_ttc;
        if (body.notes_internes !== undefined) updateData.notes_internes = body.notes_internes;
        if (body.statut !== undefined) updateData.statut = body.statut;

        const result = await formationService.updateSession(request.tenantId, sessionId, updateData);

        fastify.log.info(`[Formations Pro] Session updated successfully: ${result.code_session}`);

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error updating session:`, error);
        
        if (error.message === "Session not found") {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Session not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while updating the session",
        });
      }
    },
  });

  // DELETE /api/v1/formations-pro/:id/sessions/:sessionId - Delete a session
  fastify.delete("/:id/sessions/:sessionId", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Delete training session",
      description: "Delete an existing training session",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          sessionId: { type: "string", format: "uuid" },
        },
        required: ["id", "sessionId"],
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { sessionId } = request.params as { id: string; sessionId: string };

        fastify.log.info(`[Formations Pro] Deleting session: ${sessionId} for tenant: ${request.tenantId}`);

        await formationService.deleteSession(request.tenantId, sessionId);

        fastify.log.info(`[Formations Pro] Session deleted successfully: ${sessionId}`);

        return reply.send({
          success: true,
          message: "Session deleted successfully",
        });
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error deleting session:`, error);
        
        if (error.message === "Session not found") {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Session not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while deleting the session",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/:id/similaires - Get similar formations
  fastify.get("/:id/similaires", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Get similar training recommendations",
      description: "Get recommended similar training programs based on themes, level, duration, and price",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      response: {
        200: { type: "object" },
        404: { type: "object" },
        500: { type: "object" },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { id } = request.params as { id: string };
        const formations = await formationService.getSimilarFormations(request.tenantId, id);

        return reply.send({
          success: true,
          data: {
            formations,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching similar formations",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/:id/programme-pdf - Download PDF
  // NOTE: Rate limiting consideration
  // PDF generation is resource-intensive (Puppeteer). Consider implementing rate limiting:
  // - Per-user/IP: max 10 PDFs per minute
  // - Per-tenant: max 100 PDFs per hour
  // - Use @fastify/rate-limit or similar middleware
  // - Cache generated PDFs for same formation ID to avoid regeneration
  fastify.get("/:id/programme-pdf", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Download training program PDF",
      description: "Generate and download a PDF document containing complete training program information",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "string",
          format: "binary",
        },
        404: { type: "object" },
        500: { type: "object" },
        503: { type: "object" },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { id } = request.params as { id: string };

        // First, get the formation by ID (we need to find it by ID, not slug)
        const client = await (fastify.pg as any).connect();
        let formation: any = null;
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
          
          // Get tenant-specific table names
          const formationsTable = getTableName(request.tenantId, 'formations_professionnelles');
          const sessionsTable = getTableName(request.tenantId, 'sessions_professionnelles');

          const pdfFormationSql = usesSessionBasedProfessionalTraining(request.tenantId)
            ? `
            SELECT 
              f.*,
              json_agg(
                json_build_object(
                  'id', sp.id,
                  'code_session', sp.code_session,
                  'date_debut', sp.date_debut,
                  'date_fin', sp.date_fin,
                  'horaires', sp.horaires,
                  'mode_formation', sp.mode_formation,
                  'lieu', sp.lieu,
                  'places_disponibles', sp.places_disponibles,
                  'prix_ttc', sp.prix_ttc
                ) ORDER BY sp.date_debut ASC
              ) FILTER (WHERE sp.id IS NOT NULL) as sessions
            FROM ${formationsTable} f
            LEFT JOIN ${sessionsTable} sp ON f.id = sp.formation_pro_id
              AND sp.tenant_id = $1
              AND sp.statut IN ('planifiee', 'ouverte')
              AND sp.date_debut >= CURRENT_DATE
            WHERE f.tenant_id = $1
              AND f.id = $2
              AND f.actif = true
            GROUP BY f.id
          `
            : `
            SELECT f.*, '[]'::json as sessions
            FROM ${formationsTable} f
            WHERE f.tenant_id = $1
              AND f.id = $2
              AND f.actif = true
          `;

          const result = await client.query(pdfFormationSql, [request.tenantId, id]);

          if (result.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "NOT_FOUND",
              message: "Training program not found or inactive",
            });
          }

          const row = result.rows[0];
          formation = {
            id: row.id,
            titre: row.titre,
            slug: row.slug,
            description_courte: row.description_courte,
            objectifs: Array.isArray(row.objectifs)
              ? row.objectifs
              : row.objectifs
              ? JSON.parse(row.objectifs)
              : [],
            programme_detaille: row.programme_detaille
              ? typeof row.programme_detaille === "string"
                ? JSON.parse(row.programme_detaille)
                : row.programme_detaille
              : null,
            prerequis: row.prerequis,
            public_cible: row.public_cible,
            duree_jours: row.duree_jours,
            duree_heures: row.duree_heures,
            prix_ht: row.prix_ht ? parseFloat(row.prix_ht) : null,
            prix_ttc: parseFloat(row.prix_ttc),
            type_certification: row.type_certification,
            nom_certification: row.nom_certification,
            themes: Array.isArray(row.themes) ? row.themes : row.themes ? JSON.parse(row.themes) : [],
            niveau: row.niveau,
            sessions: (row.sessions || []).map((s: any) => {
              // Handle date conversion - date_debut and date_fin might be Date objects or strings
              const formatDate = (date: any): string => {
                if (!date) return "";
                if (date instanceof Date) {
                  return date.toISOString().split("T")[0];
                }
                if (typeof date === "string") {
                  // If it's already a string in ISO format, extract date part
                  return date.split("T")[0];
                }
                return String(date);
              };

              return {
                id: s.id,
                code_session: s.code_session,
                date_debut: formatDate(s.date_debut),
                date_fin: formatDate(s.date_fin),
                horaires: s.horaires,
                mode_formation: s.mode_formation,
                lieu: s.lieu,
                places_disponibles: s.places_disponibles,
                prix_ttc: parseFloat(s.prix_ttc),
              };
            }),
          };
        } finally {
          client.release();
        }

        // Generate PDF with timeout
        const pdfPromise = pdfService.generateProgrammePDF(formation);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("PDF generation timeout")), 30000)
        );

        const pdfBuffer = await Promise.race([pdfPromise, timeoutPromise]) as Buffer;

        reply.type("application/pdf");
        reply.header(
          "Content-Disposition",
          `attachment; filename="programme-${formation.slug}.pdf"`
        );
        return reply.send(pdfBuffer);
      } catch (error: any) {
        fastify.log.error(error);

        if (error.message === "PDF generation timeout") {
          return reply.status(503).send({
            success: false,
            error: "SERVICE_UNAVAILABLE",
            message: "PDF generation is taking longer than expected. Please try again later.",
          });
        }

        // Check for Chrome not found error
        if (error.message && error.message.includes("Could not find Chrome")) {
          return reply.status(503).send({
            success: false,
            error: "CHROME_NOT_FOUND",
            message: "PDF generation service is not properly configured. Please contact the administrator.",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while generating PDF",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/themes - Get available themes
  fastify.get("/themes", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Get available themes",
      description: "Get list of all available themes for filtering with counts",
      response: {
        200: { type: "object" },
        500: { type: "object" },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const themes = await formationService.getThemes(request.tenantId);

        return reply.send({
          success: true,
          data: {
            themes,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching themes",
        });
      }
    },
  });

  // GET /api/v1/formations-pro/stats - Get filter statistics
  fastify.get("/stats", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Get filter statistics",
      description: "Get statistics for filter initialization (price ranges, duration ranges, etc.)",
      response: {
        200: { type: "object" },
        500: { type: "object" },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const stats = await formationService.getStats(request.tenantId);

        return reply.send({
          success: true,
          data: stats,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching statistics",
        });
      }
    },
  });

  // DELETE /api/v1/formations-pro/:id - Delete a formation
  fastify.delete("/:id", {
    schema: {
      tags: ["Formations Professionnelles"],
      summary: "Delete a formation",
      description: "Delete a formation (soft delete by setting actif to false). Cannot delete if formation has active sessions or enrollments.",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "TENANT_REQUIRED",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const { id } = request.params as { id: string };

        fastify.log.info(`[Formations Pro] Deleting formation: ${id} for tenant: ${request.tenantId}`);

        await formationService.deleteFormation(request.tenantId, id);

        fastify.log.info(`[Formations Pro] Formation deleted successfully: ${id}`);

        return reply.send({
          success: true,
          message: "Formation supprimée avec succès",
        });
      } catch (error: any) {
        fastify.log.error(`[Formations Pro] Error deleting formation:`, error);
        
        if (error.message === "FORMATION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Formation not found",
          });
        }

        if (error.message?.startsWith("FORMATION_HAS_ACTIVE_SESSIONS")) {
          const count = error.message.split(":")[1] || "0";
          return reply.status(400).send({
            success: false,
            error: "FORMATION_HAS_ACTIVE_SESSIONS",
            message: `Impossible de supprimer cette formation car elle a ${count} session(s) active(s). Veuillez d'abord annuler ou terminer ces sessions.`,
          });
        }

        if (error.message?.startsWith("FORMATION_HAS_ENROLLMENTS")) {
          const count = error.message.split(":")[1] || "0";
          return reply.status(400).send({
            success: false,
            error: "FORMATION_HAS_ENROLLMENTS",
            message: `Impossible de supprimer cette formation car elle a ${count} inscription(s) en cours.`,
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while deleting the formation",
        });
      }
    },
  });
}
