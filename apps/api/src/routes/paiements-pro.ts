/**
 * Paiements Pro Routes
 * 
 * API endpoints for payment processing.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  PaymentInitiationRequestSchema,
  PaymentInitiationResponseSchema,
  PaiementProMethod,
} from '@ecoledigitale/contracts/src/paiements-pro';
import { PaiementProService } from '../services/paiement-pro.service';

interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  tenantSlug?: string;
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

export async function paiementsProRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;
  const paiementProService = new PaiementProService(pool);

  /**
   * POST /api/v1/paiements-pro/initier
   * Initiate payment transaction
   */
  fastify.post(
    '/initier',
    {
      schema: {
        description: 'Initiate payment transaction for enrollment',
        tags: ['paiements-pro'],
        body: {
          type: 'object',
          required: ['inscription_id', 'methode_paiement', 'montant'],
          properties: {
            inscription_id: { type: 'string', format: 'uuid' },
            methode_paiement: {
              type: 'string',
              enum: ['orange_money', 'mtn_money', 'wave', 'carte_bancaire', 'tresorpay'],
            },
            montant: { type: 'number', minimum: 0 },
            telephone: { type: 'string', minLength: 8, maxLength: 20 },
            return_url: { type: 'string', format: 'uri' },
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
                  paiement_id: { type: 'string' },
                  transaction_id: { type: 'string' },
                  reference_externe: { type: 'string', nullable: true },
                  ussd_code: { type: 'string' },
                  instructions: { type: 'string' },
                  qr_code: { type: 'string' },
                  redirect_url: { type: 'string' },
                  status_check_url: { type: 'string' },
                  statut: { type: 'string' },
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
        const body = PaymentInitiationRequestSchema.parse(request.body);

        // Validate phone number for mobile money methods
        if (
          (body.methode_paiement === 'orange_money' ||
            body.methode_paiement === 'mtn_money') &&
          !body.telephone
        ) {
          return reply.status(400).send({
            error: 'Phone Required',
            message: 'Phone number is required for mobile money payment methods',
          });
        }

        // Initiate payment
        const result = await paiementProService.initiatePayment(tenantId, body);

        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: error.errors.map((e) => e.message).join(', '),
          });
        }

        console.error('Error initiating payment:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to initiate payment',
        });
      }
    }
  );

  /**
   * GET /api/v1/paiements-pro/:id/statut
   * Get payment status (for polling)
   */
  fastify.get(
    '/:id/statut',
    {
      schema: {
        description: 'Get payment status',
        tags: ['paiements-pro'],
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
              data: {
                type: 'object',
                properties: {
                  statut: { type: 'string' },
                  paiement: { type: 'object' },
                  inscription: { type: 'object' },
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
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        const { id } = request.params as { id: string };
        const payment = await paiementProService.getPaymentById(tenantId, id);

        if (!payment) {
          return reply.status(404).send({
            error: 'Payment Not Found',
            message: 'Payment not found',
          });
        }

        // Get enrollment details
        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          const enrollmentQuery = `
            SELECT id, numero_inscription, statut
            FROM inscriptions_professionnelles
            WHERE id = $1 AND tenant_id = $2
          `;
          const enrollmentResult = await client.query(enrollmentQuery, [
            payment.inscription_id,
            tenantId,
          ]);

          return reply.status(200).send({
            success: true,
            data: {
              statut: payment.statut,
              paiement: {
                id: payment.id,
                numero_transaction: payment.numero_transaction,
                montant: payment.montant,
                methode_paiement: payment.methode_paiement,
                statut: payment.statut,
                date_paiement: payment.date_paiement,
                reference_externe: payment.reference_externe,
              },
              inscription: enrollmentResult.rows[0] || null,
            },
          });
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('Error getting payment status:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to get payment status',
        });
      }
    }
  );

  /**
   * POST /api/v1/paiements-pro/:id/verifier
   * Manually verify payment status with provider
   */
  fastify.post(
    '/:id/verifier',
    {
      schema: {
        description: 'Manually verify payment status with provider',
        tags: ['paiements-pro'],
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
              data: {
                type: 'object',
                properties: {
                  statut: { type: 'string' },
                  message: { type: 'string' },
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
        if (!tenantId) {
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        const { id } = request.params as { id: string };

        // Verify payment with provider
        const verificationResponse = await paiementProService.verifyPaymentWithProvider(
          tenantId,
          id
        );

        // Map provider status to our status
        let status: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule' = 'en_attente';
        if (verificationResponse.status === 'validated') {
          status = 'valide';
        } else if (verificationResponse.status === 'failed') {
          status = 'echoue';
        } else if (verificationResponse.status === 'cancelled') {
          status = 'annule';
        }

        // Update payment status
        await paiementProService.updatePaymentStatus(
          tenantId,
          id,
          status,
          verificationResponse.externalReference,
          verificationResponse.paidAt
        );

        return reply.status(200).send({
          success: true,
          data: {
            statut: status,
            message: `Payment status updated to ${status}`,
          },
        });
      } catch (error) {
        console.error('Error verifying payment:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to verify payment',
        });
      }
    }
  );

  /**
   * POST /api/v1/paiements-pro/webhook/:provider
   * Webhook endpoint for payment provider notifications
   */
  fastify.post(
    '/webhook/:provider',
    {
      schema: {
        description: 'Webhook endpoint for payment provider notifications',
        tags: ['paiements-pro'],
        params: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['orange-money', 'mtn-money', 'wave', 'carte-bancaire', 'tresorpay'],
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { provider } = request.params as { provider: string };

        // Map provider name to PaiementProMethod
        const providerMap: Record<string, PaiementProMethod> = {
          'orange-money': 'orange_money',
          'mtn-money': 'mtn_money',
          'wave': 'wave',
          'carte-bancaire': 'carte_bancaire',
          'tresorpay': 'tresorpay',
        };

        const paymentMethod = providerMap[provider];
        if (!paymentMethod) {
          return reply.status(400).send({
            error: 'Invalid Provider',
            message: `Unknown payment provider: ${provider}`,
          });
        }

        // Resolve tenant in priority order:
        // 1) explicit query param tenant_id added in notify_url
        // 2) tenant resolved by middleware from headers
        // 3) fallback env (legacy)
        const tenantFromQuery = (request.query as any)?.tenant_id as string | undefined;
        const tenantId = tenantFromQuery || (request as any).tenantId || process.env.DEFAULT_TENANT_ID;
        if (!tenantId) {
          console.error('Webhook received but tenant ID not found');
          return reply.status(400).send({
            error: 'Tenant Required',
            message: 'Tenant context is required',
          });
        }

        // Get webhook signature from headers
        const signature = request.headers['x-signature'] || request.headers['x-webhook-signature'] || '';

        // Get raw body for signature verification
        const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

        // Log webhook event
        console.log(`[Webhook] Received webhook from ${provider}`, {
          provider,
          tenantId,
          hasSignature: !!signature,
          payloadKeys: Object.keys(request.body || {}),
        });

        // Handle webhook
        await paiementProService.handleWebhook(
          tenantId,
          paymentMethod,
          request.body as any,
          typeof signature === 'string' ? signature : signature[0] || ''
        );

        return reply.status(200).send({
          status: 'success',
        });
      } catch (error) {
        console.error('Error handling webhook:', error);

        // Return 200 even on error to prevent provider retries for invalid webhooks
        // But log the error for debugging
        if (error instanceof Error && error.message.includes('Invalid webhook signature')) {
          return reply.status(401).send({
            error: 'Invalid Signature',
            message: 'Webhook signature verification failed',
          });
        }

        return reply.status(200).send({
          status: 'error',
          message: error instanceof Error ? error.message : 'Webhook processing failed',
        });
      }
    }
  );
}
