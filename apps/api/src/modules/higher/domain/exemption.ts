/**
 * Dispense d'UE manuelle (décision O-14). Pur : aucune E/S, aucune règle officielle.
 * Une dispense est une décision HUMAINE de la direction, motivée, tracée et révocable ; son impact sur les crédits est un
 * PARAMÈTRE de l'établissement (`exemption_credit_policy`), jamais une règle codée.
 */
import type { Uuid } from "./types";

export const EXEMPTION_CREDIT_POLICIES = ["RECORD_ONLY", "GRANT_CREDITS"] as const;
export type ExemptionCreditPolicy = (typeof EXEMPTION_CREDIT_POLICIES)[number];
/** Politique par défaut : la dispense est enregistrée sans effet sur les crédits ni la validation (jamais d'effet implicite). */
export const DEFAULT_EXEMPTION_CREDIT_POLICY: ExemptionCreditPolicy = "RECORD_ONLY";

export const EXEMPTION_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type ExemptionStatus = (typeof EXEMPTION_STATUSES)[number];

/** Longueur minimale du motif d'une dispense et de sa révocation. */
export const EXEMPTION_REASON_MIN = 10;

export interface UeExemption {
  readonly id: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  /** Crédits de l'UE figés à la dispense. */
  readonly credits: number;
  readonly reason: string;
  /** Politique APPLIQUÉE à la dispense (figée : changer le paramètre plus tard ne la réécrit pas). */
  readonly creditPolicy: ExemptionCreditPolicy;
  /** Écriture du registre de crédits (`acquired_via = 'EXEMPTION'`), si la politique accorde les crédits. */
  readonly ledgerId: Uuid | null;
  readonly status: ExemptionStatus;
  readonly grantedBy: Uuid;
  readonly grantedAt: Date;
  readonly revokedBy: Uuid | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
}

/** Une politique accorde-t-elle les crédits de l'UE dispensée au registre ? */
export const grantsCredits = (policy: ExemptionCreditPolicy): boolean => policy === "GRANT_CREDITS";

export function isExemptionCreditPolicy(value: unknown): value is ExemptionCreditPolicy {
  return typeof value === "string" && (EXEMPTION_CREDIT_POLICIES as readonly string[]).includes(value);
}
