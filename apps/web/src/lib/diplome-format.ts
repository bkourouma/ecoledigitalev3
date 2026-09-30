/**
 * Helpers de mise en forme — Diplômes & Attestations de réussite (Module
 * Professionnel, feature 030). Partagé entre `diplome-pdf.ts` et
 * `attestation-pdf.ts`. Réutilise l'identité IPAM de `bulletin-format.ts`.
 */
import { gradeOf, niveauOf } from "./bulletin-format";

export const COMMISSION_VISA_1 =
  "Vu le décret n°97-430 du 23 juillet 1997 déterminant les attributions, la composition, l'organisation et le fonctionnement de la Commission de Reconnaissance et d'Equivalence des Diplômes et des Titres d'Ingénieurs, tel que modifié par le décret n°2006-242 du 02 Août 2006 ;";
export const COMMISSION_VISA_2 =
  "Vu la délibération des travaux de la Commission de Reconnaissance et d'Equivalence des Diplômes et des Titres d'Ingénieurs, en sa session du";
export const COMMISSION_VISA_3 = "Vu le procès-verbal de l'examen établi le";

export const DIPLOME_TITRE_DEFAULT = "DIPLÔME";
export const ATTESTATION_TITRE = "ATTESTATION DE RÉUSSITE";

export const PRESIDENT_JURY_TITRE = "Directeur du Comité Scientifique\nDirecteur de Recherche";
export const DIRECTEUR_GENERAL_ADJOINT_TITRE = "Enseignant - chercheur\nDirecteur Général Adjoint";
export const DUPLICATA_MENTION = "Aucun duplicata ne sera délivré.";

/* ----------------------- Signataires du diplôme ------------------------ */

export const DIPLOME_SIGNATAIRE_GAUCHE_NOM = "PROFESSEUR PENE BI GUIME CREPIN";
export const DIPLOME_SIGNATAIRE_DROITE_NOM = "CELESTE BAH, Enseignant - chercheur";
export const DIPLOME_SIGNATAIRE_DROITE_TITRE =
  "Membre du Comité Scientifique\nDirecteur Général Adjoint";

/** En-tête du diplôme : lignes du ministère (colonne gauche, cf. modèle). */
export const DIPLOME_MINISTERE_LIGNES = [
  "Ministère de l'Enseignement",
  "Supérieur et de la",
  "Recherche Scientifique",
] as const;
export const DIPLOME_REPUBLIQUE_TITRE = "RÉPUBLIQUE DE CÔTE D'IVOIRE";
export const DIPLOME_REPUBLIQUE_DEVISE = "Union - Discipline - Travail";
export const ATTESTATION_FOOTER =
  "En foi de quoi, je lui délivre la présente attestation pour servir et valoir ce que de droit.";

/* ------------------- Signataire de l'attestation ---------------------- */

export const ATTESTATION_SIGNATAIRE_NOM = "Celeste BAH";
export const ATTESTATION_SIGNATAIRE_QUALITE = "Enseignant Chercheur";
export const ATTESTATION_SIGNATAIRE_FONCTION = "Directeur des Etudes";
export const ATTESTATION_ETABLISSEMENT =
  "Institut Polyvalent des Affaires et du Management";
/** Bloc de signature en bas à gauche (2 lignes, centrées l'une sous l'autre). */
export const ATTESTATION_SIGNATURE_BLOC = "Le Directeur Des Etudes\nde l'université IPAM";
export const ATTESTATION_LIEU = "Abidjan";

/* ---------------- Attestation d'authenticité (diplôme) ---------------- */

export const AUTHENTICITE_TITRE = "ATTESTATION D'AUTHENTICITÉ";
export const AUTHENTICITE_SIGNATAIRE_NOM = "BAH CELESTE";
export const AUTHENTICITE_SIGNATAIRE_FONCTION = "Directeur Général Adjoint";
export const AUTHENTICITE_ETABLISSEMENT =
  "Institut Polyvalent des Affaires et du Management (IPAM)";

