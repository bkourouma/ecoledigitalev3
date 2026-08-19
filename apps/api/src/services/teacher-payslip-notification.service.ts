/**
 * Notification de l'enseignant à la génération de son bulletin — feature 031.
 *
 * Réutilise la configuration SMTP existante (`email.service.ts`, variables
 * SMTP_*) et le logo institutionnel embarqué en CID (`brand-assets.ts`) : les
 * clients de messagerie bloquent massivement les images distantes, une image
 * référencée par URL n'apparaîtrait pas.
 *
 * LE BULLETIN EST JOINT AU MESSAGE. Un email qui annonce un bulletin sans le
 * porter oblige l'enseignant à se connecter pour un document qui le concerne ;
 * et le lien serait périmé au premier changement d'URL.
 *
 * L'ÉCHEC D'ENVOI N'ANNULE JAMAIS LA GÉNÉRATION. Un serveur SMTP indisponible
 * ne doit pas empêcher un bulletin d'exister : la notification est un effet de
 * bord, pas une condition. Les erreurs sont remontées, jamais propagées.
 */

import { EmailService } from "./email.service";
import { EMAIL_LOGO_CID, EMAIL_LOGO_FILENAME, loadEmailLogo } from "./brand-assets";
import type { PayslipData } from "./teacher-payslip-template.service";

/** Palette des attestations — le mail et le PDF doivent se ressembler. */
const BLEU_TITRE = "#173e73";
const BLEU_INSTITUTION = "#2c5588";
const BLEU_ENCRE = "#243a5a";
const GRIS_DISCRET = "#70809a";
const BORDURE = "#d9e3f2";

const echappe = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const montant = (v: number, devise: string): string =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v || 0))} ${devise}`;

const jour = (v: string | null): string => {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("fr-FR");
};

/** Nom de fichier lisible : « bulletin-paie-awa-cisse-septembre-2025.pdf ». */
export function nomFichierBulletin(d: PayslipData): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `bulletin-paie-${slug(d.enseignantNom)}-${slug(d.periodeNom)}.pdf`;
}

function corpsHtml(d: PayslipData): string {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f7fc;font-family:Arial,Helvetica,sans-serif;color:${BLEU_ENCRE};">
    <div style="max-width:620px;margin:0 auto;padding:24px;">
      <div style="background:#fff;border:1px solid ${BORDURE};border-radius:12px;overflow:hidden;">

        <div style="padding:24px 28px 18px;text-align:center;">
          <img src="cid:${EMAIL_LOGO_CID}" alt="" style="width:110px;max-width:100%;display:block;margin:0 auto 10px;" />
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;color:${BLEU_INSTITUTION};">
            ${echappe(d.etablissementNom)}
          </div>
          <div style="margin-top:12px;height:2px;background:linear-gradient(90deg,#4d86e4,#89aef2);"></div>
        </div>

        <div style="padding:4px 28px 24px;">
          <h1 style="margin:8px 0 4px;font-size:19px;color:${BLEU_TITRE};text-align:center;">
            Votre bulletin de paie est disponible
          </h1>
          <p style="text-align:center;color:${GRIS_DISCRET};font-style:italic;margin:0 0 20px;font-size:14px;">
            ${echappe(d.periodeNom)}
          </p>

          <p style="font-size:14px;line-height:1.6;">Bonjour ${echappe(d.enseignantNom)},</p>
          <p style="font-size:14px;line-height:1.6;">
            Votre bulletin de paie pour la période du <strong>${echappe(jour(d.periodeDebut))}</strong>
            au <strong>${echappe(jour(d.periodeFin))}</strong> vient d'être établi.
            Vous le trouverez en pièce jointe au format PDF.
          </p>

          <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid ${BORDURE};border-radius:10px;background:#f9fbff;">
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:${GRIS_DISCRET};">Heures rémunérées</td>
              <td style="padding:10px 14px;font-size:13px;text-align:right;font-weight:700;color:${BLEU_TITRE};">
                ${echappe(String(d.heuresNormales + d.heuresSup).replace(".", ","))} h
              </td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:${GRIS_DISCRET};border-top:1px solid ${BORDURE};">
                Net à payer
              </td>
              <td style="padding:10px 14px;font-size:16px;text-align:right;font-weight:700;color:${BLEU_TITRE};border-top:1px solid ${BORDURE};">
                ${echappe(montant(d.montantTotal, d.devise))}
              </td>
            </tr>
          </table>

          <p style="font-size:13px;line-height:1.6;color:${GRIS_DISCRET};">
            Le détail des heures figure dans le document joint. En cas de désaccord sur un montant
            ou une séance, contactez l'administration en citant la référence
            <strong>${echappe(d.paiementId.slice(0, 8).toUpperCase())}</strong>.
          </p>
        </div>

        <div style="padding:14px 28px;border-top:1px solid ${BORDURE};text-align:center;font-size:11px;color:${GRIS_DISCRET};">
          Message automatique — merci de ne pas y répondre.<br />
          Document confidentiel, destiné à votre usage exclusif.
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function corpsTexte(d: PayslipData): string {
  return [
    `Bonjour ${d.enseignantNom},`,
    ``,
    `Votre bulletin de paie pour la periode ${d.periodeNom}`,
    `(du ${jour(d.periodeDebut)} au ${jour(d.periodeFin)}) vient d'etre etabli.`,
    `Il est joint a ce message au format PDF.`,
    ``,
    `Heures remunerees : ${d.heuresNormales + d.heuresSup} h`,
    `Net a payer       : ${montant(d.montantTotal, d.devise)}`,
    ``,
    `Reference : ${d.paiementId.slice(0, 8).toUpperCase()}`,
    ``,
    `Message automatique, merci de ne pas y repondre.`,
  ].join("\n");
}

export interface ResultatNotification {
  envoye: boolean;
  destinataire: string | null;
  motif?: string;
}

export class TeacherPayslipNotificationService {
  private readonly email = new EmailService();

  /**
   * Notifie l'enseignant, bulletin PDF en pièce jointe.
   *
   * Ne lève jamais : un échec d'envoi est renvoyé comme résultat. C'est
   * l'appelant qui décide s'il doit compter comme une anomalie — la génération
   * du bulletin, elle, reste valide.
   */
  async notifier(data: PayslipData, pdf: Buffer): Promise<ResultatNotification> {
    if (!data.enseignantEmail) {
      return { envoye: false, destinataire: null, motif: "Aucune adresse courriel connue." };
    }

    const piecesJointes: NonNullable<Parameters<EmailService["sendEmail"]>[0]["attachments"]> = [
      {
        filename: nomFichierBulletin(data),
        content: pdf,
        contentType: "application/pdf",
      },
    ];

    // Le logo n'est joint que s'il a été trouvé : une pièce jointe vide
    // afficherait une image cassée dans le corps du message.
    const logo = loadEmailLogo();
    if (logo) {
      piecesJointes.push({
        filename: EMAIL_LOGO_FILENAME,
        content: logo,
        contentType: "image/jpeg",
        cid: EMAIL_LOGO_CID,
      });
    }

    try {
      await this.email.sendEmail({
        to: data.enseignantEmail,
        subject: `Bulletin de paie — ${data.periodeNom}`,
        html: corpsHtml(data),
        text: corpsTexte(data),
        attachments: piecesJointes,
      });
      return { envoye: true, destinataire: data.enseignantEmail };
    } catch (error) {
      return {
        envoye: false,
        destinataire: data.enseignantEmail,
        motif: (error as Error).message,
      };
    }
  }
}
