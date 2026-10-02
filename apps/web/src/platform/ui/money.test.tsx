// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { IntlProvider } from "@/platform/i18n/IntlProvider";
import { parseAmountInput, parsePercentToBps, useMoney } from "./money";

const wrapper = ({ children }: { children: ReactNode }) => <IntlProvider>{children}</IntlProvider>;
const norm = (s: string) => s.replace(/[   ]/g, " ");

describe("useMoney (formatage fr-CI, montants entiers)", () => {
  it("formate le franc CFA sans décimales, avec séparateur de milliers", () => {
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(norm(result.current.fmt(1234567))).toBe("1 234 567 F CFA");
    expect(norm(result.current.fmt(0))).toBe("0 F CFA");
    expect(norm(result.current.fmt(-500))).toBe("-500 F CFA");
    expect(norm(result.current.of({ amount: 150000, currency: "XOF" }))).toBe("150 000 F CFA");
  });

  it("n'invente jamais de décimales pour un montant entier et ne plante pas sur une valeur absente", () => {
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(result.current.fmt(5)).not.toMatch(/[.,]\d/);
    expect(result.current.fmt(null)).toBe("—");
    expect(result.current.of(null)).toBe("—");
  });

  it("points de base, majoration et durées (affichage seulement)", () => {
    const { result } = renderHook(() => useMoney(), { wrapper });
    expect(norm(result.current.bps(8750))).toBe("87,50 %");
    expect(norm(result.current.bps(10000))).toBe("100,00 %");
    expect(result.current.bps(null)).toBe("—");
    expect(result.current.permille(1500)).toBe("×1,5");
    expect(result.current.permille(1000)).toBe("×1");
    expect(result.current.minutes(150)).toBe("2 h 30");
    expect(result.current.minutes(120)).toBe("2 h");
    expect(result.current.minutes(65)).toBe("1 h 05");
  });
});

describe("parseAmountInput", () => {
  it("accepte un entier avec ou sans espaces (y compris insécables)", () => {
    expect(parseAmountInput("150000")).toEqual({ ok: true, amount: 150000 });
    expect(parseAmountInput("150 000")).toEqual({ ok: true, amount: 150000 });
    expect(parseAmountInput("1 234 567")).toEqual({ ok: true, amount: 1234567 });
  });

  it("refuse les décimales et séparateurs ambigus plutôt que de les deviner", () => {
    expect(parseAmountInput("1.500")).toEqual({ ok: false, reason: "decimal" });
    expect(parseAmountInput("1,5")).toEqual({ ok: false, reason: "decimal" });
    expect(parseAmountInput("1 500,00")).toEqual({ ok: false, reason: "decimal" });
  });

  it("refuse vide, négatif, texte, zéro (sauf demande) et valeurs hors plage sûre", () => {
    expect(parseAmountInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseAmountInput("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseAmountInput("-100")).toEqual({ ok: false, reason: "negative" });
    expect(parseAmountInput("12abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseAmountInput("0")).toEqual({ ok: false, reason: "invalid" });
    expect(parseAmountInput("0", { allowZero: true })).toEqual({ ok: true, amount: 0 });
    expect(parseAmountInput("1".repeat(16))).toEqual({ ok: false, reason: "tooLarge" });
    expect(parseAmountInput("9007199254740993")).toEqual({ ok: false, reason: "tooLarge" });
  });
});

describe("parsePercentToBps (lecture de chaîne, sans flottant)", () => {
  it("convertit en points de base entiers", () => {
    expect(parsePercentToBps("10")).toEqual({ ok: true, bps: 1000 });
    expect(parsePercentToBps("12,5")).toEqual({ ok: true, bps: 1250 });
    expect(parsePercentToBps("12.25 %")).toEqual({ ok: true, bps: 1225 });
    expect(parsePercentToBps("0,01")).toEqual({ ok: true, bps: 1 });
    expect(parsePercentToBps("100")).toEqual({ ok: true, bps: 10000 });
    // 0,07 * 100 vaut 7.000000000000001 en flottant : la lecture de chaîne évite l'écart.
    expect(parsePercentToBps("0,07")).toEqual({ ok: true, bps: 7 });
    expect(parsePercentToBps("1,15")).toEqual({ ok: true, bps: 115 });
  });

  it("refuse hors plage, trop de décimales et texte", () => {
    expect(parsePercentToBps("")).toEqual({ ok: false, reason: "empty" });
    expect(parsePercentToBps("0")).toEqual({ ok: false, reason: "range" });
    expect(parsePercentToBps("100,01")).toEqual({ ok: false, reason: "range" });
    expect(parsePercentToBps("12,345")).toEqual({ ok: false, reason: "invalid" });
    expect(parsePercentToBps("dix")).toEqual({ ok: false, reason: "invalid" });
  });
});
