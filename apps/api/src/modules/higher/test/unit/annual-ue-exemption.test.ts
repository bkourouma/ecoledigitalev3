import { describe, expect, it } from "vitest";
import { err, ok, ValidationError, type AppError, type Result } from "@ecoledigitale/kernel";
import { commonLine, distinctPeriods, foldAnnualUes, isComplete, latestPart, resitExhausted, type AnnualPart, type AnnualUeDef } from "../../domain/annual-ue";
import { DEFAULT_EXEMPTION_CREDIT_POLICY, EXEMPTION_CREDIT_POLICIES, EXEMPTION_REASON_MIN, grantsCredits, isExemptionCreditPolicy } from "../../domain/exemption";
import { createRulesAdapter, type RulesApiLike } from "../../infrastructure/rules-adapter";

const U = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const def = (over: Partial<AnnualUeDef> = {}): AnnualUeDef => ({ id: U(1), ueNodeId: U(10), partsExpected: 2, memberNodeIds: [U(10), U(11)], reason: "test", createdAt: new Date("2026-10-01T00:00:00Z"), ...over });
const part = (over: Partial<AnnualPart> = {}): AnnualPart => ({
  annualUeId: U(1), studentId: U(2), enrollmentId: U(3), academicYearId: U(4), academicPeriodId: U(20), partUeNodeId: U(10), credits: 6, averageExact: "12", validated: true, ueState: "VALIDATED",
  sessionObtained: 1, via: "DIRECT", overrideId: null, compensatedEcueCount: 0, sourceResultId: U(5), resultsVersion: 1, validatedAt: new Date("2027-01-31T00:00:00Z"), recordedAt: new Date("2027-02-01T00:00:00Z"), ...over,
});

describe("O-11 : UE annuelle — domaine pur (aucune formule, aucun seuil)", () => {
  it("complète quand le nombre de SEMESTRES DISTINCTS attendu est reçu (deux parties du même semestre ne comptent qu'une fois)", () => {
    expect(distinctPeriods([part(), part({ academicPeriodId: U(20) })])).toBe(1);
    expect(isComplete(def(), [part()])).toBe(false);
    expect(isComplete(def(), [part(), part({ academicPeriodId: U(21), partUeNodeId: U(11) })])).toBe(true);
    expect(isComplete(def({ partsExpected: 3 }), [part(), part({ academicPeriodId: U(21) })])).toBe(false);
  });

  it("le rattrapage est épuisé tant qu'aucune partie n'est « à repasser »", () => {
    expect(resitExhausted([part(), part({ ueState: "DEBT" })])).toBe(true);
    expect(resitExhausted([part(), part({ ueState: "RESIT" })])).toBe(false);
  });

  it("la partie la plus récente est celle de la clôture la plus tardive, départage déterministe", () => {
    const a = part({ academicPeriodId: U(20), validatedAt: new Date("2027-01-31T00:00:00Z") });
    const b = part({ academicPeriodId: U(21), validatedAt: new Date("2027-06-30T00:00:00Z") });
    expect(latestPart([a, b]).academicPeriodId).toBe(U(21));
    expect(latestPart([b, a]).academicPeriodId).toBe(U(21));
    const x = part({ academicPeriodId: U(30), validatedAt: null, recordedAt: new Date("2027-03-01T00:00:00Z") });
    const y = part({ academicPeriodId: U(31), validatedAt: null, recordedAt: new Date("2027-03-01T00:00:00Z") });
    expect(latestPart([x, y]).academicPeriodId).toBe(U(31));
  });

  it("ligne commune : sous l'ancre, valeurs du VERDICT des règles, version la plus haute, identifiants de la partie la plus récente", () => {
    const parts = [part({ resultsVersion: 1, compensatedEcueCount: 1 }), part({ academicPeriodId: U(21), partUeNodeId: U(11), resultsVersion: 3, sourceResultId: U(6), validatedAt: new Date("2027-06-30T00:00:00Z"), compensatedEcueCount: 2 })];
    const line = commonLine(def(), parts, { average: "13.5", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 1 });
    expect(line).toMatchObject({
      ueNodeId: U(10), academicPeriodId: U(21), sourceResultId: U(6), resultsVersion: 3, credits: 12, averageExact: "13.5", validated: true, ueState: "VALIDATED",
      sessionObtained: 1, via: "DIRECT", compensatedEcueCount: 3, annual: true,
    });
    expect(line.validatedAt).toEqual(new Date("2027-06-30T00:00:00Z"));
  });

  it("origine : session 2 -> RESIT ; toutes les parties validées par le jury -> JURY_OVERRIDE (une surcharge de référence) ; non validée -> aucune session", () => {
    const base = [part(), part({ academicPeriodId: U(21) })];
    expect(commonLine(def(), base, { average: "11", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 2 })).toMatchObject({ via: "RESIT", sessionObtained: 2 });
    const jury = [part({ via: "JURY_OVERRIDE", overrideId: U(7) }), part({ academicPeriodId: U(21), via: "JURY_OVERRIDE", overrideId: U(8) })];
    expect(commonLine(def(), jury, { average: "6", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 1 })).toMatchObject({ via: "JURY_OVERRIDE", overrideId: U(7) });
    const mixed = [part({ via: "JURY_OVERRIDE", overrideId: U(7) }), part({ academicPeriodId: U(21) })];
    expect(commonLine(def(), mixed, { average: "6", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 1 }).via).toBe("DIRECT");
    expect(commonLine(def(), base, { average: "8", credits: 12, validated: false, state: "DEBT", sessionObtained: null })).toMatchObject({ validated: false, ueState: "DEBT", sessionObtained: null, via: "DIRECT" });
  });

  it("repli des UE d'un cycle : l'ancre remplace ses parties (crédits additionnés), les autres UE sont inchangées, sans déclaration la liste est identique", () => {
    const ues = [
      { nodeId: U(10), code: "A1", credits: 6 },
      { nodeId: U(12), code: "B", credits: 4 },
      { nodeId: U(11), code: "A2", credits: 5.5 },
    ];
    expect(foldAnnualUes(ues, [])).toEqual(ues);
    const folded = foldAnnualUes(ues, [def()]);
    expect(folded.map((u) => u.nodeId)).toEqual([U(10), U(12)]);
    expect(folded[0]!.credits).toBe(11.5);
    // la partie qui n'est pas l'ancre ne ressort jamais seule
    expect(foldAnnualUes([ues[2]!], [def()])).toEqual([]);
  });
});

