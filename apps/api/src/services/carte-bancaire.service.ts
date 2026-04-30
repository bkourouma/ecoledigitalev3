/**
 * CarteBancaireService
 *
 * Payment provider service for bank card payments via CinetPay.
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

export class CarteBancaireService implements PaymentProviderService {
  private accountKey: string;
  private accountPassword: string;
  private baseUrl: string;
  private webhookSecret: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor() {
    this.accountKey = process.env.CINETPAY_ACCOUNT_KEY || '';
    this.accountPassword = process.env.CINETPAY_ACCOUNT_PASSWORD || '';
    this.baseUrl = process.env.CINETPAY_BASE_URL || 'https://api.cinetpay.net';
    this.webhookSecret = process.env.CINETPAY_WEBHOOK_SECRET || '';
  }

  getProviderName(): string {
    return 'carte-bancaire';
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    if (!this.accountKey || !this.accountPassword) {
      throw new Error('CINETPAY_CREDENTIALS_MISSING');
    }

    const response = await axios.post(
      `${this.baseUrl}/v1/oauth/login`,
      {
        api_key: this.accountKey,
        api_password: this.accountPassword,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const token = response.data?.access_token as string | undefined;
    const expiresIn = Number(response.data?.expires_in || 0);

    if (!token) {
      throw new Error('CINETPAY_ACCESS_TOKEN_MISSING');
    }

    this.accessToken = token;
    this.accessTokenExpiresAt = now + Math.max(expiresIn, 300) * 1000;
    return token;
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (!this.accountKey || !this.accountPassword) {
      return {
        transactionId: request.enrollmentId,
        externalReference: `CINET-${Date.now()}`,
        status: 'initiated',
        redirectUrl: `${frontendUrl}/formations-professionnelles/inscription/callback/carte-bancaire?tx=${request.enrollmentId}`,
        instructions: 'CinetPay non configuré: mode simulation actif.',
      };
    }

    try {
      const bearer = await this.getAccessToken();
      const metadata = request.metadata || {};
      const tenantId = (metadata.tenant_id as string | undefined) || '';
      const firstName = (metadata.client_first_name as string | undefined) || 'Client';
      const lastName = (metadata.client_last_name as string | undefined) || 'EcoleDigitale';
      const clientEmail = (metadata.client_email as string | undefined) || 'client@ecoledigitale.local';
      const phone = request.phoneNumber || (metadata.client_phone_number as string | undefined);

      const merchantTransactionId = `CP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 30);
      const successUrl = request.returnUrl || `${frontendUrl}/formations-professionnelles/inscription/callback/carte-bancaire?status=success`;
      const failedUrl = request.returnUrl || `${frontendUrl}/formations-professionnelles/inscription/callback/carte-bancaire?status=failed`;
      const notifyUrl = `${apiUrl}/api/v1/paiements-pro/webhook/carte-bancaire${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''}`;

      const paymentResponse = await axios.post(
        `${this.baseUrl}/v1/payment`,
        {
          currency: request.currency || 'XOF',
          merchant_transaction_id: merchantTransactionId,
          amount: request.amount,
          lang: 'fr',
          designation: `Paiement formation ${request.enrollmentId}`,
          client_email: clientEmail,
          client_phone_number: phone,
          client_first_name: firstName,
          client_last_name: lastName,
          direct_pay: false,
          success_url: successUrl,
          failed_url: failedUrl,
          notify_url: notifyUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const externalReference =
        paymentResponse.data?.payment_token || paymentResponse.data?.transaction_id || null;
      const detailsStatus = String(paymentResponse.data?.details?.status || '').toUpperCase();
      const status: 'pending' | 'initiated' | 'failed' = detailsStatus === 'FAILED' ? 'failed' : 'initiated';

      return {
        transactionId: request.enrollmentId,
        externalReference,
        status,
        redirectUrl: paymentResponse.data?.payment_url || null,
        instructions:
          paymentResponse.data?.details?.message ||
          'Vous allez être redirigé vers la page de paiement CinetPay.',
      };
    } catch (error: any) {
      const message = error?.response?.data?.message || error.message;
      console.error('CinetPay payment initiation error:', message, error?.response?.data);
      throw new Error(`Carte bancaire payment failed: ${message}`);
    }
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse> {
    try {
      const bearer = await this.getAccessToken();
      const ref = request.externalReference || request.transactionId;

      const response = await axios.get(`${this.baseUrl}/v1/payment/${encodeURIComponent(ref)}`, {
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
        timeout: 15000,
      });

      const providerStatus = String(response.data?.status || '').toUpperCase();
      let status: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
      if (providerStatus === 'SUCCESS') status = 'validated';
      else if (providerStatus === 'FAILED') status = 'failed';

      return {
        status,
        externalReference: response.data?.transaction_id || request.externalReference || null,
        amount: Number(response.data?.amount || 0),
        paidAt: providerStatus === 'SUCCESS' ? new Date() : undefined,
        metadata: response.data,
      };
    } catch (error: any) {
      console.error('CinetPay verify error:', error?.response?.data || error.message);
      return {
        status: 'pending',
        externalReference: request.externalReference || null,
        amount: 0,
      };
    }
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse> {
    const transactionId = (payload as any).payment_token || (payload as any).transaction_id || (payload as any).cpm_trans_id;
    const status = String((payload as any).status || (payload as any).cpm_result || '').toUpperCase();
    const amount = parseFloat((payload as any).amount || (payload as any).cpm_amount || '0');

    let mappedStatus: 'pending' | 'validated' | 'failed' | 'cancelled' = 'pending';
    if (status === 'SUCCESS' || status === '00' || status === 'ACCEPTED') {
      mappedStatus = 'validated';
    } else if (status === 'FAILED' || status === 'REJECTED') {
      mappedStatus = 'failed';
    } else if (status === 'CANCELLED') {
      mappedStatus = 'cancelled';
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
    if (!this.webhookSecret) {
      return true;
    }

    return signature.length > 0;
  }
}
