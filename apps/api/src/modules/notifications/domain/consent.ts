/**
 * Consentement, préférences et heures calmes : décision PURE « cette remise peut-elle partir, et quand ? ».
 *
 * Ordre des garde-fous (le premier qui refuse l'emporte, sauf mention) :
 *  1. canal désactivé par l'établissement ;
 *  2. aucune adresse / aucun compte joignable ;
 *  3. adresse en liste de suppression (rebond définitif, plainte) — JAMAIS contournée, même en urgence ;
 *  4. consentement : préférence la plus précise (canal + catégorie, sinon canal entier, sinon modèle de l'établissement :
 *     `IMPLIED` = envoyé sauf refus, `EXPLICIT` = envoyé seulement si accordé). Une URGENCE ignore le refus d'une catégorie ;
 *     elle ignore le refus du canal entier seulement si l'établissement l'a décidé (`urgentBypassesRevocations`) ; elle
 *     n'invente jamais un consentement absent sous le modèle `EXPLICIT` ;
 *  5. heures calmes (canaux intrusifs : SMS, WhatsApp, push) : la remise est REPORTÉE à la fin de la plage, pas perdue ;
 *     une urgence part tout de suite.
 */
import type { NotifCategory, NotifChannel, NotifConsentModel, NotifSkipReason } from "@ecoledigitale/contracts/src/v2/notifications";
import { QUIET_HOURS_CHANNELS, type TenantSettings } from "./types";

export interface PreferenceRow {
  readonly channel: NotifChannel;
  /** `*` : tout le canal. */
  readonly category: string;
  readonly enabled: boolean;
}

export interface QuietOverride {
  readonly enabled: boolean | null;
  readonly start: string | null;
  readonly end: string | null;
}

export interface EligibilityInput {
  readonly channel: NotifChannel;
  readonly category: NotifCategory;
  readonly urgent: boolean;
  readonly settings: TenantSettings;
  /** Préférences de TOUTES les clés de la personne (clé principale et alias) : un refus sur l'une vaut pour toutes. */
  readonly preferences: readonly PreferenceRow[];
  readonly quiet: QuietOverride | null;
  readonly hasContact: boolean;
  readonly suppressed: boolean;
  readonly now: Date;
}

export type EligibilityDecision = { readonly kind: "SEND"; readonly availableAt: Date; readonly deferred: boolean } | { readonly kind: "SKIP"; readonly reason: NotifSkipReason };

export function consentModelOf(settings: TenantSettings, channel: NotifChannel): NotifConsentModel {
  return settings.consentModels[channel] ?? "IMPLIED";
}

/** Préférence effective sur un niveau (un refus l'emporte sur un accord pour la même personne et le même niveau). */
function levelValue(rows: readonly PreferenceRow[], channel: NotifChannel, category: string): boolean | null {
  const hits = rows.filter((r) => r.channel === channel && r.category === category);
  if (hits.length === 0) return null;
  return hits.every((r) => r.enabled);
}

export type ConsentVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: "consent_revoked" | "category_opt_out" };

/** Consentement effectif (hors heures calmes). */
export function consentVerdict(input: Pick<EligibilityInput, "channel" | "category" | "urgent" | "settings" | "preferences">): ConsentVerdict {
  const model = consentModelOf(input.settings, input.channel);
  const channelLevel = levelValue(input.preferences, input.channel, "*");
  const categoryLevel = levelValue(input.preferences, input.channel, input.category);

  // La préférence la plus PRÉCISE l'emporte : catégorie du canal, puis canal entier, puis modèle de l'établissement.
  if (categoryLevel === true) return { allowed: true };
  if (categoryLevel === false && !input.urgent) return { allowed: false, reason: "category_opt_out" };
  const channelAllowed = channelLevel ?? model === "IMPLIED";
  if (channelAllowed) return { allowed: true };
  // Urgence : outrepasse une RÉVOCATION explicite seulement si l'établissement l'a décidé ; jamais l'absence d'accord (EXPLICIT).
  if (input.urgent && channelLevel === false && input.settings.urgentBypassesRevocations) return { allowed: true };
  return { allowed: false, reason: "consent_revoked" };
}

// ---------------------------------------------------------------------------
// Heures calmes
// ---------------------------------------------------------------------------

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Heure locale (minutes depuis minuit, secondes) dans un fuseau. */
export function localClock(at: Date, timeZone: string): { minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { minutes: get("hour") * 60 + get("minute"), seconds: get("second") };
}

export interface QuietWindow {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

/** Fenêtre calme effective : surcharge de la personne sinon réglage de l'établissement. */
export function effectiveQuietWindow(settings: TenantSettings, override: QuietOverride | null): QuietWindow {
  return {
    enabled: override?.enabled ?? settings.quietHoursEnabled,
    start: override?.start ?? settings.quietStart,
    end: override?.end ?? settings.quietEnd,
    timeZone: settings.timezone,
  };
}

/** Si `at` tombe dans la plage calme, l'instant où elle s'achève ; sinon `null`. Plage à cheval sur minuit gérée ; début = fin : aucune. */
export function quietUntil(at: Date, window: QuietWindow): Date | null {
  if (!window.enabled) return null;
  const s = toMinutes(window.start);
  const e = toMinutes(window.end);
  if (s === e) return null;
  const tz = isValidTimeZone(window.timeZone) ? window.timeZone : "UTC";
  const { minutes, seconds } = localClock(at, tz);
  const inside = s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  if (!inside) return null;
  const waitMinutes = minutes < e ? e - minutes : 1440 - minutes + e;
  return new Date(at.getTime() + waitMinutes * 60_000 - seconds * 1000 - (at.getTime() % 1000));
}

/** Décision complète pour une remise candidate. */
export function decideEligibility(input: EligibilityInput): EligibilityDecision {
  const { settings, channel } = input;
  if (!settings.enabledChannels.includes(channel)) return { kind: "SKIP", reason: "channel_disabled" };
  if (!input.hasContact) return { kind: "SKIP", reason: "no_contact" };
  if (input.suppressed) return { kind: "SKIP", reason: "suppressed" };
  const verdict = consentVerdict(input);
  if (!verdict.allowed) return { kind: "SKIP", reason: verdict.reason };
  if (!input.urgent && QUIET_HOURS_CHANNELS.includes(channel)) {
    const until = quietUntil(input.now, effectiveQuietWindow(settings, input.quiet));
    if (until) return { kind: "SEND", availableAt: until, deferred: true };
  }
  return { kind: "SEND", availableAt: input.now, deferred: false };
}
