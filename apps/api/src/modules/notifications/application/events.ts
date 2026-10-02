/**
 * Abonnés aux événements des modules : événement -> règles de l'établissement -> destinataires -> mise en file (journal).
 *
 * Idempotent : la clé de remise dérive de l'identifiant d'événement (ou, à défaut, du fait source : enregistrement d'appel,
 * version de bulletin…) + règle + personne + canal ; un événement rejoué ne double jamais l'envoi. Les événements illisibles
 * ou visant une entité inconnue sont BÉNINS (consignés, non rejoués) ; un port indisponible fait ÉCHOUER (le worker rejoue).
 * Aucun contenu de message ne circule dans les événements : les noms viennent des ports, les montants et dates du payload.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { catalogEntry } from "../domain/catalog";
import { conditionsMatch, readEvent, readInvoicePaid, type EventFacts } from "../domain/event-readers";
import { dunningGroupKey } from "../domain/dunning";
import { ConsumedEvents } from "../domain/events";
import { localDateTime } from "../domain/time";
import { EVENT_TRIGGERS } from "../domain/triggers";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { AudienceResolver } from "./audience";
import { inTx, type NotificationsDeps } from "./deps";
import { enqueueInTx } from "./enqueue";
import { loadEffectiveRules } from "./rules";

export interface EventOutcome {
  readonly rules: number;
  readonly queued: number;
  readonly skipped: number;
  readonly ignored: string | null;
}

const none = (ignored: string): Result<EventOutcome, AppError> => ok({ rules: 0, queued: 0, skipped: 0, ignored });

/** Valeurs de gabarit issues des ports (noms) et du fuseau de l'établissement. `null` : entité inconnue (événement bénin). */
async function enrich(facts: EventFacts, resolver: AudienceResolver, timezone: string): Promise<{ values: Record<string, unknown> } | { ignored: string }> {
  const values: Record<string, unknown> = { ...facts.values };
  if (facts.refs.studentId) {
    const s = await resolver.student(facts.refs.studentId);
    if (!s) return { ignored: "student_unknown" };
    values.studentName = s.studentName;
  }
  if (facts.refs.staffId) {
    const found = await resolver.deps.ports.directory.staffContact(resolver.ctx, facts.refs.staffId);
    if (!found) return { ignored: "staff_unknown" };
    values.staffName = found.displayName;
  }
  if (facts.refs.classroomId) {
    const room = await resolver.classroom(facts.refs.classroomId, []);
    if (room.classroomName) values.className = room.classroomName;
  }
  if (facts.refs.announcementId) {
    const a = await resolver.announcement(facts.refs.announcementId);
    if (!a) return { ignored: "announcement_unknown" };
    values.title = a.title;
    if (a.summary) values.summary = a.summary;
  }
  if (facts.startsAt) {
    const local = localDateTime(facts.startsAt, timezone);
    values.date = local.date;
    values.time = local.time;
  }
  return { values };
}

/** Traite un événement consommé : met en file les remises des règles applicables. */
export async function onDomainEvent(deps: NotificationsDeps, ctx: RequestContext, input: { eventId: string; eventType: string; payload: unknown }): Promise<Result<EventOutcome, AppError>> {
  if (!EVENT_TRIGGERS.includes(input.eventType)) return none("not_a_trigger");
  const read = readEvent(input.eventType, input.payload);
  if (read.kind === "unreadable") return none("payload_unreadable");
  if (read.kind === "skip") return none(read.reason);
  const facts = read.facts;
  return inTx(deps, ctx, async (tx) => {
    const rules = (await loadEffectiveRules(tx, ctx.tenantId)).filter((r) => r.enabled && r.kind === "EVENT" && r.trigger === input.eventType && conditionsMatch(r, facts.filters));
    if (rules.length === 0) return none("no_rule");
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const resolver = new AudienceResolver(deps, ctx);
    const enriched = await enrich(facts, resolver, settings.timezone);
    if ("ignored" in enriched) return none(enriched.ignored);
    let queued = 0;
    let skipped = 0;
    for (const rule of rules) {
      const entry = catalogEntry(rule.templateCode);
      if (!entry) continue;
      const recipients = await resolver.resolve(rule.audience, facts.refs);
      if (recipients.length === 0) continue;
      const base = facts.dedupeId ? `fact:${input.eventType}:${facts.dedupeId}:${rule.key}` : `evt:${input.eventId}:${rule.key}`;
      const r = await enqueueInTx(deps, ctx, tx, {
        source: { kind: "EVENT", eventId: input.eventId, ruleKey: rule.key },
        templateCode: rule.templateCode,
        urgent: rule.urgent,
        recipients,
        channels: rule.channels,
        strategy: rule.strategy,
        values: enriched.values,
        dedupeBase: base,
        context: facts.context,
        linkPath: null,
      });
      queued += r.queued;
      skipped += r.skipped;
    }
    return ok({ rules: rules.length, queued, skipped, ignored: null });
  });
}

/** `finance.invoice.paid` : annule les relances EN ATTENTE de cette facture (arrêt dès paiement). */
export async function onInvoicePaid(deps: NotificationsDeps, ctx: RequestContext, input: { payload: unknown }): Promise<Result<{ cancelled: number }, AppError>> {
  const p = readInvoicePaid(input.payload);
  if (!p) return ok({ cancelled: 0 });
  return inTx(deps, ctx, async (tx) => ok({ cancelled: await deliveriesRepo.cancelPendingByGroup(tx, ctx.tenantId, dunningGroupKey(p.invoiceId), "paid", deps.clock.now()) }));
}

/** Erreur sans intérêt à rejouer (le worker consigne et passe). */
export const isBenignEventOutcome = (o: EventOutcome): boolean => o.ignored !== null;

export { ConsumedEvents };
