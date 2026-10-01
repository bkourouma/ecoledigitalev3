/**
 * Emplacements de signature DATÉS (R-HIG-08) : aucune valeur par défaut. Le signataire d'un emplacement est celui en
 * vigueur à la date d'ÉMISSION du document.
 */
import type { DocumentKind, DocumentSlot, IsoDate, SlotKey } from "./types";

/** Emplacements obligatoires par nature de document. */
export const REQUIRED_SLOTS: Readonly<Record<DocumentKind, readonly SlotKey[]>> = Object.freeze({
  DIPLOMA: ["DIPLOMA_LEFT", "DIPLOMA_RIGHT"],
  ATTESTATION_SUCCESS: ["ATTESTATION_SUCCESS"],
  ATTESTATION_AUTHENTICITY: ["AUTHENTICITY"],
});

/** Un créneau est en vigueur à `on` si `valid_from <= on` et (`valid_to` absent ou `valid_to >= on`). */
export function isSlotInForce(slot: Pick<DocumentSlot, "validFrom" | "validTo">, on: IsoDate): boolean {
  return slot.validFrom <= on && (slot.validTo === null || slot.validTo >= on);
}

/** Affectation en vigueur de l'emplacement à la date (les plages d'un emplacement ne se chevauchent pas). */
export function slotInForce(slots: readonly DocumentSlot[], key: SlotKey, on: IsoDate): DocumentSlot | null {
  return slots.find((s) => s.slotKey === key && isSlotInForce(s, on)) ?? null;
}

/** Jour précédent (`AAAA-MM-JJ`), pour clore une affectation la veille de la suivante. */
export function previousDay(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
