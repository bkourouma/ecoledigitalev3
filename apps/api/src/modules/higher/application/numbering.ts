/**
 * Numérotation des diplômes et attestations — FORMAT LIBRE par établissement (Q-24).
 *
 *  - Chaque nature (`DIPLOMA`, `AUTHENTICITY`, `ATTESTATION`) a un motif (`DIP-{YYYY}-{SEQ:6}`, `UNI/{YY}/D{SEQ:4}`…) et un réglage
 *    « sans trou ». Sans réglage enregistré : motif historique + garantie sans trou (aucune régression).
 *  - Le numéro vient TOUJOURS du compteur transactionnel (`higher.next_number`), dans la transaction qui écrit le document :
 *    une annulation ne consomme pas de numéro. L'unicité des références est garantie par contrainte, pas par le motif.
 *  - « Sans trou » désactivé : l'établissement peut AVANCER le compteur (reprise d'un registre papier, numéros réservés) ;
 *    jamais reculer. Le saut est refusé par le déclencheur de la base tant que la garantie est active.
 *  - Un changement de motif ne vaut que pour les documents FUTURS : les références émises sont immuables (1408).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { HigherCode, conflict, validation } from "../domain/errors";
import {
  CONTINUOUS_COUNTER_YEAR,
  DEFAULT_NUMBERING_PATTERNS,
  counterYearFor,
  defaultNumberingPattern,
  formatWithPattern,
  parseNumberingPattern,
  type NumberingPattern,
} from "../domain/numbering";
import { COUNTER_KEYS, type CounterKey } from "../domain/types";
import * as repo from "../infrastructure/documents-repository";
import { EventBuffer, currentYear, inTx, type HigherDeps } from "./deps";

export interface ReferenceAllocation {
  readonly reference: string;
  /** Année du compteur (0 pour une séquence continue) : conservée dans `reference_year`. */
  readonly referenceYear: number;
  readonly referenceSeq: number;
}

/** Motif et garantie effectifs d'une nature (réglage de l'établissement, sinon valeurs historiques). */
async function effectiveSetting(tx: Tx, key: CounterKey): Promise<{ pattern: NumberingPattern; gapless: boolean; custom: boolean; updatedAt: Date | null }> {
  const stored = await repo.getNumberingSetting(tx, key);
  if (!stored) return { pattern: defaultNumberingPattern(key), gapless: true, custom: false, updatedAt: null };
  const parsed = parseNumberingPattern(stored.pattern);
  // Un motif stocké est validé à l'écriture ; s'il ne l'était plus, on échoue FERMÉ plutôt que d'émettre une référence douteuse.
  if (!parsed.ok) throw new Error(`Motif de numérotation illisible pour ${key} : ${parsed.message}`);
  return { pattern: parsed.value, gapless: stored.gapless, custom: true, updatedAt: stored.updatedAt };
}

/**
 * Attribue le numéro suivant et formate la référence selon le motif de l'établissement. À appeler DANS la transaction qui écrit le
 * document (le verrou du compteur dure jusqu'au COMMIT).
 */
export async function allocateReference(tx: Tx, key: CounterKey, year: number): Promise<ReferenceAllocation> {
  const { pattern } = await effectiveSetting(tx, key);
  const referenceYear = counterYearFor(pattern, year);
  const referenceSeq = await repo.nextNumber(tx, key, referenceYear);
  return { reference: formatWithPattern(pattern, year, referenceSeq), referenceYear, referenceSeq };
}

export interface NumberingView {
  readonly counterKey: CounterKey;
  readonly pattern: string;
  readonly gapless: boolean;
  /** `true` : aucun réglage enregistré, valeurs historiques. */
  readonly isDefault: boolean;
  /** Séquence continue (motif sans année). */
  readonly continuous: boolean;
  /** Prochain numéro de séquence (année courante, ou séquence continue). */
  readonly nextNumber: number;
  /** Référence que recevrait le prochain document. */
  readonly nextReference: string;
  readonly updatedAt: Date | null;
}

async function viewOf(tx: Tx, key: CounterKey, year: number): Promise<NumberingView> {
  const s = await effectiveSetting(tx, key);
  const last = await repo.lastCounterValue(tx, key, counterYearFor(s.pattern, year));
  return {
    counterKey: key,
    pattern: s.pattern.source,
    gapless: s.gapless,
    isDefault: !s.custom,
    continuous: !s.pattern.usesYear,
    nextNumber: last + 1,
    nextReference: formatWithPattern(s.pattern, year, last + 1),
    updatedAt: s.updatedAt,
  };
}

