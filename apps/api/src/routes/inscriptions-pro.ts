/**
 * Inscriptions Professionnelles Routes
 * 
 * API endpoints for professional training enrollment management.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  IndividualEnrollmentRequestSchema,
  CompanyEnrollmentRequestSchema,
  CompanySearchRequestSchema,
  CompanySearchResponseSchema,
  AvailabilityCheckRequestSchema,
  AvailabilityCheckResponseSchema,
  EnrollmentCreationResponseSchema,
} from '@ecoledigitale/contracts/src/inscriptions-pro';
import { InscriptionProService } from '../services/inscription-pro.service';

interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  tenantSlug?: string;
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

export async function inscriptionsProRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;
  const inscriptionService = new InscriptionProService(pool);

  /**
   * POST /api/v1/inscriptions-pro/verifier-disponibilite
   * Check session availability (public endpoint)
   */
  fastify.post(
    '/verifier-disponibilite',
    {
      schema: {
        description: 'Check real-time session availability',
        tags: ['inscriptions-pro'],
        body: {
          type: 'object',
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            formation_pro_id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  disponible: { type: 'boolean' },
                  places_restantes: { type: 'number' },
                  message: { type: 'string' },
                  session: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      code_session: { type: 'string' },
                      date_debut: { type: 'string' },
                      date_fin: { type: 'string' },
                      places_totales: { type: 'number' },
                      places_reservees: { type: 'number' },
                      places_disponibles: { type: 'number' },
                      statut: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        // Get tenant ID from request (required for RLS)
        const tenantId = request.tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        // Validate request body
        const body = AvailabilityCheckRequestSchema.parse(request.body);

        const availability = await inscriptionService.checkDisponibilite(tenantId, {
          session_id: body.session_id,
          formation_pro_id: body.formation_pro_id,
        });

        const payload: Record<string, unknown> = {
          disponible: availability.disponible,
          places_restantes: availability.places_restantes,
          message: availability.message,
        };
        if (availability.session) {
          payload.session = {
            id: availability.session.id,
            code_session: availability.session.code_session,
            date_debut: availability.session.date_debut.toISOString(),
            date_fin: availability.session.date_fin.toISOString(),
            places_totales: availability.session.places_totales,
            places_reservees: availability.session.places_reservees,
            places_disponibles: availability.session.places_disponibles,
            statut: availability.session.statut,
          };
        }
        if ((availability as any).formation) {
          payload.formation = (availability as any).formation;
        }

        return reply.status(200).send({
          success: true,
          data: payload,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: error.errors.map((e) => e.message).join(', '),
          });
        }

        if (
          error instanceof Error &&
          (error.message === 'Session not found' || error.message === 'Formation not found')
        ) {
          return reply.status(404).send({
            error: 'Not Found',
            message: error.message,
          });
        }

        console.error('Error checking availability:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to check session availability',
        });
      }
    }
  );

  /**
   * POST /api/v1/inscriptions-pro/creer
   * Create individual enrollment (public endpoint, optional auth)
   */
  fastify.post(
    '/creer',
    {
      schema: {
        description: 'Create a new enrollment with temporary reservation',
        tags: ['inscriptions-pro'],
        body: {
          type: 'object',
          required: ['type_inscription', 'cgv_accepte'],
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            formation_pro_id: { type: 'string', format: 'uuid' },
            type_inscription: { type: 'string', enum: ['individuelle', 'entreprise'] },
            apprenant: {
              type: 'object',
              properties: {
                civilite: { type: 'string', enum: ['M.', 'Mme', 'Autre'] },
                nom: { type: 'string' },
                prenom: { type: 'string' },
                email: { type: 'string', format: 'email' },
                telephone: { type: 'string' },
                poste: { type: 'string' },
              },
            },
            apprenant_id: { type: 'string', format: 'uuid' },
            code_promo: { type: 'string' },
            cgv_accepte: { type: 'boolean' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  inscription: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      numero_inscription: { type: 'string' },
                      session_id: { type: 'string', nullable: true },
                      formation_pro_id: { type: 'string', nullable: true },
                      apprenant_id: { type: 'string' },
                      entreprise_id: { type: 'string', nullable: true },
                      type_inscription: { type: 'string' },
                      statut: { type: 'string' },
                      montant_ht: { type: 'number' },
                      montant_ttc: { type: 'number' },
                      code_promo_utilise: { type: 'string', nullable: true },
                      reduction_appliquee: { type: 'number' },
                      date_inscription: { type: 'string' },
                    },
                  },
                  montant_final: { type: 'number' },
                  reduction_appliquee: { type: 'number' },
                  next_step: { type: 'string' },
                  reservation_expires_at: { type: 'string' },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        // Get tenant ID from request (required for RLS)
        const tenantId = request.tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        // Validate request body based on type
        const rawBody = request.body as any;
        const typeInscription = rawBody.type_inscription;

        // Check CGV acceptance
        if (!rawBody.cgv_accepte) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: 'Terms and conditions must be accepted',
          });
        }

        let enrollment;
        if (typeInscription === 'entreprise') {
          // Validate company enrollment request
          const body = CompanyEnrollmentRequestSchema.parse(request.body);
          enrollment = await inscriptionService.createCompanyEnrollment(tenantId, body);
        } else {
          // Validate individual enrollment request
          const body = IndividualEnrollmentRequestSchema.parse(request.body);
          enrollment = await inscriptionService.createIndividualEnrollment(tenantId, body);
        }

        // Calculate reservation expiration (15 minutes from now)
        const reservationExpiresAt = new Date();
        reservationExpiresAt.setMinutes(reservationExpiresAt.getMinutes() + 15);

        return reply.status(201).send({
          success: true,
          data: {
            inscription: {
              id: enrollment.id,
              numero_inscription: enrollment.numero_inscription,
              session_id: enrollment.session_id ?? null,
              formation_pro_id: enrollment.formation_pro_id ?? null,
              apprenant_id: enrollment.apprenant_id,
              entreprise_id: enrollment.entreprise_id,
              type_inscription: enrollment.type_inscription,
              statut: enrollment.statut,
              montant_ht: enrollment.montant_ht,
              montant_ttc: enrollment.montant_ttc,
              code_promo_utilise: enrollment.code_promo_utilise,
              reduction_appliquee: enrollment.reduction_appliquee,
              date_inscription: enrollment.date_inscription.toISOString(),
            },
            montant_final: enrollment.montant_ttc,
            reduction_appliquee: enrollment.reduction_appliquee,
            next_step: 'paiement',
            reservation_expires_at: reservationExpiresAt.toISOString(),
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: error.errors.map((e) => e.message).join(', '),
          });
        }

        if (error instanceof Error) {
          // Check for specific error messages
          if (error.message.includes('not available') || error.message.includes('Session')) {
            return reply.status(400).send({
              error: 'Bad Request',
              message: error.message,
            });
          }
          
          // Log detailed error for debugging
          fastify.log.error('Error creating enrollment:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
          });
          
          // Return error message to client
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: error.message || 'Failed to create enrollment',
          });
        }

        fastify.log.error('Unknown error creating enrollment:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create enrollment',
        });
      }
    }
  );

  /**
   * GET /api/v1/entreprises/rechercher
   * Search companies by raison_sociale or SIRET (public endpoint)
   */
  fastify.get(
    '/entreprises/rechercher',
    {
      schema: {
        description: 'Search companies by name or SIRET',
        tags: ['inscriptions-pro'],
        querystring: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  entreprises: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        raison_sociale: { type: 'string' },
                        siret: { type: 'string', nullable: true },
                        adresse: { type: 'string', nullable: true },
                        code_postal: { type: 'string', nullable: true },
                        ville: { type: 'string', nullable: true },
                        pays: { type: 'string', nullable: true },
                        telephone: { type: 'string', nullable: true },
                        email: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        // Get tenant ID from request (required for RLS)
        const tenantId = request.tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        // Validate query parameter
        const queryParams = CompanySearchRequestSchema.parse(request.query);
        const { query } = queryParams;

        // Search companies
        const entreprises = await inscriptionService.searchCompanies(tenantId, query);

        return reply.status(200).send({
          success: true,
          data: {
            entreprises,
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: error.errors.map((e) => e.message).join(', '),
          });
        }

        console.error('Error searching companies:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to search companies',
        });
      }
    }
  );

  /**
   * GET /api/v1/inscriptions-pro/:id/facture
   * Download invoice PDF
   */
  fastify.get(
    '/:id/facture',
    {
      schema: {
        description: 'Download invoice PDF for confirmed enrollment',
        tags: ['inscriptions-pro'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        const { id } = request.params as { id: string };

        // Get enrollment with invoice number
        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          const enrollmentQuery = `
            SELECT facture_numero, statut
            FROM inscriptions_professionnelles
            WHERE id = $1 AND tenant_id = $2
          `;
          const enrollmentResult = await client.query(enrollmentQuery, [id, tenantId]);

          if (enrollmentResult.rows.length === 0) {
            return reply.status(404).send({
              error: 'Enrollment Not Found',
              message: 'Enrollment not found',
            });
          }

          const enrollment = enrollmentResult.rows[0];

          if (!enrollment.facture_numero) {
            return reply.status(404).send({
              error: 'Invoice Not Found',
              message: 'Invoice has not been generated yet',
            });
          }

          // Read invoice PDF
          const { InvoiceService } = await import('../services/invoice.service');
          const invoiceService = new InvoiceService();
          const invoiceBuffer = await invoiceService.readInvoiceBuffer(enrollment.facture_numero);

          // Set headers for PDF download
          reply.header('Content-Type', 'application/pdf');
          reply.header('Content-Disposition', `attachment; filename="facture-${enrollment.facture_numero}.pdf"`);
          reply.header('Content-Length', invoiceBuffer.length.toString());

          return reply.send(invoiceBuffer);
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('Error downloading invoice:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to download invoice',
        });
      }
    }
  );

  /**
   * GET /api/v1/inscriptions-pro/:id/confirmation
   * Get enrollment confirmation data
   */
  fastify.get(
    '/:id/confirmation',
    {
      schema: {
        description: 'Get enrollment confirmation details',
        tags: ['inscriptions-pro'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        const { id } = request.params as { id: string };

        // Get enrollment details with all related information
        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          const enrollmentQuery = `
            SELECT 
              i.id,
              i.numero_inscription,
              i.statut,
              i.montant_ht,
              i.montant_ttc,
              i.code_promo_utilise,
              i.reduction_appliquee,
              i.facture_numero,
              i.facture_url,
              i.date_inscription,
              s.code_session,
              s.date_debut,
              s.date_fin,
              s.mode_formation,
              f.titre as formation_titre,
              f.description as formation_description,
              u.email as apprenant_email,
              up.nom as apprenant_nom,
              up.prenom as apprenant_prenom,
              up.telephone as apprenant_telephone,
              p.methode_paiement,
              p.numero_transaction,
              p.date_paiement
            FROM inscriptions_professionnelles i
            JOIN sessions_professionnelles s ON i.session_id = s.id
            JOIN formations_professionnelles f ON s.formation_pro_id = f.id
            JOIN users u ON i.apprenant_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
            WHERE i.id = $1 AND i.tenant_id = $2
          `;
          const enrollmentResult = await client.query(enrollmentQuery, [id, tenantId]);

          if (enrollmentResult.rows.length === 0) {
            return reply.status(404).send({
              error: 'Enrollment Not Found',
              message: 'Enrollment not found',
            });
          }

          const enrollment = enrollmentResult.rows[0];

          return reply.status(200).send({
            success: true,
            data: {
              inscription: {
                id: enrollment.id,
                numero_inscription: enrollment.numero_inscription,
                statut: enrollment.statut,
                date_inscription: enrollment.date_inscription.toISOString(),
                montant_ht: parseFloat(enrollment.montant_ht),
                montant_ttc: parseFloat(enrollment.montant_ttc),
                code_promo_utilise: enrollment.code_promo_utilise,
                reduction_appliquee: parseFloat(enrollment.reduction_appliquee || '0'),
                facture_numero: enrollment.facture_numero,
                facture_url: enrollment.facture_url,
              },
              session: {
                code: enrollment.code_session,
                date_debut: enrollment.date_debut.toISOString(),
                date_fin: enrollment.date_fin.toISOString(),
                mode_formation: enrollment.mode_formation,
              },
              formation: {
                titre: enrollment.formation_titre,
                description: enrollment.formation_description,
              },
              apprenant: {
                nom: enrollment.apprenant_nom,
                prenom: enrollment.apprenant_prenom,
                email: enrollment.apprenant_email,
                telephone: enrollment.apprenant_telephone,
              },
              paiement: enrollment.methode_paiement ? {
                methode: enrollment.methode_paiement,
                numero_transaction: enrollment.numero_transaction,
                date_paiement: enrollment.date_paiement ? enrollment.date_paiement.toISOString() : null,
              } : null,
            },
          });
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('Error getting enrollment confirmation:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to get enrollment confirmation',
        });
      }
    }
  );

  /**
   * GET /api/v1/mon-compte/inscriptions-pro
   * Get user's enrollment history with filtering
   */
  fastify.get(
    '/mon-compte/inscriptions-pro',
    {
      schema: {
        description: 'Get user enrollment history with filtering and pagination',
        tags: ['inscriptions-pro'],
        querystring: {
          type: 'object',
          properties: {
            statut: {
              type: 'string',
              enum: ['en_attente', 'confirmee', 'annulee', 'terminee', 'toutes'],
            },
            date_debut: { type: 'string', format: 'date-time' },
            date_fin: { type: 'string', format: 'date-time' },
            search: { type: 'string', maxLength: 100 },
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 50, default: 10 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  inscriptions: {
                    type: 'array',
                    items: { type: 'object' },
                  },
                  pagination: {
                    type: 'object',
                    properties: {
                      page: { type: 'number' },
                      limit: { type: 'number' },
                      total: { type: 'number' },
                      totalPages: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.tenantId;
        const userId = request.user?.id;

        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        if (!userId) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Parse query parameters
        const query = request.query as {
          statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | 'toutes';
          date_debut?: string;
          date_fin?: string;
          search?: string;
          page?: number;
          limit?: number;
        };

        // Get user enrollments
        const result = await inscriptionService.getUserEnrollments(tenantId, userId, {
          statut: query.statut,
          date_debut: query.date_debut,
          date_fin: query.date_fin,
          search: query.search,
          page: query.page ? parseInt(query.page.toString()) : 1,
          limit: query.limit ? parseInt(query.limit.toString()) : 10,
        });

        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error('Error getting enrollment history:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to get enrollment history',
        });
      }
    }
  );

  /**
   * GET /api/v1/admin/inscriptions-pro
   * Get all enrollments with filtering (admin only)
   */
  fastify.get(
    '/admin/inscriptions-pro',
    {
      schema: {
        description: 'Get all professional training enrollments with filtering and pagination (admin only)',
        tags: ['inscriptions-pro'],
        querystring: {
          type: 'object',
          properties: {
            statut: {
              type: 'string',
              enum: ['en_attente', 'confirmee', 'annulee', 'terminee'],
            },
            session_id: { type: 'string', format: 'uuid' },
            date_debut: { type: 'string', format: 'date-time' },
            date_fin: { type: 'string', format: 'date-time' },
            search: { type: 'string', maxLength: 100 },
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  inscriptions: {
                    type: 'array',
                    items: { type: 'object' },
                  },
                  pagination: {
                    type: 'object',
                    properties: {
                      page: { type: 'number' },
                      limit: { type: 'number' },
                      total: { type: 'number' },
                      totalPages: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.tenantId;
        const user = request.user;

        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        if (!user) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Check admin role
        if (!user.roles || !user.roles.includes('admin')) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Admin access required',
          });
        }

        // Parse query parameters
        const query = request.query as {
          statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
          session_id?: string;
          date_debut?: string;
          date_fin?: string;
          search?: string;
          page?: number;
          limit?: number;
        };

        // Get all enrollments
        const result = await inscriptionService.getAllEnrollments(tenantId, {
          statut: query.statut,
          session_id: query.session_id,
          date_debut: query.date_debut,
          date_fin: query.date_fin,
          search: query.search,
          page: query.page ? parseInt(query.page.toString()) : 1,
          limit: query.limit ? parseInt(query.limit.toString()) : 20,
        });

        // Log before sending to verify data structure
        console.log('[AdminInscriptionsRoute] Before send:', {
          inscriptionsCount: result.inscriptions?.length || 0,
          firstInscriptionId: result.inscriptions?.[0]?.id || null,
          firstInscriptionKeys: result.inscriptions?.[0] ? Object.keys(result.inscriptions[0]) : [],
          firstInscriptionStringified: result.inscriptions?.[0] ? JSON.stringify(result.inscriptions[0]).substring(0, 200) : null,
        });

        // Prepare response data
        const responseData = {
          success: true,
          data: result,
        };

        // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
        // This ensures the exact JSON string is sent without any modification
        const responseString = JSON.stringify(responseData);
        console.log('[AdminInscriptionsRoute] Response string length:', responseString.length);
        console.log('[AdminInscriptionsRoute] Response string preview:', responseString.substring(0, 500));

        reply.type('application/json');
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(responseString);
        reply.sent = true; // Tell Fastify that the response has been sent
        return;
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to get enrollments',
        });
      }
    }
  );

  /**
   * PATCH /api/v1/inscriptions-pro/:id/annuler
   * Cancel enrollment (authenticated user endpoint)
   */
  fastify.patch(
    '/:id/annuler',
    {
      schema: {
        description: 'Cancel an enrollment',
        tags: ['inscriptions-pro'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  message: { type: 'string' },
                  refundInitiated: { type: 'boolean' },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          401: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          403: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.tenantId;
        const userId = request.user?.id;
        const { id } = request.params as { id: string };

        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        if (!userId) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Cancel enrollment
        const result = await inscriptionService.cancelInscription(tenantId, id, userId);

        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (error) {
        if (error instanceof Error) {
          // Check for specific error messages
          if (error.message.includes('not found')) {
            return reply.status(404).send({
              error: 'Not Found',
              message: error.message,
            });
          }
          
          if (error.message.includes('permission') || error.message.includes('do not have')) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: error.message,
            });
          }

          if (error.message.includes('already started') || error.message.includes('Cannot cancel')) {
            return reply.status(400).send({
              error: 'Bad Request',
              message: error.message,
            });
          }

          fastify.log.error('Error cancelling enrollment:', {
            message: error.message,
            stack: error.stack,
          });

          return reply.status(500).send({
            error: 'Internal Server Error',
            message: error.message || 'Failed to cancel enrollment',
          });
        }

        fastify.log.error('Unknown error cancelling enrollment:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to cancel enrollment',
        });
      }
    }
  );
}

