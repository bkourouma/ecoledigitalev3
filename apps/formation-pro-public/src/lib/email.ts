import { Resend } from "resend";
import { formatCurrency, formatDate } from "@/lib/utils";

interface VerificationEmailPayload {
  to: string;
  firstName?: string | null;
  verificationUrl: string;
}

interface EnrollmentConfirmationEmailPayload {
  to: string;
  firstName?: string | null;
  formationTitle: string;
  amount: number;
  dashboardUrl: string;
  sessionLabel?: string | null;
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

function getReplyTo() {
  return process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_FROM_EMAIL;
}

function buildEmailLayout({
  preheader,
  eyebrow,
  title,
  intro,
  ctaLabel,
  ctaUrl,
  detailRows,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  detailRows: Array<{ label: string; value: string }>;
}) {
  const detailsHtml = detailRows
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 0;color:#7b7b7b;font-size:13px;">${row.label}</td>
          <td style="padding:10px 0;color:#172033;font-size:14px;font-weight:600;text-align:right;">${row.value}</td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body style="margin:0;background:#f6f1e8;color:#172033;font-family:Arial,Helvetica,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1e8;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fffaf2;border-radius:28px;overflow:hidden;">
                <tr>
                  <td style="background:linear-gradient(135deg,#eb6a2d,#1f7661);padding:28px 32px;color:#fff;">
                    <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">${eyebrow}</div>
                    <h1 style="margin:18px 0 8px;font-size:32px;line-height:1.15;">${title}</h1>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.88);">${intro}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f1e7d4;border-radius:20px;padding:0 20px;background:#fff;">
                      ${detailsHtml}
                    </table>
                    <div style="padding-top:28px;text-align:center;">
                      <a href="${ctaUrl}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#eb6a2d;color:#fff;text-decoration:none;font-weight:700;">${ctaLabel}</a>
                    </div>
                    <p style="margin:28px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">
                      Si vous avez besoin d'aide, répondez à cet email ou contactez notre équipe support.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildEmailText({
  title,
  intro,
  ctaLabel,
  ctaUrl,
  detailRows,
}: {
  title: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  detailRows: Array<{ label: string; value: string }>;
}) {
  const details = detailRows.map((row) => `- ${row.label}: ${row.value}`).join("\n");

  return [title, "", intro, "", details, "", `${ctaLabel}: ${ctaUrl}`].join("\n");
}

async function sendPortalEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const resend = getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;

  if (!resend || !from) {
    console.info(
      `[formation-pro-public] Email skipped for ${to}. Subject: ${subject}`
    );
    return;
  }

  await resend.emails.send({
    from,
    to,
    replyTo: getReplyTo(),
    subject,
    html,
    text,
  });
}

export async function sendVerificationEmail({
  to,
  firstName,
  verificationUrl,
}: VerificationEmailPayload) {
  const detailRows = [
    { label: "Adresse email", value: to },
    { label: "Action attendue", value: "Vérification du compte" },
    { label: "Lien valide", value: "24 heures" },
  ];

  const html = buildEmailLayout({
    preheader: "Confirmez votre adresse email pour activer votre espace apprenant.",
    eyebrow: "Vérification",
    title: `Bienvenue${firstName ? ` ${firstName}` : ""}`,
    intro:
      "Votre compte est presque prêt. Confirmez votre adresse email pour activer l'inscription, le paiement et l'accès à vos contenus.",
    ctaLabel: "Vérifier mon email",
    ctaUrl: verificationUrl,
    detailRows,
  });
  const text = buildEmailText({
    title: `Bienvenue${firstName ? ` ${firstName}` : ""}`,
    intro:
      "Votre compte est presque prêt. Confirmez votre adresse email pour activer l'inscription, le paiement et l'accès à vos contenus.",
    ctaLabel: "Vérifier mon email",
    ctaUrl: verificationUrl,
    detailRows,
  });

  await sendPortalEmail({
    to,
    subject: "Confirmez votre compte Formation Pro",
    html,
    text,
  });
}

export async function sendEnrollmentConfirmationEmail({
  to,
  firstName,
  formationTitle,
  amount,
  dashboardUrl,
  sessionLabel,
}: EnrollmentConfirmationEmailPayload) {
  const detailRows = [
    { label: "Formation", value: formationTitle },
    { label: "Montant confirmé", value: formatCurrency(amount) },
    {
      label: "Session",
      value: sessionLabel || "Parcours général",
    },
    { label: "Date", value: formatDate(new Date()) },
  ];

  const html = buildEmailLayout({
    preheader: "Votre paiement a bien été confirmé et votre espace apprenant est ouvert.",
    eyebrow: "Paiement confirmé",
    title: `Votre accès est actif${firstName ? `, ${firstName}` : ""}`,
    intro:
      "Merci pour votre confiance. Votre inscription est maintenant confirmée et vos contenus sont accessibles depuis votre espace apprenant.",
    ctaLabel: "Ouvrir mon espace apprenant",
    ctaUrl: dashboardUrl,
    detailRows,
  });
  const text = buildEmailText({
    title: `Votre accès est actif${firstName ? `, ${firstName}` : ""}`,
    intro:
      "Merci pour votre confiance. Votre inscription est maintenant confirmée et vos contenus sont accessibles depuis votre espace apprenant.",
    ctaLabel: "Ouvrir mon espace apprenant",
    ctaUrl: dashboardUrl,
    detailRows,
  });

  await sendPortalEmail({
    to,
    subject: `Inscription confirmée - ${formationTitle}`,
    html,
    text,
  });
}
