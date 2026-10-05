import { describe, expect, it } from "vitest";
import { checkFundingConsistency, fundingTypesOf, validateAdditionalFundingTypes } from "../../domain/funding";
import { splitFunding, validateScholarshipDraft, type FundableLine, type Scholarship } from "../../domain/scholarship";
import { xof } from "../support/factories";

const line = (id: string, amount: number, category: FundableLine["category"] = "TUITION"): FundableLine => ({ id, category, amount: xof(amount) });
const sch = (id: string, over: Partial<Scholarship>): Scholarship => ({
  id,
  learnerId: "L",
  academicYear: "2025-2026",
  funderKind: "FOUNDATION",
  funderName: `Financeur ${id}`,
  reference: null,
  coverage: { kind: "PERCENT", bps: 1000 },
  capAmount: null,
  categories: null,
  status: "ACTIVE",
  priority: 100,
  ...over,
});
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

describe("O-04 : parts d'un cumul de financements (base TOTAL)", () => {
  const lines = [line("a", 500_000), line("b", 60_000, "CANTEEN")];

  it("État 60 % + bourse 25 % + famille 15 % du total net : les pourcentages se composent sur le TOTAL, au franc près", () => {
    const split = unwrap(
      splitFunding(lines, [
        sch("etat", { funderKind: "STATE", shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 6000 }, priority: 1 }),
        sch("bourse", { shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 2500 }, priority: 2 }),
      ]),
    );
    expect(split.shares.map((s) => [s.scholarshipId, s.total.amount])).toEqual([["etat", 336_000], ["bourse", 140_000]]);
    expect(split.parentTotal.amount).toBe(84_000);
    expect(split.fundedTotal.amount + split.parentTotal.amount).toBe(560_000);
    expect(split.overcommitted).toEqual([]);
  });

  it("non-régression : la base REMAINING (défaut historique) reste séquentielle (60 % puis 25 % du reste)", () => {
    const split = unwrap(
      splitFunding(lines, [
        sch("etat", { funderKind: "STATE", coverage: { kind: "PERCENT", bps: 6000 }, priority: 1 }),
        sch("bourse", { shareBasis: "REMAINING", coverage: { kind: "PERCENT", bps: 2500 }, priority: 2 }),
      ]),
    );
    expect(split.shares.map((s) => s.total.amount)).toEqual([336_000, 56_000]); // 25 % de 224 000
    expect(split.parentTotal.amount).toBe(168_000);
  });

  it("un cumul à 100 % exactement ne laisse rien à la famille ; l'arrondi (demi vers le haut) n'est pas une erreur", () => {
    const odd = [line("x", 5)];
    const split = unwrap(splitFunding(odd, [sch("a", { shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 5000 } }), sch("b", { shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 5000 }, priority: 101 })]));
    expect(split.parentTotal.amount).toBe(0);
    expect(split.fundedTotal.amount).toBe(5);
    expect(split.overcommitted).toEqual([]);
  });

  it("une part en montant (TOTAL) que le reste ne couvre pas est signalée, pas tronquée en silence", () => {
    const split = unwrap(
      splitFunding(lines, [
        sch("etat", { funderKind: "STATE", shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 6000 }, priority: 1 }),
        sch("entreprise", { funderKind: "COMPANY", shareBasis: "TOTAL", coverage: { kind: "FIXED", amount: xof(400_000) }, priority: 2 }),
      ]),
    );
    expect(split.overcommitted.map((o) => [o.scholarshipId, o.requested.amount, o.applied.amount])).toEqual([["entreprise", 400_000, 224_000]]);
    expect(split.parentTotal.amount).toBe(0);
  });

  it("une part TOTAL dont la base est déjà épuisée par une part précédente est signalée aussi", () => {
    const split = unwrap(
      splitFunding([line("a", 100_000)], [
        sch("tout", { shareBasis: "TOTAL", coverage: { kind: "PERCENT", bps: 10_000 }, priority: 1 }),
        sch("trop", { shareBasis: "TOTAL", coverage: { kind: "FIXED", amount: xof(50_000) }, priority: 2 }),
      ]),
    );
    expect(split.overcommitted.map((o) => o.scholarshipId)).toEqual(["trop"]);
  });

  it("une part suspendue ou terminée ne compte pas", () => {
    const split = unwrap(splitFunding(lines, [sch("a", { shareBasis: "TOTAL", status: "SUSPENDED", coverage: { kind: "PERCENT", bps: 9000 } })]));
    expect(split.shares).toEqual([]);
    expect(split.parentTotal.amount).toBe(560_000);
  });

  it("le brouillon valide la base de calcul (REMAINING par défaut)", () => {
    const base = { learnerId: "L", academicYear: "2025-2026", funderKind: "STATE", funderName: "État", coverage: { kind: "PERCENT", bps: 5000 } };
    expect(unwrap(validateScholarshipDraft(base)).shareBasis).toBe("REMAINING");
    expect(unwrap(validateScholarshipDraft({ ...base, shareBasis: "TOTAL" })).shareBasis).toBe("TOTAL");
    expect(validateScholarshipDraft({ ...base, shareBasis: "AUTRE" }).ok).toBe(false);
  });
});

