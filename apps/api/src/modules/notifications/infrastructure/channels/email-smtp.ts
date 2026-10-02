/**
 * Canal E-MAIL : SMTP via nodemailer (mêmes variables que l'e-mail de comptes : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
 * `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`).
 *
 *  - la « file d'envoi » est le journal (`deliveries`) ; ce canal envoie UN message et classe l'issue ;
 *  - REBONDS : un rejet SMTP définitif du destinataire (550/551/553, `rejected`) est un REBOND (l'adresse est suppriméé de
 *    l'envoi par la liste de suppression) ; une réponse 4xx, une coupure ou un délai est une panne PASSAGÈRE (reprise avec backoff) ;
 *  - conformité : pied de page avec désinscription et mentions de l'établissement, en-têtes `List-Unsubscribe` (+ one-click) ;
 *  - HTML produit par la plateforme (tout échappé), alternative texte brut ; `Message-ID` dérivé de la remise (idempotence) ;
 *  - jamais d'adresse complète dans les journaux d'exécution ni dans le message d'erreur restitué.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { scrubAddresses } from "../../domain/addresses";
import { buildEmailHtml, buildEmailText } from "../../domain/templating";
import type { ChannelAdapter, ChannelConfigStatus, ChannelMessage, ChannelOutcome } from "../../application/ports";

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string | null;
  readonly password: string | null;
  readonly fromEmail: string;
  readonly fromName: string | null;
}

const present = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

export function readSmtpSettings(env: Readonly<Record<string, string | undefined>>): { settings: SmtpSettings | null; missing: string[] } {
  const host = present(env.SMTP_HOST);
  const fromEmail = present(env.SMTP_FROM_EMAIL) ?? present(env.SMTP_USER);
  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!fromEmail) missing.push("SMTP_FROM_EMAIL");
  if (!host || !fromEmail) return { settings: null, missing };
  const port = Number.parseInt(env.SMTP_PORT ?? "587", 10);
  return {
    settings: {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: (env.SMTP_SECURE ?? "").toLowerCase() === "true",
      user: present(env.SMTP_USER),
      password: present(env.SMTP_PASSWORD),
      fromEmail,
      fromName: present(env.SMTP_FROM_NAME),
    },
    missing,
  };
}

interface SmtpErrorLike {
  code?: string;
  responseCode?: number;
  command?: string;
  message?: string;
}

/** Classe une erreur de nodemailer : rebond définitif, échec définitif ou panne passagère. */
export function classifySmtpError(error: unknown): ChannelOutcome {
  const e = (error ?? {}) as SmtpErrorLike;
  const message = scrubAddresses(String(e.message ?? "erreur SMTP")).slice(0, 300);
  const rc = e.responseCode;
  if (typeof rc === "number") {
    if (rc >= 400 && rc < 500) return { status: "RETRY", code: `smtp_${rc}`, message };
    // 5xx sur le destinataire (boîte inconnue, adresse refusée) : rebond définitif.
    if ((e.command === "RCPT TO" && rc >= 500) || rc === 550 || rc === 551 || rc === 553) return { status: "BOUNCED", code: `smtp_${rc}`, message };
    if (rc === 552) return { status: "RETRY", code: "smtp_552", message };
    if (rc === 535 || rc === 534 || rc === 530) return { status: "RETRY", code: "smtp_auth", message };
    return { status: "FAILED", code: `smtp_${rc}`, message };
  }
  switch (e.code) {
    case "EAUTH":
      return { status: "RETRY", code: "smtp_auth", message };
    case "EENVELOPE":
      return { status: "FAILED", code: "invalid_address", message };
    case "ECONNECTION":
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "EDNS":
    case "ETLS":
      return { status: "RETRY", code: "smtp_unreachable", message };
    default:
      return { status: "RETRY", code: "smtp_error", message };
  }
}

export interface SmtpChannelOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Hors production seulement : exige-t-on le secret de désinscription (conformité) ? Vrai en production. */
  readonly requireUnsubscribeSecret: boolean;
  readonly unsubscribeSecretPresent: boolean;
  /** Transport injectable (tests). */
  readonly transport?: Transporter;
}

export function createSmtpChannel(options: SmtpChannelOptions): ChannelAdapter {
  const { settings, missing } = readSmtpSettings(options.env);
  const allMissing = [...missing, ...(options.requireUnsubscribeSecret && !options.unsubscribeSecretPresent ? ["NOTIFICATIONS_UNSUBSCRIBE_SECRET"] : [])];
  let transporter: Transporter | null = options.transport ?? null;
  const transport = (): Transporter => {
    if (transporter) return transporter;
    const s = settings!;
    transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      ...(s.user && s.password ? { auth: { user: s.user, pass: s.password } } : {}),
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return transporter;
  };
  const status = (): ChannelConfigStatus => ({ configured: allMissing.length === 0, missing: allMissing });

  return {
    channel: "EMAIL",
    provider: "smtp",
    status,
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      if (!settings || allMissing.length > 0) return { status: "FAILED", code: "channel_not_configured", message: `Canal e-mail non configuré (variables manquantes : ${allMissing.join(", ")}).` };
      const fromName = m.senderName || settings.fromName || "EcoleDigitale";
      const domain = settings.fromEmail.split("@")[1] ?? "localhost";
      const text = buildEmailText({ bodyText: m.text, schoolName: m.schoolName, legalFooter: m.legalFooter, unsubscribeUrl: m.unsubscribeUrl });
      const html = buildEmailHtml({ bodyText: m.text, schoolName: m.schoolName, legalFooter: m.legalFooter, unsubscribeUrl: m.unsubscribeUrl, category: m.category });
      try {
        const info = (await transport().sendMail({
          from: { name: fromName.replace(/["\r\n]/g, ""), address: settings.fromEmail },
          to: m.address,
          subject: (m.subject ?? m.schoolName).replace(/[\r\n]+/g, " ").slice(0, 200),
          text,
          html,
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
          messageId: `<${m.idempotencyKey}@${domain}>`,
          ...(m.urgent ? { priority: "high" as const } : {}),
          headers: {
            "X-Entity-Ref-ID": m.idempotencyKey,
            "Auto-Submitted": "auto-generated",
            ...(m.unsubscribeUrl ? { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
          },
        })) as { messageId?: string; rejected?: unknown[]; accepted?: unknown[] };
        if (Array.isArray(info.rejected) && info.rejected.length > 0 && (!info.accepted || info.accepted.length === 0)) {
          return { status: "BOUNCED", code: "smtp_rejected", message: "Adresse refusée par le serveur de messagerie." };
        }
        return { status: "SENT", providerId: info.messageId ?? m.idempotencyKey };
      } catch (e) {
        return classifySmtpError(e);
      }
    },
    async close() {
      if (transporter && !options.transport) transporter.close();
    },
  };
}
