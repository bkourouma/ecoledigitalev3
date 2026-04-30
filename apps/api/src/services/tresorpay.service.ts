/**
 * TresorPayService
 * 
 * Payment provider service for TresorPay integration.
 * Wraps existing TresorPayGatewayService to implement PaymentProviderService interface.
 */

import {
  PaymentProviderService,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentVerificationRequest,
  PaymentVerificationResponse,
  WebhookPayload,
} from './payment-provider.interface';
import { createTresorPayService, TresorPayGatewayService } from './tresorpay-gateway.service';
import { CreatePaymentTransaction, PaymentMethodType } from '@ecoledigitale/contracts';

export class TresorPayService implements PaymentProviderService {
  private tresorPayGateway: TresorPayGatewayService;

  constructor() {
    this.tresorPayGateway = createTresorPayService();
  }

  getProviderName(): string {
    return 'tresorpay';
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    try {
      // Map PaymentInitiationRequest to CreatePaymentTransaction
      const paymentRequest: CreatePaymentTransaction = {
        amount: request.amount,
        currency: request.currency || 'XOF',
        paymentMethod: 'tresorpay' as PaymentMethodType,
        returnUrl: request.returnUrl || `${process.env.FRONTEND_URL}/formations-professionnelles/inscription/callback/tresorpay`,
        feeType: 'formation_professionnelle',
        studentId: request.enrollmentId, // Using enrollmentId as studentId for now
      };

      const customerInfo = {
        name: 'Client Formation',
        email: request.metadata?.email as string || 'client@example.com',
        phone: request.phoneNumber,
      };

      const response = await this.tresorPayGateway.initiatePayment(
        paymentRequest,
        customerInfo,
        request.enrollmentId
      );

      return {
        transactionId: response.transactionId,
        externalReference: response.externalTransactionId || null,
        status: response.status === 'pending' ? 'initiated' : 'failed',
        redirectUrl: response.paymentUrl || null,
        instructions: response.message || 'Vous allez être redirigé vers la page de paiement TresorPay',
      };
    } catch (error: any) {
      console.error('TresorPay payment initiation error:', error);
      throw new Error(`TresorPay payment failed: ${error.message}`);
    }
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse> {
    // TODO: Implement TresorPay payment verification using existing gateway service
    return {
      status: 'pending',
      externalReference: request.externalReference || null,
      amount: 0,
    };
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse> {
    // Use existing TresorPay gateway service to parse webhook
    try {
      // Parse webhook payload using gateway service
      const webhookData = this.tresorPayGateway.parseWebhookPayload(payload as any);
      
      // Map TresorPay webhook status to our format
      let mappedStatus: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
      if (webhookData.status === 'completed') {
        mappedStatus = 'validated';
      } else if (webhookData.status === 'failed') {
        mappedStatus = 'failed';
      } else if (webhookData.status === 'cancelled') {
        mappedStatus = 'cancelled';
      }
      
      return {
        status: mappedStatus,
        externalReference: webhookData.externalTransactionId || null,
        amount: webhookData.amount || 0,
        paidAt: mappedStatus === 'validated' ? new Date() : undefined,
        metadata: webhookData.gatewayResponse || payload,
      };
    } catch (error) {
      console.error('[TresorPay] Error handling webhook:', error);
      throw error;
    }
  }

  verifySignature(payload: WebhookPayload, signature: string): boolean {
    // Use existing TresorPay gateway service to verify signature
    try {
      // Convert payload to string if needed
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return this.tresorPayGateway.verifyWebhookSignature(payloadString, signature);
    } catch (error) {
      console.error('[TresorPay] Error verifying signature:', error);
      // Fallback: if webhook secret not configured, allow in development
      if (!process.env.TRESORPAY_WEBHOOK_SECRET) {
        console.warn('[TresorPay] Webhook secret not configured, skipping signature verification');
        return true;
      }
      return false;
    }
  }
}

