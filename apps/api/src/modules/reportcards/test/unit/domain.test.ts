import { describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { buildSnapshot, blockingSignatoryProblems, resolveSignatories } from "../../domain/snapshot";
import { canPublish, canReissue, canRevoke, canWithdraw, downloadFileName, familyMayRead, isVisibleToFamilies, needsReissue } from "../../domain/lifecycle";
import { fmtCount, formatMinutes, groupLines, rankText } from "../../domain/render-context";
import { previewBundle } from "../../domain/preview-data";
import type { ReportCardRecord, Signatory } from "../../domain/types";
import { FIXED_ISSUED_AT, makeBranding, snapshotFor } from "../support/fixtures";

const signatory = (over: Partial<Signatory> = {}): Signatory => ({
  id: newId(), institutionId: null, fullName: "Personne Fictive", title: null, jobFunction: null, signatureObjectKey: null, staffId: null, active: true,
  validFrom: null, validTo: null, createdAt: FIXED_ISSUED_AT, updatedAt: FIXED_ISSUED_AT, ...over,
});
const SLOTS = [
  { slot: "director", label: "Le Directeur", required: true },
  { slot: "head", label: "Le Responsable", required: false },
];

describe("signataires d'un gabarit (AC5.5 : aucun défaut, aucun nom inventé)", () => {
  it("emplacement obligatoire sans affectation : problème bloquant ; facultatif : omis sans bloquer", () => {
    const r = resolveSignatories({ slots: SLOTS, assignments: [], signatories: [signatory()], onDate: "2026-02-03" });
    expect(r.resolved).toEqual([]);
    expect(r.problems.map((p) => [p.slot, p.code, p.required])).toEqual([["director", "unassigned", true], ["head", "unassigned", false]]);
    expect(blockingSignatoryProblems(r.problems).map((p) => p.slot)).toEqual(["director"]);
  });

  it("signataire inconnu, désactivé, pas encore en fonction, mandat échu : refusés ; valide : résolu avec nom, qualité, fonction, signature", () => {
    const sigs = [
      signatory({ id: "00000000-0000-4000-8000-0000000000a1", active: false }),
      signatory({ id: "00000000-0000-4000-8000-0000000000a2", validFrom: "2026-03-01" }),
      signatory({ id: "00000000-0000-4000-8000-0000000000a3", validTo: "2026-01-31" }),
      signatory({ id: "00000000-0000-4000-8000-0000000000a4", fullName: "Valide", title: "Directeur", jobFunction: "Direction", signatureObjectKey: "k/s.png", validFrom: "2026-01-01", validTo: "2026-12-31" }),
    ];
    const slots = [1, 2, 3, 4].map((n) => ({ slot: `s${n}`, label: `Slot ${n}`, required: true }));
    const r = resolveSignatories({
      slots: [...slots, { slot: "s5", label: "Slot 5", required: true }],
      assignments: [...sigs.map((s, i) => ({ slot: `s${i + 1}`, signatoryId: s.id })), { slot: "s5", signatoryId: newId() }],
      signatories: sigs,
      onDate: "2026-02-03",
    });
    expect(r.problems.map((p) => [p.slot, p.code])).toEqual([["s1", "inactive"], ["s2", "not_yet_valid"], ["s3", "expired"], ["s5", "unknown"]]);
    expect(r.resolved).toEqual([{ slot: "s4", slotLabel: "Slot 4", name: "Valide", title: "Directeur", jobFunction: "Direction", signatureKey: "k/s.png" }]);
  });
});

describe("construction du snapshot (pur)", () => {
  it("snapshot valide : titre, colonnes cohérentes, hash stable ; mêmes entrées = même hash", () => {
    const a = snapshotFor("secondary-bulletin");
    expect(a.title).toBe("Bulletin de notes — Semestre 1 — 2025-2026");
    expect(a.snapshot.meta).toMatchObject({ schema: "reportcard/1", kind: "REPORT_CARD", scope: "PERIOD", version: 1, provisional: false, issuedAt: FIXED_ISSUED_AT.toISOString(), locale: "fr" });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const again = buildSnapshot({ ...a.input });
    expect(again.ok && again.hash).toBe(a.hash);
    const later = buildSnapshot({ ...a.input, issuedAt: new Date(FIXED_ISSUED_AT.getTime() + 1) });
    expect(later.ok && later.hash).not.toBe(a.hash);
  });

  it("titres : provisoire, annuel, relevé", () => {
    expect(snapshotFor("secondary-bulletin", { provisional: true }).title).toMatch(/\(provisoire\)$/);
    expect(snapshotFor("transcript-credits").title).toBe("Relevé de notes cumulé");
  });

  it("refuse un snapshot invalide (flottant, couleur hors format, date fausse) avec la liste des problèmes — jamais de document partiel", () => {
    const base = snapshotFor("secondary-bulletin").input;
    const bad = (patch: Record<string, unknown>) => buildSnapshot({ ...base, bundle: { ...base.bundle, ...patch } as never });
    const floats = bad({ lines: [{ ...base.bundle.lines[0]!, exact: "14,5" }] });
    expect(floats.ok).toBe(false);
    const date = bad({ student: { ...base.bundle.student, birthDate: "2010-02-30" } });
    expect(date.ok).toBe(false);
    const color = buildSnapshot({ ...base, branding: makeBranding({ primaryColor: "rouge" }) });
    expect(color.ok).toBe(false);
    const explain = bad({ explain: [{ lineCode: "A", rules: [{ key: "k", position: 0, inputs: { x: 1.5 }, output: "1" }] }] });
    expect(explain.ok).toBe(false);
    if (!explain.ok) expect(explain.issues.some((i) => i.path.startsWith("explain"))).toBe(true);
  });

  it("aucune clé inattendue acceptée dans le snapshot (schéma strict) : une donnée en trop ne passe pas en douce", () => {
    const base = snapshotFor("secondary-bulletin").input;
    const r = buildSnapshot({ ...base, bundle: { ...base.bundle, student: { ...base.bundle.student, motDePasse: "x" } as never } });
    expect(r.ok).toBe(false);
  });
});

describe("règles du cycle de vie (miroir des déclencheurs SQL)", () => {
  const card = (over: Partial<Pick<ReportCardRecord, "status" | "provisional" | "withdrawnAt">> = {}) => ({ status: "ISSUED" as const, provisional: false, withdrawnAt: null, ...over });
  it("publication / retrait / révocation / réémission", () => {
    expect(canPublish(card())).toEqual({ ok: true });
    expect(canPublish(card({ provisional: true }))).toMatchObject({ ok: false, code: "provisional" });
    expect(canPublish(card({ status: "PUBLISHED" }))).toMatchObject({ ok: false, code: "already" });
    expect(canPublish(card({ status: "PUBLISHED", withdrawnAt: new Date() }))).toEqual({ ok: true });
    expect(canPublish(card({ status: "REVOKED" }))).toMatchObject({ ok: false, code: "invalid_state" });
    expect(canPublish(card({ status: "SUPERSEDED" }))).toMatchObject({ ok: false });
    expect(canWithdraw(card({ status: "PUBLISHED" }))).toEqual({ ok: true });
    expect(canWithdraw(card({ status: "ISSUED" }))).toMatchObject({ ok: false });
    expect(canRevoke(card({ status: "PUBLISHED" }))).toEqual({ ok: true });
    expect(canRevoke(card({ status: "REVOKED" }))).toMatchObject({ ok: false, code: "already" });
    expect(canRevoke(card({ status: "SUPERSEDED" }))).toMatchObject({ ok: false });
    expect(canReissue(card({ status: "PUBLISHED" }))).toEqual({ ok: true });
    expect(canReissue(card({ status: "SUPERSEDED" }))).toMatchObject({ ok: false });
    expect(canReissue(card({ provisional: true }))).toMatchObject({ ok: false, code: "provisional" });
  });

  it("visibilité famille : publié, non retiré, non provisoire ; élève concerné seulement", () => {
    expect(isVisibleToFamilies(card({ status: "PUBLISHED" }))).toBe(true);
    for (const hidden of [card(), card({ status: "SUPERSEDED" }), card({ status: "REVOKED" }), card({ status: "PUBLISHED", withdrawnAt: new Date() }), card({ status: "PUBLISHED", provisional: true })]) {
      expect(isVisibleToFamilies(hidden)).toBe(false);
    }
    const sid = newId();
    expect(familyMayRead({ ...card({ status: "PUBLISHED" }), studentId: sid }, { kind: "GUARDIAN", studentId: sid })).toBe(true);
    expect(familyMayRead({ ...card({ status: "PUBLISHED" }), studentId: sid }, { kind: "GUARDIAN", studentId: newId() })).toBe(false);
  });

  it("« à rééditer » : seulement un document vivant dont les résultats ont changé", () => {
    const live = { status: "ISSUED" as const, provisional: false, resultsVersion: 1 };
    expect(needsReissue(live, 2)).toBe(true);
    expect(needsReissue(live, 1)).toBe(false);
    expect(needsReissue(live, null)).toBe(false);
    expect(needsReissue({ ...live, status: "SUPERSEDED" }, 2)).toBe(false);
    expect(needsReissue({ ...live, provisional: true }, 2)).toBe(false);
  });

  it("nom de fichier de téléchargement : ASCII sûr, sans accent ni séparateur de chemin", () => {
    expect(downloadFileName({ documentKind: "REPORT_CARD", version: 2, studentName: "ÉLÈVE Zoé/../O'Brien" })).toBe("bulletin-ELEVE-Zoe-O-Brien-v2.pdf");
    expect(downloadFileName({ documentKind: "TRANSCRIPT", version: 1, studentName: "" })).toBe("releve-eleve-v1.pdf");
  });
});

describe("mise en forme du contexte de rendu (aucun calcul métier)", () => {
  it("nombres, rangs, durées", () => {
    expect(fmtCount("2.00")).toBe("2");
    expect(fmtCount("2.50")).toBe("2,5");
    expect(fmtCount(null)).toBe("");
    expect(rankText(1, 30)).toBe("1er / 30");
    expect(rankText(3, 30)).toBe("3e / 30");
    expect(rankText(null, 30)).toBe("--");
    expect(rankText(2, null)).toBe("2e");
    expect(formatMinutes(0)).toBe("0 h");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(150)).toBe("2 h 30");
    expect(formatMinutes(120)).toBe("2 h");
  });

  it("regroupement : UE et leurs éléments, lignes orphelines en tête, catégories sans UE", () => {
    const higher = previewBundle("HIGHER", "REPORT_CARD");
    const groups = groupLines(higher.lines, higher.labels);
    expect(groups.map((g) => [g.code, g.rows.length])).toEqual([["UE1", 2], ["UE2", 1]]);
    expect(groups[0]!.header?.credits).toBe("6");
    const secondary = previewBundle("SECONDARY", "REPORT_CARD");
    const flat = groupLines(secondary.lines, secondary.labels);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.rows).toHaveLength(4);
    const withCategory = groupLines(secondary.lines.map((l, i) => ({ ...l, category: i < 2 ? "SCIENCES" : "LETTRES" })), { SCIENCES: "Sciences", LETTRES: "Lettres" });
    expect(withCategory.map((g) => [g.label, g.rows.length])).toEqual([["Sciences", 2], ["Lettres", 2]]);
  });

  it("données d'aperçu fictives : aucun nom ni établissement réel", () => {
    for (const pack of ["PRIMARY", "SECONDARY", "HIGHER"] as const) {
      const b = previewBundle(pack, "REPORT_CARD");
      expect(JSON.stringify(b)).toMatch(/EXEMPLE/);
      expect(b.student.matricule).toBe("MAT-0000");
    }
  });
});