export async function getNumbering(deps: HigherDeps, ctx: RequestContext): Promise<Result<NumberingView[], AppError>> {
  const year = currentYear(deps);
  return inTx(deps, ctx, async (tx) => ok(await Promise.all(COUNTER_KEYS.map((k) => viewOf(tx, k, year)))), { readOnly: true });
}

export interface UpdateNumberingInput {
  readonly pattern: string;
  readonly gapless: boolean;
}

export async function updateNumbering(deps: HigherDeps, ctx: RequestContext, key: CounterKey, input: UpdateNumberingInput): Promise<Result<NumberingView, AppError>> {
  const parsed = parseNumberingPattern(input.pattern);
  if (!parsed.ok) return err(validation(HigherCode.INVALID_INPUT, parsed.message, "pattern"));
  const pattern = parsed.value;
  const year = currentYear(deps);
  return inTx(deps, ctx, async (tx) => {
    // Deux natures ne partagent pas la même forme de référence (un diplôme et une attestation ne doivent pas se confondre).
    for (const other of COUNTER_KEYS) {
      if (other === key) continue;
      const o = await effectiveSetting(tx, other);
      if (o.pattern.source === pattern.source) {
        return err(validation(HigherCode.INVALID_INPUT, "Ce motif est déjà utilisé par une autre nature de document : les références doivent rester distinctes.", "pattern", { conflictsWith: other }));
      }
    }
    const before = await effectiveSetting(tx, key);
    await repo.upsertNumberingSetting(tx, ctx.tenantId, key, pattern.source, input.gapless, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.numbering.updated",
      resourceType: "numbering_setting",
      resourceId: key,
      sensitive: true,
      before: { pattern: before.pattern.source, gapless: before.gapless, isDefault: !before.custom },
      after: { pattern: pattern.source, gapless: input.gapless },
    });
    await events.flush(tx);
    return ok(await viewOf(tx, key, year));
  });
}

export interface AdvanceNumberingInput {
  /** Le prochain document recevra ce numéro de séquence. */
  readonly nextNumber: number;
  readonly reason: string;
}

/** Avance le compteur d'une nature dont la garantie « sans trou » est désactivée (saut volontaire, audité, jamais de recul). */
export async function advanceNumbering(deps: HigherDeps, ctx: RequestContext, key: CounterKey, input: AdvanceNumberingInput): Promise<Result<NumberingView, AppError>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) return err(validation(HigherCode.INVALID_INPUT, "Le motif de l'avance du compteur est obligatoire (10 caractères au moins).", "reason"));
  if (!Number.isInteger(input.nextNumber) || input.nextNumber < 2 || input.nextNumber > 999_999_999) {
    return err(validation(HigherCode.INVALID_INPUT, "Le prochain numéro est un entier compris entre 2 et 999 999 999.", "nextNumber"));
  }
  const year = currentYear(deps);
  return inTx(deps, ctx, async (tx) => {
    const s = await effectiveSetting(tx, key);
    if (s.gapless) {
      return err(conflict(HigherCode.NUMBERING_GAPLESS, "La numérotation sans trou est active pour cette nature de document : le compteur ne peut pas sauter de numéros."));
    }
    const counterYear = s.pattern.usesYear ? year : CONTINUOUS_COUNTER_YEAR;
    const last = await repo.lastCounterValue(tx, key, counterYear);
    if (input.nextNumber <= last + 1) {
      return err(validation(HigherCode.INVALID_INPUT, `Le compteur ne peut qu'avancer : le prochain numéro actuel est ${last + 1}.`, "nextNumber", { current: last + 1 }));
    }
    await repo.advanceCounter(tx, ctx.tenantId, key, counterYear, input.nextNumber);
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "higher.numbering.advanced",
      resourceType: "numbering_counter",
      resourceId: key,
      sensitive: true,
      reason,
      before: { nextNumber: last + 1, counterYear },
      after: { nextNumber: input.nextNumber, counterYear },
    });
    await events.flush(tx);
    return ok(await viewOf(tx, key, year));
  });
}

export { DEFAULT_NUMBERING_PATTERNS };
