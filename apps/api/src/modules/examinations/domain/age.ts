/**
 * Âge en années entières à une date de référence (jour calendaire, sans fuseau). Domaine pur.
 * Sert aux faits d'éligibilité d'un candidat LIBRE : l'âge est CALCULÉ de la date de naissance saisie et de la date de la session
 * (donnée) ; le seuil d'âge, lui, est dans la règle, jamais ici. Date de référence absente ou invalide -> `null` (jamais 0).
 */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function ageYearsAt(birthDate: string | null, referenceDate: string | null): number | null {
  if (!birthDate || !referenceDate) return null;
  const b = DATE_RE.exec(birthDate);
  const r = DATE_RE.exec(referenceDate);
  if (!b || !r) return null;
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const [ry, rm, rd] = [Number(r[1]), Number(r[2]), Number(r[3])];
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age < 0 ? null : age;
}
