/**
 * Student credentials email — template storage & rendering.
 *
 * Mirrors `teacher-credentials-email.ts`: the subject/body pair is
 * customisable per tenant (persisted in `tenants.settings_json ->
 * studentCredentialsEmail`) and can also be overridden per request from the
 * "Nouvel étudiant" form.
 *
 * Both fields support `{{variable}}` placeholders; every substituted value is
 * HTML-escaped so a password containing `&` or `<` cannot break the markup.
 */

import type { PoolClient } from "pg";
import {
  renderTemplateString,
  renderTemplateSubject,
  htmlToPlainText,
  resolveTenantName,
} from "./teacher-credentials-email";

export const STUDENT_CREDENTIALS_SETTINGS_KEY = "studentCredentialsEmail";

export interface StudentCredentialsTemplate {
  subject: string;
  body: string;
}

/** Placeholders offered in the UI, in display order. */
export const STUDENT_CREDENTIALS_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "firstName", label: "Prénom de l'étudiant" },
  { key: "lastName", label: "Nom de l'étudiant" },
  { key: "fullName", label: "Prénom + Nom" },
  { key: "email", label: "Email de connexion" },
  { key: "password", label: "Mot de passe généré" },
  { key: "loginUrl", label: "Lien vers la page de connexion" },
  { key: "schoolName", label: "Nom de l'établissement" },
  { key: "studentMatricule", label: "Matricule de l'étudiant" },
  { key: "currentYear", label: "Année d'études" },
];

export const DEFAULT_STUDENT_CREDENTIALS_TEMPLATE: StudentCredentialsTemplate = {
  subject: "Vos identifiants de connexion - {{schoolName}}",
  body: `<p>Bonjour {{firstName}} {{lastName}},</p>

<p>Votre compte étudiant auprès de <strong>{{schoolName}}</strong> vient d'être créé.
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

export interface StudentCredentialsContext {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  loginUrl: string;
  schoolName: string;
  studentMatricule?: string | null;
  currentYear?: number | null;
}

export function buildStudentCredentialsVariables(
  ctx: StudentCredentialsContext
): Record<string, string> {
  return {
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    fullName: `${ctx.firstName} ${ctx.lastName}`.trim(),
    email: ctx.email,
    password: ctx.password,
    loginUrl: ctx.loginUrl,
    schoolName: ctx.schoolName,
    studentMatricule: ctx.studentMatricule ?? "",
    currentYear: ctx.currentYear != null ? String(ctx.currentYear) : "",
  };
}

/** Wrap the rendered body in the branded shell shared with the other emails. */
export function wrapStudentCredentialsHtml(bodyHtml: string, schoolName: string): string {
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
    .header { background-color: #2563eb; color: #fff; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { padding: 20px; background-color: #f9fafb; }
    .creds { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0; }
    .creds p { margin: 6px 0; }
    .btn { display:inline-block; background:#2563eb; color:#fff !important; text-decoration:none;
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

/**
 * Read the tenant's saved template, falling back to the default for any
 * missing field. Never throws — a broken settings blob yields the default.
 */
export async function loadTenantStudentCredentialsTemplate(
  client: PoolClient | { query: (sql: string, params?: any[]) => Promise<any> },
  tenantId: string
): Promise<StudentCredentialsTemplate> {
  try {
    const result = await client.query(
      `SELECT settings_json -> $2 AS template FROM tenants WHERE id = $1`,
      [tenantId, STUDENT_CREDENTIALS_SETTINGS_KEY]
    );
    const saved = result.rows[0]?.template;
    return {
      subject: isNonEmptyString(saved?.subject)
        ? saved.subject
        : DEFAULT_STUDENT_CREDENTIALS_TEMPLATE.subject,
      body: isNonEmptyString(saved?.body) ? saved.body : DEFAULT_STUDENT_CREDENTIALS_TEMPLATE.body,
    };
  } catch {
    return { ...DEFAULT_STUDENT_CREDENTIALS_TEMPLATE };
  }
}

/** Persist the template into `tenants.settings_json` (merge, not overwrite). */
export async function saveTenantStudentCredentialsTemplate(
  client: PoolClient | { query: (sql: string, params?: any[]) => Promise<any> },
  tenantId: string,
  template: StudentCredentialsTemplate
): Promise<void> {
  await client.query(
    `UPDATE tenants
        SET settings_json = COALESCE(settings_json, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, STUDENT_CREDENTIALS_SETTINGS_KEY, JSON.stringify(template)]
  );
}

export { resolveTenantName };

/** Render subject + full HTML + text from a template and a context. */
export function renderStudentCredentialsEmail(
  template: StudentCredentialsTemplate,
  ctx: StudentCredentialsContext
): { subject: string; html: string; text: string } {
  const variables = buildStudentCredentialsVariables(ctx);
  const subject = renderTemplateSubject(template.subject, variables);
  const renderedBody = renderTemplateString(template.body, variables);
  return {
    subject,
    html: wrapStudentCredentialsHtml(renderedBody, ctx.schoolName),
    text: htmlToPlainText(renderedBody),
  };
}
