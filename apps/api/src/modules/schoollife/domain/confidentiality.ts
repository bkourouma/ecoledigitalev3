/**
 * Confidentialité à trois niveaux : `STANDARD` < `RESTRICTED` < `CONFIDENTIAL`.
 *
 * LA règle de visibilité est la fonction SQL `schoollife.audience_may_see` (migration 2202) : toutes les lectures filtrent par
 * elle (liste, dossier, portails). `audienceMaySee` ci-dessous en est le MIROIR PUR (affichage, tests de parité exhaustifs
 * sur tout l'espace des arguments) ; il ne sert jamais à autoriser une lecture à la place de la base.
 */
import type { SchoolLifeAudience, SchoolLifeConfidentiality, SchoolLifeEntityKind } from "@ecoledigitale/contracts/src/v2/schoollife";

export const CONFIDENTIALITY_RANK: Readonly<Record<SchoolLifeConfidentiality, number>> = Object.freeze({ STANDARD: 1, RESTRICTED: 2, CONFIDENTIAL: 3 });

export const confidentialityRank = (level: string): number => (CONFIDENTIALITY_RANK as Record<string, number | undefined>)[level] ?? 99;

/** Niveau le plus élevé d'une habilitation de personnel (permissions `schoollife.restricted.read`, `schoollife.confidential.read`). */
export function clearanceOf(caps: { restricted: boolean; confidential: boolean }): SchoolLifeConfidentiality {
  if (caps.confidential) return "CONFIDENTIAL";
  if (caps.restricted) return "RESTRICTED";
  return "STANDARD";
}

export function staffAudience(clearance: SchoolLifeConfidentiality): SchoolLifeAudience {
  return clearance === "CONFIDENTIAL" ? "STAFF_CONFIDENTIAL" : clearance === "RESTRICTED" ? "STAFF_RESTRICTED" : "STAFF_STANDARD";
}

export interface VisibilityFacts {
  readonly audience: string;
  readonly kind: string;
  readonly confidentiality: string;
  readonly shareable: boolean | null;
  readonly status: string;
  readonly noteVisibility?: string | null;
}

/** Miroir pur de `schoollife.audience_may_see` (la parité est testée contre la base sur toutes les combinaisons). */
export function audienceMaySee(f: VisibilityFacts): boolean {
  const { audience, kind, confidentiality, status } = f;
  if (audience === "STAFF_STANDARD" || audience === "STAFF_RESTRICTED" || audience === "STAFF_CONFIDENTIAL") {
    const limit = audience === "STAFF_STANDARD" ? 1 : audience === "STAFF_RESTRICTED" ? 2 : 3;
    return confidentialityRank(confidentiality) <= limit;
  }
  if (audience !== "GUARDIAN" && audience !== "STUDENT") return false;
  if (confidentiality === "CONFIDENTIAL") return false;
  if (!(f.shareable ?? false)) return false;
  switch (kind) {
    case "INCIDENT":
      return false;
    case "MEASURE":
      return status === "NOTIFIED" || status === "EXECUTED" || status === "APPEALED";
    case "NOTE":
      return (
        status === "ACTIVE" &&
        ((audience === "GUARDIAN" && (f.noteVisibility === "GUARDIANS" || f.noteVisibility === "STUDENT_AND_GUARDIANS")) || (audience === "STUDENT" && f.noteVisibility === "STUDENT_AND_GUARDIANS"))
      );
    case "CONVOCATION":
      return audience === "GUARDIAN" && ["SENT", "ACKNOWLEDGED", "HELD", "NO_SHOW", "RESCHEDULED"].includes(status);
    default:
      return false;
  }
}

/** Un élément confidentiel n'est jamais rendu dans une liste : son contenu ne sort que par une lecture journalisée. */
export const isMaskedFor = (confidentiality: string): boolean => confidentiality === "CONFIDENTIAL";

export const ENTITY_TABLES: Readonly<Record<SchoolLifeEntityKind, string>> = Object.freeze({
  INCIDENT: "schoollife.incidents",
  MEASURE: "schoollife.measures",
  NOTE: "schoollife.notes",
  CONVOCATION: "schoollife.convocations",
});
