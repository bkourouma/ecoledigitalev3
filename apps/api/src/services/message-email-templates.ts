/**
 * Rendu et persistance des modèles d'email de la messagerie.
 *
 * Le catalogue des modèles (un par cas d'envoi et par profil) vit dans
 * `message-email-definitions.ts` ; ce fichier ne s'occupe que de la
 * substitution des variables, de la coquille HTML aux couleurs de l'IPAM et de
 * la personnalisation par établissement, persistée dans
 * `tenants.settings_json`.
 *
 * Les modèles supportent les placeholders `{{variable}}` ; toute valeur
 * substituée dans le corps est échappée (un message contenant `<` ou `&` ne
 * peut pas casser le HTML), tandis que le sujet — texte brut — ne l'est pas.
 */

import type { PoolClient } from "pg";
import { htmlToPlainText, renderTemplateSubject } from "./teacher-credentials-email";
import { EMAIL_LOGO_CID } from "./brand-assets";
import {
  IPAM_GREEN,
  MESSAGE_TEMPLATE_DEFINITIONS,
  MESSAGE_TEMPLATE_KINDS,
  type MessageEmailTemplate,
  type MessageTemplateKind,
} from "./message-email-definitions";

export {
  IPAM_GREEN,
  MESSAGE_TEMPLATE_DEFINITIONS,
  MESSAGE_TEMPLATE_KINDS,
  MESSAGE_TEMPLATE_PROFILE_LABELS,
  isMessageTemplateKind,
  messageTemplateKindsForProfile,
} from "./message-email-definitions";
export type {
  MessageEmailTemplate,
  MessageTemplateDefinition,
  MessageTemplateKind,
  MessageTemplateProfile,
  MessageTemplateVariable,
} from "./message-email-definitions";

/**
 * Clé de stockage dans `tenants.settings_json`. Le nom porte encore le
 * préfixe `admin` pour raison historique : le nœud héberge désormais les
 * modèles des quatre profils, tous administrés depuis l'espace administrateur.
 */
export const MESSAGE_EMAIL_SETTINGS_KEY = "adminMessageEmailTemplates";

/* --------------------------------------------------------------------------
 * Identité visuelle IPAM (alignée sur apps/web/src/lib/bulletin-format.ts)
 * ------------------------------------------------------------------------ */

export const INSTITUT_NOM = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT";
export const INSTITUT_SIGLE = "IPAM";
export const INSTITUT_ADRESSE =
  "Siège : Abidjan – Cocody, II Plateaux · Tél. : (225) 27 22 25 49 31 · 06 BP 2708 Abidjan 06";
export const INSTITUT_WEB = "www.ipam.ci";
export const INSTITUT_EMAIL = "info@ipam.ci";
export const IPAM_GREEN_LIGHT = "#E8F0EB";

const PRIORITY_LABELS: Record<string, string> = {
  low: "Faible",
  normal: "Normale",
  high: "Élevée",
  urgent: "Urgente",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#64748B",
  normal: IPAM_GREEN,
  high: "#B45309",
  urgent: "#B91C1C",
};

export function priorityLabel(level?: string | null): string {
  return PRIORITY_LABELS[level || "normal"] || PRIORITY_LABELS.normal;
}


/* --------------------------------------------------------------------------
 * Rendu
 * ------------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texte saisi dans le formulaire → HTML : échappé puis sauts de ligne rendus. */
function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/**
 * Substitue les `{{variable}}` du corps HTML. Toutes les valeurs sont
 * échappées ; `message`, seul champ multiligne, voit en plus ses retours à la
 * ligne convertis en `<br>` pour rester lisible dans l'email.
 */
function renderBodyTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) return match;
    const value = String(variables[name] ?? "");
    return name === "message" ? textToHtml(value) : escapeHtml(value);
  });
}

