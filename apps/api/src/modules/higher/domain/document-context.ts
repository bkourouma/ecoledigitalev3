/**
 * Contexte de rendu PDF d'un document officiel : fonction PURE du SNAPSHOT immuable (`diploma/1`, `attestation-success/1`,
 * `attestation-authenticity/1`). Le PDF ne dépend de RIEN d'autre (ni de la base, ni de l'heure d'impression) : le même
 * snapshot donne le même contexte, donc le même PDF.
 *
 * Les libellés de mention sont de la PRÉSENTATION des codes du contrat de règles (`MENTION_CODES`) ; aucun seuil ni aucune
 * formule ici : la mention vient du snapshot, calculée par les règles à l'octroi.
 */
import type { DocumentKind, OfficialDocument } from "./types";

export const DOCUMENT_TEMPLATE_KEYS: Readonly<Record<DocumentKind, string>> = Object.freeze({
  DIPLOMA: "higher-diploma",
  ATTESTATION_SUCCESS: "higher-attestation-success",
  ATTESTATION_AUTHENTICITY: "higher-attestation-authenticity",
});

const DOCUMENT_TITLES: Readonly<Record<DocumentKind, string>> = Object.freeze({
  DIPLOMA: "Diplôme",
  ATTESTATION_SUCCESS: "Attestation de réussite",
  ATTESTATION_AUTHENTICITY: "Attestation d'authenticité",
});

/** Libellés d'affichage des codes de mention du contrat `credit-semester@1` (`PENDING` : mention non encore calculable). */
export const MENTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING: "En attente",
  INSUFFICIENT: "Insuffisant",
  PASSABLE: "Passable",
  FAIRLY_GOOD: "Assez bien",
  GOOD: "Bien",
  VERY_GOOD: "Très bien",
  EXCELLENT: "Excellent",
});

/** Emplacement de signature du snapshot -> clé d'emplacement du gabarit de plateforme (`signatureSlots`). */
export const TEMPLATE_SLOT_OF: Readonly<Record<string, string>> = Object.freeze({
  DIPLOMA_LEFT: "diploma-left",
  DIPLOMA_RIGHT: "diploma-right",
  ATTESTATION_SUCCESS: "attestation-success",
  AUTHENTICITY: "authenticity",
});

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;

/** `2025-03-07` -> `7 mars 2025` (date civile, aucun fuseau). */
export function frenchDate(iso: string | null | undefined): string | null {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  const day = Number(m[3]);
  return `${day === 1 ? "1er" : String(day)} ${month} ${m[1]}`;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface DocumentRenderContext extends Record<string, unknown> {
  readonly title: string;
}

/** Contexte du gabarit pour un document ÉMIS. `snapshot` est celui du document (jamais recalculé). */
export function buildDocumentContext(doc: Pick<OfficialDocument, "documentKind" | "snapshot" | "reference" | "version" | "snapshotSchema">): DocumentRenderContext {
  const s = obj(doc.snapshot);
  const institution = obj(s.institution);
  const student = obj(s.student);
  const diploma = obj(s.diploma);
  const program = obj(s.program);
  const mention = obj(s.mention);
  const academicYear = obj(s.academicYear);

  const birthDate = frenchDate(str(student.birthDate));
  const birthPlace = str(student.birthPlace);
  const matricule = str(student.matricule);
  const birthParts = [birthDate ? `Né(e) le ${birthDate}${birthPlace ? ` à ${birthPlace}` : ""}` : birthPlace ? `Né(e) à ${birthPlace}` : null, matricule ? `Matricule ${matricule}` : null].filter((p): p is string => p !== null);

  const mentionCode = str(mention.code);
  const gradeCode = str(diploma.gradeCode);
  const signatories = Object.entries(obj(s.signatories)).map(([slotKey, raw]) => {
    const sig = obj(raw);
    const title = str(sig.title);
    const fn = str(sig.function);
    return { slot: TEMPLATE_SLOT_OF[slotKey] ?? slotKey.toLowerCase().replace(/_/g, "-"), slotLabel: fn ?? title ?? "Signataire", name: str(sig.fullName) ?? "", title: fn ? title : null, jobFunction: null };
  });

  return {
    title: DOCUMENT_TITLES[doc.documentKind],
    meta: { versionText: doc.version > 1 ? `Duplicata n° ${doc.version - 1}` : "" },
    institution: {
      legalName: str(institution.name) ?? "",
      headerLeft: [],
      headerRight: [],
      contactLine: str(institution.address) ?? "",
      registrationRef: "",
      footerText: "",
    },
    student: { fullName: str(student.fullName) ?? "", birthLine: birthParts.join(" — ") },
    text: {
      conferred: "Le présent diplôme est délivré à",
      gradeLine: gradeCode ? `Grade : ${gradeCode}` : "",
      certified: "Nous soussignés certifions que",
      succeeded: "a satisfait à l'ensemble des exigences du programme",
      validity: "La présente attestation est délivrée pour servir et valoir ce que de droit.",
      authentic: "est titulaire du diplôme authentique suivant",
    },
    diploma: { label: str(diploma.label) ?? "", gradeCode: gradeCode ?? "", awardReference: str(diploma.awardReference) ?? "" },
    program: { label: str(program.label) ?? "", code: str(program.code) ?? "" },
    ues: arr(s.ues).map((u) => ({ code: str(obj(u).code) ?? "", label: str(obj(u).label) ?? "", credits: String(obj(u).credits ?? "") })),
    creditsTotal: String(s.creditsTotal ?? ""),
    mention: { label: mentionCode ? (MENTION_LABELS[mentionCode] ?? mentionCode) : "", average: str(mention.average) ?? "" },
    academicYear: { label: str(academicYear.label) ?? "" },
    acquiredDate: str(s.acquiredDate) ?? "",
    issueDate: str(s.issueDate) ?? "",
    reference: doc.reference,
    duplicateOf: str(s.duplicateOf) ?? "",
    signatories,
  };
}
