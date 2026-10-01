/**
 * Synchronisation hors-ligne : horodatage client vs serveur, détection de conflit.
 *
 * Principes (PRD §59, spec AC6.x) :
 *  - le SERVEUR fait foi : `marked_at` / `received_at` sont ses horloges. L'horodatage de l'appareil
 *    (`client_marked_at`) sert UNIQUEMENT à ordonner deux saisies concurrentes d'un même pointage ;
 *  - l'horloge d'un appareil peut avoir une dérive : l'instant client est corrigé du décalage connu de l'appareil
 *    (`clockOffsetMs`) puis borné par l'instant de réception (un pointage ne vient jamais du futur) ;
 *  - « dernier arrivé gagne » par pointage tant que la séance est modifiable, mais un pointage plus ANCIEN que celui
 *    déjà enregistré ne l'écrase jamais en silence : il va dans la file de conflits (rien n'est perdu), sauf s'il
 *    s'agit d'un doublon du même auteur ; un pointage manuel prime toujours sur un pointage externe (visio, import) ;
 *  - rejouer une opération (même `clientId`) ne change rien (registre `sync_ops`) ;
 *  - une saisie sur une séance validée ou annulée, ou hors fenêtre de correction, n'est jamais écrite : conflit.
 */
import { sameMarkContent, type ComparableMark, type PreparedMark } from "./records";
import type { RecordSource, Uuid } from "./types";

export interface ExistingMarkForSync extends ComparableMark {
  readonly excused: boolean;
  readonly markedBy: Uuid;
  readonly markedAt: Date;
  readonly clientMarkedAt: Date | null;
  readonly sourceDetail: RecordSource | null;
}

/** Instant effectif d'une saisie hors-ligne : horloge appareil corrigée de sa dérive connue, plafonnée à la réception. */
export function effectiveClientTime(clientMarkedAt: Date, clockOffsetMs: number, receivedAt: Date): Date {
  const corrected = clientMarkedAt.getTime() + clockOffsetMs;
  return new Date(Math.min(corrected, receivedAt.getTime()));
}

export type SyncRecordDecision =
  | { kind: "APPLY"; reason: "NEW" | "NEWER" | "OVERRIDES_EXTERNAL" }
  | { kind: "UNCHANGED"; reason: "SAME_CONTENT" | "OLDER_SAME_AUTHOR" }
  | { kind: "CONFLICT"; conflictKind: "STALE" };

const isExternalSource = (s: RecordSource | null): boolean => s === "LIVE_CLASS" || s === "IMPORT";

/**
 * Décide du sort d'un pointage hors-ligne face à l'éventuel pointage déjà présent pour (séance, inscription).
 * Les verrous de séance (validée, annulée, fenêtre close) sont traités AVANT, par l'appelant.
 */
export function decideSyncRecord(input: {
  existing: ExistingMarkForSync | null;
  incoming: PreparedMark;
  incomingAt: Date;
  actorId: Uuid;
}): SyncRecordDecision {
  const { existing, incoming, incomingAt, actorId } = input;
  if (!existing) return { kind: "APPLY", reason: "NEW" };
  if (sameMarkContent(existing, incoming)) return { kind: "UNCHANGED", reason: "SAME_CONTENT" };
  if (isExternalSource(existing.sourceDetail)) return { kind: "APPLY", reason: "OVERRIDES_EXTERNAL" };

  const existingAt = existing.clientMarkedAt ?? existing.markedAt;
  if (incomingAt.getTime() > existingAt.getTime()) return { kind: "APPLY", reason: "NEWER" };
  // Plus ancien (ou simultané) que ce qui est en base.
  if (existing.markedBy === actorId) return { kind: "UNCHANGED", reason: "OLDER_SAME_AUTHOR" };
  return { kind: "CONFLICT", conflictKind: "STALE" };
}
