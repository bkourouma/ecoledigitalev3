/**
 * Parent credentials email — template storage & rendering.
 *
 * Mirrors `teacher-credentials-email.ts` / `student-credentials-email.ts` :
 * le couple sujet/corps est personnalisable par établissement (persisté dans
 * `tenants.settings_json -> parentCredentialsEmail`) et peut aussi être
 * surchargé par requête depuis le formulaire « Nouveau parent ».
 *
 * Les deux champs acceptent des `{{variable}}` ; chaque valeur substituée est
 * échappée en HTML pour qu'un mot de passe contenant `&` ou `<` ne casse pas
 * le rendu.
 */

import type { PoolClient } from "pg";
import {
  renderTemplateString,
  renderTemplateSubject,
  htmlToPlainText,
  resolveTenantName,
} from "./teacher-credentials-email";

export const PARENT_CREDENTIALS_SETTINGS_KEY = "parentCredentialsEmail";

export interface ParentCredentialsTemplate {
  subject: string;
  body: string;
}

/** Placeholders proposés dans l'UI, dans l'ordre d'affichage. */
export const PARENT_CREDENTIALS_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "firstName", label: "Prénom du parent" },
  { key: "lastName", label: "Nom du parent" },
  { key: "fullName", label: "Prénom + Nom" },
  { key: "email", label: "Email de connexion" },
  { key: "password", label: "Mot de passe généré" },
  { key: "loginUrl", label: "Lien vers la page de connexion" },
  { key: "schoolName", label: "Nom de l'établissement" },
];

/** Clé du modèle dédié à la réinitialisation de mot de passe. */
export const PARENT_PASSWORD_RESET_SETTINGS_KEY = "parentPasswordResetEmail";

export const DEFAULT_PARENT_CREDENTIALS_TEMPLATE: ParentCredentialsTemplate = {
  subject: "Vos identifiants de connexion - {{schoolName}}",
  body: `<p>Bonjour {{firstName}} {{lastName}},</p>

<p>Votre compte parent auprès de <strong>{{schoolName}}</strong> vient d'être créé.
Il vous permet de suivre la scolarité de vos enfants. Voici vos identifiants de
connexion :</p>

<div class="creds">
  <p><strong>Email :</strong> {{email}}</p>
  <p><strong>Mot de passe :</strong> {{password}}</p>
</div>

<p><a class="btn" href="{{loginUrl}}">Se connecter à mon espace</a></p>

<p>Pour des raisons de sécurité, nous vous recommandons de modifier ce mot de passe
dès votre première connexion.</p>

<p>Cordialement,<br>L'équipe {{schoolName}}</p>`,
};

/**
 * Modèle dédié à la réinitialisation : mêmes variables que le modèle de
 * création, mais une formulation qui ne parle pas d'un compte « créé ».
 */
export const DEFAULT_PARENT_PASSWORD_RESET_TEMPLATE: ParentCredentialsTemplate = {
  subject: "Réinitialisation de votre mot de passe - {{schoolName}}",
  body: `<p>Bonjour {{firstName}} {{lastName}},</p>

<p>Le mot de passe de votre compte parent auprès de <strong>{{schoolName}}</strong>
vient d'être réinitialisé. Voici vos nouveaux identifiants de connexion :</p>

<div class="creds">
  <p><strong>Email :</strong> {{email}}</p>
  <p><strong>Nouveau mot de passe :</strong> {{password}}</p>
</div>

<p><a class="btn" href="{{loginUrl}}">Se connecter à mon espace</a></p>

<p>Pour des raisons de sécurité, nous vous recommandons de modifier ce mot de passe
dès votre prochaine connexion. Si vous n'êtes pas à l'origine de cette demande,
contactez l'établissement sans tarder.</p>

<p>Cordialement,<br>L'équipe {{schoolName}}</p>`,
};

export interface ParentCredentialsContext {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  loginUrl: string;
  schoolName: string;
}

export function buildParentCredentialsVariables(
  ctx: ParentCredentialsContext
): Record<string, string> {
  return {
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    fullName: `${ctx.firstName} ${ctx.lastName}`.trim(),
    email: ctx.email,
    password: ctx.password,
    loginUrl: ctx.loginUrl,
    schoolName: ctx.schoolName,
  };
}

