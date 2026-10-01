/**
 * Formats de référence des documents officiels (Q-24 : formats du legacy conservés). Le NUMÉRO vient du compteur
 * transactionnel (`higher.next_number`), jamais d'un comptage de lignes (R-HIG-07).
 */
import type { CounterKey } from "./types";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** `DIP-AAAA-NNNNNN` (6 chiffres minimum). */
export function formatDiplomaReference(year: number, seq: number): string {
  assertSeq(seq);
  return `DIP-${pad(year, 4)}-${pad(seq, 6)}`;
}

/** `AUTH/AAAA/NNN` (3 chiffres minimum). */
export function formatAuthenticityReference(year: number, seq: number): string {
  assertSeq(seq);
  return `AUTH/${pad(year, 4)}/${pad(seq, 3)}`;
}

/** `ATT-AAAA-NNNNNN`. */
export function formatAttestationReference(year: number, seq: number): string {
  assertSeq(seq);
  return `ATT-${pad(year, 4)}-${pad(seq, 6)}`;
}

/** Duplicata : même numéro, suffixe `/Dn` (n = numéro de version - 1). La référence reste unique par nature de document. */
export function duplicateReference(reference: string, version: number): string {
  if (version <= 1) return reference;
  const base = reference.replace(/\/D\d+$/, "");
  return `${base}/D${version - 1}`;
}

export function formatReference(key: CounterKey, year: number, seq: number): string {
  switch (key) {
    case "DIPLOMA":
      return formatDiplomaReference(year, seq);
    case "AUTHENTICITY":
      return formatAuthenticityReference(year, seq);
    case "ATTESTATION":
      return formatAttestationReference(year, seq);
  }
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("Le numéro d'ordre est un entier ≥ 1.");
}
