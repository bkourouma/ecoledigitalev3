/**
 * PDF des documents officiels : demande, scellement (une fois), rendu par le worker (idempotent, reprises, échec définitif),
 * téléchargement contrôlé, lecture pour la vérification publique. Ports de scellement et de rendu : mémoire.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, newId, unwrap } from "@ecoledigitale/kernel";
import { higherEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/higher";
import { awardDiploma } from "../../application/awards";
import { createDiploma } from "../../application/diplomas";
import { getDocument, issueAwardDocument, revokeDocument } from "../../application/documents";
import { describeDocumentForVerification, getDocumentDownload, parseDocumentEvent, renderOfficialDocument, requestDocumentRender } from "../../application/files";
import { capitalizePeriod } from "../../application/ledger";
import { snapshotHash } from "../../domain/snapshot";
import subscribers from "../../subscribers";
import { adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { assignAllSlots, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

describeIntegration("PDF des documents officiels : scellement, rendu, téléchargement (Postgres réel)", () => {
  let db: HigherTestDb;

  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const issued = async (kind: "DIPLOMA" | "ATTESTATION_AUTHENTICITY" = "DIPLOMA") => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students: 1 });
    await assignAllSlots(w, s);
    const def = unwrap(await createDiploma(w.deps, s.admin.ctx, { code: "D-PDF", label: "Licence PDF", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 12, requirements: [{ ueNodeId: s.ues[0]!.nodeId }, { ueNodeId: s.ues[1]!.nodeId }] }));
    const st = s.students[0]!;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [0, 1].map((i) => ueLine(s, st, s.ues[i]!, { validatedAt: new Date("2026-09-15T10:00:00Z") })));
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    w.ports.cycleResults.set(st.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "14.0", credits: 12 }] });
    const award = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" }));
    if (award.status !== "AWARDED") throw new Error("octroi attendu");
    const doc = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: award.award.id, kind })).document;
    return { w, s, doc };
  };

  it("demande : PENDING + événement `higher.document.render_requested` (charge valide) ; sans effet si déjà rendu ; refusée si révoqué", async () => {
    const { w, s, doc } = await issued();
    const req = unwrap(await requestDocumentRender(w.deps, s.admin.ctx, doc.id));
    expect(req).toMatchObject({ id: doc.id, renderStatus: "PENDING" });
    const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'higher.document.render_requested'", [s.tenantId]);
    expect(events).toHaveLength(1);
    expect(higherEventPayloadSchemas["higher.document.render_requested"].safeParse(events[0]!.payload).success).toBe(true);
    expect(parseDocumentEvent(events[0]!.payload)).toEqual({ documentId: doc.id });
    expect(parseDocumentEvent({ documentId: "pas-un-uuid" })).toBeNull();
    expect(parseDocumentEvent(null)).toBeNull();
    expect(await requestDocumentRender(w.deps, s.admin.ctx, newId())).toMatchObject({ ok: false, error: { code: "higher.document_not_found" } });

    unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    unwrap(await requestDocumentRender(w.deps, s.admin.ctx, doc.id)); // déjà rendu : rien n'est republié
    expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'higher.document.render_requested'", [s.tenantId])).toHaveLength(1);
    unwrap(await revokeDocument(w.deps, s.admin.ctx, { documentId: doc.id, reason: "Erreur d'identité de l'étudiant" }));
    expect(await requestDocumentRender(w.deps, s.admin.ctx, doc.id)).toMatchObject({ ok: false, error: { code: "higher.document_revoked" } });
  });

  it("rendu : scellement UNE fois (signature de l'empreinte du snapshot), contexte pur du snapshot, PDF stocké ; idempotent", async () => {
    const { w, s, doc } = await issued();
    expect(doc).toMatchObject({ renderStatus: "PENDING", signature: null, objectKey: null });
    const done = unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    expect(done).toMatchObject({ renderStatus: "RENDERED", signingKeyId: "test-key-0001", templateKey: "higher-diploma" });
    expect(done.signature).toMatch(/^sig:/);
    expect(done.objectKey).toBe(`memory/${doc.id}.pdf`);
    expect(done.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(w.ports.documents.sealed).toEqual([{ documentId: doc.id, kind: "DIPLOMA", snapshotHash: doc.snapshotHash, verificationCode: doc.verificationCode }]);
    expect(w.ports.documents.rendered).toHaveLength(1);
    const ctx = w.ports.documents.rendered[0]!.context as Record<string, any>;
    expect(ctx).toMatchObject({ title: "Diplôme", student: { fullName: "Étudiant 01" }, diploma: { label: "Licence PDF" }, reference: doc.reference });
    expect(w.ports.documents.files.get(done.objectKey!)).toBeInstanceOf(Uint8Array);
    // le contenu du document est inchangé : l'empreinte du snapshot reste celle de l'émission
    expect(snapshotHash(done.snapshot)).toBe(doc.snapshotHash);

    // rejeu : rien n'est resigné ni rerendu
    const again = unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    expect(again).toMatchObject({ renderStatus: "RENDERED", pdfHash: done.pdfHash, signature: done.signature });
    expect(w.ports.documents.sealed).toHaveLength(1);
    expect(w.ports.documents.rendered).toHaveLength(1);
    expect(w.audit.entries.filter((e) => e.entry.action === "higher.document.rendered")).toHaveLength(1);
  });

  it("échec du rendu : les tentatives intermédiaires laissent le document `RENDERING` (reprise), la dernière l'enregistre `FAILED` ; la reprise explicite réussit", async () => {
    const { w, s, doc } = await issued();
    w.ports.documents.failRenderWith = new ConflictError("Chromium indisponible", { code: "reportcards.render_failed" });
    const first = await renderOfficialDocument(w.deps, s.admin.ctx, doc.id, { attempt: 1, maxAttempts: 3 });
    expect(first).toMatchObject({ ok: false, error: { code: "reportcards.render_failed" } });
    expect((unwrap(await getDocument(w.deps, s.admin.ctx, doc.id))).renderStatus).toBe("RENDERING");
    const last = await renderOfficialDocument(w.deps, s.admin.ctx, doc.id, { attempt: 3, maxAttempts: 3 });
    expect(last.ok).toBe(false);
    const failed = unwrap(await getDocument(w.deps, s.admin.ctx, doc.id));
    expect(failed.renderStatus).toBe("FAILED");
    expect(failed.signature).not.toBeNull(); // le scellement est acquis : il n'est jamais refait
    expect(w.audit.entries.map((e) => e.entry.action)).toContain("higher.document.render_failed");
    // reprise explicite
    w.ports.documents.failRenderWith = null;
    expect(unwrap(await requestDocumentRender(w.deps, s.admin.ctx, doc.id)).renderStatus).toBe("PENDING");
    const done = unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    expect(done.renderStatus).toBe("RENDERED");
    expect(w.ports.documents.sealed).toHaveLength(1);
  });

  it("scellement impossible (aucune clé de signature) : rien n'est écrit, le document reste `PENDING` puis `FAILED` à la dernière tentative", async () => {
    const { w, s, doc } = await issued();
    w.ports.documents.failSealWith = new ConflictError("Aucune clé de signature n'est configurée.", { code: "reportcards.signing_key_missing" });
    expect(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id, { attempt: 1, maxAttempts: 3 })).toMatchObject({ ok: false, error: { code: "reportcards.signing_key_missing" } });
    expect(unwrap(await getDocument(w.deps, s.admin.ctx, doc.id))).toMatchObject({ renderStatus: "PENDING", signature: null });
    await renderOfficialDocument(w.deps, s.admin.ctx, doc.id, { attempt: 3, maxAttempts: 3 });
    expect(unwrap(await getDocument(w.deps, s.admin.ctx, doc.id))).toMatchObject({ renderStatus: "FAILED", signature: null });
    expect(w.ports.documents.rendered).toHaveLength(0);
  });

  it("téléchargement : état tant que le PDF n'est pas prêt, URL signée courte ensuite (audit), jamais pour un document révoqué", async () => {
    const { w, s, doc } = await issued();
    expect(unwrap(await getDocumentDownload(w.deps, s.admin.ctx, doc.id))).toEqual({ status: "PENDING" });
    unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    const before = w.audit.entries.length;
    const ready = unwrap(await getDocumentDownload(w.deps, s.admin.ctx, doc.id));
    expect(ready).toMatchObject({ status: "READY", expiresInSec: 120, contentType: "application/pdf", fileName: `${doc.reference}.pdf` });
    if (ready.status === "READY") {
      expect(ready.url).toContain("files.example.test");
      expect(ready.url).toContain("ttl=120");
    }
    expect(w.audit.entries.slice(before).map((e) => [e.entry.action, e.entry.sensitive])).toEqual([["higher.document.downloaded", true]]);
    expect(await getDocumentDownload(w.deps, s.admin.ctx, newId())).toMatchObject({ ok: false, error: { code: "higher.document_not_found" } });
    unwrap(await revokeDocument(w.deps, s.admin.ctx, { documentId: doc.id, reason: "Erreur d'identité de l'étudiant" }));
    expect(await getDocumentDownload(w.deps, s.admin.ctx, doc.id)).toMatchObject({ ok: false, error: { code: "higher.document_revoked" } });
    expect(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id)).toMatchObject({ ok: false, error: { code: "higher.document_revoked" } });
  });

  it("vérification publique : faits du document sous la RLS de son tenant, empreinte RECALCULÉE, duplicata et révocation", async () => {
    const { w, s, doc } = await issued();
    unwrap(await renderOfficialDocument(w.deps, s.admin.ctx, doc.id));
    const ok1 = await describeDocumentForVerification(w.deps, s.tenantId, doc.id);
    expect(ok1).toMatchObject({ status: "ISSUED", title: "Diplôme — Licence PDF", institutionName: "Établissement de test", verificationCode: doc.verificationCode, snapshotHash: doc.snapshotHash, recomputedHash: doc.snapshotHash, supersededByIssuedAt: null, revokedAt: null });
    expect(ok1!.signature).toMatch(/^sig:/);
    // jamais de donnée personnelle dans les faits publiés
    expect(JSON.stringify(ok1)).not.toMatch(/Étudiant 01|MAT-0001|2003-04-12/);

    // un autre tenant ne voit pas le document
    const other = await db.createTenant("autre");
    expect(await describeDocumentForVerification(w.deps, other, doc.id)).toBeNull();
    expect(await describeDocumentForVerification(w.deps, s.tenantId, newId())).toBeNull();

    // duplicata : l'original devient « remplacé » avec la date du duplicata
    w.clock.set("2026-12-01T09:00:00.000Z");
    const dup = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: doc.awardId!, kind: "DIPLOMA", duplicate: true })).document;
    const replaced = await describeDocumentForVerification(w.deps, s.tenantId, doc.id);
    expect(replaced).toMatchObject({ status: "SUPERSEDED" });
    expect(replaced!.supersededByIssuedAt?.toISOString()).toBe(dup.issuedAt.toISOString());

    unwrap(await revokeDocument(w.deps, s.admin.ctx, { documentId: dup.id, reason: "Erreur d'identité de l'étudiant" }));
    expect(await describeDocumentForVerification(w.deps, s.tenantId, dup.id)).toMatchObject({ status: "REVOKED" });
  });

  it("abonnés du worker : `higher.document.issued` et `render_requested` produisent le PDF ; charge illisible ignorée ; document inconnu ignoré", async () => {
    const { w, s, doc } = await issued();
    const names = subscribers.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["higher.render-document", "higher.render-document-requested"]));
    expect(subscribers.find((x) => x.name === "higher.render-document")!.pattern).toBe("higher.document.issued");
    expect(subscribers.find((x) => x.name === "higher.render-document-requested")!.pattern).toBe("higher.document.render_requested");
    const logs: unknown[] = [];
    const logger = { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), debug: () => undefined, child: () => logger, fatal: () => undefined, trace: () => undefined } as never;
    const ctxFor = (attempt: number) => ({ tenantId: s.tenantId, db: { ctx: s.admin.ctx, run: (fn: never) => w.deps.db.run(s.admin.ctx, fn) }, systemDb: db.systemDb, tenantDb: db.tenantDb, logger, subscriber: "t", attempt, jobId: "j" }) as never;
    // Les abonnés construisent leurs propres dépendances (ports du worker) : on les rejoue ici avec les nôtres via `buildSubscribers`.
    const { buildSubscribers } = await import("../../subscribers");
    const built = buildSubscribers(() => w.deps);
    const handler = built.find((x) => x.name === "higher.render-document")!.handler;
    await handler({ id: newId(), type: "higher.document.issued", payload: { v: 1, documentId: doc.id, kind: "DIPLOMA" }, version: 1 } as never, ctxFor(1));
    expect(unwrap(await getDocument(w.deps, s.admin.ctx, doc.id)).renderStatus).toBe("RENDERED");
    await expect(handler({ id: newId(), type: "x", payload: { v: 1 }, version: 1 } as never, ctxFor(1))).resolves.toBeUndefined();
    await expect(handler({ id: newId(), type: "x", payload: { v: 1, documentId: newId(), kind: "DIPLOMA" }, version: 1 } as never, ctxFor(1))).resolves.toBeUndefined();
    // échec transitoire : l'abonné relance l'erreur (le worker rejoue) tant que des tentatives restent
    const second = await issued();
    second.w.ports.documents.failRenderWith = new ConflictError("Chromium indisponible", { code: "reportcards.render_failed" });
    const retrying = buildSubscribers(() => second.w.deps).find((x) => x.name === "higher.render-document-requested")!.handler;
    await expect(retrying({ id: newId(), type: "x", payload: { v: 1, documentId: second.doc.id, kind: "DIPLOMA" }, version: 1 } as never, { ...(ctxFor(1) as object), tenantId: second.s.tenantId, db: { ctx: second.s.admin.ctx } } as never)).rejects.toMatchObject({ code: "reportcards.render_failed" });
  });
});

export type { School, TestWorld };
