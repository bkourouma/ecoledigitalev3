import { Pool } from 'pg';

interface NotificationConfig {
  emailProvider: {
    apiKey: string;
    fromEmail: string;
    fromName: string;
  };
  smsProvider: {
    apiKey: string;
    senderId: string;
  };
}

interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

interface SMSTemplate {
  message: string;
}

interface NotificationData {
  studentName: string;
  studentEmail: string;
  studentPhone?: string;
  feeType: string;
  amount: number;
  currency: string;
  dueDate?: Date;
  institutionName: string;
  paymentUrl?: string;
}

export class NotificationService {
  private config: NotificationConfig;
  private pool: Pool;

  constructor(config: NotificationConfig, pool: Pool) {
    this.config = config;
    this.pool = pool;
  }

  /**
   * Send payment reminder notification
   */
  async sendPaymentReminder(
    studentId: string,
    tenantId: string,
    notificationData: NotificationData,
    sendVia: 'email' | 'sms' | 'both' = 'email'
  ): Promise<{ success: boolean; emailSent?: boolean; smsSent?: boolean; errors?: string[] }> {
    const errors: string[] = [];
    let emailSent = false;
    let smsSent = false;

    try {
      // Generate templates
      const emailTemplate = this.generateReminderEmailTemplate(notificationData);
      const smsTemplate = this.generateReminderSMSTemplate(notificationData);

      // Send email if requested
      if (sendVia === 'email' || sendVia === 'both') {
        try {
          await this.sendEmail(
            notificationData.studentEmail,
            emailTemplate.subject,
            emailTemplate.htmlBody,
            emailTemplate.textBody
          );
          emailSent = true;

          // Log notification
          await this.logNotification(
            tenantId,
            studentId,
            'reminder',
            notificationData.feeType,
            notificationData.studentEmail,
            'email',
            'sent'
          );
        } catch (error) {
          errors.push(`Email failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await this.logNotification(
            tenantId,
            studentId,
            'reminder',
            notificationData.feeType,
            notificationData.studentEmail,
            'email',
            'failed'
          );
        }
      }

      // Send SMS if requested and phone number available
      if ((sendVia === 'sms' || sendVia === 'both') && notificationData.studentPhone) {
        try {
          await this.sendSMS(notificationData.studentPhone, smsTemplate.message);
          smsSent = true;

          // Log notification
          await this.logNotification(
            tenantId,
            studentId,
            'reminder',
            notificationData.feeType,
            notificationData.studentPhone,
            'sms',
            'sent'
          );
        } catch (error) {
          errors.push(`SMS failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await this.logNotification(
            tenantId,
            studentId,
            'reminder',
            notificationData.feeType,
            notificationData.studentPhone || '',
            'sms',
            'failed'
          );
        }
      }

      return {
        success: emailSent || smsSent,
        emailSent,
        smsSent,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('Error sending payment reminder:', error);
      return {
        success: false,
        errors: [`Failed to send reminder: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Send payment confirmation notification
   */
  async sendPaymentConfirmation(
    studentId: string,
    tenantId: string,
    transactionId: string,
    notificationData: NotificationData,
    receiptUrl?: string
  ): Promise<{ success: boolean; emailSent?: boolean; smsSent?: boolean; errors?: string[] }> {
    const errors: string[] = [];
    let emailSent = false;
    let smsSent = false;

    try {
      // Generate templates
      const emailTemplate = this.generateConfirmationEmailTemplate(notificationData, receiptUrl);
      const smsTemplate = this.generateConfirmationSMSTemplate(notificationData);

      // Send email confirmation
      try {
        await this.sendEmail(
          notificationData.studentEmail,
          emailTemplate.subject,
          emailTemplate.htmlBody,
          emailTemplate.textBody
        );
        emailSent = true;

        // Log notification
        await this.logNotification(
          tenantId,
          studentId,
          'confirmation',
          notificationData.feeType,
          notificationData.studentEmail,
          'email',
          'sent',
          transactionId
        );
      } catch (error) {
        errors.push(`Email failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await this.logNotification(
          tenantId,
          studentId,
          'confirmation',
          notificationData.feeType,
          notificationData.studentEmail,
          'email',
          'failed',
          transactionId
        );
      }

      // Send SMS confirmation if phone available
      if (notificationData.studentPhone) {
        try {
          await this.sendSMS(notificationData.studentPhone, smsTemplate.message);
          smsSent = true;

          // Log notification
          await this.logNotification(
            tenantId,
            studentId,
            'confirmation',
            notificationData.feeType,
            notificationData.studentPhone,
            'sms',
            'sent',
            transactionId
          );
        } catch (error) {
          errors.push(`SMS failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await this.logNotification(
            tenantId,
            studentId,
            'confirmation',
            notificationData.feeType,
            notificationData.studentPhone,
            'sms',
            'failed',
            transactionId
          );
        }
      }

      return {
        success: emailSent || smsSent,
        emailSent,
        smsSent,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('Error sending payment confirmation:', error);
      return {
        success: false,
        errors: [`Failed to send confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Send overdue payment notification
   */
  async sendOverdueNotification(
    studentId: string,
    tenantId: string,
    notificationData: NotificationData & { daysPastDue: number }
  ): Promise<{ success: boolean; emailSent?: boolean; smsSent?: boolean; errors?: string[] }> {
    const errors: string[] = [];
    let emailSent = false;
    let smsSent = false;

    try {
      // Generate templates
      const emailTemplate = this.generateOverdueEmailTemplate(notificationData);
      const smsTemplate = this.generateOverdueSMSTemplate(notificationData);

      // Send email
      try {
        await this.sendEmail(
          notificationData.studentEmail,
          emailTemplate.subject,
          emailTemplate.htmlBody,
          emailTemplate.textBody
        );
        emailSent = true;

        // Log notification
        await this.logNotification(
          tenantId,
          studentId,
          'overdue',
          notificationData.feeType,
          notificationData.studentEmail,
          'email',
          'sent'
        );
      } catch (error) {
        errors.push(`Email failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await this.logNotification(
          tenantId,
          studentId,
          'overdue',
          notificationData.feeType,
          notificationData.studentEmail,
          'email',
          'failed'
        );
      }

      // Send SMS if phone available
      if (notificationData.studentPhone) {
        try {
          await this.sendSMS(notificationData.studentPhone, smsTemplate.message);
          smsSent = true;

          // Log notification
          await this.logNotification(
            tenantId,
            studentId,
            'overdue',
            notificationData.feeType,
            notificationData.studentPhone,
            'sms',
            'sent'
          );
        } catch (error) {
          errors.push(`SMS failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await this.logNotification(
            tenantId,
            studentId,
            'overdue',
            notificationData.feeType,
            notificationData.studentPhone,
            'sms',
            'failed'
          );
        }
      }

      return {
        success: emailSent || smsSent,
        emailSent,
        smsSent,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('Error sending overdue notification:', error);
      return {
        success: false,
        errors: [`Failed to send overdue notification: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Send email using configured provider
   */
  private async sendEmail(
    to: string,
    subject: string,
    htmlBody: string,
    textBody: string
  ): Promise<void> {
    // Mock implementation - replace with actual email service
    console.log(`Sending email to ${to}: ${subject}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock success (in production, implement actual email sending)
    if (Math.random() > 0.1) { // 90% success rate for testing
      console.log(`Email sent successfully to ${to}`);
    } else {
      throw new Error('Email delivery failed');
    }
  }

  /**
   * Send SMS using configured provider
   */
  private async sendSMS(to: string, message: string): Promise<void> {
    // Mock implementation - replace with actual SMS service
    console.log(`Sending SMS to ${to}: ${message}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Mock success (in production, implement actual SMS sending)
    if (Math.random() > 0.15) { // 85% success rate for testing
      console.log(`SMS sent successfully to ${to}`);
    } else {
      throw new Error('SMS delivery failed');
    }
  }

  /**
   * Log notification to database
   */
  private async logNotification(
    tenantId: string,
    studentId: string,
    notificationType: string,
    feeType: string,
    sentTo: string,
    sentVia: string,
    status: string,
    transactionId?: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SET app.tenant_id = $1", [tenantId]);

      const insertQuery = `
        INSERT INTO payment_notifications (
          tenant_id, student_id, notification_type, fee_type,
          sent_to, sent_via, status, transaction_id, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      await client.query(insertQuery, [
        tenantId,
        studentId,
        notificationType,
        feeType,
        sentTo,
        sentVia,
        status,
        transactionId,
        status === 'sent' ? new Date() : null,
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Generate payment reminder email template
   */
  private generateReminderEmailTemplate(data: NotificationData): EmailTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    const formatDate = (date: Date) => {
      return new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(date);
    };

    const subject = `Rappel de Paiement - ${data.institutionName}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">Rappel de Paiement</h2>
        <p>Bonjour ${data.studentName},</p>
        <p>Nous vous rappelons qu'un paiement est dû pour vos frais scolaires.</p>
        
        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Détails du Paiement</h3>
          <p><strong>Type de frais:</strong> ${data.feeType}</p>
          <p><strong>Montant:</strong> ${formatCurrency(data.amount)}</p>
          ${data.dueDate ? `<p><strong>Date d'échéance:</strong> ${formatDate(data.dueDate)}</p>` : ''}
        </div>
        
        ${data.paymentUrl ? `
        <p style="text-align: center; margin: 30px 0;">
          <a href="${data.paymentUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Effectuer le Paiement
          </a>
        </p>
        ` : ''}
        
        <p>Pour toute question, n'hésitez pas à contacter l'administration.</p>
        <p>Cordialement,<br>${data.institutionName}</p>
      </div>
    `;

    const textBody = `
      Rappel de Paiement - ${data.institutionName}
      
      Bonjour ${data.studentName},
      
      Nous vous rappelons qu'un paiement est dû pour vos frais scolaires.
      
      Détails du Paiement:
      - Type de frais: ${data.feeType}
      - Montant: ${formatCurrency(data.amount)}
      ${data.dueDate ? `- Date d'échéance: ${formatDate(data.dueDate)}` : ''}
      
      ${data.paymentUrl ? `Lien de paiement: ${data.paymentUrl}` : ''}
      
      Pour toute question, n'hésitez pas à contacter l'administration.
      
      Cordialement,
      ${data.institutionName}
    `;

    return { subject, htmlBody, textBody };
  }

  /**
   * Generate payment confirmation email template
   */
  private generateConfirmationEmailTemplate(data: NotificationData, receiptUrl?: string): EmailTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    const subject = `Confirmation de Paiement - ${data.institutionName}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">✅ Paiement Confirmé</h2>
        <p>Bonjour ${data.studentName},</p>
        <p>Nous confirmons la réception de votre paiement.</p>
        
        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
          <h3 style="margin-top: 0; color: #059669;">Détails du Paiement</h3>
          <p><strong>Type de frais:</strong> ${data.feeType}</p>
          <p><strong>Montant payé:</strong> ${formatCurrency(data.amount)}</p>
          <p><strong>Date de paiement:</strong> ${new Date().toLocaleDateString('fr-FR')}</p>
        </div>
        
        ${receiptUrl ? `
        <p style="text-align: center; margin: 30px 0;">
          <a href="${receiptUrl}" style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Télécharger le Reçu
          </a>
        </p>
        ` : ''}
        
        <p>Merci pour votre paiement. Conservez ce reçu pour vos dossiers.</p>
        <p>Cordialement,<br>${data.institutionName}</p>
      </div>
    `;

    const textBody = `
      Confirmation de Paiement - ${data.institutionName}
      
      Bonjour ${data.studentName},
      
      Nous confirmons la réception de votre paiement.
      
      Détails du Paiement:
      - Type de frais: ${data.feeType}
      - Montant payé: ${formatCurrency(data.amount)}
      - Date de paiement: ${new Date().toLocaleDateString('fr-FR')}
      
      ${receiptUrl ? `Reçu disponible: ${receiptUrl}` : ''}
      
      Merci pour votre paiement. Conservez ce reçu pour vos dossiers.
      
      Cordialement,
      ${data.institutionName}
    `;

    return { subject, htmlBody, textBody };
  }

  /**
   * Generate overdue payment email template
   */
  private generateOverdueEmailTemplate(data: NotificationData & { daysPastDue: number }): EmailTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    const subject = `⚠️ Paiement en Retard - ${data.institutionName}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">⚠️ Paiement en Retard</h2>
        <p>Bonjour ${data.studentName},</p>
        <p>Votre paiement est en retard de <strong>${data.daysPastDue} jour(s)</strong>.</p>
        
        <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <h3 style="margin-top: 0; color: #dc2626;">Paiement en Souffrance</h3>
          <p><strong>Type de frais:</strong> ${data.feeType}</p>
          <p><strong>Montant dû:</strong> ${formatCurrency(data.amount)}</p>
          <p><strong>Retard:</strong> ${data.daysPastDue} jour(s)</p>
        </div>
        
        <p style="color: #dc2626;"><strong>Action requise:</strong> Veuillez effectuer ce paiement dans les plus brefs délais pour éviter des frais supplémentaires.</p>
        
        ${data.paymentUrl ? `
        <p style="text-align: center; margin: 30px 0;">
          <a href="${data.paymentUrl}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Payer Maintenant
          </a>
        </p>
        ` : ''}
        
        <p>Pour toute question, contactez immédiatement l'administration.</p>
        <p>Cordialement,<br>${data.institutionName}</p>
      </div>
    `;

    const textBody = `
      Paiement en Retard - ${data.institutionName}
      
      Bonjour ${data.studentName},
      
      Votre paiement est en retard de ${data.daysPastDue} jour(s).
      
      Paiement en Souffrance:
      - Type de frais: ${data.feeType}
      - Montant dû: ${formatCurrency(data.amount)}
      - Retard: ${data.daysPastDue} jour(s)
      
      Action requise: Veuillez effectuer ce paiement dans les plus brefs délais.
      
      ${data.paymentUrl ? `Lien de paiement: ${data.paymentUrl}` : ''}
      
      Pour toute question, contactez immédiatement l'administration.
      
      Cordialement,
      ${data.institutionName}
    `;

    return { subject, htmlBody, textBody };
  }

  /**
   * Generate SMS templates
   */
  private generateReminderSMSTemplate(data: NotificationData): SMSTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    return {
      message: `${data.institutionName}: Rappel paiement ${data.feeType} de ${formatCurrency(data.amount)} pour ${data.studentName}. ${data.paymentUrl ? `Payer: ${data.paymentUrl}` : 'Contactez l\'administration.'}`,
    };
  }

  private generateConfirmationSMSTemplate(data: NotificationData): SMSTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    return {
      message: `${data.institutionName}: Paiement de ${formatCurrency(data.amount)} confirmé pour ${data.studentName}. Merci!`,
    };
  }

  private generateOverdueSMSTemplate(data: NotificationData & { daysPastDue: number }): SMSTemplate {
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);
    };

    return {
      message: `${data.institutionName}: URGENT - Paiement en retard de ${data.daysPastDue}j. Montant: ${formatCurrency(data.amount)}. Contactez l'administration.`,
    };
  }
}

/**
 * Factory function to create notification service
 */
export function createNotificationService(pool: Pool): NotificationService {
  const config: NotificationConfig = {
    emailProvider: {
      apiKey: process.env.EMAIL_API_KEY || '',
      fromEmail: process.env.EMAIL_FROM_ADDRESS || 'noreply@ecoledigitale.com',
      fromName: process.env.EMAIL_FROM_NAME || 'École Digitale',
    },
    smsProvider: {
      apiKey: process.env.SMS_API_KEY || '',
      senderId: process.env.SMS_SENDER_ID || 'EcoleDigitale',
    },
  };

  return new NotificationService(config, pool);
}
