import { Pool } from 'pg';

interface ReportFilters {
  tenantId: string;
  academicYearId?: string;
  classId?: string;
  feeType?: string;
  fromDate?: Date;
  toDate?: Date;
  groupBy?: 'student' | 'class' | 'fee_type' | 'month';
  includeDetails?: boolean;
}

interface RevenueReport {
  totalRevenue: number;
  totalOutstanding: number;
  collectionRate: number;
  byFeeType: Record<string, {
    total: number;
    collected: number;
    pending: number;
    overdue: number;
  }>;
  byPaymentMethod: Record<string, number>;
  monthlyTrends: Array<{
    month: string;
    revenue: number;
    transactions: number;
  }>;
  // Revenus du Module Professionnel (feature 028) — champ additif et optionnel.
  professional?: {
    totalRevenue: number;
    byMode: Record<string, number>;
    monthlyTrends: Array<{ month: string; revenue: number; transactions: number }>;
  };
}

interface StudentPaymentReport {
  studentId: string;
  studentName: string;
  studentNumber: string;
  className?: string;
  totalFees: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueAmount: number;
  paymentHistory: Array<{
    date: Date;
    feeType: string;
    amount: number;
    paymentMethod: string;
  }>;
}

interface ClassPaymentReport {
  classId: string;
  className: string;
  totalStudents: number;
  totalFees: number;
  totalCollected: number;
  collectionRate: number;
  studentsWithOverdue: number;
  averagePaymentTime: number; // days
}

interface PaymentMethodReport {
  paymentMethod: string;
  transactionCount: number;
  totalAmount: number;
  averageAmount: number;
  successRate: number;
  monthlyTrends: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
}

