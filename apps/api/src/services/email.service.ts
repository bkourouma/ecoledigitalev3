/**
 * Email Service
 * 
 * Handles sending email notifications for enrollment confirmations,
 * invoices, and other enrollment-related communications.
 */

import nodemailer, { Transporter } from 'nodemailer';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    contentType?: string;
  }>;
}

export class EmailService {
  private transporter: Transporter | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpSecure = process.env.SMTP_SECURE === 'true';
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPassword) {
      console.warn('Email service not configured. SMTP credentials missing.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });
  }

  /**
   * Send an email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email service not configured. Please set SMTP environment variables.');
    }

    const fromName = process.env.SMTP_FROM_NAME || 'EcoleDigitale';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

    await this.transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });
  }

  /**
   * Send enrollment confirmation email with invoice attachment
   */
  async sendEnrollmentConfirmation(
    email: string,
    enrollmentNumber: string,
    sessionDetails: {
      title: string;
      startDate: Date;
      endDate: Date;
    },
    invoiceAttachment?: {
      filename: string;
      content: Buffer;
      contentType: string;
    } | string
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Confirmation d'Inscription</h1>
          </div>
          <div class="content">
            <p>Bonjour,</p>
            <p>Votre inscription a été confirmée avec succès.</p>
            <p><strong>Numéro d'inscription:</strong> ${enrollmentNumber}</p>
            <p><strong>Formation:</strong> ${sessionDetails.title}</p>
            <p><strong>Date de début:</strong> ${sessionDetails.startDate.toLocaleDateString('fr-FR')}</p>
            <p><strong>Date de fin:</strong> ${sessionDetails.endDate.toLocaleDateString('fr-FR')}</p>
            ${invoiceAttachment ? '<p>Veuillez trouver votre facture en pièce jointe.</p>' : ''}
            <p>Cordialement,<br>L'équipe EcoleDigitale</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const attachments = invoiceAttachment
      ? typeof invoiceAttachment === 'string'
        ? [
            {
              filename: `facture-${enrollmentNumber}.pdf`,
              path: invoiceAttachment,
              contentType: 'application/pdf',
            },
          ]
        : [
            {
              filename: invoiceAttachment.filename,
              content: invoiceAttachment.content,
              contentType: invoiceAttachment.contentType,
            },
          ]
      : undefined;

    await this.sendEmail({
      to: email,
      subject: `Confirmation d'inscription - ${enrollmentNumber}`,
      html,
      attachments,
    });
  }

  /**
   * Send cancellation confirmation email
   */
  async sendCancellationConfirmation(
    email: string,
    enrollmentNumber: string,
    refundInfo?: { amount: number; method: string }
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Annulation d'Inscription</h1>
          </div>
          <div class="content">
            <p>Bonjour,</p>
            <p>Votre inscription <strong>${enrollmentNumber}</strong> a été annulée.</p>
            ${refundInfo ? `<p>Un remboursement de ${refundInfo.amount} FCFA sera effectué via ${refundInfo.method}.</p>` : ''}
            <p>Cordialement,<br>L'équipe EcoleDigitale</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `Annulation d'inscription - ${enrollmentNumber}`,
      html,
    });
  }
}

// Export singleton instance
export const emailService = new EmailService();

