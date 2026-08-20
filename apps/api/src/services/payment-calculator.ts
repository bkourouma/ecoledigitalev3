import { FastifyInstance } from "fastify";
import {
  PaymentCalculationDetails,
  TeacherPaymentConfig,
  PaymentConfigType,
  PaymentType,
  HourSource,
  PaymentCalculationScope,
  PaymentCalculationSkipReason,
} from "@ecoledigitale/contracts";
import { HourCollector, HourRecord } from "./hour-collectors/types";
import { AcademicHourCollector } from "./hour-collectors/academic-hour-collector";
import { ProfessionalHourCollector } from "./hour-collectors/professional-hour-collector";
import { EcueRateIndex, preloadRatesOnClient } from "./professional-ecue-rates.service";

/**
 * Moteur de calcul de la rémunération enseignante.
 *
 * Feature 031 : la collecte des heures est extraite derrière `HourCollector` et
 * agrège désormais DEUX origines — Académique et Professionnel. Le calcul
 * lui-même (semaines, heures supplémentaires, salaire/horaire/mixte) n'est pas
 * modifié.
 *
 * Décision structurante : un enseignant reçoit UN SEUL paiement par période,
 * quelles que soient les origines de ses heures. Le seuil d'heures
 * supplémentaires porte sur le temps de travail réel d'une personne : le
 * scinder par origine permettrait de faire 30 h en académique et 30 h en
 * professionnel sans jamais le déclencher. L'origine vit donc sur la LIGNE DE
 * DÉTAIL, jamais sur le paiement.
 */

/** Heure enrichie de son tarif résolu, prête pour le calcul. */
export interface PricedHourRecord extends HourRecord {
  /** Tarif appliqué. Figé dans le détail : une révision ultérieure ne le change pas. */
  resolvedRate: number;
}

export interface PaymentHourDetailLine {
  source: HourSource;
  teachingHoursId: string | null;
  attendanceSessionId: string | null;
  seanceId: string | null;
  hoursCount: number;
  hourlyRate: number;
  amount: number;
  isOvertime: boolean;
  /** Libellés d'affichage — utiles à l'aperçu, non persistés. */
  sessionDate?: string | null;
  intitule?: string | null;
  code?: string | null;
}

export interface PaymentCalculationResult {
  teacherId: string;
  teacherName: string;
  paymentType: PaymentType;
  baseAmount: number;
  overtimeAmount: number;
  bonusAmount: number;
  deductions: number;
  totalAmount: number;
  calculationDetails: PaymentCalculationDetails;
  hourDetails: PaymentHourDetailLine[];
  /** Ventilation des heures par origine — lisible directement dans le compte rendu. */
  hoursBySource: Record<HourSource, number>;
}

export interface SkippedTeacher {
  teacherId: string;
  teacherName: string;
  skipReason: PaymentCalculationSkipReason;
  message: string;
}

export interface BatchCalculationOutcome {
  results: PaymentCalculationResult[];
  skipped: SkippedTeacher[];
}

export interface PaymentCalculationInput {
  teacherId: string;
  teacherName: string;
  periodStart: Date;
  periodEnd: Date;
  config: TeacherPaymentConfig;
  hours: PricedHourRecord[];
}

export class PaymentCalculator {
  private readonly academicCollector = new AcademicHourCollector();
  private readonly professionalCollector = new ProfessionalHourCollector();

  constructor(private fastify: FastifyInstance) {}

  /* =================================================================== */
  /* Calcul unitaire                                                      */
  /* =================================================================== */

  /**
   * Calcul pur : aucune I/O, tout vient de `input`. Public pour être testable
   * directement — les invariants de la feature (un seul bulletin, heures
   * supplémentaires sur le cumul des origines) se vérifient ici, sans base.
   */
  computePayment(input: PaymentCalculationInput): PaymentCalculationResult {
    switch (input.config.configType) {
      case "salary":
        return this.calculateSalaryPayment(input);
      case "hourly":
        return this.calculateHourlyPayment(input);
      case "mixed":
        return this.calculateMixedPayment(input);
      default:
        throw new Error(`Unsupported payment config type: ${input.config.configType}`);
    }
  }

