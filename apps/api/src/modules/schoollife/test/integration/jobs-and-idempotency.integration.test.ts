/**
 * Jobs planifiés (`remind-convocations`, `exclusion-boundaries`) et clé d'idempotence de la saisie rapide d'incidents, sur
 * Postgres réel (ports en mémoire, horloge réglable). RLS A/B. Aucune règle sur la qualification des absences (Q6-19).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, createSystemContext, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { schoollifeIncidentDtoSchema } from "@ecoledigitale/contracts/src/v2/schoollife";
import { createConvocation, sendConvocation } from "../../application/convocations";
import { declareIncident } from "../../application/incidents";
import { notifyExclusionBoundaries, remindConvocations } from "../../application/jobs";
import { executeMeasure, notifyMeasure, proposeMeasure, revokeMeasure, validateMeasure } from "../../application/measures";
import { upsertSettings } from "../../application/reference";
import manifest from "../../manifest";
import { schoollifePlugin } from "../../http/plugin";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, EDUCATOR_CAPS, TEACHER_CAPS, makeWorld, type TestWorld } from "../support/world";

describeIntegration("schoollife : jobs de rappel et d'avis d'exclusion, idempotence de la saisie rapide", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  let b: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
    b = await makeWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const sys = (world: TestWorld): RequestContext => createSystemContext(world.tenantId);
  const jobRows = async (world: TestWorld, kind?: string) =>
    (await db.admin.query("SELECT kind, subject_id, occurrence, status, attempts, error_code FROM schoollife.job_notifications WHERE tenant_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY created_at", [world.tenantId, kind ?? null])).rows;

  async function sentConvocation(world: TestWorld, student: TestWorld["students"][number], scheduledAt: string) {
    const c = unwrap(await createConvocation(world.deps, world.educator.ctx, EDUCATOR_CAPS, { enrollmentId: student.enrollmentId, reasonKind: "OTHER", reason: "Entretien de suivi", scheduledAt, location: "Bureau 2" }));
    return unwrap(await sendConvocation(world.deps, world.educator.ctx, EDUCATOR_CAPS, c.id, { channels: ["IN_APP"] }));
  }

  describe("remind-convocations", () => {
    it("éteint par défaut : aucun rappel tant que le réglage est vide", async () => {
      await sentConvocation(w, w.students[0]!, "2026-11-02T12:00:00Z");
      const before = w.ports.notifications.sent.length;
      const report = await remindConvocations(w.deps, sys(w));
      expect(report).toEqual({ examined: 0, sent: 0, failed: 0 });
      expect(w.ports.notifications.sent).toHaveLength(before);
      expect(await jobRows(w)).toHaveLength(0);
    });

    it("rappelle une convocation envoyée dans la fenêtre, une seule fois, sous contexte système, sans motif dans le message", async () => {
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, convocationReminderHours: 24 }));
      await sentConvocation(w, w.students[1]!, "2026-11-10T08:00:00Z"); // hors fenêtre (8 jours)
      const before = w.ports.notifications.sent.length;
      const first = await remindConvocations(w.deps, sys(w));
      expect(first).toEqual({ examined: 1, sent: 1, failed: 0 }); // seule la convocation de 12 h (élève 0)
      const call = w.ports.notifications.sent.at(-1)!;
      expect(call.ctx.userId).toBeNull();
      expect(call.input).toMatchObject({ kind: "CONVOCATION", channels: ["IN_APP", "EMAIL"], variables: { subject: "Rappel de convocation", date: "2026-11-02", time: "12:00" } });
      expect(JSON.stringify(call.input.variables)).not.toMatch(/Entretien de suivi/);
      expect(w.ports.notifications.sent).toHaveLength(before + 1);
      const rows = await jobRows(w, "CONVOCATION_REMINDER");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "SENT", attempts: 1 });
      // idempotent : le planificateur rejoue, rien ne repart
      expect(await remindConvocations(w.deps, sys(w))).toEqual({ examined: 0, sent: 0, failed: 0 });
      expect(w.ports.notifications.sent).toHaveLength(before + 1);
      // la clé d'idempotence de l'envoi est l'identifiant de la ligne du registre (stable au rejeu)
      expect(call.input.clientKey).toBe((await db.admin.query("SELECT id FROM schoollife.job_notifications WHERE tenant_id = $1", [w.tenantId])).rows[0].id);
    });

    it("échec d'envoi : ligne FAILED (code, jamais le message), reprise au passage suivant, tentatives bornées", async () => {
      const world = await makeWorld(db);
      unwrap(await upsertSettings(world.deps, world.director.ctx, { institutionId: world.institutionId, convocationReminderHours: 48 }));
      await sentConvocation(world, world.students[0]!, "2026-11-03T08:00:00Z");
      world.ports.notifications.unreachable = true;
      const failed = await remindConvocations(world.deps, sys(world));
      expect(failed).toEqual({ examined: 1, sent: 0, failed: 1 });
      const rows = await jobRows(world);
      expect(rows[0]).toMatchObject({ status: "FAILED", attempts: 1, error_code: "notification_failed" });
      world.ports.notifications.unreachable = false;
      const retried = await remindConvocations(world.deps, sys(world));
      expect(retried).toEqual({ examined: 1, sent: 1, failed: 0 });
      expect((await jobRows(world))[0]).toMatchObject({ status: "SENT", attempts: 2 });
      // une ligne PENDING récente (autre instance en cours) n'est pas reprise
      await db.admin.query("UPDATE schoollife.job_notifications SET status = 'PENDING', updated_at = now() WHERE tenant_id = $1", [world.tenantId]);
      const sentBefore = world.ports.notifications.sent.length;
      await remindConvocations(world.deps, sys(world));
      expect(world.ports.notifications.sent).toHaveLength(sentBefore);
    });

    it("RLS A/B : le job d'un tenant ne voit ni ne marque les convocations d'un autre", async () => {
      unwrap(await upsertSettings(b.deps, b.director.ctx, { institutionId: b.institutionId, convocationReminderHours: 24 }));
      await sentConvocation(b, b.students[0]!, "2026-11-02T14:00:00Z");
      const reportA = await remindConvocations(w.deps, sys(w));
      expect(reportA.examined).toBe(0); // A a déjà tout rappelé ; rien de B
      const reportB = await remindConvocations(b.deps, sys(b));
      expect(reportB).toEqual({ examined: 1, sent: 1, failed: 0 });
      expect(await jobRows(b)).toHaveLength(1);
      const cross = await db.admin.query("SELECT 1 FROM schoollife.job_notifications WHERE tenant_id = $1 AND subject_id IN (SELECT id FROM schoollife.convocations WHERE tenant_id = $2)", [w.tenantId, b.tenantId]);
      expect(cross.rows).toHaveLength(0);
    });
  });

  describe("exclusion-boundaries", () => {
    const propose = (world: TestWorld, student: TestWorld["students"][number], startsOn: string, endsOn: string) =>
      proposeMeasure(world.deps, world.educator.ctx, EDUCATOR_CAPS, { enrollmentId: student.enrollmentId, typeId: world.types.EXCL, reason: "Comportement répété en classe", startsOn, endsOn } as never);

    it("éteint par défaut ; une fois activé : avis neutre au début puis à la fin, une seule fois chacun, aucun effet sur l'élève", async () => {
      const world = await makeWorld(db); // horloge : 2026-11-02 08:00 UTC
      const s = world.students[0]!;
      const m = unwrap(await propose(world, s, "2026-11-02", "2026-11-04"));
      unwrap(await validateMeasure(world.deps, world.director.ctx, DIRECTOR_CAPS, m.id, {}));
      expect(await notifyExclusionBoundaries(world.deps, sys(world))).toEqual({ examined: 0, sent: 0, failed: 0 }); // réglage éteint

      unwrap(await upsertSettings(world.deps, world.director.ctx, { institutionId: world.institutionId, exclusionBoundaryNotices: true }));
      const first = await notifyExclusionBoundaries(world.deps, sys(world));
      expect(first).toEqual({ examined: 1, sent: 1, failed: 0 });
      const call = world.ports.notifications.sent.at(-1)!;
      expect(call.ctx.userId).toBeNull();
      expect(call.input.kind).toBe("MEASURE_NOTICE");
      expect(JSON.stringify(call.input)).not.toMatch(/Comportement|2026-11-0|EXCL/); // ni motif, ni nature, ni dates
      expect(await notifyExclusionBoundaries(world.deps, sys(world))).toEqual({ examined: 0, sent: 0, failed: 0 }); // idempotent

      world.clock.set(new Date("2026-11-04T08:00:00Z"));
      const end = await notifyExclusionBoundaries(world.deps, sys(world));
      expect(end).toEqual({ examined: 1, sent: 1, failed: 0 });
      expect((await jobRows(world)).map((r) => r.kind).sort()).toEqual(["EXCLUSION_ENDED", "EXCLUSION_STARTED"]);

      // les jobs ne décident rien : l'effet sur le statut reste en attente d'un humain, aucun changement de statut
      expect(world.ports.studentStatus.calls).toHaveLength(0);
      const effects = await db.admin.query("SELECT status FROM schoollife.measure_effects WHERE measure_id = $1", [m.id]);
      expect(effects.rows.map((r) => r.status)).toEqual(["AWAITING_HUMAN"]);
    });

    it("une exclusion révoquée, confidentielle ou d'un type qui ne notifie pas les tuteurs n'est jamais annoncée", async () => {
      const world = await makeWorld(db);
      unwrap(await upsertSettings(world.deps, world.director.ctx, { institutionId: world.institutionId, exclusionBoundaryNotices: true }));
      const revoked = unwrap(await propose(world, world.students[0]!, "2026-11-02", "2026-11-03"));
      unwrap(await validateMeasure(world.deps, world.director.ctx, DIRECTOR_CAPS, revoked.id, {}));
      unwrap(await notifyMeasure(world.deps, world.director.ctx, DIRECTOR_CAPS, revoked.id));
      unwrap(await executeMeasure(world.deps, world.director.ctx, DIRECTOR_CAPS, revoked.id));
      unwrap(await revokeMeasure(world.deps, world.director.ctx, DIRECTOR_CAPS, revoked.id, { reason: "Décision annulée après vérification" }));
      world.ports.notifications.sent.length = 0; // l'avis de mesure envoyé par l'humain n'entre pas dans la comparaison
      expect(await notifyExclusionBoundaries(world.deps, sys(world))).toEqual({ examined: 0, sent: 0, failed: 0 });
      expect(world.ports.notifications.sent).toHaveLength(0);
    });

    it("RLS A/B : l'avis d'un tenant n'est jamais écrit pour un autre", async () => {
      const rows = await db.admin.query("SELECT DISTINCT tenant_id FROM schoollife.job_notifications WHERE kind IN ('EXCLUSION_STARTED', 'EXCLUSION_ENDED')");
      expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      expect(await notifyExclusionBoundaries(b.deps, sys(b))).toEqual({ examined: 0, sent: 0, failed: 0 });
    });
  });

  describe("clé d'idempotence de la saisie rapide d'incidents", () => {
    const body = (overrides: Record<string, unknown> = {}) => ({
      typeId: w.types.INC,
      occurredAt: "2026-11-02T09:30:00Z",
      description: "Bousculade dans le couloir",
      involvements: [{ enrollmentId: w.students[0]!.enrollmentId, role: "AUTHOR" as const }],
      clientKey: "saisie-hors-ligne-0001",
      ...overrides,
    });
    const incidentsOf = async () => (await db.admin.query("SELECT id FROM schoollife.incidents WHERE tenant_id = $1 AND client_key = 'saisie-hors-ligne-0001'", [w.tenantId])).rows;
    const eventsOf = async (id: string) => (await db.admin.query("SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'schoollife.incident.declared' AND aggregate_id = $2", [w.tenantId, id])).rows;

    it("rejouer la même saisie renvoie le même incident : aucun doublon, aucun second événement", async () => {
      let replays = 0;
      const first = unwrap(await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body() as never, { onReplay: () => (replays += 1) }));
      const again = unwrap(await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body() as never, { onReplay: () => (replays += 1) }));
      expect(again.id).toBe(first.id);
      expect(replays).toBe(1);
      expect(await incidentsOf()).toHaveLength(1);
      expect(await eventsOf(first.id)).toHaveLength(1);
    });

    it("la même clé avec un AUTRE contenu est refusée (409) ; un autre déclarant peut réutiliser la même clé", async () => {
      const refused = await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body({ description: "Autre description du fait" }) as never);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("schoollife.idempotency_key_reused");
      const other = unwrap(await declareIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, body({ description: "Autre description du fait" }) as never));
      expect(other.reportedBy).toBe(w.educator.userId);
      expect(await incidentsOf()).toHaveLength(2);
    });

    it("sans clé, le comportement est inchangé (chaque saisie crée un incident) ; envois concurrents avec la même clé : un seul incident", async () => {
      const a = unwrap(await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body({ clientKey: undefined, description: "Sans clé, premier" }) as never));
      const c = unwrap(await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body({ clientKey: undefined, description: "Sans clé, premier" }) as never));
      expect(a.id).not.toBe(c.id);
      const results = await Promise.all(Array.from({ length: 6 }, () => declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, body({ clientKey: "saisie-concurrente-01", description: "Concurrence" }) as never)));
      const ids = new Set(results.map((r) => unwrap(r).id));
      expect(ids.size).toBe(1);
      const rows = await db.admin.query("SELECT 1 FROM schoollife.incidents WHERE tenant_id = $1 AND client_key = 'saisie-concurrente-01'", [w.tenantId]);
      expect(rows.rows).toHaveLength(1);
    });

    it("RLS A/B : une clé n'est jamais rapprochée d'un incident d'un autre tenant", async () => {
      const mine = unwrap(await declareIncident(b.deps, b.teacher.ctx, TEACHER_CAPS, { typeId: b.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Bousculade dans le couloir", involvements: [{ enrollmentId: b.students[0]!.enrollmentId, role: "AUTHOR" }], clientKey: "saisie-hors-ligne-0001" } as never));
      expect((await incidentsOf()).map((r) => r.id)).not.toContain(mine.id);
    });

    it("HTTP : en-tête Idempotency-Key, 201 puis 200 au rejeu avec Idempotent-Replay, clé invalide refusée", async () => {
      const world = await makeWorld(db);
      const app: FastifyInstance = Fastify({ logger: false });
      app.addHook("onRequest", async (req) => {
        (req as unknown as { ctx: RequestContext }).ctx = world.teacher.ctx;
      });
      const perms = new Set(manifest.permissions.map((p) => p.key));
      await app.register(
        async (scope) => {
          await scope.register(schoollifePlugin, {
            deps: world.deps,
            requirePermission: (permission: string) =>
              async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
                if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
                if (!perms.has(permission)) throw new ForbiddenError("Action non autorisée.");
              },
            requireFeature: () => async function gate() {},
          });
        },
        { prefix: "/api/v1/schoollife" },
      );
      await app.ready();
      const payload = { typeId: world.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Bousculade dans le couloir", involvements: [{ enrollmentId: world.students[0]!.enrollmentId, role: "AUTHOR" }] };
      const post = (headers: Record<string, string>, p: unknown = payload) => app.inject({ method: "POST", url: "/api/v1/schoollife/incidents", headers, payload: p as never });
      const first = await post({ "idempotency-key": "saisie-http-0001" });
      const second = await post({ "idempotency-key": "saisie-http-0001" });
      expect(first.statusCode).toBe(201);
      expect(first.headers["idempotent-replay"]).toBe("false");
      expect(second.statusCode).toBe(200);
      expect(second.headers["idempotent-replay"]).toBe("true");
      expect(schoollifeIncidentDtoSchema.parse(second.json()).id).toBe(schoollifeIncidentDtoSchema.parse(first.json()).id);
      expect((await post({ "idempotency-key": "saisie-http-0001" }, { ...payload, description: "Un tout autre fait" })).statusCode).toBe(409);
      expect((await post({ "idempotency-key": "x" })).statusCode).toBe(400);
      await app.close();
    });
  });
});
