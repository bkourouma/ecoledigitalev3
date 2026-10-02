/**
 * Mise en file d'une notification : pour chaque destinataire et chaque canal retenu, une ligne du journal (`deliveries`).
 *
 * Tout est décidé ICI, dans la transaction de l'appelant, AVANT l'envoi :
 *  - consentement, préférences, heures calmes, liste de suppression, canal désactivé (`domain/consent.ts`) ;
 *  - plafonds : par destinataire sur 24 h, file maximale par établissement (le plafond journalier par canal s'applique à l'envoi) ;
 *  - rendu du gabarit (version FIGÉE dans la ligne) ; une variable manquante est une remise `FAILED` explicite, pas un message à trous ;
 *  - idempotence : `dedupe_key = <base>|<personne>|<canal>` (un événement rejoué ne double jamais l'envoi).
 * Une remise ignorée est ÉCRITE (statut `SKIPPED` + raison) : le journal explique pourquoi rien n'est parti.
 * Stratégie `FIRST_REACHABLE` : on s'arrête au premier canal retenu ; les canaux écartés avant lui sont consignés.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { NotifChannel, NotifSkipReason, NotifSourceKind, NotifStrategy, NotifTemplateCode } from "@ecoledigitale/contracts/src/v2/notifications";
import { NOTIF_DEFAULT_LOCALE } from "@ecoledigitale/contracts/src/v2/notifications";
import { addressHash, maskAddress, normalizeEmail, normalizePhone } from "../domain/addresses";
import { decideEligibility, type PreferenceRow, type QuietOverride } from "../domain/consent";
import { entryOrThrow, renderResolved, resolveTemplate, type ResolvedTemplate } from "./rendering";
import { type Recipient } from "../domain/types";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as prefsRepo from "../infrastructure/preferences-repository";
import * as pushRepo from "../infrastructure/push-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import type { NotificationsDeps } from "./deps";

export interface EnqueueInput {
  readonly source: { readonly kind: NotifSourceKind; readonly eventId?: string | null; readonly ruleKey?: string | null };
  readonly templateCode: NotifTemplateCode;
  readonly urgent: boolean;
  readonly recipients: readonly Recipient[];
  readonly channels: readonly NotifChannel[];
  readonly strategy: NotifStrategy;
  /** Valeurs communes de gabarit (typées). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Valeurs propres à un destinataire (ex. le nom de l'élève de CE tuteur). */
  readonly valuesFor?: ((recipient: Recipient) => Readonly<Record<string, unknown>>) | undefined;
  /** Base de la clé d'idempotence : `evt:<id>:<règle>`, `dunning:<échéance>:<palier>`, `alert:<règle>:<cible>:<période>`… */
  readonly dedupeBase: string;
  /** Regroupement pour l'arrêt (ex. `dunning:<facture>`). */
  readonly groupKey?: string | null;
  /** Identifiants utiles au journal (jamais de nom ni de contenu). */
  readonly context?: Readonly<Record<string, string>>;
  /** Chemin interne vers lequel pointe la notification (push, in-app). */
  readonly linkPath?: string | null;
  readonly createdBy?: string | null;
}

export interface EnqueueResult {
  readonly recipients: number;
  /** Remises mises en file (`PENDING`). */
  readonly queued: number;
  /** Remises ignorées ou en échec de rendu, consignées au journal. */
  readonly skipped: number;
  /** Remises déjà présentes (clé d'idempotence) : rien n'est doublé. */
  readonly duplicates: number;
}

const addressOf = (channel: NotifChannel, r: Recipient, dialCode: string): string | null => {
  switch (channel) {
    case "EMAIL":
      return normalizeEmail(r.email);
    case "SMS":
    case "WHATSAPP":
      return normalizePhone(r.phone, dialCode);
    case "IN_APP":
    case "PUSH":
      return r.userId;
  }
};

/** Dédoublonne les destinataires par personne (un tuteur de deux élèves ne reçoit pas deux fois le même message). */
function uniqueRecipients(recipients: readonly Recipient[]): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const r of recipients) {
    const known = [...seen.values()].find((s) => s.subjectKey === r.subjectKey || s.aliasKeys.includes(r.subjectKey) || r.aliasKeys.includes(s.subjectKey));
    if (!known) seen.set(r.subjectKey, r);
  }
  return [...seen.values()];
}

