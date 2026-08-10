import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import postgres from "@fastify/postgres";
import multipart from "@fastify/multipart";
import rlsContextPlugin from "./plugins/rls-context";
import { tenantContextPlugin } from "./plugins/tenant-context";
import authMiddleware from "./plugins/auth-middleware";
import superAdminAuditPlugin from "./plugins/super-admin-audit";
import { healthRoutes } from "./routes/health";
import { dbTestRoutes } from "./routes/db-test";
import { authRoutes } from "./routes/auth";
import { superAdminAuthRoutes } from "./routes/super-admin-auth";
import { superAdminTenantsRoutes } from "./routes/super-admin-tenants";
import { superAdminRolesRoutes } from "./routes/super-admin-roles";
import { cyclesRoutes } from "./routes/cycles";
import { programmesRoutes } from "./routes/programmes";
import { coursesRoutes } from "./routes/courses";
import { teachersRoutes } from "./routes/teachers";
import { studentsRoutes } from "./routes/students";
import { usersRoutes } from "./routes/users";
import { teacherAssignmentsRoutes } from "./routes/teacher-assignments";
import { teacherCorrectionsRoutes } from "./routes/teacher-corrections";

import { academicYearsRoutes } from "./routes/academic-years";
import { semesterAveragesRoutes } from "./routes/semester-averages";
import { academicCalendarEventsRoutes } from "./routes/academic-calendar-events";
import { examSchedulesRoutes } from "./routes/exam-schedules";
import { reportCardsRoutes } from "./routes/report-cards";
import { bilanTypesRoutes } from "./routes/bilan-types";
import { transcriptsRoutes } from "./routes/transcripts";
import { attendanceReportsRoutes } from "./routes/attendance-reports";
import { classesRoutes } from "./routes/classes";
import classCourseRoutes from "./routes/class-courses";
import { enrollmentsRoutes } from "./routes/enrollments";
import { attendanceRoutes } from "./routes/attendance";
import { materialsRoutes } from "./routes/materials";
import { filesRoutes } from "./routes/files";
import { assignmentsRoutes } from "./routes/assignments";
import { evaluationQuestionsRoutes } from "./routes/evaluation-questions";
import { submissionsRoutes } from "./routes/submissions";
import { aiEvaluationsRoutes } from "./routes/ai-evaluations";
import { paymentPeriodsRoutes } from "./routes/payment-periods";
import simplePaymentPeriodsRoutes from "./routes/simple-payment-periods";
import { teacherPaymentConfigsRoutes } from "./routes/teacher-payment-configs";
import { teacherPaymentsRoutes } from "./routes/teacher-payments";
import { courseHourlyRatesRoutes } from "./routes/course-hourly-rates";
import { paymentReportsRoutes } from "./routes/payment-reports";
import { teachingHoursRoutes } from "./routes/teaching-hours";
import { courseAssignmentsRoutes } from "./routes/course-assignments";
import { teachingHoursBatchRoutes } from "./routes/teaching-hours-batch";
import { studentPaymentsRoutes } from "./routes/student-payments";
import { tuitionSchedulesRoutes } from "./routes/tuition-schedules";
import { receiptsRoutes } from "./routes/receipts";
import { notificationsRoutes } from "./routes/notifications";
import { financialReportsRoutes } from "./routes/financial-reports";
import { scheduleGenerationRoutes } from "./routes/schedule-generation";
import { simpleScheduleRoutes } from "./routes/simple-schedule";
import { cycleFeesRoutes } from "./routes/cycle-fees";
import { classroomsRoutes } from "./routes/classrooms";
import { sessionsRoutes } from "./routes/sessions";
import { classroomReservationsRoutes } from "./routes/classroom-reservations";

// Student-specific routes
import { studentCoursesRoutes } from "./routes/student-courses";
import { studentAssignmentsRoutes } from "./routes/student-assignments";
import { studentGradesRoutes } from "./routes/student-grades";
import { studentMessagesRoutes } from "./routes/student-messages";
import { teacherCoursesRoutes } from "./routes/teacher-courses";
import { teacherAttendanceRoutes } from "./routes/teacher-attendance";
import { teacherStudentsRoutes } from "./routes/teacher-students";
import { teacherMessagesRoutes } from "./routes/teacher-messages";
import { teacherConversationsRoutes } from "./routes/teacher-conversations";

