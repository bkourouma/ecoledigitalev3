import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createFinancialReportsService } from "../services/financial-reports.service";
import {
  PaymentReportQuerySchema,
} from "@ecoledigitale/contracts";

export async function financialReportsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;
  const reportsService = createFinancialReportsService(pool);

  // GET /api/v1/financial-reports/revenue - Generate revenue report
  fastify.get("/revenue", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const {
        academicYearId,
        classId,
        feeType,
        fromDate,
        toDate,
      } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      try {
        const report = await reportsService.generateRevenueReport({
          tenantId: request.tenantId,
          academicYearId: effectiveAcademicYearId,
          classId,
          feeType,
          fromDate: fromDate ? new Date(fromDate) : undefined,
          toDate: toDate ? new Date(toDate) : undefined,
        });

        return reply.send({
          data: report,
          generatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error generating revenue report:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("Error details:", { errorMessage, errorStack });
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to generate revenue report",
          ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/financial-reports/students - Generate student payment report
  fastify.get("/students", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
          includeDetails: { type: "boolean", default: false },
          limit: { type: "number", minimum: 1, maximum: 1000, default: 100 },
          offset: { type: "number", minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const {
        academicYearId,
        classId,
        feeType,
        fromDate,
        toDate,
        includeDetails = false,
        limit = 100,
        offset = 0,
      } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      try {
        const allReports = await reportsService.generateStudentPaymentReport({
          tenantId: request.tenantId,
          academicYearId: effectiveAcademicYearId,
          classId,
          feeType,
          fromDate: fromDate ? new Date(fromDate) : undefined,
          toDate: toDate ? new Date(toDate) : undefined,
          includeDetails,
        });

        // Apply pagination
        const paginatedReports = allReports.slice(offset, offset + limit);

        // Remove payment history if details not requested
        if (!includeDetails) {
          paginatedReports.forEach(report => {
            delete (report as any).paymentHistory;
          });
        }

        return reply.send({
          data: paginatedReports,
          pagination: {
            total: allReports.length,
            limit,
            offset,
            hasMore: offset + limit < allReports.length,
          },
          generatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error generating student payment report:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("Error details:", { errorMessage, errorStack });
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to generate student payment report",
          ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/financial-reports/classes - Generate class payment report
  fastify.get("/classes", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const {
        academicYearId,
        feeType,
        fromDate,
        toDate,
      } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      try {
        const report = await reportsService.generateClassPaymentReport({
          tenantId: request.tenantId,
          academicYearId: effectiveAcademicYearId,
          feeType,
          fromDate: fromDate ? new Date(fromDate) : undefined,
          toDate: toDate ? new Date(toDate) : undefined,
        });

        return reply.send({
          data: report,
          generatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error generating class payment report:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("Error details:", { errorMessage, errorStack });
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to generate class payment report",
          ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/financial-reports/payment-methods - Generate payment method analysis
  fastify.get("/payment-methods", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const {
        academicYearId,
        classId,
        feeType,
        fromDate,
        toDate,
      } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      try {
        const report = await reportsService.generatePaymentMethodReport({
          tenantId: request.tenantId,
          academicYearId: effectiveAcademicYearId,
          classId,
          feeType,
          fromDate: fromDate ? new Date(fromDate) : undefined,
          toDate: toDate ? new Date(toDate) : undefined,
        });

        return reply.send({
          data: report,
          generatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error generating payment method report:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to generate payment method report",
        });
      }
    },
  });

  // GET /api/v1/financial-reports/dashboard - Generate dashboard summary
  fastify.get("/dashboard", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          period: { type: "string", enum: ["current_month", "last_month", "current_year", "last_year"], default: "current_month" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { academicYearId, period = "current_month" } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      try {
        // Calculate date range based on period
        let fromDate: Date;
        let toDate: Date;
        const now = new Date();

        switch (period) {
          case "current_month":
            fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
            toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
          case "last_month":
            fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            toDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
          case "current_year":
            fromDate = new Date(now.getFullYear(), 0, 1);
            toDate = new Date(now.getFullYear(), 11, 31);
            break;
          case "last_year":
            fromDate = new Date(now.getFullYear() - 1, 0, 1);
            toDate = new Date(now.getFullYear() - 1, 11, 31);
            break;
          default:
            fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
            toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }

        // Generate comprehensive dashboard data with error handling for each part
        let revenueReport: any = {
          totalRevenue: 0,
          totalOutstanding: 0,
          collectionRate: 0,
          byFeeType: {},
          byPaymentMethod: {},
          monthlyTrends: [],
        };
        let classReports: any[] = [];
        let paymentMethodReports: any[] = [];

        try {
          revenueReport = await reportsService.generateRevenueReport({
            tenantId: request.tenantId,
            academicYearId: effectiveAcademicYearId,
            fromDate,
            toDate,
          });
        } catch (error) {
          console.error("Error generating revenue report:", error);
          // Continue with default values
        }

        try {
          classReports = await reportsService.generateClassPaymentReport({
            tenantId: request.tenantId,
            academicYearId: effectiveAcademicYearId,
            fromDate,
            toDate,
          });
        } catch (error) {
          console.error("Error generating class payment report:", error);
          // Continue with empty array
        }

        try {
          paymentMethodReports = await reportsService.generatePaymentMethodReport({
            tenantId: request.tenantId,
            academicYearId: effectiveAcademicYearId,
            fromDate,
            toDate,
          });
        } catch (error) {
          console.error("Error generating payment method report:", error);
          // Continue with empty array
        }

        // Calculate additional metrics
        const totalStudents = classReports.reduce((sum, cls) => sum + (cls.totalStudents || 0), 0);
        const studentsWithOverdue = classReports.reduce((sum, cls) => sum + (cls.studentsWithOverdue || 0), 0);
        const averageCollectionRate = classReports.length > 0 
          ? classReports.reduce((sum, cls) => sum + (cls.collectionRate || 0), 0) / classReports.length 
          : 0;

        const dashboardData = {
          period,
          dateRange: { fromDate, toDate },
          summary: {
            totalStudents,
            totalRevenue: revenueReport.totalRevenue || 0,
            totalOutstanding: revenueReport.totalOutstanding || 0,
            collectionRate: revenueReport.collectionRate || 0,
            studentsWithOverdue,
            overdueRate: totalStudents > 0 ? (studentsWithOverdue / totalStudents) * 100 : 0,
          },
          revenueByFeeType: revenueReport.byFeeType || {},
          revenueByPaymentMethod: revenueReport.byPaymentMethod || {},
          monthlyTrends: revenueReport.monthlyTrends || [],
          classPerformance: classReports.slice(0, 10), // Top 10 classes
          paymentMethodAnalysis: paymentMethodReports,
          topPerformingClasses: classReports
            .sort((a, b) => (b.collectionRate || 0) - (a.collectionRate || 0))
            .slice(0, 5),
          classesNeedingAttention: classReports
            .filter(cls => (cls.collectionRate || 0) < 70 || (cls.studentsWithOverdue || 0) > 0)
            .sort((a, b) => (a.collectionRate || 0) - (b.collectionRate || 0))
            .slice(0, 5),
        };

        return reply.send({
          data: dashboardData,
          generatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error generating dashboard report:", error);
        console.error("Error details:", error instanceof Error ? error.stack : error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Failed to generate dashboard report",
        });
      }
    },
  });

  // POST /api/v1/financial-reports/export - Export report to CSV/Excel
  fastify.post("/export", {
    schema: {
      body: {
        type: "object",
        required: ["reportType", "format"],
        properties: {
          reportType: { type: "string", enum: ["revenue", "students", "classes", "payment_methods"] },
          format: { type: "string", enum: ["csv", "excel"] },
          filters: {
            type: "object",
            properties: {
              academicYearId: { type: "string", format: "uuid" },
              classId: { type: "string", format: "uuid" },
              feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
              fromDate: { type: "string", format: "date" },
              toDate: { type: "string", format: "date" },
              includeDetails: { type: "boolean", default: false },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { reportType, format, filters = {} } = request.body as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      try {
        // Generate the requested report
        let reportData: any;
        const reportFilters = {
          tenantId: request.tenantId,
          ...filters,
          academicYearId: filters.academicYearId || activeAcademicYearId,
          fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
          toDate: filters.toDate ? new Date(filters.toDate) : undefined,
        };

        switch (reportType) {
          case "revenue":
            reportData = await reportsService.generateRevenueReport(reportFilters);
            break;
          case "students":
            reportData = await reportsService.generateStudentPaymentReport(reportFilters);
            break;
          case "classes":
            reportData = await reportsService.generateClassPaymentReport(reportFilters);
            break;
          case "payment_methods":
            reportData = await reportsService.generatePaymentMethodReport(reportFilters);
            break;
          default:
            return reply.status(400).send({
              error: "Invalid Report Type",
              message: "Unsupported report type",
            });
        }

        // In a real implementation, you would:
        // 1. Convert the data to CSV/Excel format
        // 2. Save the file to a temporary location
        // 3. Return a download URL
        
        // For now, return a mock response
        const fileName = `${reportType}_report_${Date.now()}.${format}`;
        const downloadUrl = `/api/v1/files/exports/${fileName}`;

        return reply.send({
          data: {
            fileName,
            downloadUrl,
            recordCount: Array.isArray(reportData) ? reportData.length : 1,
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        });
      } catch (error) {
        console.error("Error exporting report:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to export report",
        });
      }
    },
  });
}
