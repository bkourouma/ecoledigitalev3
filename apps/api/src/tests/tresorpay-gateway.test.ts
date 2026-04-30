import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TresorPayGatewayService } from '../services/tresorpay-gateway.service';
import { CreatePaymentTransaction } from '@ecoledigitale/contracts';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('TresorPayGatewayService', () => {
  let service: TresorPayGatewayService;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      apiKey: 'test_api_key',
      secretKey: 'test_secret_key',
      merchantId: 'test_merchant',
      baseUrl: 'https://api.test.tresorpay.com/v1',
      webhookSecret: 'test_webhook_secret',
    };

    service = new TresorPayGatewayService(mockConfig);
    
    // Reset fetch mock
    (fetch as jest.MockedFunction<typeof fetch>).mockReset();
  });

  describe('initiatePayment', () => {
    it('should initiate payment successfully', async () => {
      const paymentRequest: CreatePaymentTransaction = {
        studentId: 'student-123',
        enrollmentId: 'enrollment-123',
        feeType: 'inscription',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const customerInfo = {
        name: 'Test Student',
        email: 'test@student.com',
        phone: '+225 07 12 34 56',
      };

      const transactionId = 'tx-123';

      const mockResponse = {
        status: 'success',
        message: 'Payment initiated successfully',
        data: {
          transaction_id: 'ext_tx_123',
          payment_url: 'https://pay.tresorpay.com/pay/ext_tx_123',
          payment_token: 'token_123',
        },
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.initiatePayment(paymentRequest, customerInfo, transactionId);

      expect(result).toEqual({
        transactionId,
        paymentUrl: 'https://pay.tresorpay.com/pay/ext_tx_123',
        externalTransactionId: 'ext_tx_123',
        status: 'pending',
        message: 'Payment initiated successfully',
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.tresorpay.com/v1/payments/initialize',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test_api_key',
            'X-Merchant-ID': 'test_merchant',
          }),
          body: expect.stringContaining('"amount":50000'),
        })
      );
    });

    it('should handle payment initiation failure', async () => {
      const paymentRequest: CreatePaymentTransaction = {
        studentId: 'student-123',
        enrollmentId: 'enrollment-123',
        feeType: 'inscription',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const customerInfo = {
        name: 'Test Student',
        email: 'test@student.com',
      };

      const transactionId = 'tx-123';

      const mockResponse = {
        status: 'error',
        message: 'Invalid payment method',
        error: 'INVALID_PAYMENT_METHOD',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(
        service.initiatePayment(paymentRequest, customerInfo, transactionId)
      ).rejects.toThrow('Payment initiation failed: Invalid payment method');
    });

    it('should handle network errors', async () => {
      const paymentRequest: CreatePaymentTransaction = {
        studentId: 'student-123',
        enrollmentId: 'enrollment-123',
        feeType: 'inscription',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const customerInfo = {
        name: 'Test Student',
        email: 'test@student.com',
      };

      const transactionId = 'tx-123';

      (fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        service.initiatePayment(paymentRequest, customerInfo, transactionId)
      ).rejects.toThrow('Payment initiation failed: Network error');
    });
  });

  describe('verifyPayment', () => {
    it('should verify payment successfully', async () => {
      const externalTransactionId = 'ext_tx_123';

      const mockResponse = {
        status: 'success',
        data: {
          transaction_id: 'ext_tx_123',
          status: 'completed',
          amount: 50000,
          currency: 'XOF',
          payment_method: 'ORANGE_MONEY',
          processed_at: '2024-08-24T10:30:00Z',
        },
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.verifyPayment(externalTransactionId);

      expect(result).toEqual({
        status: 'completed',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
        processedAt: new Date('2024-08-24T10:30:00Z'),
        gatewayResponse: mockResponse.data,
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.tresorpay.com/v1/payments/ext_tx_123/verify',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test_api_key',
            'X-Merchant-ID': 'test_merchant',
          }),
        })
      );
    });

    it('should handle verification failure', async () => {
      const externalTransactionId = 'ext_tx_123';

      const mockResponse = {
        status: 'error',
        error: 'Transaction not found',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(
        service.verifyPayment(externalTransactionId)
      ).rejects.toThrow('Payment verification failed: Transaction not found');
    });
  });

  describe('processRefund', () => {
    it('should process refund successfully', async () => {
      const externalTransactionId = 'ext_tx_123';
      const amount = 25000;
      const reason = 'Customer request';

      const mockResponse = {
        status: 'success',
        message: 'Refund processed successfully',
        data: {
          refund_id: 'refund_123',
          transaction_id: 'ext_tx_123',
          amount: 25000,
          status: 'pending',
        },
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.processRefund(externalTransactionId, amount, reason);

      expect(result).toEqual({
        refundId: 'refund_123',
        status: 'pending',
        amount: 25000,
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.tresorpay.com/v1/refunds',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test_api_key',
            'X-Merchant-ID': 'test_merchant',
          }),
          body: expect.stringContaining('"transaction_id":"ext_tx_123"'),
        })
      );
    });

    it('should handle refund failure', async () => {
      const externalTransactionId = 'ext_tx_123';
      const amount = 25000;
      const reason = 'Customer request';

      const mockResponse = {
        status: 'error',
        message: 'Refund not allowed',
        error: 'REFUND_NOT_ALLOWED',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(
        service.processRefund(externalTransactionId, amount, reason)
      ).rejects.toThrow('Refund processing failed: Refund not allowed');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const payload = JSON.stringify({
        transaction_id: 'ext_tx_123',
        status: 'completed',
        amount: 50000,
      });

      // Generate expected signature using the same algorithm
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', mockConfig.webhookSecret)
        .update(payload)
        .digest('hex');

      const isValid = service.verifyWebhookSignature(payload, expectedSignature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid webhook signature', () => {
      const payload = JSON.stringify({
        transaction_id: 'ext_tx_123',
        status: 'completed',
        amount: 50000,
      });

      const invalidSignature = 'invalid_signature';

      const isValid = service.verifyWebhookSignature(payload, invalidSignature);

      expect(isValid).toBe(false);
    });

    it('should handle signature verification errors gracefully', () => {
      const payload = 'invalid json';
      const signature = 'some_signature';

      const isValid = service.verifyWebhookSignature(payload, signature);

      expect(isValid).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('should parse webhook payload correctly', () => {
      const webhookPayload = {
        transaction_id: 'ext_tx_123',
        status: 'success',
        amount: 50000,
        currency: 'XOF',
        payment_method: 'ORANGE_MONEY',
        processed_at: '2024-08-24T10:30:00Z',
      };

      const result = service.parseWebhookPayload(webhookPayload);

      expect(result).toEqual({
        externalTransactionId: 'ext_tx_123',
        status: 'completed',
        amount: 50000,
        currency: 'XOF',
        gatewayResponse: webhookPayload,
      });
    });

    it('should handle different status mappings', () => {
      const testCases = [
        { input: 'success', expected: 'completed' },
        { input: 'completed', expected: 'completed' },
        { input: 'failed', expected: 'failed' },
        { input: 'error', expected: 'failed' },
        { input: 'cancelled', expected: 'cancelled' },
        { input: 'canceled', expected: 'cancelled' },
        { input: 'unknown', expected: 'failed' },
      ];

      testCases.forEach(({ input, expected }) => {
        const webhookPayload = {
          transaction_id: 'ext_tx_123',
          status: input,
          amount: 50000,
          currency: 'XOF',
        };

        const result = service.parseWebhookPayload(webhookPayload);
        expect(result.status).toBe(expected);
      });
    });
  });

  describe('payment method mapping', () => {
    it('should map internal payment methods to gateway format', () => {
      const testCases = [
        { internal: 'orange_money', gateway: 'ORANGE_MONEY' },
        { internal: 'mtn_money', gateway: 'MTN_MONEY' },
        { internal: 'moov_money', gateway: 'MOOV_MONEY' },
        { internal: 'card', gateway: 'CARD' },
        { internal: 'bank_transfer', gateway: 'BANK_TRANSFER' },
      ];

      testCases.forEach(({ internal, gateway }) => {
        // This would test the private method if it were public
        // For now, we test it indirectly through initiatePayment
        const paymentRequest: CreatePaymentTransaction = {
          studentId: 'student-123',
          enrollmentId: 'enrollment-123',
          feeType: 'inscription',
          amount: 50000,
          currency: 'XOF',
          paymentMethod: internal as any,
        };

        const customerInfo = {
          name: 'Test Student',
          email: 'test@student.com',
        };

        (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'success',
            data: { transaction_id: 'ext_tx_123' },
          }),
        } as Response);

        service.initiatePayment(paymentRequest, customerInfo, 'tx-123');

        expect(fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"payment_method":"${gateway}"`),
          })
        );

        (fetch as jest.MockedFunction<typeof fetch>).mockReset();
      });
    });
  });
});
