import { describe, expect, it } from "vitest";
import {
  OFFERING_TRANSITIONS,
  applyOverride,
  canTransitionOffering,
  checkOfferingDates,
  countHeldPlaces,
  deriveOfferingStatus,
  evaluateEligibility,
  holdsPlace,
  isManualOfferingTarget,
  isOfferingReopening,
  remainingPlaces,
  shouldFinalizeOffering,
  type EligibilityFacts,
} from "../../domain/offering";

const NOW = new Date("2026-10-01T10:00:00Z");
const facts = (over: Partial<EligibilityFacts> = {}, offering: Partial<EligibilityFacts["offering"]> = {}): EligibilityFacts => ({
  offering: { status: "OPEN", capacity: 10, registrationOpensAt: "2026-09-01T00:00:00Z", registrationClosesAt: "2026-10-31T23:59:59Z", ...offering },
  periodState: "OPEN",
  now: NOW,
  hasLiveDuplicate: false,
  heldByOthers: 3,
  missingPrerequisites: [],
  alreadyCompleted: false,
  ...over,
});

describe("machine d'états d'une offre (R14)", () => {
  it("DRAFT -> OPEN <-> FULL -> IN_PROGRESS -> COMPLETED, CANCELLED terminal sauf réouverture motivée", () => {
    expect(canTransitionOffering("DRAFT", "OPEN")).toBe(true);
    expect(canTransitionOffering("DRAFT", "COMPLETED")).toBe(false);
    expect(canTransitionOffering("OPEN", "FULL")).toBe(true);
    expect(canTransitionOffering("FULL", "OPEN")).toBe(true);
    expect(canTransitionOffering("FULL", "DRAFT")).toBe(false);
    expect(canTransitionOffering("IN_PROGRESS", "OPEN")).toBe(false);
    expect(canTransitionOffering("COMPLETED", "OPEN")).toBe(true);
    expect(canTransitionOffering("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionOffering("CANCELLED", "DRAFT")).toBe(true);
    expect(canTransitionOffering("CANCELLED", "OPEN")).toBe(false);
    expect(Object.keys(OFFERING_TRANSITIONS)).toHaveLength(6);
  });
  it("FULL n'est jamais posé à la main ; les réouvertures sont repérées", () => {
    expect(isManualOfferingTarget("FULL")).toBe(false);
    expect(isManualOfferingTarget("OPEN")).toBe(true);
    expect(isOfferingReopening("COMPLETED", "OPEN")).toBe(true);
    expect(isOfferingReopening("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(isOfferingReopening("CANCELLED", "DRAFT")).toBe(true);
    expect(isOfferingReopening("DRAFT", "OPEN")).toBe(false);
  });
  it("finalisation planifiée : jamais DRAFT ni CANCELLED, seulement après la date de fin (AC3.5)", () => {
    expect(shouldFinalizeOffering({ status: "OPEN", endsOn: "2026-09-30" }, "2026-10-01")).toBe(true);
    expect(shouldFinalizeOffering({ status: "FULL", endsOn: "2026-09-30" }, "2026-10-01")).toBe(true);
    expect(shouldFinalizeOffering({ status: "IN_PROGRESS", endsOn: "2026-09-30" }, "2026-10-01")).toBe(true);
    expect(shouldFinalizeOffering({ status: "OPEN", endsOn: "2026-10-01" }, "2026-10-01")).toBe(false);
    expect(shouldFinalizeOffering({ status: "DRAFT", endsOn: "2026-01-01" }, "2026-10-01")).toBe(false);
    expect(shouldFinalizeOffering({ status: "CANCELLED", endsOn: "2026-01-01" }, "2026-10-01")).toBe(false);
    expect(shouldFinalizeOffering({ status: "COMPLETED", endsOn: "2026-01-01" }, "2026-10-01")).toBe(false);
  });
});

describe("capacité et statut dérivé (R16, R17)", () => {
  it("une place est réservée par PENDING non expiré, CONFIRMED et COMPLETED", () => {
    expect(holdsPlace({ status: "CONFIRMED", holdExpiresAt: null }, NOW)).toBe(true);
    expect(holdsPlace({ status: "COMPLETED", holdExpiresAt: null }, NOW)).toBe(true);
    expect(holdsPlace({ status: "PENDING", holdExpiresAt: null }, NOW)).toBe(true);
    expect(holdsPlace({ status: "PENDING", holdExpiresAt: "2026-10-01T10:00:01Z" }, NOW)).toBe(true);
    expect(holdsPlace({ status: "PENDING", holdExpiresAt: "2026-10-01T10:00:00Z" }, NOW)).toBe(false);
    expect(holdsPlace({ status: "PENDING", holdExpiresAt: "2026-10-01T09:00:00Z" }, NOW)).toBe(false);
    expect(holdsPlace({ status: "CANCELLED", holdExpiresAt: null }, NOW)).toBe(false);
    expect(countHeldPlaces([{ status: "CONFIRMED", holdExpiresAt: null }, { status: "PENDING", holdExpiresAt: "2020-01-01T00:00:00Z" }, { status: "PENDING", holdExpiresAt: null }], NOW)).toBe(2);
  });
  it("OPEN -> FULL à la capacité ; FULL -> OPEN quand une place se libère ET que la fenêtre est valide (ou absente)", () => {
    const base = { capacity: 5, registrationClosesAt: "2026-10-31T00:00:00Z", now: NOW };
    expect(deriveOfferingStatus({ ...base, status: "OPEN", held: 4 })).toBe("OPEN");
    expect(deriveOfferingStatus({ ...base, status: "OPEN", held: 5 })).toBe("FULL");
    expect(deriveOfferingStatus({ ...base, status: "FULL", held: 5 })).toBe("FULL");
    expect(deriveOfferingStatus({ ...base, status: "FULL", held: 4 })).toBe("OPEN");
    expect(deriveOfferingStatus({ ...base, status: "FULL", held: 4, registrationClosesAt: "2026-09-30T00:00:00Z" })).toBe("FULL");
    expect(deriveOfferingStatus({ ...base, status: "FULL", held: 4, registrationClosesAt: null })).toBe("OPEN");
    expect(deriveOfferingStatus({ ...base, status: "OPEN", held: 99, capacity: null })).toBe("OPEN");
    for (const s of ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) expect(deriveOfferingStatus({ ...base, status: s, held: 5 })).toBe(s);
  });
  it("places restantes", () => {
    expect(remainingPlaces(null, 4)).toBeNull();
    expect(remainingPlaces(10, 4)).toBe(6);
    expect(remainingPlaces(3, 4)).toBe(0);
  });
  it("dates d'une offre dans l'année de la classe, fenêtre cohérente", () => {
    const year = { yearStartsOn: "2026-09-01", yearEndsOn: "2027-08-31" };
    expect(checkOfferingDates({ ...year, startsOn: "2026-09-10", endsOn: "2027-01-31" })).toBeNull();
    expect(checkOfferingDates({ ...year, startsOn: "2026-09-10", endsOn: "2026-09-09" })?.code).toBe("academic.offering_dates_invalid");
    expect(checkOfferingDates({ ...year, startsOn: "2026-08-31", endsOn: "2027-01-31" })?.code).toBe("academic.offering_outside_year");
    expect(checkOfferingDates({ ...year, startsOn: "2026-09-10", endsOn: "2027-09-01" })?.code).toBe("academic.offering_outside_year");
    expect(checkOfferingDates({ ...year, startsOn: "2026-09-10", endsOn: "2027-01-31", registrationOpensAt: "2026-09-01T00:00:00Z", registrationClosesAt: null })?.code).toBe("academic.offering_dates_invalid");
    expect(checkOfferingDates({ ...year, startsOn: "2026-09-10", endsOn: "2027-01-31", registrationOpensAt: "2026-09-10T00:00:00Z", registrationClosesAt: "2026-09-01T00:00:00Z" })?.code).toBe("academic.offering_dates_invalid");
  });
});

describe("éligibilité : ORDRE FIGÉ, premier échec renvoyé (AC5.1)", () => {
  it("offre éligible", () => {
    const r = evaluateEligibility(facts());
    expect(r).toMatchObject({ eligible: true, failure: null, remainingPlaces: 7, warnings: [] });
  });
  it("1. offre non ouverte (brouillon, en cours, terminée, annulée)", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(evaluateEligibility(facts({}, { status })).failure?.code).toBe("academic.offering_not_open");
    }
  });
  it("2. période close pour la classe (état effectif >= GRADING_CLOSED)", () => {
    expect(evaluateEligibility(facts({ periodState: "GRADING_CLOSED" })).failure?.code).toBe("academic.period_closed");
    expect(evaluateEligibility(facts({ periodState: "CLOSED" })).failure?.code).toBe("academic.period_closed");
    expect(evaluateEligibility(facts({ periodState: "OPEN" })).eligible).toBe(true);
    expect(evaluateEligibility(facts({ periodState: null })).eligible).toBe(true);
  });
  it("3. fenêtre : bornes INCLUSES ; fenêtre facultative", () => {
    const at = (iso: string) => new Date(iso);
    expect(evaluateEligibility(facts({ now: at("2026-09-01T00:00:00Z") })).eligible).toBe(true);
    expect(evaluateEligibility(facts({ now: at("2026-10-31T23:59:59Z") })).eligible).toBe(true);
    expect(evaluateEligibility(facts({ now: at("2026-08-31T23:59:59Z") })).failure?.code).toBe("academic.registration_window_closed");
    expect(evaluateEligibility(facts({ now: at("2026-11-01T00:00:00Z") })).failure?.code).toBe("academic.registration_window_closed");
    expect(evaluateEligibility(facts({ now: at("2030-01-01T00:00:00Z") }, { registrationOpensAt: null, registrationClosesAt: null })).eligible).toBe(true);
  });
  it("4. doublon vivant (même nœud, même année, toute classe)", () => {
    expect(evaluateEligibility(facts({ hasLiveDuplicate: true })).failure?.code).toBe("academic.duplicate_enrollment");
  });
  it("5. capacité : hors les lignes de l'apprenant — D1, la dernière place n'est plus refusée à son détenteur", () => {
    expect(evaluateEligibility(facts({ heldByOthers: 10 })).failure?.code).toBe("academic.offering_full");
    expect(evaluateEligibility(facts({ heldByOthers: 9 })).eligible).toBe(true); // reste exactement une place
    expect(evaluateEligibility(facts({ heldByOthers: 999 }, { capacity: null })).eligible).toBe(true); // illimité
    // L'offre est FULL (dérivé) parce que SON PROPRE siège a pris la dernière place : il reste éligible.
    expect(evaluateEligibility(facts({ heldByOthers: 9 }, { status: "FULL" })).eligible).toBe(true);
    // ... mais FULL avec toutes les places aux autres reste refusée, pour la capacité.
    expect(evaluateEligibility(facts({ heldByOthers: 10 }, { status: "FULL" })).failure?.code).toBe("academic.offering_full");
  });
  it("6. prérequis non validés, avec la liste des manquants", () => {
    const r = evaluateEligibility(facts({ missingPrerequisites: ["l1", "l2"] }));
    expect(r.failure?.code).toBe("academic.prerequisites_unmet");
    expect(r.missingPrerequisites).toEqual(["l1", "l2"]);
  });
  it("l'ordre est strict : plusieurs échecs, le premier de la liste l'emporte", () => {
    const all = facts({ periodState: "CLOSED", hasLiveDuplicate: true, heldByOthers: 10, missingPrerequisites: ["x"] }, { status: "DRAFT" });
    expect(evaluateEligibility(all).failure?.code).toBe("academic.offering_not_open");
    expect(evaluateEligibility({ ...all, offering: { ...all.offering, status: "OPEN" } }).failure?.code).toBe("academic.period_closed");
    expect(evaluateEligibility({ ...all, offering: { ...all.offering, status: "OPEN" }, periodState: "OPEN" }).failure?.code).toBe("academic.duplicate_enrollment");
    expect(evaluateEligibility({ ...all, offering: { ...all.offering, status: "OPEN" }, periodState: "OPEN", hasLiveDuplicate: false }).failure?.code).toBe("academic.offering_full");
    expect(evaluateEligibility({ ...all, offering: { ...all.offering, status: "OPEN" }, periodState: "OPEN", hasLiveDuplicate: false, heldByOthers: 0 }).failure?.code).toBe("academic.prerequisites_unmet");
  });
  it("déjà validée : avertissement non bloquant qui exige une dérogation (AC5.7)", () => {
    const r = evaluateEligibility(facts({ alreadyCompleted: true }));
    expect(r.eligible).toBe(true);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "academic.already_completed", requiresOverride: true })]);
  });
});