export interface MessageEmailContext {
  /** Nom affiché du destinataire (parent, enseignant, étudiant). */
  recipientName: string;
  subject: string;
  /** Contenu brut saisi par l'administrateur. */
  message: string;
  senderName: string;
  schoolName: string;
  priorityLevel?: string | null;
  portalUrl: string;
  sentAt?: Date;
  /** Variables spécifiques au type d'envoi (childName, conversationSubject…). */
  extra?: Record<string, string | null | undefined>;
}

export function buildMessageEmailVariables(
  kind: MessageTemplateKind,
  ctx: MessageEmailContext
): Record<string, string> {
  const sentAt = ctx.sentAt ?? new Date();
  const base: Record<string, string> = {
    recipientName: ctx.recipientName,
    subject: ctx.subject,
    message: ctx.message,
    senderName: ctx.senderName,
    schoolName: ctx.schoolName,
    instituteName: INSTITUT_NOM,
    priority: priorityLabel(ctx.priorityLevel),
    portalUrl: ctx.portalUrl,
    sentAt: sentAt.toLocaleString("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }),
  };

  // Les alias par rôle évitent d'obliger l'administrateur à connaître
  // `recipientName` / `senderName` : chaque modèle expose le nom qui lui parle
  // (`{{parentName}}` pour un email destiné à un parent, etc.).
  const definition = MESSAGE_TEMPLATE_DEFINITIONS[kind];
  if (definition?.recipientAlias) base[definition.recipientAlias] = ctx.recipientName;
  if (definition?.senderAlias) base[definition.senderAlias] = ctx.senderName;

  // `extra` passe en dernier : une valeur explicitement fournie par l'appelant
  // prime sur l'alias (cas d'un enseignant qui écrit *à propos* d'un élève).
  for (const [key, value] of Object.entries(ctx.extra ?? {})) {
    base[key] = value ?? "";
  }
  return base;
}

/**
 * Coquille HTML commune : bandeau IPAM (logo + nom de l'institut), corps du
 * message et pied de page institutionnel. `logoSrc` vaut `cid:...` pour un
 * envoi réel (image embarquée) et une URL http pour l'aperçu du navigateur.
 */
export function wrapMessageEmailHtml(params: {
  bodyHtml: string;
  schoolName: string;
  accent: string;
  priorityLevel?: string | null;
  logoSrc: string;
  showPriorityBadge?: boolean;
}): string {
  const { bodyHtml, schoolName, accent, priorityLevel, logoSrc } = params;
  const level = priorityLevel || "normal";
  const showBadge = params.showPriorityBadge !== false && level !== "normal";
  const badgeColor = PRIORITY_COLORS[level] || IPAM_GREEN;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(schoolName)}</title>
  <style>
    body { margin:0; padding:0; background:#F1F5F4; font-family:Arial, Helvetica, sans-serif;
           color:#1F2937; line-height:1.6; }
    .wrapper { width:100%; background:#F1F5F4; padding:24px 12px; }
    .container { max-width:620px; margin:0 auto; background:#FFFFFF; border-radius:12px;
                 overflow:hidden; border:1px solid #E2E8F0; }
    .header { background:${accent}; color:#FFFFFF; padding:24px; text-align:center; }
    .header img { display:block; margin:0 auto 12px; height:64px; width:auto; border-radius:8px;
                  background:#FFFFFF; padding:6px; }
    .header .sigle { font-size:22px; font-weight:bold; letter-spacing:2px; margin:0; }
    .header .institut { font-size:11px; letter-spacing:.6px; margin:6px 0 0; opacity:.9;
                        text-transform:uppercase; }
    .header .school { font-size:13px; margin:10px 0 0; opacity:.95; }
    .accent-bar { height:4px; background:${IPAM_GREEN_LIGHT}; }
    .badge { display:inline-block; margin:14px 0 0; padding:4px 12px; border-radius:999px;
             background:${badgeColor}; color:#FFFFFF; font-size:11px; font-weight:bold;
             text-transform:uppercase; letter-spacing:.5px; }
    .content { padding:28px 28px 8px; font-size:15px; }
    .content p { margin:0 0 14px; }
    .message-card { background:${IPAM_GREEN_LIGHT}; border-left:4px solid ${accent};
                    border-radius:8px; padding:16px 18px; margin:18px 0; }
    .message-subject { margin:0 0 8px !important; font-weight:bold; color:${IPAM_GREEN};
                       font-size:16px; }
    .message-body { white-space:normal; color:#111827; }
    .cta-wrapper { text-align:center; margin:24px 0 8px !important; }
    .btn { display:inline-block; background:${accent}; color:#FFFFFF !important;
           text-decoration:none; padding:12px 26px; border-radius:8px; font-weight:bold;
           font-size:14px; }
    .signature { margin-top:22px !important; color:#374151; }
    .footer { padding:20px 28px 24px; text-align:center; color:#6B7280; font-size:11px;
              border-top:1px solid #E5E7EB; }
    .footer p { margin:4px 0; }
    @media (max-width:480px) {
      .content, .footer { padding-left:18px; padding-right:18px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="${logoSrc}" alt="${escapeHtml(INSTITUT_SIGLE)}">
        <p class="sigle">${escapeHtml(INSTITUT_SIGLE)}</p>
        <p class="institut">${escapeHtml(INSTITUT_NOM)}</p>
        <p class="school">${escapeHtml(schoolName)}</p>
        ${showBadge ? `<span class="badge">Priorité ${escapeHtml(priorityLabel(level))}</span>` : ""}
      </div>
      <div class="accent-bar"></div>
      <div class="content">${bodyHtml}</div>
      <div class="footer">
        <p>${escapeHtml(INSTITUT_ADRESSE)}</p>
        <p>${escapeHtml(INSTITUT_WEB)} · ${escapeHtml(INSTITUT_EMAIL)}</p>
        <p>Cet email a été envoyé automatiquement depuis l'espace ${escapeHtml(schoolName)}, merci de ne pas y répondre.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderedMessageEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Rend un modèle complet. `logoSrc` par défaut pointe sur l'image embarquée
 * (CID) ; l'aperçu web passe une URL http à la place.
 */
export function renderMessageEmail(
  kind: MessageTemplateKind,
  template: MessageEmailTemplate,
  ctx: MessageEmailContext,
  options?: { logoSrc?: string }
): RenderedMessageEmail {
  const definition = MESSAGE_TEMPLATE_DEFINITIONS[kind];
  const variables = buildMessageEmailVariables(kind, ctx);

  const renderedBody = renderBodyTemplate(template.body, variables);

  return {
    subject: renderTemplateSubject(template.subject, variables),
    html: wrapMessageEmailHtml({
      bodyHtml: renderedBody,
      schoolName: ctx.schoolName,
      accent: definition.accent,
      priorityLevel: ctx.priorityLevel,
      logoSrc: options?.logoSrc ?? `cid:${EMAIL_LOGO_CID}`,
    }),
    text: htmlToPlainText(renderedBody),
  };
}

/* --------------------------------------------------------------------------
 * Persistance (tenants.settings_json)
 * ------------------------------------------------------------------------ */

type QueryableClient = PoolClient | { query: (sql: string, params?: any[]) => Promise<any> };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function withDefaults(
  kind: MessageTemplateKind,
  saved: unknown
): MessageEmailTemplate {
  const defaults = MESSAGE_TEMPLATE_DEFINITIONS[kind].defaults;
  const candidate = saved as Partial<MessageEmailTemplate> | null | undefined;
  return {
    subject: isNonEmptyString(candidate?.subject) ? candidate!.subject! : defaults.subject,
    body: isNonEmptyString(candidate?.body) ? candidate!.body! : defaults.body,
  };
}

/** Tous les modèles du tenant, complétés par les valeurs par défaut. */
export async function loadTenantMessageTemplates(
  client: QueryableClient,
  tenantId: string
): Promise<Record<MessageTemplateKind, MessageEmailTemplate>> {
  let saved: Record<string, unknown> = {};
  try {
    const result = await client.query(`SELECT settings_json -> $2 AS templates FROM tenants WHERE id = $1`, [
      tenantId,
      MESSAGE_EMAIL_SETTINGS_KEY,
    ]);
    saved = (result.rows[0]?.templates as Record<string, unknown>) || {};
  } catch {
    saved = {};
  }

  const out = {} as Record<MessageTemplateKind, MessageEmailTemplate>;
  for (const kind of MESSAGE_TEMPLATE_KINDS) {
    out[kind] = withDefaults(kind, saved?.[kind]);
  }
  return out;
}

/** Un seul modèle (évite de charger tout le catalogue lors d'un envoi). */
export async function loadTenantMessageTemplate(
  client: QueryableClient,
  tenantId: string,
  kind: MessageTemplateKind
): Promise<MessageEmailTemplate> {
  try {
    const result = await client.query(
      `SELECT settings_json -> $2 -> $3 AS template FROM tenants WHERE id = $1`,
      [tenantId, MESSAGE_EMAIL_SETTINGS_KEY, kind]
    );
    return withDefaults(kind, result.rows[0]?.template);
  } catch {
    return { ...MESSAGE_TEMPLATE_DEFINITIONS[kind].defaults };
  }
}

/**
 * Enregistre un modèle sans écraser les autres clés de `settings_json`.
 *
 * La fusion se fait par `||` à chaque niveau plutôt que par `jsonb_set` : ce
 * dernier laisse le document inchangé, sans erreur, quand le nœud parent
 * (`adminMessageEmailTemplates`) n'existe pas encore — c'est-à-dire au tout
 * premier enregistrement.
 */
export async function saveTenantMessageTemplate(
  client: QueryableClient,
  tenantId: string,
  kind: MessageTemplateKind,
  template: MessageEmailTemplate
): Promise<void> {
  await client.query(
    `UPDATE tenants
        SET settings_json = COALESCE(settings_json, '{}'::jsonb)
              || jsonb_build_object(
                   $2::text,
                   CASE
                     WHEN jsonb_typeof(settings_json -> $2) = 'object' THEN settings_json -> $2
                     ELSE '{}'::jsonb
                   END || jsonb_build_object($3::text, $4::jsonb)
                 ),
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, MESSAGE_EMAIL_SETTINGS_KEY, kind, JSON.stringify(template)]
  );
}

/** Supprime la personnalisation d'un modèle (retour au modèle par défaut). */
export async function resetTenantMessageTemplate(
  client: QueryableClient,
  tenantId: string,
  kind: MessageTemplateKind
): Promise<void> {
  await client.query(
    `UPDATE tenants
        SET settings_json = COALESCE(settings_json, '{}'::jsonb) #- ARRAY[$2::text, $3::text],
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, MESSAGE_EMAIL_SETTINGS_KEY, kind]
  );
}

/** Contexte de démonstration utilisé par l'aperçu et l'email de test. */
export function buildSampleContext(
  kind: MessageTemplateKind,
  overrides: { schoolName: string; senderName: string; portalUrl: string }
): MessageEmailContext {
  const definition = MESSAGE_TEMPLATE_DEFINITIONS[kind];
  const { recipientName, senderName, subject, message, ...extra } = definition.sample;
  return {
    recipientName: recipientName || "Destinataire",
    subject: subject || "Sujet du message",
    message: message || "Contenu du message.",
    // Les modèles envoyés *par* l'administration prennent le nom de
    // l'administrateur connecté ; les autres, l'expéditeur de démonstration.
    senderName: senderName || overrides.senderName,
    schoolName: overrides.schoolName,
    portalUrl: overrides.portalUrl,
    priorityLevel: definition.defaults.body.includes("{{priority}}") ? "high" : "normal",
    extra,
  };
}