export async function enqueueInTx(deps: NotificationsDeps, ctx: RequestContext, tx: Tx, input: EnqueueInput): Promise<EnqueueResult> {
  const tenantId = ctx.tenantId;
  const now = deps.clock.now();
  const settings = await settingsRepo.getSettings(tx, tenantId);
  const entry = entryOrThrow(input.templateCode);
  const recipients = uniqueRecipients(input.recipients);
  if (recipients.length === 0 || input.channels.length === 0) return { recipients: recipients.length, queued: 0, skipped: 0, duplicates: 0 };

  const allKeys = [...new Set(recipients.flatMap((r) => [r.subjectKey, ...r.aliasKeys]))];
  const prefs = await prefsRepo.listPreferences(tx, tenantId, allKeys);
  const quiets = await prefsRepo.getSubjectPreferences(tx, tenantId, allKeys);
  const pushUsers = input.channels.includes("PUSH") ? await pushRepo.countForUsers(tx, tenantId, recipients.map((r) => r.userId).filter((u): u is string => u !== null)) : new Set<string>();
  const suppressed = new Map<NotifChannel, Set<string>>();
  for (const channel of input.channels) {
    if (channel !== "EMAIL" && channel !== "SMS" && channel !== "WHATSAPP") continue;
    const hashes = recipients.map((r) => addressOf(channel, r, settings.defaultDialCode)).filter((a): a is string => a !== null).map((a) => addressHash(tenantId, channel, a));
    suppressed.set(channel, await prefsRepo.suppressedHashes(tx, tenantId, channel, hashes));
  }
  const counts = await deliveriesRepo.subjectCountsLast24h(tx, tenantId, recipients.map((r) => r.subjectKey), now);
  const pending = await deliveriesRepo.countPending(tx, tenantId);

  const templates = new Map<NotifChannel, ResolvedTemplate | null>();
  for (const channel of input.channels) templates.set(channel, await resolveTemplate(tx, tenantId, input.templateCode, channel, NOTIF_DEFAULT_LOCALE));

  const link = input.linkPath && deps.config.appBaseUrl ? `${deps.config.appBaseUrl}${input.linkPath}` : null;
  const drafts: deliveriesRepo.DeliveryDraft[] = [];
  const queuedKeys = new Set<string>();
  const base = (r: Recipient, channel: NotifChannel, status: deliveriesRepo.DeliveryDraft["status"]): deliveriesRepo.DeliveryDraft => ({
    id: deps.newId(),
    createdAt: now,
    dedupeKey: `${input.dedupeBase}|${r.subjectKey}|${channel}`,
    groupKey: input.groupKey ?? null,
    sourceKind: input.source.kind,
    sourceEventId: input.source.eventId ?? null,
    ruleKey: input.source.ruleKey ?? null,
    templateCode: input.templateCode,
    templateVersion: 0,
    locale: NOTIF_DEFAULT_LOCALE,
    category: entry.category,
    urgent: input.urgent,
    channel,
    subjectKey: r.subjectKey,
    aliasKeys: r.aliasKeys,
    recipientUserId: r.userId,
    recipientMasked: maskAddress(channel, addressOf(channel, r, settings.defaultDialCode)),
    recipientAddress: null,
    addressHash: (() => {
      const a = channel === "EMAIL" || channel === "SMS" || channel === "WHATSAPP" ? addressOf(channel, r, settings.defaultDialCode) : null;
      return a ? addressHash(tenantId, channel, a) : null;
    })(),
    content: null,
    context: input.context ?? {},
    status,
    skipReason: null,
    maxAttempts: settings.maxAttempts,
    availableAt: now,
    createdBy: input.createdBy ?? null,
  });

  const skip = (r: Recipient, channel: NotifChannel, reason: NotifSkipReason): void => {
    drafts.push({ ...base(r, channel, "SKIPPED"), skipReason: reason });
  };

  for (const r of recipients) {
    const keys = [r.subjectKey, ...r.aliasKeys];
    const myPrefs: PreferenceRow[] = prefs.filter((p) => keys.includes(p.subjectKey)).map((p) => ({ channel: p.channel, category: p.category, enabled: p.enabled }));
    const quietRow = keys.map((k) => quiets.get(k)).find((q) => q !== undefined);
    const quiet: QuietOverride | null = quietRow ? { enabled: quietRow.enabled, start: quietRow.start, end: quietRow.end } : null;

    for (const channel of input.channels) {
      const address = addressOf(channel, r, settings.defaultDialCode);
      if (channel === "PUSH" && address !== null && !pushUsers.has(address)) {
        skip(r, channel, "no_subscription");
        continue;
      }
      const isSuppressed = address !== null && suppressed.get(channel)?.has(addressHash(tenantId, channel, address)) === true;
      const decision = decideEligibility({ channel, category: entry.category, urgent: input.urgent, settings, preferences: myPrefs, quiet, hasContact: address !== null, suppressed: isSuppressed, now });
      if (decision.kind === "SKIP") {
        skip(r, channel, decision.reason);
        continue;
      }
      const tpl = templates.get(channel);
      if (!tpl || !tpl.enabled) {
        skip(r, channel, "channel_disabled");
        continue;
      }
      if (!input.urgent && (counts.get(`${r.subjectKey}|${channel}`) ?? 0) >= settings.perRecipientDailyCap) {
        skip(r, channel, "recipient_cap");
        continue;
      }
      if (pending + queuedKeys.size >= deps.config.maxPendingPerTenant) {
        skip(r, channel, "backlog_limit");
        continue;
      }
      const values = { ...input.values, ...(input.valuesFor?.(r) ?? {}) };
      const rendered = renderResolved(entry, tpl, values, settings, deps.config);
      const draft = base(r, channel, "PENDING");
      if (rendered.errors.length > 0 || rendered.text === "") {
        const why = rendered.errors.map((e) => e.message).join(" ") || "Le gabarit produit un message vide.";
        drafts.push({ ...draft, status: "FAILED", templateVersion: tpl.version, locale: tpl.locale, lastErrorCode: "template_error", lastError: why });
        if (input.strategy === "FIRST_REACHABLE") break;
        continue;
      }
      drafts.push({
        ...draft,
        templateVersion: tpl.version,
        locale: tpl.locale,
        recipientAddress: address,
        availableAt: decision.availableAt,
        content: {
          subject: rendered.subject,
          text: rendered.text,
          link,
          schoolName: settings.senderName ?? deps.config.defaultSenderName,
          senderName: settings.senderName ?? deps.config.defaultSenderName,
          replyTo: settings.replyTo,
          legalFooter: settings.legalFooter,
        },
      });
      queuedKeys.add(draft.dedupeKey);
      if (input.strategy === "FIRST_REACHABLE") break;
    }
  }

  const inserted = await deliveriesRepo.insertDeliveries(tx, tenantId, drafts);
  let queued = 0;
  let skipped = 0;
  let duplicates = 0;
  for (const d of drafts) {
    if (!inserted.has(d.dedupeKey)) duplicates += 1;
    else if (d.status === "PENDING") queued += 1;
    else skipped += 1;
  }
  return { recipients: recipients.length, queued, skipped, duplicates };
}
