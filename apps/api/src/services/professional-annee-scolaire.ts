/**
 * Année scolaire (« 2025-2026 ») d'une date, pivot au 1er septembre — identique à
 * `academicYearFromDate` du front (`diplome-format.ts`) qui alimente l'année
 * imprimée sur l'attestation, afin que le filtre corresponde au PDF.
 */
export function anneeScolaireOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
