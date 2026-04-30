/**
 * Codes Promo Routes
 * 
 * API endpoints for promotional code validation.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  PromoCodeValidationRequestSchema,
  PromoCodeValidationResponseSchema,
} from '@ecoledigitale/contracts/src/codes-promo';
import { CodePromoService } from '../services/code-promo.service';

interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  tenantSlug?: string;
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

export async function codesPromoRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;
  const codePromoService = new CodePromoService(pool);

  /**
   * POST /api/v1/codes-promo/valider
   * Validate promotional code (public endpoint)
   */
  fastify.post(
    '/valider',
    {
      schema: {
        description: 'Validate promotional code and calculate discount',
        tags: ['codes-promo'],
        body: {
          type: 'object',
          required: ['code', 'montant'],
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 50 },
            formation_id: { type: 'string', format: 'uuid' },
            session_id: { type: 'string', format: 'uuid' },
            montant: { type: 'number', minimum: 0 },
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
                  valide: { type: 'boolean' },
                  code_promo: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      id: { type: 'string' },
                      code: { type: 'string' },
                      type_reduction: { type: 'string', enum: ['pourcentage', 'montant_fixe'] },
                      valeur_reduction: { type: 'number' },
                      description: { type: 'string', nullable: true },
                    },
                  },
                  reduction_montant: { type: 'number' },
                  nouveau_montant: { type: 'number' },
                  message: { type: 'string' },
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

        // Validate request body
        const body = PromoCodeValidationRequestSchema.parse(request.body);

        // Validate code
        const validation = await codePromoService.validateCode(tenantId, body);

        return reply.status(200).send({
          success: true,
          data: validation,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: error.errors.map((e) => e.message).join(', '),
          });
        }

        console.error('Error validating promotional code:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to validate promotional code',
        });
      }
    }
  );
}

