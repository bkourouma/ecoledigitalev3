/**
 * Gabarits par établissement : catalogue, liste (livrés + versions propres), publication d'une version, retour arrière,
 * activation / désactivation, aperçu. Les versions sont IMMUABLES et numérotées ; le journal d'envoi retient la version utilisée.
 */
import { err, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  NOTIF_CHANNELS,
  NOTIF_DEFAULT_LOCALE,
  NOTIF_LIMITS,
  type NotifChannel,
  type NotifCatalogEntry,
  type NotifPreviewResponse,
  type NotifTemplateCode,
  type NotifTemplateVersion,
  type NotifTemplateView,
} from "@ecoledigitale/contracts/src/v2/notifications";
import { allVariables, catalogEntry, TEMPLATE_CATALOG } from "../domain/catalog";
import { findShippedTemplate } from "../domain/default-templates";
import { NotifCode, notFound, validation } from "../domain/errors";
import { NotificationsEvents } from "../domain/events";
import { buildEmailHtml, parseTemplate, sampleValues, smsSegments, textToHtml, validateTemplateSource } from "../domain/templating";
import * as settingsRepo from "../infrastructure/settings-repository";
import * as templatesRepo from "../infrastructure/templates-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";
import { builtinValues, renderResolved, resolveTemplate } from "./rendering";

const actorOf = (ctx: RequestContext): string | null => ctx.userId;

export function listCatalog(): { items: NotifCatalogEntry[] } {
  return {
    items: TEMPLATE_CATALOG.map((e) => ({
      code: e.code,
      label: e.label,
      description: e.description,
      category: e.category,
      variables: [...allVariables(e)],
      channels: [...NOTIF_CHANNELS],
      manual: e.manual,
    })),
  };
}

/** Tous les gabarits (code × canal) de la langue demandée : version active de l'établissement ou gabarit livré. */
export async function listTemplates(deps: NotificationsDeps, ctx: RequestContext, input: { locale?: string | undefined } = {}): Promise<Result<{ items: NotifTemplateView[] }, AppError>> {
  const locale = input.locale ?? NOTIF_DEFAULT_LOCALE;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const pointers = await templatesRepo.listPointers(tx, ctx.tenantId);
      const byKey = new Map(pointers.filter((p) => p.locale === locale).map((p) => [`${p.code}|${p.channel}`, p]));
      const items: NotifTemplateView[] = [];
      for (const entry of TEMPLATE_CATALOG) {
        for (const channel of NOTIF_CHANNELS) {
          const shipped = findShippedTemplate(entry.code, channel, locale);
          if (!shipped) continue;
          const p = byKey.get(`${entry.code}|${channel}`);
          if (p && p.activeVersion !== null && p.body !== null) {
            items.push({ code: entry.code, channel, locale: shipped.locale, source: "TENANT", version: p.activeVersion, enabled: p.enabled, subject: p.subject, body: p.body, variables: p.variables ?? [], updatedAt: p.updatedAt.toISOString() });
          } else {
            items.push({ code: entry.code, channel, locale: shipped.locale, source: "SHIPPED", version: 0, enabled: p ? p.enabled : true, subject: shipped.subject, body: shipped.body, variables: validateTemplateSource({ entry, channel, subject: shipped.subject, body: shipped.body }).variables, updatedAt: p ? p.updatedAt.toISOString() : null });
          }
        }
      }
      return ok({ items });
    },
    { readOnly: true },
  );
}

/** Versions d'un gabarit de l'établissement (la plus récente d'abord) ; la version 0 (livrée) n'y figure pas. */
export async function listTemplateVersions(deps: NotificationsDeps, ctx: RequestContext, input: { code: NotifTemplateCode; channel: NotifChannel; locale?: string | undefined }): Promise<Result<{ items: NotifTemplateVersion[] }, AppError>> {
  if (!catalogEntry(input.code)) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", input.code));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { versions, active } = await templatesRepo.listVersions(tx, ctx.tenantId, { code: input.code, channel: input.channel, locale: input.locale ?? NOTIF_DEFAULT_LOCALE });
      return ok({
        items: versions.map((v) => ({ version: v.version, subject: v.subject, body: v.body, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt.toISOString(), active: v.version === active })),
      });
    },
    { readOnly: true },
  );
}

