/**
 * OrangeMoneyService
 * 
 * Payment provider service for Orange Money integration.
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

export class OrangeMoneyService implements PaymentProviderService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.apiKey = process.env.ORANGE_MONEY_API_KEY || '';
    this.apiSecret = process.env.ORANGE_MONEY_API_SECRET || '';
    this.baseUrl = process.env.ORANGE_MONEY_BASE_URL || 'https://api.orange.com/orange-money-webpay';
    this.webhookSecret = process.env.ORANGE_MONEY_WEBHOOK_SECRET || '';
  }

  getProviderName(): string {
    return 'orange-money';
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    // TODO: Implement Orange Money API integration
    // For now, return mock response
    if (!this.apiKey || !this.apiSecret) {
      return {
        transactionId: request.enrollmentId,
        externalReference: `OM-${Date.now()}`,
        status: 'initiated',
        ussdCode: '*144#',
        instructions: `Composez *144# et suivez les instructions pour payer ${request.amount} FCFA`,
      };
    }

    try {
      // Get OAuth token
      const tokenResponse = await axios.post(
        `${this.baseUrl}/oauth/v2/token`,
        {
          grant_type: 'client_credentials',
        },
        {
          auth: {
            username: this.apiKey,
            password: this.apiSecret,
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Initiate payment
      const paymentResponse = await axios.post(
        `${this.baseUrl}/orange-money-webpay/v1/webpayment`,
        {
          merchant_key: this.apiKey,
          currency: request.currency || 'XOF',
          order_id: request.enrollmentId,
          amount: request.amount,
          return_url: request.returnUrl,
          cancel_url: request.returnUrl,
          notify_url: `${process.env.API_URL}/api/v1/paiements-pro/webhook/orange-money`,
          lang: 'fr',
          reference: request.enrollmentId,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return {
        transactionId: request.enrollmentId,
        externalReference: paymentResponse.data.pay_token || null,
        status: 'initiated',
        ussdCode: paymentResponse.data.ussd_code || '*144#',
        instructions: paymentResponse.data.instructions || `Composez *144# et suivez les instructions`,
        redirectUrl: paymentResponse.data.payment_url,
      };
    } catch (error: any) {
      console.error('Orange Money payment initiation error:', error);
      throw new Error(`Orange Money payment failed: ${error.message}`);
    }
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse> {
    // TODO: Implement Orange Money payment verification
    return {
      status: 'pending',
      externalReference: request.externalReference || null,
      amount: 0,
    };
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse> {
    // Extract transaction details from Orange Money webhook payload
    // Format varies by provider - adjust based on actual Orange Money webhook structure
    const transactionId = (payload as any).order_id || (payload as any).transaction_id || (payload as any).pay_token;
    const status = (payload as any).status || (payload as any).payment_status;
    const amount = parseFloat((payload as any).amount || '0');

    // Map Orange Money status to our status
    let mappedStatus: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
    if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'PAID') {
      mappedStatus = 'validated';
    } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'REJECTED') {
      mappedStatus = status === 'CANCELLED' ? 'cancelled' : 'failed';
    }

    return {
      status: mappedStatus,
      externalReference: transactionId || null,
      amount,
      paidAt: mappedStatus === 'validated' ? new Date() : undefined,
      metadata: payload,
    };
  }

  verifySignature(payload: WebhookPayload, signature: string): boolean {
    // Development mode: skip verification if secret not configured
    if (!this.webhookSecret) {
      console.warn('[OrangeMoney] Webhook secret not configured, skipping signature verification');
      return true; // Development mode
    }

    // TODO: Implement HMAC-SHA256 signature verification
    // Orange Money typically uses HMAC-SHA256 with the webhook secret
    // const crypto = require('crypto');
    // const expectedSignature = crypto
    //   .createHmac('sha256', this.webhookSecret)
    //   .update(JSON.stringify(payload))
    //   .digest('hex');
    // return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

    // For now, basic check
    return signature.length > 0;
  }
}

