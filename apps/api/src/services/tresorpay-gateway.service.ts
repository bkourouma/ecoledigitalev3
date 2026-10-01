import crypto from 'crypto';
// Les types viennent de `student-payments` : ce fichier n'est pas ré-exporté par la racine du paquet
// (conflit de noms), et la racine ne fournissait que `PaymentInitiationResponse` — via le contrat
// des paiements de formation professionnelle, aujourd'hui retiré.
import type {
  PaymentInitiationResponse,
  PaymentWebhook,
  CreatePaymentTransaction,
  TransactionStatus,
  PaymentMethodType,
} from '@ecoledigitale/contracts/src/student-payments';

interface TresorPayConfig {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  baseUrl: string;
  webhookSecret: string;
}

interface TresorPayPaymentRequest {
  amount: number;
  currency: string;
  transaction_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  payment_method: string;
  return_url?: string;
  cancel_url?: string;
  webhook_url: string;
  description: string;
}

interface TresorPayPaymentResponse {
  status: 'success' | 'error';
  message: string;
  data?: {
    transaction_id: string;
    payment_url?: string;
    payment_token?: string;
  };
  error?: string;
}

interface TresorPayVerificationResponse {
  status: 'success' | 'error';
  data?: {
    transaction_id: string;
    status: 'pending' | 'completed' | 'failed' | 'cancelled';
    amount: number;
    currency: string;
    payment_method: string;
    processed_at?: string;
  };
  error?: string;
}

interface TresorPayRefundRequest {
  transaction_id: string;
  amount: number;
  reason: string;
}

interface TresorPayRefundResponse {
  status: 'success' | 'error';
  message: string;
  data?: {
    refund_id: string;
    transaction_id: string;
    amount: number;
    status: 'pending' | 'completed' | 'failed';
  };
  error?: string;
}

export class TresorPayGatewayService {
  private config: TresorPayConfig;

  constructor(config: TresorPayConfig) {
    this.config = config;
  }

