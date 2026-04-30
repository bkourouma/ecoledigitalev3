/**
 * MTNMoneyService
 * 
 * Payment provider service for MTN Money integration.
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

export class MTNMoneyService implements PaymentProviderService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private webhookSecret: string;
  private subscriptionKey: string;

  constructor() {
    this.apiKey = process.env.MTN_MONEY_API_KEY || '';
    this.apiSecret = process.env.MTN_MONEY_API_SECRET || '';
    this.baseUrl = process.env.MTN_MONEY_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.webhookSecret = process.env.MTN_MONEY_WEBHOOK_SECRET || '';
    this.subscriptionKey = process.env.MTN_MONEY_SUBSCRIPTION_KEY || '';
  }

  getProviderName(): string {
    return 'mtn-money';
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    // TODO: Implement MTN Money API integration (Request to Pay)
    if (!this.apiKey || !this.apiSecret) {
      return {
        transactionId: request.enrollmentId,
        externalReference: `MTN-${Date.now()}`,
        status: 'initiated',
        ussdCode: '*182#',
        instructions: `Composez *182# et suivez les instructions pour payer ${request.amount} FCFA`,
      };
    }

    try {
      // Get OAuth token
      const tokenResponse = await axios.post(
        `${this.baseUrl}/collection/token/`,
        {},
        {
          auth: {
            username: this.apiKey,
            password: this.apiSecret,
          },
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Request to Pay
      const paymentResponse = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        {
          amount: request.amount.toString(),
          currency: request.currency || 'XOF',
          externalId: request.enrollmentId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: request.phoneNumber?.replace(/^\+/, '') || '',
          },
          payerMessage: `Paiement formation - ${request.amount} FCFA`,
          payeeNote: `Paiement pour inscription`,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Target-Environment': 'sandbox', // or 'production'
            'X-Reference-Id': request.enrollmentId,
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          },
        }
      );

      return {
        transactionId: request.enrollmentId,
        externalReference: paymentResponse.data.externalId || null,
        status: 'initiated',
        ussdCode: '*182#',
        instructions: `Un code de paiement vous a été envoyé. Composez *182# et suivez les instructions`,
      };
    } catch (error: any) {
      console.error('MTN Money payment initiation error:', error);
      throw new Error(`MTN Money payment failed: ${error.message}`);
    }
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse> {
    // TODO: Implement MTN Money payment verification
    return {
      status: 'pending',
      externalReference: request.externalReference || null,
      amount: 0,
    };
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse> {
    // Extract transaction details from MTN Money webhook payload
    const externalId = (payload as any).externalId || (payload as any).referenceId;
    const status = (payload as any).status || (payload as any).transactionStatus;
    const amount = parseFloat((payload as any).amount || '0');

    // Map MTN Money status to our status
    let mappedStatus: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
    if (status === 'SUCCESSFUL' || status === 'COMPLETED') {
      mappedStatus = 'validated';
    } else if (status === 'FAILED' || status === 'REJECTED') {
      mappedStatus = 'failed';
    } else if (status === 'CANCELLED') {
      mappedStatus = 'cancelled';
    }

    return {
      status: mappedStatus,
      externalReference: externalId || null,
      amount,
      paidAt: mappedStatus === 'validated' ? new Date() : undefined,
      metadata: payload,
    };
  }

  verifySignature(payload: WebhookPayload, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('[MTNMoney] Webhook secret not configured, skipping signature verification');
      return true; // Development mode
    }

    // TODO: Implement MTN Money signature verification
    // MTN Money typically uses HMAC-SHA256
    return signature.length > 0;
  }
}

