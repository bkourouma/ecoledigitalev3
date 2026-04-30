/**
 * WaveService
 * 
 * Payment provider service for Wave integration.
 * Implements PaymentProviderService interface.
 */

import axios from 'axios';
import {
  PaymentProviderService,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentVerificationRequest,
  PaymentVerificationResponse,
  WebhookPayload,
} from './payment-provider.interface';

export class WaveService implements PaymentProviderService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.apiKey = process.env.WAVE_API_KEY || '';
    this.apiSecret = process.env.WAVE_API_SECRET || '';
    this.baseUrl = process.env.WAVE_BASE_URL || 'https://api.wave.com/v1';
    this.webhookSecret = process.env.WAVE_WEBHOOK_SECRET || '';
  }

  getProviderName(): string {
    return 'wave';
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    // TODO: Implement Wave API integration
    if (!this.apiKey || !this.apiSecret) {
      return {
        transactionId: request.enrollmentId,
        externalReference: `WAVE-${Date.now()}`,
        status: 'initiated',
        qrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=mock-wave-payment',
        redirectUrl: `${process.env.FRONTEND_URL}/formations-professionnelles/inscription/callback/wave?tx=${request.enrollmentId}`,
        instructions: 'Scannez le QR code ou cliquez sur le lien pour compléter le paiement',
      };
    }

    try {
      // Create checkout session
      const paymentResponse = await axios.post(
        `${this.baseUrl}/checkout/sessions`,
        {
          amount: request.amount,
          currency: request.currency || 'XOF',
          reference: request.enrollmentId,
          callback_url: request.returnUrl,
          webhook_url: `${process.env.API_URL}/api/v1/paiements-pro/webhook/wave`,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        transactionId: request.enrollmentId,
        externalReference: paymentResponse.data.id || null,
        status: 'initiated',
        qrCode: paymentResponse.data.qr_code || null,
        redirectUrl: paymentResponse.data.checkout_url || null,
        instructions: 'Scannez le QR code avec l\'application Wave ou cliquez sur le lien pour compléter le paiement',
      };
    } catch (error: any) {
      console.error('Wave payment initiation error:', error);
      throw new Error(`Wave payment failed: ${error.message}`);
    }
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse> {
    // TODO: Implement Wave payment verification
    return {
      status: 'pending',
      externalReference: request.externalReference || null,
      amount: 0,
    };
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse> {
    // Extract transaction details from Wave webhook payload
    const checkoutId = (payload as any).checkout_id || (payload as any).id;
    const status = (payload as any).status || (payload as any).payment_status;
    const amount = parseFloat((payload as any).amount || '0');

    // Map Wave status to our status
    let mappedStatus: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
    if (status === 'completed' || status === 'paid' || status === 'success') {
      mappedStatus = 'validated';
    } else if (status === 'failed' || status === 'error') {
      mappedStatus = 'failed';
    } else if (status === 'cancelled') {
      mappedStatus = 'cancelled';
    }

    return {
      status: mappedStatus,
      externalReference: checkoutId || null,
      amount,
      paidAt: mappedStatus === 'validated' ? new Date() : undefined,
      metadata: payload,
    };
  }

  verifySignature(payload: WebhookPayload, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('[Wave] Webhook secret not configured, skipping signature verification');
      return true; // Development mode
    }

    // TODO: Implement Wave signature verification
    return signature.length > 0;
  }
}

