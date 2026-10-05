/**
 * O-11 — UE annuelle (offerte sur deux semestres, un résultat commun) : mécanisme, parité et isolation (Postgres réel).
 * Les règles sont SCÉNARISÉES (aucune formule dans ce module) ; la règle réelle est exercée par `annual-ue-rules.integration.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError, newId, unwrap } from "@ecoledigitale/kernel";
import { declareAnnualUe, listAnnualUes, removeAnnualUe } from "../../application/annual-ue";
import { createDiplomaFromCurriculum } from "../../application/diplomas";
import { capitalizePeriod, listDebts } from "../../application/ledger";
import { adminOne, adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

type Outcome = { average: string | null; credits: number; validated: boolean; state: "VALIDATED" | "RESIT" | "DEBT"; sessionObtained: number | null };

describeIntegration("O-11 : UE annuelle (Postgres réel)", () => {
  let db: HigherTestDb;
  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 2): Promise<{ w: TestWorld; s: School; outcome: { current: Outcome } }> => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students });
    const outcome = { current: { average: "13.250", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 1 } as Outcome };
    // Le TEST dicte la décision de la règle (ici : crédits = somme des parties, comme `credits_ue`) ; le module ne calcule rien.
    w.ports.rules.onAnnualUe = ({ parts }) => ({ ...outcome.current, credits: Math.round(parts.reduce((n, p) => n + p.credits * 100, 0)) / 100 });
    return { w, s, outcome };
  };
  const declare = (w: TestWorld, s: School, over: Partial<Parameters<typeof declareAnnualUe>[2]> = {}) =>
    declareAnnualUe(w.deps, s.admin.ctx, { ueNodeId: s.ues[0]!.nodeId, memberNodeIds: [s.ues[1]!.nodeId], reason: "UE annuelle de la licence", ...over });
  const close = (w: TestWorld, s: School, period: "S1" | "S2") =>
    capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: period === "S1" ? s.periodId : s.period2Id });
  const ledger = (s: School) => adminRows<any>(db, "SELECT student_id, ue_node_id, credits::text, average_exact::text, acquired_via, session_obtained, status, academic_period_id FROM higher.credit_ledger WHERE tenant_id = $1 ORDER BY acquired_at, id", [s.tenantId]);
  const events = (tenantId: string, type: string) => adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY occurred_at, id", [tenantId, type]);

  describe("déclaration", () => {
    it("motif, bornes, UE connues, une lignée n'alimente qu'une UE annuelle, doublon refusé ; audit sensible", async () => {
      const { w, s } = await fresh();
      const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? null : r.error?.code);
      expect(code(await declare(w, s, { reason: "ab" }))).toBe("higher.invalid_input");
      expect(code(await declare(w, s, { partsExpected: 1 }))).toBe("higher.invalid_input");
      expect(code(await declare(w, s, { partsExpected: 5 }))).toBe("higher.invalid_input");
      expect(code(await declare(w, s, { memberNodeIds: [newId()] }))).toBe("higher.annual_ue_unknown_ue");
      const def = unwrap(await declare(w, s));
      expect(def).toMatchObject({ ueNodeId: s.ues[0]!.nodeId, partsExpected: 2 });
      expect([...def.memberNodeIds].sort()).toEqual([s.ues[0]!.nodeId, s.ues[1]!.nodeId].sort());
      expect(code(await declare(w, s))).toBe("higher.annual_ue_exists");
      // l'UE 2 alimente déjà l'UE annuelle de l'UE 1
      expect(code(await declareAnnualUe(w.deps, s.admin.ctx, { ueNodeId: s.ues[2]!.nodeId, memberNodeIds: [s.ues[1]!.nodeId], reason: "Tentative de chevauchement" }))).toBe("higher.annual_ue_member_taken");
      expect(w.audit.entries.find((e) => e.entry.action === "higher.annual_ue.declared")?.entry).toMatchObject({ sensitive: true, reason: "UE annuelle de la licence" });
      expect(unwrap(await listAnnualUes(w.deps, s.admin.ctx))).toHaveLength(1);
    });
  });

  describe("capitalisation", () => {
    it("S1 : la partie est ENREGISTRÉE, rien n'est capitalisé, aucune dette, les règles ne sont pas appelées", async () => {
      const { w, s, outcome } = await fresh();
      unwrap(await declare(w, s));
      outcome.current = { average: null, credits: 0, validated: false, state: "DEBT", sessionObtained: null };
      const st = s.students[0]!;
      // la partie du semestre 1 est même en DETTE : cela ne produit ni dette ni écriture tant que l'année n'est pas complète
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "DEBT", sessionObtained: null, averageExact: "7.5" }), ueLine(s, st, s.ues[2]!)]);
      const report = unwrap(await close(w, s, "S1"));
      expect(report).toMatchObject({ acquired: 1, debtsOpened: 0, annual: { pending: 1, evaluated: 0 } }); // seule l'UE ordinaire (ues[2]) est capitalisée
      expect(w.ports.rules.annualUeCalls).toHaveLength(0);
      expect((await ledger(s)).map((r) => r.ue_node_id)).toEqual([s.ues[2]!.nodeId]);
      expect(unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId))).toHaveLength(0);
      expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.annual_ue_parts WHERE tenant_id = $1", [s.tenantId])).n)).toBe(1);
    });

    it("S2 : le résultat COMMUN est évalué par les règles et capitalisé UNE fois sous l'ancre (crédits = somme des parties) ; le rejeu n'ajoute rien", async () => {
      const { w, s } = await fresh();
      unwrap(await declare(w, s));
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { averageExact: "11" })]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id, averageExact: "15.5" })]);
      unwrap(await close(w, s, "S1"));
      expect(await ledger(s)).toHaveLength(0);
      const report = unwrap(await close(w, s, "S2"));
      expect(report).toMatchObject({ acquired: 1, annual: { pending: 0, evaluated: 1 } });

      // le contexte transmis aux règles : les DEUX parties, leurs moyennes exactes et crédits
      expect(w.ports.rules.annualUeCalls).toHaveLength(1);
      const call = w.ports.rules.annualUeCalls[0]!;
      expect(call.parts.map((p) => p.moyenne).sort()).toEqual(["11", "15.5"]);
      expect(call).toMatchObject({ session2Tentee: true, validationParJury: false });
      expect(call.parts.every((p) => p.credits === 6)).toBe(true);

      const rows = await ledger(s);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ue_node_id: s.ues[0]!.nodeId, credits: "12.00", average_exact: "13.250", acquired_via: "DIRECT", session_obtained: 1, status: "ACQUIRED" });
      const [ev] = await events(s.tenantId, "higher.credits.capitalized");
      expect(ev!.payload).toMatchObject({ v: 1, ueNodeId: s.ues[0]!.nodeId, credits: 12 });

      const again = unwrap(await close(w, s, "S2"));
      expect(again).toMatchObject({ acquired: 0, alreadyAcquired: 1 });
      expect(await ledger(s)).toHaveLength(1);
      expect(await events(s.tenantId, "higher.credits.capitalized")).toHaveLength(1);
    });

    it("S2 reçu AVANT S1 : l'UE reste en attente jusqu'au second semestre, quel que soit l'ordre", async () => {
      const { w, s } = await fresh(1);
      unwrap(await declare(w, s));
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id })]);
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
      expect(unwrap(await close(w, s, "S2")).annual).toEqual({ pending: 1, evaluated: 0 });
      expect(await ledger(s)).toHaveLength(0);
      expect(unwrap(await close(w, s, "S1")).annual).toEqual({ pending: 0, evaluated: 1 });
      expect(await ledger(s)).toHaveLength(1);
    });

    it("non validée : état DETTE rendu par la règle -> UNE dette sous l'ancre, aucune écriture au registre", async () => {
      const { w, s, outcome } = await fresh(1);
      unwrap(await declare(w, s));
      outcome.current = { average: "8.000", credits: 12, validated: false, state: "DEBT", sessionObtained: null };
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "DEBT", sessionObtained: null })]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id, validated: false, ueState: "DEBT", sessionObtained: null })]);
      unwrap(await close(w, s, "S1"));
      expect(unwrap(await close(w, s, "S2"))).toMatchObject({ acquired: 0, debtsOpened: 1 });
      expect(w.ports.rules.annualUeCalls[0]!.session2Tentee).toBe(true);
      const debts = unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId));
      expect(debts.map((d) => d.ueNodeId)).toEqual([s.ues[0]!.nodeId]);
      expect(await ledger(s)).toHaveLength(0);
    });

    it("une partie encore « à repasser » : le rattrapage n'est pas épuisé (fait transmis à la règle etat_ue)", async () => {
      const { w, s, outcome } = await fresh(1);
      unwrap(await declare(w, s));
      outcome.current = { average: "9.000", credits: 12, validated: false, state: "RESIT", sessionObtained: null };
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "RESIT", sessionObtained: null })]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id })]);
      unwrap(await close(w, s, "S1"));
      unwrap(await close(w, s, "S2"));
      expect(w.ports.rules.annualUeCalls[0]!.session2Tentee).toBe(false);
      expect(await ledger(s)).toHaveLength(0);
    });

    it("reclôture : un résultat commun remplacé par un NON validé révoque l'écriture (quel que soit le semestre reclos)", async () => {
      const { w, s, outcome } = await fresh(1);
      unwrap(await declare(w, s));
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id })]);
      unwrap(await close(w, s, "S1"));
      unwrap(await close(w, s, "S2"));
      expect((await ledger(s))[0]).toMatchObject({ status: "ACQUIRED" });
      // le semestre 1 est reclos (version 2) et la règle rend désormais « non validée »
      outcome.current = { average: "9.000", credits: 12, validated: false, state: "RESIT", sessionObtained: null };
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "RESIT", sessionObtained: null, resultsVersion: 2 })]);
      const report = unwrap(await close(w, s, "S1"));
      expect(report).toMatchObject({ revoked: 1, annual: { evaluated: 1 } });
      expect((await ledger(s))[0]).toMatchObject({ status: "REVOKED" });
      expect(await events(s.tenantId, "higher.credits.revoked")).toHaveLength(1);
    });

    it("règles indisponibles : ÉCHEC FERMÉ — rien n'est capitalisé et la partie reçue n'est pas conservée (transaction annulée)", async () => {
      const { w, s } = await fresh(1);
      unwrap(await declare(w, s));
      const st = s.students[0]!;
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id })]);
      unwrap(await close(w, s, "S1"));
      w.ports.rules.failWith = new ValidationError("Règle en échec", [], { code: "rules.no_active_ruleset" });
      const failed = await close(w, s, "S2");
      expect(!failed.ok && failed.error.code).toBe("rules.no_active_ruleset");
      expect(await ledger(s)).toHaveLength(0);
      expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.annual_ue_parts WHERE tenant_id = $1", [s.tenantId])).n)).toBe(1); // S1 seulement
      w.ports.rules.failWith = null;
      expect(unwrap(await close(w, s, "S2")).annual).toEqual({ pending: 0, evaluated: 1 });
    });

    it("validation par le jury de CHAQUE partie : la décision humaine est transmise (les règles ne réévaluent pas ue_validee)", async () => {
      const { w, s } = await fresh(1);
      unwrap(await declare(w, s));
      const st = s.students[0]!;
      const o1 = newId();
      const o2 = newId();
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { via: "JURY_OVERRIDE", overrideId: o1 })]);
      w.ports.credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id, via: "JURY_OVERRIDE", overrideId: o2 })]);
      unwrap(await close(w, s, "S1"));
      unwrap(await close(w, s, "S2"));
      expect(w.ports.rules.annualUeCalls[0]).toMatchObject({ validationParJury: true });
      expect((await ledger(s))[0]).toMatchObject({ acquired_via: "JURY_OVERRIDE" });
    });
  });

  describe("PARITÉ : les résultats existants ne bougent pas", () => {
    it("une UE annuelle déclarée sur d'AUTRES UE ne change rien pour les UE ordinaires (mêmes écritures, mêmes dettes, même rapport)", async () => {
      const lines = (s: School, st: School["students"][number]) => [
        ueLine(s, st, s.ues[0]!, { averageExact: "14.3333" }),
        ueLine(s, st, s.ues[1]!, { via: "RESIT", sessionObtained: 2 }),
        ueLine(s, st, s.ues[2]!, { validated: false, ueState: "DEBT", sessionObtained: null }),
      ];
      const run = async (withAnnual: boolean) => {
        const { w, s } = await fresh(1);
        const extra = { nodeId: newId(), code: "UE-X", label: "Autre UE", credits: 4 };
        const extra2 = { nodeId: newId(), code: "UE-Y", label: "Autre UE 2", credits: 4 };
        w.ports.curriculum.addUe({ nodeId: extra.nodeId, code: extra.code, label: extra.label, credits: 4, programNodeId: s.programNodeId }, s.cycleNodeId);
        w.ports.curriculum.addUe({ nodeId: extra2.nodeId, code: extra2.code, label: extra2.label, credits: 4, programNodeId: s.programNodeId }, s.cycleNodeId);
        if (withAnnual) unwrap(await declareAnnualUe(w.deps, s.admin.ctx, { ueNodeId: extra.nodeId, memberNodeIds: [extra2.nodeId], reason: "UE annuelle sans lien" }));
        w.ports.credits.setFinalLines(s.classroomId, s.periodId, lines(s, s.students[0]!));
        const report = unwrap(await close(w, s, "S1"));
        const rows = (await ledger(s)).map((r) => ({ ue: s.ues.findIndex((u) => u.nodeId === r.ue_node_id), credits: r.credits, avg: r.average_exact, via: r.acquired_via, session: r.session_obtained, status: r.status }));
        const debts = unwrap(await listDebts(w.deps, s.admin.ctx, s.students[0]!.studentId)).map((d) => s.ues.findIndex((u) => u.nodeId === d.ueNodeId));
        return { report, rows, debts };
      };
      const without = await run(false);
      const withDecl = await run(true);
      expect(withDecl).toEqual(without);
      expect(without.report).not.toHaveProperty("annual"); // le rapport d'origine n'a aucun champ en plus
      expect(without.rows.map((r) => r.ue)).toEqual([0, 1]);
      expect(without.debts).toEqual([2]);
    });
  });

  describe("exigences de diplôme et retrait", () => {
    it("une UE annuelle est UNE exigence (ancre, crédits = somme des parties) ; la partie n'est pas exigée à part", async () => {
      const { w, s } = await fresh(1);
      const before = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "AVANT" }));
      expect(before.requirements.map((r) => r.ueNodeId).sort()).toEqual(s.ues.map((u) => u.nodeId).sort());
      unwrap(await declare(w, s));
      const after = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "APRES" }));
      expect(after.requirements.map((r) => r.ueNodeId).sort()).toEqual([s.ues[0]!.nodeId, s.ues[2]!.nodeId].sort());
      expect(after.requirements.find((r) => r.ueNodeId === s.ues[0]!.nodeId)!.credits).toBe(12);
      expect(after.definition.uvRequired).toBe(18); // 12 (annuelle) + 6 : suggestion cohérente avec la fusion
    });

    it("retrait : refusé dès qu'un résultat de semestre est enregistré ; possible sinon (audit sensible)", async () => {
      const { w, s } = await fresh(1);
      const def = unwrap(await declare(w, s));
      w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, s.ues[0]!)]);
      unwrap(await close(w, s, "S1"));
      const refused = await removeAnnualUe(w.deps, s.admin.ctx, { id: def.id, reason: "Déclaration erronée" });
      expect(!refused.ok && refused.error.code).toBe("higher.annual_ue_in_use");
      const second = await fresh(1);
      const d2 = unwrap(await declare(second.w, second.s));
      expect(unwrap(await removeAnnualUe(second.w.deps, second.s.admin.ctx, { id: d2.id, reason: "Déclaration erronée" }))).toEqual({ removed: true });
      expect(second.w.audit.entries.find((e) => e.entry.action === "higher.annual_ue.removed")?.entry.sensitive).toBe(true);
    });
  });

  describe("isolation A/B (RLS)", () => {
    it("déclarations et résultats de semestre d'un tenant sont invisibles de l'autre ; la même ancre peut être déclarée indépendamment", async () => {
      const a = await fresh(1);
      const b = await fresh(1);
      unwrap(await declare(a.w, a.s));
      const st = a.s.students[0]!;
      a.w.ports.credits.setFinalLines(a.s.classroomId, a.s.periodId, [ueLine(a.s, st, a.s.ues[0]!)]);
      unwrap(await close(a.w, a.s, "S1"));
      expect(unwrap(await listAnnualUes(b.w.deps, b.s.admin.ctx))).toEqual([]);
      // sous la RLS de B : aucune ligne du tenant A
      const seen = await b.w.deps.db.run(b.s.admin.ctx, (tx) => tx.many("SELECT id FROM higher.annual_ue_parts UNION ALL SELECT id FROM higher.annual_ues"));
      expect(seen).toEqual([]);
      // B déclare sa propre UE annuelle (mêmes identifiants de lignée impossibles : UUID propres à chaque monde)
      expect(unwrap(await declare(b.w, b.s)).ueNodeId).toBe(b.s.ues[0]!.nodeId);
      const countA = await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.annual_ue_parts WHERE tenant_id = $1", [a.s.tenantId]);
      const countB = await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.annual_ue_parts WHERE tenant_id = $1", [b.s.tenantId]);
      expect([countA.n, countB.n]).toEqual(["1", "0"]);
    });
  });
});
