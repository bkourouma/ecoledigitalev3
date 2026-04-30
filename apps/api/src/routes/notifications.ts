import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createNotificationService } from "../services/notification.service";

export async function notificationsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;
  const notificationService = createNotificationService(pool);

  // POST /api/v1/notifications/payment-reminder - Send payment reminder to specific student
  fastify.post("/payment-reminder", {
    schema: {
      body: {
        type: "object",
        required: ["studentId", "feeType", "amount"],
        properties: {
          studentId: { type: "string", format: "uuid" },
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          amount: { type: "number", minimum: 0 },
          dueDate: { type: "string", format: "date" },
          sendVia: { type: "string", enum: ["email", "sms", "both"], default: "email" },
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

      const { studentId, feeType, amount, dueDate, sendVia = "email" } = request.body as any;
      const client = await pool.connect();

      try {
        await client.query("SET app.tenant_id = $1", [request.tenantId]);

        // Get student and tenant information
        const studentQuery = `
          SELECT 
            sp.id as student_id,
            u.first_name || ' ' || u.last_name as student_name,
            u.email,
            sp.phone,
            t.name as institution_name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          JOIN tenants t ON sp.tenant_id = t.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `;

        const studentResult = await client.query(studentQuery, [studentId, request.tenantId]);

        if (studentResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Student not found",
          });
        }

        const student = studentResult.rows[0];

        // Send notification
        const result = await notificationService.sendPaymentReminder(
          studentId,
          request.tenantId,
          {
            studentName: student.student_name,
            studentEmail: student.email,
            studentPhone: student.phone,
            feeType,
            amount,
            currency: "XOF",
            dueDate: dueDate ? new Date(dueDate) : undefined,
            institutionName: student.institution_name,
            paymentUrl: `${process.env.APP_BASE_URL}/student-payments`,
          },
          sendVia as any
        );

        return reply.send({
          data: {
            success: result.success,
            emailSent: result.emailSent,
            smsSent: result.smsSent,
            errors: result.errors,
          },
        });
      } catch (error) {
        console.error("Error sending payment reminder:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to send payment reminder",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/notifications/bulk-reminders - Send bulk payment reminders
  fastify.post("/bulk-reminders", {
    schema: {
      body: {
        type: "object",
        required: ["reminderType"],
        properties: {
          studentIds: {
            type: "array",
            items: { type: "string", format: "uuid" }
          },
          feeType: {
            type: "string",
            enum: ["inscription", "scolarite", "annexes", "autres"]
          },
          reminderType: {
            type: "string",
            enum: ["upcoming", "overdue"]
          },
          sendVia: {
            type: "string",
            enum: ["email", "sms", "both"],
            default: "email"
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

      const { studentIds, feeType, reminderType, sendVia = "email" } = request.body as any;
      const client = await pool.connect();

      try {
        await client.query("SET app.tenant_id = $1", [request.tenantId]);

        let studentsQuery: string;
        let queryParams: any[];

        if (studentIds && studentIds.length > 0) {
          // Send to specific students
          studentsQuery = `
            SELECT 
              sp.id as student_id,
              u.first_name || ' ' || u.last_name as student_name,
              u.email,
              sp.phone,
              t.name as institution_name,
              sti.amount,
              sti.due_date,
              sti.status
            FROM student_profiles sp
            JOIN users u ON sp.user_id = u.id
            JOIN tenants t ON sp.tenant_id = t.id
            LEFT JOIN student_tuition_installments sti ON sp.id = sti.student_id
            WHERE sp.id = ANY($1) AND sp.tenant_id = $2
            ${feeType ? "AND sti.fee_type = $3" : ""}
          `;
          queryParams = [studentIds, request.tenantId];
          if (feeType) queryParams.push(feeType);
        } else {
          // Send to all students with overdue payments
          if (reminderType === "overdue") {
            studentsQuery = `
              SELECT DISTINCT
                sp.id as student_id,
                u.first_name || ' ' || u.last_name as student_name,
                u.email,
                sp.phone,
                t.name as institution_name,
                sti.amount,
                sti.due_date,
                sti.status
              FROM student_profiles sp
              JOIN users u ON sp.user_id = u.id
              JOIN tenants t ON sp.tenant_id = t.id
              JOIN student_tuition_installments sti ON sp.id = sti.student_id
              WHERE sp.tenant_id = $1 
              AND sti.status IN ('pending', 'partial')
              AND sti.due_date < CURRENT_DATE
              ${feeType ? "AND sti.fee_type = $2" : ""}
            `;
            queryParams = [request.tenantId];
            if (feeType) queryParams.push(feeType);
          } else {
            // Send to students with upcoming payments
            studentsQuery = `
              SELECT DISTINCT
                sp.id as student_id,
                u.first_name || ' ' || u.last_name as student_name,
                u.email,
                sp.phone,
                t.name as institution_name,
                sti.amount,
                sti.due_date,
                sti.status
              FROM student_profiles sp
              JOIN users u ON sp.user_id = u.id
              JOIN tenants t ON sp.tenant_id = t.id
              JOIN student_tuition_installments sti ON sp.id = sti.student_id
              WHERE sp.tenant_id = $1 
              AND sti.status IN ('pending', 'partial')
              AND sti.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
              ${feeType ? "AND sti.fee_type = $2" : ""}
            `;
            queryParams = [request.tenantId];
            if (feeType) queryParams.push(feeType);
          }
        }

        const studentsResult = await client.query(studentsQuery, queryParams);

        if (studentsResult.rows.length === 0) {
          return reply.send({
            data: {
              totalStudents: 0,
              successCount: 0,
              failureCount: 0,
              results: [],
            },
          });
        }

        // Send notifications to each student
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const student of studentsResult.rows) {
          try {
            const result = await notificationService.sendPaymentReminder(
              student.student_id,
              request.tenantId,
              {
                studentName: student.student_name,
                studentEmail: student.email,
                studentPhone: student.phone,
                feeType: feeType || "scolarite",
                amount: parseFloat(student.amount || 0),
                currency: "XOF",
                dueDate: student.due_date ? new Date(student.due_date) : undefined,
                institutionName: student.institution_name,
                paymentUrl: `${process.env.APP_BASE_URL}/student-payments`,
              },
              sendVia as any
            );

            results.push({
              studentId: student.student_id,
              studentName: student.student_name,
              success: result.success,
              emailSent: result.emailSent,
              smsSent: result.smsSent,
              errors: result.errors,
            });

            if (result.success) {
              successCount++;
            } else {
              failureCount++;
            }
          } catch (error) {
            results.push({
              studentId: student.student_id,
              studentName: student.student_name,
              success: false,
              errors: [`Failed to send: ${error instanceof Error ? error.message : 'Unknown error'}`],
            });
            failureCount++;
          }

          // Add small delay between notifications to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        return reply.send({
          data: {
            totalStudents: studentsResult.rows.length,
            successCount,
            failureCount,
            results,
          },
        });
      } catch (error) {
        console.error("Error sending bulk reminders:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to send bulk reminders",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/notifications/history/:studentId - Get notification history for student
  fastify.get("/history/:studentId", {
    schema: {
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
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

      const { studentId } = request.params as { studentId: string };
      const { limit = 20, offset = 0 } = request.query as any;
      const client = await pool.connect();

      try {
        await client.query("SET app.tenant_id = $1", [request.tenantId]);

        const notificationsQuery = `
          SELECT *
          FROM payment_notifications
          WHERE student_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC
          LIMIT $3 OFFSET $4
        `;

        const notificationsResult = await client.query(notificationsQuery, [
          studentId,
          request.tenantId,
          limit,
          offset,
        ]);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM payment_notifications
          WHERE student_id = $1 AND tenant_id = $2
        `;

        const countResult = await client.query(countQuery, [studentId, request.tenantId]);

        const notifications = notificationsResult.rows.map(row => ({
          id: row.id,
          notificationType: row.notification_type,
          feeType: row.fee_type,
          sentTo: row.sent_to,
          sentVia: row.sent_via,
          status: row.status,
          sentAt: row.sent_at,
          createdAt: row.created_at,
        }));

        return reply.send({
          data: notifications,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + limit < parseInt(countResult.rows[0].total),
          },
        });
      } catch (error) {
        console.error("Error fetching notification history:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch notification history",
        });
      } finally {
        client.release();
      }
    },
  });
}