/** Intitulé complet d'un diplôme, ex. « Diplôme de Licence Professionnelle ». */
export function intituleDiplomeComplet(filiereName: string | null | undefined): string {
  const grade = cycleLabel(filiereName);
  if (grade === "LICENCE") return "Diplôme de Licence Professionnelle";
  if (grade === "MASTER") return "Diplôme de Master Professionnel";
  if (grade === "BTS") return "Diplôme de BTS";
  return "Diplôme";
}

/**
 * Année d'obtention sur un seul millésime (« 2026 ») : dernière année de
 * l'année académique (« 2025-2026 » → « 2026 »), sinon l'année de la date
 * d'obtention.
 */
export function anneeObtentionLabel(
  anneeAcademique: string | null | undefined,
  dateObtention: string | null | undefined
): string {
  const m = String(anneeAcademique ?? "").match(/(\d{4})\s*[-–/]\s*(\d{4})/);
  if (m) return m[2];
  const d = dateObtention ? new Date(dateObtention) : null;
  if (d && !isNaN(d.getTime())) return String(d.getFullYear());
  return "";
}

/**
 * En-tête de l'attestation : découpage figé des lignes (identique au modèle
 * officiel), chaque bloc étant centré sur sa colonne.
 */
export const ATTESTATION_MINISTERE_LIGNES = [
  "MINISTÈRE DE L'ENSEIGNEMENT",
  "SUPÉRIEUR ET DE LA",
  "RECHERCHE SCIENTIFIQUE",
] as const;

export const ATTESTATION_REPUBLIQUE_LIGNES = [
  "RÉPUBLIQUE DE CÔTE D'IVOIRE",
  "UNION-DISCIPLINE – TRAVAIL",
] as const;

/** Signataire d'un document, tel qu'enregistré en administration. */
export interface Signataire {
  nom: string;
  qualite?: string | null;
  fonction?: string | null;
}

/**
 * Phrase d'attestation : « Je soussigné, X, Y, Directeur des Etudes de …
 * atteste que : ». Le signataire vient de l'administration (table
 * `professional_signataires`) ; à défaut, on retombe sur les valeurs par défaut.
 */
export function attestationIntro(signataire?: Signataire | null): string {
  const nom = signataire?.nom?.trim() || ATTESTATION_SIGNATAIRE_NOM;
  const qualite = signataire?.qualite?.trim() || ATTESTATION_SIGNATAIRE_QUALITE;
  const fonction = signataire?.fonction?.trim() || ATTESTATION_SIGNATAIRE_FONCTION;
  // Les segments vides sont omis pour ne pas laisser « , , » dans la phrase.
  const segments = [nom, qualite].filter((s) => s.length > 0).join(", ");
  return `Je soussigné, ${segments}, ${fonction} de l'${ATTESTATION_ETABLISSEMENT} atteste que :`;
}

/** Bloc de signature de l'attestation de réussite, dérivé de la fonction. */
export function attestationSignatureBloc(signataire?: Signataire | null): string {
  const fonction = signataire?.fonction?.trim();
  if (!fonction) return ATTESTATION_SIGNATURE_BLOC;
  return `Le ${fonction}\nde l'université IPAM`;
}

/** « LICENCE 3 GENIE LOGICIEL » → « Genie Logiciel » (spécialité seule). */
export function specialiteOf(filiereName: string | null | undefined): string {
  const raw = String(filiereName ?? "").trim();
  if (!raw) return "";
  const sansGrade = raw.replace(/^\s*(licence|master|bts|doctorat)\s*\d*\s*/i, "").trim();
  const base = sansGrade || raw;
  return base
    .toLocaleLowerCase("fr-FR")
    .split(/(\s|-)/)
    .map((part) =>
      /^\s|-$/.test(part) || part === "-" || part.trim() === ""
        ? part
        : part.charAt(0).toLocaleUpperCase("fr-FR") + part.slice(1)
    )
    .join("");
}

