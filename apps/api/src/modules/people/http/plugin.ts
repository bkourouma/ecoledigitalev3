/**
 * Plugin Fastify du module `people` — routes `/api/v1/people/*` (le registre applique le préfixe).
 *
 * Contrat d'assemblage `(app, runtime)` (`platform/runtime.ts`) : le `default` construit les dépendances depuis le
 * `ModuleRuntime` ; `peoplePlugin(app, { deps, requirePermission })` est le plugin « nu » (tests, câblage particulier).
 *
 * Sécurité (spec 008/009) :
 *  - AUCUNE confiance dans un en-tête client : l'identité est `request.ctx` (posé en amont par iam / l'authentification) ;
 *  - autorisation en deux temps : `requirePermission` (rbac) puis règle de domaine (`student.class.read` ⇒ classes de
 *    l'enseignant ; `student.child.read` ⇒ `isGuardianOfStudent` ; `student.self.read` ⇒ son propre dossier). Un élève hors
 *    périmètre répond 404 (jamais 403) : l'existence d'un dossier n'est pas divulguée ;
 *  - champs sensibles uniquement par `GET /students/:id/sensitive` (permission dédiée, lecture auditée) ;
 *  - `Cache-Control: no-store` sur toutes les réponses (données personnelles) ; erreurs sans message interne.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { z, ZodError, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import * as c from "@ecoledigitale/contracts/src/v2/people";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { createPeopleDeps, type PeopleDeps } from "../application/deps";
import { PeopleErrors } from "../domain/errors";
import { resolveStudentAudience, resolveStudentListScope, type PermissionProbe } from "../application/access";
import { getPersonQualities, linkPersonToIdentity, provisionPortalAccount, type PersonQuality } from "../application/accounts";
import * as guardiansUc from "../application/guardians";
import { rebuildEnrollmentProjection } from "../application/projection";
import * as settingsUc from "../application/settings";
import * as staffUc from "../application/staff";
import * as studentsUc from "../application/students";
import * as teachingUc from "../application/teaching";
import { resolveStaffForIdentity } from "../application/staff";
import type { RoleVisibility } from "../application/support";
import { peopleAuditAdapter } from "../infrastructure/audit-adapter";
import { createIamAccountProvisioner } from "../infrastructure/iam-account-provisioner";

export interface PeoplePluginOptions {
  deps: PeopleDeps;
  /** Garde de permission du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Contexte de la requête (défaut : `request.ctx` posé par l'authentification). */
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

