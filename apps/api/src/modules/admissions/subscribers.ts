/**
 * Abonnés du module `admissions` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement). Tous idempotents
 * par `event.id` (`idempotent()` du SDK) ET par construction (les états sont testés).
 *
 *  - `admissions.derive-enrolled`        `academic.enrollment.confirmed` -> `ENROLLED` DÉRIVÉ de la confirmation (décision métier du
 *    2026-10-01 : confirmation AUTOMATIQUE après paiement des frais d'inscription, par `academic`) ; élève activé, pièces rattachées.
 *    Un événement en double ou tardif ne produit qu'un seul passage à `ENROLLED`.
 *  - `admissions.close-on-enrollment-cancelled` / `…-withdrawn`  l'inscription d'un dossier en attente de paiement disparaît ->
 *    dossier clos, place libérée.
 *  - `admissions.initialize-institution` `tenancy.institution.created` -> paramètres, workflow modèle publié, motifs par défaut.
 *
 * Les ports (`people`, `documents`) viennent de `setAdmissionsWorkerPorts` (branché par `installWorkerAdapters`) ; sans eux l'abonné
 * échoue FERMÉ et l'événement est rejoué (jamais de passage à `ENROLLED` sans activer l'élève).
 */
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { admissionsConsumedEnrollmentEventSchema, admissionsConsumedExamResultSchema, admissionsConsumedInstitutionCreatedSchema } from "@ecoledigitale/contracts/src/v2/admissions";
import { ensureInstitutionDefaults } from "./application/defaults";
import { handleEnrollmentConfirmed, handleEnrollmentEnded } from "./application/enrollment-events";
import { recordTransmittedResult } from "./application/exam-results";
import { ConsumedEvents } from "./domain/events";
import { workerDeps } from "./worker";

const RETRY = { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 } as const;

export default [
  defineSubscriber({
    name: "admissions.derive-enrolled",
    pattern: ConsumedEvents.ENROLLMENT_CONFIRMED,
    retry: RETRY,
    handler: idempotent("admissions.derive-enrolled", async (event, ctx) => {
      const parsed = admissionsConsumedEnrollmentEventSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "admissions : charge utile academic.enrollment.confirmed illisible, ignorée");
        return;
      }
      const deps = workerDeps({ tenantDb: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger });
      const r = await handleEnrollmentConfirmed(deps, ctx.db.ctx, { enrollmentId: parsed.data.enrollmentId, studentId: parsed.data.studentId });
      if (!r.ok) throw r.error;
      if (!r.value.ignored) ctx.logger.info({ applicationId: r.value.applicationId, alreadyEnrolled: r.value.alreadyEnrolled, documentsLinked: r.value.documentsLinked }, "admissions : inscription confirmée traitée");
    }),
  }),
  defineSubscriber({
    name: "admissions.close-on-enrollment-cancelled",
    pattern: ConsumedEvents.ENROLLMENT_CANCELLED,
    retry: RETRY,
    handler: idempotent("admissions.close-on-enrollment-cancelled", async (event, ctx) => {
      const parsed = admissionsConsumedEnrollmentEventSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const r = await handleEnrollmentEnded(workerDeps({ tenantDb: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger }), ctx.db.ctx, { enrollmentId: parsed.data.enrollmentId });
      if (!r.ok) throw r.error;
    }),
  }),
  defineSubscriber({
    name: "admissions.close-on-enrollment-withdrawn",
    pattern: ConsumedEvents.ENROLLMENT_WITHDRAWN,
    retry: RETRY,
    handler: idempotent("admissions.close-on-enrollment-withdrawn", async (event, ctx) => {
      const parsed = admissionsConsumedEnrollmentEventSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const r = await handleEnrollmentEnded(workerDeps({ tenantDb: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger }), ctx.db.ctx, { enrollmentId: parsed.data.enrollmentId });
      if (!r.ok) throw r.error;
    }),
  }),
  defineSubscriber({
    name: "admissions.record-exam-result",
    pattern: ConsumedEvents.EXAM_RESULT_TRANSMITTED,
    retry: RETRY,
    handler: idempotent("admissions.record-exam-result", async (event, ctx) => {
      // Q-E18 : « admis / non admis » ET moyenne d'un élève (CEPE -> 6e). Charge lue minimale ; jamais journalisée (contient la moyenne).
      const parsed = admissionsConsumedExamResultSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "admissions : charge utile examinations.result.transmitted illisible, ignorée");
        return;
      }
      const p = parsed.data;
      const r = await recordTransmittedResult(
        workerDeps({ tenantDb: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger }),
        ctx.db.ctx,
        { sessionId: p.sessionId, candidateId: p.candidateId, resultId: p.resultId, studentId: p.studentId, institutionId: p.institutionId, examTypeCode: p.examTypeCode, sessionYear: p.sessionYear, outcome: p.outcome, admitted: p.admitted, average: p.average, revision: p.revision },
        event.id,
      );
      if (!r.ok) {
        // Charge hors contrat : ignorée avec un avertissement (un rejeu n'y changerait rien) ; toute autre erreur est rejouée.
        if (r.error.code === "admissions.invalid_input") {
          ctx.logger.warn({ eventId: event.id, resultId: p.resultId, code: r.error.code }, "admissions : résultat d'examen hors contrat, ignoré");
          return;
        }
        throw r.error;
      }
      ctx.logger.info({ resultId: p.resultId, stored: r.value.stored }, "admissions : résultat d'examen reçu");
    }),
  }),
  defineSubscriber({
    name: "admissions.initialize-institution",
    pattern: ConsumedEvents.INSTITUTION_CREATED,
    retry: RETRY,
    handler: idempotent("admissions.initialize-institution", async (event, ctx) => {
      const parsed = admissionsConsumedInstitutionCreatedSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "admissions : charge utile tenancy.institution.created illisible, ignorée");
        return;
      }
      const r = await ensureInstitutionDefaults(workerDeps({ tenantDb: ctx.tenantDb, systemDb: ctx.systemDb, logger: ctx.logger }), ctx.db.ctx, parsed.data.institutionId);
      if (!r.ok) throw r.error;
      ctx.logger.info({ institutionId: parsed.data.institutionId, workflowCreated: r.value.workflowCreated }, "admissions : établissement initialisé");
    }),
  }),
];
