/**
 * Abonnés du worker exécutés avec un contexte d'événement réel (base Postgres, ports en mémoire) : le rendu PDF se déclenche
 * sur `reportcards.snapshot.created`, est idempotent, reprend après échec, plafonne à 3 tentatives sans bloquer les autres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createDomainEvent, createSystemContext, newId, noopLogger, unwrap } from "@ecoledigitale/kernel";
import { createBatch } from "../../application/issue";
import { requestRender } from "../../application/render";
import { ReportcardsEvents, ConsumedEvents } from "../../domain/events";
import { buildSubscribers, RENDER_ATTEMPTS } from "../../subscribers";
import { ALL_PLATFORM_TEMPLATES } from "../../templates/builtin";
import { adminOne, adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("abonnés du worker : rendu sur `reportcards.snapshot.created`", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let ids: string[];
  let batchId: string;

  beforeAll(async () => {
    db = await createReportcardsTestDb(12, { withWorker: true });
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 3 });
    const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    batchId = view.batch.id;
    ids = (await adminRows<{ id: string }>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [school.tenantId])).map((r) => r.id);
  });
  afterAll(async () => {
    await db.drop();
  });

  const subscriber = (name: string) => buildSubscribers(() => world.deps).find((s) => s.name === name)!;
  const handlerCtx = (attempt: number) => {
    const ctx = createSystemContext(school.tenantId);
    return {
      tenantId: school.tenantId,
      db: { ctx, run: (fn: never, options?: never) => db.tenantDb.run(ctx, fn, options) },
      systemDb: db.systemDb,
      tenantDb: db.tenantDb,
      logger: noopLogger,
      subscriber: "test",
      attempt,
      jobId: newId(),
    } as never;
  };
  const eventOf = (type: string, payload: Record<string, unknown>) =>
    createDomainEvent({ type, payload: { v: 1, ...payload }, ctx: createSystemContext(school.tenantId), id: newId() });
  const renderState = async (id: string) => (await adminOne<any>(db, "SELECT render_status FROM reportcards.report_cards WHERE id = $1", [id])).render_status as string;

  it("le sous-jeu d'abonnés est enregistrable (noms valides, motifs exacts)", () => {
    expect(buildSubscribers(() => world.deps).map((s) => [s.name, s.pattern])).toEqual([
      ["reportcards.render-snapshot", "reportcards.snapshot.created"],
      ["reportcards.render-requested", "reportcards.report_card.render_requested"],
      ["reportcards.render-official-document", "reportcards.official_document.render_requested"],
      ["reportcards.combine-batch", "reportcards.batch.completed"],
      ["reportcards.seed-templates", "tenancy.tenant.provisioned"],
    ]);
  });

  it("snapshot.created -> PDF rendu, stocké, hash enregistré ; rejouer l'événement est sans effet (idempotent)", async () => {
    const handler = subscriber("reportcards.render-snapshot").handler;
    const event = eventOf(ReportcardsEvents.SNAPSHOT_CREATED, { reportCardId: ids[0] });
    await handler(event as never, handlerCtx(1));
    expect(await renderState(ids[0]!)).toBe("RENDERED");
    const puts = world.storage.puts.length;
    await handler(event as never, handlerCtx(1));
    await handler(eventOf(ReportcardsEvents.SNAPSHOT_CREATED, { reportCardId: ids[0] }) as never, handlerCtx(1));
    expect(world.storage.puts.length).toBe(puts);
    expect(await adminRows(db, "SELECT 1 FROM reportcards.renders WHERE report_card_id = $1", [ids[0]])).toHaveLength(1);
  });

  it("échec transitoire : l'abonné LÈVE (la file rejoue avec backoff) tant qu'il reste des tentatives ; à la dernière, FAILED sans dead-letter", async () => {
    const handler = subscriber("reportcards.render-snapshot").handler;
    const event = eventOf(ReportcardsEvents.SNAPSHOT_CREATED, { reportCardId: ids[1] });
    world.renderer.failTimes = RENDER_ATTEMPTS;
    world.renderer.failWith = "OOM Chromium (simulé)";
    await expect(handler(event as never, handlerCtx(1))).rejects.toMatchObject({ code: "reportcards.render_failed" });
    expect(await renderState(ids[1]!)).toBe("PENDING");
    await expect(handler(event as never, handlerCtx(2))).rejects.toMatchObject({ code: "reportcards.render_failed" });
    await expect(handler(event as never, handlerCtx(3))).resolves.toBeUndefined(); // définitif : enregistré, pas de dead-letter
    expect(await renderState(ids[1]!)).toBe("FAILED");
    const renders = await adminRows<any>(db, "SELECT status, attempts, error FROM reportcards.renders WHERE report_card_id = $1 ORDER BY attempts", [ids[1]]);
    expect(renders.map((r) => [r.status, r.attempts])).toEqual([["FAILED", 1], ["FAILED", 2], ["FAILED", 3]]);
    expect(renders[2].error).toContain("OOM Chromium");
    // Les autres bulletins du lot ne sont pas bloqués.
    await subscriber("reportcards.render-snapshot").handler(eventOf(ReportcardsEvents.SNAPSHOT_CREATED, { reportCardId: ids[2] }) as never, handlerCtx(1));
    expect(await renderState(ids[2]!)).toBe("RENDERED");
  });

  it("reprise explicite (bouton) : render_requested relance le rendu ; le lot est terminé puis le PDF combiné produit par `batch.completed`", async () => {
    unwrap(await requestRender(world.deps, school.admin.ctx, { reportCardId: ids[1]! }));
    expect(await renderState(ids[1]!)).toBe("PENDING");
    await subscriber("reportcards.render-requested").handler(eventOf(ReportcardsEvents.RENDER_REQUESTED, { reportCardId: ids[1] }) as never, handlerCtx(1));
    expect(await renderState(ids[1]!)).toBe("RENDERED");
    const batch = await adminOne<any>(db, "SELECT status, rendered FROM reportcards.batches WHERE id = $1", [batchId]);
    expect(batch.rendered).toBe(3);
    const completed = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.batch.completed' ORDER BY id", [school.tenantId]);
    expect(completed.length).toBeGreaterThanOrEqual(1);
    await subscriber("reportcards.combine-batch").handler(eventOf(ReportcardsEvents.BATCH_COMPLETED, completed[completed.length - 1].payload) as never, handlerCtx(1));
    const key = (await adminOne<any>(db, "SELECT combined_pdf_key FROM reportcards.batches WHERE id = $1", [batchId])).combined_pdf_key as string;
    expect(key).toBe(`reportcards/${school.tenantId}/batches/${batchId}.pdf`);
    expect((await PDFDocument.load((await world.storage.get(key))!.bytes)).getPageCount()).toBe(3);
  });

  it("payload sans identifiant ou bulletin inconnu : ignoré sans lever (pas de boucle de reprises)", async () => {
    const handler = subscriber("reportcards.render-snapshot").handler;
    await expect(handler(eventOf(ReportcardsEvents.SNAPSHOT_CREATED, {}) as never, handlerCtx(1))).resolves.toBeUndefined();
    await expect(handler(eventOf(ReportcardsEvents.SNAPSHOT_CREATED, { reportCardId: newId() }) as never, handlerCtx(1))).resolves.toBeUndefined();
  });

  it("tenancy.tenant.provisioned : les gabarits de plateforme sont publiés (idempotent)", async () => {
    const handler = subscriber("reportcards.seed-templates").handler;
    const event = eventOf(ConsumedEvents.TENANT_PROVISIONED, { tenantId: school.tenantId });
    await handler(event as never, handlerCtx(1));
    await handler(event as never, handlerCtx(1));
    expect(Number((await adminOne<any>(db, "SELECT count(*) AS n FROM reportcards.platform_templates WHERE status = 'PUBLISHED'")).n)).toBe(ALL_PLATFORM_TEMPLATES.length);
  });
});
