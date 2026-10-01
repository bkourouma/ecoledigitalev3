/**
 * Règles PURES du cycle de vie et de l'accès aux documents (spec 013 R-RC-02/03/06, US3, US6). La base les impose aussi
 * (déclencheurs de la migration 1303) ; ces fonctions donnent l'erreur métier lisible AVANT d'atteindre la base.
 */
import type { ReportCardRecord } from "./types";

type StatusFields = Pick<ReportCardRecord, "status" | "provisional" | "withdrawnAt">;

/** Un document « vivant » : ni remplacé ni révoqué. */
export const isLive = (c: Pick<ReportCardRecord, "status">): boolean => c.status === "ISSUED" || c.status === "PUBLISHED";

/** Visible aux familles : publié, non retiré, non provisoire (R-RC-06). SUPERSEDED et REVOKED disparaissent du portail. */
export const isVisibleToFamilies = (c: StatusFields): boolean => c.status === "PUBLISHED" && !c.provisional && c.withdrawnAt === null;

export type Decision = { ok: true } | { ok: false; code: "provisional" | "invalid_state" | "already"; message: string };

export function canPublish(c: StatusFields): Decision {
  if (c.provisional) return { ok: false, code: "provisional", message: "Un bulletin provisoire ne peut pas être publié aux familles." };
  if (c.status === "ISSUED") return { ok: true };
  if (c.status === "PUBLISHED") {
    return c.withdrawnAt === null ? { ok: false, code: "already", message: "Ce bulletin est déjà publié." } : { ok: true };
  }
  return { ok: false, code: "invalid_state", message: `Un bulletin ${c.status === "REVOKED" ? "révoqué" : "remplacé"} ne peut pas être publié.` };
}

export function canWithdraw(c: StatusFields): Decision {
  if (c.status !== "PUBLISHED") return { ok: false, code: "invalid_state", message: "Seul un bulletin publié peut être retiré aux familles." };
  return c.withdrawnAt === null ? { ok: true } : { ok: false, code: "already", message: "Ce bulletin est déjà retiré." };
}

export function canRevoke(c: StatusFields): Decision {
  if (c.status === "REVOKED") return { ok: false, code: "already", message: "Ce document est déjà révoqué." };
  if (c.status === "SUPERSEDED") return { ok: false, code: "invalid_state", message: "Ce document a déjà été remplacé : révoquez la version courante." };
  return { ok: true };
}

export function canReissue(c: StatusFields): Decision {
  if (c.provisional) return { ok: false, code: "provisional", message: "Un bulletin provisoire se régénère, il ne se réémet pas." };
  if (!(c.status === "ISSUED" || c.status === "PUBLISHED")) {
    return { ok: false, code: "invalid_state", message: "Seule la version courante d'un document peut être réémise." };
  }
  return { ok: true };
}

export type FamilyActor = { kind: "STUDENT"; studentId: string } | { kind: "GUARDIAN"; studentId: string };

/** Le téléchargement par une famille exige le document publié, visible et appartenant à l'élève concerné. */
export function familyMayRead(card: StatusFields & Pick<ReportCardRecord, "studentId">, actor: FamilyActor): boolean {
  return card.studentId === actor.studentId && isVisibleToFamilies(card);
}

/**
 * Un document dont les résultats ont été recalculés depuis son émission doit être réédité. `currentResultsVersion` est la
 * version courante publiée par le module results pour (classe, période).
 */
export const needsReissue = (card: Pick<ReportCardRecord, "resultsVersion" | "status" | "provisional">, currentResultsVersion: number | null): boolean =>
  currentResultsVersion !== null && isLive(card) && !card.provisional && currentResultsVersion > card.resultsVersion;

/** Nom de fichier téléchargé : ASCII sûr, sans donnée sensible au-delà du nom de l'élève. */
export function downloadFileName(card: Pick<ReportCardRecord, "documentKind" | "version" | "studentName">): string {
  const base = card.studentName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const kind = card.documentKind === "TRANSCRIPT" ? "releve" : "bulletin";
  return `${kind}-${base || "eleve"}-v${card.version}.pdf`;
}
