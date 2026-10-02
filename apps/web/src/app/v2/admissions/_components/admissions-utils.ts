import type { AdmissionStatus, AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import type { Tone } from "@/platform/ui/PageHeader";

/** Lire le recrutement : toute personne du circuit d'admission. L'API reste la barrière réelle. */
export const VIEW_PERMISSIONS = ["admission.read"] as const;

/** Tonalité des huit statuts canoniques : le libellé porte le sens, la couleur n'est qu'un renfort. */
export const statusTone = (status: AdmissionStatus): Tone => {
  switch (status) {
    case "ACCEPTED":
    case "ENROLLED":
      return "success";
    case "REJECTED":
      return "danger";
    case "MISSING_DOCUMENT":
    case "WAITLISTED":
      return "warning";
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return "info";
    default:
      return "neutral";
  }
};

export const fullName = (a: { applicantFirstName: string; applicantLastName: string }): string => `${a.applicantFirstName} ${a.applicantLastName}`.trim();

/** Lien du lieu de réponse à une offre : le secret reste dans le FRAGMENT (jamais envoyé au serveur ni consigné dans ses journaux). */
export function offerLink(origin: string, slug: string, token: string): string {
  return `${origin}/v2/apply/${encodeURIComponent(slug)}/offer#t=${encodeURIComponent(token)}`;
}

export function trackLink(origin: string, slug: string): string {
  return `${origin}/v2/apply/${encodeURIComponent(slug)}/track`;
}

export function publicFormLink(origin: string, slug: string): string {
  return `${origin}/v2/apply/${encodeURIComponent(slug)}`;
}

/** Une offre en attente existe (pour ne proposer d'en émettre une autre qu'à bon escient ; l'API refuse de toute façon un doublon). */
export const hasPendingOffer = (a: Pick<AdmissionsApplicationDetailDto, "offers">): boolean => a.offers.some((o) => o.status === "PENDING");

/** Convertit une saisie vide en `undefined` (champ facultatif absent du corps strict). */
export const blankToUndefined = (value: string): string | undefined => {
  const t = value.trim();
  return t === "" ? undefined : t;
};

export const blankToNull = (value: string): string | null => {
  const t = value.trim();
  return t === "" ? null : t;
};

/** Entier saisi, ou `null` si vide / invalide / hors bornes. */
export function parseInteger(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** Instant ISO à partir d'un `datetime-local` (heure de l'appareil). */
export function localInputToInstant(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function instantToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
