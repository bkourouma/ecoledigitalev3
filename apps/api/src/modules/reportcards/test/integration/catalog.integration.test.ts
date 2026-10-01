import { afterAll, beforeAll, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { ensureBuiltinTemplates, publishPlatformTemplate, retirePlatformTemplate, validatePlatformTemplate } from "../../application/platform";
import { listAvailableTemplates, putTemplateConfig } from "../../application/reference";
import { BUILTIN_TEMPLATES } from "../../templates/builtin";
import { createReportcardsTestDb, ctxFor, describeIntegration, adminRows, type ReportcardsTestDb } from "../support/db";
import { makeWorld, type TestWorld } from "../support/world";

describeIntegration("catalogue de gabarits de plateforme : amorçage, publication, retrait", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    ctx = ctxFor(await db.createTenant());
  });
  afterAll(async () => {
    await db.drop();
  });

  it("catalogue vide : le gabarit est introuvable ; la liste publie les 5 gabarits livrés à la demande (idempotent)", async () => {
    const early = await putTemplateConfig(world.deps, ctx, { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin" });
    expect(early.ok).toBe(false);
    const listed = unwrap(await listAvailableTemplates(world.deps, ctx));
    expect(listed.map((t) => t.key).sort()).toEqual(BUILTIN_TEMPLATES.map((t) => t.key).sort());
    expect(listed.every((t) => t.status === "PUBLISHED" && /^[0-9a-f]{64}$/.test(t.contentHash ?? ""))).toBe(true);
    expect(unwrap(await listAvailableTemplates(world.deps, ctx))).toHaveLength(5);
    expect(unwrap(await ensureBuiltinTemplates(world.deps)).published).toEqual([]);
    expect(Number((await adminRows<any>(db, "SELECT count(*) AS n FROM reportcards.platform_templates"))[0].n)).toBe(5);
  });

  it("nouvelle version d'un gabarit : numéro suivant, l'ancienne reste PUBLISHED et rendable ; hash de contenu distinct", async () => {
    const base = BUILTIN_TEMPLATES.find((t) => t.key === "primary-bulletin")!;
    const v2 = unwrap(await publishPlatformTemplate(world.deps, { key: base.key, documentKind: base.documentKind, pack: base.pack, title: `${base.title} v2`, body: `${base.body}\n<p>Mention complémentaire</p>`, css: base.css, optionsSchema: base.optionsSchema, signatureSlots: base.signatureSlots }));
    expect(v2.version).toBe(2);
    const all = await adminRows<any>(db, "SELECT version, status, content_hash FROM reportcards.platform_templates WHERE key = 'primary-bulletin' ORDER BY version");
    expect(all.map((r) => [r.version, r.status])).toEqual([[1, "PUBLISHED"], [2, "PUBLISHED"]]);
    expect(all[0].content_hash).not.toBe(all[1].content_hash);
    // Une configuration sans version précise prend la dernière version publiée.
    const cfg = unwrap(await putTemplateConfig(world.deps, ctx, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "primary-bulletin", options: {}, signatureAssignments: [] }));
    expect(cfg.templateVersion).toBe(2);
  });

  it("retrait d'une version : refusée pour une NOUVELLE configuration, mais les bulletins déjà émis continuent de se rendre", async () => {
    unwrap(await retirePlatformTemplate(world.deps, { key: "primary-bulletin", version: 2, actorId: "00000000-0000-4000-8000-000000000009" }));
    const refused = await putTemplateConfig(world.deps, ctx, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "primary-bulletin", templateVersion: 2 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("reportcards.template_not_found");
    const latest = unwrap(await putTemplateConfig(world.deps, ctx, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "primary-bulletin", options: {}, signatureAssignments: [] }));
    expect(latest.templateVersion).toBe(1); // dernière version PUBLIÉE
    // Un gabarit retiré est terminal.
    await expect(db.systemDb.run("test-retired-terminal", (tx) => tx.query("UPDATE reportcards.platform_templates SET status = 'PUBLISHED' WHERE key = 'primary-bulletin' AND version = 2"))).rejects.toThrow(/template_retired/);
  });

  it("validation à la publication : un gabarit hostile ou un schéma d'options invalide est refusé, rien n'est écrit", async () => {
    const before = Number((await adminRows<any>(db, "SELECT count(*) AS n FROM reportcards.platform_templates"))[0].n);
    const hostile = await publishPlatformTemplate(world.deps, { key: "piege", documentKind: "REPORT_CARD", pack: "CORE", title: "Piège", body: '<div onclick="x()">{{ title }}<iframe src="http://evil.example"></iframe></div>', css: "", optionsSchema: { type: "object" }, signatureSlots: [] });
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) {
      expect(hostile.error.code).toBe("reportcards.invalid_template");
      expect(JSON.stringify(hostile.error.details)).toMatch(/html_event|html_tag/);
    }
    const badSchema = validatePlatformTemplate({ body: "<p>x</p>", css: "", optionsSchema: { type: "array" }, signatureSlots: [{ slot: "A B", label: "x", required: true }, { slot: "ok", label: "y", required: false }, { slot: "ok", label: "z", required: false }] });
    expect(badSchema.join(" ")).toMatch(/schéma d'options|type object/);
    expect(badSchema.join(" ")).toMatch(/emplacement de signature invalide/);
    expect(badSchema.join(" ")).toMatch(/dupliqué/);
    expect(Number((await adminRows<any>(db, "SELECT count(*) AS n FROM reportcards.platform_templates"))[0].n)).toBe(before);
  });
});
