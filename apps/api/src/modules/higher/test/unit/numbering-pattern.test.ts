import { describe, expect, it } from "vitest";
import {
  CONTINUOUS_COUNTER_YEAR,
  DEFAULT_NUMBERING_PATTERNS,
  counterYearFor,
  defaultNumberingPattern,
  formatAttestationReference,
  formatAuthenticityReference,
  formatDiplomaReference,
  formatWithPattern,
  parseNumberingPattern,
} from "../../domain/numbering";

const parsed = (source: string) => {
  const r = parseNumberingPattern(source);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

describe("Q-24 : motif de numérotation libre", () => {
  it("les motifs livrés reproduisent EXACTEMENT les formats historiques (aucune régression)", () => {
    for (const seq of [1, 42, 999, 1234567]) {
      expect(formatWithPattern(defaultNumberingPattern("DIPLOMA"), 2026, seq)).toBe(formatDiplomaReference(2026, seq));
      expect(formatWithPattern(defaultNumberingPattern("AUTHENTICITY"), 2026, seq)).toBe(formatAuthenticityReference(2026, seq));
      expect(formatWithPattern(defaultNumberingPattern("ATTESTATION"), 2027, seq)).toBe(formatAttestationReference(2027, seq));
    }
    expect(DEFAULT_NUMBERING_PATTERNS).toEqual({ DIPLOMA: "DIP-{YYYY}-{SEQ:6}", AUTHENTICITY: "AUTH/{YYYY}/{SEQ:3}", ATTESTATION: "ATT-{YYYY}-{SEQ:6}" });
  });

  it("préfixe, année sur 2 ou 4 chiffres, séquence zéro-complétée à largeur choisie", () => {
    expect(formatWithPattern(parsed("UNI/{YY}-D{SEQ:4}"), 2026, 7)).toBe("UNI/26-D0007");
    expect(formatWithPattern(parsed("{YYYY}.{SEQ}"), 2026, 7)).toBe("2026.7");
    expect(formatWithPattern(parsed("CERT#{SEQ:9}"), 2026, 12)).toBe("CERT#000000012");
    expect(formatWithPattern(parsed("{SEQ:3}-{YYYY}"), 2026, 1234)).toBe("1234-2026"); // jamais tronqué
  });

  it("un motif sans année est une séquence continue (compteur d'année 0) ; avec année, compteur annuel", () => {
    expect(counterYearFor(parsed("CERT{SEQ:5}"), 2026)).toBe(CONTINUOUS_COUNTER_YEAR);
    expect(counterYearFor(parsed("CERT-{YY}-{SEQ:5}"), 2026)).toBe(2026);
    expect(parsed("CERT{SEQ:5}").usesYear).toBe(false);
  });

  it.each([
    ["", /obligatoire/],
    ["DIP-{YYYY}", /un jalon de séquence/],
    ["{SEQ}{SEQ:3}", /un jalon de séquence/],
    ["{YYYY}-{YY}-{SEQ}", /un seul jalon d'année/],
    ["X-{FOO}-{SEQ}", /Jalon inconnu/],
    ["X-{SEQ:0}", /largeur/],
    ["X-{SEQ:10}", /largeur/],
    ["X-{YYYY:4}-{SEQ}", /paramètre/],
    ["DIP 2026 {SEQ}", /texte fixe/],
    ["DIP-é-{SEQ}", /texte fixe/],
    ["DIP-{-{SEQ}", /texte fixe/],
    ["A/D{SEQ}", /duplicata/],
    ["{YYYY}/D{SEQ:3}", /duplicata/],
    ["X".repeat(70) + "{SEQ}", /limité/],
  ])("motif invalide %j refusé", (source, message) => {
    const r = parseNumberingPattern(source);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });

  it("le numéro d'ordre doit être un entier >= 1", () => {
    expect(() => formatWithPattern(parsed("X{SEQ}"), 2026, 0)).toThrow(RangeError);
    expect(() => formatWithPattern(parsed("X{SEQ}"), 2026, 1.5)).toThrow(RangeError);
  });
});