/** Valide un gabarit à enregistrer (syntaxe, variables du catalogue, objet selon le canal, taille). */
function checkSource(code: NotifTemplateCode, channel: NotifChannel, subject: string | null | undefined, body: string): Result<string[], AppError> {
  const entry = catalogEntry(code);
  if (!entry) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", code));
  const { issues, variables } = validateTemplateSource({ entry, channel, subject, body });
  const first = issues[0];
  if (first) {
    const unknown = issues.find((i) => i.code === "unknown_variable");
    const codeOf = unknown ? NotifCode.TEMPLATE_VARIABLE_UNKNOWN : NotifCode.TEMPLATE_INVALID;
    return err(
      new ValidationError(
        issues.length === 1 ? first.message : `${issues.length} problèmes dans le gabarit.`,
        issues.map((i) => ({ path: [i.code === "missing_subject" || i.code === "unexpected_subject" ? "subject" : "body"], message: i.message, code: i.code })),
        { code: codeOf, details: { variables: issues.filter((i) => i.variable).map((i) => i.variable) } },
      ),
    );
  }
  if (channel === "SMS" && body.length > NOTIF_LIMITS.smsBodyMax) return err(validation(NotifCode.TEMPLATE_INVALID, `Un SMS ne dépasse pas ${NOTIF_LIMITS.smsBodyMax} caractères.`, "body"));
  return ok(variables);
}

export interface SaveTemplateInput {
  code: NotifTemplateCode;
  channel: NotifChannel;
  locale: string;
  subject?: string | undefined;
  body: string;
  note?: string | undefined;
}

/** Publie une NOUVELLE version (numéro suivant) et la rend active. */
export async function publishTemplateVersion(deps: NotificationsDeps, ctx: RequestContext, input: SaveTemplateInput): Promise<Result<{ version: number }, AppError>> {
  const checked = checkSource(input.code, input.channel, input.subject, input.body);
  if (!checked.ok) return checked;
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    const version = await templatesRepo.publishVersion(tx, {
      tenantId: ctx.tenantId,
      ref: { code: input.code, channel: input.channel, locale: input.locale },
      id: deps.newId(),
      subject: input.subject ?? null,
      body: input.body,
      variables: checked.value,
      note: input.note ?? null,
      actor: actorOf(ctx),
      now,
    });
    events.add(NotificationsEvents.TEMPLATE_PUBLISHED, { v: 1, code: input.code, channel: input.channel, locale: input.locale, version, publishedBy: actorOf(ctx) }, { type: "template", id: `${input.code}:${input.channel}` });
    events.audit({ action: "notifications.template.publish", entity: "template", entityId: `${input.code}:${input.channel}:${input.locale}`, after: { version }, metadata: { code: input.code, channel: input.channel, version } });
    await events.flush(tx);
    return ok({ version });
  });
}

/** Retour arrière (ou avance) vers une version existante ; `0` rétablit le gabarit livré. */
export async function activateTemplateVersion(deps: NotificationsDeps, ctx: RequestContext, input: { code: NotifTemplateCode; channel: NotifChannel; locale: string; version: number }): Promise<Result<{ version: number }, AppError>> {
  if (!catalogEntry(input.code)) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", input.code));
  return inTx(deps, ctx, async (tx) => {
    const ref = { code: input.code, channel: input.channel, locale: input.locale };
    if (input.version !== 0 && !(await templatesRepo.versionExists(tx, ctx.tenantId, ref, input.version))) return err(notFound(NotifCode.VERSION_NOT_FOUND, "Version du gabarit", String(input.version)));
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    await templatesRepo.setActiveVersion(tx, ctx.tenantId, ref, input.version === 0 ? null : input.version, actorOf(ctx), now);
    events.add(NotificationsEvents.TEMPLATE_PUBLISHED, { v: 1, code: input.code, channel: input.channel, locale: input.locale, version: input.version, publishedBy: actorOf(ctx) }, { type: "template", id: `${input.code}:${input.channel}` });
    events.audit({ action: "notifications.template.activate", entity: "template", entityId: `${input.code}:${input.channel}:${input.locale}`, after: { version: input.version } });
    await events.flush(tx);
    return ok({ version: input.version });
  });
}