  /**
   * Initialize a payment transaction with TresorPay
   */
  async initiatePayment(
    paymentRequest: CreatePaymentTransaction,
    customerInfo: {
      name: string;
      email: string;
      phone?: string;
    },
    transactionId: string
  ): Promise<PaymentInitiationResponse> {
    try {
      // Fallback to a safe mock response in development when config is incomplete
      if (!this.config.apiKey || !this.config.secretKey || !this.config.merchantId) {
        const appBase = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
        return {
          transactionId,
          externalTransactionId: `mock_${transactionId}`,
          paymentUrl: `${appBase}/payments/mock?tx=${transactionId}`,
          status: 'pending' as TransactionStatus,
          message: 'Mock payment (development mode) – missing TresorPay configuration',
        };
      }

      const apiBase = process.env.API_BASE_URL || process.env.PUBLIC_API_URL || 'http://localhost:4000';
      const tresorPayRequest: TresorPayPaymentRequest = {
        amount: paymentRequest.amount,
        currency: paymentRequest.currency,
        transaction_id: transactionId,
        customer_name: customerInfo.name,
        customer_email: customerInfo.email,
        customer_phone: customerInfo.phone,
        payment_method: this.mapPaymentMethod(paymentRequest.paymentMethod),
        return_url: paymentRequest.returnUrl,
        cancel_url: paymentRequest.returnUrl, // Use same URL for cancel
        webhook_url: `${apiBase}/api/v1/student-payments/webhook`,
        description: `Payment for ${paymentRequest.feeType} - Student ID: ${paymentRequest.studentId}`,
      };

      const response = await this.makeApiCall<TresorPayPaymentResponse>(
        '/payments/initialize',
        'POST',
        tresorPayRequest
      );

      if (response.status === 'success' && response.data) {
        return {
          transactionId,
          paymentUrl: response.data.payment_url,
          externalTransactionId: response.data.transaction_id,
          status: 'pending' as TransactionStatus,
          message: response.message,
        };
      } else {
        throw new Error(response.error || response.message || 'Payment initialization failed');
      }
    } catch (error) {
      console.error('TresorPay payment initiation error:', error);
      throw new Error(`Payment initiation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify payment status with TresorPay
   */
  async verifyPayment(externalTransactionId: string): Promise<{
    status: TransactionStatus;
    amount?: number;
    currency?: string;
    paymentMethod?: PaymentMethodType;
    processedAt?: Date;
    gatewayResponse?: any;
  }> {
    try {
      // Use mock behavior if configuration is incomplete
      if (!this.config.apiKey || !this.config.secretKey || !this.config.merchantId) {
        console.log('[TresorPay] Using mock verification for transaction:', externalTransactionId);

        // Mock successful verification
        const mockResponse = {
          status: 'completed' as TransactionStatus,
          amount: 50000,
          currency: 'XOF',
          paymentMethod: 'orange_money' as PaymentMethodType,
          processedAt: new Date(),
          gatewayResponse: {
            transaction_id: externalTransactionId,
            status: 'completed',
            amount: 50000,
            currency: 'XOF',
            payment_method: 'ORANGE_MONEY',
            processed_at: new Date().toISOString(),
            mock: true
          }
        };

        return mockResponse;
      }

      const response = await this.makeApiCall<TresorPayVerificationResponse>(
        `/payments/${externalTransactionId}/verify`,
        'GET'
      );

      if (response.status === 'success' && response.data) {
        return {
          status: this.mapTransactionStatus(response.data.status),
          amount: response.data.amount,
          currency: response.data.currency,
          paymentMethod: this.mapPaymentMethodFromGateway(response.data.payment_method),
          processedAt: response.data.processed_at ? new Date(response.data.processed_at) : undefined,
          gatewayResponse: response.data,
        };
      } else {
        throw new Error(response.error || 'Payment verification failed');
      }
    } catch (error) {
      console.error('TresorPay payment verification error:', error);
      throw new Error(`Payment verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process refund with TresorPay
   */
  async processRefund(
    externalTransactionId: string,
    amount: number,
    reason: string
  ): Promise<{
    refundId: string;
    status: 'pending' | 'completed' | 'failed';
    amount: number;
  }> {
    try {
      const refundRequest: TresorPayRefundRequest = {
        transaction_id: externalTransactionId,
        amount,
        reason,
      };

      const response = await this.makeApiCall<TresorPayRefundResponse>(
        '/refunds',
        'POST',
        refundRequest
      );

      if (response.status === 'success' && response.data) {
        return {
          refundId: response.data.refund_id,
          status: response.data.status,
          amount: response.data.amount,
        };
      } else {
        throw new Error(response.error || response.message || 'Refund processing failed');
      }
    } catch (error) {
      console.error('TresorPay refund processing error:', error);
      throw new Error(`Refund processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify webhook signature and parse webhook payload
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.config.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('Webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Parse webhook payload
   */
  parseWebhookPayload(payload: any): PaymentWebhook {
    return {
      externalTransactionId: payload.transaction_id,
      status: this.mapWebhookStatus(payload.status),
      amount: payload.amount,
      currency: payload.currency,
      gatewayResponse: payload,
    };
  }

  /**
   * Make API call to TresorPay
   */
  private async makeApiCall<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: any
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timestamp = Date.now().toString();
    const signature = this.generateSignature(method, endpoint, data, timestamp);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
      'X-Merchant-ID': this.config.merchantId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    };

    const config: RequestInit = {
      method,
      headers,
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(url, config);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generate API signature for TresorPay
   */
  private generateSignature(
    method: string,
    endpoint: string,
    data: any,
    timestamp: string
  ): string {
    const payload = method + endpoint + (data ? JSON.stringify(data) : '') + timestamp;
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(payload)
      .digest('hex');
  }

  /**
   * Map internal payment method to TresorPay format
   */
  private mapPaymentMethod(method: PaymentMethodType): string {
    const mapping: Record<PaymentMethodType, string> = {
      orange_money: 'ORANGE_MONEY',
      mtn_money: 'MTN_MONEY',
      moov_money: 'MOOV_MONEY',
      card: 'CARD',
      bank_transfer: 'BANK_TRANSFER',
      especes: 'CASH',
    };
    return mapping[method] || 'CARD';
  }

  /**
   * Map TresorPay payment method to internal format
   */
  private mapPaymentMethodFromGateway(method: string): PaymentMethodType {
    const mapping: Record<string, PaymentMethodType> = {
      ORANGE_MONEY: 'orange_money',
      MTN_MONEY: 'mtn_money',
      MOOV_MONEY: 'moov_money',
      CARD: 'card',
      BANK_TRANSFER: 'bank_transfer',
      CASH: 'especes',
    };
    return mapping[method] || 'card';
  }

  /**
   * Map TresorPay transaction status to internal format
   */
  private mapTransactionStatus(status: string): TransactionStatus {
    const mapping: Record<string, TransactionStatus> = {
      pending: 'pending',
      processing: 'processing',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };
    return mapping[status] || 'pending';
  }

  /**
   * Map webhook status to internal format
   */
  private mapWebhookStatus(status: string): 'completed' | 'failed' | 'cancelled' {
    const mapping: Record<string, 'completed' | 'failed' | 'cancelled'> = {
      success: 'completed',
      completed: 'completed',
      failed: 'failed',
      error: 'failed',
      cancelled: 'cancelled',
      canceled: 'cancelled',
    };
    return mapping[status] || 'failed';
  }
}

/**
 * Factory function to create TresorPay service instance
 */
export function createTresorPayService(tenantId?: string): TresorPayGatewayService {
  // In a real implementation, you would fetch tenant-specific config from database
  const config: TresorPayConfig = {
    apiKey: process.env.TRESORPAY_API_KEY || '',
    secretKey: process.env.TRESORPAY_SECRET_KEY || '',
    merchantId: process.env.TRESORPAY_MERCHANT_ID || '',
    baseUrl: process.env.TRESORPAY_BASE_URL || 'https://api.tresorpay.com/v1',
    webhookSecret: process.env.TRESORPAY_WEBHOOK_SECRET || '',
  };

  // In development or when config is incomplete, proceed with a warning.
  if (!config.apiKey || !config.secretKey || !config.merchantId) {
    console.warn('[TresorPay] Configuration incomplete. Using mock initiation/verification behavior.');
  }

  return new TresorPayGatewayService(config);
}