describe("O-04 : types de financement cumulés d'un compte", () => {
  it("le type principal est conservé, les autres s'y ajoutent sans doublon", () => {
    expect(fundingTypesOf({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["SCHOLARSHIP", "STATE_ASSIGNED"] })).toEqual(["STATE_ASSIGNED", "SCHOLARSHIP"]);
    expect(fundingTypesOf({ fundingType: "PRIVATE" })).toEqual(["PRIVATE"]);
  });
  it("validation : « privé » non cumulable, doublon et type inconnu refusés ; absent = liste vide", () => {
    expect(unwrap(validateAdditionalFundingTypes("STATE_ASSIGNED", ["SCHOLARSHIP", "COMPANY"]))).toEqual(["SCHOLARSHIP", "COMPANY"]);
    expect(unwrap(validateAdditionalFundingTypes("STATE_ASSIGNED", undefined))).toEqual([]);
    expect(validateAdditionalFundingTypes("STATE_ASSIGNED", ["PRIVATE"]).ok).toBe(false);
    expect(validateAdditionalFundingTypes("STATE_ASSIGNED", ["STATE_ASSIGNED"]).ok).toBe(false);
    expect(validateAdditionalFundingTypes("STATE_ASSIGNED", ["SCHOLARSHIP", "SCHOLARSHIP"]).ok).toBe(false);
    expect(validateAdditionalFundingTypes("STATE_ASSIGNED", ["INCONNU"]).ok).toBe(false);
  });
  it("chaque type du cumul doit être soutenu par une prise en charge active", () => {
    const state = sch("etat", { funderKind: "STATE" });
    expect(checkFundingConsistency({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: [] }, [state], "2025-2026").ok).toBe(true);
    const missing = checkFundingConsistency({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["COMPANY"] }, [state], "2025-2026");
    expect(missing.ok).toBe(false);
    // Bourse cumulée avec l'État : l'État seul ne suffit pas, il faut une AUTRE prise en charge active.
    expect(checkFundingConsistency({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["SCHOLARSHIP"] }, [state], "2025-2026").ok).toBe(false);
    expect(checkFundingConsistency({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["SCHOLARSHIP"] }, [state, sch("b", {})], "2025-2026").ok).toBe(true);
    expect(checkFundingConsistency({ fundingType: "SCHOLARSHIP" }, [state], "2025-2026").ok).toBe(true); // historique : toute bourse active suffit
    expect(checkFundingConsistency({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["COMPANY"] }, [state, sch("co", { funderKind: "COMPANY" })], "2025-2026").ok).toBe(true);
  });
});
