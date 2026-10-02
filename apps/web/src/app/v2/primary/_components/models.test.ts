import { describe, expect, it } from "vitest";
import { PRIMARY_REPORT_KEYS } from "@ecoledigitale/contracts/v2/primary_school";
import { attendancePayload, buildDecision, canConfirmRuleProposal, COUNCIL_JUSTIFICATION_MIN, DECIDABLE_CODES, quorumView, rowsFromAttendance, signaturesWithoutPresence } from "./council-model";
import { lightOf } from "./direction-model";
import { csvFileName, DIRECTION_ONLY_REPORTS, missingParams, REPORT_PARAMS, visibleReports } from "./reports-model";

describe("conseil : décision", () => {
  it("confirmer la proposition de la règle n'envoie aucun code", () => {
    expect(buildDecision({ mode: "confirm", ruleProposalCode: "PROMOTED", finalCode: "", justification: "" })).toEqual({ ok: true, body: {} });
  });

  it("la règle ne tranche pas (COUNCIL_REVIEW, PENDING, aucune) : rien à confirmer", () => {
    for (const code of ["COUNCIL_REVIEW", "PENDING", null]) {
      expect(canConfirmRuleProposal(code)).toBe(false);
      expect(buildDecision({ mode: "confirm", ruleProposalCode: code, finalCode: "", justification: "" })).toEqual({ ok: false, problem: "cannot_confirm" });
    }
  });

  it("un autre code exige une justification d'au moins 20 caractères", () => {
    const short = "trop court";
    expect(short.length).toBeLessThan(COUNCIL_JUSTIFICATION_MIN);
    expect(buildDecision({ mode: "other", ruleProposalCode: "PROMOTED", finalCode: "REPEAT", justification: short })).toEqual({ ok: false, problem: "justification_short" });
    const ok = buildDecision({ mode: "other", ruleProposalCode: "PROMOTED", finalCode: "REPEAT", justification: "  Décision motivée par le conseil de classe.  " });
    expect(ok).toEqual({ ok: true, body: { finalCode: "REPEAT", justification: "Décision motivée par le conseil de classe." } });
  });

  it("le code choisi doit être renseigné ; retenir le code de la règle ne demande pas de justification", () => {
    expect(buildDecision({ mode: "other", ruleProposalCode: "PROMOTED", finalCode: "", justification: "" })).toEqual({ ok: false, problem: "code_required" });
    expect(buildDecision({ mode: "other", ruleProposalCode: "PROMOTED", finalCode: "PROMOTED", justification: "" })).toEqual({ ok: true, body: { finalCode: "PROMOTED" } });
  });

  it("les codes retenables sont des propositions qui tranchent", () => {
    expect([...DECIDABLE_CODES].sort()).toEqual(["PROMOTED", "REPEAT"]);
  });
});

describe("conseil : quorum affiché tel que renvoyé", () => {
  it("met = null ou source none : aucun quorum bloquant", () => {
    expect(quorumView({ convened: 5, present: 3, met: null, source: "none" })).toBe("none");
    expect(quorumView({ convened: 5, present: 3, met: null, source: "rule" })).toBe("none");
  });
  it("règle liée : atteint ou non", () => {
    expect(quorumView({ convened: 5, present: 4, met: true, source: "rule" })).toBe("met");
    expect(quorumView({ convened: 5, present: 1, met: false, source: "rule" })).toBe("unmet");
  });
});

describe("conseil : feuille de présence", () => {
  const rows = rowsFromAttendance([
    { staffId: "s1", staffName: "A", roleCode: "CHAIR", convened: true, present: true, signedAt: "2026-10-01T08:00:00.000Z", note: null },
    { staffId: "s2", staffName: "B", roleCode: "SECRETARY", convened: true, present: null, signedAt: null, note: "retard" },
    { staffId: "s3", staffName: "C", roleCode: "TEACHER", convened: false, present: false, signedAt: null, note: null },
  ]);

  it("une présence signée est figée : elle ne part pas, et ne se re-signe pas", () => {
    const payload = attendancePayload(rows.map((r) => (r.staffId === "s2" ? { ...r, present: true, sign: true } : r)));
    expect(payload.participants.map((p) => p.staffId)).toEqual(["s2", "s3"]);
    expect(payload.participants[0]).toMatchObject({ roleCode: "SECRETARY", present: true, note: "retard" });
    expect(payload.signedStaffIds).toEqual(["s2"]);
  });

  it("une signature cochée sans présence confirmée est signalée", () => {
    expect(signaturesWithoutPresence(rows.map((r) => (r.staffId === "s2" ? { ...r, sign: true } : r)))).toEqual(["s2"]);
    expect(attendancePayload(rows.map((r) => (r.staffId === "s2" ? { ...r, sign: true } : r))).signedStaffIds).toEqual([]);
  });
});

describe("avancement : feux d'affichage à partir des comptages bruts", () => {
  const p = (expected: number, recorded: number, validated: number, total = 0, sealed = 0) => ({ competencies: { expected, recorded, validated }, reviews: { total, sealed } });

  it("rouge : rien de saisi", () => {
    expect(lightOf(p(12, 0, 0))).toEqual({ light: "red", reason: "nothing_entered" });
  });
  it("vert : tout saisi et validé, bilans existants scellés", () => {
    expect(lightOf(p(12, 12, 12, 3, 3))).toEqual({ light: "green", reason: "complete" });
    expect(lightOf(p(12, 12, 12))).toEqual({ light: "green", reason: "complete" });
  });
  it("orange : le reste", () => {
    expect(lightOf(p(12, 6, 0)).light).toBe("orange");
    expect(lightOf(p(12, 12, 6)).light).toBe("orange");
    expect(lightOf(p(12, 12, 12, 3, 1)).light).toBe("orange");
  });
  it("aucune compétence attendue : sans objet (pas de feu inventé)", () => {
    expect(lightOf(p(0, 0, 0))).toEqual({ light: "none", reason: "no_expectation" });
  });
});

describe("états", () => {
  it("les rapports réservés à la direction sont masqués aux autres profils", () => {
    const limited = visibleReports(false);
    for (const k of DIRECTION_ONLY_REPORTS) expect(limited).not.toContain(k);
    expect(limited).toContain("class-list");
    expect(visibleReports(true)).toEqual([...PRIMARY_REPORT_KEYS]);
  });

  it("chaque rapport déclare ses paramètres ; les manquants sont listés", () => {
    for (const k of PRIMARY_REPORT_KEYS) expect(REPORT_PARAMS[k]).toBeDefined();
    expect(missingParams("attendance-register", { classroomId: "c" })).toEqual(["month"]);
    expect(missingParams("progress", {})).toEqual([]);
    expect(missingParams("council-pack", {})).toEqual(["deliberationId"]);
  });

  it("nom de fichier d'export (jamais une URL)", () => {
    expect(csvFileName("class-list")).toBe("class-list.csv");
  });
});
