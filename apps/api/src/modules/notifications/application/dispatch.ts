/**
 * Envoi : réclame les remises dues, les envoie par leur canal HORS de toute transaction de données, puis consigne l'issue.
 *
 * Garanties
 *  - au moins une fois : un worker tué en cours d'envoi laisse un bail (`locked_until`) qui expire ; la remise est reprise
 *    (le fournisseur reçoit la même clé d'idempotence : l'identifiant de la remise) ;
 *  - plusieurs workers sans doublon (`FOR UPDATE SKIP LOCKED`) ;
 *  - reprise avec backoff sur panne passagère du canal, échec définitif après `max_attempts` ;
 *  - plafond journalier par canal (valeur de la plateforme ou de l'établissement) : les remises en trop attendent ;
 *  - AVANT l'envoi, on relit : canal toujours actif, consentement, liste de suppression, heures calmes, et pour une relance
 *    d'impayé, que l'échéance est TOUJOURS en retard (arrêt dès paiement) ;
 *  - canal non configuré : échec EXPLICITE (`channel_not_configured`), jamais une simulation silencieuse.
 * Aucune adresse complète ni aucun contenu dans les journaux d'exécution (`logger`) : identifiants et codes seulement.
 */
import { createSystemContext, type RequestContext } from "@ecoledigitale/kernel";
import { NOTIF_CHANNELS, type NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import { addressHash, scrubAddresses } from "../domain/addresses";
import { attemptsExhausted, retryDelayMs } from "../domain/backoff";
import { decideEligibility, type PreferenceRow, type QuietOverride } from "../domain/consent";
import { NotificationsEvents } from "../domain/events";
import { signUnsubscribeToken } from "../domain/tokens";
import { PLATFORM_DAILY_CAPS, type TenantSettings } from "../domain/types";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as prefsRepo from "../infrastructure/preferences-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, type NotificationsDeps } from "./deps";
import type { ChannelMessage, ChannelOutcome } from "./ports";

export interface DispatchReport {
  claimed: number;
  sent: number;
  simulated: number;
  retried: number;
  failed: number;
  bounced: number;
  skipped: number;
  cancelled: number;
  deferred: number;
}

const emptyReport = (): DispatchReport => ({ claimed: 0, sent: 0, simulated: 0, retried: 0, failed: 0, bounced: 0, skipped: 0, cancelled: 0, deferred: 0 });

/** Durée maximale d'un envoi vers un fournisseur. */
export const CHANNEL_TIMEOUT_MS = 30_000;
const CONCURRENCY = 5;

const capOf = (settings: TenantSettings, channel: NotifChannel): number => settings.dailyCaps[channel] ?? PLATFORM_DAILY_CAPS[channel];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("délai dépassé")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type Precheck = { kind: "send" } | { kind: "skip"; status: "SKIPPED" | "CANCELLED"; reason: string } | { kind: "defer"; until: Date };

/** Relit les conditions d'envoi (elles ont pu changer depuis la mise en file). */
async function precheck(deps: NotificationsDeps, ctx: RequestContext, settings: TenantSettings, d: deliveriesRepo.ClaimedDelivery, now: Date): Promise<Precheck> {
  if (d.sourceKind === "DUNNING") {
    const installmentId = d.context.installmentId;
    if (installmentId && !(await deps.ports.overdue.isInstallmentStillOverdue(ctx, installmentId))) return { kind: "skip", status: "CANCELLED", reason: "paid" };
  }
  const keys = [d.subjectKey, ...d.aliasKeys];
  const prefs: PreferenceRow[] = await deps.db.run(
    ctx,
    async (tx) => (await prefsRepo.listPreferences(tx, ctx.tenantId, keys)).map((p) => ({ channel: p.channel, category: p.category, enabled: p.enabled })),
    { readOnly: true },
  );
  const quiets = await deps.db.run(ctx, (tx) => prefsRepo.getSubjectPreferences(tx, ctx.tenantId, keys), { readOnly: true });
  const q = keys.map((k) => quiets.get(k)).find((x) => x !== undefined);
  const quiet: QuietOverride | null = q ? { enabled: q.enabled, start: q.start, end: q.end } : null;
  let suppressed = false;
  if ((d.channel === "EMAIL" || d.channel === "SMS" || d.channel === "WHATSAPP") && d.recipientAddress) {
    const hit = await deps.db.run(ctx, (tx) => prefsRepo.suppressedHashes(tx, ctx.tenantId, d.channel, [addressHash(ctx.tenantId, d.channel, d.recipientAddress!)]), { readOnly: true });
    suppressed = hit.size > 0;
  }
  const decision = decideEligibility({ channel: d.channel, category: d.category, urgent: d.urgent, settings, preferences: prefs, quiet, hasContact: d.recipientAddress !== null, suppressed, now });
  if (decision.kind === "SKIP") return { kind: "skip", status: "SKIPPED", reason: decision.reason };
  if (decision.deferred) return { kind: "defer", until: decision.availableAt };
  return { kind: "send" };
}

function buildMessage(deps: NotificationsDeps, tenantId: string, d: deliveriesRepo.ClaimedDelivery): ChannelMessage | null {
  if (!d.content || !d.recipientAddress) return null;
  const secret = deps.config.unsubscribeSecret;
  const base = deps.config.appBaseUrl;
  const unsubscribeUrl =
    secret && base && (d.channel === "EMAIL" || d.channel === "WHATSAPP")
      ? `${base}/v2/notifications/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken({ tenantId, subjectKey: d.subjectKey, channel: d.channel }, secret))}`
      : null;
  return {
    tenantId,
    deliveryId: d.id,
    channel: d.channel,
    address: d.recipientAddress,
    userId: d.recipientUserId,
    subject: d.content.subject,
    text: d.content.text,
    templateCode: d.templateCode,
    category: d.category,
    urgent: d.urgent,
    link: d.content.link,
    idempotencyKey: d.id,
    schoolName: d.content.schoolName,
    senderName: d.content.senderName,
    replyTo: d.content.replyTo,
    legalFooter: d.content.legalFooter,
    unsubscribeUrl,
  };
}

/** Traite UNE remise réclamée : vérifications, envoi, consignation. */
async function processOne(deps: NotificationsDeps, ctx: RequestContext, settings: TenantSettings, d: deliveriesRepo.ClaimedDelivery, report: DispatchReport): Promise<void> {
  const now = deps.clock.now();
  const finish = async (fn: (tx: Parameters<Parameters<typeof deps.db.run>[1]>[0], events: EventBuffer) => Promise<void>): Promise<void> => {
    await deps.db.run(ctx, async (tx) => {
      const events = new EventBuffer(deps, ctx);
      await fn(tx, events);
      await events.flush(tx);
    });
  };

  let pre: Precheck;
  try {
    pre = await precheck(deps, ctx, settings, d, now);
  } catch (e) {
    // Source de vérité indisponible (port, base) : on ne devine pas, on remet en file.
    const message = scrubAddresses(e instanceof Error ? e.message : String(e));
    deps.logger.warn({ deliveryId: d.id, tenantId: ctx.tenantId, code: "precheck_failed" }, "notifications : vérification préalable impossible, reprise");
    await finish(async (tx) => deliveriesRepo.markRetry(tx, ctx.tenantId, d.id, { availableAt: new Date(now.getTime() + retryDelayMs(d.attempts, deps.random())), code: "precheck_failed", message, at: now }));
    report.retried += 1;
    return;
  }
  if (pre.kind === "skip") {
    await finish(async (tx) => deliveriesRepo.markSkipped(tx, ctx.tenantId, d.id, { status: pre.status, reason: pre.reason, at: now }));
    if (pre.status === "CANCELLED") report.cancelled += 1;
    else report.skipped += 1;
    return;
  }
  if (pre.kind === "defer") {
    await finish(async (tx) => {
      await deliveriesRepo.markRetry(tx, ctx.tenantId, d.id, { availableAt: pre.until, code: "quiet_hours", message: "Heures calmes : envoi reporté.", at: now });
      await tx.query(`UPDATE notifications.deliveries SET attempts = GREATEST(attempts - 1, 0), last_error_code = NULL, last_error = NULL WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, d.id]);
    });
    report.deferred += 1;
    return;
  }

  const message = buildMessage(deps, ctx.tenantId, d);
  let outcome: ChannelOutcome;
  if (!message) {
    outcome = { status: "FAILED", code: "content_missing", message: "Le contenu ou l'adresse de la remise a été effacé avant l'envoi." };
  } else {
    try {
      outcome = await withTimeout(deps.channels.get(d.channel).deliver(message), CHANNEL_TIMEOUT_MS);
    } catch (e) {
      outcome = { status: "RETRY", code: "adapter_error", message: scrubAddresses(e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  }

  const at = deps.clock.now();
  switch (outcome.status) {
    case "SENT":
    case "SIMULATED":
      await finish(async (tx) => deliveriesRepo.markSent(tx, ctx.tenantId, d.id, { status: outcome.status as "SENT" | "SIMULATED", providerId: outcome.providerId ?? null, cost: outcome.status === "SENT" ? (outcome.cost ?? null) : null, at }));
      if (outcome.status === "SENT") report.sent += 1;
      else report.simulated += 1;
      return;
    case "RETRY": {
      if (attemptsExhausted(d.attempts, d.maxAttempts)) {
        await finish(async (tx, events) => {
          await deliveriesRepo.markTerminal(tx, ctx.tenantId, d.id, { status: "FAILED", code: outcome.status === "RETRY" ? outcome.code : "failed", message: outcome.status === "RETRY" ? outcome.message : "", at });
          events.add(NotificationsEvents.DELIVERY_FAILED, { v: 1, deliveryId: d.id, channel: d.channel, category: d.category, templateCode: d.templateCode, sourceKind: d.sourceKind, attempts: d.attempts, errorCode: outcome.status === "RETRY" ? outcome.code : "failed" }, { type: "delivery", id: d.id });
        });
        report.failed += 1;
        return;
      }
      const delay = outcome.retryAfterMs ?? retryDelayMs(d.attempts, deps.random());
      await finish(async (tx) => deliveriesRepo.markRetry(tx, ctx.tenantId, d.id, { availableAt: new Date(at.getTime() + delay), code: outcome.status === "RETRY" ? outcome.code : "retry", message: outcome.status === "RETRY" ? outcome.message : "", at }));
      report.retried += 1;
      return;
    }
    case "FAILED":
      await finish(async (tx, events) => {
        await deliveriesRepo.markTerminal(tx, ctx.tenantId, d.id, { status: "FAILED", code: outcome.status === "FAILED" ? outcome.code : "failed", message: outcome.status === "FAILED" ? outcome.message : "", at });
        events.add(NotificationsEvents.DELIVERY_FAILED, { v: 1, deliveryId: d.id, channel: d.channel, category: d.category, templateCode: d.templateCode, sourceKind: d.sourceKind, attempts: d.attempts, errorCode: outcome.status === "FAILED" ? outcome.code : "failed" }, { type: "delivery", id: d.id });
      });
      report.failed += 1;
      return;
    case "BOUNCED":
      await finish(async (tx, events) => {
        await deliveriesRepo.markTerminal(tx, ctx.tenantId, d.id, { status: "BOUNCED", code: outcome.status === "BOUNCED" ? outcome.code : "bounced", message: outcome.status === "BOUNCED" ? outcome.message : "", at });
        if ((d.channel === "EMAIL" || d.channel === "SMS" || d.channel === "WHATSAPP") && message) {
          await prefsRepo.addSuppression(tx, ctx.tenantId, { channel: d.channel, hash: addressHash(ctx.tenantId, d.channel, message.address), masked: d.recipientAddress ? maskedOf(d) : "—", reason: "HARD_BOUNCE", deliveryId: d.id, at });
        }
        events.add(NotificationsEvents.DELIVERY_BOUNCED, { v: 1, deliveryId: d.id, channel: d.channel, reason: outcome.status === "BOUNCED" ? outcome.code : "bounced" }, { type: "delivery", id: d.id });
      });
      report.bounced += 1;
      return;
    case "SKIPPED":
      await finish(async (tx) => deliveriesRepo.markSkipped(tx, ctx.tenantId, d.id, { status: "SKIPPED", reason: outcome.status === "SKIPPED" ? outcome.reason : "no_contact", at }));
      report.skipped += 1;
      return;
  }
}

function maskedOf(d: deliveriesRepo.ClaimedDelivery): string {
  // Le masque est déjà dans la ligne ; on le recalcule sans relire (adresse en mémoire seulement).
  const a = d.recipientAddress ?? "";
  return d.channel === "EMAIL" ? `${a[0] ?? "*"}***${a.slice(a.lastIndexOf("@"))}` : `*** ${a.slice(-2)}`;
}

/** Une passe d'envoi pour UN établissement. Idempotente et reprenable. */
export async function dispatchTenant(deps: NotificationsDeps, tenantId: string): Promise<DispatchReport> {
  const ctx = createSystemContext(tenantId);
  const report = emptyReport();
  const now = deps.clock.now();
  const lease = new Date(now.getTime() + deps.config.leaseMs);

  const { settings, claimed } = await deps.db.run(ctx, async (tx) => {
    const settings = await settingsRepo.getSettings(tx, tenantId);
    const channels = (await deliveriesRepo.channelsWithDueWork(tx, tenantId, now)).filter((c) => (NOTIF_CHANNELS as readonly string[]).includes(c));
    if (channels.length === 0) return { settings, claimed: [] as deliveriesRepo.ClaimedDelivery[] };
    const used = await deliveriesRepo.usedLast24h(tx, tenantId, now);
    const claimed: deliveriesRepo.ClaimedDelivery[] = [];
    for (const channel of channels) {
      const remaining = Math.max(0, capOf(settings, channel) - (used[channel] ?? 0));
      claimed.push(...(await deliveriesRepo.claimDue(tx, tenantId, channel, now, lease, Math.min(deps.config.batchSize, remaining))));
    }
    return { settings, claimed };
  });

  report.claimed = claimed.length;
  let index = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const d = claimed[index++];
      if (!d) return;
      try {
        await processOne(deps, ctx, settings, d, report);
      } catch (e) {
        // Échec inattendu en consignant l'issue : le bail expirera, la remise sera reprise (au moins une fois).
        deps.logger.error({ deliveryId: d.id, tenantId, err: e instanceof Error ? e.message : String(e) }, "notifications : issue d'envoi non consignée (reprise à l'expiration du bail)");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, claimed.length) }, worker));
  return report;
}