/** Désactive ou réactive un gabarit : un gabarit désactivé ne produit plus de remise pour ce canal. */
export async function setTemplateEnabled(deps: NotificationsDeps, ctx: RequestContext, input: { code: NotifTemplateCode; channel: NotifChannel; locale: string; enabled: boolean }): Promise<Result<{ enabled: boolean }, AppError>> {
  if (!catalogEntry(input.code)) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", input.code));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    await templatesRepo.setTemplateEnabled(tx, ctx.tenantId, { code: input.code, channel: input.channel, locale: input.locale }, input.enabled, actorOf(ctx), deps.clock.now());
    events.audit({ action: "notifications.template.enable", entity: "template", entityId: `${input.code}:${input.channel}:${input.locale}`, after: { enabled: input.enabled } });
    await events.flush(tx);
    return ok({ enabled: input.enabled });
  });
}

export interface PreviewInput {
  channel: NotifChannel;
  locale: string;
  /** Brouillon (sinon le gabarit actif ou livré). */
  code: NotifTemplateCode;
  subject?: string | undefined;
  body?: string | undefined;
  variables?: Record<string, unknown> | undefined;
}

/** Aperçu rendu (texte, HTML d'e-mail, segments SMS) avec des valeurs d'essai ; aucune écriture, aucun envoi. */
export async function previewTemplate(deps: NotificationsDeps, ctx: RequestContext, input: PreviewInput): Promise<Result<NotifPreviewResponse, AppError>> {
  const entry = catalogEntry(input.code);
  if (!entry) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", input.code));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      let subject: string | null;
      let body: string;
      if (input.body !== undefined) {
        const checked = checkSource(input.code, input.channel, input.subject ?? null, input.body);
        if (!checked.ok) return checked;
        subject = input.subject ?? null;
        body = input.body;
      } else {
        const resolved = await resolveTemplate(tx, ctx.tenantId, input.code, input.channel, input.locale);
        if (!resolved) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", `${input.code}/${input.channel}`));
        subject = resolved.subject;
        body = resolved.body;
      }
      const samples = sampleValues(entry);
      const values = { ...samples, ...(input.variables ?? {}) };
      const rendered = renderResolved(entry, { subject, body }, values, settings, deps.config);
      const warnings: string[] = rendered.errors.map((e) => e.message);
      const schoolName = String(builtinValues(settings, deps.config).schoolName);
      let html: string | null = null;
      if (input.channel === "EMAIL") {
        html = buildEmailHtml({ bodyText: rendered.text, schoolName, legalFooter: settings.legalFooter, unsubscribeUrl: "https://exemple.invalid/desinscription", category: entry.category });
      }
      let segments: number | null = null;
      if (input.channel === "SMS") {
        const s = smsSegments(rendered.text);
        segments = s.segments;
        if (s.segments > 1) warnings.push(`Ce SMS fait ${s.segments} segments (${s.encoding}, ${s.length} caractères) : chaque segment est facturé.`);
        if (s.encoding === "UCS-2") warnings.push("Le texte contient des caractères hors alphabet GSM : le SMS passe en UCS-2 (70 caractères par segment).");
      }
      if (input.channel === "PUSH" && rendered.text.length > 140) warnings.push("Une notification push de plus de 140 caractères peut être tronquée.");
      return ok({ subject: rendered.subject, text: rendered.text, html, segments, warnings });
    },
    { readOnly: true },
  );
}

/** Pour les tests et l'administration : le texte HTML d'un texte brut (échappé). */
export const renderHtmlOf = textToHtml;
export { parseTemplate };
