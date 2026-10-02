"use client";

/**
 * Mise en forme et saisie des MESURES des alertes et des comparaisons. Ce module ne CALCULE aucun indicateur : il présente la
 * valeur lue par l'API selon son unité (points de base -> pourcentage, unités mineures -> montant, nombre) et convertit la saisie
 * d'un seuil dans l'unité de l'API par lecture de chaîne (jamais de flottant sur un montant ou un taux).
 */
import { parseAmountInput, parsePercentToBps, useMoney } from "@/platform/ui/money";
import { useDateFormat } from "@/platform/ui/format";

export type MeasureUnit = "BPS" | "AMOUNT" | "COUNT" | "DECIMAL";

export function useMeasure() {
  const money = useMoney();
  const date = useDateFormat();
  return (unit: MeasureUnit, value: number | null | undefined, currency?: string | null): string => {
    if (value === null || value === undefined) return "—";
    switch (unit) {
      case "BPS":
        return money.bps(value);
      case "AMOUNT":
        return money.fmt(value, currency ?? "XOF");
      case "COUNT":
        return date.number(value);
      case "DECIMAL":
        return date.number(value);
    }
  };
}

/** Points de base -> saisie en pourcentage (« 85 », « 87,5 »). */
export function bpsToInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const cents = bps % 100;
  return cents === 0 ? String(whole) : `${whole},${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

/** Valeur de l'API -> texte de saisie dans l'unité de l'indicateur. */
export const thresholdToInput = (unit: "BPS" | "AMOUNT" | "COUNT", value: number | null): string => (value === null ? "" : unit === "BPS" ? bpsToInput(value) : String(value));

export type ThresholdParse = { ok: true; value: number | null } | { ok: false; reason: "invalid" | "range" };

/** Saisie d'un seuil -> valeur de l'API. Vide : pas de seuil. « 0 » est un seuil valide (jamais confondu avec « vide »). */
export function parseThreshold(unit: "BPS" | "AMOUNT" | "COUNT", text: string): ThresholdParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (unit === "BPS") {
    if (/^0+([.,]0+)?\s*%?$/.test(trimmed)) return { ok: true, value: 0 };
    const r = parsePercentToBps(trimmed);
    return r.ok ? { ok: true, value: r.bps } : { ok: false, reason: r.reason === "range" ? "range" : "invalid" };
  }
  const r = parseAmountInput(trimmed, { allowZero: true });
  return r.ok ? { ok: true, value: r.amount } : { ok: false, reason: "invalid" };
}
