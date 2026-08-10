/**
 * Teacher credentials email — template storage & rendering.
 *
 * The subject/body pair is customisable per tenant (persisted in
 * `tenants.settings_json -> teacherCredentialsEmail`) and can also be
 * overridden per request from the "Nouvel enseignant" form.
 *
 * Both fields support `{{variable}}` placeholders; every substituted value is
 * HTML-escaped so a password containing `&` or `<` cannot break the markup.
 */

import type { PoolClient } from "pg";

export const TEACHER_CREDENTIALS_SETTINGS_KEY = "teacherCredentialsEmail";

export interface TeacherCredentialsTemplate {
  subject: string;
  body: string;
}

/** Placeholders offered in the UI, in display order. */
export const TEACHER_CREDENTIALS_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "firstName", label: "Prénom de l'enseignant" },
  { key: "lastName", label: "Nom de l'enseignant" },
  { key: "fullName", label: "Prénom + Nom" },
  { key: "email", label: "Email de connexion" },
  { key: "password", label: "Mot de passe généré" },
  { key: "loginUrl", label: "Lien vers la page de connexion" },
  { key: "schoolName", label: "Nom de l'établissement" },
  { key: "employeeNumber", label: "Numéro d'employé" },
  { key: "contractType", label: "Type de contrat" },
  { key: "hireDate", label: "Date d'embauche" },
];

export const DEFAULT_TEACHER_CREDENTIALS_TEMPLATE: TeacherCredentialsTemplate = {
  subject: "Vos identifiants de connexion - {{schoolName}}",
  body: `<p>Bonjour {{firstName}} {{lastName}},</p>

<p>Votre compte enseignant auprès de <strong>{{schoolName}}</strong> vient d'être créé.
Voici vos identifiants de connexion :</p>

<div class="creds">
  <p><strong>Email :</strong> {{email}}</p>
  <p><strong>Mot de passe :</strong> {{password}}</p>
</div>

<p><a class="btn" href="{{loginUrl}}">Se connecter à mon espace</a></p>

<p>Pour des raisons de sécurité, nous vous recommandons de modifier ce mot de passe
dès votre première connexion.</p>

<p>Cordialement,<br>L'équipe {{schoolName}}</p>`,
};

/** HTML entity escaping for interpolated values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace every `{{variable}}` occurrence. Unknown placeholders are left
 * untouched so a typo is visible in the preview rather than silently blanked.
 */
export function renderTemplateString(
  template: string,
  variables: Record<string, string | null | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) return match;
    return escapeHtml(String(variables[name] ?? ""));
  });
}

const CONTRACT_LABELS: Record<string, string> = {
  permanent: "CDI (Permanent)",
  temporary: "CDD (Temporaire)",
  freelance: "Vacataire",
};

export interface TeacherCredentialsContext {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  loginUrl: string;
  schoolName: string;
  employeeNumber?: string | null;
  contractType?: string | null;
  hireDate?: string | null;
}

export function buildTeacherCredentialsVariables(
  ctx: TeacherCredentialsContext
): Record<string, string> {
  return {
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    fullName: `${ctx.firstName} ${ctx.lastName}`.trim(),
    email: ctx.email,
    password: ctx.password,
    loginUrl: ctx.loginUrl,
    schoolName: ctx.schoolName,
    employeeNumber: ctx.employeeNumber ?? "",
    contractType: ctx.contractType ? CONTRACT_LABELS[ctx.contractType] ?? ctx.contractType : "",
    hireDate: ctx.hireDate ? new Date(ctx.hireDate).toLocaleDateString("fr-FR") : "",
  };
}

/** Wrap the rendered body in the branded shell shared with the other emails. */
export function wrapTeacherCredentialsHtml(bodyHtml: string, schoolName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #7c3aed; color: #fff; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { padding: 20px; background-color: #f9fafb; }
    .creds { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0; }
    .creds p { margin: 6px 0; }
    .btn { display:inline-block; background:#7c3aed; color:#fff !important; text-decoration:none;
           padding:10px 20px; border-radius:6px; margin-top:8px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(schoolName)}</h1></div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">
      <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
    </div>
  </div>
</body>
</html>`;
}

/** Rough plain-text alternative derived from the rendered HTML body. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Read the tenant's saved template, falling back to the default for any
 * missing field. Never throws — a broken settings blob yields the default.
 */
export async function loadTenantTeacherCredentialsTemplate(
  client: PoolClient | { query: (sql: string, params?: any[]) => Promise<any> },
  tenantId: string
): Promise<TeacherCredentialsTemplate> {
  try {
    const result = await client.query(
      `SELECT settings_json -> $2 AS template FROM tenants WHERE id = $1`,
      [tenantId, TEACHER_CREDENTIALS_SETTINGS_KEY]
    );
    const saved = result.rows[0]?.template;
    return {
      subject: isNonEmptyString(saved?.subject)
        ? saved.subject
        : DEFAULT_TEACHER_CREDENTIALS_TEMPLATE.subject,
      body: isNonEmptyString(saved?.body) ? saved.body : DEFAULT_TEACHER_CREDENTIALS_TEMPLATE.body,
    };
  } catch {
    return { ...DEFAULT_TEACHER_CREDENTIALS_TEMPLATE };
  }
}

/** Persist the template into `tenants.settings_json` (merge, not overwrite). */
export async function saveTenantTeacherCredentialsTemplate(
  client: PoolClient | { query: (sql: string, params?: any[]) => Promise<any> },
  tenantId: string,
  template: TeacherCredentialsTemplate
): Promise<void> {
  await client.query(
    `UPDATE tenants
        SET settings_json = COALESCE(settings_json, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, TEACHER_CREDENTIALS_SETTINGS_KEY, JSON.stringify(template)]
  );
}

/** Resolve the school display name, defaulting gracefully. */
export async function resolveTenantName(
  client: PoolClient | { query: (sql: string, params?: any[]) => Promise<any> },
  tenantId: string
): Promise<string> {
  try {
    const result = await client.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
    return result.rows[0]?.name || "EcoleDigitale";
  } catch {
    return "EcoleDigitale";
  }
}

/** Render subject + full HTML + text from a template and a context. */
export function renderTeacherCredentialsEmail(
  template: TeacherCredentialsTemplate,
  ctx: TeacherCredentialsContext
): { subject: string; html: string; text: string } {
  const variables = buildTeacherCredentialsVariables(ctx);
  const subject = renderTemplateString(template.subject, variables);
  const renderedBody = renderTemplateString(template.body, variables);
  return {
    subject,
    html: wrapTeacherCredentialsHtml(renderedBody, ctx.schoolName),
    text: htmlToPlainText(renderedBody),
  };
}