/** Numéro de niveau extrait du libellé (« LICENCE 2 … » → 2), sinon null. */
export function niveauNumberOf(filiereName: string | null | undefined): number | null {
  const s = String(filiereName ?? "");
  const m = s.match(/(?:licence|master|bts|doctorat)\s*(\d)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Intitulé « A obtenu » de l'attestation, ex. « Licence 1 Professionnelle en
 * Transport Logistique ». Le numéro de niveau n'apparaît que pour les années
 * intermédiaires : le niveau terminal du cycle (Licence 3, Master 2) diplôme le
 * cycle complet et s'écrit donc sans numéro (« Licence Professionnelle en … »).
 * Retombe sur le libellé brut si le cycle est indéterminé.
 */
export function intituleObtention(filiereName: string | null | undefined): string {
  const grade = cycleLabel(filiereName);
  const specialite = specialiteOf(filiereName);
  const niveau = niveauNumberOf(filiereName);
  const terminal = cycleDureeAnnees(filiereName); // 3 (Licence), 2 (Master)
  // Numéro affiché seulement pour les niveaux intermédiaires (< niveau terminal).
  const isTerminal = niveau != null && terminal != null && niveau >= terminal;
  const num = niveau != null && !isTerminal ? ` ${niveau}` : "";
  if (grade === "LICENCE") return `Licence${num} Professionnelle en ${specialite}`;
  if (grade === "MASTER") return `Master${num} Professionnel en ${specialite}`;
  if (grade === "BTS") return `BTS en ${specialite}`;
  return String(filiereName ?? "");
}

/** « 2026-2027 » → « 2026 - 2027 » (présentation de l'année sur l'attestation). */
export function anneeAcademiqueEspacee(annee: string | null | undefined): string {
  const s = String(annee ?? "").trim();
  const m = s.match(/^(\d{4})\s*[-–/]\s*(\d{4})$/);
  return m ? `${m[1]} - ${m[2]}` : s;
}

/**
 * Année académique (« 2026-2027 ») à partir d'une date. Bascule au 1er SEPTEMBRE,
 * comme partout ailleurs dans l'application (admin, étudiant, owner, SQL) : une
 * classe ouverte fin août appartient à l'année qui se termine, pas à la suivante.
 */
export function academicYearFromDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/** Cycle (Licence/Master) et niveau déduits du libellé de la filière. */
export function cycleLabel(filiereName: string | null | undefined): string {
  return gradeOf(filiereName);
}

export function niveauLabel(filiereName: string | null | undefined): string {
  return niveauOf(filiereName);
}

/** Durée conventionnelle du cycle (3 ans Licence, 2 ans Master), sinon vide. */
export function cycleDureeAnnees(filiereName: string | null | undefined): number | null {
  const grade = gradeOf(filiereName);
  if (grade === "LICENCE") return 3;
  if (grade === "MASTER") return 2;
  return null;
}

/** Intitulé complet du diplôme, ex. « DIPLÔME LICENCE PROFESSIONNELLE ». */
export function diplomeTitreComplet(filiereName: string | null | undefined): string {
  const grade = cycleLabel(filiereName);
  if (!grade || grade === "—") return DIPLOME_TITRE_DEFAULT;
  return `${DIPLOME_TITRE_DEFAULT}\n${grade} PROFESSIONNELLE`;
}

/** Mentions académiques usuelles (ordre croissant). */
export const MENTIONS = ["Passable", "Assez Bien", "Bien", "Très Bien", "Excellent"] as const;
export type Mention = (typeof MENTIONS)[number];

/** Date « 03 juillet 2026 » (jour, mois en minuscules, année) pour les visas. */
export function fmtDateVisaFr(value?: string | Date | null): string {
  if (!value) return "____________________";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "____________________";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Date de l'attestation, mois en minuscules comme sur le modèle officiel.
 * `pad2` force le jour sur 2 chiffres (« 07 septembre 2024 » pour la date de
 * délivrance ; « 10 juillet 1992 » sans padding pour la date de naissance).
 */
export function fmtDateAttestation(
  value?: string | Date | null,
  opts: { pad2?: boolean } = {}
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", {
    day: opts.pad2 ? "2-digit" : "numeric",
    month: "long",
    year: "numeric",
  });
}
