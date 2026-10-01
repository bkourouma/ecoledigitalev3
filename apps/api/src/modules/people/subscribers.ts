/**
 * Abonnés du module `people` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement). Tous sont
 * IDEMPOTENTS (`idempotent()` : marque « traité » et effets dans la même transaction) et insensibles à l'ordre de livraison.
 *
 *  - `people.project-enrollment`   `academic.enrollment.*`  -> projection `student_enrollment_summaries` (listes par classe,
 *    portail parent, accès « classe » de l'enseignant) et `first_enrolled_on` (R4). Un événement plus ancien que l'état
 *    projeté est ignoré ; une inscription d'un élève inconnu est journalisée et ignorée. `people` ne lit JAMAIS academic.
 *
 *  - `people.project-membership`   `iam.membership.created|changed`  -> LIAISON IDENTITÉ <-> PERSONNE. Les événements iam ne
 *    portent aucune adresse e-mail (donnée personnelle) : on ne rapproche donc jamais une personne d'une identité « par
 *    e-mail ». La liaison est explicite (`persons.identity_id`) : posée par `provisionPortalAccount` (invitation créée par
 *    `people`) ou par `linkPersonToIdentity` (accès créé ailleurs, dans iam). Cet abonné tient la PROJECTION des accès
 *    (`identity_memberships` : identité, statut, rôles) qui sert à (1) refuser de lier une personne à une identité sans accès
 *    dans le tenant, (2) afficher l'état du compte de portail d'un élève / tuteur / membre du personnel (actif, suspendu…).
 *
 *  - `people.instantiate-reference-data`  `tenancy.tenant.provisioned`  -> paramètres et référentiels par défaut (types de
 *    liens, catégories de personnel, types de contrat), sans écraser une ligne existante.
 *
 *  - `people.end-assignments-on-classroom-closed`  `academic.classroom.cancelled|completed`  et
 *    `people.end-assignments-on-year-closed`  `academic.year.closed` / `academic.academic_year.closed`
 *    -> les affectations d'enseignement actives de la classe / de l'année sont terminées (événements
 *    `people.teaching_assignment.ended` publiés).
 *
 * Les événements PUBLIÉS par ce module que d'autres modules doivent consommer (non implémenté ici, demande aux modules
 * concernés) : `people.student.status_changed` -> iam (suspension de l'accès d'un élève sorti), academic (retrait des
 * inscriptions) ; `people.staff.status_changed|deactivated` -> iam (révocation de l'accès d'un membre parti).
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { createPeopleDeps } from "./application/deps";
import { applyEnrollmentEvent, applyMembershipEvent } from "./application/projection";
import { instantiatePeopleReferenceData } from "./application/settings";
import { endAssignmentsForScope } from "./application/teaching";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (payload: unknown, ...keys: string[]): string | undefined => {
  const p = (payload ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && UUID_RE.test(v)) return v;
  }
  return undefined;
};

export default [
  defineSubscriber({
    name: "people.project-enrollment",
    pattern: "academic.enrollment.*",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    concurrency: 4,
    handler: idempotent("people.project-enrollment", async (event, ctx, tx) => {
      const deps = createPeopleDeps({ db: ctx.tenantDb, logger: ctx.logger });
      const outcome = await applyEnrollmentEvent(deps, tx, event);
      ctx.logger.info({ eventId: event.id, type: event.type, outcome }, "people : projection des inscriptions");
    }),
  }),
  defineSubscriber({
    name: "people.project-membership",
    pattern: /^iam\.membership\.(created|changed)$/,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("people.project-membership", async (event, ctx, tx) => {
      const outcome = await applyMembershipEvent(tx, event);
      ctx.logger.info({ eventId: event.id, type: event.type, outcome }, "people : projection des accès");
    }),
  }),
  defineSubscriber({
    name: "people.instantiate-reference-data",
    pattern: "tenancy.tenant.provisioned",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("people.instantiate-reference-data", async (_event, ctx) => {
      const deps = createPeopleDeps({ db: ctx.tenantDb, logger: ctx.logger });
      const res = await instantiatePeopleReferenceData(deps, createSystemContext(ctx.tenantId));
      if (!res.ok) throw res.error;
      ctx.logger.info({ created: res.value.created }, "people : référentiels instanciés");
    }),
  }),
  defineSubscriber({
    name: "people.end-assignments-on-classroom-closed",
    pattern: /^academic\.classroom\.(cancelled|completed)$/,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("people.end-assignments-on-classroom-closed", async (event, ctx, tx) => {
      const classroomId = uuidOf(event.payload, "classroomId", "id");
      if (!classroomId) return;
      const deps = createPeopleDeps({ db: ctx.tenantDb, logger: ctx.logger });
      const n = await endAssignmentsForScope(deps, tx, createSystemContext(ctx.tenantId), { classroomId }, { reason: event.type.endsWith("cancelled") ? "CLASSROOM_CANCELLED" : "CLASSROOM_COMPLETED" });
      ctx.logger.info({ eventId: event.id, ended: n }, "people : affectations de la classe terminées");
    }),
  }),
  defineSubscriber({
    name: "people.end-assignments-on-year-closed",
    pattern: /^academic\.(year|academic_year)\.closed$/,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("people.end-assignments-on-year-closed", async (event, ctx, tx) => {
      const yearId = uuidOf(event.payload, "academicYearId", "yearId", "id");
      if (!yearId) return;
      const deps = createPeopleDeps({ db: ctx.tenantDb, logger: ctx.logger });
      const n = await endAssignmentsForScope(deps, tx, createSystemContext(ctx.tenantId), { yearId }, { reason: "YEAR_CLOSED" });
      ctx.logger.info({ eventId: event.id, ended: n }, "people : affectations de l'année terminées");
    }),
  }),
];
