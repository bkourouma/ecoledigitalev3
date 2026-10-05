import { describe, expect, it } from "vitest";
import { familyRemainderBps, principalOf, validateFundingShares, type FundingShareInput } from "../../domain/enrollment-funding";
import type { FundingType } from "../../domain/records";

const def = (code: string, over: Partial<FundingType> = {}): FundingType => ({ id: code, code, label: code, requiresReference: false, requiresFunder: false, sortOrder: 0, active: true, ...over });
const defs: FundingType[] = [
  def("PRIVATE"),
  def("STATE_ASSIGNED", { requiresReference: true }),
  def("SCHOLARSHIP", { requiresFunder: true }),
  def("COMPANY", { requiresFunder: true }),
  def("OTHER"),
  def("STAFF_CHILD", { active: false }),
];
const pct = (fundingType: string, bps: number, extra: Partial<FundingShareInput> = {}): FundingShareInput => ({ fundingType, share: { kind: "PERCENT", bps }, ...extra });
const amt = (fundingType: string, amount: number, currency = "XOF", extra: Partial<FundingShareInput> = {}): FundingShareInput => ({ fundingType, share: { kind: "AMOUNT", amount, currency }, ...extra });
const code = (inputs: FundingShareInput[]) => (validateFundingShares(defs, inputs) as { code?: string } | null)?.code ?? null;

describe("O-04 : validation d'un cumul de financements", () => {
  it("un cumul valide : bourse 40 % + État 60 % (somme exactement 100 %)", () => {
    expect(code([pct("SCHOLARSHIP", 4000, { funderLabel: "Fondation" }), pct("STATE_ASSIGNED", 6000, { assignmentReference: "AFF-1" })])).toBeNull();
  });
  it("une somme > 100 % est refusée, au point de base près", () => {
    expect(code([pct("SCHOLARSHIP", 5001, { funderLabel: "F" }), pct("OTHER", 5000)])).toBe("academic.funding_shares_exceed");
    expect(code([pct("SCHOLARSHIP", 5000, { funderLabel: "F" }), pct("OTHER", 5000)])).toBeNull();
  });
  it("un cumul vide est valide (famille seule) ; au plus 6 parts", () => {
    expect(code([])).toBeNull();
    const many = ["A", "B", "C", "D", "E", "F", "G"].map((l) => pct("OTHER", 100, { funderLabel: l }));
    expect(code(many)).toBe("academic.funding_shares_invalid");
  });
  it("« privé » n'est jamais une part ; type inactif ou inconnu refusé ; références et financeur exigés selon le type", () => {
    expect(code([pct("PRIVATE", 1000)])).toBe("academic.funding_shares_invalid");
    expect(code([pct("STAFF_CHILD", 1000)])).toBe("academic.funding_type_unknown");
    expect(code([pct("INCONNU", 1000)])).toBe("academic.funding_type_unknown");
    expect(code([pct("STATE_ASSIGNED", 1000)])).toBe("academic.funding_reference_required");
    expect(code([pct("SCHOLARSHIP", 1000)])).toBe("academic.funding_funder_required");
  });
  it("parts mal formées : pourcentage hors bornes ou non entier, montant nul, devise inconnue ou mélangée, doublon", () => {
    expect(code([pct("OTHER", 0)])).toBe("academic.funding_shares_invalid");
    expect(code([pct("OTHER", 10_001)])).toBe("academic.funding_shares_invalid");
    expect(code([pct("OTHER", 12.5)])).toBe("academic.funding_shares_invalid");
    expect(code([amt("OTHER", 0)])).toBe("academic.funding_shares_invalid");
    expect(code([amt("OTHER", 100, "GBP")])).toBe("academic.funding_shares_invalid");
    expect(code([amt("OTHER", 100, "XOF", { funderLabel: "A" }), amt("OTHER", 100, "EUR", { funderLabel: "B" })])).toBe("academic.funding_currency_mismatch");
    expect(code([pct("OTHER", 1000, { funderLabel: "A" }), pct("OTHER", 1000, { funderLabel: " A " })])).toBe("academic.funding_shares_invalid");
    expect(code([pct("OTHER", 1000, { funderLabel: "A" }), pct("OTHER", 1000, { funderLabel: "B" })])).toBeNull();
  });
  it("pourcentage et montant peuvent se cumuler (la somme du montant se contrôle à la facturation)", () => {
    expect(code([pct("SCHOLARSHIP", 3000, { funderLabel: "F" }), amt("COMPANY", 250_000, "XOF", { funderLabel: "E" })])).toBeNull();
  });
});

describe("type principal et reste de la famille", () => {
  it("le principal est la plus grande part en pourcentage, sinon le plus grand montant ; vide : aucun", () => {
    expect(principalOf([])).toBeNull();
    expect(principalOf([pct("SCHOLARSHIP", 4000), pct("STATE_ASSIGNED", 5000)])?.fundingType).toBe("STATE_ASSIGNED");
    expect(principalOf([amt("COMPANY", 100), amt("OTHER", 900)])?.fundingType).toBe("OTHER");
    expect(principalOf([pct("OTHER", 2000), pct("SCHOLARSHIP", 2000)])?.fundingType).toBe("OTHER"); // égalité : l'ordre de saisie
  });
  it("reste de la famille : exact en pourcentage, inconnu dès qu'un montant intervient", () => {
    expect(familyRemainderBps([pct("SCHOLARSHIP", 4000), pct("STATE_ASSIGNED", 5000)])).toBe(1000);
    expect(familyRemainderBps([])).toBe(10_000);
    expect(familyRemainderBps([pct("SCHOLARSHIP", 4000), amt("COMPANY", 10)])).toBeNull();
  });
});