describe("O-14 : dispense d'UE — domaine pur", () => {
  it("deux politiques seulement ; défaut sans effet sur les crédits ; motif de 10 caractères", () => {
    expect([...EXEMPTION_CREDIT_POLICIES]).toEqual(["RECORD_ONLY", "GRANT_CREDITS"]);
    expect(DEFAULT_EXEMPTION_CREDIT_POLICY).toBe("RECORD_ONLY");
    expect(grantsCredits("RECORD_ONLY")).toBe(false);
    expect(grantsCredits("GRANT_CREDITS")).toBe(true);
    expect(isExemptionCreditPolicy("GRANT_CREDITS")).toBe(true);
    expect(isExemptionCreditPolicy("AUTRE")).toBe(false);
    expect(isExemptionCreditPolicy(undefined)).toBe(false);
    expect(EXEMPTION_REASON_MIN).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Adaptateur de règles : UE annuelle = règles EXISTANTES du contrat, une seule version épinglée
// ---------------------------------------------------------------------------

type Call = { ruleKey: string; context: { variables: Record<string, unknown> }; trace?: boolean | undefined };
type Request = Parameters<RulesApiLike["evaluateRuleSet"]>[1];

function fakeApi(outputs: Record<string, string | boolean | number | null>, opts: { failOn?: string } = {}) {
  const requests: Array<{ request: Request; calls: Call[] }> = [];
  const api: RulesApiLike = {
    async evaluateRuleSet(_ctx, request, calls) {
      requests.push({ request, calls: [...calls] as Call[] });
      const results: Array<Result<{ value: string | boolean | null; inputsHash: string; outputsHash: string }, AppError>> = calls.map((c) =>
        opts.failOn === c.ruleKey
          ? err(new ValidationError("règle en échec", [], { code: "rules.evaluation_failed" }))
          : ok({ value: (outputs[c.ruleKey] ?? null) as string | boolean | null, inputsHash: "a".repeat(64), outputsHash: "b".repeat(64) }),
      );
      return ok({ ruleVersionId: "00000000-0000-7000-8000-0000000000c1", ruleSetCode: "CI-HIGHER-LMD", versionNo: 3, definitionHash: "c".repeat(64), results });
    },
  };
  return { api, requests };
}
const ctx = {} as never;
const scope = { curriculumNodeId: U(10), onDate: "2027-06-30" };
const parts = [
  { moyenne: "11", credits: 6, validationManuelle: false, session: 1 },
  { moyenne: "15.5", credits: 6, validationManuelle: false, session: 2 },
];

describe("adaptateur du port de règles — évaluation d'une UE annuelle", () => {
  it("moyenne_annuelle + credits_ue, puis ue_validee sur la moyenne commune, puis etat_ue + session_validation_ue : même version épinglée", async () => {
    const { api, requests } = fakeApi({ moyenne_annuelle: "13.25", credits_ue: 12, ue_validee: true, etat_ue: "VALIDATED", session_validation_ue: 2 });
    const r = await createRulesAdapter(() => api).evaluateAnnualUe(ctx, { parts, session2Tentee: true, validationParJury: false, scope });
    expect(r).toMatchObject({ ok: true, value: { average: "13.25", credits: 12, validated: true, state: "VALIDATED", sessionObtained: 2, rule: { versionNo: 3, ruleSetCode: "CI-HIGHER-LMD" } } });
    expect(requests).toHaveLength(3);
    expect(requests[0]!.request).toEqual({ contractId: "credit-semester@1", curriculumNodeId: U(10), date: "2027-06-30" });
    expect(requests[0]!.calls.map((c) => c.ruleKey)).toEqual(["moyenne_annuelle", "credits_ue"]);
    expect(requests[0]!.calls[0]!.context.variables).toEqual({ semestres: [{ moyenne: "11", credits: 6 }, { moyenne: "15.5", credits: 6 }] });
    expect(requests[0]!.calls[1]!.context.variables).toEqual({
      ecues: [{ note: "11", credits: 6, validation_manuelle: false }, { note: "15.5", credits: 6, validation_manuelle: false }],
    });
    const pin = { pin: { ruleVersionId: "00000000-0000-7000-8000-0000000000c1", definitionHash: "c".repeat(64) }, contractId: "credit-semester@1" };
    expect(requests[1]!.request).toEqual(pin);
    expect(requests[1]!.calls[0]).toMatchObject({ ruleKey: "ue_validee", context: { variables: { moyenne: "13.25", ecues: [{ note: "13.25", credits: 12, validation_manuelle: false }] } } });
    expect(requests[2]!.request).toEqual(pin);
    expect(requests[2]!.calls.map((c) => c.ruleKey)).toEqual(["etat_ue", "session_validation_ue"]);
    expect(requests[2]!.calls[0]!.context.variables).toEqual({ validee: true, session2_tentee: true });
    expect(requests[2]!.calls[1]!.context.variables).toEqual({ validee: true, sessions: [1, 2] });
  });

  it("validation par le jury : ue_validee n'est PAS appelée, la décision humaine prime", async () => {
    const { api, requests } = fakeApi({ moyenne_annuelle: "6", credits_ue: 12, etat_ue: "VALIDATED", session_validation_ue: 1 });
    const r = await createRulesAdapter(() => api).evaluateAnnualUe(ctx, { parts, session2Tentee: true, validationParJury: true, scope });
    expect(r).toMatchObject({ ok: true, value: { validated: true } });
    expect(requests.flatMap((q) => q.calls.map((c) => c.ruleKey))).not.toContain("ue_validee");
  });

  it("une règle en échec, un état LMD inconnu ou des crédits non numériques sont REFUSÉS (échec fermé)", async () => {
    const failing = await createRulesAdapter(() => fakeApi({ moyenne_annuelle: "1", credits_ue: 1 }, { failOn: "ue_validee" }).api).evaluateAnnualUe(ctx, { parts, session2Tentee: false, validationParJury: false, scope });
    expect(!failing.ok && failing.error.code).toBe("rules.evaluation_failed");
    const bad = await createRulesAdapter(() => fakeApi({ moyenne_annuelle: "12", credits_ue: 12, ue_validee: true, etat_ue: "BIZARRE", session_validation_ue: 1 }).api).evaluateAnnualUe(ctx, { parts, session2Tentee: false, validationParJury: false, scope });
    expect(!bad.ok && bad.error.code).toBe("higher.rules_unavailable");
    const noCredits = await createRulesAdapter(() => fakeApi({ moyenne_annuelle: "12", credits_ue: null }).api).evaluateAnnualUe(ctx, { parts, session2Tentee: false, validationParJury: false, scope });
    expect(!noCredits.ok && noCredits.error.code).toBe("higher.rules_unavailable");
    const notBool = await createRulesAdapter(() => fakeApi({ moyenne_annuelle: "12", credits_ue: 12, ue_validee: "OUI" }).api).evaluateAnnualUe(ctx, { parts, session2Tentee: false, validationParJury: false, scope });
    expect(!notBool.ok && notBool.error.code).toBe("higher.rules_unavailable");
  });

  it("module rules absent : refus (higher.rules_unavailable)", async () => {
    const adapter = createRulesAdapter(() => undefined);
    await expect(adapter.evaluateAnnualUe(ctx, { parts, session2Tentee: false, validationParJury: false, scope })).rejects.toMatchObject({ code: "higher.rules_unavailable" });
  });
});
