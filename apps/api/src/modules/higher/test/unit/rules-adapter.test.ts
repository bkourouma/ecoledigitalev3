import { describe, expect, it } from "vitest";
import { err, ok, ValidationError, type AppError, type Result } from "@ecoledigitale/kernel";
import { createRulesAdapter, type RulesApiLike } from "../../infrastructure/rules-adapter";
import { isBenignConsumerError } from "../../application/consumers";
import { HigherCode, validation } from "../../domain/errors";

type Call = { ruleKey: string; context: { variables: Record<string, unknown> }; trace?: boolean | undefined };
type Request = Parameters<RulesApiLike["evaluateRuleSet"]>[1];

/** Fausse API du module rules : enregistre les requêtes et rend des sorties scénarisées. */
function fakeApi(outputs: Record<string, string | boolean | null>, opts: { failOn?: string } = {}) {
  const requests: Array<{ request: Request; calls: Call[] }> = [];
  const api: RulesApiLike = {
    async evaluateRuleSet(_ctx, request, calls) {
      requests.push({ request, calls: [...calls] as Call[] });
      const results: Array<Result<{ value: string | boolean | null; inputsHash: string; outputsHash: string }, AppError>> = calls.map((c) =>
        opts.failOn === c.ruleKey
          ? err(new ValidationError("règle en échec", [], { code: "rules.evaluation_failed" }))
          : ok({ value: outputs[c.ruleKey] ?? null, inputsHash: "a".repeat(64), outputsHash: "b".repeat(64) }),
      );
      return ok({ ruleVersionId: "00000000-0000-7000-8000-0000000000c1", ruleSetCode: "CI-HIGHER-LMD", versionNo: 3, definitionHash: "c".repeat(64), results });
    },
  };
  return { api, requests };
}

const ctx = {} as never;

describe("adaptateur du port de règles : aucune formule, seulement des clés de règle et des contextes typés", () => {
  it("éligibilité : variables `exigences` et `uv_requises` du contrat, jeu résolu à la date d'effet et au périmètre", async () => {
    const { api, requests } = fakeApi({ diplome_eligible: true });
    const adapter = createRulesAdapter(() => api);
    const r = await adapter.evaluateEligibility(ctx, {
      exigences: [{ valide: true, obligatoire: true, uv: 6 }],
      uvRequises: 12,
      scope: { institutionId: "i1", curriculumNodeId: "n1", onDate: "2026-10-01" },
    });
    expect(r).toMatchObject({ ok: true, value: { eligible: true, rule: { ruleSetCode: "CI-HIGHER-LMD", versionNo: 3, definitionHash: "c".repeat(64) }, inputsHash: "a".repeat(64) } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.request).toEqual({ contractId: "credit-semester@1", institutionId: "i1", curriculumNodeId: "n1", date: "2026-10-01" });
    expect(requests[0]!.calls).toEqual([{ ruleKey: "diplome_eligible", context: { variables: { exigences: [{ valide: true, obligatoire: true, uv: 6 }], uv_requises: 12 } }, trace: false }]);
  });

  it("une règle qui ne rend pas un booléen est refusée (jamais d'éligibilité supposée)", async () => {
    const adapter = createRulesAdapter(() => fakeApi({ diplome_eligible: "OUI" }).api);
    const r = await adapter.evaluateEligibility(ctx, { exigences: [], uvRequises: 1, scope: { onDate: "2026-10-01" } });
    expect(!r.ok && r.error.code).toBe("higher.rules_unavailable");
  });

  it("cycle : moyenne_annuelle puis mention_diplome AVEC LA MÊME VERSION de règle (épinglée par empreinte)", async () => {
    const { api, requests } = fakeApi({ moyenne_annuelle: "13.25", mention_diplome: "FAIRLY_GOOD" });
    const r = await createRulesAdapter(() => api).evaluateCycle(ctx, { semestres: [{ moyenne: "13", credits: 30 }, { moyenne: "13.5", credits: 30 }], scope: { onDate: "2026-10-01" } });
    expect(r).toMatchObject({ ok: true, value: { average: "13.25", mentionCode: "FAIRLY_GOOD", rule: { versionNo: 3 } } });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.calls[0]).toMatchObject({ ruleKey: "moyenne_annuelle", context: { variables: { semestres: [{ moyenne: "13", credits: 30 }, { moyenne: "13.5", credits: 30 }] } } });
    expect(requests[1]!.request).toEqual({ pin: { ruleVersionId: "00000000-0000-7000-8000-0000000000c1", definitionHash: "c".repeat(64) }, contractId: "credit-semester@1" });
    expect(requests[1]!.calls[0]).toMatchObject({ ruleKey: "mention_diplome", context: { variables: { moyenne: "13.25" } } });
  });

  it("moyenne absente : transmise telle quelle (la règle rend PENDING), les erreurs de règle remontent sans masquage", async () => {
    const { api, requests } = fakeApi({ moyenne_annuelle: null, mention_diplome: "PENDING" });
    const r = await createRulesAdapter(() => api).evaluateCycle(ctx, { semestres: [], scope: { onDate: "2026-10-01" } });
    expect(r).toMatchObject({ ok: true, value: { average: null, mentionCode: "PENDING" } });
    expect(requests[1]!.calls[0]).toMatchObject({ context: { variables: { moyenne: null } } });

    const failing = await createRulesAdapter(() => fakeApi({}, { failOn: "diplome_eligible" }).api).evaluateEligibility(ctx, { exigences: [], uvRequises: 1, scope: { onDate: "2026-10-01" } });
    expect(!failing.ok && failing.error.code).toBe("rules.evaluation_failed");
  });
});

describe("abonnés : erreurs bénignes (jamais rejouées) et transitoires (rejouées)", () => {
  it("payload inexploitable et diplôme disparu = bénin ; règle indisponible, base, port = rejoué", () => {
    expect(isBenignConsumerError(validation(HigherCode.INVALID_INPUT, "x"))).toBe(true);
    expect(isBenignConsumerError(new ValidationError("x", [], { code: HigherCode.DIPLOMA_NOT_FOUND }))).toBe(true);
    expect(isBenignConsumerError(new ValidationError("x", [], { code: "rules.no_active_ruleset" }))).toBe(false);
    expect(isBenignConsumerError(new ValidationError("x", [], { code: HigherCode.PORT_UNAVAILABLE }))).toBe(false);
    expect(isBenignConsumerError(new ValidationError("x", [], { code: HigherCode.RULES_UNAVAILABLE }))).toBe(false);
  });
});
