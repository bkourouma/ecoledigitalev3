/**
 * Abonnés du module `academic` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 * Tous idempotents par `event.id` (`idempotent()` du SDK) ET par construction (les états sont testés).
 *
 *  - `academic.instantiate-reference-data`  `tenancy.institution.created` -> référentiels de l'établissement depuis le
 *    modèle de son pack (idempotent, ne touche jamais une ligne personnalisée). `tenancy.tenant.provisioned` n'est pas
 *    consommé : le provisioning publie un `institution.created` par établissement créé.
 *  - `academic.confirm-on-invoice-paid`     `finance.invoice.paid` -> DÉCISION MÉTIER VALIDÉE : confirmation
 *    AUTOMATIQUE de l'inscription VISÉE après paiement des frais d'inscription ; un cours à la carte est confirmé une
 *    fois SA ligne soldée (`sourceRef = enrollmentCourseId`).
 *  - `academic.run-rollover`                `academic.rollover.requested` (son propre événement) -> exécution de l'assistant de
 *    reconduction annuelle, par étapes, avec progression et rapport (`academic.rollover_runs`).
 *  - `academic.withdraw-on-student-status`  `people.student.status_changed` -> retrait automatique des inscriptions
 *    vivantes d'un apprenant sorti (`WITHDRAWN`, `EXCLUDED`, `TRANSFERRED_OUT`), avec motif.
 *
 * Les ports (annuaires, gardes) gardent leur repli sûr dans le worker ; seuls les faits de facture peuvent y être
 * branchés (voir `InvoiceFactsReader`). Sans faits suffisants, une facture ne confirme RIEN (jamais en bloc).
 */
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import {
  academicConsumedInstitutionCreatedSchema,
  academicConsumedInvoicePaidSchema,
  academicConsumedStudentStatusChangedSchema,
  academicRolloverRequestedEventPayloadSchema,
} from "@ecoledigitale/contracts/src/v2/academic";
import { handleInvoicePaid, handleStudentStatusChanged } from "./application/confirmation";
import { executeRolloverRun } from "./application/rollover-run";
import { createAcademicDeps } from "./application/deps";
import { instantiatePackReferenceData } from "./application/reference";
import { academicWorkerPorts } from "./application/port-registry";
import { ConsumedEvents } from "./domain/events";

export default [
  // Reconduction annuelle : la requête HTTP n'enregistre qu'une demande (`academic.rollover_runs`) ; l'exécution — par
  // étapes, avec progression — se fait ici. Volontairement SANS `idempotent()` : ce wrapper tiendrait toute la reconduction
  // dans UNE transaction (progression invisible, verrous longs). L'idempotence est dans `executeRolloverRun` : une
  // exécution terminée est renvoyée telle quelle, une exécution en échec reprend, les étapes ne recréent jamais l'existant.
  defineSubscriber({
    name: "academic.run-rollover",
    pattern: ConsumedEvents.ROLLOVER_REQUESTED,
    retry: { attempts: 3, backoffMs: 5_000, maxBackoffMs: 60_000 },
    concurrency: 1,
    timeoutMs: 30 * 60_000,
    handler: async (event, ctx) => {
      const parsed = academicRolloverRequestedEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "academic : charge utile academic.rollover.requested illisible, ignorée");
        return;
      }
      const deps = createAcademicDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: academicWorkerPorts });
      const r = await executeRolloverRun(deps, ctx.db.ctx, parsed.data.runId);
      if (!r.ok) throw r.error;
      ctx.logger.info({ runId: r.value.id, status: r.value.status }, "academic : reconduction traitée");
    },
  }),
  defineSubscriber({
    name: "academic.instantiate-reference-data",
    pattern: ConsumedEvents.INSTITUTION_CREATED,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("academic.instantiate-reference-data", async (event, ctx) => {
      const parsed = academicConsumedInstitutionCreatedSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "academic : charge utile tenancy.institution.created illisible, ignorée");
        return;
      }
      const { institutionId, pack, educationSystem } = parsed.data;
      const deps = createAcademicDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: academicWorkerPorts });
      const r = await instantiatePackReferenceData(deps, ctx.db.ctx, institutionId, { pack, educationSystem });
      if (!r.ok) throw r.error;
      ctx.logger.info({ institutionId, pack, created: r.value.created, alreadyApplied: r.value.alreadyApplied }, "academic : référentiels instanciés");
    }),
  }),
  defineSubscriber({
    name: "academic.confirm-on-invoice-paid",
    pattern: ConsumedEvents.INVOICE_PAID,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("academic.confirm-on-invoice-paid", async (event, ctx) => {
      const parsed = academicConsumedInvoicePaidSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "academic : charge utile finance.invoice.paid illisible, ignorée");
        return;
      }
      const deps = createAcademicDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: academicWorkerPorts });
      const r = await handleInvoicePaid(deps, ctx.db.ctx, parsed.data);
      if (!r.ok) throw r.error;
      ctx.logger.info({ invoiceId: parsed.data.invoiceId, ...r.value }, "academic : facture soldée traitée");
    }),
  }),
  defineSubscriber({
    name: "academic.withdraw-on-student-status",
    pattern: ConsumedEvents.STUDENT_STATUS_CHANGED,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("academic.withdraw-on-student-status", async (event, ctx) => {
      const parsed = academicConsumedStudentStatusChangedSchema.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "academic : charge utile people.student.status_changed illisible, ignorée");
        return;
      }
      const deps = createAcademicDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: academicWorkerPorts });
      const r = await handleStudentStatusChanged(deps, ctx.db.ctx, parsed.data);
      if (!r.ok) throw r.error;
      if (r.value.withdrawn.length > 0) ctx.logger.info({ studentId: parsed.data.studentId, withdrawn: r.value.withdrawn.length }, "academic : inscriptions retirées");
    }),
  }),
];