/** Habillage de marque partagé avec les autres emails d'identifiants. */
export function wrapParentCredentialsHtml(bodyHtml: string, schoolName: string): string {
  const escapedSchoolName = schoolName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #e11d48; color: #fff; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { padding: 20px; background-color: #f9fafb; }
    .creds { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0; }
    .creds p { margin: 6px 0; }
    .btn { display:inline-block; background:#e11d48; color:#fff !important; text-decoration:none;
           padding:10px 20px; border-radius:6px; margin-top:8px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>${escapedSchoolName}</h1></div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">
      <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
    </div>
  </div>
</body>
</html>`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type QueryableClient = PoolClient | { query: (sql: string, params?: any[]) => Promise<any> };

/**
 * Lit un modèle enregistré pour l'établissement, avec repli sur le modèle par
 * défaut pour tout champ manquant. Ne lève jamais : un blob `settings_json`
 * corrompu renvoie simplement le modèle par défaut.
 */
async function loadTenantTemplate(
  client: QueryableClient,
  tenantId: string,
  settingsKey: string,
  fallback: ParentCredentialsTemplate
): Promise<ParentCredentialsTemplate> {
  try {
    const result = await client.query(
      `SELECT settings_json -> $2 AS template FROM tenants WHERE id = $1`,
      [tenantId, settingsKey]
    );
    const saved = result.rows[0]?.template;
    return {
      subject: isNonEmptyString(saved?.subject) ? saved.subject : fallback.subject,
      body: isNonEmptyString(saved?.body) ? saved.body : fallback.body,
    };
  } catch {
    return { ...fallback };
  }
}

/** Enregistre un modèle dans `tenants.settings_json` (fusion, pas écrasement). */
async function saveTenantTemplate(
  client: QueryableClient,
  tenantId: string,
  settingsKey: string,
  template: ParentCredentialsTemplate
): Promise<void> {
  await client.query(
    `UPDATE tenants
        SET settings_json = COALESCE(settings_json, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, settingsKey, JSON.stringify(template)]
  );
}

/** Modèle envoyé à la création du compte parent. */
export function loadTenantParentCredentialsTemplate(
  client: QueryableClient,
  tenantId: string
): Promise<ParentCredentialsTemplate> {
  return loadTenantTemplate(
    client,
    tenantId,
    PARENT_CREDENTIALS_SETTINGS_KEY,
    DEFAULT_PARENT_CREDENTIALS_TEMPLATE
  );
}

export function saveTenantParentCredentialsTemplate(
  client: QueryableClient,
  tenantId: string,
  template: ParentCredentialsTemplate
): Promise<void> {
  return saveTenantTemplate(client, tenantId, PARENT_CREDENTIALS_SETTINGS_KEY, template);
}

/** Modèle envoyé lors d'une réinitialisation de mot de passe. */
export function loadTenantParentPasswordResetTemplate(
  client: QueryableClient,
  tenantId: string
): Promise<ParentCredentialsTemplate> {
  return loadTenantTemplate(
    client,
    tenantId,
    PARENT_PASSWORD_RESET_SETTINGS_KEY,
    DEFAULT_PARENT_PASSWORD_RESET_TEMPLATE
  );
}

export function saveTenantParentPasswordResetTemplate(
  client: QueryableClient,
  tenantId: string,
  template: ParentCredentialsTemplate
): Promise<void> {
  return saveTenantTemplate(client, tenantId, PARENT_PASSWORD_RESET_SETTINGS_KEY, template);
}

export { resolveTenantName };

/** Rend le sujet, le HTML complet et l'alternative texte. */
export function renderParentCredentialsEmail(
  template: ParentCredentialsTemplate,
  ctx: ParentCredentialsContext
): { subject: string; html: string; text: string } {
  const variables = buildParentCredentialsVariables(ctx);
  const subject = renderTemplateSubject(template.subject, variables);
  const renderedBody = renderTemplateString(template.body, variables);
  return {
    subject,
    html: wrapParentCredentialsHtml(renderedBody, ctx.schoolName),
    text: htmlToPlainText(renderedBody),
  };
}
