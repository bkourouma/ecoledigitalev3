import { FastifyInstance } from "fastify";
import { 
  PaymentCalculationDetails,
  TeacherPaymentConfig,
  PaymentConfigType,
  PaymentType
} from "@ecoledigitale/contracts";

export interface TeachingHourRecord {
  id: string;
  assignmentId: string;
  sessionDate: Date;
  hoursTaught: number;
  sessionType: 'theory' | 'practical' | 'exam' | 'evaluation';
  validatedAt: Date | null;
  courseId: string;
  teacherId: string;
}

export interface PaymentCalculationInput {
  teacherId: string;
  periodStart: Date;
  periodEnd: Date;
  config: TeacherPaymentConfig;
  teachingHours: TeachingHourRecord[];
  courseRates?: Record<string, number>; // courseId -> hourly rate
}

export interface PaymentCalculationResult {
  teacherId: string;
  paymentType: PaymentType;
  baseAmount: number;
  overtimeAmount: number;
  bonusAmount: number;
  deductions: number;
  totalAmount: number;
  calculationDetails: PaymentCalculationDetails;
  hourDetails: Array<{
    teachingHoursId: string;
    hoursCount: number;
    hourlyRate: number;
    amount: number;
    isOvertime: boolean;
  }>;
}

export class PaymentCalculator {
  constructor(private fastify: FastifyInstance) {}

  /**
   * Calculate payment for a teacher for a given period
   */
  async calculatePayment(input: PaymentCalculationInput): Promise<PaymentCalculationResult> {
    const { teacherId, periodStart, periodEnd, config, teachingHours, courseRates = {} } = input;

    switch (config.configType) {
      case 'salary':
        return this.calculateSalaryPayment(input);
      case 'hourly':
        return this.calculateHourlyPayment(input);
      case 'mixed':
        return this.calculateMixedPayment(input);
      default:
        throw new Error(`Unsupported payment config type: ${config.configType}`);
    }
  }

  /**
   * Calculate salary-based payment
   */
  private calculateSalaryPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const { teacherId, periodStart, periodEnd, config } = input;

    if (!config.monthlySalary && !config.annualSalary) {
      throw new Error('Salary configuration missing for salary-based payment');
    }

    const monthlySalary = config.monthlySalary || (config.annualSalary! / 12);
    
    // Calculate proration based on working days
    const { totalDays, workingDays } = this.calculateWorkingDays(periodStart, periodEnd);
    const prorationFactor = workingDays / this.getStandardWorkingDaysInMonth(periodStart);
    
    const baseAmount = monthlySalary * prorationFactor;

    const calculationDetails: PaymentCalculationDetails = {
      regularHours: 0, // Not applicable for salary
      overtimeHours: 0,
      rates: {
        regular: 0,
        overtime: 0,
      },
      periodDays: totalDays,
      workingDays,
      breakdown: [
        {
          description: 'Monthly Salary (Prorated)',
          amount: baseAmount,
        },
      ],
    };

