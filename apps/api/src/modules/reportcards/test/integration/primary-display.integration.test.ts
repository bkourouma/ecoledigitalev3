/**
 * Décisions Q-P04 (rang AFFICHÉ par défaut au primaire) et Q-P05 (mention, désactivable) — Postgres réel, RLS A/B.
 * Le réglage d'affichage est une configuration PAR ÉTABLISSEMENT : désactiver le rang chez A ne change rien chez B, et B ne
 * voit jamais la configuration de A. Les gabarits de plateforme (catalogue commun) restent les mêmes pour tous.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { listAvailableTemplates, listTemplateConfigs, previewTemplate, putTemplateConfig } from "../../application/reference";
import { createReportcardsTestDb, ctxFor, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, type TestWorld } from "../support/world";

describeIntegration("bulletin du primaire : rang et mention, réglages par établissement (RLS A/B)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let a: ReturnType<typeof ctxFor>;
  let b: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    a = ctxFor(await db.createTenant("ecole-a"));
    b = ctxFor(await db.createTenant("ecole-b"));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("la version 2 des gabarits du primaire est publiée ; rang et mention sont ACTIFS par défaut (aucune configuration)", async () => {
    const listed = unwrap(await listAvailableTemplates(world.deps, a));
    for (const key of ["primary-bulletin", "report-primary"]) {
      expect(listed.filter((t) => t.key === key).map((t) => t.version).sort()).toEqual([1, 2]);
      const v2 = listed.find((t) => t.key === key && t.version === 2)!;
      expect(v2.optionsSchema).toMatchObject({ properties: { showRank: { default: true }, showMention: { default: true } } });
    }
    // Sans configuration enregistrée : la dernière version PUBLIÉE est proposée, options par défaut = rang et mention affichés.
    const preview = unwrap(await previewTemplate(world.deps, a, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "primary-bulletin" }));
    expect(preview.templateVersion).toBe(2);
    expect(preview.html).toContain("<th>Rang</th>");
    expect(preview.html).toContain("Mention");
  });

  it("l'établissement A désactive le rang et la mention ; B garde le défaut (aucune fuite de réglage)", async () => {
    const cfgA = unwrap(await putTemplateConfig(world.deps, a, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "report-primary", options: { showRank: false, showMention: false }, signatureAssignments: [] }));
    expect(cfgA).toMatchObject({ templateKey: "report-primary", templateVersion: 2, options: { showRank: false, showMention: false } });

    const previewA = unwrap(await previewTemplate(world.deps, a, { documentKind: "REPORT_CARD", pack: "PRIMARY" }));
    expect(previewA.templateKey).toBe("report-primary");
    expect(previewA.html).not.toContain("<th>Rang</th>");
    expect(previewA.html).not.toContain('<span class="lbl">Mention</span>');

    const configsB = unwrap(await listTemplateConfigs(world.deps, b, { documentKind: "REPORT_CARD", history: true }));
    expect(configsB).toEqual([]);
    const previewB = unwrap(await previewTemplate(world.deps, b, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "report-primary" }));
    expect(previewB.html).toContain("<th>Rang</th>");
    expect(previewB.html).toContain('<span class="lbl">Mention</span>');
  });

  it("B enregistre sa propre configuration : A garde la sienne ; les options inconnues restent refusées", async () => {
    const cfgB = unwrap(await putTemplateConfig(world.deps, b, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "report-primary", options: { showMention: false }, signatureAssignments: [] }));
    expect(cfgB.options).toMatchObject({ showRank: true, showMention: false });
    const [onlyA] = unwrap(await listTemplateConfigs(world.deps, a, { documentKind: "REPORT_CARD" }));
    expect(onlyA!.options).toMatchObject({ showRank: false, showMention: false });
    const refused = await putTemplateConfig(world.deps, b, { documentKind: "REPORT_CARD", pack: "PRIMARY", templateKey: "report-primary", options: { classementDense: true } });
    expect(refused.ok).toBe(false);
  });
});
