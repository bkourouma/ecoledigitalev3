/**
 * Numérotation des documents : `PRÉFIXE-AAAA-NNNNNN`, séquentielle PAR TENANT,
 * PAR TYPE ET PAR ANNÉE. L'attribution (sans trou ni doublon sous concurrence)
 * est faite par la base (`finance.next_number`) dans la transaction qui insère le
 * document ; ce fichier ne fait que formater / relire un numéro.
 */
import { abidjanDate, type Clock } from "@ecoledigitale/kernel";
import type { DocumentKind } from "./types";

export const DOCUMENT_PREFIX: Readonly<Record<DocumentKind, string>> = Object.freeze({
  INVOICE: "FAC",
  RECEIPT: "REC",
  CREDIT_NOTE: "AV",
});

const WIDTH = 6;

export function formatDocumentNumber(kind: DocumentKind, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError(`Année invalide : ${year}.`);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError(`Séquence invalide : ${sequence}.`);
  return `${DOCUMENT_PREFIX[kind]}-${year}-${String(sequence).padStart(WIDTH, "0")}`;
}

export interface ParsedDocumentNumber {
  kind: DocumentKind;
  year: number;
  sequence: number;
}

export function parseDocumentNumber(value: string): ParsedDocumentNumber | null {
  const m = /^([A-Z]+)-(\d{4})-(\d{6,})$/.exec(value);
  if (!m) return null;
  const kind = (Object.keys(DOCUMENT_PREFIX) as DocumentKind[]).find((k) => DOCUMENT_PREFIX[k] === m[1]);
  if (!kind) return null;
  return { kind, year: Number(m[2]), sequence: Number(m[3]) };
}

/** Année de numérotation = année civile à Abidjan de l'instant donné. */
export function numberingYear(clock: Clock): number {
  return Number(abidjanDate(clock.now()).slice(0, 4));
}
