/**
 * EXPORTS officiels paramétrables : format publié et figé, liste blanche de champs (aucune expression libre), INJECTION DE FORMULE
 * neutralisée (CSV et XLSX), encodages, largeur fixe, JSON, version du format tracée, téléchargement journalisé.
 */
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createExportFormat, newExportFormatVersion, publishExportFormat, updateExportFormat } from "../../application/formats";
import { getExportDownload, listExports, runExport } from "../../application/exports";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";
import { newId } from "@ecoledigitale/kernel";

describeIntegration("examinations : exports officiels", () => {
  let env: Env;
  let sessionId: string;
  const evil = '=HYPERLINK("http://evil.example/x","clic")';

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    sessionId = (await openSession(env, "CEPE-EXP")).id;
    const { pupils } = addPupils(env, 3);
    // identités hostiles : formule, séparateur, guillemets, retour à la ligne, accent
    const names: Array<[string, string]> = [[evil, "Jean"], ['DUPONT; "Jr"\nSuite', "Marie-Élise"], ["+33 1 23", "@admin"]];
    pupils.forEach((p, i) => {
      const id = env.world.identities.get(p.studentId)!;
      env.world.identities.set(p.studentId, { ...id, lastName: names[i]![0], firstName: names[i]![1] });
    });
    for (const p of pupils) await registerPupil(env, env.ctxA(), sessionId, p);
  });
  afterAll(async () => {
    await env?.drop();
  });

  const body = (code: string, fileFormat: "CSV" | "XLSX" | "FIXED_WIDTH" | "JSON", extra: Record<string, unknown> = {}) => ({
    code, label: `Liste ${code}`, kind: "CANDIDATE_LIST" as const, fileFormat, encoding: "UTF-8" as const, delimiter: (fileFormat === "CSV" ? ";" : null) as ";" | null,
    columns: [
      { header: "NUMERO", source: "candidate.number" as const, ...(fileFormat === "FIXED_WIDTH" ? { width: 16 } : {}) },
      { header: "NOM", source: "candidate.last_name" as const, ...(fileFormat === "FIXED_WIDTH" ? { width: 20 } : {}) },
      { header: "PRENOM", source: "candidate.first_name" as const, ...(fileFormat === "FIXED_WIDTH" ? { width: 14 } : {}) },
    ],
    sourceKind: "placeholder" as const,
    ...extra,
  });

  const fileOf = async (runId: string): Promise<Uint8Array> => {
    const key = (await env.db.admin.query("SELECT storage_key FROM examinations.export_runs WHERE id = $1", [runId])).rows[0].storage_key as string;
    return (await env.world.storage.get(key))!.bytes;
  };

  it("un format hors liste blanche (champ, transformation, propriété inconnue) est refusé : aucune expression libre", async () => {
    for (const columns of [
      [{ header: "X", source: "candidate.password" }],
      [{ header: "X", source: "candidate.number", transform: "eval" }],
      [{ header: "X", source: "candidate.number", expression: "1+1" }],
      [{ header: "X", source: "result.average" }], // champ de résultat dans une liste de candidats
      [{ header: "X", source: "paper.score" }], // épreuve non désignée
    ]) {
      const r = await createExportFormat(env.deps(), env.ctxA(), { ...body("MAUVAIS", "CSV"), columns } as never);
      expect(r.ok, JSON.stringify(columns)).toBe(false);
    }
  });

  it("un export exige un format PUBLIÉ ; un format publié est figé (nouvelle version pour corriger)", async () => {
    const draft = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_A", "CSV")));
    const refused = await runExport(env.deps(), env.ctxA(), sessionId, { formatId: draft.id, filters: {} });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.format_not_published");
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), draft.id));
    const frozen = await updateExportFormat(env.deps(), env.ctxA(), draft.id, { label: "autre" });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("examinations.format_published_immutable");
    const v2 = unwrap(await newExportFormatVersion(env.deps(), env.ctxA(), draft.id));
    expect(v2.version).toBe(2);
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), v2.id)); // retire la version 1 : un seul publié par code
    const states = (await env.db.admin.query("SELECT version, status FROM examinations.export_formats WHERE code = 'LISTE_A' ORDER BY version")).rows;
    expect(states).toEqual([{ version: 1, status: "RETIRED" }, { version: 2, status: "PUBLISHED" }]);
    const run = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: v2.id, filters: {} }));
    expect(run).toMatchObject({ status: "DONE", formatVersion: 2, rowCount: 3 });
    const old = await runExport(env.deps(), env.ctxA(), sessionId, { formatId: draft.id, filters: {} });
    expect(old.ok).toBe(false); // la version 1 est retirée
  });

  it("CSV : l'injection de formule est NEUTRALISÉE (apostrophe), séparateurs, guillemets et retours à la ligne protégés", async () => {
    const f = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_CSV", "CSV")));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), f.id));
    const run = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: f.id, filters: {} }));
    const text = new TextDecoder().decode(await fileOf(run.id));
    expect(text).toContain(`'=HYPERLINK(""http://evil.example/x"",""clic"")`); // neutralisée ET protégée par les guillemets CSV
    expect(text).not.toMatch(/(^|;)=HYPERLINK/m);
    expect(text).toContain(`'+33 1 23`);
    expect(text).toContain(`'@admin`);
    expect(text).toContain(`"DUPONT; ""Jr""\nSuite"`);
    expect(text.split("\r\n")[0]).toBe("NUMERO;NOM;PRENOM");
    // la constante d'un format est elle aussi neutralisée
    const c = unwrap(await createExportFormat(env.deps(), env.ctxA(), { ...body("LISTE_CONST", "CSV"), columns: [{ header: "NUMERO", source: "candidate.number" }, { header: "NOTE", source: "constant", value: "=1+1" }] } as never));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), c.id));
    const r2 = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: c.id, filters: {} }));
    expect(new TextDecoder().decode(await fileOf(r2.id))).toContain(";'=1+1");
  });

  it("XLSX : cellules texte neutralisées, jamais de formule ; classeur lisible", async () => {
    const f = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_XLSX", "XLSX")));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), f.id));
    const run = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: f.id, filters: {} }));
    const zip = await JSZip.loadAsync(await fileOf(run.id));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain(`'=HYPERLINK(&quot;http://evil.example/x&quot;,&quot;clic&quot;)`);
    expect(sheet).toContain("t=\"inlineStr\"");
    expect(sheet.match(/<row /g)).toHaveLength(4); // en-tête + 3 candidats
  });

  it("largeur fixe, JSON et encodage ISO-8859-1 (caractère non représentable -> « ? »)", async () => {
    const fixed = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_FIXE", "FIXED_WIDTH")));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), fixed.id));
    const rf = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: fixed.id, filters: {} }));
    const lines = new TextDecoder().decode(await fileOf(rf.id)).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((l) => l.length))).toEqual(new Set([50]));
    const json = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_JSON", "JSON")));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), json.id));
    const rj = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: json.id, filters: {} }));
    const parsed = JSON.parse(new TextDecoder().decode(await fileOf(rj.id))) as Array<Record<string, string>>;
    expect(parsed).toHaveLength(3);
    expect(Object.keys(parsed[0]!)).toEqual(["NUMERO", "NOM", "PRENOM"]);
    const latin = unwrap(await createExportFormat(env.deps(), env.ctxA(), body("LISTE_LATIN", "CSV", { encoding: "ISO-8859-1" })));
    unwrap(await publishExportFormat(env.deps(), env.ctxA(), latin.id));
    const rl = unwrap(await runExport(env.deps(), env.ctxA(), sessionId, { formatId: latin.id, filters: {} }));
    const bytes = Buffer.from(await fileOf(rl.id));
    expect(bytes.toString("latin1")).toContain("Marie-Élise"); // É = 0xC9 en ISO-8859-1
    expect(bytes.includes(0xc9)).toBe(true);
  });

  it("l'exécution est tracée (empreinte, effectif, version) et immuable ; le téléchargement est journalisé", async () => {
    const runs = unwrap(await listExports(env.deps(), env.ctxA(), sessionId));
    expect(runs.length).toBeGreaterThanOrEqual(5);
    const done = runs.find((r) => r.status === "DONE")!;
    await expect(env.db.tenantDb.run(env.ctxA(), (tx) => tx.query("UPDATE examinations.export_runs SET row_count = 99 WHERE id = $1", [done.id]))).rejects.toThrow(/export_closed/);
    const before = env.audit.entries.filter((e) => e.entry.action === "examinations.export.download").length;
    const dl = unwrap(await getExportDownload(env.deps(), env.ctxA(), done.id));
    expect(dl.url).toMatch(/^memory:\/\//);
    expect(dl.fileName).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(env.audit.entries.filter((e) => e.entry.action === "examinations.export.download")).toHaveLength(before + 1);
    // l'export ne fuit pas dans l'audit : ni noms ni contenu
    expect(JSON.stringify(env.audit.entries.map((e) => e.entry))).not.toMatch(/HYPERLINK|Marie|DUPONT/);
    void newId;
  });
});
