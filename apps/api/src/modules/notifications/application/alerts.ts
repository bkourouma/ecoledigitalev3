/**
 * Alertes intelligentes (job, un établissement à la fois) : retard de paiement prolongé, baisse de résultats, charge
 * d'enseignement. Chaque alerte est une RÈGLE configurable (qui, canal, gabarit, seuil) ; les données viennent de PORTS.
 *
 *  - retard de paiement >= X jours -> économat : une alerte par échéance (jamais deux fois la même) ;
 *  - baisse de résultats >= seuil -> enseignants de la classe : deux résultats FINAL consécutifs LUS dans `results` (aucune
 *    formule ici), une alerte par élève et par période ;
 *  - charge d'enseignement > seuil -> administration : une alerte par enseignant et par mois ;
 *  (absences >= seuil -> parents et documents expirant -> RH sont traités par événements : `attendance.alert.triggered`,
 *  `people.staff_qualification.expiring`, voir `default-rules.ts`.)
 * Un port indisponible n'arrête pas les autres alertes : l'erreur est collectée et relancée à la fin (le job est signalé en échec).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { detectGradeDrop, isOverloaded, monthKey } from "../domain/alerts";
import { localDay } from "../domain/time";
import * as settingsRepo from "../infrastructure/settings-repository";
import { AudienceResolver } from "./audience";
import { inTx, type NotificationsDeps } from "./deps";
import { enqueueInTx } from "./enqueue";
import { loadEffectiveRules, type EffectiveRule } from "./rules";

export interface AlertsReport {
  readonly overdue: number;
  readonly gradeDrops: number;
  readonly teachingLoad: number;
  readonly errors: readonly string[];
}

const PAGE = 200;

export async function evaluateAlerts(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<AlertsReport, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const rules = (await loadEffectiveRules(tx, ctx.tenantId)).filter((r) => r.enabled && r.kind === "ALERT");
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const now = deps.clock.now();
    const today = localDay(now, settings.timezone);
    const resolver = new AudienceResolver(deps, ctx);
    const errors: string[] = [];
    const totals = { overdue: 0, gradeDrops: 0, teachingLoad: 0 };

    const run = async (rule: EffectiveRule, fn: () => Promise<number>, into: keyof typeof totals): Promise<void> => {
      try {
        totals[into] += await fn();
      } catch (e) {
        errors.push(`${rule.key} : ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    for (const rule of rules) {
      const common = { templateCode: rule.templateCode, urgent: rule.urgent, channels: rule.channels, strategy: rule.strategy } as const;

      if (rule.trigger === "OVERDUE_DAYS" && rule.conditions.minDaysOverdue !== undefined) {
        const minDays = rule.conditions.minDaysOverdue;
        await run(
          rule,
          async () => {
            let queued = 0;
            let after: string | undefined;
            for (let seen = 0; seen < 5_000; ) {
              const page = await deps.ports.overdue.listOverdueInstallments(ctx, { asOf: today, minDaysOverdue: minDays, limit: PAGE, afterInstallmentId: after });
              if (page.length === 0) break;
              for (const inst of page) {
                seen += 1;
                const student = await resolver.student(inst.learnerId);
                if (!student) continue;
                const recipients = await resolver.resolve(rule.audience, { studentId: inst.learnerId });
                if (recipients.length === 0) continue;
                const r = await enqueueInTx(deps, ctx, tx, {
                  ...common,
                  source: { kind: "ALERT", ruleKey: rule.key },
                  recipients,
                  values: { studentName: student.studentName, invoiceNumber: inst.invoiceNumber, amount: inst.remaining, dueDate: inst.dueDate, daysOverdue: inst.daysOverdue },
                  dedupeBase: `alert:${rule.key}:${inst.installmentId}`,
                  context: { installmentId: inst.installmentId, invoiceId: inst.invoiceId, studentId: inst.learnerId },
                });
                queued += r.queued;
              }
              after = page[page.length - 1]!.installmentId;
              if (page.length < PAGE) break;
            }
            return queued;
          },
          "overdue",
        );
      }

      if (rule.trigger === "GRADE_DROP" && rule.conditions.minDrop !== undefined) {
        const minDrop = rule.conditions.minDrop;
        await run(
          rule,
          async () => {
            let queued = 0;
            for (const pair of await deps.ports.grades.listConsecutiveFinals(ctx)) {
              const drop = detectGradeDrop(pair.previous, pair.current, minDrop);
              if (!drop) continue;
              const recipients = await resolver.resolve(rule.audience, { classroomId: pair.classroomId });
              if (recipients.length === 0) continue;
              const r = await enqueueInTx(deps, ctx, tx, {
                ...common,
                source: { kind: "ALERT", ruleKey: rule.key },
                recipients,
                values: { studentName: pair.studentName, className: pair.className, previous: drop.previous, current: drop.current, drop: drop.drop },
                dedupeBase: `alert:${rule.key}:${pair.studentId}:${pair.currentPeriodId}`,
                context: { studentId: pair.studentId, classroomId: pair.classroomId, periodId: pair.currentPeriodId },
              });
              queued += r.queued;
            }
            return queued;
          },
          "gradeDrops",
        );
      }

      if (rule.trigger === "TEACHING_LOAD" && rule.conditions.maxHours !== undefined) {
        const maxHours = rule.conditions.maxHours;
        await run(
          rule,
          async () => {
            let queued = 0;
            const recipients = await resolver.resolve(rule.audience, {});
            if (recipients.length === 0) return 0;
            for (const load of await deps.ports.teachingLoad.listLoads(ctx)) {
              if (!isOverloaded(load.plannedHours, maxHours)) continue;
              const r = await enqueueInTx(deps, ctx, tx, {
                ...common,
                source: { kind: "ALERT", ruleKey: rule.key },
                recipients,
                values: { staffName: load.staffName, hours: load.plannedHours, threshold: maxHours },
                dedupeBase: `alert:${rule.key}:${load.staffId}:${monthKey(today)}`,
                context: { staffId: load.staffId },
              });
              queued += r.queued;
            }
            return queued;
          },
          "teachingLoad",
        );
      }
    }
    return ok({ ...totals, errors });
  });
}
