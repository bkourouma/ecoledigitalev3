import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { unwrap } from "@ecoledigitale/kernel";
import { reportcardsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/reportcards";
import { createBatch } from "../../application/issue";
import { putBranding } from "../../application/reference";
import { buildCombinedPdf, renderReportCard, requestRender, retryBatchRenders, sweepPendingRenders } from "../../application/render";
import { getCombinedPdfUrl } from "../../application/queries";
import { FakePdfRenderer } from "../../infrastructure/in-memory-ports";
import { adminOne, adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { PNG_1X1, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("rendu PDF depuis le snapshot seul (worker), stockage, lots", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
  });
  afterAll(async () => {
    await db.drop();
  });

  const cardsOf = (tenantId: string) => adminRows<any>(db, "SELECT * FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [tenantId]);
  const events = (tenantId: string, type: string) => adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [tenantId, type]);

  async function issued(students = 2, options: Parameters<typeof seedSchool>[2] = {}): Promise<{ school: School; ids: string[]; batchId: string }> {
    const school = await seedSchool(world, await db.createTenant(), { students, ...options });
    const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    return { school, ids: (await cardsOf(school.tenantId)).map((c) => c.id), batchId: view.batch.id };
  }

  it("rend le PDF, le stocke, enregistre son hash et l'indexe ; événement `rendered` conforme au contrat", async () => {
    const { school, ids } = await issued(1);
    const readsBefore = world.results.bundleReads.length;
    world.renderer.renders.length = 0;
    const out = unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    expect(out.status).toBe("RENDERED");

    const card = (await cardsOf(school.tenantId))[0];
    expect(card).toMatchObject({ render_status: "RENDERED" });
    const render = await adminOne<any>(db, "SELECT * FROM reportcards.renders WHERE report_card_id = $1", [ids[0]]);
    expect(render).toMatchObject({ status: "RENDERED", attempts: 1, renderer_version: "fake/1", error: null });
    expect(card.current_render_id).toBe(render.id);
    expect(render.object_key).toBe(`reportcards/${school.tenantId}/${ids[0]}/${render.id}.pdf`);

    // L'objet stocké a exactement le hash et la taille enregistrés ; c'est un vrai PDF.
    const object = await world.storage.get(render.object_key);
    expect(object).not.toBeNull();
    expect(createHash("sha256").update(object!.bytes).digest("hex")).toBe(render.pdf_hash);
    expect(Number(render.size_bytes)).toBe(object!.bytes.length);
    expect(Buffer.from(object!.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(object!.bytes)).getPageCount()).toBe(1);
    expect(object!.contentType).toBe("application/pdf");

    // Index de fichier : le PDF est reconnaissable par son empreinte.
    const idx = await adminOne<any>(db, "SELECT code, tenant_id FROM reportcards.file_hash_index WHERE pdf_hash = $1", [render.pdf_hash]);
    expect(idx).toMatchObject({ code: card.verification_code, tenant_id: school.tenantId });

    // Le rendu n'a lu AUCUNE donnée vivante : le port results n'a pas été sollicité (R-RC-04, AC2.3).
    expect(world.results.bundleReads.length).toBe(readsBefore);

    // HTML fourni au moteur : issu du snapshot, avec QR (code et URL), logo en data URI, CSP, sans script ni requête externe.
    const html = world.renderer.renders[0]!.html;
    expect(html).toContain(`Code : ${card.verification_code}`);
    expect(html).toContain(`https://verif.example.test/v/${card.verification_code}`);
    expect(html).toContain("<svg xmlns");
    expect(html).toContain(`src="data:image/png;base64,${PNG_1X1.toString("base64")}"`);
    expect(html).toContain("ELEVE1 Prénom1");
    expect(html).not.toMatch(/<script|<iframe|<link /i);
    // Métadonnées : la date de création du PDF est la date d'ÉMISSION (réception du moteur).
    expect(world.renderer.renders[0]!.issuedAt.toISOString()).toBe(card.issued_at.toISOString());
    expect(world.renderer.renders[0]!.title).toBe(card.snapshot.meta.title);

    const ev = await events(school.tenantId, "reportcards.report_card.rendered");
    expect(ev).toHaveLength(1);
    expect(reportcardsEventPayloadSchemas["reportcards.report_card.rendered"].safeParse(ev[0].payload).success).toBe(true);
    expect(ev[0].payload).toMatchObject({ reportCardId: ids[0], pdfHash: render.pdf_hash });
  });

  it("idempotent : un événement rejoué ne crée ni second rendu ni second objet", async () => {
    const { school, ids } = await issued(1);
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    const puts = world.storage.puts.length;
    const again = unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    expect(again.status).toBe("ALREADY_RENDERED");
    expect(world.storage.puts.length).toBe(puts);
    expect(await adminRows(db, "SELECT 1 FROM reportcards.renders WHERE report_card_id = $1", [ids[0]])).toHaveLength(1);
  });

  it("rendu ultérieur du même snapshot identique malgré des données vivantes modifiées (AC2.4)", async () => {
    const { school, ids } = await issued(1);
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    const first = world.renderer.renders[world.renderer.renders.length - 1]!.html;
    // Identité modifiée, élève renommé, logo remplacé : sans effet sur le rendu du bulletin déjà émis.
    unwrap(await putBranding(world.deps, school.admin.ctx, { legalName: "Autre établissement", primaryColor: "#FF0000" }));
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]!, force: true }));
    const second = world.renderer.renders[world.renderer.renders.length - 1]!.html;
    expect(second).toBe(first);
    expect(second).not.toContain("Autre établissement");
    // Deux lignes de rendu (une par rendu), le rendu courant est le dernier ; l'ancien reste enregistré.
    const renders = await adminRows<any>(db, "SELECT id, status FROM reportcards.renders WHERE report_card_id = $1 ORDER BY requested_at", [ids[0]]);
    expect(renders.map((r) => r.status)).toEqual(["RENDERED", "RENDERED"]);
    expect((await cardsOf(school.tenantId))[0].current_render_id).toBe(renders[1].id);
  });

  it("échec : tentatives successives (une ligne par tentative), PENDING tant qu'il en reste, puis FAILED définitif avec la cause (AC1.5)", async () => {
    const { school, ids, batchId } = await issued(2);
    world.renderer.failTimes = 3;
    world.renderer.failWith = "Chromium a planté (simulé)";
    for (const attempt of [1, 2]) {
      const r = await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]!, attempt, maxAttempts: 3 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "reportcards.render_failed", details: { attempt, final: false } });
      expect((await cardsOf(school.tenantId)).find((c) => c.id === ids[0])!.render_status).toBe("PENDING");
    }
    const last = await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]!, attempt: 3, maxAttempts: 3 });
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error.details).toMatchObject({ final: true });
    const card = (await cardsOf(school.tenantId)).find((c) => c.id === ids[0])!;
    expect(card.render_status).toBe("FAILED");
    const renders = await adminRows<any>(db, "SELECT status, attempts, error FROM reportcards.renders WHERE report_card_id = $1 ORDER BY attempts", [ids[0]]);
    expect(renders.map((r) => [r.status, r.attempts])).toEqual([["FAILED", 1], ["FAILED", 2], ["FAILED", 3]]);
    expect(renders[2].error).toContain("Chromium a planté");
    expect((await events(school.tenantId, "reportcards.report_card.render_failed"))).toHaveLength(1);

    // Un rendu en échec ne bloque pas les autres : l'autre bulletin est rendu, le lot se termine AVEC erreurs.
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[1]! }));
    const batch = await adminOne<any>(db, "SELECT status, rendered, finished_at FROM reportcards.batches WHERE id = $1", [batchId]);
    expect(batch).toMatchObject({ status: "COMPLETED_WITH_ERRORS", rendered: 1 });
    expect(batch.finished_at).not.toBeNull();

    // Reprise : le bouton redemande le rendu ; le rendu repasse et le lot est repris.
    const retry = unwrap(await retryBatchRenders(world.deps, school.admin.ctx, { batchId }));
    expect(retry.requested).toBe(1);
    expect((await events(school.tenantId, "reportcards.report_card.render_requested"))).toHaveLength(1);
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    const after = await adminOne<any>(db, "SELECT status, rendered FROM reportcards.batches WHERE id = $1", [batchId]);
    expect(after).toMatchObject({ rendered: 2 });
    expect(["COMPLETED", "COMPLETED_WITH_ERRORS"]).toContain(after.status);
    expect((await cardsOf(school.tenantId)).every((c) => c.render_status === "RENDERED")).toBe(true);
  });

  it("logo ou signature référencé mais absent du stockage : le rendu ÉCHOUE explicitement (jamais de document sans logo)", async () => {
    const { school, ids } = await issued(1);
    world.storage.objects.delete(school.logoKey);
    const r = await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]!, attempt: 3, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect((await cardsOf(school.tenantId))[0].render_status).toBe("FAILED");
    const render = await adminOne<any>(db, "SELECT error FROM reportcards.renders WHERE report_card_id = $1", [ids[0]]);
    expect(render.error).toMatch(/introuvable dans le stockage \(logo\)/);
    // Le fichier remis, la reprise explicite aboutit.
    await world.storage.put(school.logoKey, PNG_1X1, { contentType: "image/png" });
    unwrap(await requestRender(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    expect(unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! })).status).toBe("RENDERED");
  });

  it("un fichier de logo qui n'est pas une image est refusé au rendu (pas de SVG, pas de HTML)", async () => {
    const { school, ids } = await issued(1);
    world.storage.objects.set(school.logoKey, { bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), contentType: "image/svg+xml" });
    const r = await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]!, attempt: 3, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect((await adminOne<any>(db, "SELECT error FROM reportcards.renders WHERE report_card_id = $1", [ids[0]])).error).toMatch(/n'est pas une image PNG, JPEG, GIF ou WebP/);
  });

  it("sans moteur de rendu dans le processus : erreur explicite, aucun état modifié", async () => {
    const { school, ids } = await issued(1);
    const bare = world.depsWith({ ports: { ...world.deps.ports, renderer: null as never } });
    const r = await renderReportCard(bare, school.admin.ctx, { reportCardId: ids[0]! });
    expect(r.ok).toBe(false);
    expect((await cardsOf(school.tenantId))[0].render_status).toBe("PENDING");
  });

  it("gabarit RETIRÉ : les snapshots existants restent rendables avec leur version (spec §13)", async () => {
    const { school, ids } = await issued(1);
    await db.systemDb.run("test-retire", (tx) => tx.query("UPDATE reportcards.platform_templates SET status = 'RETIRED' WHERE key = 'secondary-bulletin' AND version = 1"));
    expect(unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! })).status).toBe("RENDERED");
    await db.admin.query("ALTER TABLE reportcards.platform_templates DISABLE TRIGGER platform_templates_guard");
    await db.admin.query("UPDATE reportcards.platform_templates SET status = 'PUBLISHED' WHERE key = 'secondary-bulletin' AND version = 1");
    await db.admin.query("ALTER TABLE reportcards.platform_templates ENABLE ALWAYS TRIGGER platform_templates_guard");
  });

  it("lot : le dernier rendu termine le lot ; `batch.completed` publié une fois ; PDF combiné de la classe (pdf-lib)", async () => {
    const { school, ids, batchId } = await issued(3);
    expect((await adminOne<any>(db, "SELECT status FROM reportcards.batches WHERE id = $1", [batchId])).status).toBe("RENDERING");
    for (const id of ids) unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: id }));
    const batch = await adminOne<any>(db, "SELECT * FROM reportcards.batches WHERE id = $1", [batchId]);
    expect(batch).toMatchObject({ status: "COMPLETED", rendered: 3, issued: 3, failed: 0 });
    const ev = await events(school.tenantId, "reportcards.batch.completed");
    expect(ev).toHaveLength(1);
    expect(reportcardsEventPayloadSchemas["reportcards.batch.completed"].safeParse(ev[0].payload).success).toBe(true);

    const combined = unwrap(await buildCombinedPdf(world.deps, school.admin.ctx, { batchId }));
    expect(combined).toMatchObject({ count: 3, pages: 3, key: `reportcards/${school.tenantId}/batches/${batchId}.pdf` });
    const pdf = await world.storage.get(combined.key);
    expect((await PDFDocument.load(pdf!.bytes)).getPageCount()).toBe(3);
    const url = unwrap(await getCombinedPdfUrl(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    expect(world.storage.verifySignedUrl(url.url)).toEqual({ ok: true, key: combined.key });
    expect(world.audit.actions).toContain("reportcards.batch.combined_downloaded");
  });

  it("filet de sécurité : les bulletins restés PENDING trop longtemps sont redemandés (une seule fois par passage)", async () => {
    const { school, ids } = await issued(2);
    unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    world.clock.advance(15 * 60_000);
    const swept = unwrap(await sweepPendingRenders(world.deps, school.admin.ctx, { olderThanMs: 10 * 60_000, limit: 50 }));
    expect(swept.requested).toBe(1); // seul le bulletin non rendu
    const ev = await events(school.tenantId, "reportcards.report_card.render_requested");
    expect(ev.map((e) => e.payload.reportCardId)).toEqual([ids[1]]);
    world.clock.advance(-15 * 60_000);
  });

  it("FakePdfRenderer est déterministe (mêmes entrées, mêmes octets)", async () => {
    const r = new FakePdfRenderer();
    const input = { html: "<p>x</p>", title: "Titre", issuedAt: new Date("2026-01-01T00:00:00Z") };
    expect(Buffer.from((await r.render(input)).pdf).equals(Buffer.from((await r.render(input)).pdf))).toBe(true);
  });
});
