/**
 * SMS Service
 * 
 * Handles sending SMS notifications for enrollment confirmations
 * and other enrollment-related communications.
 */

import twilio from 'twilio';

export interface SMSOptions {
  to: string;
  message: string;
}

export class SMSService {
  private twilioClient: twilio.Twilio | null = null;
  private twilioPhoneNumber: string | null = null;

  constructor() {
    this.initializeTwilio();
  }

  private initializeTwilio(): void {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !phoneNumber) {
      console.warn('SMS service not configured. Twilio credentials missing.');
      return;
    }

    this.twilioClient = twilio(accountSid, authToken);
    this.twilioPhoneNumber = phoneNumber;
  }

  /**
   * Send an SMS message
   */
  async sendSMS(options: SMSOptions): Promise<void> {
    if (!this.twilioClient || !this.twilioPhoneNumber) {
      throw new Error('SMS service not configured. Please set Twilio environment variables.');
    }

    await this.twilioClient.messages.create({
      body: options.message,
      from: this.twilioPhoneNumber,
      to: options.to,
    });
  }

  /**
   * Send enrollment confirmation SMS
   */
  async sendConfirmation(
    phoneNumber: string,
    enrollmentNumber: string,
    sessionTitle: string
  ): Promise<void> {
    const message = `Votre inscription ${enrollmentNumber} pour "${sessionTitle}" a été confirmée. Merci! - EcoleDigitale`;

    await this.sendSMS({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send payment reminder SMS
   */
  async sendPaymentReminder(
    phoneNumber: string,
    enrollmentNumber: string,
    amount: number,
    expirationMinutes: number
  ): Promise<void> {
    const message = `Rappel: Paiement de ${amount} FCFA requis pour l'inscription ${enrollmentNumber}. Expire dans ${expirationMinutes} minutes. - EcoleDigitale`;

    await this.sendSMS({
      to: phoneNumber,
      message,
    });
  }
}

// Export singleton instance
export const smsService = new SMSService();