  /** Salaire prorata des jours ouvrés. Les heures n'entrent pas dans le montant. */
  private calculateSalaryPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const { teacherId, teacherName, periodStart, periodEnd, config, hours } = input;

    if (!config.monthlySalary && !config.annualSalary) {
      throw new Error("Salary configuration missing for salary-based payment");
    }

    const monthlySalary = config.monthlySalary || config.annualSalary! / 12;
    const { totalDays, workingDays } = this.calculateWorkingDays(periodStart, periodEnd);
    const prorationFactor = workingDays / this.getStandardWorkingDaysInMonth(periodStart);
    const baseAmount = monthlySalary * prorationFactor;

    const calculationDetails: PaymentCalculationDetails = {
      regularHours: 0,
      overtimeHours: 0,
      rates: { regular: 0, overtime: 0 },
      periodDays: totalDays,
      workingDays,
      breakdown: [{ description: "Salaire mensuel (prorata)", amount: baseAmount }],
    };

    return {
      teacherId,
      teacherName,
      paymentType: "salary",
      baseAmount,
      overtimeAmount: 0,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: baseAmount,
      calculationDetails,
      // Les séances sont listées à titre informatif : un enseignant salarié
      // doit pouvoir vérifier ce qui a été constaté, même si le montant n'en
      // dépend pas.
      hourDetails: [],
      hoursBySource: this.sumBySource(hours),
    };
  }

  /** Rémunération horaire, heures supplémentaires appréciées par semaine calendaire. */
  private calculateHourlyPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const { teacherId, teacherName, config, hours, periodStart, periodEnd } = input;

    const hoursBySource = this.sumBySource(hours);

    if (hours.length === 0) {
      const { totalDays, workingDays } = this.calculateWorkingDays(periodStart, periodEnd);
      return {
        teacherId,
        teacherName,
        paymentType: "hourly",
        baseAmount: 0,
        overtimeAmount: 0,
        bonusAmount: 0,
        deductions: 0,
        totalAmount: 0,
        calculationDetails: {
          regularHours: 0,
          overtimeHours: 0,
          rates: {
            regular: config.defaultHourlyRate ?? 0,
            overtime: (config.defaultHourlyRate ?? 0) * config.overtimeMultiplier,
          },
          periodDays: totalDays,
          workingDays,
          breakdown: [{ description: "Aucune heure validée sur la période", amount: 0 }],
        },
        hourDetails: [],
        hoursBySource,
      };
    }

    let totalRegularAmount = 0;
    let totalOvertimeAmount = 0;
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;
    const hourDetails: PaymentHourDetailLine[] = [];

    // Le cumul hebdomadaire mélange délibérément les origines : c'est le temps
    // de travail réel de la personne qui déclenche les heures supplémentaires.
    for (const [, weekHours] of this.groupHoursByWeek(hours)) {
      let weeklyTotal = 0;

      for (const hour of weekHours) {
        const rate = hour.resolvedRate;
        weeklyTotal += hour.hours;

        // Seule la fraction qui dépasse le seuil bascule en heures sup — une
        // séance à cheval sur le seuil est donc coupée en deux lignes.
        const overtimeHours = Math.max(
          0,
          Math.min(hour.hours, weeklyTotal - config.overtimeThreshold)
        );
        const regularHours = hour.hours - overtimeHours;

        if (regularHours > 0) {
          const amount = regularHours * rate;
          totalRegularAmount += amount;
          totalRegularHours += regularHours;
          hourDetails.push(this.toDetailLine(hour, regularHours, rate, amount, false));
        }

        if (overtimeHours > 0) {
          const overtimeRate = rate * config.overtimeMultiplier;
          const amount = overtimeHours * overtimeRate;
          totalOvertimeAmount += amount;
          totalOvertimeHours += overtimeHours;
          hourDetails.push(this.toDetailLine(hour, overtimeHours, overtimeRate, amount, true));
        }
      }
    }

    const breakdown: PaymentCalculationDetails["breakdown"] = [];
    if (totalRegularHours > 0) {
      breakdown.push({
        description: "Heures normales",
        amount: totalRegularAmount,
        hours: totalRegularHours,
        rate: totalRegularAmount / totalRegularHours,
      });
    }
    if (totalOvertimeHours > 0) {
      breakdown.push({
        description: "Heures supplémentaires",
        amount: totalOvertimeAmount,
        hours: totalOvertimeHours,
        rate: totalOvertimeAmount / totalOvertimeHours,
      });
    }
    for (const source of ["academique", "professionnel"] as const) {
      if (hoursBySource[source] > 0) {
        breakdown.push({
          description: source === "academique" ? "dont Académique" : "dont Professionnel",
          amount: 0,
          hours: hoursBySource[source],
        });
      }
    }

    const span = this.calculateWorkingDays(periodStart, periodEnd);

    return {
      teacherId,
      teacherName,
      paymentType: "hourly",
      baseAmount: totalRegularAmount,
      overtimeAmount: totalOvertimeAmount,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: totalRegularAmount + totalOvertimeAmount,
      calculationDetails: {
        regularHours: totalRegularHours,
        overtimeHours: totalOvertimeHours,
        rates: {
          regular: config.defaultHourlyRate ?? 0,
          overtime: (config.defaultHourlyRate ?? 0) * config.overtimeMultiplier,
        },
        periodDays: span.totalDays,
        workingDays: span.workingDays,
        breakdown,
      },
      hourDetails,
      hoursBySource,
    };
  }

  /** Salaire + heures : les deux composantes s'additionnent. */
  private calculateMixedPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const salaryResult = this.calculateSalaryPayment(input);
    const hourlyResult = this.calculateHourlyPayment(input);

    return {
      teacherId: input.teacherId,
      teacherName: input.teacherName,
      paymentType: "mixed",
      baseAmount: salaryResult.baseAmount + hourlyResult.baseAmount,
      overtimeAmount: hourlyResult.overtimeAmount,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: salaryResult.totalAmount + hourlyResult.totalAmount,
      calculationDetails: {
        regularHours: hourlyResult.calculationDetails.regularHours,
        overtimeHours: hourlyResult.calculationDetails.overtimeHours,
        rates: hourlyResult.calculationDetails.rates,
        periodDays: salaryResult.calculationDetails.periodDays,
        workingDays: salaryResult.calculationDetails.workingDays,
        breakdown: [
          ...salaryResult.calculationDetails.breakdown,
          ...hourlyResult.calculationDetails.breakdown,
        ],
      },
      hourDetails: hourlyResult.hourDetails,
      hoursBySource: hourlyResult.hoursBySource,
    };
  }

  private toDetailLine(
    hour: PricedHourRecord,
    hoursCount: number,
    hourlyRate: number,
    amount: number,
    isOvertime: boolean
  ): PaymentHourDetailLine {
    return {
      source: hour.source,
      // `teaching_hours` n'est pas une source collectée : la colonne existe pour
      // l'historique du schéma, jamais renseignée par ce calcul (écart E4).
      teachingHoursId: null,
      attendanceSessionId: hour.source === "academique" ? (hour.attendanceSessionId ?? null) : null,
      seanceId: hour.source === "professionnel" ? (hour.seanceId ?? null) : null,
      hoursCount,
      hourlyRate,
      amount,
      isOvertime,
      sessionDate: hour.sessionDate,
      intitule: hour.intitule ?? null,
      code: hour.code ?? null,
    };
  }

  private sumBySource(hours: HourRecord[]): Record<HourSource, number> {
    const acc: Record<HourSource, number> = { academique: 0, professionnel: 0 };
    for (const h of hours) acc[h.source] += h.hours;
    return acc;
  }

  /* =================================================================== */
  /* Utilitaires de calendrier (inchangés)                                */
  /* =================================================================== */

  private calculateWorkingDays(start: Date, end: Date): { totalDays: number; workingDays: number } {
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    let workingDays = 0;
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
      current.setDate(current.getDate() + 1);
    }
    return { totalDays, workingDays };
  }

  private getStandardWorkingDaysInMonth(date: Date): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let workingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dayOfWeek = new Date(year, month, day).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
    }
    return workingDays;
  }

  /** Regroupe par semaine ISO (lundi) pour le seuil d'heures supplémentaires. */
  private groupHoursByWeek(hours: PricedHourRecord[]): Map<string, PricedHourRecord[]> {
    const weekly = new Map<string, PricedHourRecord[]>();
    for (const hour of hours) {
      const weekKey = this.getWeekStart(hour.sessionDate);
      const list = weekly.get(weekKey);
      if (list) list.push(hour);
      else weekly.set(weekKey, [hour]);
    }
    for (const list of weekly.values()) {
      list.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
    }
    return weekly;
  }

  /** Lundi de la semaine d'une date `YYYY-MM-DD`, en clé `YYYY-MM-DD`. */
  private getWeekStart(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  /* =================================================================== */
  /* Calcul par lot                                                       */
  /* =================================================================== */

  /**
   * Calcule les paiements d'une période. `scope` restreint les origines
   * collectées ; par défaut les deux.
   *
   * Retourne les résultats ET les enseignants écartés avec leur motif : un
   * compte rendu qui se contente d'omettre un enseignant ne permet pas de
   * savoir s'il manque une configuration, des heures, ou un tarif.
   */
  async calculateBatchPayments(
    tenantId: string,
    periodId: string,
    teacherIds?: string[],
    scope: PaymentCalculationScope = "all"
  ): Promise<BatchCalculationOutcome> {
    const client = await this.fastify.pg.connect();
    try {
      this.fastify.log.info(
        `calculateBatchPayments: tenant=${tenantId} period=${periodId} scope=${scope} teachers=${teacherIds?.length ?? "all"}`
      );

      const periodResult = await client.query(
        `SELECT to_char(period_start::date, 'YYYY-MM-DD') AS period_start,
                to_char(period_end::date,   'YYYY-MM-DD') AS period_end
         FROM payment_periods
         WHERE id = $1 AND tenant_id = $2`,
        [periodId, tenantId]
      );
      if (periodResult.rows.length === 0) {
        throw new Error(`Payment period not found: ${periodId}`);
      }
      const periodStartStr: string = periodResult.rows[0].period_start;
      const periodEndStr: string = periodResult.rows[0].period_end;

      // --- Enseignants du périmètre -----------------------------------
      const restrict = Boolean(teacherIds && teacherIds.length > 0);
      const teachersResult = await client.query(
        `SELECT t.id,
                COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                         TRIM(t.first_name || ' ' || t.last_name),
                         u.email, 'Enseignant') AS name
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.tenant_id = $1
           AND t.status = 'active'
           AND ($2::boolean IS FALSE OR t.id = ANY($3::uuid[]))`,
        [tenantId, restrict, restrict ? teacherIds : []]
      );
      const teacherNames = new Map<string, string>(
        teachersResult.rows.map((r) => [r.id as string, r.name as string])
      );

      // --- Collecte des heures : UNE requête par origine ---------------
      const collectors: HourCollector[] = [];
      if (scope === "all" || scope === "academique") collectors.push(this.academicCollector);
      if (scope === "all" || scope === "professionnel") collectors.push(this.professionalCollector);

      const collected: HourRecord[] = [];
      for (const collector of collectors) {
        const rows = await collector.collect(client, {
          tenantId,
          periodStart: periodStartStr,
          periodEnd: periodEndStr,
          teacherIds: restrict ? teacherIds : undefined,
          // Les heures déjà portées au bulletin d'une AUTRE période sont
          // écartées par le collecteur. Passer la période courante lui permet
          // de ne pas s'exclure lui-même lors d'un recalcul.
          periodId,
        });
        this.fastify.log.info(`  collecteur ${collector.source}: ${rows.length} heure(s)`);
        collected.push(...rows);
      }

      // --- Tarifs -----------------------------------------------------
      const ecueRates: EcueRateIndex = await preloadRatesOnClient(
        client,
        tenantId,
        periodStartStr,
        periodEndStr
      );
      const courseRates = await this.loadCourseRates(
        client,
        tenantId,
        periodStartStr,
        periodEndStr
      );

      // --- Regroupement par enseignant --------------------------------
      const hoursByTeacher = new Map<string, HourRecord[]>();
      for (const record of collected) {
        if (!teacherNames.has(record.teacherId)) continue; // hors périmètre / inactif
        const list = hoursByTeacher.get(record.teacherId);
        if (list) list.push(record);
        else hoursByTeacher.set(record.teacherId, [record]);
      }

      const results: PaymentCalculationResult[] = [];
      const skipped: SkippedTeacher[] = [];

      for (const [teacherId, teacherName] of teacherNames) {
        const teacherHours = hoursByTeacher.get(teacherId) ?? [];

        const configResult = await client.query(
          `SELECT * FROM teacher_payment_configs
           WHERE tenant_id = $1 AND teacher_id = $2
             AND effective_from <= $3::date
             AND (effective_to IS NULL OR effective_to >= $4::date)
           ORDER BY effective_from DESC
           LIMIT 1`,
          [tenantId, teacherId, periodEndStr, periodStartStr]
        );

        if (configResult.rows.length === 0) {
          // Signalé explicitement : sans configuration, l'enseignant n'est jamais
          // payé et personne ne s'en aperçoit tant qu'il ne réclame pas.
          skipped.push({
            teacherId,
            teacherName,
            skipReason: "NO_CONFIG",
            message: "Aucune configuration de paie valide sur la période.",
          });
          continue;
        }

        const config = this.mapConfigFromDb(configResult.rows[0]);

        /**
         * SANS HEURE VALIDÉE, PAS DE BULLETIN.
         *
         * Un bulletin est un document de PAIEMENT : s'il n'y a rien à verser,
         * il n'y a pas de document. Émettre un bulletin à zéro obligerait à
         * l'étiqueter, et le seul mot disponible — « impayé » — dirait le
         * contraire de la réalité : impayé signifie « une somme est due et n'a
         * pas été réglée », alors qu'ici rien n'est dû. L'historique
         * afficherait des créances qui n'existent pas.
         *
         * L'enseignant n'est pas perdu de vue pour autant : l'écran des
         * bulletins liste TOUS les enseignants, et signale séparément ceux dont
         * des séances réalisées attendent d'être validées — le cas réellement
         * dangereux, où l'absence d'heures vient d'un oubli de validation et
         * non d'une absence de cours.
         */
        if (config.configType === "hourly" && teacherHours.length === 0) {
          skipped.push({
            teacherId,
            teacherName,
            skipReason: "NO_HOURS",
            message: "Aucune heure validée sur la période.",
          });
          continue;
        }

        // --- Tarification de chaque heure -----------------------------
        const priced: PricedHourRecord[] = [];
        let unresolved: HourRecord | null = null;

        for (const hour of teacherHours) {
          const rate = this.resolveRate(hour, config, ecueRates, courseRates);
          if (rate === null) {
            unresolved = hour;
            break;
          }
          priced.push({ ...hour, resolvedRate: rate });
        }

        if (unresolved) {
          // Un montant nul silencieux serait pris pour « pas d'heures ».
          skipped.push({
            teacherId,
            teacherName,
            skipReason: "NO_RATE_RESOLVED",
            message:
              unresolved.source === "professionnel"
                ? `Aucun tarif applicable pour l'ECUE « ${unresolved.code ?? unresolved.ecueId} » le ${unresolved.sessionDate}, ni tarif horaire par défaut.`
                : `Aucun tarif applicable pour le cours « ${unresolved.code ?? unresolved.courseId} » le ${unresolved.sessionDate}, ni tarif horaire par défaut.`,
          });
          continue;
        }

        try {
          results.push(
            this.computePayment({
              teacherId,
              teacherName,
              periodStart: new Date(`${periodStartStr}T00:00:00Z`),
              periodEnd: new Date(`${periodEndStr}T00:00:00Z`),
              config,
              hours: priced,
            })
          );
        } catch (error) {
          this.fastify.log.error(
            `Erreur de calcul pour l'enseignant ${teacherId}: ${error instanceof Error ? error.message : String(error)}`
          );
          skipped.push({
            teacherId,
            teacherName,
            skipReason: "NO_CONFIG",
            message: error instanceof Error ? error.message : "Configuration de paie inexploitable.",
          });
        }
      }

      this.fastify.log.info(
        `calculateBatchPayments terminé : ${results.length} calculé(s), ${skipped.length} écarté(s)`
      );
      return { results, skipped };
    } finally {
      client.release();
    }
  }

  /**
   * Tarif d'une heure. Ordre : tarif spécifique à l'origine, puis tarif horaire
   * par défaut de la configuration. `null` = rien de résoluble (FR-013).
   */
  private resolveRate(
    hour: HourRecord,
    config: TeacherPaymentConfig,
    ecueRates: EcueRateIndex,
    courseRates: Map<string, number>
  ): number | null {
    if (hour.source === "professionnel" && hour.ecueId) {
      const hit = ecueRates.find(hour.ecueId, hour.teacherId, hour.sessionDate);
      if (hit) return hit.montant_horaire;
    }
    if (hour.source === "academique" && hour.courseId) {
      const rate = courseRates.get(hour.courseId);
      if (rate != null) return rate;
    }
    if (config.defaultHourlyRate != null) return config.defaultHourlyRate;
    // Un salarié pur n'a pas de tarif horaire : ses heures ne portent aucun
    // montant, ce n'est pas une anomalie.
    if (config.configType === "salary") return 0;
    return null;
  }

  /** Tarifs par cours (Académique), tous enseignants — le nominatif l'emporte. */
  private async loadCourseRates(
    client: any,
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<Map<string, number>> {
    const res = await client.query(
      `SELECT course_id, rate_amount::float8 AS rate_amount, teacher_id
       FROM course_hourly_rates
       WHERE tenant_id = $1
         AND effective_from <= $2::date
         AND (effective_to IS NULL OR effective_to >= $3::date)
         AND course_id IS NOT NULL
       ORDER BY (teacher_id IS NULL), effective_from DESC`,
      [tenantId, periodEnd, periodStart]
    );
    const map = new Map<string, number>();
    for (const row of res.rows) {
      if (!map.has(row.course_id)) map.set(row.course_id, Number(row.rate_amount));
    }
    return map;
  }

  private mapConfigFromDb(row: any): TeacherPaymentConfig {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      teacherId: row.teacher_id,
      configType: row.config_type as PaymentConfigType,
      monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
      annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
      defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
      overtimeThreshold: parseInt(row.overtime_threshold) || 40,
      overtimeMultiplier: parseFloat(row.overtime_multiplier) || 1.5,
      effectiveFrom: new Date(row.effective_from),
      effectiveTo: row.effective_to ? new Date(row.effective_to) : undefined,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    } as TeacherPaymentConfig;
  }
}