function zodToValidation(error: ZodError): ValidationError {
  const codes = error.issues.map((i) => (i.code === "custom" ? (i.params as { code?: string } | undefined)?.code : undefined));
  const stable = codes.find((code): code is string => typeof code === "string" && code.startsWith("people."));
  return new ValidationError(
    "Données invalides.",
    error.issues.map((i, n) => ({ path: i.path, message: i.message, code: codes[n] ?? i.code })),
    stable ? { code: stable } : undefined,
  );
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function unwrap<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

const idParams = c.peopleIdParamsSchema;

/** Schéma d'objet strict (paramètres de route, requêtes). */
const z_obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const z_bool = () => z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

export async function peoplePlugin(app: FastifyInstance, options: PeoplePluginOptions): Promise<void> {
  const { deps } = options;
  const perm = options.requirePermission;
  const ctxOf = (request: FastifyRequest): RequestContext => {
    const ctx = options.resolveContext ? options.resolveContext(request) : getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  /** `anyOf("a", "b")` : passe si l'acteur détient l'une des permissions (le premier refus est renvoyé sinon). */
  const anyOf = (...permissions: string[]): preHandlerAsyncHookHandler => {
    const guards = permissions.map((p) => perm(p));
    if (guards.length === 1) return guards[0] as preHandlerAsyncHookHandler;
    return async function anyOfGuard(this: FastifyInstance, request, reply) {
      let first: unknown;
      for (const g of guards) {
        try {
          await g.call(this, request, reply);
          return;
        } catch (e) {
          if (!(e instanceof ForbiddenError)) throw e;
          first ??= e;
        }
      }
      throw first;
    };
  };

  /** Sonde de permission (sans exception pour un simple refus) ; mémorisée pour la requête. */
  const probeOf = (request: FastifyRequest, reply: FastifyReply): PermissionProbe => {
    const cache = new Map<string, boolean>();
    return async (permission) => {
      const hit = cache.get(permission);
      if (hit !== undefined) return hit;
      let allowed = false;
      try {
        await perm(permission).call(app, request, reply);
        allowed = true;
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
      cache.set(permission, allowed);
      return allowed;
    };
  };

  const visibilityOf = async (can: PermissionProbe): Promise<RoleVisibility> => ({
    student: await can("student.read"),
    guardian: await can("guardian.read"),
    staff: await can("staff.read"),
  });

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "people : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    // Données personnelles : jamais de cache navigateur / intermédiaire.
    scope.addHook("onSend", async (_request, reply, payload) => {
      void reply.header("Cache-Control", "no-store");
      return payload;
    });
    // Photos : corps binaire brut (le type réel est contrôlé par octets magiques).
    scope.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "application/octet-stream"], { parseAs: "buffer", bodyLimit: deps.config.photoMaxBytes + 1024 }, (_req, body, done) => done(null, body));

    // =============================================================================================================
    // Élèves
    // =============================================================================================================
    scope.get("/students", { preHandler: anyOf("student.list", "student.class.read") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(c.peopleListStudentsQuerySchema, req.query);
      const can = probeOf(req, reply);
      const scopeRes = unwrap(await resolveStudentListScope(deps, ctx, can));
      return unwrap(await studentsUc.listStudents(deps, ctx, q, { scope: scopeRes, allowNationalIdSearch: await can("student.sensitive.read") }));
    });

    scope.get("/students/duplicates", { preHandler: perm("student.create") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(c.peopleDuplicateQuerySchema, req.query);
      return { items: unwrap(await studentsUc.findDuplicateStudents(deps, ctx, q, await visibilityOf(probeOf(req, reply)))) };
    });

    scope.get("/students/export", { preHandler: perm("student.export") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(c.peopleListStudentsQuerySchema.partial(), req.query);
      const out = unwrap(await studentsUc.exportStudents(deps, ctx, q));
      return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="eleves.csv"').send(out.csv);
    });

    scope.post("/students", { preHandler: perm("student.create") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const body = parse(c.peopleCreateStudentBodySchema, req.body);
      const can = probeOf(req, reply);
      const out = unwrap(await studentsUc.createStudent(deps, ctx, body, { visibility: await visibilityOf(can), allowSensitive: await can("student.sensitive.read") }));
      if (out.kind === "validated") return { valid: true, duplicates: out.duplicates };
      return reply.status(out.replayed ? 200 : 201).send({ student: out.student, replayed: out.replayed });
    });

    scope.get("/students/:id", { preHandler: anyOf("student.read", "student.class.read") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParams, req.params);
      const access = unwrap(await resolveStudentAudience(deps, ctx, id, probeOf(req, reply)));
      return unwrap(await studentsUc.getStudent(deps, ctx, id, access));
    });

    scope.patch("/students/:id", { preHandler: perm("student.update") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParams, req.params);
      const body = parse(c.peopleUpdateStudentBodySchema, req.body);
      return unwrap(await studentsUc.updateStudent(deps, ctx, id, body, { allowSensitive: await probeOf(req, reply)("student.sensitive.read") }));
    });

    scope.get("/students/:id/sensitive", { preHandler: perm("student.sensitive.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await studentsUc.getStudentSensitive(deps, ctxOf(req), id));
    });

    scope.post("/students/:id/status", { preHandler: perm("student.status.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await studentsUc.changeStudentStatus(deps, ctxOf(req), id, parse(c.peopleChangeStatusBodySchema, req.body)));
    });

    scope.get("/students/:id/history", { preHandler: perm("student.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await studentsUc.getStatusHistory(deps, ctxOf(req), id)) };
    });

    scope.get("/students/:id/enrollments", { preHandler: perm("student.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await studentsUc.listStudentEnrollments(deps, ctxOf(req), id)) };
    });

    scope.post("/students/:id/anonymize", { preHandler: perm("student.anonymize") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await studentsUc.anonymizeStudent(deps, ctxOf(req), id, parse(c.peopleAnonymizeBodySchema, req.body)));
    });

    // --- photo ----------------------------------------------------------------------------------------------
    scope.put("/students/:id/photo", { preHandler: perm("student.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw PeopleErrors.invalidImage("Corps binaire attendu (JPEG, PNG ou WebP).");
      return unwrap(await studentsUc.uploadStudentPhoto(deps, ctxOf(req), id, new Uint8Array(body)));
    });
    scope.delete("/students/:id/photo", { preHandler: perm("student.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await studentsUc.removeStudentPhoto(deps, ctxOf(req), id));
    });
    scope.get("/students/:id/photo", { preHandler: anyOf("student.read", "student.class.read") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParams, req.params);
      unwrap(await resolveStudentAudience(deps, ctx, id, probeOf(req, reply)));
      const url = unwrap(await studentsUc.getStudentPhotoUrl(deps, ctx, id));
      if (!url) throw PeopleErrors.studentNotFound();
      return url;
    });

    // --- contacts d'urgence ---------------------------------------------------------------------------------
    scope.get("/students/:id/emergency-contacts", { preHandler: anyOf("student.read", "student.class.read") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParams, req.params);
      unwrap(await resolveStudentAudience(deps, ctx, id, probeOf(req, reply)));
      return { items: unwrap(await studentsUc.listEmergencyContacts(deps, ctx, id)) };
    });
    scope.post("/students/:id/emergency-contacts", { preHandler: perm("student.update") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      return reply.status(201).send(unwrap(await studentsUc.addEmergencyContact(deps, ctxOf(req), id, parse(c.peopleEmergencyContactBodySchema, req.body))));
    });
    scope.patch("/students/:id/emergency-contacts/:cid", { preHandler: perm("student.update") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ cid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await studentsUc.updateEmergencyContact(deps, ctxOf(req), p.id, p.cid, parse(c.peopleEmergencyContactPatchSchema, req.body)));
    });
    scope.delete("/students/:id/emergency-contacts/:cid", { preHandler: perm("student.update") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ cid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await studentsUc.removeEmergencyContact(deps, ctxOf(req), p.id, p.cid));
    });

    // --- antécédents scolaires ------------------------------------------------------------------------------
    scope.get("/students/:id/prior-education", { preHandler: perm("student.read") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await studentsUc.listPriorEducation(deps, ctxOf(req), id, { withSensitive: await probeOf(req, reply)("student.sensitive.read") })) };
    });
    scope.post("/students/:id/prior-education", { preHandler: perm("student.update") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const body = parse(c.peoplePriorEducationBodySchema, req.body);
      const withSensitive = await probeOf(req, reply)("student.sensitive.read");
      if (body.referenceNumber !== undefined && !withSensitive) throw new ForbiddenError("Le numéro de diplôme est une donnée sensible.");
      return reply.status(201).send(unwrap(await studentsUc.addPriorEducation(deps, ctxOf(req), id, body, { withSensitive })));
    });
    scope.patch("/students/:id/prior-education/:eid", { preHandler: perm("student.update") }, async (req, reply) => {
      const p = parse(c.peopleIdParamsSchema.extend({ eid: c.peopleUuidSchema }).strict(), req.params);
      const body = parse(c.peoplePriorEducationPatchSchema, req.body);
      const withSensitive = await probeOf(req, reply)("student.sensitive.read");
      if (body.referenceNumber !== undefined && !withSensitive) throw new ForbiddenError("Le numéro de diplôme est une donnée sensible.");
      return unwrap(await studentsUc.updatePriorEducation(deps, ctxOf(req), p.id, p.eid, { kind: undefined, label: undefined, institutionName: undefined, schoolYear: undefined, levelLabel: undefined, seriesLabel: undefined, obtainedOn: undefined, referenceNumber: undefined, note: undefined, ...body }, { withSensitive }));
    });
    scope.delete("/students/:id/prior-education/:eid", { preHandler: perm("student.update") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ eid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await studentsUc.removePriorEducation(deps, ctxOf(req), p.id, p.eid));
    });

    // --- tuteurs d'un élève ---------------------------------------------------------------------------------
    scope.get("/students/:id/guardians", { preHandler: perm("guardian.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      const q = parse(z.object({ includeClosed: z_bool().optional() }), req.query);
      return { items: unwrap(await guardiansUc.listGuardiansOfStudent(deps, ctxOf(req), id, { includeClosed: q.includeClosed === true })) };
    });
    scope.post("/students/:id/guardians", { preHandler: perm("guardian.manage") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      return reply.status(201).send(unwrap(await guardiansUc.linkGuardian(deps, ctxOf(req), id, parse(c.peopleLinkGuardianBodySchema, req.body))));
    });
    scope.patch("/students/:id/guardians/:linkId", { preHandler: perm("guardian.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ linkId: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await guardiansUc.updateGuardianLink(deps, ctxOf(req), p.id, p.linkId, parse(c.peopleUpdateLinkBodySchema, req.body)));
    });
    scope.delete("/students/:id/guardians/:linkId", { preHandler: perm("guardian.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ linkId: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await guardiansUc.unlinkGuardian(deps, ctxOf(req), p.id, p.linkId, parse(c.peopleUnlinkBodySchema, req.query)));
    });

    // =============================================================================================================
    // Tuteurs
    // =============================================================================================================
    scope.get("/guardians", { preHandler: perm("guardian.read") }, async (req) => unwrap(await guardiansUc.listGuardians(deps, ctxOf(req), parse(c.peopleListGuardiansQuerySchema, req.query))));
    scope.post("/guardians", { preHandler: perm("guardian.manage") }, async (req, reply) => {
      const out = unwrap(await guardiansUc.createGuardian(deps, ctxOf(req), parse(c.peopleCreateGuardianBodySchema, req.body), { visibility: await visibilityOf(probeOf(req, reply)) }));
      return reply.status(201).send(out);
    });
    scope.get("/guardians/:id", { preHandler: perm("guardian.read") }, async (req) => unwrap(await guardiansUc.getGuardian(deps, ctxOf(req), parse(idParams, req.params).id)));
    scope.patch("/guardians/:id", { preHandler: perm("guardian.manage") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await guardiansUc.updateGuardian(deps, ctxOf(req), id, parse(c.peopleUpdateGuardianBodySchema, req.body)));
    });

    // =============================================================================================================
    // Portails : élève, parent, personnel
    // =============================================================================================================
    scope.get("/me/student", { preHandler: perm("student.self.read") }, async (req) => {
      const ctx = ctxOf(req);
      return unwrap(await guardiansUc.getMyStudent(deps, ctx, ctx.userId as string));
    });
    scope.patch("/me/student", { preHandler: perm("student.self.update") }, async (req) => {
      const ctx = ctxOf(req);
      return unwrap(await guardiansUc.updateMyContact(deps, ctx, ctx.userId as string, "STUDENT", parse(c.peopleOwnContactPatchSchema, req.body)));
    });

    scope.get("/children", { preHandler: perm("student.child.read") }, async (req) => {
      const ctx = ctxOf(req);
      return { items: unwrap(await guardiansUc.listChildrenOfIdentity(deps, ctx, ctx.userId as string)) };
    });
    scope.get("/children/:studentId", { preHandler: perm("student.child.read") }, async (req) => {
      const ctx = ctxOf(req);
      const p = parse(z_obj({ studentId: c.peopleUuidSchema }), req.params);
      return unwrap(await guardiansUc.getChildView(deps, ctx, ctx.userId as string, p.studentId));
    });
    scope.patch("/children/:studentId/emergency-contacts/:cid", { preHandler: perm("student.child.update") }, async (req) => {
      const ctx = ctxOf(req);
      const p = parse(z_obj({ studentId: c.peopleUuidSchema, cid: c.peopleUuidSchema }), req.params);
      return unwrap(await guardiansUc.updateChildEmergencyContact(deps, ctx, ctx.userId as string, p.studentId, p.cid, parse(c.peopleEmergencyContactPatchSchema, req.body)));
    });

    scope.patch("/me/guardian", { preHandler: perm("student.child.update") }, async (req) => {
      const ctx = ctxOf(req);
      return unwrap(await guardiansUc.updateMyContact(deps, ctx, ctx.userId as string, "GUARDIAN", parse(c.peopleOwnContactPatchSchema, req.body)));
    });

    /** Coordonnées de la personne connectée, quelle que soit sa qualité (tuteur, élève, personnel) selon ses permissions. */
    scope.patch("/me/contact", { preHandler: anyOf("student.child.update", "student.self.update", "staff.own.update") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const patch = parse(c.peopleOwnContactPatchSchema, req.body);
      const can = probeOf(req, reply);
      const order: Array<[string, "STAFF" | "GUARDIAN" | "STUDENT"]> = [
        ["staff.own.update", "STAFF"],
        ["student.child.update", "GUARDIAN"],
        ["student.self.update", "STUDENT"],
      ];
      for (const [permission, quality] of order) {
        if (!(await can(permission))) continue;
        const res = await guardiansUc.updateMyContact(deps, ctx, ctx.userId as string, quality, patch);
        if (res.ok) return res.value;
        if (res.error.httpStatus !== 404) throw res.error;
      }
      throw PeopleErrors.personNotFound();
    });

    scope.get("/me/staff", { preHandler: perm("staff.own.read") }, async (req) => {
      const ctx = ctxOf(req);
      const staffId = await resolveStaffForIdentity(deps, ctx, ctx.userId as string);
      if (!staffId) throw PeopleErrors.staffNotFound();
      return unwrap(await staffUc.getStaff(deps, ctx, staffId));
    });
    scope.patch("/me/staff", { preHandler: perm("staff.own.update") }, async (req) => {
      const ctx = ctxOf(req);
      const body = parse(c.peopleMyStaffPatchSchema, req.body);
      const staffId = await resolveStaffForIdentity(deps, ctx, ctx.userId as string);
      if (!staffId) throw PeopleErrors.staffNotFound();
      if (body.contact) unwrap(await guardiansUc.updateMyContact(deps, ctx, ctx.userId as string, "STAFF", body.contact));
      if (body.availabilities) unwrap(await staffUc.setAvailabilities(deps, ctx, staffId, body.availabilities));
      return unwrap(await staffUc.getStaff(deps, ctx, staffId));
    });
    scope.get("/me/classes", { preHandler: perm("staff.own.read") }, async (req) => {
      const ctx = ctxOf(req);
      const staffId = await resolveStaffForIdentity(deps, ctx, ctx.userId as string);
      if (!staffId) return { items: [] };
      return { items: unwrap(await teachingUc.listMyClasses(deps, ctx, staffId)) };
    });
    scope.get("/me/assignments", { preHandler: perm("staff.own.read") }, async (req) => {
      const ctx = ctxOf(req);
      const staffId = await resolveStaffForIdentity(deps, ctx, ctx.userId as string);
      if (!staffId) return { items: [] };
      const q = parse(c.peopleListAssignmentsQuerySchema, req.query);
      return { items: unwrap(await teachingUc.listAssignmentsForStaff(deps, ctx, staffId, q)) };
    });
    scope.get("/me/contracts", { preHandler: perm("staff.own.read") }, async (req) => {
      const ctx = ctxOf(req);
      const staffId = await resolveStaffForIdentity(deps, ctx, ctx.userId as string);
      if (!staffId) throw PeopleErrors.staffNotFound();
      return { items: unwrap(await staffUc.listContracts(deps, ctx, staffId)) };
    });

    // =============================================================================================================
    // Comptes de portail et liaison d'identité
    // =============================================================================================================
    /** Droit nécessaire pour agir sur une qualité de la personne. */
    const PERM_OF_QUALITY: Record<PersonQuality, string> = { STUDENT: "student.update", GUARDIAN: "guardian.manage", STAFF: "staff.update" };
    const authorizeOnPerson = async (req: FastifyRequest, reply: FastifyReply, personId: string, wanted?: PersonQuality): Promise<PersonQuality[]> => {
      const ctx = ctxOf(req);
      const qualities = unwrap(await getPersonQualities(deps, ctx, personId));
      const can = probeOf(req, reply);
      const candidates = wanted ? qualities.filter((q) => q === wanted) : qualities;
      for (const q of candidates) if (await can(PERM_OF_QUALITY[q])) return candidates;
      throw qualities.length === 0 ? PeopleErrors.personNotFound(personId) : new ForbiddenError("Action non autorisée.");
    };

    scope.post("/persons/:id/portal-invitation", { preHandler: anyOf("guardian.manage", "student.update", "staff.update") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const body = parse(c.peoplePortalInvitationBodySchema, req.body);
      const roleQuality: Record<string, PersonQuality | undefined> = { parent: "GUARDIAN", eleve: "STUDENT" };
      const wanted = body.quality ?? (body.role ? (roleQuality[body.role] ?? "STAFF") : undefined);
      await authorizeOnPerson(req, reply, id, wanted);
      const out = unwrap(await provisionPortalAccount(deps, ctxOf(req), { personId: id, quality: body.quality, role: body.role, channel: body.channel }));
      return reply.status(out.invited ? 201 : 200).send(out);
    });
    scope.post("/staff/:id/portal-invitation", { preHandler: perm("staff.update") }, async (req, reply) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParams, req.params);
      const body = parse(c.peoplePortalInvitationBodySchema, req.body);
      const staff = unwrap(await staffUc.getStaff(deps, ctx, id));
      const out = unwrap(await provisionPortalAccount(deps, ctx, { personId: staff.personId, quality: "STAFF", role: body.role, channel: body.channel }));
      return reply.status(out.invited ? 201 : 200).send(out);
    });
    scope.post("/persons/:id/identity", { preHandler: anyOf("guardian.manage", "student.update", "staff.update") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const body = parse(c.peopleLinkIdentityBodySchema, req.body);
      await authorizeOnPerson(req, reply, id);
      return unwrap(await linkPersonToIdentity(deps, ctxOf(req), id, body.identityId));
    });

    // =============================================================================================================
    // Personnel
    // =============================================================================================================
    // `staff.read` suffit à lister : les modèles de rôles de l'économe et du directeur des études n'accordent que `staff.read`.
    scope.get("/staff", { preHandler: anyOf("staff.list", "staff.read") }, async (req) => unwrap(await staffUc.listStaff(deps, ctxOf(req), parse(c.peopleListStaffQuerySchema, req.query))));
    scope.post("/staff", { preHandler: perm("staff.create") }, async (req, reply) => {
      const out = unwrap(await staffUc.createStaff(deps, ctxOf(req), parse(c.peopleCreateStaffBodySchema, req.body), { visibility: await visibilityOf(probeOf(req, reply)) }));
      if (out.kind === "validated") return { valid: true, duplicates: out.duplicates };
      return reply.status(out.replayed ? 200 : 201).send({ staff: out.staff, replayed: out.replayed });
    });
    scope.get("/staff/expiring-qualifications", { preHandler: perm("staff.read") }, async (req) => {
      const q = parse(c.peopleExpiringQuerySchema, req.query);
      return { items: unwrap(await staffUc.listExpiringQualifications(deps, ctxOf(req), q)) };
    });
    scope.get("/staff/:id", { preHandler: perm("staff.read") }, async (req) => unwrap(await staffUc.getStaff(deps, ctxOf(req), parse(idParams, req.params).id)));
    scope.patch("/staff/:id", { preHandler: perm("staff.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await staffUc.updateStaff(deps, ctxOf(req), id, parse(c.peopleUpdateStaffBodySchema, req.body)));
    });
    scope.post("/staff/:id/status", { preHandler: perm("staff.status.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await staffUc.changeStaffStatus(deps, ctxOf(req), id, parse(c.peopleChangeStaffStatusBodySchema, req.body)));
    });
    scope.get("/staff/:id/history", { preHandler: perm("staff.read") }, async (req) => ({ items: unwrap(await staffUc.getStaffStatusHistory(deps, ctxOf(req), parse(idParams, req.params).id)) }));
    scope.put("/staff/:id/affiliations", { preHandler: perm("staff.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await staffUc.setAffiliations(deps, ctxOf(req), id, parse(c.peopleStaffAffiliationsBodySchema, req.body).affiliations));
    });

    scope.get("/staff/:id/contracts", { preHandler: perm("staff.contract.read") }, async (req) => ({ items: unwrap(await staffUc.listContracts(deps, ctxOf(req), parse(idParams, req.params).id)) }));
    scope.post("/staff/:id/contracts", { preHandler: perm("staff.contract.manage") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      return reply.status(201).send(unwrap(await staffUc.addContract(deps, ctxOf(req), id, parse(c.peopleContractBodySchema, req.body))));
    });
    scope.patch("/staff/:id/contracts/:cid", { preHandler: perm("staff.contract.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ cid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await staffUc.updateContract(deps, ctxOf(req), p.id, p.cid, parse(c.peopleContractPatchSchema, req.body)));
    });
    scope.post("/staff/:id/contracts/:cid/end", { preHandler: perm("staff.contract.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ cid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await staffUc.endContract(deps, ctxOf(req), p.id, p.cid, parse(c.peopleEndContractBodySchema, req.body)));
    });

    scope.get("/staff/:id/qualifications", { preHandler: perm("staff.read") }, async (req) => ({ items: unwrap(await staffUc.listQualifications(deps, ctxOf(req), parse(idParams, req.params).id)) }));
    scope.post("/staff/:id/qualifications", { preHandler: perm("staff.qualification.manage") }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      return reply.status(201).send(unwrap(await staffUc.addQualification(deps, ctxOf(req), id, parse(c.peopleQualificationBodySchema, req.body))));
    });
    scope.patch("/staff/:id/qualifications/:qid", { preHandler: perm("staff.qualification.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ qid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await staffUc.updateQualification(deps, ctxOf(req), p.id, p.qid, parse(c.peopleQualificationPatchSchema, req.body)));
    });
    scope.delete("/staff/:id/qualifications/:qid", { preHandler: perm("staff.qualification.manage") }, async (req) => {
      const p = parse(c.peopleIdParamsSchema.extend({ qid: c.peopleUuidSchema }).strict(), req.params);
      return unwrap(await staffUc.removeQualification(deps, ctxOf(req), p.id, p.qid));
    });

    scope.get("/staff/:id/competencies", { preHandler: perm("staff.read") }, async (req) => ({ items: unwrap(await staffUc.listCompetencies(deps, ctxOf(req), parse(idParams, req.params).id)) }));
    scope.put("/staff/:id/competencies", { preHandler: perm("staff.update") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await staffUc.setCompetencies(deps, ctxOf(req), id, parse(c.peopleCompetenciesBodySchema, req.body).competencies)) };
    });
    scope.get("/staff/:id/availabilities", { preHandler: perm("staff.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      const q = parse(z_obj({ from: c.peopleDateSchema.optional(), to: c.peopleDateSchema.optional() }).partial(), req.query);
      return { items: unwrap(await staffUc.listAvailabilities(deps, ctxOf(req), { staffIds: [id], from: q.from, to: q.to })) };
    });
    scope.put("/staff/:id/availabilities", { preHandler: perm("staff.availability.manage") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await staffUc.setAvailabilities(deps, ctxOf(req), id, parse(c.peopleAvailabilitiesBodySchema, req.body).availabilities)) };
    });
    scope.get("/staff/:id/assignments", { preHandler: perm("teaching.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return { items: unwrap(await teachingUc.listAssignmentsForStaff(deps, ctxOf(req), id, parse(c.peopleListAssignmentsQuerySchema, req.query))) };
    });
    scope.get("/staff/:id/load", { preHandler: perm("teaching.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await staffUc.getTeachingLoad(deps, ctxOf(req), id, parse(c.peopleTeachingLoadQuerySchema, req.query)));
    });

    // =============================================================================================================
    // Affectations d'enseignement
    // =============================================================================================================
    scope.get("/teaching-assignments/unstaffed", { preHandler: perm("teaching.read") }, async (req) => ({ items: unwrap(await teachingUc.listUnstaffedNodes(deps, ctxOf(req), parse(c.peopleUnstaffedQuerySchema, req.query))) }));
    scope.get("/teaching-assignments", { preHandler: perm("teaching.read") }, async (req) => {
      const q = parse(z_obj({ staffId: c.peopleUuidSchema.optional(), classroomId: c.peopleUuidSchema.optional() }).merge(c.peopleListAssignmentsQuerySchema), req.query);
      const ctx = ctxOf(req);
      if (q.classroomId) return { items: unwrap(await teachingUc.listAssignmentsForClassroom(deps, ctx, q.classroomId, q)) };
      if (q.staffId) return { items: unwrap(await teachingUc.listAssignmentsForStaff(deps, ctx, q.staffId, q)) };
      throw ValidationError.field("staffId", "Précisez staffId ou classroomId.", "required");
    });
    scope.post("/teaching-assignments", { preHandler: perm("teaching.assign") }, async (req, reply) => {
      const out = unwrap(await teachingUc.createTeachingAssignment(deps, ctxOf(req), parse(c.peopleCreateAssignmentBodySchema, req.body)));
      return reply.status(201).send(out);
    });
    scope.get("/classrooms/:id/assignments", { preHandler: perm("teaching.read") }, async (req) => {
      const { id } = parse(idParams, req.params);
      const q = parse(c.peopleListAssignmentsQuerySchema, req.query);
      return { items: unwrap(await teachingUc.listAssignmentsForClassroom(deps, ctxOf(req), id, q)) };
    });
    scope.get("/teaching-assignments/:id", { preHandler: perm("teaching.read") }, async (req) => unwrap(await teachingUc.getTeachingAssignment(deps, ctxOf(req), parse(idParams, req.params).id)));
    scope.patch("/teaching-assignments/:id", { preHandler: perm("teaching.assign") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await teachingUc.updateTeachingAssignment(deps, ctxOf(req), id, parse(c.peopleUpdateAssignmentBodySchema, req.body)));
    });
    scope.post("/teaching-assignments/:id/end", { preHandler: perm("teaching.assign") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await teachingUc.endTeachingAssignment(deps, ctxOf(req), id, parse(c.peopleEndAssignmentBodySchema, req.body)));
    });
    scope.post("/teaching-assignments/:id/replace", { preHandler: perm("teaching.assign") }, async (req) => {
      const { id } = parse(idParams, req.params);
      return unwrap(await teachingUc.replaceTeachingAssignment(deps, ctxOf(req), id, parse(c.peopleReplaceAssignmentBodySchema, req.body)));
    });

    // =============================================================================================================
    // Référentiels, paramètres, administration
    // =============================================================================================================
    scope.get("/reference/relationship-types", { preHandler: anyOf("student.read", "guardian.read", "people.settings.manage") }, async (req) => ({ items: unwrap(await settingsUc.listRelationshipTypes(deps, ctxOf(req))) }));
    scope.put("/reference/relationship-types", { preHandler: perm("people.settings.manage") }, async (req) => unwrap(await settingsUc.upsertRelationshipType(deps, ctxOf(req), parse(c.peopleRelationshipTypeBodySchema, req.body))));
    scope.get("/reference/staff-categories", { preHandler: anyOf("staff.read", "people.settings.manage") }, async (req) => ({ items: unwrap(await settingsUc.listStaffCategories(deps, ctxOf(req))) }));
    scope.put("/reference/staff-categories", { preHandler: perm("people.settings.manage") }, async (req) => unwrap(await settingsUc.upsertStaffCategory(deps, ctxOf(req), parse(c.peopleStaffCategoryBodySchema, req.body))));
    scope.get("/reference/contract-types", { preHandler: anyOf("staff.read", "people.settings.manage") }, async (req) => ({ items: unwrap(await settingsUc.listContractTypes(deps, ctxOf(req))) }));
    scope.put("/reference/contract-types", { preHandler: perm("people.settings.manage") }, async (req) => unwrap(await settingsUc.upsertContractType(deps, ctxOf(req), parse(c.peopleContractTypeBodySchema, req.body))));

    scope.get("/settings", { preHandler: perm("people.settings.manage") }, async (req) => unwrap(await settingsUc.getSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: perm("people.settings.manage") }, async (req) => unwrap(await settingsUc.updateSettings(deps, ctxOf(req), parse(c.peopleSettingsPatchSchema, req.body))));

    scope.post("/admin/rebuild-enrollment-projection", { preHandler: perm("people.settings.manage") }, async (req) => {
      const q = parse(z_obj({ yearId: c.peopleUuidSchema.optional() }), req.body);
      return unwrap(await rebuildEnrollmentProjection(deps, ctxOf(req), q));
    });
  });
}

