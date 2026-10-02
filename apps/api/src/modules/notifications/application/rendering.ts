/**
 * Résolution et rendu d'un gabarit : gabarit actif de l'établissement (version figée), sinon gabarit livré ; variables
 * intégrées (`schoolName`, `appUrl`) ; valeurs validées par type. Aucune écriture.
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import { NOTIF_DEFAULT_LOCALE } from "@ecoledigitale/contracts/src/v2/notifications";
import { catalogEntry, type CatalogEntry } from "../domain/catalog";
import { findShippedTemplate } from "../domain/default-templates";
import { renderSource, type TemplateValueError } from "../domain/templating";
import type { TenantSettings } from "../domain/types";
import * as templatesRepo from "../infrastructure/templates-repository";
import type { NotificationsConfig } from "./deps";

export interface ResolvedTemplate {
  readonly source: "SHIPPED" | "TENANT";
  /** 0 pour le gabarit livré. */
  readonly version: number;
  readonly subject: string | null;
  readonly body: string;
  readonly enabled: boolean;
  readonly locale: string;
}

/** Gabarit effectif d'un (code, canal, langue) pour un établissement ; `null` si le code n'a pas de gabarit livré pour ce canal. */
export async function resolveTemplate(tx: Tx, tenantId: string, code: string, channel: NotifChannel, locale: string = NOTIF_DEFAULT_LOCALE): Promise<ResolvedTemplate | null> {
  for (const loc of locale === NOTIF_DEFAULT_LOCALE ? [locale] : [locale, NOTIF_DEFAULT_LOCALE]) {
    const active = await templatesRepo.getActiveTemplate(tx, tenantId, { code, channel, locale: loc });
    if (active && "version" in active) {
      return { source: "TENANT", version: active.version, subject: active.subject, body: active.body, enabled: active.enabled, locale: loc };
    }
    const shipped = findShippedTemplate(code, channel, loc);
    if (shipped) return { source: "SHIPPED", version: 0, subject: shipped.subject, body: shipped.body, enabled: active ? active.enabled : true, locale: shipped.locale };
  }
  return null;
}

/** Variables intégrées fournies à tout gabarit. */
export function builtinValues(settings: TenantSettings, config: NotificationsConfig): Record<string, unknown> {
  return {
    schoolName: settings.senderName ?? config.defaultSenderName,
    ...(config.appBaseUrl ? { appUrl: config.appBaseUrl } : {}),
  };
}

export interface Rendered {
  readonly subject: string | null;
  readonly text: string;
  readonly errors: readonly TemplateValueError[];
}

export function renderResolved(entry: CatalogEntry, tpl: Pick<ResolvedTemplate, "subject" | "body">, values: Readonly<Record<string, unknown>>, settings: TenantSettings, config: NotificationsConfig): Rendered {
  const merged = { ...builtinValues(settings, config), ...values };
  const options = { appUrl: config.appBaseUrl };
  const body = renderSource(tpl.body, entry, merged, options);
  const subject = tpl.subject ? renderSource(tpl.subject, entry, merged, options) : null;
  return { subject: subject ? subject.text.replace(/\s+/g, " ").trim() : null, text: body.text, errors: [...(subject?.errors ?? []), ...body.errors] };
}

export const entryOrThrow = (code: string): CatalogEntry => {
  const entry = catalogEntry(code);
  if (!entry) throw new Error(`Gabarit inconnu : ${code}`);
  return entry;
};
