/**
 * Identifiants : UUID partout (cf. plan §3.4).
 *
 * - `newId()`   : UUID v7 (triable par date de création → bonne localité d'index
 *                 B-tree), généré sans dépendance à partir de `node:crypto`.
 * - `newUuidV4()` : UUID v4 aléatoire pur, quand aucun ordre n'est souhaité.
 *
 * Le générateur v7 est MONOTONE dans le processus : deux appels successifs
 * donnent des identifiants strictement croissants, même dans la même milliseconde
 * (compteur de 12 bits dans `rand_a`, RFC 9562 §6.2 méthode 1) et même si
 * l'horloge recule.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ValidationError } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Valide et normalise (minuscules). Lève `ValidationError` sinon. */
export function parseUuid(value: unknown, field = "id"): string {
  if (!isUuid(value)) {
    throw ValidationError.field(field, `${field} doit être un UUID valide.`, "invalid_uuid");
  }
  return value.toLowerCase();
}

export function newUuidV4(): string {
  return randomUUID();
}

let lastMs = -1;
let lastSeq = 0;

/**
 * UUID v7. `nowMs` n'est destiné qu'aux tests (horloge injectée).
 */
export function newId(nowMs: number = Date.now()): string {
  let ms = Math.max(Math.floor(nowMs), 0);
  if (ms > lastMs) {
    lastMs = ms;
    // Départ aléatoire dans la moitié basse pour garder de la marge de comptage.
    lastSeq = randomBytes(2).readUInt16BE(0) & 0x07ff;
  } else {
    // Même milliseconde (ou horloge reculée) : on reste sur lastMs et on compte.
    ms = lastMs;
    lastSeq += 1;
    if (lastSeq > 0x0fff) {
      // Compteur épuisé : on avance artificiellement d'une milliseconde.
      lastMs += 1;
      ms = lastMs;
      lastSeq = 0;
    }
  }

  const bytes = randomBytes(16);
  // 48 bits de timestamp (big-endian)
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // version 7 + 12 bits de compteur
  bytes[6] = 0x70 | ((lastSeq >> 8) & 0x0f);
  bytes[7] = lastSeq & 0xff;
  // variante RFC 4122 (10xx)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extrait la date de création d'un UUID v7 ; `null` si ce n'est pas un v7. */
export function uuidV7Timestamp(id: string): Date | null {
  if (!isUuid(id) || id[14] !== "7") return null;
  const hex = id.replace(/-/g, "").slice(0, 12);
  return new Date(parseInt(hex, 16));
}

/** Réinitialise l'état du générateur monotone (tests uniquement). */
export function __resetIdGeneratorForTests(): void {
  lastMs = -1;
  lastSeq = 0;
}