describe("dérogation motivée (AC5.1b)", () => {
  const override = { reason: "Accord du directeur des études" };
  it("lève la fenêtre, la période close et les prérequis, jamais la capacité ni le doublon", () => {
    const window = applyOverride(facts({ now: new Date("2026-12-01T00:00:00Z") }), override);
    expect(window).toMatchObject({ allowed: true, bypassed: ["academic.registration_window_closed"] });
    const pre = applyOverride(facts({ missingPrerequisites: ["x"] }), override);
    expect(pre).toMatchObject({ allowed: true, bypassed: ["academic.prerequisites_unmet"] });
    const several = applyOverride(facts({ periodState: "CLOSED", now: new Date("2026-12-01T00:00:00Z"), missingPrerequisites: ["x"] }), override);
    expect(several).toMatchObject({ allowed: true });
    expect(several.bypassed).toEqual(["academic.period_closed", "academic.registration_window_closed", "academic.prerequisites_unmet"]);
    expect(applyOverride(facts({ heldByOthers: 10 }), override).allowed).toBe(false);
    expect(applyOverride(facts({ hasLiveDuplicate: true }), override).allowed).toBe(false);
    expect(applyOverride(facts({}, { status: "CANCELLED" }), override).allowed).toBe(false);
    // la capacité reste bloquante même quand un autre obstacle dérogeable précède
    expect(applyOverride(facts({ heldByOthers: 10, missingPrerequisites: ["x"] }), override).result.failure?.code).toBe("academic.offering_full");
  });
  it("sans dérogation, aucun obstacle n'est levé ; une unité déjà validée en exige une", () => {
    expect(applyOverride(facts({ missingPrerequisites: ["x"] }), undefined).allowed).toBe(false);
    expect(applyOverride(facts(), undefined)).toMatchObject({ allowed: true, bypassed: [] });
    expect(applyOverride(facts({ alreadyCompleted: true }), undefined).allowed).toBe(false);
    expect(applyOverride(facts({ alreadyCompleted: true }), override)).toMatchObject({ allowed: true, bypassed: ["academic.already_completed"] });
  });
});
