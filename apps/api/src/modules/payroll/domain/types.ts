/**
 * Types du domaine de la paie (spec 032). Aucun import d'infrastructure : ce dossier est PUR.
 *
 * Conventions (ADR-007) : montants = `Money` du kernel (entiers, XOF), durées = MINUTES entières, dates
 * calendaires = chaînes `AAAA-MM-JJ` (aucun fuseau), heures murales `HH:MM`. Aucun flottant monétaire.
 */
import type { Money } from "@ecoledigitale/kernel";

export type IsoDate = string;
export type Uuid = string;

/** Origine d'une heure : séance réalisée (scheduling, 017) ou présence enseignant (attendance, 010). */
export const HOUR_SOURCE_KINDS = ["SESSION", "ATTENDANCE"] as const;
export type HourSourceKind = (typeof HOUR_SOURCE_KINDS)[number];

export const CONFIG_TYPES = ["SALARY", "HOURLY", "MIXED"] as const;
export type ConfigType = (typeof CONFIG_TYPES)[number];

export const PAYSLIP_STATUSES = ["CALCULATED", "APPROVED", "PAID", "DISPUTED", "CANCELLED"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const RATE_ORIGINS = ["NODE_STAFF", "NODE_GENERIC", "CONFIG_DEFAULT", "SALARY_ZERO"] as const;
export type RateOrigin = (typeof RATE_ORIGINS)[number];

export const PERIOD_STATUSES = ["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK_TRANSFER", "CHEQUE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ADJUSTMENT_KINDS = ["BONUS", "DEDUCTION"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/**
 * Motifs pour lesquels un enseignant est écarté d'un calcul (jamais absent en silence, AC2.4).
 * `NOTHING_TO_PAY` : tout ce qui était payable l'est déjà (salaire d'une période qui en recouvre une autre,
 * heures déjà réclamées) — correction du défaut « périodes chevauchantes payant deux fois ».
 */
export const SKIP_REASONS = ["NO_CONFIG", "NO_HOURS", "NO_RATE_RESOLVED", "PAYSLIP_LOCKED", "OUT_OF_SCOPE", "STALE_SOURCE", "NOTHING_TO_PAY"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * Fait d'heure remis par un port (017 / 010), BRUT : la paie applique elle-même le prédicat de payabilité
 * (`payability.ts`, défini en UN seul endroit).
 */
export interface HourFact {
  readonly kind: HourSourceKind;
  /** Identifiant STABLE de la séance (SESSION) ou de la présence (ATTENDANCE). */
  readonly refId: Uuid;
  /** Enseignant réellement intervenu ; `null` = jamais payable. */
  readonly staffId: Uuid | null;
  readonly date: IsoDate;
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** Durée explicite en minutes (présence enseignant) ; `null` si seule la plage horaire fait foi. */
  readonly durationMinutes: number | null;
  /** Dérogation de durée payée (jamais une modification des horaires, AC1.5). */
  readonly paidMinutesOverride: number | null;
  /** SESSION : statut HELD ; ATTENDANCE : présence COMPLETED. */
  readonly realized: boolean;
  /** SESSION : validée par la gestion ; ATTENDANCE : présence enregistrée et arrêtée. */
  readonly validated: boolean;
  readonly nodeId: Uuid | null;
  readonly classroomId: Uuid | null;
  readonly label: string | null;
  readonly code: string | null;
  readonly classroomLabel: string | null;
}

/** Heure payable, durée retenue, prête à être tarifée. */
export interface PayableHour {
  readonly kind: HourSourceKind;
  readonly refId: Uuid;
  readonly staffId: Uuid;
  readonly date: IsoDate;
  readonly startTime: string | null;
  readonly minutes: number;
  readonly nodeId: Uuid | null;
  readonly classroomId: Uuid | null;
  readonly label: string | null;
  readonly code: string | null;
  readonly classroomLabel: string | null;
}

export interface PricedHour extends PayableHour {
  /** Tarif de base (XOF / heure) FIGÉ dans la ligne. */
  readonly rate: Money;
  readonly rateOrigin: RateOrigin;
}

/** Configuration de paie datée d'un enseignant (extrait utile au calcul). */
export interface PayConfig {
  readonly id: Uuid;
  readonly staffId: Uuid;
  readonly type: ConfigType;
  readonly monthlySalary: Money | null;
  readonly annualSalary: Money | null;
  /** `0` est une valeur valide (≠ `null`, défaut du legacy corrigé). */
  readonly defaultHourlyRate: Money | null;
  readonly overtimeThresholdMinutes: number;
  /** 1000 = ×1,0 ; 1500 = ×1,5. */
  readonly overtimeMultiplierPermille: number;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
}

export interface Period {
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}

export interface PayslipLineDraft {
  readonly position: number;
  readonly sourceKind: HourSourceKind;
  readonly sourceRefId: Uuid;
  readonly staffId: Uuid;
  readonly sessionDate: IsoDate;
  readonly startTime: string | null;
  readonly minutes: number;
  readonly rate: Money;
  readonly multiplierPermille: number;
  readonly amount: Money;
  readonly isOvertime: boolean;
  readonly rateOrigin: RateOrigin;
  readonly nodeId: Uuid | null;
  readonly classroomId: Uuid | null;
  readonly label: string | null;
  readonly code: string | null;
  readonly classroomLabel: string | null;
}
