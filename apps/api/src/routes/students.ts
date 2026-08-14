import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import path from "path";
import { promises as fs, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";

import {
  StudentProfileSchema,
  StudentQuerySchema,
  CreateStudentParentSchema,
  UpdateStudentParentSchema,
  StudentParentQuerySchema,
  StudentCredentialsEmailTemplateSchema
} from "@ecoledigitale/contracts";
import { emailService } from "../services/email.service";
import {
  canViewInitialPassword,
  maskInitialPassword,
} from "../middlewares/credentials-visibility";
import {
  DEFAULT_STUDENT_CREDENTIALS_TEMPLATE,
  STUDENT_CREDENTIALS_VARIABLES,
  loadTenantStudentCredentialsTemplate,
  renderStudentCredentialsEmail,
  resolveTenantName,
  saveTenantStudentCredentialsTemplate,
} from "../services/student-credentials-email";
// Force reload: Updated schema max(1000) - 2025-11-05

const LOGIN_URL =
  process.env.WEB_APP_URL ||
  process.env.FRONTEND_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://ecoledigitale.engage-360.net/login"
    : "http://localhost:3000/login");

export async function studentsRoutes(fastify: FastifyInstance) {
  const generateTemporaryPassword = (length = 12): string => {
    const lowercase = "abcdefghjkmnpqrstuvwxyz";
    const uppercase = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "@#$%!?";
    const all = lowercase + uppercase + numbers + symbols;

    const seed = [
      lowercase[Math.floor(Math.random() * lowercase.length)],
      uppercase[Math.floor(Math.random() * uppercase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
    ];

    for (let i = seed.length; i < length; i++) {
      seed.push(all[Math.floor(Math.random() * all.length)]);
    }

    return seed.sort(() => Math.random() - 0.5).join("");
  };

  const enforceSequentialMatricules = async (client: any, tenantId: string): Promise<void> => {
    await client.query(
      `
      WITH ordered AS (
        SELECT
          id,
          LPAD((ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) + 10000)::text, 5, '0') AS next_matricule
        FROM student_profiles
        WHERE tenant_id = $1
      )
      UPDATE student_profiles sp
      SET
        student_number = ordered.next_matricule,
        establishment_matricule = ordered.next_matricule,
        updated_at = NOW()
      FROM ordered
      WHERE sp.id = ordered.id
        AND sp.tenant_id = $1
        AND (
          sp.student_number IS DISTINCT FROM ordered.next_matricule
          OR sp.establishment_matricule IS DISTINCT FROM ordered.next_matricule
        )
      `,
      [tenantId]
    );
  };

  const getNextEstablishmentMatricule = async (client: any, tenantId: string): Promise<string> => {
    const res = await client.query(
      `
      SELECT COALESCE(
        MAX(CASE WHEN establishment_matricule ~ '^[0-9]{5}$' THEN establishment_matricule::int END),
        10000
      ) + 1 AS next_value
      FROM student_profiles
      WHERE tenant_id = $1
      `,
      [tenantId]
    );
    const nextValue = Number(res.rows[0]?.next_value || 10001);
    return String(nextValue).padStart(5, "0");
  };

  // GET /api/v1/students/me - Current authenticated student profile
  fastify.get("/me", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({
        error: "Tenant Required",
        message: "This endpoint requires tenant context",
      });
    }

    const userId = (request as any).user?.id || (request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(401).send({
        error: "Authentication Required",
        message: "User ID is required",
      });
    }

    const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
    const client = await fastify.pg.connect();

    try {
      const baseSelect = `
        SELECT
          sp.id,
          sp.tenant_id,
          sp.user_id,
          sp.student_number,
          sp.current_year,
          sp.status,
          sp.is_active,
          sp.created_at,
          sp.updated_at,
          u.email,
          u.first_name,
          u.last_name,
          u.name
        FROM student_profiles sp
        JOIN users u ON u.id = sp.user_id
        WHERE sp.tenant_id = $1
          AND sp.user_id = $2
      `;

      // Prefer the active academic year when present, but gracefully fall back to any profile
      // so student-only pages do not break when enrollment is missing for the selected year.
      let result;
      if (activeAcademicYearId) {
        result = await client.query(
          `
          ${baseSelect}
            AND EXISTS (
              SELECT 1
              FROM student_enrollments se
              WHERE se.student_id = sp.id
                AND se.tenant_id = sp.tenant_id
                AND se.academic_year_id = $3::uuid
            )
          ORDER BY sp.created_at DESC
          LIMIT 1
          `,
          [request.tenantId, userId, activeAcademicYearId]
        );

        if (result.rows.length === 0) {
          result = await client.query(
            `
            ${baseSelect}
            ORDER BY sp.created_at DESC
            LIMIT 1
            `,
            [request.tenantId, userId]
          );
        }
      } else {
        result = await client.query(
          `
          ${baseSelect}
          ORDER BY sp.created_at DESC
          LIMIT 1
          `,
          [request.tenantId, userId]
        );
      }

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Student profile not found for current user",
        });
      }

      const row = result.rows[0];
      return reply.send({
        student: {
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          studentNumber: row.student_number,
          currentYear: row.current_year,
          status: row.status,
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          user: {
            id: row.user_id,
            email: row.email,
            firstName: row.first_name,
            lastName: row.last_name,
            name: row.name,
          },
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to fetch current student profile",
      });
    } finally {
      client.release();
    }
  });

  // GET /api/v1/students - List students
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "graduated", "suspended", "dropped", "transfer"] },
          currentYear: { type: "number", minimum: 1, maximum: 10 },
          academicYearId: { type: "string", format: "uuid" },
          search: { type: "string" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 1000, default: 20 },
          /**
           * Ne renvoie que les étudiants sans inscription en cours dans le module
           * professionnel. Utilisé par l'écran d'inscription en lot, qui ne doit
           * proposer que des étudiants réellement inscriptibles.
           */
          withoutActiveProfessionalEnrollment: { type: "boolean" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            students: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  userId: { type: "string" },
                  studentNumber: { type: "string" },
                  currentYear: { type: "number" },
                  status: { type: "string" },
                  bio: { type: "string" },
                  dateOfBirth: { type: "string" },
                  placeOfBirth: { type: "string" },
                  nationality: { type: "string" },
                  address: { type: "string" },
                  phone: { type: "string" },
                  emergencyPhone: { type: "string" },
                  fatherName: { type: "string" },
                  motherName: { type: "string" },
                  birthCertificateNumber: { type: "string" },
                  birthCertificateDate: { type: "string" },
                  civilRegistryOffice: { type: "string" },
                  subPrefecture: { type: "string" },
                  originSchool: { type: "string" },
                  isRepeating: { type: "boolean" },
                  lv2: { type: "string" },
                  scholarshipLevel: { type: "string" },
                  isTransfer: { type: "boolean" },
                  transferDecision: { type: "string" },
                  affectationStatus: { type: "string" },
                  affectationDecision: { type: "string" },
                  cepeCode: { type: "string" },
                  isInscribed: { type: "boolean" },
                  inscriptionDate: { type: "string" },
                  residence: { type: "string" },
                  studentMatricule: { type: ["string", "null"] },
                  sequenceNumber: { type: ["integer", "null"] },
                  establishmentMatricule: { type: "string" },
                  professionalMatricule: { type: ["string", "null"] },
                  dspsMatricule: { type: "string" },
                  dspsPreviousMatricule: { type: "string" },
                  classId: { type: "string" },
                  className: { type: "string" },
                  programmeName: { type: "string" },
                  academicYearId: { type: "string" },
                  academicYearName: { type: "string" },
                  isActive: { type: "boolean" },
                  initialPassword: { type: ["string", "null"] },
                  // Nombre de parents rattachés : permet aux écrans d'assignation
                  // de ne proposer que les étudiants encore sans parent.
                  parentsCount: { type: "number" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  user: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      email: { type: "string" },
                      firstName: { type: "string" },
                      lastName: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            total: { type: "number" },
            page: { type: "number" },
            limit: { type: "number" },
            totalPages: { type: "number" },
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

      // Parse query with manual validation to handle limit > 100 until server reloads
      const rawQuery = request.query as any;
      const page = parseInt(rawQuery.page) || 1;
      const limit = Math.min(Math.max(parseInt(rawQuery.limit) || 20, 1), 1000); // Cap at 1000, min 1
      const search = rawQuery.search || '';
      const status = rawQuery.status;
      const currentYear = rawQuery.currentYear ? parseInt(rawQuery.currentYear) : undefined;
      // The students directory is now a global people-management view.
      // Only filter by academic year when the page explicitly requests it.
      const academicYearId = rawQuery.academicYearId;
      // Un booléen de querystring arrive en chaîne : "false" est truthy, d'où la
      // comparaison explicite plutôt qu'un simple Boolean().
      const withoutActiveProfessionalEnrollment =
        rawQuery.withoutActiveProfessionalEnrollment === true ||
        rawQuery.withoutActiveProfessionalEnrollment === "true";

      // Use manual validation instead of Zod schema until server reloads with updated schema
      const query = {
        page,
        limit,
        search: search || undefined,
        status: status || undefined,
        currentYear,
        academicYearId,
        withoutActiveProfessionalEnrollment,
      };
      
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      const canViewPasswords = canViewInitialPassword(request);
      try {
        await enforceSequentialMatricules(client, request.tenantId);

        // Check if gender column exists
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'student_profiles' 
          AND column_name = 'gender'
        `);
        const hasGenderColumn = columnCheck.rows.length > 0;
        // Build WHERE clause
        let whereClause = "WHERE sp.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;
        let academicYearParamIndex: number | null = null;

        if (query.status) {
          whereClause += ` AND sp.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.currentYear) {
          whereClause += ` AND sp.current_year = $${paramIndex}`;
          params.push(query.currentYear.toString());
          paramIndex++;
        }

        if (query.academicYearId) {
          academicYearParamIndex = paramIndex;
          whereClause += ` AND EXISTS (
            SELECT 1 FROM student_enrollments se_filter
            WHERE se_filter.student_id = sp.id
              AND se_filter.tenant_id = sp.tenant_id
              AND se_filter.academic_year_id = $${paramIndex}
          )`;
          params.push(query.academicYearId);
          paramIndex++;
        }

        if (query.withoutActiveProfessionalEnrollment) {
          // « Inscription en cours » = une inscription non annulée portant sur une
          // cohorte encore active. Une cohorte terminée ou annulée ne bloque donc
          // plus l'étudiant : il redevient inscriptible.
          whereClause += ` AND NOT EXISTS (
            SELECT 1
            FROM professional_enrollments pe_active
            JOIN professional_ue_sessions pus_active
              ON pus_active.id = pe_active.ue_session_id
             AND pus_active.tenant_id = pe_active.tenant_id
            WHERE pe_active.student_id = sp.id
              AND pe_active.tenant_id = sp.tenant_id
              AND pe_active.statut <> 'annulee'
              AND pus_active.statut NOT IN ('annule', 'termine')
          )`;
        }

        if (query.search) {
          // La liste étant paginée côté serveur, la recherche doit couvrir tout ce
          // que la carte affiche — sinon un étudiant hors de la page courante
          // resterait introuvable. D'où le matricule d'établissement, le numéro
          // d'ordre (comparé sur 4 chiffres, tel qu'affiché) et le matricule IPAM.
          whereClause += ` AND (
            CONCAT(u.first_name, ' ', u.last_name) ILIKE $${paramIndex}
            OR u.email ILIKE $${paramIndex}
            OR sp.student_number ILIKE $${paramIndex}
            OR sp.student_matricule ILIKE $${paramIndex}
            OR sp.establishment_matricule ILIKE $${paramIndex}
            OR LPAD(sp.sequence_number::text, 4, '0') ILIKE $${paramIndex}
            OR EXISTS (
              SELECT 1 FROM professional_student_matricules psm_search
              WHERE psm_search.student_id = sp.id
                AND psm_search.tenant_id = sp.tenant_id
                AND psm_search.matricule ILIKE $${paramIndex}
            )
          )`;
          params.push(`%${query.search}%`);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*)
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get students with user info
        // Conditionally include gender column if it exists
        const genderSelect = hasGenderColumn ? 'sp.gender' : "'masculin'::text as gender";
        const academicYearLateralFilter = academicYearParamIndex
          ? `AND se.academic_year_id = $${academicYearParamIndex}`
          : "";

        const studentsQuery = `
          SELECT sp.id, sp.tenant_id, sp.user_id, sp.student_number, sp.current_year,
                 sp.status, sp.bio, sp.date_of_birth, sp.place_of_birth, sp.nationality,
                 sp.address, sp.phone, sp.emergency_phone,
                 sp.father_name, sp.mother_name, sp.birth_certificate_number, sp.birth_certificate_date,
                 sp.civil_registry_office, sp.sub_prefecture,
                 sp.origin_school, sp.is_repeating, sp.lv2, sp.scholarship_level,
                 sp.is_transfer, sp.transfer_decision, sp.affectation_status, sp.affectation_decision,
                 sp.cepe_code, sp.is_inscribed, sp.inscription_date,
                 sp.residence, sp.student_matricule, sp.sequence_number,
                 sp.establishment_matricule, sp.dsps_matricule, sp.dsps_previous_matricule, sp.initial_password,
                 sp.bac_obtention_date, sp.bac_series, sp.last_diploma,
                 ${genderSelect}, sp.is_active,
                 sc.class_id, sc.class_name, sc.programme_name, sc.academic_year_id, sc.academic_year_name,
                 pm.matricule AS professional_matricule,
                 -- Nombre de parents déjà rattachés à l'étudiant.
                 (
                   SELECT COUNT(*)
                   FROM student_parents spar
                   WHERE spar.student_id = sp.id
                     AND spar.tenant_id = sp.tenant_id
                 ) AS parents_count,
                 sp.created_at, sp.updated_at,
                 u.email, u.first_name, u.last_name, u.name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          LEFT JOIN LATERAL (
            SELECT
              se.class_id,
              se.academic_year_id,
              c.name AS class_name,
              p.name AS programme_name,
              ay.name AS academic_year_name
            FROM student_enrollments se
            JOIN classes c ON c.id = se.class_id
            JOIN programmes p ON p.id = c.programme_id
            LEFT JOIN academic_years ay ON ay.id = se.academic_year_id
            WHERE se.student_id = sp.id
              AND se.tenant_id = sp.tenant_id
              ${academicYearLateralFilter}
            ORDER BY (se.status = 'active') DESC, se.created_at DESC
            LIMIT 1
          ) sc ON TRUE
          -- Matricule IPAM (IPAM-<CODE>-<NNNN>) : un par filière du module
          -- professionnel. On expose le plus récent quand l'étudiant en a plusieurs.
          LEFT JOIN LATERAL (
            SELECT psm.matricule
            FROM professional_student_matricules psm
            WHERE psm.student_id = sp.id
              AND psm.tenant_id = sp.tenant_id
            ORDER BY psm.created_at DESC, psm.seq DESC
            LIMIT 1
          ) pm ON TRUE
          ${whereClause}
          ORDER BY sp.created_at DESC, u.first_name, u.last_name
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const studentsResult = await client.query(studentsQuery, [...params, query.limit, offset]);

        const students = studentsResult.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          studentNumber: row.student_number,
          currentYear: row.current_year,
          status: row.status,
          bio: row.bio,
          dateOfBirth: row.date_of_birth,
          placeOfBirth: row.place_of_birth,
          nationality: row.nationality,
          address: row.address,
          phone: row.phone,
          emergencyPhone: row.emergency_phone,
          fatherName: row.father_name,
          motherName: row.mother_name,
          birthCertificateNumber: row.birth_certificate_number,
          birthCertificateDate: row.birth_certificate_date,
          civilRegistryOffice: row.civil_registry_office,
          subPrefecture: row.sub_prefecture,
          originSchool: row.origin_school,
          isRepeating: row.is_repeating,
          lv2: row.lv2,
          scholarshipLevel: row.scholarship_level,
          isTransfer: row.is_transfer,
          transferDecision: row.transfer_decision,
          affectationStatus: row.affectation_status,
          affectationDecision: row.affectation_decision,
          cepeCode: row.cepe_code,
          isInscribed: row.is_inscribed,
          inscriptionDate: row.inscription_date,
          residence: row.residence,
          bacObtentionDate: row.bac_obtention_date,
          bacSeries: row.bac_series,
          lastDiploma: row.last_diploma,
          studentMatricule: row.student_matricule,
          // Numéro d'ordre figé (0001, 0002, …), base du matricule IPAM.
          sequenceNumber: row.sequence_number ?? null,
          establishmentMatricule: row.establishment_matricule,
          professionalMatricule: row.professional_matricule ?? null,
          dspsMatricule: row.dsps_matricule,
          dspsPreviousMatricule: row.dsps_previous_matricule,
          classId: row.class_id || undefined,
          className: row.class_name || undefined,
          programmeName: row.programme_name || undefined,
          academicYearId: row.academic_year_id || undefined,
          academicYearName: row.academic_year_name || undefined,
          // Réservé à la direction et à l'administration : `null` pour tous les autres.
          initialPassword: maskInitialPassword(canViewPasswords, row.initial_password),
          // COUNT() revient en bigint (chaîne) via node-postgres.
          parentsCount: Number(row.parents_count ?? 0),
          gender: row.gender || 'masculin',
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          user: {
            id: row.user_id,
            email: row.email,
            firstName: row.first_name ?? (row.name ? row.name.split(' ')[0] : ''),
            lastName: row.last_name ?? (row.name ? row.name.split(' ').slice(1).join(' ') : ''),
            name: row.name ?? undefined,
          },
        }));

        reply.send({
          students,
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        });
      } catch (error: any) {
        fastify.log.error(`Error fetching students: ${error}`);
        fastify.log.error(`Error details: ${error?.message || error}`);
        fastify.log.error(`Error stack: ${error?.stack || 'No stack trace'}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: error?.message || "An error occurred while fetching students",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students/:id/reset-password - Reset student password (admin only)
  fastify.post("/:id/reset-password", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            studentId: { type: "string" },
            initialPassword: { type: "string" },
            message: { type: "string" },
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

      const userRoles = (request as any).user?.roles || [];
      if (!userRoles.includes("admin") && !userRoles.includes("super_admin")) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "This endpoint requires admin role",
        });
      }

      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        await client.query("BEGIN");

        const studentRes = await client.query(
          `
            SELECT sp.id, sp.user_id
            FROM student_profiles sp
            WHERE sp.id = $1 AND sp.tenant_id = $2
            LIMIT 1
          `,
          [id, request.tenantId]
        );

        if (studentRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Student not found",
          });
        }

        const student = studentRes.rows[0];
        const newPassword = generateTemporaryPassword();
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        await client.query(
          `
            UPDATE users
            SET password_hash = $1, updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3
          `,
          [newPasswordHash, student.user_id, request.tenantId]
        );

        await client.query(
          `
            UPDATE student_profiles
            SET initial_password = $1, updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3
          `,
          [newPassword, id, request.tenantId]
        );

        await client.query("COMMIT");

        return reply.send({
          studentId: id,
          initialPassword: newPassword,
          message: "Mot de passe réinitialisé avec succès",
        });
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error resetting student password: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to reset student password",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/students/:id - Get student by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const canViewPasswords = canViewInitialPassword(request);
      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        // Check if gender column exists
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'student_profiles' 
          AND column_name = 'gender'
        `);
        const hasGenderColumn = columnCheck.rows.length > 0;
        // Conditionally include gender column if it exists
        const genderSelect = hasGenderColumn ? 'sp.gender' : "'masculin'::text as gender";
        const studentQuery = `
          SELECT sp.id, sp.tenant_id, sp.user_id, sp.student_number, sp.current_year,
                 sp.status, sp.bio, sp.date_of_birth, sp.place_of_birth, sp.nationality,
                 sp.address, sp.phone, sp.emergency_phone,
                 sp.father_name, sp.mother_name, sp.birth_certificate_number, sp.birth_certificate_date,
                 sp.civil_registry_office, sp.sub_prefecture,
                 sp.origin_school, sp.is_repeating, sp.lv2, sp.scholarship_level,
                 sp.is_transfer, sp.transfer_decision, sp.affectation_status, sp.affectation_decision,
                 sp.cepe_code, sp.is_inscribed, sp.inscription_date,
                 sp.residence, sp.student_matricule, sp.sequence_number,
                 sp.establishment_matricule, sp.dsps_matricule, sp.dsps_previous_matricule, sp.initial_password,
                 sp.bac_obtention_date, sp.bac_series, sp.last_diploma,
                 ${genderSelect}, sp.is_active,
                 sc.class_id, sc.class_name, sc.programme_name, sc.academic_year_id, sc.academic_year_name,
                 pm.matricule AS professional_matricule,
                 sp.created_at, sp.updated_at,
                 u.email, u.first_name, u.last_name, u.name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          LEFT JOIN LATERAL (
            SELECT
              se.class_id,
              se.academic_year_id,
              c.name AS class_name,
              p.name AS programme_name,
              ay.name AS academic_year_name
            FROM student_enrollments se
            JOIN classes c ON c.id = se.class_id
            JOIN programmes p ON p.id = c.programme_id
            LEFT JOIN academic_years ay ON ay.id = se.academic_year_id
            WHERE se.student_id = sp.id
              AND se.tenant_id = sp.tenant_id
            ORDER BY (se.status = 'active') DESC, se.created_at DESC
            LIMIT 1
          ) sc ON TRUE
          -- Matricule IPAM (IPAM-<CODE>-<NNNN>) : cf. commentaire du listing.
          LEFT JOIN LATERAL (
            SELECT psm.matricule
            FROM professional_student_matricules psm
            WHERE psm.student_id = sp.id
              AND psm.tenant_id = sp.tenant_id
            ORDER BY psm.created_at DESC, psm.seq DESC
            LIMIT 1
          ) pm ON TRUE
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `;

        const result = await client.query(studentQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Student not found",
          });
        }

        const row = result.rows[0];
        const student = {
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          studentNumber: row.student_number,
          currentYear: row.current_year,
          status: row.status,
          bio: row.bio,
          dateOfBirth: row.date_of_birth,
          placeOfBirth: row.place_of_birth,
          nationality: row.nationality,
          address: row.address,
          phone: row.phone,
          emergencyPhone: row.emergency_phone,
          fatherName: row.father_name,
          motherName: row.mother_name,
          birthCertificateNumber: row.birth_certificate_number,
          birthCertificateDate: row.birth_certificate_date,
          civilRegistryOffice: row.civil_registry_office,
          subPrefecture: row.sub_prefecture,
          originSchool: row.origin_school,
          isRepeating: row.is_repeating,
          lv2: row.lv2,
          scholarshipLevel: row.scholarship_level,
          isTransfer: row.is_transfer,
          transferDecision: row.transfer_decision,
          affectationStatus: row.affectation_status,
          affectationDecision: row.affectation_decision,
          cepeCode: row.cepe_code,
          isInscribed: row.is_inscribed,
          inscriptionDate: row.inscription_date,
          residence: row.residence,
          bacObtentionDate: row.bac_obtention_date,
          bacSeries: row.bac_series,
          lastDiploma: row.last_diploma,
          studentMatricule: row.student_matricule,
          // Numéro d'ordre figé (0001, 0002, …), base du matricule IPAM.
          sequenceNumber: row.sequence_number ?? null,
          establishmentMatricule: row.establishment_matricule,
          professionalMatricule: row.professional_matricule ?? null,
          dspsMatricule: row.dsps_matricule,
          dspsPreviousMatricule: row.dsps_previous_matricule,
          classId: row.class_id || undefined,
          className: row.class_name || undefined,
          programmeName: row.programme_name || undefined,
          academicYearId: row.academic_year_id || undefined,
          academicYearName: row.academic_year_name || undefined,
          // Réservé à la direction et à l'administration : `null` pour tous les autres.
          initialPassword: maskInitialPassword(canViewPasswords, row.initial_password),
          gender: row.gender || 'masculin', // Default to 'masculin' if column doesn't exist yet
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          user: {
            id: row.user_id,
            email: row.email,
            firstName: row.first_name ?? (row.name ? row.name.split(' ')[0] : ''),
            lastName: row.last_name ?? (row.name ? row.name.split(' ').slice(1).join(' ') : ''),
            name: row.name ?? undefined,
          },
        };

        reply.send(student);
      } catch (error) {
        fastify.log.error(`Error fetching student: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching student",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students - Create student
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string", format: "uuid" },
          studentNumber: { type: "string", maxLength: 50 },
          currentYear: { type: "number", minimum: 1, maximum: 10, default: 1 },
          status: { type: "string", enum: ["active", "graduated", "suspended", "dropped", "transfer"], default: "active" },
          bio: { type: "string" },
          dateOfBirth: { type: "string", format: "date" },
          placeOfBirth: { type: "string", maxLength: 255 },
          nationality: { type: "string", maxLength: 100 },
          address: { type: "string" },
          phone: { type: "string", maxLength: 20 },
          emergencyPhone: { type: "string", maxLength: 20 },
          fatherName: { type: "string", maxLength: 255 },
          motherName: { type: "string", maxLength: 255 },
          birthCertificateNumber: { type: "string", maxLength: 100 },
          birthCertificateDate: { type: "string", format: "date" },
          civilRegistryOffice: { type: "string", maxLength: 255 },
          subPrefecture: { type: "string", maxLength: 255 },
          residence: { type: "string", maxLength: 255 },
          // Matricule saisi : optionnel ici (cet endpoint rattache un profil à un
          // utilisateur déjà créé). Il est obligatoire sur POST /with-user, utilisé
          // par la page /academic/students/new.
          studentMatricule: { type: "string", minLength: 1, maxLength: 50 },
          establishmentMatricule: { type: "string", maxLength: 100 },
          dspsMatricule: { type: "string", maxLength: 100 },
          dspsPreviousMatricule: { type: "string", maxLength: 100 },
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

      const data = request.body as any;
      const client = await fastify.pg.connect();

      try {
        const establishmentMatricule = await getNextEstablishmentMatricule(client, request.tenantId);
        const studentNumber = establishmentMatricule;
        const studentMatricule = data.studentMatricule
          ? String(data.studentMatricule).trim()
          : null;

        if (studentMatricule) {
          const matriculeConflict = await client.query(
            `SELECT id FROM student_profiles
             WHERE tenant_id = $1 AND student_matricule = $2`,
            [request.tenantId, studentMatricule]
          );
          if (matriculeConflict.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: `Le matricule « ${studentMatricule} » est déjà attribué à un autre étudiant`,
            });
          }
        }

        // Check if user exists and belongs to tenant
        const userCheck = await client.query(
          "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
          [data.userId, request.tenantId]
        );

        if (userCheck.rows.length === 0) {
          return reply.status(400).send({
            error: "Invalid User",
            message: "User not found or does not belong to this tenant",
          });
        }

        // Check if student profile already exists for this user
        const existingCheck = await client.query(
          "SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2",
          [data.userId, request.tenantId]
        );

        if (existingCheck.rows.length > 0) {
          return reply.status(400).send({
            error: "Student Exists",
            message: "Student profile already exists for this user",
          });
        }

        // Check if gender column exists
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'student_profiles' 
          AND column_name = 'gender'
        `);
        const hasGenderColumn = columnCheck.rows.length > 0;
        const insertFields = [
          'tenant_id',
          'user_id',
          'student_number',
          'current_year',
          'status',
          'bio',
          'date_of_birth',
          'place_of_birth',
          'nationality',
          'address',
          'phone',
          'emergency_phone',
          'father_name',
          'mother_name',
          'birth_certificate_number',
          'birth_certificate_date',
          'civil_registry_office',
          'sub_prefecture',
          'residence',
          'student_matricule',
          'establishment_matricule',
          'dsps_matricule',
          'dsps_previous_matricule',
        ];

        const insertParams = [
          request.tenantId,
          data.userId,
          studentNumber,
          data.currentYear,
          data.status,
          data.bio || null,
          data.dateOfBirth || null,
          data.placeOfBirth || null,
          data.nationality || null,
          data.address || null,
          data.phone || null,
          data.emergencyPhone || null,
          data.fatherName || null,
          data.motherName || null,
          data.birthCertificateNumber || null,
          data.birthCertificateDate || null,
          data.civilRegistryOffice || null,
          data.subPrefecture || null,
          data.residence || null,
          studentMatricule,
          establishmentMatricule,
          data.dspsMatricule || null,
          data.dspsPreviousMatricule || null,
        ];

        if (hasGenderColumn) {
          insertFields.push('gender');
          insertParams.push(data.gender);
        }

        const insertQuery = `
          INSERT INTO student_profiles (${insertFields.join(', ')})
          VALUES (${insertParams.map((_, index) => `$${index + 1}`).join(', ')})
          RETURNING id, tenant_id, user_id, student_number, current_year, status, bio,
                    date_of_birth, place_of_birth, nationality, address, phone,
                    emergency_phone, father_name, mother_name, birth_certificate_number, birth_certificate_date,
                    civil_registry_office, sub_prefecture, residence,
                    student_matricule, sequence_number, establishment_matricule, dsps_matricule, dsps_previous_matricule
                    ${hasGenderColumn ? ', gender' : ''}, is_active, created_at, updated_at
        `;

        const result = await client.query(insertQuery, insertParams);

        const row = result.rows[0];
        const student = {
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          studentNumber: row.student_number,
          currentYear: row.current_year,
          status: row.status,
          bio: row.bio,
          dateOfBirth: row.date_of_birth,
          placeOfBirth: row.place_of_birth,
          nationality: row.nationality,
          address: row.address,
          phone: row.phone,
          emergencyPhone: row.emergency_phone,
          fatherName: row.father_name,
          motherName: row.mother_name,
          birthCertificateNumber: row.birth_certificate_number,
          birthCertificateDate: row.birth_certificate_date,
          civilRegistryOffice: row.civil_registry_office,
          subPrefecture: row.sub_prefecture,
          residence: row.residence,
          studentMatricule: row.student_matricule,
          // Numéro d'ordre figé (0001, 0002, …), base du matricule IPAM.
          sequenceNumber: row.sequence_number ?? null,
          establishmentMatricule: row.establishment_matricule,
          professionalMatricule: row.professional_matricule ?? null,
          dspsMatricule: row.dsps_matricule,
          dspsPreviousMatricule: row.dsps_previous_matricule,
          gender: row.gender || 'masculin', // Default to 'masculin' if column doesn't exist yet
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };

        reply.status(201).send(student);
      } catch (error) {
        fastify.log.error(`Error creating student: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while creating student",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students/with-user - Create student with user account
  fastify.post("/with-user", {
    schema: {
      body: {
        type: "object",
        required: ["firstName", "lastName", "email", "password", "studentMatricule"],
        additionalProperties: false,
        properties: {
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          matricule: { type: "string", maxLength: 50 },
          // Matricule saisi par la scolarité : format libre, obligatoire.
          // À ne pas confondre avec `matricule` ci-dessus, ignoré au profit de
          // la séquence numérique automatique (voir plus bas).
          studentMatricule: { type: "string", minLength: 1, maxLength: 50 },
          currentYear: { type: "number", minimum: 1, maximum: 10, default: 1 },
          status: { type: "string", enum: ["active", "graduated", "suspended", "dropped", "transfer"], default: "active" },
          bio: { type: "string" },
          dateOfBirth: { type: "string", format: "date" },
          placeOfBirth: { type: "string", maxLength: 255 },
          nationality: { type: "string", maxLength: 100 },
          address: { type: "string" },
          phone: { type: "string", maxLength: 20 },
          emergencyPhone: { type: "string", maxLength: 20 },
          gender: { type: "string", enum: ["masculin", "feminin"] },
          fatherName: { type: "string", maxLength: 255 },
          motherName: { type: "string", maxLength: 255 },
          birthCertificateNumber: { type: "string", maxLength: 100 },
          birthCertificateDate: { type: "string", format: "date" },
          civilRegistryOffice: { type: "string", maxLength: 255 },
          subPrefecture: { type: "string", maxLength: 255 },
          residence: { type: "string", maxLength: 255 },
          establishmentMatricule: { type: "string", maxLength: 100 },
          dspsMatricule: { type: "string", maxLength: 100 },
          dspsPreviousMatricule: { type: "string", maxLength: 100 },
          bacObtentionDate: { type: "string", format: "date" },
          bacSeries: { type: "string", maxLength: 100 },
          lastDiploma: { type: "string", maxLength: 255 },
          sendCredentialsEmail: { type: "boolean" },
          saveCredentialsEmailTemplate: { type: "boolean" },
          credentialsEmailTemplate: {
            type: "object",
            required: ["subject", "body"],
            properties: {
              subject: { type: "string", minLength: 1, maxLength: 300 },
              body: { type: "string", minLength: 1, maxLength: 20000 },
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

      const data = request.body as any;
      const client = await fastify.pg.connect();

      try {
        await client.query('BEGIN');

        // Check if email already exists for this tenant
        const existingUserQuery = `
          SELECT id FROM users
          WHERE tenant_id = $1 AND email = $2
        `;
        const existingUserResult = await client.query(existingUserQuery, [request.tenantId, data.email]);

        if (existingUserResult.rows.length > 0) {
          // ROLLBACK avant de rendre la connexion au pool : la transaction a
          // déjà été ouverte par le BEGIN ci-dessus.
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: "Conflict",
            message: "A user with this email already exists",
          });
        }

        // Matricule saisi par la scolarité : unique dans le tenant.
        const studentMatricule = String(data.studentMatricule).trim();
        if (!studentMatricule) {
          await client.query('ROLLBACK');
          return reply.status(400).send({
            error: "Validation Error",
            message: "Le matricule est requis",
          });
        }
        const matriculeConflict = await client.query(
          `SELECT id FROM student_profiles
           WHERE tenant_id = $1 AND student_matricule = $2`,
          [request.tenantId, studentMatricule]
        );
        if (matriculeConflict.rows.length > 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: "Conflict",
            message: `Le matricule « ${studentMatricule} » est déjà attribué à un autre étudiant`,
          });
        }

        // Generate establishment matricule sequence (10001, 10002, ...)
        // Always enforce numeric sequence for both matricules.
        const establishmentMatricule = await getNextEstablishmentMatricule(client, request.tenantId);
        const matricule = establishmentMatricule;

        // Hash password
        const passwordHash = await bcrypt.hash(data.password, 12);

        // Create user
        const userInsertQuery = `
          INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, tenant_id, email, first_name, last_name, created_at, updated_at
        `;

        const fullName = `${data.firstName} ${data.lastName}`;
        const userResult = await client.query(userInsertQuery, [
          request.tenantId,
          data.email,
          fullName,
          data.firstName,
          data.lastName,
          passwordHash,
        ]);

        const user = userResult.rows[0];

        // Assign student role to user
        const roleQuery = `
          SELECT id FROM roles WHERE key = 'student' AND COALESCE(is_active, true) = true
        `;
        const roleResult = await client.query(roleQuery);

        if (roleResult.rows.length > 0) {
          const roleId = roleResult.rows[0].id;
          await client.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
            [request.tenantId, user.id, roleId]
          );
        }

        // Check if gender column exists
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'student_profiles' 
          AND column_name = 'gender'
        `);
        const hasGenderColumn = columnCheck.rows.length > 0;
        const studentFields = [
          'tenant_id',
          'user_id',
          'student_number',
          'current_year',
          'status',
          'bio',
          'date_of_birth',
          'place_of_birth',
          'nationality',
          'address',
          'phone',
          'emergency_phone',
          'father_name',
          'mother_name',
          'birth_certificate_number',
          'birth_certificate_date',
          'civil_registry_office',
          'sub_prefecture',
          'residence',
          'student_matricule',
          'establishment_matricule',
          'dsps_matricule',
          'dsps_previous_matricule',
          'bac_obtention_date',
          'bac_series',
          'last_diploma',
          'initial_password',
        ];

        const studentParams = [
          request.tenantId,
          user.id,
          matricule,
          data.currentYear,
          data.status,
          data.bio || null,
          data.dateOfBirth || null,
          data.placeOfBirth || null,
          data.nationality || null,
          data.address || null,
          data.phone || null,
          data.emergencyPhone || null,
          data.fatherName || null,
          data.motherName || null,
          data.birthCertificateNumber || null,
          data.birthCertificateDate || null,
          data.civilRegistryOffice || null,
          data.subPrefecture || null,
          data.residence || null,
          studentMatricule,
          establishmentMatricule,
          data.dspsMatricule || null,
          data.dspsPreviousMatricule || null,
          data.bacObtentionDate || null,
          data.bacSeries || null,
          data.lastDiploma || null,
          data.password,
        ];

        if (hasGenderColumn) {
          studentFields.push('gender');
          studentParams.push(data.gender);
        }

        const studentInsertQuery = `
          INSERT INTO student_profiles (${studentFields.join(', ')})
          VALUES (${studentParams.map((_, index) => `$${index + 1}`).join(', ')})
          RETURNING id, tenant_id, user_id, student_number, current_year, status, bio,
                    date_of_birth, place_of_birth, nationality, address, phone,
                    emergency_phone, father_name, mother_name, birth_certificate_number, birth_certificate_date,
                    civil_registry_office, sub_prefecture, residence,
                    student_matricule, sequence_number, establishment_matricule, dsps_matricule, dsps_previous_matricule,
                    bac_obtention_date, bac_series, last_diploma, initial_password
                    ${hasGenderColumn ? ', gender' : ''}, is_active, created_at, updated_at
        `;

        const studentResult = await client.query(studentInsertQuery, studentParams);

        await client.query('COMMIT');

        // Envoi best-effort des identifiants : un échec SMTP ne doit jamais
        // annuler la création de l'étudiant (la transaction est déjà commitée).
        let emailSent = false;
        let emailError: string | null = null;

        // Mémorisation du modèle comme défaut de l'établissement, indépendante
        // du succès de l'envoi.
        if (data.saveCredentialsEmailTemplate && data.credentialsEmailTemplate) {
          try {
            await saveTenantStudentCredentialsTemplate(
              client,
              request.tenantId,
              data.credentialsEmailTemplate
            );
          } catch (saveError) {
            fastify.log.error(`Failed to save student credentials template: ${saveError}`);
          }
        }

        const wantsEmail = data.sendCredentialsEmail !== false;
        if (wantsEmail && data.email && data.password) {
          try {
            if (!emailService.isConfigured()) {
              throw new Error(
                "Service email non configuré (variables SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquantes)."
              );
            }

            const template =
              data.credentialsEmailTemplate ??
              (await loadTenantStudentCredentialsTemplate(client, request.tenantId));
            const schoolName = await resolveTenantName(client, request.tenantId);

            const { subject, html, text } = renderStudentCredentialsEmail(template, {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              password: data.password,
              loginUrl: LOGIN_URL,
              schoolName,
              studentMatricule,
              currentYear: data.currentYear,
            });

            await emailService.sendEmail({ to: data.email, subject, html, text });
            emailSent = true;
          } catch (mailError) {
            emailError = mailError instanceof Error ? mailError.message : String(mailError);
            fastify.log.error(
              `Student created (${studentResult.rows[0].id}) but credentials email failed: ${emailError}`
            );
          }
        }

        const studentRow = studentResult.rows[0];
        const response = {
          emailSent,
          emailError,
          id: studentRow.id,
          tenantId: studentRow.tenant_id,
          userId: studentRow.user_id,
          studentNumber: studentRow.student_number,
          currentYear: studentRow.current_year,
          status: studentRow.status,
          bio: studentRow.bio,
          dateOfBirth: studentRow.date_of_birth,
          placeOfBirth: studentRow.place_of_birth,
          nationality: studentRow.nationality,
          address: studentRow.address,
          phone: studentRow.phone,
          emergencyPhone: studentRow.emergency_phone,
          fatherName: studentRow.father_name,
          motherName: studentRow.mother_name,
          birthCertificateNumber: studentRow.birth_certificate_number,
          birthCertificateDate: studentRow.birth_certificate_date,
          civilRegistryOffice: studentRow.civil_registry_office,
          subPrefecture: studentRow.sub_prefecture,
          residence: studentRow.residence,
          studentMatricule: studentRow.student_matricule,
          // Numéro d'ordre figé (0001, 0002, …), base du matricule IPAM.
          sequenceNumber: studentRow.sequence_number ?? null,
          establishmentMatricule: studentRow.establishment_matricule,
          dspsMatricule: studentRow.dsps_matricule,
          dspsPreviousMatricule: studentRow.dsps_previous_matricule,
          bacObtentionDate: studentRow.bac_obtention_date,
          bacSeries: studentRow.bac_series,
          lastDiploma: studentRow.last_diploma,
          initialPassword: studentRow.initial_password,
          gender: studentRow.gender || 'masculin', // Default to 'masculin' if column doesn't exist yet
          isActive: studentRow.is_active,
          createdAt: studentRow.created_at,
          updatedAt: studentRow.updated_at,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
          },
        };

        return reply.status(201).send(response);
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error creating student with user: ${error?.message || error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error?.message || "Failed to create student with user account",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/students/credentials-template — Modèle d'email des identifiants
  fastify.get("/credentials-template", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const client = await fastify.pg.connect();
      try {
        const [template, schoolName] = await Promise.all([
          loadTenantStudentCredentialsTemplate(client, request.tenantId),
          resolveTenantName(client, request.tenantId),
        ]);

        return reply.send({
          ...template,
          defaults: DEFAULT_STUDENT_CREDENTIALS_TEMPLATE,
          variables: STUDENT_CREDENTIALS_VARIABLES,
          emailConfigured: emailService.isConfigured(),
          schoolName,
          loginUrl: LOGIN_URL,
        });
      } catch (error) {
        fastify.log.error(`Error loading student credentials template: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Impossible de charger le modèle d'email",
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/students/credentials-template — Enregistre le modèle du tenant
  fastify.put("/credentials-template", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const template = StudentCredentialsEmailTemplateSchema.parse(request.body as unknown);

      const client = await fastify.pg.connect();
      try {
        await saveTenantStudentCredentialsTemplate(client, request.tenantId, template);
        return reply.send({ ...template, saved: true });
      } catch (error) {
        fastify.log.error(`Error saving student credentials template: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Impossible d'enregistrer le modèle d'email",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students/:id/send-credentials — (Re)envoie les identifiants par email
  fastify.post("/:id/send-credentials", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      if (!emailService.isConfigured()) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message:
            "Service email non configuré (variables SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquantes).",
        });
      }

      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        template?: { subject: string; body: string };
      };

      const client = await fastify.pg.connect();
      try {
        const studentRes = await client.query(
          `SELECT sp.id, sp.user_id, sp.student_matricule, sp.current_year, sp.initial_password,
                  u.first_name, u.last_name, u.email
             FROM student_profiles sp
             JOIN users u ON u.id = sp.user_id
            WHERE sp.id = $1 AND sp.tenant_id = $2`,
          [id, request.tenantId]
        );

        if (studentRes.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Étudiant introuvable" });
        }

        const row = studentRes.rows[0];
        if (!row.email) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Cet étudiant n'a pas d'adresse email.",
          });
        }

        // Pas de mot de passe en clair disponible : on en régénère un et on
        // met à jour le compte, sinon l'email serait inutilisable.
        let password: string = row.initial_password;
        if (!password) {
          password = generateTemporaryPassword();
          const passwordHash = await bcrypt.hash(password, 12);
          await client.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
            [passwordHash, row.user_id]
          );
          await client.query(
            `UPDATE student_profiles SET initial_password = $1, updated_at = NOW() WHERE id = $2`,
            [password, id]
          );
        }

        const template =
          (body.template
            ? StudentCredentialsEmailTemplateSchema.parse(body.template)
            : null) ?? (await loadTenantStudentCredentialsTemplate(client, request.tenantId));
        const schoolName = await resolveTenantName(client, request.tenantId);

        const { subject, html, text } = renderStudentCredentialsEmail(template, {
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          password,
          loginUrl: LOGIN_URL,
          schoolName,
          studentMatricule: row.student_matricule,
          currentYear: row.current_year,
        });

        await emailService.sendEmail({ to: row.email, subject, html, text });

        return reply.send({
          studentId: row.id,
          emailSent: true,
          sentTo: row.email,
          message: `Identifiants envoyés à ${row.email}`,
        });
      } catch (error) {
        fastify.log.error(`Error sending student credentials: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Échec de l'envoi de l'email",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students/:id/diploma - Upload du fichier du dernier diplôme (multipart)
  fastify.post("/:id/diploma", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }
      const { id: studentId } = request.params as { id: string };

      const data = await (request as any).file();
      if (!data) {
        return reply.status(422).send({ error: "Validation Error", message: "Aucun fichier fourni." });
      }

      // Types autorisés : PDF ou image
      const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!allowed.includes(data.mimetype)) {
        return reply.status(400).send({
          error: "Validation Error",
          message: "Type de fichier non autorisé (PDF, PNG, JPG ou WEBP uniquement).",
        });
      }

      const safeName = String(data.filename || "diplome.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      const uniqueName = `${randomUUID()}_${safeName}`;
      const uploadDir = path.join(process.cwd(), "uploads", "students", studentId, "diploma");
      await fs.mkdir(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, uniqueName);

      try {
        await pipeline(data.file, createWriteStream(filePath));
      } catch (err: any) {
        return reply.status(500).send({
          error: "Internal Server Error",
          message: err?.message || "Erreur lors de l'écriture du fichier.",
        });
      }
      if ((data.file as any).truncated) {
        await fs.unlink(filePath).catch(() => undefined);
        return reply.status(413).send({ error: "File Too Large", message: "Fichier trop volumineux." });
      }

      const url = `/api/v1/students/${encodeURIComponent(studentId)}/diploma/${encodeURIComponent(uniqueName)}`;
      const upd = await fastify.pg.query(
        `UPDATE student_profiles SET last_diploma = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 RETURNING id`,
        [url, studentId, request.tenantId]
      );
      if (upd.rowCount === 0) {
        await fs.unlink(filePath).catch(() => undefined);
        return reply.status(404).send({ error: "Not Found", message: "Étudiant introuvable." });
      }
      return reply.status(201).send({ success: true, data: { url, filename: data.filename } });
    },
  });

  // GET /api/v1/students/:id/diploma/:filename - Sert le fichier du diplôme
  fastify.get("/:id/diploma/:filename", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }
    const { id: studentId, filename } = request.params as { id: string; filename: string };
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return reply.status(400).send({ error: "Validation Error", message: "Nom de fichier invalide." });
    }
    // L'étudiant doit appartenir au tenant courant
    const owner = await fastify.pg.query(
      `SELECT 1 FROM student_profiles WHERE id = $1 AND tenant_id = $2`,
      [studentId, request.tenantId]
    );
    if (owner.rowCount === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Étudiant introuvable." });
    }
    const abs = path.join(process.cwd(), "uploads", "students", studentId, "diploma", filename);
    try {
      await fs.access(abs);
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Fichier introuvable." });
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const mime = mimeMap[ext] ?? "application/octet-stream";
    const originalName = filename.replace(/^[0-9a-f-]{36}_/, "");
    reply.type(mime);
    reply.header("Content-Disposition", `inline; filename="${originalName}"`);
    reply.header("X-Content-Type-Options", "nosniff");
    const buf = await fs.readFile(abs);
    return reply.send(buf);
  });

  // PUT /api/v1/students/:id - Update student
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          studentNumber: { type: "string", maxLength: 50 },
          currentYear: { type: "number", minimum: 1, maximum: 10 },
          status: { type: "string", enum: ["active", "graduated", "suspended", "dropped", "transfer"] },
          bio: { type: "string" },
          dateOfBirth: { type: "string", format: "date" },
          placeOfBirth: { type: "string", maxLength: 255 },
          nationality: { type: "string", maxLength: 100 },
          address: { type: "string" },
          phone: { type: "string", maxLength: 20 },
          emergencyPhone: { type: "string", maxLength: 20 },
          gender: { type: "string", enum: ["masculin", "feminin"] },
          fatherName: { type: "string", maxLength: 255 },
          motherName: { type: "string", maxLength: 255 },
          birthCertificateNumber: { type: "string", maxLength: 100 },
          birthCertificateDate: { type: "string", format: "date" },
          civilRegistryOffice: { type: "string", maxLength: 255 },
          subPrefecture: { type: "string", maxLength: 255 },
          residence: { type: "string", maxLength: 255 },
          studentMatricule: { type: "string", minLength: 1, maxLength: 50 },
          establishmentMatricule: { type: "string", maxLength: 100 },
          dspsMatricule: { type: "string", maxLength: 100 },
          dspsPreviousMatricule: { type: "string", maxLength: 100 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            userId: { type: "string" },
            studentNumber: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string" },
            currentYear: { type: "number" },
            status: { type: "string" },
            bio: { type: "string" },
            dateOfBirth: { type: "string" },
            placeOfBirth: { type: "string" },
            nationality: { type: "string" },
            address: { type: "string" },
            phone: { type: "string" },
            emergencyPhone: { type: "string" },
            gender: { type: "string", enum: ["masculin", "feminin"] },
            fatherName: { type: "string" },
            motherName: { type: "string" },
            birthCertificateNumber: { type: "string" },
            birthCertificateDate: { type: "string" },
            civilRegistryOffice: { type: "string" },
            subPrefecture: { type: "string" },
            residence: { type: "string" },
            studentMatricule: { type: ["string", "null"] },
            establishmentMatricule: { type: "string" },
            dspsMatricule: { type: "string" },
            dspsPreviousMatricule: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
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

      const { id } = request.params as { id: string };
      const updateData = request.body as any;

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if student exists and belongs to tenant
        const existingQuery = `
          SELECT sp.id, sp.user_id, u.email, u.first_name, u.last_name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Student not found",
          });
        }

        const existingStudent = existingResult.rows[0];

        // If email is being updated, check for conflicts
        if (updateData.email && updateData.email !== existingStudent.email) {
          const conflictQuery = `
            SELECT id FROM users
            WHERE tenant_id = $1 AND email = $2 AND id != $3
          `;
          const conflictResult = await client.query(conflictQuery, [
            request.tenantId,
            updateData.email,
            existingStudent.user_id
          ]);

          if (conflictResult.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "A user with this email already exists",
            });
          }
        }

        // Student numbers and establishment matricules must stay numeric (10001, 10002, ...)
        if (updateData.studentNumber && !/^\d{5}$/.test(updateData.studentNumber)) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Le matricule doit être numérique sur 5 chiffres (ex: 10001)",
          });
        }
        if (updateData.establishmentMatricule && !/^\d{5}$/.test(updateData.establishmentMatricule)) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Le matricule établissement doit être numérique sur 5 chiffres (ex: 10001)",
          });
        }

        const targetMatricule = updateData.establishmentMatricule ?? updateData.studentNumber;
        // If matricule is being updated, check for conflicts
        if (targetMatricule) {
          const studentNumberConflictQuery = `
            SELECT id FROM student_profiles
            WHERE tenant_id = $1 AND (student_number = $2 OR establishment_matricule = $2) AND id != $3
          `;
          const studentNumberConflictResult = await client.query(studentNumberConflictQuery, [
            request.tenantId,
            targetMatricule,
            id
          ]);

          if (studentNumberConflictResult.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "A student with this student number already exists",
            });
          }
        }

        // Matricule saisi : format libre, mais unique dans le tenant.
        if (updateData.studentMatricule !== undefined) {
          updateData.studentMatricule = String(updateData.studentMatricule).trim();
          if (!updateData.studentMatricule) {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              error: "Validation Error",
              message: "Le matricule est requis",
            });
          }
          const matriculeConflict = await client.query(
            `SELECT id FROM student_profiles
             WHERE tenant_id = $1 AND student_matricule = $2 AND id != $3`,
            [request.tenantId, updateData.studentMatricule, id]
          );
          if (matriculeConflict.rows.length > 0) {
            await client.query('ROLLBACK');
            return reply.status(409).send({
              error: "Conflict",
              message: `Le matricule « ${updateData.studentMatricule} » est déjà attribué à un autre étudiant`,
            });
          }
        }

        // Update user information if provided
        const userUpdateFields = [];
        const userUpdateValues = [];
        let userParamIndex = 1;

        if (updateData.firstName !== undefined) {
          userUpdateFields.push(`first_name = $${userParamIndex}`);
          userUpdateValues.push(updateData.firstName);
          userParamIndex++;
        }
        if (updateData.lastName !== undefined) {
          userUpdateFields.push(`last_name = $${userParamIndex}`);
          userUpdateValues.push(updateData.lastName);
          userParamIndex++;
        }
        if (updateData.email !== undefined) {
          userUpdateFields.push(`email = $${userParamIndex}`);
          userUpdateValues.push(updateData.email);
          userParamIndex++;
        }

        // Keep full name in sync if first or last name provided
        if (updateData.firstName !== undefined || updateData.lastName !== undefined) {
          const newFirstName = updateData.firstName !== undefined ? updateData.firstName : existingStudent.first_name;
          const newLastName = updateData.lastName !== undefined ? updateData.lastName : existingStudent.last_name;
          userUpdateFields.push(`name = $${userParamIndex}`);
          userUpdateValues.push(`${newFirstName} ${newLastName}`.trim());
          userParamIndex++;
        }


        if (userUpdateFields.length > 0) {
          userUpdateFields.push(`updated_at = NOW()`);
          const userUpdateQuery = `
            UPDATE users
            SET ${userUpdateFields.join(', ')}
            WHERE id = $${userParamIndex} AND tenant_id = $${userParamIndex + 1}
          `;
          userUpdateValues.push(existingStudent.user_id, request.tenantId);
          await client.query(userUpdateQuery, userUpdateValues);
        }

        // Update student profile
        const profileUpdateFields = [];
        const profileUpdateValues = [];
        let profileParamIndex = 1;

        if (updateData.studentNumber !== undefined) {
          profileUpdateFields.push(`student_number = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.studentNumber);
          profileParamIndex++;
        }
        if (updateData.currentYear !== undefined) {
          profileUpdateFields.push(`current_year = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.currentYear);
          profileParamIndex++;
        }
        if (updateData.status !== undefined) {
          profileUpdateFields.push(`status = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.status);
          profileParamIndex++;
        }
        if (updateData.bio !== undefined) {
          profileUpdateFields.push(`bio = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.bio);
          profileParamIndex++;
        }
        if (updateData.dateOfBirth !== undefined) {
          profileUpdateFields.push(`date_of_birth = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.dateOfBirth);
          profileParamIndex++;
        }
        if (updateData.placeOfBirth !== undefined) {
          profileUpdateFields.push(`place_of_birth = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.placeOfBirth);
          profileParamIndex++;
        }
        if (updateData.nationality !== undefined) {
          profileUpdateFields.push(`nationality = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.nationality);
          profileParamIndex++;
        }
        if (updateData.address !== undefined) {
          profileUpdateFields.push(`address = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.address);
          profileParamIndex++;
        }
        if (updateData.phone !== undefined) {
          profileUpdateFields.push(`phone = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.phone);
          profileParamIndex++;
        }
        if (updateData.emergencyPhone !== undefined) {
          profileUpdateFields.push(`emergency_phone = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.emergencyPhone);
          profileParamIndex++;
        }
        if (updateData.fatherName !== undefined) {
          profileUpdateFields.push(`father_name = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.fatherName);
          profileParamIndex++;
        }
        if (updateData.motherName !== undefined) {
          profileUpdateFields.push(`mother_name = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.motherName);
          profileParamIndex++;
        }
        if (updateData.birthCertificateNumber !== undefined) {
          profileUpdateFields.push(`birth_certificate_number = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.birthCertificateNumber);
          profileParamIndex++;
        }
        if (updateData.birthCertificateDate !== undefined) {
          profileUpdateFields.push(`birth_certificate_date = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.birthCertificateDate);
          profileParamIndex++;
        }
        if (updateData.civilRegistryOffice !== undefined) {
          profileUpdateFields.push(`civil_registry_office = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.civilRegistryOffice);
          profileParamIndex++;
        }
        if (updateData.subPrefecture !== undefined) {
          profileUpdateFields.push(`sub_prefecture = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.subPrefecture);
          profileParamIndex++;
        }
        if (updateData.residence !== undefined) {
          profileUpdateFields.push(`residence = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.residence);
          profileParamIndex++;
        }
        if (updateData.studentMatricule !== undefined) {
          profileUpdateFields.push(`student_matricule = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.studentMatricule);
          profileParamIndex++;
        }
        if (updateData.establishmentMatricule !== undefined) {
          profileUpdateFields.push(`establishment_matricule = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.establishmentMatricule);
          profileParamIndex++;
        }
        // Keep student_number and establishment_matricule synchronized
        if (updateData.studentNumber !== undefined && updateData.establishmentMatricule === undefined) {
          profileUpdateFields.push(`establishment_matricule = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.studentNumber);
          profileParamIndex++;
        } else if (updateData.establishmentMatricule !== undefined && updateData.studentNumber === undefined) {
          profileUpdateFields.push(`student_number = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.establishmentMatricule);
          profileParamIndex++;
        }
        if (updateData.dspsMatricule !== undefined) {
          profileUpdateFields.push(`dsps_matricule = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.dspsMatricule);
          profileParamIndex++;
        }
        if (updateData.dspsPreviousMatricule !== undefined) {
          profileUpdateFields.push(`dsps_previous_matricule = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.dspsPreviousMatricule);
          profileParamIndex++;
        }

        // Check if gender column exists and handle gender update
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'student_profiles' 
          AND column_name = 'gender'
        `);
        const hasGenderColumn = columnCheck.rows.length > 0;

        if (updateData.gender !== undefined && hasGenderColumn) {
          profileUpdateFields.push(`gender = $${profileParamIndex}`);
          profileUpdateValues.push(updateData.gender);
          profileParamIndex++;
        }

        // Always update the updated_at timestamp
        profileUpdateFields.push(`updated_at = NOW()`);

        if (profileUpdateFields.length === 1) { // Only updated_at was added
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        // Execute profile update
        const genderSelect = hasGenderColumn ? ', gender' : '';
        const profileUpdateQuery = `
          UPDATE student_profiles
          SET ${profileUpdateFields.join(', ')}
          WHERE id = $${profileParamIndex} AND tenant_id = $${profileParamIndex + 1}
          RETURNING id, tenant_id, user_id, student_number, current_year, status, bio,
                    date_of_birth, place_of_birth, nationality, address, phone,
                    emergency_phone, father_name, mother_name, birth_certificate_number, birth_certificate_date,
                    civil_registry_office, sub_prefecture, residence,
                    student_matricule, establishment_matricule, dsps_matricule, dsps_previous_matricule
                    ${genderSelect}, is_active, created_at, updated_at
        `;

        profileUpdateValues.push(id, request.tenantId);
        const profileUpdateResult = await client.query(profileUpdateQuery, profileUpdateValues);

        // Get updated user information
        const userQuery = `
          SELECT id, email, first_name, last_name
          FROM users
          WHERE id = $1 AND tenant_id = $2
        `;
        const userResult = await client.query(userQuery, [existingStudent.user_id, request.tenantId]);

        await client.query('COMMIT');

        const profile = profileUpdateResult.rows[0];
        const user = userResult.rows[0];

        const response = {
          id: profile.id,
          tenantId: profile.tenant_id,
          userId: profile.user_id,
          studentNumber: profile.student_number,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          currentYear: profile.current_year,
          status: profile.status,
          bio: profile.bio,
          dateOfBirth: profile.date_of_birth,
          placeOfBirth: profile.place_of_birth,
          nationality: profile.nationality,
          address: profile.address,
          phone: profile.phone,
          emergencyPhone: profile.emergency_phone,
          fatherName: profile.father_name,
          motherName: profile.mother_name,
          birthCertificateNumber: profile.birth_certificate_number,
          birthCertificateDate: profile.birth_certificate_date,
          civilRegistryOffice: profile.civil_registry_office,
          subPrefecture: profile.sub_prefecture,
          residence: profile.residence,
          studentMatricule: profile.student_matricule,
          establishmentMatricule: profile.establishment_matricule,
          dspsMatricule: profile.dsps_matricule,
          dspsPreviousMatricule: profile.dsps_previous_matricule,
          gender: profile.gender || 'masculin', // Default to 'masculin' if column doesn't exist yet
          createdAt: profile.created_at,
          updatedAt: profile.updated_at,
        };

        reply.send(response);
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error updating student: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while updating the student",
        });
      } finally {
        client.release();
      }
    },
  });


  // DELETE /api/v1/students/:id - Delete student
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: { type: "null" },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
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

      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Ensure student exists in this tenant
        const existsRes = await client.query(
          `SELECT id FROM student_profiles WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (existsRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Student not found',
          });
        }

        try {
          // Delete student profile (and optionally cascade if set in schema)
          await client.query(
            `DELETE FROM student_profiles WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
          );
          await client.query('COMMIT');
          return reply.status(204).send();
        } catch (err: any) {
          await client.query('ROLLBACK');
          // 23503 = foreign_key_violation (referential integrity)
          if (err && err.code === '23503') {
            return reply.status(409).send({
              error: 'Conflict',
              message: 'Impossible de supprimer cet étudiant car il est référencé par d\'autres enregistrements.',
            });
          }
          fastify.log.error(`Error deleting student: ${err}`);
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: 'An error occurred while deleting the student',
          });
        }
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/students/:studentId/parents - Assign parent to student (admin only)
  fastify.post("/:studentId/parents", {
    schema: {
      tags: ['Students', 'Parents'],
      summary: 'Assign parent to student (admin only)',
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["parentId"],
        properties: {
          parentId: { type: "string", format: "uuid" },
          relationshipType: { type: "string", enum: ["parent", "guardian", "emergency_contact"], default: "parent" },
          isPrimaryContact: { type: "boolean", default: false },
          emergencyContact: { type: "boolean", default: false },
          canPickup: { type: "boolean", default: true },
          notes: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                studentId: { type: "string", format: "uuid" },
                parentId: { type: "string", format: "uuid" },
                relationshipType: { type: "string" },
                isPrimaryContact: { type: "boolean" },
                emergencyContact: { type: "boolean" },
                canPickup: { type: "boolean" },
                notes: { type: "string", nullable: true },
                createdAt: { type: "string" },
              },
            },
          },
        },
        403: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      // Check if user has admin role
      const userRoles = (request as any).user?.roles || [];
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const { studentId } = request.params as { studentId: string };
      const parentData = CreateStudentParentSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Set tenant context for RLS
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Check if student exists
        const studentCheck = await client.query(
          'SELECT id FROM student_profiles WHERE id = $1 AND tenant_id = $2',
          [studentId, request.tenantId]
        );

        if (studentCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "Student not found",
          });
        }

        // Check if parent exists and has parent role
        const parentCheck = await client.query(
          `SELECT u.id 
           FROM users u
           INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
           INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
           WHERE u.id = $1 AND u.tenant_id = $2`,
          [parentData.parentId, request.tenantId]
        );

        if (parentCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "Parent not found or does not have parent role",
          });
        }

        // Check if relationship already exists
        const existingCheck = await client.query(
          'SELECT id FROM student_parents WHERE student_id = $1 AND parent_id = $2 AND tenant_id = $3',
          [studentId, parentData.parentId, request.tenantId]
        );

        if (existingCheck.rows.length > 0) {
          return reply.status(409).send({
            success: false,
            error: "Conflict",
            message: "Parent-student relationship already exists",
          });
        }

        // Create relationship
        const insertQuery = `
          INSERT INTO student_parents (
            tenant_id, student_id, parent_id, relationship_type,
            is_primary_contact, emergency_contact, can_pickup, notes, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          RETURNING id, tenant_id, student_id, parent_id, relationship_type,
                    is_primary_contact, emergency_contact, can_pickup, notes, created_at
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          studentId,
          parentData.parentId,
          parentData.relationshipType || 'parent',
          parentData.isPrimaryContact || false,
          parentData.emergencyContact || false,
          parentData.canPickup !== undefined ? parentData.canPickup : true,
          parentData.notes || null,
        ]);

        await client.query('COMMIT');

        const relationship = result.rows[0];

        return reply.status(201).send({
          success: true,
          data: {
            id: relationship.id,
            studentId: relationship.student_id,
            parentId: relationship.parent_id,
            relationshipType: relationship.relationship_type,
            isPrimaryContact: relationship.is_primary_contact,
            emergencyContact: relationship.emergency_contact,
            canPickup: relationship.can_pickup,
            notes: relationship.notes,
            createdAt: relationship.created_at,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error creating student-parent relationship: ${error}`);
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "An error occurred while creating the relationship",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/students/:studentId/parents - List parents for a student
  fastify.get("/:studentId/parents", {
    schema: {
      tags: ['Students', 'Parents'],
      summary: 'List parents for a student',
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                parents: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      relationshipId: { type: "string", format: "uuid" },
                      email: { type: "string" },
                      firstName: { type: "string" },
                      lastName: { type: "string" },
                      name: { type: "string" },
                      relationshipType: { type: "string" },
                      isPrimaryContact: { type: "boolean" },
                      emergencyContact: { type: "boolean" },
                      canPickup: { type: "boolean" },
                      notes: { type: "string", nullable: true },
                    },
                  },
                },
                total: { type: "number" },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { studentId } = request.params as { studentId: string };
      const client = await fastify.pg.connect();

      try {
        // Set tenant context for RLS
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Check if student exists
        const studentCheck = await client.query(
          'SELECT id FROM student_profiles WHERE id = $1 AND tenant_id = $2',
          [studentId, request.tenantId]
        );

        if (studentCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "Student not found",
          });
        }

        // Get parents for student
        const parentsQuery = `
          SELECT 
            sp.id as relationship_id,
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.name,
            sp.relationship_type,
            sp.is_primary_contact,
            sp.emergency_contact,
            sp.can_pickup,
            sp.notes
          FROM student_parents sp
          JOIN users u ON sp.parent_id = u.id
          WHERE sp.student_id = $1 AND sp.tenant_id = $2
          ORDER BY sp.is_primary_contact DESC, u.last_name, u.first_name
        `;

        const parentsResult = await client.query(parentsQuery, [studentId, request.tenantId]);

        const parents = parentsResult.rows.map((row: any) => ({
          id: row.id,
          relationshipId: row.relationship_id,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          name: row.name || `${row.first_name} ${row.last_name}`,
          relationshipType: row.relationship_type,
          isPrimaryContact: row.is_primary_contact,
          emergencyContact: row.emergency_contact,
          canPickup: row.can_pickup,
          notes: row.notes,
        }));

        return reply.send({
          success: true,
          data: {
            parents,
            total: parents.length,
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching student parents: ${error}`);
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "An error occurred while fetching parents",
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/students/:studentId/parents/:parentId - Unassign parent from student (admin only)
  fastify.delete("/:studentId/parents/:parentId", {
    schema: {
      tags: ['Students', 'Parents'],
      summary: 'Unassign parent from student (admin only)',
      params: {
        type: "object",
        required: ["studentId", "parentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
          parentId: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: { type: "null" },
        403: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      // Check if user has admin role
      const userRoles = (request as any).user?.roles || [];
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const { studentId, parentId } = request.params as { studentId: string; parentId: string };
      const client = await fastify.pg.connect();

      try {
        await client.query('BEGIN');

        // Set tenant context for RLS
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Check if relationship exists
        const relationshipCheck = await client.query(
          'SELECT id FROM student_parents WHERE student_id = $1 AND parent_id = $2 AND tenant_id = $3',
          [studentId, parentId, request.tenantId]
        );

        if (relationshipCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "Parent-student relationship not found",
          });
        }

        // Delete relationship
        await client.query(
          'DELETE FROM student_parents WHERE student_id = $1 AND parent_id = $2 AND tenant_id = $3',
          [studentId, parentId, request.tenantId]
        );

        await client.query('COMMIT');
        return reply.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error deleting student-parent relationship: ${error}`);
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "An error occurred while deleting the relationship",
        });
      } finally {
        client.release();
      }
    },
  });


}
