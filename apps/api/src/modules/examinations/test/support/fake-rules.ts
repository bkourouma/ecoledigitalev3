/**
 * Évaluateur FICTIF du contrat `exam-national@1` pour les TESTS — il reproduit les golden tests de MÉCANISME G1–G14 de
 * `specs/v2/018-examinations/rule-contract.md` avec les paramètres du RuleSet fictif `CI-EXAM-PLACEHOLDER` :
 *   absence_vaut_zero = 0 · seuil_admission = 10 (milieu du barème /20, choisi pour exercer le mécanisme, AUCUNE valeur réglementaire) ·
 *   denominateur = 1 (présents) · décimales exactes.
 * Ce fichier vit sous `test/` à dessein : le module lui-même ne contient aucune formule ni aucun seuil (test `no-hardcoded-rules`).
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { RuleCall, RuleCallResult, RulePin, RuleSession, RulesPort } from "../../application/ports";

const SCALE = 1_000_000_000n;

function toScaled(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`décimal invalide : ${s}`);
  const frac = (m[3] ?? "").padEnd(9, "0").slice(0, 9);
  const n = BigInt(m[2] as string) * SCALE + BigInt(frac);
  return m[1] === "-" ? -n : n;
}

function fromScaled(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export const FAKE_RULE_VERSION_ID = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";

export const FAKE_PIN: RulePin = { ruleVersionId: FAKE_RULE_VERSION_ID, ruleSetCode: "CI-EXAM-PLACEHOLDER", versionNo: 1, sourceKind: "placeholder" };

export interface FakeParams {
  absenceVautZero: 0 | 1;
  seuilAdmission: string;
  denominateur: 0 | 1;
}

export const DEFAULT_FAKE_PARAMS: FakeParams = { absenceVautZero: 0, seuilAdmission: "10", denominateur: 1 };

const hashOf = (call: RuleCall): string => createHash("sha256").update(JSON.stringify({ k: call.ruleKey, v: call.variables })).digest("hex");

function evaluateOne(call: RuleCall, p: FakeParams): RuleCallResult {
  const v = call.variables as Record<string, unknown>;
  const inputsHash = hashOf(call);
  const val = (value: string | boolean | null): RuleCallResult => ({ ok: true, value, inputsHash });
  switch (call.ruleKey) {
    case "eligibilite":
      return val(!v.en_classe_examen ? "INELIGIBLE" : !v.pieces_completes ? "NEEDS_REVIEW" : "ELIGIBLE");
    case "motif_eligibilite":
      return val(!v.en_classe_examen ? "NOT_IN_EXAM_GRADE" : !v.pieces_completes ? "DOCUMENTS_MISSING" : "NONE");
    case "note_epreuve_sur_20": {
      const note = toScaled(v.note) as bigint;
      const bareme = toScaled(v.bareme) as bigint;
      return val(fromScaled((note * 20n * SCALE) / bareme));
    }
    case "moyenne_candidat": {
      const list = (v.epreuves as Array<{ note: string | null; coef: string; bareme: string; absent: boolean }>) ?? [];
      let num = 0n;
      let den = 0n;
      for (const e of list) {
        const coef = toScaled(e.coef) as bigint;
        const bareme = toScaled(e.bareme) as bigint;
        const noted = !e.absent && e.note !== null;
        if (!noted && p.absenceVautZero === 0) continue;
        const note = noted ? (toScaled(e.note) as bigint) : 0n;
        num += (((note * 20n * SCALE) / bareme) * coef) / SCALE;
        den += coef;
      }
      if (den === 0n) return val(null);
      return val(fromScaled((num * SCALE) / den));
    }
    case "resultat_candidat": {
      const avg = toScaled(v.moyenne);
      if (avg === null) return val("ABSENT");
      if (Number(v.epreuves_eliminatoires_echouees) > 0) return val("FAILED");
      return val(avg >= (toScaled(p.seuilAdmission) as bigint) ? "ADMITTED" : "FAILED");
    }
    case "rang_candidat": {
      const avg = toScaled(v.moyenne);
      if (avg === null) return val(null);
      const cohort = (v.cohorte as Array<string | null>).map((x) => toScaled(x));
      return val(String(1 + cohort.filter((c) => c !== null && c > avg).length));
    }
    case "taux_reussite": {
      const admis = BigInt(String(v.admis));
      const den = BigInt(String(p.denominateur === 1 ? v.presents : v.inscrits));
      if (den === 0n) return val(null);
      // pourcentage avec 2 décimales exactes (arrondi demi supérieur)
      const scaled = (admis * 100n * 100n * 2n + den) / (den * 2n);
      return val(fromScaled(scaled * (SCALE / 100n)));
    }
    default:
      return { ok: false, code: "rules.unknown_rule", message: `Règle « ${call.ruleKey} » absente de la version.` };
  }
}

export interface FakeRulesOptions {
  params?: Partial<FakeParams>;
  /** Aucune liaison de règle (`resolve` renvoie `null`) : éligibilité automatique indisponible. */
  noBinding?: boolean;
  pin?: Partial<RulePin>;
}

export function fakeRules(options: FakeRulesOptions = {}): RulesPort & { calls: RuleCall[] } {
  const params = { ...DEFAULT_FAKE_PARAMS, ...options.params };
  const pin: RulePin = { ...FAKE_PIN, ...options.pin };
  const calls: RuleCall[] = [];
  return {
    calls,
    async resolve(): Promise<Result<RulePin | null, AppError>> {
      return ok(options.noBinding ? null : pin);
    },
    async open(_ctx: RequestContext, ruleVersionId: string): Promise<Result<RuleSession, AppError>> {
      if (ruleVersionId !== pin.ruleVersionId) return err({ code: "rules.version_not_found", message: "version inconnue" } as unknown as AppError);
      return ok({
        pin,
        engineVersion: "fake-1",
        evaluate(batch) {
          calls.push(...batch);
          return batch.map((c) => evaluateOne(c, params));
        },
      });
    },
  };
}