function maybeFastifyValidation(error: unknown): unknown {
  const e = error as { statusCode?: number; code?: string; message?: string } | null;
  if (e && typeof e === "object" && typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
    return ValidationError.field("body", e.statusCode === 413 ? "Corps de requête trop volumineux." : "Requête invalide.", e.code ?? "invalid_request");
  }
  return error;
}

/**
 * Contrat d'assemblage uniforme (`platform/runtime.ts`) : `(app, runtime)`, routes sans préfixe (le registre applique
 * `/api/v1/people`). L'audit passe par `runtime.auditPort` ; la création de comptes par `app.iam` (module iam, posé à la
 * racine par son `setup`) quand il est présent, sinon `501 people.account_provisioning_unavailable`. Les ports
 * `StoragePort`, `AcademicQuery` et `CountryProfileProvider` n'ont pas de fournisseur dans la plateforme actuelle :
 * leurs cas d'usage répondent par un refus explicite (voir README).
 */
export default async function peopleModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  const iam = (app as unknown as { iam?: Parameters<typeof createIamAccountProvisioner>[0]["iam"] }).iam;
  const deps = createPeopleDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    logger: runtime.logger,
    audit: peopleAuditAdapter(runtime.auditPort),
    ...(iam ? { accounts: createIamAccountProvisioner({ iam, tenantDb: runtime.tenantDb, clock: runtime.clock, logger: runtime.logger, audit: runtime.auditPort }) } : {}),
  });
  await app.register(peoplePlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}