export class FinancialReportsService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Generate comprehensive revenue report
   */
  async generateRevenueReport(filters: ReportFilters): Promise<RevenueReport> {
    const client = await this.pool.connect();
    
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [filters.tenantId]);

      // Build WHERE conditions
      const whereConditions = this.buildWhereConditions(filters);
      const { conditions, params } = whereConditions;

      // Get total revenue and outstanding
      const revenueQuery = `
        SELECT 
          COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.amount ELSE 0 END), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') THEN pt.amount ELSE 0 END), 0) as total_outstanding
        FROM payment_transactions pt
        JOIN student_profiles sp ON pt.student_id = sp.id AND pt.tenant_id = sp.tenant_id
        LEFT JOIN student_enrollments se ON pt.enrollment_id = se.id AND pt.tenant_id = se.tenant_id
        WHERE ${conditions.join(' AND ')}
      `;

      const revenueResult = await client.query(revenueQuery, params);
      const { total_revenue, total_outstanding } = revenueResult.rows[0];

      const totalRevenue = parseFloat(total_revenue);
      const totalOutstanding = parseFloat(total_outstanding);
      const collectionRate = totalRevenue + totalOutstanding > 0 
        ? (totalRevenue / (totalRevenue + totalOutstanding)) * 100 
        : 0;

      // Get revenue by fee type
      const feeTypeQuery = `
        SELECT 
          pt.fee_type,
          COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.amount ELSE 0 END), 0) as collected,
          COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') THEN pt.amount ELSE 0 END), 0) as pending,
          COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') AND sti.due_date < CURRENT_DATE THEN pt.amount ELSE 0 END), 0) as overdue
        FROM payment_transactions pt
        JOIN student_profiles sp ON pt.student_id = sp.id AND pt.tenant_id = sp.tenant_id
        LEFT JOIN student_enrollments se ON pt.enrollment_id = se.id AND pt.tenant_id = se.tenant_id
        LEFT JOIN student_tuition_installments sti ON pt.tuition_installment_id = sti.id AND pt.tenant_id = sti.tenant_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY pt.fee_type
      `;

      const feeTypeResult = await client.query(feeTypeQuery, params);
      const byFeeType: Record<string, any> = {};

      feeTypeResult.rows.forEach(row => {
        const collected = parseFloat(row.collected);
        const pending = parseFloat(row.pending);
        const overdue = parseFloat(row.overdue);
        
        byFeeType[row.fee_type] = {
          total: collected + pending,
          collected,
          pending,
          overdue,
        };
      });

      // Get revenue by payment method
      const paymentMethodQuery = `
        SELECT 
          pt.payment_method,
          COALESCE(SUM(pt.amount), 0) as total_amount
        FROM payment_transactions pt
        JOIN student_profiles sp ON pt.student_id = sp.id AND pt.tenant_id = sp.tenant_id
        LEFT JOIN student_enrollments se ON pt.enrollment_id = se.id AND pt.tenant_id = se.tenant_id
        WHERE pt.status = 'completed' AND ${conditions.join(' AND ')}
        GROUP BY pt.payment_method
      `;

      const paymentMethodResult = await client.query(paymentMethodQuery, params);
      const byPaymentMethod: Record<string, number> = {};

      paymentMethodResult.rows.forEach(row => {
        byPaymentMethod[row.payment_method] = parseFloat(row.total_amount);
      });

      // Get monthly trends
      const monthlyQuery = `
        SELECT 
          TO_CHAR(COALESCE(pt.processed_at, pt.created_at), 'YYYY-MM') as month,
          COALESCE(SUM(pt.amount), 0) as revenue,
          COUNT(*) as transactions
        FROM payment_transactions pt
        JOIN student_profiles sp ON pt.student_id = sp.id AND pt.tenant_id = sp.tenant_id
        LEFT JOIN student_enrollments se ON pt.enrollment_id = se.id AND pt.tenant_id = se.tenant_id
        WHERE pt.status = 'completed' 
        AND COALESCE(pt.processed_at, pt.created_at) >= CURRENT_DATE - INTERVAL '12 months'
        AND ${conditions.join(' AND ')}
        GROUP BY TO_CHAR(COALESCE(pt.processed_at, pt.created_at), 'YYYY-MM')
        ORDER BY month
      `;

      const monthlyResult = await client.query(monthlyQuery, params);
      const monthlyTrends = monthlyResult.rows.map(row => ({
        month: row.month,
        revenue: parseFloat(row.revenue),
        transactions: parseInt(row.transactions),
      }));

      // Module Professionnel (feature 028) — agrégation additive des paiements pro.
      const professional = await this.queryProfessionalRevenue(client, filters);

      return {
        totalRevenue,
        totalOutstanding,
        collectionRate,
        byFeeType,
        byPaymentMethod,
        monthlyTrends,
        professional,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Agrège les revenus du Module Professionnel (feature 028) à partir des
   * paiements `professional_payments` confirmés. Strictement additif — n'altère
   * aucune requête du reporting académique existant.
   */
  private async queryProfessionalRevenue(
    client: any,
    filters: ReportFilters
  ): Promise<{
    totalRevenue: number;
    byMode: Record<string, number>;
    monthlyTrends: Array<{ month: string; revenue: number; transactions: number }>;
  }> {
    const conditions: string[] = ["pp.tenant_id = $1", "pp.statut = 'confirme'"];
    const params: any[] = [filters.tenantId];
    let i = 2;
    if (filters.fromDate) {
      conditions.push(`COALESCE(pp.paid_at, pp.created_at) >= $${i++}`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`COALESCE(pp.paid_at, pp.created_at) <= $${i++}`);
      params.push(filters.toDate);
    }
    const where = conditions.join(" AND ");

    const totalRes = await client.query(
      `SELECT COALESCE(SUM(pp.montant), 0) AS total
       FROM professional_payments pp WHERE ${where}`,
      params
    );
    const modeRes = await client.query(
      `SELECT pp.mode, COALESCE(SUM(pp.montant), 0) AS total
       FROM professional_payments pp WHERE ${where} GROUP BY pp.mode`,
      params
    );
    const monthlyRes = await client.query(
      `SELECT TO_CHAR(COALESCE(pp.paid_at, pp.created_at), 'YYYY-MM') AS month,
              COALESCE(SUM(pp.montant), 0) AS revenue,
              COUNT(*) AS transactions
       FROM professional_payments pp
       WHERE ${where}
         AND COALESCE(pp.paid_at, pp.created_at) >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY 1 ORDER BY 1`,
      params
    );

    const byMode: Record<string, number> = {};
    modeRes.rows.forEach((r: any) => {
      byMode[r.mode] = parseFloat(r.total);
    });

    return {
      totalRevenue: parseFloat(totalRes.rows[0].total),
      byMode,
      monthlyTrends: monthlyRes.rows.map((r: any) => ({
        month: r.month,
        revenue: parseFloat(r.revenue),
        transactions: parseInt(r.transactions),
      })),
    };
  }

  /** Résumé public des revenus du Module Professionnel (ouvre sa propre connexion). */
  async getProfessionalRevenueSummary(filters: ReportFilters) {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [filters.tenantId]);
      return await this.queryProfessionalRevenue(client, filters);
    } finally {
      client.release();
    }
  }

  /**
   * Generate student payment report
   */
  async generateStudentPaymentReport(filters: ReportFilters): Promise<StudentPaymentReport[]> {
    const client = await this.pool.connect();
    
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [filters.tenantId]);

      // Build WHERE conditions for student query (different from payment transactions)
      const studentConditions: string[] = [];
      const studentParams: any[] = [];
      let paramIndex = 1;

      // Always filter by tenant
      studentConditions.push(`sp.tenant_id = $${paramIndex}`);
      studentParams.push(filters.tenantId);
      paramIndex++;

      if (filters.academicYearId) {
        studentConditions.push(`se.academic_year_id = $${paramIndex}`);
        studentParams.push(filters.academicYearId);
        paramIndex++;
      }

      if (filters.classId) {
        studentConditions.push(`se.class_id = $${paramIndex}`);
        studentParams.push(filters.classId);
        paramIndex++;
      }

      const studentsQuery = `
        SELECT DISTINCT
          sp.id as student_id,
          sp.student_number,
          u.first_name || ' ' || u.last_name as student_name,
          c.name as class_name,
          se.fees
        FROM student_profiles sp
        JOIN users u ON sp.user_id = u.id
        JOIN student_enrollments se ON sp.id = se.student_id AND sp.tenant_id = se.tenant_id
        LEFT JOIN classes c ON se.class_id = c.id AND se.tenant_id = c.tenant_id
        WHERE ${studentConditions.join(' AND ')}
        ORDER BY student_name
      `;

      const studentsResult = await client.query(studentsQuery, studentParams);
      const reports: StudentPaymentReport[] = [];

      for (const student of studentsResult.rows) {
        // Get payment summary for this student
        const paymentSummaryQuery = `
          SELECT 
            COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.amount ELSE 0 END), 0) as total_paid,
            COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') THEN pt.amount ELSE 0 END), 0) as total_outstanding,
            COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') AND sti.due_date < CURRENT_DATE THEN pt.amount ELSE 0 END), 0) as overdue_amount
          FROM payment_transactions pt
          LEFT JOIN student_tuition_installments sti ON pt.tuition_installment_id = sti.id AND pt.tenant_id = sti.tenant_id
          WHERE pt.student_id = $1 AND pt.tenant_id = $2
        `;

        const paymentSummaryResult = await client.query(paymentSummaryQuery, [student.student_id, filters.tenantId]);
        const summary = paymentSummaryResult.rows[0];

        // Get payment history
        const paymentHistoryQuery = `
          SELECT 
            COALESCE(pt.processed_at, pt.created_at) as date,
            pt.fee_type,
            pt.amount,
            pt.payment_method
          FROM payment_transactions pt
          WHERE pt.student_id = $1 AND pt.tenant_id = $2 AND pt.status = 'completed'
          ORDER BY COALESCE(pt.processed_at, pt.created_at) DESC
          LIMIT 10
        `;

        const paymentHistoryResult = await client.query(paymentHistoryQuery, [student.student_id, filters.tenantId]);

        const totalFees = parseFloat(student.fees?.total || 0);
        const totalPaid = parseFloat(summary.total_paid);
        const totalOutstanding = parseFloat(summary.total_outstanding);
        const overdueAmount = parseFloat(summary.overdue_amount);

        reports.push({
          studentId: student.student_id,
          studentName: student.student_name,
          studentNumber: student.student_number,
          className: student.class_name,
          totalFees,
          totalPaid,
          totalOutstanding,
          overdueAmount,
          paymentHistory: paymentHistoryResult.rows.map(row => ({
            date: new Date(row.date),
            feeType: row.fee_type,
            amount: parseFloat(row.amount),
            paymentMethod: row.payment_method,
          })),
        });
      }

      return reports;
    } finally {
      client.release();
    }
  }

  /**
   * Generate class payment report
   */
  async generateClassPaymentReport(filters: ReportFilters): Promise<ClassPaymentReport[]> {
    const client = await this.pool.connect();
    
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [filters.tenantId]);

      // Build WHERE conditions for class query
      const classConditions: string[] = [];
      const classParams: any[] = [];
      let paramIndex = 1;

      // Always filter by tenant
      classConditions.push(`c.tenant_id = $${paramIndex}`);
      classParams.push(filters.tenantId);
      paramIndex++;

      if (filters.academicYearId) {
        classConditions.push(`se.academic_year_id = $${paramIndex}`);
        classParams.push(filters.academicYearId);
        paramIndex++;
      }

      if (filters.feeType) {
        classConditions.push(`pt.fee_type = $${paramIndex}`);
        classParams.push(filters.feeType);
        paramIndex++;
      }

      if (filters.fromDate) {
        classConditions.push(`pt.created_at >= $${paramIndex}`);
        classParams.push(filters.fromDate);
        paramIndex++;
      }

      if (filters.toDate) {
        classConditions.push(`pt.created_at <= $${paramIndex}`);
        classParams.push(filters.toDate);
        paramIndex++;
      }

      const classQuery = `
        SELECT 
          c.id as class_id,
          c.name as class_name,
          COUNT(DISTINCT sp.id) as total_students,
          COALESCE(SUM((se.fees->>'total')::numeric), 0) as total_fees,
          COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.amount ELSE 0 END), 0) as total_collected,
          COUNT(DISTINCT CASE WHEN sti.status IN ('pending', 'partial') AND sti.due_date < CURRENT_DATE THEN sp.id END) as students_with_overdue,
          AVG(CASE WHEN pt.status = 'completed' AND pt.processed_at IS NOT NULL 
            THEN EXTRACT(DAY FROM (COALESCE(pt.processed_at, pt.created_at) - pt.created_at)) 
            ELSE NULL END) as avg_payment_time
        FROM classes c
        JOIN student_enrollments se ON c.id = se.class_id AND c.tenant_id = se.tenant_id
        JOIN student_profiles sp ON se.student_id = sp.id AND se.tenant_id = sp.tenant_id
        LEFT JOIN payment_transactions pt ON sp.id = pt.student_id AND sp.tenant_id = pt.tenant_id
        LEFT JOIN student_tuition_installments sti ON sp.id = sti.student_id AND sp.tenant_id = sti.tenant_id
        WHERE ${classConditions.join(' AND ')}
        GROUP BY c.id, c.name
        ORDER BY c.name
      `;

      const classResult = await client.query(classQuery, classParams);

      return classResult.rows.map(row => {
        const totalFees = parseFloat(row.total_fees);
        const totalCollected = parseFloat(row.total_collected);
        const collectionRate = totalFees > 0 ? (totalCollected / totalFees) * 100 : 0;

        return {
          classId: row.class_id,
          className: row.class_name,
          totalStudents: parseInt(row.total_students),
          totalFees,
          totalCollected,
          collectionRate,
          studentsWithOverdue: parseInt(row.students_with_overdue),
          averagePaymentTime: parseFloat(row.avg_payment_time) || 0,
        };
      });
    } finally {
      client.release();
    }
  }

  /**
   * Generate payment method analysis report
   */
  async generatePaymentMethodReport(filters: ReportFilters): Promise<PaymentMethodReport[]> {
    const client = await this.pool.connect();
    
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [filters.tenantId]);

      const whereConditions = this.buildWhereConditions(filters);
      const { conditions, params } = whereConditions;

      const methodQuery = `
        SELECT 
          pt.payment_method,
          COUNT(*) as transaction_count,
          COALESCE(SUM(pt.amount), 0) as total_amount,
          COALESCE(AVG(pt.amount), 0) as average_amount,
          (COUNT(CASE WHEN pt.status = 'completed' THEN 1 END)::float / COUNT(*)::float * 100) as success_rate
        FROM payment_transactions pt
        JOIN student_profiles sp ON pt.student_id = sp.id
        JOIN student_enrollments se ON pt.enrollment_id = se.id
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        GROUP BY pt.payment_method
        ORDER BY total_amount DESC
      `;

      const methodResult = await client.query(methodQuery, params);
      const reports: PaymentMethodReport[] = [];

      for (const method of methodResult.rows) {
        // Get monthly trends for this payment method
        const trendsQuery = `
          SELECT 
            TO_CHAR(pt.processed_at, 'YYYY-MM') as month,
            COALESCE(SUM(pt.amount), 0) as amount,
            COUNT(*) as count
          FROM payment_transactions pt
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN student_enrollments se ON pt.enrollment_id = se.id
          WHERE pt.payment_method = $${params.length + 1}
          AND pt.status = 'completed'
          AND pt.processed_at >= CURRENT_DATE - INTERVAL '12 months'
          ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
          GROUP BY TO_CHAR(pt.processed_at, 'YYYY-MM')
          ORDER BY month
        `;

        const trendsResult = await client.query(trendsQuery, [...params, method.payment_method]);

        reports.push({
          paymentMethod: method.payment_method,
          transactionCount: parseInt(method.transaction_count),
          totalAmount: parseFloat(method.total_amount),
          averageAmount: parseFloat(method.average_amount),
          successRate: parseFloat(method.success_rate),
          monthlyTrends: trendsResult.rows.map(row => ({
            month: row.month,
            amount: parseFloat(row.amount),
            count: parseInt(row.count),
          })),
        });
      }

      return reports;
    } finally {
      client.release();
    }
  }

  /**
   * Build WHERE conditions for queries
   */
  private buildWhereConditions(filters: ReportFilters): { conditions: string[]; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Always filter by tenant (use pt.tenant_id as it's the main table)
    conditions.push(`pt.tenant_id = $${paramIndex}`);
    params.push(filters.tenantId);
    paramIndex++;

    if (filters.academicYearId) {
      conditions.push(`se.academic_year_id = $${paramIndex}`);
      params.push(filters.academicYearId);
      paramIndex++;
    }

    if (filters.classId) {
      conditions.push(`se.class_id = $${paramIndex}`);
      params.push(filters.classId);
      paramIndex++;
    }

    if (filters.feeType) {
      conditions.push(`pt.fee_type = $${paramIndex}`);
      params.push(filters.feeType);
      paramIndex++;
    }

    if (filters.fromDate) {
      conditions.push(`pt.created_at >= $${paramIndex}`);
      params.push(filters.fromDate);
      paramIndex++;
    }

    if (filters.toDate) {
      conditions.push(`pt.created_at <= $${paramIndex}`);
      params.push(filters.toDate);
      paramIndex++;
    }

    return { conditions, params };
  }
}

/**
 * Factory function to create financial reports service
 */
export function createFinancialReportsService(pool: Pool): FinancialReportsService {
  return new FinancialReportsService(pool);
}
