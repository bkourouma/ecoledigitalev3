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
    /** Content-ID pour une image embarquée référencée par `<img src="cid:…">`. */
    cid?: string;
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
   * Confirmation sent to a visitor right after they submit a registration
   * request. No account exists yet — this only acknowledges receipt.
   */
  async sendRegistrationReceived(
    email: string,
    info: { firstName: string; accountType: "student" | "parent"; tenantName?: string }
  ): Promise<void> {
    const roleLabel = info.accountType === "parent" ? "parent" : "étudiant";
    const school = info.tenantName || "votre établissement";
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8">
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
          <div class="header"><h1>Demande d'inscription reçue</h1></div>
          <div class="content">
            <p>Bonjour ${info.firstName},</p>
            <p>Nous avons bien reçu votre demande d'inscription en tant que ${roleLabel} auprès de ${school}.</p>
            <p>Votre demande va être examinée par un administrateur. Vous recevrez un second email
               contenant vos identifiants de connexion une fois votre inscription validée.</p>
            <p>Cordialement,<br>L'équipe ${school}</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail({
      to: email,
      subject: "Demande d'inscription reçue",
      html,
    });
  }

  /**
   * Notify a visitor that their registration request was rejected.
   */
  async sendRegistrationRejected(
    email: string,
    info: { firstName: string; reason?: string; tenantName?: string }
  ): Promise<void> {
    const school = info.tenantName || "votre établissement";
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Demande d'inscription non validée</h1></div>
          <div class="content">
            <p>Bonjour ${info.firstName},</p>
            <p>Nous vous informons que votre demande d'inscription auprès de ${school}
               n'a pas pu être validée.</p>
            ${info.reason ? `<p><strong>Motif :</strong> ${info.reason}</p>` : ""}
            <p>Pour toute question, n'hésitez pas à contacter l'établissement.</p>
            <p>Cordialement,<br>L'équipe ${school}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail({
      to: email,
      subject: "Demande d'inscription non validée",
      html,
    });
  }

  /**
   * Send login credentials of a freshly created (or re-sent) account.
   * Used both when an administrator approves a registration request and when
   * credentials are (re-)sent individually or in bulk from the admin UI.
   */
  async sendAccountCredentials(
    email: string,
    info: {
      firstName: string;
      lastName?: string;
      loginEmail: string;
      password: string;
      accountType: "student" | "parent";
      tenantName?: string;
      loginUrl?: string;
      matricule?: string | null;
    }
  ): Promise<void> {
    const roleLabel = info.accountType === "parent" ? "Parent" : "Étudiant";
    const school = info.tenantName || "EcoleDigitale";
    const loginUrl = info.loginUrl || "";
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .creds { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0; }
          .creds p { margin: 6px 0; }
          .btn { display:inline-block; background:#059669; color:#fff; text-decoration:none;
                 padding:10px 20px; border-radius:6px; margin-top:8px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Votre compte ${roleLabel}</h1></div>
          <div class="content">
            <p>Bonjour ${info.firstName},</p>
            <p>Votre compte ${roleLabel.toLowerCase()} auprès de ${school} est maintenant actif.
               Voici vos identifiants de connexion :</p>
            <div class="creds">
              ${info.matricule ? `<p><strong>Matricule :</strong> ${info.matricule}</p>` : ""}
              <p><strong>Email :</strong> ${info.loginEmail}</p>
              <p><strong>Mot de passe :</strong> ${info.password}</p>
            </div>
            <p>Nous vous recommandons de modifier votre mot de passe après votre première connexion.</p>
            ${loginUrl ? `<p><a class="btn" href="${loginUrl}">Se connecter</a></p>` : ""}
            <p>Cordialement,<br>L'équipe ${school}</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail({
      to: email,
      subject: `Vos identifiants de connexion - ${school}`,
      html,
    });
  }

  /**
   * Send, in a single email to the parent, the login credentials of the
   * parent account and of every linked child account created at once during
   * a family registration approval.
   */
  async sendFamilyCredentials(
    parentEmail: string,
    info: {
      parentFirstName: string;
      parentLoginEmail: string;
      parentPassword: string;
      children: Array<{
        name: string;
        loginEmail: string;
        password: string;
        matricule?: string | null;
      }>;
      tenantName?: string;
      loginUrl?: string;
    }
  ): Promise<void> {
    const school = info.tenantName || "EcoleDigitale";
    const loginUrl = info.loginUrl || "";
    const childrenRows = info.children
      .map(
        (c) => `
            <tr>
              <td style="padding:8px;border:1px solid #e5e7eb;">${c.name}</td>
              <td style="padding:8px;border:1px solid #e5e7eb;">${c.matricule || "—"}</td>
              <td style="padding:8px;border:1px solid #e5e7eb;">${c.loginEmail}</td>
              <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;">${c.password}</td>
            </tr>`
      )
      .join("");
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 640px; margin: 0 auto; padding: 20px; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .creds { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0; }
          .creds p { margin: 6px 0; }
          table { width:100%; border-collapse:collapse; margin:12px 0; background:#fff; }
          th { padding:8px;border:1px solid #e5e7eb;background:#f3f4f6;text-align:left; }
          .btn { display:inline-block; background:#059669; color:#fff; text-decoration:none;
                 padding:10px 20px; border-radius:6px; margin-top:8px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Vos comptes ${school}</h1></div>
          <div class="content">
            <p>Bonjour ${info.parentFirstName},</p>
            <p>Votre inscription a été validée. Voici les identifiants de connexion de votre
               compte parent ainsi que ceux de vos enfants.</p>

            <h3>Compte parent</h3>
            <div class="creds">
              <p><strong>Email :</strong> ${info.parentLoginEmail}</p>
              <p><strong>Mot de passe :</strong> ${info.parentPassword}</p>
            </div>

            <h3>Compte(s) enfant(s)</h3>
            <table>
              <thead>
                <tr><th>Nom</th><th>Matricule</th><th>Email</th><th>Mot de passe</th></tr>
              </thead>
              <tbody>${childrenRows}</tbody>
            </table>

            <p>Nous vous recommandons de modifier les mots de passe après la première connexion.</p>
            ${loginUrl ? `<p><a class="btn" href="${loginUrl}">Se connecter</a></p>` : ""}
            <p>Cordialement,<br>L'équipe ${school}</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    await this.sendEmail({
      to: parentEmail,
      subject: `Vos identifiants de connexion - ${school}`,
      html,
    });
  }

  /**
   * Whether SMTP is configured. Lets callers degrade gracefully instead of
   * throwing when credentials cannot actually be delivered.
   */
  isConfigured(): boolean {
    return this.transporter !== null;
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