// Parent-specific routes
import { parentChildrenRoutes } from "./routes/parent-children";
import { parentHomeworkRoutes } from "./routes/parent-homework";
import { parentGradesRoutes } from "./routes/parent-grades";
import { parentPaymentsRoutes } from "./routes/parent-payments";
import { parentMessagesRoutes } from "./routes/parent-messages";
import { parentSettingsRoutes } from "./routes/parent-settings";
import { parentAcademicRoutes } from "./routes/parent-academic";
import { parentDocumentsRoutes } from "./routes/parent-documents";
import { parentEmergencyRoutes } from "./routes/parent-emergency";
import { parentsRoutes } from "./routes/parents";
import { adminAnnouncementsRoutes } from "./routes/admin-announcements";
import { adminMessagesRoutes } from "./routes/admin-messages";
import { adminRolesRoutes } from "./routes/admin-roles";
import { registrationRequestsRoutes } from "./routes/registration-requests";
import { formationsProRoutes } from "./routes/formations-pro";
import { sessionsProRoutes } from "./routes/sessions-pro";
import { inscriptionsProRoutes } from "./routes/inscriptions-pro";
import { codesPromoRoutes } from "./routes/codes-promo";
import { paiementsProRoutes } from "./routes/paiements-pro";
import { formateurRoutes } from "./routes/formateur";
import { professionalRoutes } from "./routes/professional";
import { documentsRoutes } from "./routes/documents";
import { entreprisesRoutes } from "./routes/entreprises";
import { exportsRoutes } from "./routes/exports";
import { reportingRoutes } from "./routes/reporting";
import { ownerRoutes } from "./routes/owner";
import { liveSessionsRoutes } from "./routes/live-sessions";
import { livekitWebhookRoutes } from "./routes/webhooks/livekit";
import { notificationsInboxRoutes } from "./routes/notifications-inbox";
import { initializeReservationCleanupJob } from "./jobs/reservation-cleanup.job";
import { rsoActivityRoutes } from "./routes/rso/activities";
import { bootstrapSuperAdmin } from "./services/super-admin-bootstrap.service";
import {
  ensureReferenceTenant,
  syncTechnicalAccountsForAllTenants,
} from "./services/tenant-provisioning.service";

// import { studentDashboardRoutes } from "./routes/student-dashboard";

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
  },
  // find-my-way limite par défaut chaque paramètre d'URL à 100 caractères.
  // Nos noms de fichiers téléversés (sujet d'évaluation / rendu d'étudiant)
  // sont préfixés par un ou deux UUID (36 chars chacun) + nom original
  // → on dépasse facilement la limite et la route remonte un 404.
  // On élève la limite à 1024 pour tenir compte de toute combinaison réaliste.
  maxParamLength: 1024,
});