    return {
      teacherId,
      paymentType: 'salary',
      baseAmount,
      overtimeAmount: 0,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: baseAmount,
      calculationDetails,
      hourDetails: [],
    };
  }

  /**
   * Calculate hourly-based payment
   */
  private calculateHourlyPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const { teacherId, config, teachingHours, courseRates = {}, periodStart, periodEnd } = input;

    if (!config.defaultHourlyRate) {
      throw new Error('Default hourly rate missing for hourly-based payment');
    }

    // Only count validated hours
    const validatedHours = teachingHours.filter(h => h.validatedAt !== null);
    
    // If no validated hours, return zero payment
    if (validatedHours.length === 0) {
      const { totalDays, workingDays } = this.calculateWorkingDays(periodStart, periodEnd);
      return {
        teacherId,
        paymentType: 'hourly',
        baseAmount: 0,
        overtimeAmount: 0,
        bonusAmount: 0,
        deductions: 0,
        totalAmount: 0,
        calculationDetails: {
          regularHours: 0,
          overtimeHours: 0,
          rates: {
            regular: config.defaultHourlyRate,
            overtime: config.defaultHourlyRate * config.overtimeMultiplier,
          },
          periodDays: totalDays,
          workingDays,
          breakdown: [
            {
              description: 'No validated hours for this period',
              amount: 0,
            },
          ],
        },
        hourDetails: [],
      };
    }
    
    let totalRegularAmount = 0;
    let totalOvertimeAmount = 0;
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;
    
    const hourDetails: Array<{
      teachingHoursId: string;
      hoursCount: number;
      hourlyRate: number;
      amount: number;
      isOvertime: boolean;
    }> = [];

    const breakdown: Array<{
      description: string;
      amount: number;
      hours?: number;
      rate?: number;
    }> = [];

    // Calculate weekly hours to determine overtime
    const weeklyHours = this.groupHoursByWeek(validatedHours);
    
    for (const [weekStart, weekHours] of weeklyHours.entries()) {
      let weeklyTotal = 0;
      
      for (const hour of weekHours) {
        const rate = courseRates[hour.courseId] || config.defaultHourlyRate;
        weeklyTotal += hour.hoursTaught;
        
        const isOvertime = weeklyTotal > config.overtimeThreshold;
        const overtimeHours = isOvertime ? 
          Math.max(0, weeklyTotal - config.overtimeThreshold) : 0;
        const regularHours = hour.hoursTaught - overtimeHours;
        
        if (regularHours > 0) {
          const regularAmount = regularHours * rate;
          totalRegularAmount += regularAmount;
          totalRegularHours += regularHours;
          
          hourDetails.push({
            teachingHoursId: hour.id,
            hoursCount: regularHours,
            hourlyRate: rate,
            amount: regularAmount,
            isOvertime: false,
          });
        }
        
        if (overtimeHours > 0) {
          const overtimeRate = rate * config.overtimeMultiplier;
          const overtimeAmount = overtimeHours * overtimeRate;
          totalOvertimeAmount += overtimeAmount;
          totalOvertimeHours += overtimeHours;
          
          hourDetails.push({
            teachingHoursId: hour.id,
            hoursCount: overtimeHours,
            hourlyRate: overtimeRate,
            amount: overtimeAmount,
            isOvertime: true,
          });
        }
      }
    }

    // Create breakdown
    if (totalRegularHours > 0) {
      breakdown.push({
        description: 'Regular Hours',
        amount: totalRegularAmount,
        hours: totalRegularHours,
        rate: totalRegularAmount / totalRegularHours,
      });
    }

    if (totalOvertimeHours > 0) {
      breakdown.push({
        description: 'Overtime Hours',
        amount: totalOvertimeAmount,
        hours: totalOvertimeHours,
        rate: totalOvertimeAmount / totalOvertimeHours,
      });
    }

    const calculationDetails: PaymentCalculationDetails = {
      regularHours: totalRegularHours,
      overtimeHours: totalOvertimeHours,
      rates: {
        regular: config.defaultHourlyRate,
        overtime: config.defaultHourlyRate * config.overtimeMultiplier,
      },
      periodDays: this.calculateWorkingDays(
        new Date(Math.min(...validatedHours.map(h => h.sessionDate.getTime()))),
        new Date(Math.max(...validatedHours.map(h => h.sessionDate.getTime())))
      ).totalDays,
      workingDays: this.calculateWorkingDays(
        new Date(Math.min(...validatedHours.map(h => h.sessionDate.getTime()))),
        new Date(Math.max(...validatedHours.map(h => h.sessionDate.getTime())))
      ).workingDays,
      breakdown,
    };

    return {
      teacherId,
      paymentType: 'hourly',
      baseAmount: totalRegularAmount,
      overtimeAmount: totalOvertimeAmount,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: totalRegularAmount + totalOvertimeAmount,
      calculationDetails,
      hourDetails,
    };
  }

  /**
   * Calculate mixed payment (salary + hourly)
   */
  private calculateMixedPayment(input: PaymentCalculationInput): PaymentCalculationResult {
    const salaryResult = this.calculateSalaryPayment(input);
    const hourlyResult = this.calculateHourlyPayment(input);

    const totalAmount = salaryResult.totalAmount + hourlyResult.totalAmount;

    const calculationDetails: PaymentCalculationDetails = {
      regularHours: hourlyResult.calculationDetails.regularHours,
      overtimeHours: hourlyResult.calculationDetails.overtimeHours,
      rates: hourlyResult.calculationDetails.rates,
      periodDays: salaryResult.calculationDetails.periodDays,
      workingDays: salaryResult.calculationDetails.workingDays,
      breakdown: [
        ...salaryResult.calculationDetails.breakdown,
        ...hourlyResult.calculationDetails.breakdown,
      ],
    };

    return {
      teacherId: input.teacherId,
      paymentType: 'mixed',
      baseAmount: salaryResult.baseAmount + hourlyResult.baseAmount,
      overtimeAmount: hourlyResult.overtimeAmount,
      bonusAmount: 0,
      deductions: 0,
      totalAmount,
      calculationDetails,
      hourDetails: hourlyResult.hourDetails,
    };
  }

  /**
   * Calculate working days in a period (excluding weekends)
   */
  private calculateWorkingDays(start: Date, end: Date): { totalDays: number; workingDays: number } {
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    let workingDays = 0;
    
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
        workingDays++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return { totalDays, workingDays };
  }

  /**
   * Get standard working days in a month (approximately 22 days)
   */
  private getStandardWorkingDaysInMonth(date: Date): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let workingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dayOfWeek = new Date(year, month, day).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDays++;
      }
    }
    
    return workingDays;
  }

  /**
   * Group teaching hours by week to calculate overtime correctly
   */
  private groupHoursByWeek(hours: TeachingHourRecord[]): Map<string, TeachingHourRecord[]> {
    const weeklyHours = new Map<string, TeachingHourRecord[]>();
    
    for (const hour of hours) {
      const weekStart = this.getWeekStart(hour.sessionDate);
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeklyHours.has(weekKey)) {
        weeklyHours.set(weekKey, []);
      }
      weeklyHours.get(weekKey)!.push(hour);
    }
    
    // Sort hours within each week by date
    for (const [week, weekHours] of weeklyHours.entries()) {
      weekHours.sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
    }
    
    return weeklyHours;
  }

  /**
   * Get the start of the week (Monday) for a given date
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
  }

  /**
   * Batch calculate payments for multiple teachers
   */
  async calculateBatchPayments(
    tenantId: string,
    periodId: string,
    teacherIds?: string[]
  ): Promise<PaymentCalculationResult[]> {
    const client = await this.fastify.pg.connect();
    try {
      this.fastify.log.info(`Starting calculateBatchPayments: tenantId=${tenantId}, periodId=${periodId}, teacherIds=${teacherIds?.length || 'all'}`);
      
      // Get payment period
      const periodResult = await client.query(
        `SELECT
           period_start,
           period_end,
           to_char(period_start::date, 'YYYY-MM-DD') AS period_start_date,
           to_char(period_end::date, 'YYYY-MM-DD') AS period_end_date
         FROM payment_periods 
         WHERE id = $1 AND tenant_id = $2`,
        [periodId, tenantId]
      );

      if (periodResult.rows.length === 0) {
        this.fastify.log.error(`Payment period not found: periodId=${periodId}, tenantId=${tenantId}`);
        throw new Error(`Payment period not found: ${periodId}`);
      }

      const { period_start, period_end, period_start_date, period_end_date } = periodResult.rows[0];
      // Convert to date strings for SQL queries
      const periodStartStr = period_start_date || (period_start instanceof Date 
        ? period_start.toISOString().split('T')[0] 
        : new Date(period_start).toISOString().split('T')[0]);
      const periodEndStr = period_end_date || (period_end instanceof Date 
        ? period_end.toISOString().split('T')[0] 
        : new Date(period_end).toISOString().split('T')[0]);
      this.fastify.log.info(`Found period: ${periodStartStr} to ${periodEndStr}`);

      // Get teachers to calculate for
      let teacherQuery = `
        SELECT DISTINCT t.id, t.user_id
        FROM teachers t
        WHERE t.tenant_id = $1 AND t.status = 'active'
      `;
      const teacherParams = [tenantId];

      if (teacherIds && teacherIds.length > 0) {
        teacherQuery += ` AND t.id = ANY($2)`;
        teacherParams.push(teacherIds);
      }

      const teachersResult = await client.query(teacherQuery, teacherParams);
      const results: PaymentCalculationResult[] = [];

      this.fastify.log.info(`Calculating payments for ${teachersResult.rows.length} teacher(s)`);

      for (const teacher of teachersResult.rows) {
        try {
          this.fastify.log.info(`Processing teacher ${teacher.id}`);
          
          // Get teacher payment config
          const configResult = await client.query(
            `SELECT * FROM teacher_payment_configs 
             WHERE tenant_id = $1 AND teacher_id = $2 
             AND effective_from <= $3 
             AND (effective_to IS NULL OR effective_to >= $4)
             ORDER BY effective_from DESC
             LIMIT 1`,
            [tenantId, teacher.id, period_end, period_start]
          );

          if (configResult.rows.length === 0) {
            this.fastify.log.warn(`No payment config found for teacher ${teacher.id}`);
            continue;
          }

          const config = this.mapConfigFromDb(configResult.rows[0]);
          this.fastify.log.info(`Found config for teacher ${teacher.id}: type=${config.configType}, salary=${config.monthlySalary}, hourlyRate=${config.defaultHourlyRate}`);

          // Get validated attendance sessions for the period.
          // Source aligned with /payments/teaching-hours and /teacher/hours.
          const hoursResult = await client.query(
            `SELECT
               s.id,
               s.assignment_id,
               s.session_date,
               s.duration_hours,
               s.status,
               cc.course_id
             FROM teacher_attendance_sessions s
             JOIN teacher_assignments ta ON s.assignment_id = ta.id
             JOIN class_courses cc ON ta.class_course_id = cc.id
             WHERE s.tenant_id = $1
               AND ta.teacher_id = $2
               AND s.status = 'completed'
               AND s.session_date BETWEEN $3::date AND $4::date`,
            [tenantId, teacher.id, periodStartStr, periodEndStr]
          );

          this.fastify.log.info(`Found ${hoursResult.rows.length} validated attendance sessions for teacher ${teacher.id}`);

          const teachingHours = hoursResult.rows.map(row => ({
            id: row.id,
            assignmentId: row.assignment_id,
            sessionDate: new Date(row.session_date),
            hoursTaught: parseFloat(row.duration_hours || 0),
            sessionType: 'theory' as const,
            validatedAt: row.status === 'completed' ? new Date(row.session_date) : null,
            courseId: row.course_id,
            teacherId: teacher.id,
          }));

          // Get course-specific rates
          const ratesResult = await client.query(
            `SELECT course_id, rate_amount
             FROM course_hourly_rates
             WHERE tenant_id = $1 
             AND (teacher_id = $2 OR teacher_id IS NULL)
             AND effective_from <= $3
             AND (effective_to IS NULL OR effective_to >= $4)
             ORDER BY teacher_id NULLS LAST, effective_from DESC`,
            [tenantId, teacher.id, period_end, period_start]
          );

          const courseRates: Record<string, number> = {};
          for (const rate of ratesResult.rows) {
            if (rate.course_id && !courseRates[rate.course_id]) {
              courseRates[rate.course_id] = parseFloat(rate.rate_amount);
            }
          }

          // Calculate payment
          const result = await this.calculatePayment({
            teacherId: teacher.id,
            periodStart: new Date(period_start),
            periodEnd: new Date(period_end),
            config,
            teachingHours,
            courseRates,
          });

          this.fastify.log.info(`Calculated payment for teacher ${teacher.id}: totalAmount=${result.totalAmount}, type=${result.paymentType}`);
          results.push(result);
        } catch (error) {
          this.fastify.log.error(`Error calculating payment for teacher ${teacher.id}:`, error);
          // Continue with other teachers
        }
      }

      this.fastify.log.info(`Calculation complete: ${results.length} result(s) returned`);

      return results;
    } catch (error) {
      this.fastify.log.error('Error in calculateBatchPayments:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.fastify.log.error('calculateBatchPayments error details:', {
        error: errorMessage,
        stack: errorStack,
        tenantId,
        periodId,
        teacherIds
      });
      throw error; // Re-throw to be handled by the route handler
    } finally {
      client.release();
    }
  }

  /**
   * Map database row to TeacherPaymentConfig
   */
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
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
