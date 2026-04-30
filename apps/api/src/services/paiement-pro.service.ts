/**
 * PaiementProService
 * 
 * Business logic for professional training payment processing.
 * Handles payment initiation, validation, and status updates.
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from 'pg';
import { PaymentInitiationRequest, PaiementProMethod } from '@ecoledigitale/contracts/src/paiements-pro';
import { generateTransactionNumber } from '../utils/transaction-number.util';
import { PaymentProviderService, PaymentVerificationResponse } from './payment-provider.interface';
import { OrangeMoneyService } from './orange-money.service';
import { MTNMoneyService } from './mtn-money.service';
import { WaveService } from './wave.service';
import { CarteBancaireService } from './carte-bancaire.service';
import { TresorPayService } from './tresorpay.service';
import { InvoiceService } from './invoice.service';
import { EmailService } from './email.service';
import { SMSService } from './sms.service';
import { getTableName } from '../utils/table-names';

export interface PaymentRecord {
  id: string;
  inscription_id: string;
  numero_transaction: string;
  methode_paiement: PaiementProMethod;
  montant: number;
  statut: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule';
  reference_externe: string | null;
  date_paiement: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class PaiementProService {
  private providerServices: Map<PaiementProMethod, PaymentProviderService>;

  constructor(private pool: Pool) {
    // Initialize provider services
    this.providerServices = new Map();
    this.providerServices.set('orange_money', new OrangeMoneyService());
    this.providerServices.set('mtn_money', new MTNMoneyService());
    this.providerServices.set('wave', new WaveService());
    this.providerServices.set('carte_bancaire', new CarteBancaireService());
    this.providerServices.set('tresorpay', new TresorPayService());
  }

  /**
   * Set tenant context for RLS policies
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Get provider service for a payment method
   */
  private getProviderService(method: PaiementProMethod): PaymentProviderService {
    const service = this.providerServices.get(method);
    if (!service) {
      throw new Error(`Payment provider service not found for method: ${method}`);
    }
    return service;
  }

  /**
   * Validate payment amount matches enrollment total
   */
  async validatePaymentAmount(
    tenantId: string,
    inscriptionId: string,
    amount: number
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        SELECT montant_ttc
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
      `;

      const result = await client.query(query, [inscriptionId, tenantId]);

      if (result.rows.length === 0) {
        throw new Error('Enrollment not found');
      }

      const enrollment = result.rows[0];
      const expectedAmount = parseFloat(enrollment.montant_ttc);

      // Allow small floating point differences (0.01 FCFA tolerance)
      return Math.abs(amount - expectedAmount) < 0.01;
    } finally {
      client.release();
    }
  }

  /**
   * Generate unique transaction number
   */
  generateTransactionNumber(): string {
    return generateTransactionNumber();
  }

  /**
   * Initiate payment transaction
   */
  async initiatePayment(
    tenantId: string,
    request: PaymentInitiationRequest
  ): Promise<{
    paiement_id: string;
    transaction_id: string;
    reference_externe: string | null;
    ussd_code?: string;
    instructions?: string;
    qr_code?: string;
    redirect_url?: string;
    status_check_url?: string;
    statut: 'en_attente';
    message: string;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      // 1. Validate enrollment exists and is pending
      const enrollmentQuery = `
        SELECT id, session_id, montant_ttc, statut, apprenant_id
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `;
      const enrollmentResult = await client.query(enrollmentQuery, [
        request.inscription_id,
        tenantId,
      ]);

      if (enrollmentResult.rows.length === 0) {
        throw new Error('Enrollment not found');
      }

      const enrollment = enrollmentResult.rows[0];

      if (enrollment.statut !== 'en_attente') {
        throw new Error('Enrollment is not in pending status');
      }

      // 2. Validate payment amount
      const isValidAmount = await this.validatePaymentAmount(
        tenantId,
        request.inscription_id,
        request.montant
      );
      if (!isValidAmount) {
        throw new Error('Payment amount does not match enrollment total');
      }

      // 3. Check if payment already exists
      const existingPaymentQuery = `
        SELECT id, statut
        FROM ${getTableName(tenantId, 'paiements_professionnels')}
        WHERE inscription_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const existingPayment = await client.query(existingPaymentQuery, [
        request.inscription_id,
        tenantId,
      ]);

      if (
        existingPayment.rows.length > 0 &&
        existingPayment.rows[0].statut === 'en_attente'
      ) {
        throw new Error('Payment already initiated for this enrollment');
      }

      // 4. Generate transaction number
      const transactionNumber = this.generateTransactionNumber();

      // 5. Get provider service and initiate payment
      const providerService = this.getProviderService(request.methode_paiement);

      // 5.a Fetch payer identity for providers that require client fields (e.g. CinetPay)
      const learnerQuery = `
        SELECT
          u.email,
          COALESCE(up.prenom, u.first_name, split_part(u.email, '@', 1), 'Client') AS first_name,
          COALESCE(up.nom, u.last_name, 'Client') AS last_name,
          COALESCE(up.telephone, '') AS phone_number
        FROM users u
        LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE u.id = $1
        LIMIT 1
      `;
      const learnerResult = await client.query(learnerQuery, [enrollment.apprenant_id]);
      const learner = learnerResult.rows[0] || null;

      // Prepare provider request
      const providerRequest = {
        enrollmentId: request.inscription_id,
        amount: request.montant,
        currency: 'XOF',
        phoneNumber: request.telephone,
        returnUrl: request.return_url || `${process.env.FRONTEND_URL}/formations-professionnelles/inscription/callback/${request.methode_paiement}`,
        metadata: {
          session_id: enrollment.session_id,
          tenant_id: tenantId,
          client_email: learner?.email || undefined,
          client_first_name: learner?.first_name || undefined,
          client_last_name: learner?.last_name || undefined,
          client_phone_number: learner?.phone_number || undefined,
        },
      };

      const providerResponse = await providerService.initiatePayment(providerRequest);

      // 6. Create payment record
      const paymentQuery = `
        INSERT INTO ${getTableName(tenantId, 'paiements_professionnels')} (
          tenant_id, inscription_id, numero_transaction,
          methode_paiement, montant, statut, reference_externe
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, numero_transaction, reference_externe
      `;

      const paymentResult = await client.query(paymentQuery, [
        tenantId,
        request.inscription_id,
        transactionNumber,
        request.methode_paiement,
        request.montant,
        'en_attente',
        providerResponse.externalReference,
      ]);

      const payment = paymentResult.rows[0];

      await client.query('COMMIT');

      // 7. Build response
      return {
        paiement_id: payment.id,
        transaction_id: payment.numero_transaction,
        reference_externe: payment.reference_externe,
        ussd_code: providerResponse.ussdCode,
        instructions: providerResponse.instructions,
        qr_code: providerResponse.qrCode,
        redirect_url: providerResponse.redirectUrl,
        status_check_url: `${process.env.API_URL || ''}/api/v1/paiements-pro/${payment.id}/statut`,
        statut: 'en_attente',
        message: providerResponse.instructions || 'Payment initiated successfully',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(tenantId: string, paymentId: string): Promise<PaymentRecord | null> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        SELECT 
          id, inscription_id, numero_transaction, methode_paiement,
          montant, statut, reference_externe, date_paiement,
          created_at, updated_at
        FROM ${getTableName(tenantId, 'paiements_professionnels')}
        WHERE id = $1 AND tenant_id = $2
      `;

      const result = await client.query(query, [paymentId, tenantId]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Update payment status
   */
  async updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    status: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule',
    referenceExterne?: string | null,
    datePaiement?: Date
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'paiements_professionnels')}
        SET statut = $1,
            reference_externe = COALESCE($2, reference_externe),
            date_paiement = COALESCE($3, date_paiement),
            updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
        RETURNING inscription_id
      `;

      const result = await client.query(updateQuery, [
        status,
        referenceExterne,
        datePaiement,
        paymentId,
        tenantId,
      ]);

      if (result.rows.length === 0) {
        throw new Error('Payment not found');
      }

      const inscriptionId = result.rows[0].inscription_id;

      // If payment validated, trigger enrollment confirmation
      if (status === 'valide') {
        await this.onPaymentValidated(tenantId, inscriptionId, paymentId, client);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Enrollment confirmation workflow when payment is validated
   */
  private async onPaymentValidated(
    tenantId: string,
    inscriptionId: string,
    paymentId: string,
    client: any
  ): Promise<void> {
    // 1. Get enrollment details
    const enrollmentQuery = `
      SELECT 
        i.id, i.numero_inscription, i.session_id, i.apprenant_id, i.entreprise_id,
        i.montant_ht, i.montant_ttc, i.code_promo_utilise, i.reduction_appliquee,
        s.code_session, s.date_debut, s.date_fin, s.prix_ht, s.prix_ttc,
        f.titre as formation_titre, f.slug as formation_slug,
        u.email as apprenant_email,
        up.nom as apprenant_nom, up.prenom as apprenant_prenom, up.telephone as apprenant_telephone
      FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
      JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON i.session_id = s.id
      JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON s.formation_pro_id = f.id
      JOIN users u ON i.apprenant_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE i.id = $1 AND i.tenant_id = $2
    `;

    const enrollmentResult = await client.query(enrollmentQuery, [inscriptionId, tenantId]);
    if (enrollmentResult.rows.length === 0) {
      throw new Error('Enrollment not found');
    }

    const enrollment = enrollmentResult.rows[0];

    // 2. Update enrollment status to confirmed
    await client.query(
      `
      UPDATE ${getTableName(tenantId, 'inscriptions_professionnelles')}
      SET statut = 'confirmee', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      `,
      [inscriptionId, tenantId]
    );

    // 3. Generate invoice number
    const invoiceNumberResult = await client.query(
      `SELECT generate_invoice_number($1) as numero`,
      [tenantId]
    );
    const invoiceNumber = invoiceNumberResult.rows[0].numero;

    // 4. Get payment method for invoice
    const paymentQuery = `
      SELECT methode_paiement, numero_transaction, date_paiement
      FROM ${getTableName(tenantId, 'paiements_professionnels')}
      WHERE id = $1 AND tenant_id = $2
    `;
    const paymentResult = await client.query(paymentQuery, [paymentId, tenantId]);
    const payment = paymentResult.rows[0] || {};

    // 5. Generate invoice PDF
    const invoiceService = new InvoiceService();
    const invoicePath = await invoiceService.generateInvoice({
      invoiceNumber,
      enrollmentNumber: enrollment.numero_inscription,
      issueDate: new Date(),
      participant: {
        name: `${enrollment.apprenant_prenom} ${enrollment.apprenant_nom}`,
        email: enrollment.apprenant_email,
        phone: enrollment.apprenant_telephone,
      },
      session: {
        title: enrollment.formation_titre,
        code: enrollment.code_session,
        startDate: new Date(enrollment.date_debut),
        endDate: new Date(enrollment.date_fin),
        priceHT: parseFloat(enrollment.prix_ht || enrollment.montant_ht),
        priceTTC: parseFloat(enrollment.prix_ttc || enrollment.montant_ttc),
      },
      pricing: {
        amountHT: parseFloat(enrollment.montant_ht),
        amountTTC: parseFloat(enrollment.montant_ttc),
        taxAmount: parseFloat(enrollment.montant_ttc) - parseFloat(enrollment.montant_ht),
        discount: parseFloat(enrollment.reduction_appliquee || '0'),
        promoCode: enrollment.code_promo_utilise || undefined,
      },
      payment: {
        method: payment.methode_paiement || 'Non spécifié',
        transactionId: payment.numero_transaction || undefined,
        amountPaid: parseFloat(enrollment.montant_ttc),
        date: payment.date_paiement ? new Date(payment.date_paiement) : new Date(),
      },
      discount: enrollment.reduction_appliquee > 0 ? {
        amount: parseFloat(enrollment.reduction_appliquee),
        code: enrollment.code_promo_utilise,
      } : undefined,
    });

    // 6. Update enrollment with invoice number and URL
    const invoiceUrl = invoiceService.getInvoiceUrl(invoiceNumber);
    
    // 7. Generate convention document automatically (Phase 6 - T051)
    try {
      const { DocumentGenerationService } = await import("./document-generation.service");
      const documentService = new DocumentGenerationService(this.pool);
      await documentService.genererConvention(tenantId, inscriptionId, "system");
      console.log(`[Payment] Convention generated automatically for enrollment ${inscriptionId}`);
    } catch (error) {
      // Log but don't fail the payment confirmation if convention generation fails
      console.error(`[Payment] Error generating convention for enrollment ${inscriptionId}:`, error);
    }
    await client.query(
      `
      UPDATE ${getTableName(tenantId, 'inscriptions_professionnelles')}
      SET facture_numero = $1,
          facture_url = $2,
          updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
      `,
      [invoiceNumber, invoiceUrl, inscriptionId, tenantId]
    );

    // 6. Update session availability (convert reserved place to confirmed)
    await client.query(
      `
      UPDATE ${getTableName(tenantId, 'sessions_professionnelles')}
      SET places_reservees = GREATEST(places_reservees - 1, 0),
          updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      `,
      [enrollment.session_id, tenantId]
    );

    // 7. Delete temporary reservation
    await client.query(
      `DELETE FROM ${getTableName(tenantId, 'reservations_temporaires')} WHERE inscription_id = $1`,
      [inscriptionId]
    );

    // 8. Send notifications (async, don't wait)
    setImmediate(async () => {
      try {
        const emailService = new EmailService();
        const smsService = new SMSService();

        // Read invoice PDF for email attachment
        let invoiceBuffer: Buffer | undefined;
        try {
          invoiceBuffer = await invoiceService.readInvoiceBuffer(invoiceNumber);
        } catch (error) {
          console.warn(`[Notification] Could not read invoice PDF for attachment: ${error}`);
          // Continue without attachment
        }

        // Send email confirmation with invoice attachment
        try {
          await emailService.sendEnrollmentConfirmation(
            enrollment.apprenant_email,
            enrollment.numero_inscription,
            {
              title: enrollment.formation_titre,
              startDate: new Date(enrollment.date_debut),
              endDate: new Date(enrollment.date_fin),
            },
            invoiceBuffer ? {
              filename: `facture-${invoiceNumber}.pdf`,
              content: invoiceBuffer,
              contentType: 'application/pdf',
            } : undefined
          );
        } catch (error) {
          console.error('[Notification] Error sending email confirmation:', error);
          // Don't throw - email failure should not block enrollment confirmation
        }

        // Send SMS confirmation if phone available
        if (enrollment.apprenant_telephone) {
          await smsService.sendConfirmation(
            enrollment.apprenant_telephone,
            enrollment.numero_inscription,
            enrollment.formation_titre
          );
        }
      } catch (error) {
        console.error('Error sending notifications:', error);
        // Don't throw - notifications are not critical
      }
    });
  }

  /**
   * Verify payment status with provider
   */
  async verifyPaymentWithProvider(
    tenantId: string,
    paymentId: string
  ): Promise<PaymentVerificationResponse> {
    const payment = await this.getPaymentById(tenantId, paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    const providerService = this.getProviderService(payment.methode_paiement);

    const verificationRequest = {
      transactionId: payment.numero_transaction,
      externalReference: payment.reference_externe || undefined,
    };

    return await providerService.verifyPayment(verificationRequest);
  }

  /**
   * Handle webhook from payment provider
   * Includes idempotency check to prevent duplicate processing
   */
  async handleWebhook(
    tenantId: string,
    provider: PaiementProMethod,
    payload: any,
    signature?: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Log webhook event
      console.log(`[Webhook] Processing webhook from ${provider}`, {
        tenantId,
        provider,
        payloadKeys: Object.keys(payload || {}),
        hasSignature: !!signature,
      });

      const providerService = this.getProviderService(provider);

      // Verify signature
      if (!providerService.verifySignature(payload, signature || '')) {
        console.error(`[Webhook] Invalid signature for ${provider} webhook`);
        throw new Error('Invalid webhook signature');
      }

      // Handle webhook
      const verificationResponse = await providerService.handleWebhook(payload, signature);

      // Find payment by external reference
      const paymentQuery = `
        SELECT id, inscription_id, statut
        FROM ${getTableName(tenantId, 'paiements_professionnels')}
        WHERE reference_externe = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const paymentResult = await client.query(paymentQuery, [
        verificationResponse.externalReference,
        tenantId,
      ]);

      if (paymentResult.rows.length === 0) {
        console.error(`[Webhook] Payment not found for external reference: ${verificationResponse.externalReference}`);
        throw new Error('Payment not found for webhook');
      }

      const payment = paymentResult.rows[0];

      // Idempotency check: if payment is already in final state, skip processing
      if (payment.statut === 'valide' || payment.statut === 'echoue' || payment.statut === 'annule') {
        console.log(`[Webhook] Payment ${payment.id} already in final state: ${payment.statut}. Skipping webhook processing.`);
        return; // Already processed, skip
      }

      // Map provider status to our status
      let status: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule' = 'en_attente';
      if (verificationResponse.status === 'validated') {
        status = 'valide';
      } else if (verificationResponse.status === 'failed') {
        status = 'echoue';
      } else if (verificationResponse.status === 'cancelled') {
        status = 'annule';
      }

      // Update payment status (this will trigger enrollment confirmation if validated)
      await this.updatePaymentStatus(
        tenantId,
        payment.id,
        status,
        verificationResponse.externalReference,
        verificationResponse.paidAt
      );

      console.log(`[Webhook] Successfully processed webhook for payment ${payment.id}, status: ${status}`);
    } catch (error) {
      console.error(`[Webhook] Error processing webhook from ${provider}:`, error);
      // Re-throw to let route handler decide on response
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Initiate refund for a payment
   * Marks payment for refund and notifies admin for manual processing
   */
  async initiateRefund(
    tenantId: string,
    paymentId: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get payment details
      const paymentQuery = `
        SELECT id, inscription_id, statut, montant, methode_paiement
        FROM ${getTableName(tenantId, 'paiements_professionnels')}
        WHERE id = $1 AND tenant_id = $2
      `;
      const paymentResult = await client.query(paymentQuery, [paymentId, tenantId]);

      if (paymentResult.rows.length === 0) {
        throw new Error('Payment not found');
      }

      const payment = paymentResult.rows[0];

      // Only allow refund for validated payments
      if (payment.statut !== 'valide') {
        throw new Error(`Cannot refund payment with status: ${payment.statut}`);
      }

      // Mark payment for refund
      const refundQuery = `
        UPDATE ${getTableName(tenantId, 'paiements_professionnels')}
        SET statut = 'rembourse',
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id
      `;
      await client.query(refundQuery, [paymentId, tenantId]);

      // TODO: Send notification to admin for manual refund processing
      // This would typically involve:
      // 1. Creating a refund request record
      // 2. Sending email to admin
      // 3. Logging the refund request

      return {
        success: true,
        message: 'Refund initiated. Admin will process the refund manually.',
      };
    } catch (error: any) {
      console.error('Error initiating refund:', {
        error: error.message,
        stack: error.stack,
        paymentId,
      });
      throw error;
    } finally {
      client.release();
    }
  }
}