async function start() {
  try {
    // Register plugins
    await fastify.register(helmet);
    await fastify.register(cors, {
      origin: process.env.NODE_ENV === "production"
        ? ["https://ecoledigitale.engage-360.net"]
        : true,
      credentials: true,
    });

    // Load config
    let dbConnectionString: string = process.env.DATABASE_URL || "";
    
    // If no environment variable, try to load from config file
    if (!dbConnectionString) {
      try {
        const config = require('../config.js');
        dbConnectionString = config.DATABASE_URL || "";
        console.log('📝 Loaded DATABASE_URL from config.js');
      } catch (err) {
        dbConnectionString = "postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale";
        console.log('⚠️  Using default DATABASE_URL');
      }
    }
    
    console.log(`🔗 Connecting to database at: ${dbConnectionString.replace(/:[^:@]+@/, ':***@')}`);
    
    // Register PostgreSQL plugin
    await fastify.register(postgres, {
      connectionString: dbConnectionString,
    });
    await fastify.register(rlsContextPlugin);

    await bootstrapSuperAdmin(fastify);
    const bootstrapClient = await fastify.pg.connect();
    try {
      await ensureReferenceTenant(bootstrapClient);
      await syncTechnicalAccountsForAllTenants(bootstrapClient);
    } finally {
      bootstrapClient.release();
    }

    // Register multipart plugin for file uploads
    await fastify.register(multipart, {
      limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max file size
      },
    });

    // Register routes without auth first
    await fastify.register(dbTestRoutes); // No prefix, no auth required
    await fastify.register(healthRoutes, { prefix: "/api/v1" });

    // Tenant context is needed by public auth/register flows, but does not enforce auth.
    await fastify.register(tenantContextPlugin);
    await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
    await fastify.register(superAdminAuthRoutes, { prefix: "/api/v1/super-admin/auth" });

    // Register auth and audit plugins after public auth routes.
    await fastify.register(authMiddleware);
    await fastify.register(superAdminAuditPlugin);

    // Super-admin routes
    await fastify.register(superAdminTenantsRoutes, { prefix: "/api/v1/super-admin/tenants" });
    await fastify.register(superAdminRolesRoutes, { prefix: "/api/v1/super-admin/roles" });

    // Academic module routes
    await fastify.register(cyclesRoutes, { prefix: "/api/v1/cycles" });
    await fastify.register(programmesRoutes, { prefix: "/api/v1/programmes" });
    await fastify.register(coursesRoutes, { prefix: "/api/v1/courses" });
    await fastify.register(teachersRoutes, { prefix: "/api/v1/teachers" });
    await fastify.register(studentsRoutes, { prefix: "/api/v1/students" });
    await fastify.register(usersRoutes, { prefix: "/api/v1/users" });

    // Academic year management routes
    await fastify.register(academicYearsRoutes, { prefix: "/api/v1/academic-years" });
    await fastify.register(semesterAveragesRoutes, { prefix: "/api/v1/semester-averages" });
    await fastify.register(academicCalendarEventsRoutes, { prefix: "/api/v1/academic-calendar-events" });
    await fastify.register(examSchedulesRoutes, { prefix: "/api/v1/exam-schedules" });
    await fastify.register(reportCardsRoutes, { prefix: "/api/v1/report-cards" });
    await fastify.register(bilanTypesRoutes, { prefix: "/api/v1/bilan-types" });
    await fastify.register(transcriptsRoutes, { prefix: "/api/v1/transcripts" });
    await fastify.register(attendanceReportsRoutes, { prefix: "/api/v1/attendance-reports" });
    await fastify.register(classesRoutes, { prefix: "/api/v1/classes" });
    await fastify.register(classCourseRoutes, { prefix: "/api/v1/class-courses" });
    await fastify.register(enrollmentsRoutes, { prefix: "/api/v1/enrollments" });
    await fastify.register(teacherAssignmentsRoutes, { prefix: "/api/v1/teacher-assignments" });
    await fastify.register(teacherCorrectionsRoutes, { prefix: "/api/v1/teacher" });

    // Attendance management routes
    await fastify.register(attendanceRoutes, { prefix: "/api/v1/attendance" });

    // Course materials routes
    await fastify.register(materialsRoutes, { prefix: "/api/v1/courses" });

    // File upload and serving routes
    await fastify.register(filesRoutes, { prefix: "/api/v1/files" });

    // Evaluations and assignments routes
    await fastify.register(assignmentsRoutes, { prefix: "/api/v1/assignments" });
    await fastify.register(evaluationQuestionsRoutes, { prefix: "/api/v1/assignments" });
    await fastify.register(submissionsRoutes, { prefix: "/api/v1/assignments" });
    const { assignmentInstancesRoutes } = await import("./routes/assignment-instances");
    await fastify.register(assignmentInstancesRoutes, { prefix: "/api/v1/assignment-instances" });

    // AI evaluations routes
    await fastify.register(aiEvaluationsRoutes, { prefix: "/api/v1/ai-evaluations" });

    // Payment management routes
    await fastify.register(paymentPeriodsRoutes, { prefix: "/api/v1/payment-periods" });
    await fastify.register(simplePaymentPeriodsRoutes, { prefix: "/api/v1/simple-payment-periods" });
    await fastify.register(teacherPaymentConfigsRoutes, { prefix: "/api/v1/teacher-payment-configs" });
    await fastify.register(teacherPaymentsRoutes, { prefix: "/api/v1/teacher-payments" });
    await fastify.register(courseHourlyRatesRoutes, { prefix: "/api/v1/course-hourly-rates" });
    await fastify.register(paymentReportsRoutes, { prefix: "/api/v1/payment-reports" });
    await fastify.register(cycleFeesRoutes, { prefix: "/api/v1/cycle-fees" });
    await fastify.register(teachingHoursRoutes, { prefix: "/api/v1/teaching-hours" });
    await fastify.register(courseAssignmentsRoutes, { prefix: "/api/v1/course-assignments" });
    await fastify.register(teachingHoursBatchRoutes, { prefix: "/api/v1/teaching-hours" });

    // Student payment management routes
    await fastify.register(studentPaymentsRoutes, { prefix: "/api/v1/student-payments" });
    await fastify.register(tuitionSchedulesRoutes, { prefix: "/api/v1/tuition-schedules" });
    await fastify.register(receiptsRoutes, { prefix: "/api/v1/receipts" });
    await fastify.register(notificationsRoutes, { prefix: "/api/v1/notifications" });
    await fastify.register(financialReportsRoutes, { prefix: "/api/v1/financial-reports" });

    // Classroom management routes
    await fastify.register(classroomsRoutes, { prefix: "/api/v1/classrooms" });
    await fastify.register(classroomReservationsRoutes, { prefix: "/api/v1/classroom-reservations" });

    // Teacher sessions routes (calendar CRUD)
    await fastify.register(sessionsRoutes, { prefix: "/api/v1/sessions" });

    // Schedule generation routes
    await fastify.register(scheduleGenerationRoutes, { prefix: "/api/v1/schedule-generation" });
    await fastify.register(simpleScheduleRoutes, { prefix: "/api/v1/simple-schedule" });

    // Student-specific routes
    await fastify.register(studentCoursesRoutes, { prefix: "/api/v1/student/courses" });
    await fastify.register(studentAssignmentsRoutes, { prefix: "/api/v1/student/assignments" });
    await fastify.register(studentGradesRoutes, { prefix: "/api/v1/student/grades" });
    await fastify.register(studentMessagesRoutes, { prefix: "/api/v1/student/messages" });

    // Teacher-specific routes
    await fastify.register(teacherCoursesRoutes, { prefix: "/api/v1/teacher" });
    await fastify.register(teacherAssignmentsRoutes, { prefix: "/api/v1/teacher/assignments" });
    await fastify.register(teacherAttendanceRoutes, { prefix: "/api/v1/teacher/attendance" });
    await fastify.register(teacherStudentsRoutes, { prefix: "/api/v1/teacher/students" });
    await fastify.register(teacherMessagesRoutes, { prefix: "/api/v1/teacher/messages" });
    await fastify.register(teacherConversationsRoutes, { prefix: "/api/v1/teacher/conversations" });

    // Parent-specific routes
    await fastify.register(parentChildrenRoutes, { prefix: "/api/v1/parent/children" });
    await fastify.register(parentHomeworkRoutes, { prefix: "/api/v1/parent/homework" });
    await fastify.register(parentGradesRoutes, { prefix: "/api/v1/parent/grades" });
    await fastify.register(parentPaymentsRoutes, { prefix: "/api/v1/parent/payments" });
    await fastify.register(parentMessagesRoutes, { prefix: "/api/v1/parent/messages" });
    await fastify.register(parentSettingsRoutes, { prefix: "/api/v1/parent/settings" });
    await fastify.register(parentAcademicRoutes, { prefix: "/api/v1/parent/academic" });
    await fastify.register(parentDocumentsRoutes, { prefix: "/api/v1/parent/documents" });
    await fastify.register(parentEmergencyRoutes, { prefix: "/api/v1/parent/emergency" });
    await fastify.register(parentsRoutes, { prefix: "/api/v1/parents" });

    // Admin-specific routes
    await fastify.register(adminAnnouncementsRoutes, { prefix: "/api/v1/admin/announcements" });
    await fastify.register(adminMessagesRoutes, { prefix: "/api/v1/admin/messages" });

    // Self-registration validation routes (admin reviews public registration requests)
    await fastify.register(registrationRequestsRoutes, { prefix: "/api/v1/registration-requests" });

    // Professional training catalog routes (public access)
    await fastify.register(formationsProRoutes, { prefix: "/api/v1/formations-pro" });

    // Professional training sessions routes (public and admin)
    await fastify.register(sessionsProRoutes, { prefix: "/api/v1/sessions-pro" });
    // Register admin routes with correct prefix
    await fastify.register(sessionsProRoutes, { prefix: "/api/v1" });

    // Professional training enrollment routes
    await fastify.register(inscriptionsProRoutes, { prefix: "/api/v1/inscriptions-pro" });
    // Register admin routes with correct prefix
    await fastify.register(inscriptionsProRoutes, { prefix: "/api/v1" });

    // Promotional code validation routes
    await fastify.register(codesPromoRoutes, { prefix: "/api/v1/codes-promo" });

    // Payment processing routes
    await fastify.register(paiementsProRoutes, { prefix: "/api/v1/paiements-pro" });

    // Trainer space routes (formateur)
    await fastify.register(formateurRoutes, { prefix: "/api/v1/formateur" });

    // Module Professionnel (inscription à la carte) — feature 028.
    // Module DISTINCT du module "formations professionnelles" ci-dessus.
    await fastify.register(professionalRoutes, { prefix: "/api/v1/professional" });

    // Admin routes for Phase 6 - Gestion Administrative & Documents
    await fastify.register(documentsRoutes, { prefix: "/api/v1/admin/documents" });
    await fastify.register(entreprisesRoutes, { prefix: "/api/v1/admin/entreprises" });
    await fastify.register(exportsRoutes, { prefix: "/api/v1/admin/exports" });
    await fastify.register(reportingRoutes, { prefix: "/api/v1/admin/reporting" });
    await fastify.register(ownerRoutes, { prefix: "/api/v1/owner" });

    // Rôles administratifs personnalisés + permissions sur les menus du sidebar admin
    await fastify.register(adminRolesRoutes, { prefix: "/api/v1/admin/access" });

    // RSO-PFSO Module routes
    await fastify.register(rsoActivityRoutes, { prefix: "/api/v1/rso" }); // Routes already include /activities

    // LiveKit videoconferencing routes
    await fastify.register(liveSessionsRoutes, { prefix: "/api/v1/live-sessions" });
    await fastify.register(livekitWebhookRoutes, { prefix: "/api/v1/webhooks" });

    // Generic in-app notifications inbox (bell UI)
    await fastify.register(notificationsInboxRoutes, { prefix: "/api/v1/notifications-inbox" });

    // Enregistrement des routes des tableaux de bord étudiants - TEMPORAIREMENT DÉSACTIVÉ
    // await fastify.register(studentDashboardRoutes, { prefix: "/api/v1/students/dashboards" });

    // Global error handler
    fastify.setErrorHandler((error, request, reply) => {
      fastify.log.error(error);

      if (error.validation) {
        reply.status(400).send({
          error: "Validation Error",
          message: error.message,
          details: error.validation,
        });
        return;
      }

      reply.status(500).send({
        error: "Internal Server Error",
        message: process.env.NODE_ENV === "production"
          ? "Something went wrong"
          : error.message,
      });
    });

    const host = process.env.HOST || "localhost";
    const port = parseInt(process.env.PORT || "4000", 10);

    await fastify.listen({ host, port });
    fastify.log.info(`🚀 API Server ready at http://${host}:${port}`);

    // Start background jobs
    const { initializeDocumentAutomationJob } = await import("./jobs/document-automation.job");
    initializeDocumentAutomationJob(fastify.pg as any);
    fastify.log.info("📅 Document automation jobs started");

    // Start reservation cleanup job (runs every 5 minutes)
    initializeReservationCleanupJob(fastify.pg as any, 5);
    fastify.log.info("🧹 Reservation cleanup job started (runs every 5 minutes)");


  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
