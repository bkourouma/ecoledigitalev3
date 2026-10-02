import { describe, expect, it } from "vitest";
import { addDays, daysBetween, dueAlert, effectiveAlertDays, expiryStatus, isValidCalendarDay } from "../../domain/expiry";
import { buildSearchText, checkOwnerCoherence, normalizeAlertDays, normalizeTags, quarantineStorageKey, versionStorageKey } from "../../domain/descriptors";
import { DEFAULT_CATEGORIES } from "../../domain/default-categories";
import { DOCUMENT_KINDS, DOCUMENT_SUPPORTED_EXTENSIONS, DOCUMENTS_EVENTS } from "@ecoledigitale/contracts/src/v2/documents";
import { DocumentsEvents } from "../../domain/events";

describe("expiration", () => {
  it("jours calendaires, échéance incluse", () => {
    expect(daysBetween("2026-10-02", "2026-10-12")).toBe(10);
    expect(daysBetween("2026-10-12", "2026-10-02")).toBe(-10);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(isValidCalendarDay("2026-02-31")).toBe(false);
    expect(isValidCalendarDay("2028-02-29")).toBe(true);
  });

  it("seuils effectifs : document > catégorie > établissement, décroissants et dédoublonnés", () => {
    expect(effectiveAlertDays([7, 30, 7], [60], [30, 7, 1])).toEqual([30, 7]);
    expect(effectiveAlertDays(null, [60, 15], [30, 7, 1])).toEqual([60, 15]);
    expect(effectiveAlertDays(null, null, [1, 7, 30])).toEqual([30, 7, 1]);
    expect(effectiveAlertDays([], [], [5])).toEqual([5]);
  });

  it("état : aucune échéance, valide, bientôt, échu (le jour même reste valable)", () => {
    const t = [30, 7, 1];
    expect(expiryStatus(null, "2026-10-02", t)).toEqual({ state: "NONE", daysToExpiry: null });
    expect(expiryStatus("2027-01-01", "2026-10-02", t).state).toBe("VALID");
    expect(expiryStatus("2026-10-20", "2026-10-02", t)).toEqual({ state: "EXPIRING", daysToExpiry: 18 });
    expect(expiryStatus("2026-10-02", "2026-10-02", t)).toEqual({ state: "EXPIRING", daysToExpiry: 0 });
    expect(expiryStatus("2026-10-01", "2026-10-02", t)).toEqual({ state: "EXPIRED", daysToExpiry: -1 });
  });

  it("alerte : une seule émission par passage, pour le plus petit seuil franchi ; un job arrêté ne rejoue pas l'historique", () => {
    const t = [30, 7, 1];
    expect(dueAlert(45, t, [])).toEqual({ emit: null, mark: [] });
    expect(dueAlert(30, t, [])).toEqual({ emit: 30, mark: [30] });
    expect(dueAlert(29, t, [30])).toEqual({ emit: null, mark: [] });
    expect(dueAlert(6, t, [30])).toEqual({ emit: 7, mark: [7] });
    // job arrêté 40 jours : à 5 jours de l'échéance, 30 et 7 sont franchis ; on n'émet que 7 et on marque les deux
    expect(dueAlert(5, t, [])).toEqual({ emit: 7, mark: [30, 7] });
    expect(dueAlert(0, t, [30, 7, 1])).toEqual({ emit: null, mark: [] });
    expect(dueAlert(-1, t, [])).toEqual({ emit: null, mark: [] });
  });
});

describe("descripteurs", () => {
  it("texte de recherche : titre, description, étiquettes, nom de fichier, valeurs de métadonnées", () => {
    const t = buildSearchText({ title: "CNI Awa", description: "recto verso", tags: ["identité", "2026"], fileName: "cni.pdf", metadata: { numero: "CI12345", valide: true } });
    expect(t).toContain("CNI Awa");
    expect(t).toContain("identité 2026");
    expect(t).toContain("CI12345");
    expect(t).not.toContain("true");
  });

  it("cohérence du propriétaire par type", () => {
    expect(checkOwnerCoherence("STUDENT", "NONE", null)).toMatchObject({ ok: false, code: "owner_required" });
    expect(checkOwnerCoherence("STUDENT", "STUDENT", "x")).toEqual({ ok: true });
    expect(checkOwnerCoherence("TEACHER", "STUDENT", "x")).toMatchObject({ ok: false });
    expect(checkOwnerCoherence("INSTITUTION", "NONE", "x")).toMatchObject({ ok: false, code: "owner_not_allowed" });
    expect(checkOwnerCoherence("FINANCIAL", "STAFF", null)).toMatchObject({ ok: false, code: "owner_required" });
    expect(checkOwnerCoherence("FINANCIAL", "NONE", null)).toEqual({ ok: true });
  });

  it("étiquettes et seuils normalisés ; clés de stockage sûres et propres à la version", () => {
    expect(normalizeTags([" Identité ", "identité", "", "2026"])).toEqual(["Identité", "2026"]);
    expect(normalizeAlertDays([1, 30, 7, 7])).toEqual([30, 7, 1]);
    expect(normalizeAlertDays([])).toBeNull();
    const key = versionStorageKey("t-1", "d-1", 3, "a".repeat(64));
    expect(key).toBe("documents/t-1/d-1/3-aaaaaaaaaaaa");
    expect(quarantineStorageKey("t-1", "q-1")).toBe("documents/t-1/quarantine/q-1");
  });

  it("catégories de départ : codes uniques, extensions connues, les cinq types présents", () => {
    const codes = DEFAULT_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.code).toMatch(/^[A-Z][A-Z0-9_]{1,39}$/);
      for (const e of c.allowedExtensions) expect(DOCUMENT_SUPPORTED_EXTENSIONS).toContain(e);
    }
    for (const kind of DOCUMENT_KINDS) expect(DEFAULT_CATEGORIES.some((c) => c.kind === kind)).toBe(true);
    // le dossier médical est confidentiel et jamais lisible par l'élève lui-même
    expect(DEFAULT_CATEGORIES.find((c) => c.code === "STUDENT_MEDICAL")).toMatchObject({ confidentiality: "CONFIDENTIAL", audienceOwner: false });
  });
});

describe("événements", () => {
  it("les noms du domaine sont ceux des contrats, sans doublon", () => {
    expect({ ...DocumentsEvents }).toEqual({ ...DOCUMENTS_EVENTS });
    expect(new Set(Object.values(DocumentsEvents)).size).toBe(Object.values(DocumentsEvents).length);
  });
});
