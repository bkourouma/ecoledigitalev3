/**
 * ISOLATION par tenant (RLS) : chaque table du schéma, vérifiée par `assertTenantIsolation` (structure + comportement A/B) ; le tenant B ne
 * lit, n'écrit, n'exporte et ne publie rien du tenant A ; allowlist VIDE. Parité des listes blanches TypeScript <-> SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../../isolation-allowlist.examinations";
import { getCandidateDetail, listCandidates } from "../../application/candidates";
import { listExamTypes } from "../../application/reference";
import { getSessionDetail, listSessions, transitionSession } from "../../application/sessions";
import { listExportFormats } from "../../application/formats";
import { getStatistics } from "../../application/statistics";
import { EXPORT_SOURCES, EXPORT_TRANSFORMS, IMPORT_TARGETS } from "../../domain/export-spec";
import { formatCandidateNumber } from "../../domain/number-pattern";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

describeIntegration("examinations : isolation A/B et parité SQL", () => {
  let env: Env;
  let sessionA: string;
  let candidateA: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env, env.ctxA());
    await seedPack(env, env.ctxB());
    sessionA = (await openSession(env, "CEPE-ISO")).id;
    const { pupils } = addPupils(env, 2);
    candidateA = (await registerPupil(env, env.ctxA(), sessionA, pupils[0]!)).candidateId;
    await openSession(env, "CEPE-ISO-B", { ctx: env.ctxB() });
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("assertTenantIsolation : toutes les tables du schéma sont isolées par tenant (RLS forcée), allowlist vide", async () => {
    expect(allowlist).toEqual([]);
    const report = await assertTenantIsolation({ pool: env.db.appPool, schemas: ["examinations"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    // toute table du schéma est auditée : structure (tenant_id, RLS forcée, policy) pour toutes, comportement A/B quand une ligne se fabrique
    const all = (await env.db.admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'examinations' AND table_type = 'BASE TABLE'")).rows.map((r) => `examinations.${r.table_name}`).sort();
    const audited = [...report.behavioural, ...report.structuralOnly.map((t) => t.table)].sort();
    expect(audited).toEqual(all);
    expect(all.length).toBeGreaterThanOrEqual(25);
    expect(report.behavioural).toContain("examinations.number_sequences");
  });

  it("le tenant B ne voit ni les sessions, ni les candidats, ni les statistiques du tenant A (404 / listes vides)", async () => {
    const sessions = unwrap(await listSessions(env.deps(), env.ctxB(), { page: 1, pageSize: 50 }));
    expect(sessions.items.map((s) => s.code)).toEqual(["CEPE-ISO-B"]);
    const a = await getSessionDetail(env.deps(), env.ctxB(), sessionA);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe("examinations.session_not_found");
    const cands = await listCandidates(env.deps(), env.ctxB(), sessionA, { page: 1, pageSize: 50 });
    expect(cands.ok).toBe(false);
    const detail = await getCandidateDetail(env.deps(), env.ctxB(), candidateA);
    expect(detail.ok).toBe(false);
    if (!detail.ok) expect(detail.error.code).toBe("examinations.candidate_not_found");
    const stats = await getStatistics(env.deps(), env.ctxB(), sessionA, { groupBy: "ALL" });
    expect(stats.ok).toBe(false);
    const moved = await transitionSession(env.deps(), env.ctxB(), sessionA, "REGISTRATION_CLOSED");
    expect(moved.ok).toBe(false);
    // chaque tenant a ses PROPRES types et formats (instanciés depuis le modèle, jamais partagés)
    const typesA = unwrap(await listExamTypes(env.deps(), env.ctxA()));
    const typesB = unwrap(await listExamTypes(env.deps(), env.ctxB()));
    expect(typesA[0]?.id).not.toBe(typesB[0]?.id);
    expect(unwrap(await listExportFormats(env.deps(), env.ctxB())).length).toBe(2);
  });

  it("le numéro de candidat est par tenant : deux tenants numérotent chacun depuis 00001", async () => {
    const pupilsB = addPupils(env, 1, { institutionId: env.institutionB });
    const sB = (await env.db.admin.query("SELECT id FROM examinations.sessions WHERE tenant_id = $1", [env.tenantB])).rows[0].id as string;
    const r = await registerPupil(env, env.ctxB(), sB, pupilsB.pupils[0]!);
    expect(r.number).toBe("CEPE2027-00001");
    const a = (await env.db.admin.query("SELECT candidate_number FROM examinations.candidates WHERE id = $1", [candidateA])).rows[0].candidate_number;
    expect(a).toBe("CEPE2027-00001");
  });

  it("parité TypeScript <-> SQL : champs d'export, transformations, cibles d'import et formatage du numéro", async () => {
    // La liste blanche SQL est celle de `valid_export_columns` : un champ de la liste TypeScript est accepté, un champ hors liste est refusé.
    const accepts = async (column: object, kind = "RESULTS"): Promise<boolean> => {
      const r = await env.db.admin.query("SELECT examinations.valid_export_columns($1::jsonb) AS ok", [JSON.stringify([column])]);
      void kind;
      return r.rows[0].ok as boolean;
    };
    for (const source of EXPORT_SOURCES) expect(await accepts({ header: "H", source, ...(source === "paper.score" ? { paper: "EP1" } : {}) }), source).toBe(true);
    expect(await accepts({ header: "H", source: "candidate.password" })).toBe(false);
    for (const transform of EXPORT_TRANSFORMS) expect(await accepts({ header: "H", source: "candidate.number", transform }), transform).toBe(true);
    expect(await accepts({ header: "H", source: "candidate.number", transform: "eval" })).toBe(false);
    const validImport = async (columns: object[]): Promise<boolean> => (await env.db.admin.query("SELECT examinations.valid_import_columns('RESULTS', $1::jsonb) AS ok", [JSON.stringify(columns)])).rows[0].ok as boolean;
    const key = { header: "K", target: "key.candidate_number" };
    const code = { header: "R", target: "result.code" };
    for (const target of IMPORT_TARGETS) {
      const columns = target.startsWith("key.") ? [{ header: "K", target }, code] : target === "result.code" ? [key, code] : [key, code, { header: "X", target, ...(target.startsWith("paper.") ? { paper: "EP1" } : {}) }];
      expect(await validImport(columns), target).toBe(true);
    }
    expect(await validImport([key, code, { header: "X", target: "candidate.last_name" }])).toBe(false);
    // formatage du numéro : même résultat en TypeScript et en SQL
    for (const [pattern, type, year, seq] of [
      ["{TYPE}{YEAR}-{SEQ:5}", "CEPE", 2027, 1], ["{TYPE}{YEAR}-{SEQ:5}", "CEPE", 2027, 123456], ["N{SEQ}", "BAC", 2030, 42], ["{YEAR}/{TYPE}/{SEQ:3}", "BEPC", 2028, 7], ["{SEQ:2}-{TYPE}", "BTS", 2031, 100],
    ] as const) {
      const sql = (await env.db.admin.query("SELECT examinations.format_number($1, $2, $3, $4::bigint) AS n", [pattern, type, year, seq])).rows[0].n;
      expect(formatCandidateNumber(pattern, type, year, seq), `${pattern} ${seq}`).toBe(sql);
    }
  });

  it("les migrations du module sont IDENTIQUES au DDL de référence de la spec (ddl/migrations)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const mod = resolve(__dirname, "../../migrations");
    const spec = resolve(__dirname, "../../../../../../../specs/v2/018-examinations/ddl/migrations");
    const norm = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    const files = readdirSync(mod).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual(readdirSync(spec).filter((f) => f.endsWith(".sql")).sort());
    for (const f of files) expect(norm(resolve(mod, f)), f).toBe(norm(resolve(spec, f)));
    // plage réservée au module : 2000-2099
    for (const f of files) expect(Number(f.slice(0, 4))).toBeGreaterThanOrEqual(2000);
    for (const f of files) expect(Number(f.slice(0, 4))).toBeLessThanOrEqual(2099);
  });
});
