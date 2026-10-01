/**
 * Notifications de compte du module `iam` (invitation, réinitialisation de mot de passe).
 *
 *  - SMTP configuré (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, même convention que l'e-mail legacy ; en option
 *    `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`) : envoi réel par nodemailer. Le lien pointe
 *    vers `V2_APP_BASE_URL` (ex. `https://ecoledigitale.example`) : `/auth/invitation?token=…` et
 *    `/auth/reset-password?token=…` (pages du web v2, à aligner avec la fondation web).
 *  - SMTP absent : AUCUN envoi. L'événement est journalisé SANS le jeton (le secret ne doit jamais être écrit
 *    dans les journaux) : l'invité ne peut alors pas définir son mot de passe — à configurer avant la mise en
 *    production (documenté dans docs/architecture/platform-assembly.md).
 *
 * Le jeton n'existe en clair que dans le lien de l'e-mail ; la base ne conserve que son empreinte HMAC.
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { AccountNotifier } from "./runtime";

export type NotifierEnv = Readonly<Record<string, string | undefined>>;

interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function linkFor(env: NotifierEnv, path: string, token: string): string | null {
  const base = env.V2_APP_BASE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}${path}?token=${encodeURIComponent(token)}` : null;
}

export function createLoggingNotifier(logger: Pick<Logger, "warn">): AccountNotifier {
  return {
    async sendPasswordReset(input) {
      logger.warn({ event: "iam_mail_not_sent", kind: "password_reset", expiresAt: input.expiresAt.toISOString() }, "Aucun transport e-mail (SMTP_HOST absent) : réinitialisation de mot de passe NON envoyée.");
    },
    async sendInvitation(input) {
      logger.warn({ event: "iam_mail_not_sent", kind: "invitation", tenant: input.tenantName, expiresAt: input.expiresAt.toISOString() }, "Aucun transport e-mail (SMTP_HOST absent) : invitation NON envoyée.");
    },
  };
}

export function createSmtpNotifier(transport: MailTransport, env: NotifierEnv, logger: Pick<Logger, "warn" | "info">): AccountNotifier {
  const from = `"${env.SMTP_FROM_NAME || "EcoleDigitale"}" <${env.SMTP_FROM_EMAIL || env.SMTP_USER}>`;
  const send = async (kind: string, to: string, subject: string, intro: string, path: string, token: string, expiresAt: Date): Promise<void> => {
    const link = linkFor(env, path, token);
    if (!link) {
      logger.warn({ event: "iam_mail_not_sent", kind }, "V2_APP_BASE_URL absent : lien impossible à construire, e-mail NON envoyé.");
      return;
    }
    const until = expiresAt.toISOString().slice(0, 16).replace("T", " ");
    const text = `${intro}\n\n${link}\n\nCe lien expire le ${until} UTC. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`;
    const html = `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Ce lien expire le ${until} UTC. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`;
    await transport.sendMail({ from, to, subject, text, html });
    logger.info({ event: "iam_mail_sent", kind }, "E-mail de compte envoyé");
  };
  return {
    sendPasswordReset: (input) =>
      send("password_reset", input.email, "Réinitialisation de votre mot de passe EcoleDigitale", "Une réinitialisation de mot de passe a été demandée pour votre compte.", "/auth/reset-password", input.token, input.expiresAt),
    sendInvitation: (input) =>
      send(
        "invitation",
        input.email,
        `Invitation à rejoindre ${input.tenantName} sur EcoleDigitale`,
        `Vous êtes invité(e) à rejoindre « ${input.tenantName} » sur EcoleDigitale. Choisissez votre mot de passe pour activer votre accès.`,
        "/auth/invitation",
        input.token,
        input.expiresAt,
      ),
  };
}

/** SMTP si configuré, sinon notifieur qui journalise l'absence de transport. */
export async function accountNotifierFromEnv(env: NotifierEnv, logger: Pick<Logger, "warn" | "info">): Promise<AccountNotifier> {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return createLoggingNotifier(logger);
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number.parseInt(env.SMTP_PORT || "587", 10),
    secure: env.SMTP_SECURE === "true",
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return createSmtpNotifier(transport, env, logger);
}
