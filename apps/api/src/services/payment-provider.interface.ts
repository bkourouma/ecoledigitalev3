/**
 * Payment Provider Service Interface
 * 
 * Defines the common interface that all payment provider services must implement.
 * This abstraction allows for easy addition/removal of payment providers and
 * simplifies payment processing logic.
 */

export interface PaymentInitiationRequest {
  enrollmentId: string;
  amount: number;
  currency?: string;
  phoneNumber?: string; // Required for mobile money methods
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitiationResponse {
  transactionId: string;
  externalReference: string | null;
  status: 'pending' | 'initiated' | 'failed';
  
  // Provider-specific response fields
  ussdCode?: string; // For mobile money (Orange Money, MTN Money)
  instructions?: string; // Payment instructions
  qrCode?: string; // QR code image URL (for Wave)
  redirectUrl?: string; // Redirect URL (for bank card, TresorPay, Wave)
  expiresAt?: Date; // Payment expiration timestamp
}

export interface PaymentVerificationRequest {
  transactionId: string;
  externalReference?: string;
}

export interface PaymentVerificationResponse {
  status: 'pending' | 'validated' | 'failed' | 'cancelled';
  externalReference: string | null;
  amount: number;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  // Provider-specific payload structure
  [key: string]: unknown;
}

export interface PaymentProviderService {
  /**
   * Initiate a payment transaction with the provider
   * @param request Payment initiation request
   * @returns Payment initiation response with provider-specific details
   */
  initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse>;

  /**
   * Verify payment status with the provider
   * @param request Payment verification request
   * @returns Current payment status and details
   */
  verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResponse>;

  /**
   * Handle webhook notification from provider
   * @param payload Raw webhook payload from provider
   * @param signature Webhook signature for verification
   * @returns Payment verification response
   */
  handleWebhook(payload: WebhookPayload, signature?: string): Promise<PaymentVerificationResponse>;

  /**
   * Verify webhook signature to ensure authenticity
   * @param payload Raw webhook payload
   * @param signature Webhook signature
   * @returns true if signature is valid, false otherwise
   */
  verifySignature(payload: WebhookPayload, signature: string): boolean;

  /**
   * Get provider name
   */
  getProviderName(): string;
}

