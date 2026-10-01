/**
 * Snapshot IMMUABLE d'un bulletin (spec 032 AC8.3) : le document figé à l'arrêt du montant (CALCULATED →
 * APPROVED). Le rendu PDF (013 / worker) et l'API `/data` le LISENT ; ils ne recalculent rien. Une
 * modification ultérieure d'un tarif, d'une configuration ou du compte de l'enseignant ne le change pas
 * (AC2.7, AC8.4). Son empreinte SHA-256 (`snapshot_hash`) est calculée sur la forme canonique ci-dessous.
 */
import type { CalcDetails } from "./calculation";
import type { AdjustmentKind, ConfigType, HourSourceKind, IsoDate, PaymentMethod, RateOrigin } from "./types";

export interface SnapshotLine {
  readonly position: number;
  readonly source: HourSourceKind;
  readonly sourceRefId: string;
  readonly date: IsoDate;
  readonly startTime: string | null;
  readonly minutes: number;
  readonly rate: number;
  readonly multiplierPermille: number;
  readonly amount: number;
  readonly isOvertime: boolean;
  readonly rateOrigin: RateOrigin;
  readonly label: string | null;
  readonly code: string | null;
  readonly classroomLabel: string | null;
}

export interface SnapshotAdjustment {
  readonly id: string;
  readonly kind: AdjustmentKind;
  readonly amount: number;
  readonly label: string;
  readonly reason: string | null;
  readonly createdByName: string;
  readonly createdAt: string;
}

export interface PayslipSnapshot {
  readonly v: 1;
  readonly payslipId: string;
  readonly staff: { readonly id: string; readonly displayName: string; readonly matricule: string | null };
  readonly period: { readonly id: string; readonly name: string; readonly startDate: IsoDate; readonly endDate: IsoDate };
  /** Configuration EN VIGUEUR sur la période, figée au calcul. */
  readonly config: {
    readonly id: string;
    readonly type: ConfigType;
    readonly monthlySalary: number | null;
    readonly annualSalary: number | null;
    readonly defaultHourlyRate: number | null;
    readonly overtimeThresholdMinutes: number;
    readonly overtimeMultiplierPermille: number;
    readonly effectiveFrom: IsoDate;
    readonly effectiveTo: IsoDate | null;
  };
  readonly currency: string;
  readonly amounts: {
    readonly salary: number;
    readonly regularHours: number;
    readonly overtime: number;
    readonly bonus: number;
    readonly deduction: number;
    readonly total: number;
  };
  readonly minutes: { readonly regular: number; readonly overtime: number };
  readonly details: CalcDetails;
  readonly lines: readonly SnapshotLine[];
  readonly adjustments: readonly SnapshotAdjustment[];
  readonly calculatedAt: string;
  readonly calculatedByName: string;
  readonly approvedAt: string;
  readonly approvedByName: string;
  /** Renseigné seulement dans la vue « données » après versement : le snapshot lui-même reste celui de l'arrêt. */
  readonly payment?: { readonly paidAt: string; readonly paidByName: string; readonly method: PaymentMethod; readonly reference: string | null };
}

/** JSON canonique : clés triées récursivement, sans espace — base de l'empreinte (stable d'une exécution à l'autre). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}
