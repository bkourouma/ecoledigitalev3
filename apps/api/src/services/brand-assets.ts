/**
 * Ressources de marque partagées par les emails sortants.
 *
 * Le logo de l'institut est le même fichier que celui utilisé par les
 * bulletins côté web (`apps/web/public/logo-ipam.jpeg`). Il est embarqué dans
 * l'email en pièce jointe « inline » (Content-ID) plutôt que référencé par URL
 * : la plupart des clients de messagerie bloquent les images distantes, alors
 * qu'une image CID s'affiche toujours.
 *
 * La résolution du fichier est tolérante — API et web ne sont pas déployés au
 * même endroit selon les environnements — et un logo introuvable n'empêche
 * jamais l'envoi : l'en-tête textuel de l'email suffit.
 */

import fs from "fs";
import path from "path";

/** Content-ID référencé par `<img src="cid:...">` dans les modèles. */
export const EMAIL_LOGO_CID = "ipam-logo";
export const EMAIL_LOGO_FILENAME = "logo-ipam.jpeg";
const EMAIL_LOGO_CONTENT_TYPE = "image/jpeg";

/** Chemin public du logo, servi par le front (aperçu navigateur). */
export const EMAIL_LOGO_PUBLIC_PATH = "/logo-ipam.jpeg";

function candidatePaths(): string[] {
  const fromEnv = process.env.EMAIL_LOGO_PATH;
  const cwd = process.cwd();
  return [
    ...(fromEnv ? [fromEnv] : []),
    // Exécution depuis apps/api (dev via tsx, ou prod via dist/).
    path.resolve(cwd, "assets", EMAIL_LOGO_FILENAME),
    path.resolve(cwd, "../web/public", EMAIL_LOGO_FILENAME),
    // Exécution depuis la racine du monorepo.
    path.resolve(cwd, "apps/api/assets", EMAIL_LOGO_FILENAME),
    path.resolve(cwd, "apps/web/public", EMAIL_LOGO_FILENAME),
    // Relatif au fichier compilé (dist/services → apps/api → apps/web).
    path.resolve(__dirname, "../../assets", EMAIL_LOGO_FILENAME),
    path.resolve(__dirname, "../../../web/public", EMAIL_LOGO_FILENAME),
    path.resolve(__dirname, "../../../../apps/web/public", EMAIL_LOGO_FILENAME),
  ];
}

/** `undefined` = pas encore cherché, `null` = cherché et introuvable. */
let cachedLogo: Buffer | null | undefined;

/** Contenu binaire du logo, ou `null` s'il est introuvable. Mis en cache. */
export function loadEmailLogo(): Buffer | null {
  if (cachedLogo !== undefined) return cachedLogo;
  for (const candidate of candidatePaths()) {
    try {
      if (fs.existsSync(candidate)) {
        cachedLogo = fs.readFileSync(candidate);
        return cachedLogo;
      }
    } catch {
      // Chemin illisible : on essaie le suivant.
    }
  }
  cachedLogo = null;
  return null;
}

export interface InlineAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
}

/**
 * Pièce jointe inline à passer à nodemailer, ou `[]` si le logo est absent —
 * l'email part alors sans image, avec une icône cassée évitée par le `alt`.
 */
export function emailLogoAttachments(): InlineAttachment[] {
  const content = loadEmailLogo();
  if (!content) return [];
  return [
    {
      filename: EMAIL_LOGO_FILENAME,
      content,
      contentType: EMAIL_LOGO_CONTENT_TYPE,
      cid: EMAIL_LOGO_CID,
    },
  ];
}

/** URL absolue du logo, utilisée pour l'aperçu HTML dans le navigateur. */
export function emailLogoPreviewUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/+$/, "")}${EMAIL_LOGO_PUBLIC_PATH}`;
}
