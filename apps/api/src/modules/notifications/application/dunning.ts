/**
 * Relances d'impayés automatiques (job quotidien, un établissement à la fois).
 *
 *  - lit les ÉCHÉANCES en retard par le port `OverdueSource` (finance) ; ne calcule aucun montant, ne lit aucune table de finance ;
 *  - paliers configurables (`conditions.stages`, par défaut J+7 / J+21 / J+45) : pour une échéance, seul le palier le plus
 *    haut atteint donne lieu à un message, et chaque palier atteint est consigné au registre `dunning_steps` — JAMAIS deux
 *    fois le même palier, même si le job est rejoué, lancé deux fois ou en retard ;
 *  - arrêt dès paiement : l'échéance est relue au moment d'envoyer (`isInstallmentStillOverdue`), les remises en attente d'une
 *    facture soldée sont annulées par l'abonné `finance.invoice.paid`, et plus aucune relance n'est produite pour une échéance soldée ;
 *  - les familles sans contact joignable ne consomment pas le palier (réessai le lendemain).
 * Les relances n'ont pas de plafond propre : elles passent par les mêmes garde-fous (consentement, heures calmes, plafonds).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { dunningDedupeKey, dunningGroupKey, nextStageToSend, planStages } from "../domain/dunning";
import { localDay } from "../domain/time";
import * as pushRepo from "../infrastructure/push-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { AudienceResolver } from "./audience";
import { inTx, type NotificationsDeps } from "./deps";
import { enqueueInTx } from "./enqueue";
import { loadEffectiveRules } from "./rules";

export interface DunningReport {
  readonly examined: number;
  /** Relances mises en file (une par échéance et palier). */
  readonly notified: number;
  readonly remindersQueued: number;
  readonly unreachable: number;
}

const PAGE = 200;
const MAX_PER_RUN = 5_000;

export async function runDunning(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<DunningReport, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const rules = (await loadEffectiveRules(tx, ctx.tenantId)).filter((r) => r.enabled && r.kind === "DUNNING");
    const rule = rules[0];
    if (!rule) return ok({ examined: 0, notified: 0, remindersQueued: 0, unreachable: 0 });
    const stages = rule.conditions.stages ?? [];
    if (stages.length === 0) return ok({ examined: 0, notified: 0, remindersQueued: 0, unreachable: 0 });
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const now = deps.clock.now();
    const asOf = localDay(now, settings.timezone);
    const minDays = Math.min(...stages);
    const resolver = new AudienceResolver(deps, ctx);

    let examined = 0;
    let notified = 0;
    let remindersQueued = 0;
    let unreachable = 0;
    let after: string | undefined;
    while (examined < MAX_PER_RUN) {
      const page = await deps.ports.overdue.listOverdueInstallments(ctx, { asOf, minDaysOverdue: minDays, limit: PAGE, afterInstallmentId: after });
      if (page.length === 0) break;
      const recorded = await pushRepo.recordedStages(tx, ctx.tenantId, page.map((i) => i.installmentId));
      for (const inst of page) {
        examined += 1;
        const target = nextStageToSend(stages, inst.daysOverdue, recorded.get(inst.installmentId) ?? new Set());
        if (target === null) continue;
        const student = await resolver.student(inst.learnerId);
        const recipients = student ? await resolver.resolve(rule.audience, { studentId: inst.learnerId }) : [];
        if (!student || recipients.length === 0) {
          unreachable += 1;
          continue; // le palier n'est pas consommé : nouvel essai à la prochaine passe
        }
        const r = await enqueueInTx(deps, ctx, tx, {
          source: { kind: "DUNNING", ruleKey: rule.key },
          templateCode: rule.templateCode,
          urgent: rule.urgent,
          recipients,
          channels: rule.channels,
          strategy: rule.strategy,
          values: { studentName: student.studentName, invoiceNumber: inst.invoiceNumber, amount: inst.remaining, dueDate: inst.dueDate, daysOverdue: inst.daysOverdue },
          dedupeBase: dunningDedupeKey(inst.installmentId, target),
          groupKey: dunningGroupKey(inst.invoiceId),
          context: { installmentId: inst.installmentId, invoiceId: inst.invoiceId, stage: String(target), studentId: inst.learnerId },
          linkPath: null,
        });
        // Tous les paliers atteints sont consignés ; seul le plus haut a donné lieu à des remises.
        for (const stage of planStages(stages, inst.daysOverdue).reached) {
          await pushRepo.recordStage(tx, ctx.tenantId, { installmentId: inst.installmentId, stage, invoiceId: inst.invoiceId, learnerId: inst.learnerId, dueDate: inst.dueDate, notified: stage === target, at: now });
        }
        notified += 1;
        remindersQueued += r.queued;
      }
      after = page[page.length - 1]!.installmentId;
      if (page.length < PAGE) break;
    }
    return ok({ examined, notified, remindersQueued, unreachable });
  });
}
