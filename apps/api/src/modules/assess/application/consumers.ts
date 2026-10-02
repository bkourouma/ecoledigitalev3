/**
 * Consommateurs d'événements et jobs du module `assess`.
 *  - `tenancy.tenant.provisioned` : amorçage des types d'évaluation du pack (idempotent, non destructif).
 *  - Job de purge des reçus de lots idempotents anciens (les clés d'idempotence n'ont de sens que sur la durée d'une
 *    synchronisation hors ligne).
 */
import { createSystemContext, ok, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { purgeReceiptsOlderThan } from "../infrastructure/grades-repository";
import { inTx, type AssessDeps } from "./deps";
import { instantiateAssessPack } from "./types";

/**
 * Pack dont le modèle d'évaluation est instancié, lu dans `tenancy.tenant.provisioned` (`packs[]` du producteur) :
 * `HIGHER` s'il fait partie des packs, sinon le premier ; `null` si aucun (le modèle par défaut s'applique).
 */
export function packOfTenantProvisioned(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const packs = (payload as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) return null;
  const names = packs.filter((x): x is string => typeof x === "string");
  if (names.includes("HIGHER")) return "HIGHER";
  return names[0] ?? null;
}

export async function onTenantProvisioned(deps: AssessDeps, ctx: RequestContext, input: { pack?: string | null | undefined } = {}): Promise<Result<{ created: number }, AppError>> {
  const seeded = await instantiateAssessPack(deps, ctx, input);
  if (!seeded.ok) return seeded;
  return ok({ created: seeded.value.created });
}

/** Supprime les reçus de lots de plus de `retentionDays` jours (défaut 14). */
export async function purgeBatchReceipts(deps: AssessDeps, ctx: RequestContext, input: { retentionDays?: number } = {}): Promise<Result<number, AppError>> {
  const before = new Date(deps.clock.now().getTime() - (input.retentionDays ?? 14) * 86_400_000);
  return inTx(deps, ctx, async (tx) => ok(await purgeReceiptsOlderThan(tx, before)));
}

export async function purgeAllTenants(deps: AssessDeps, systemDb: SystemDb, input: { retentionDays?: number } = {}): Promise<ForEachTenantReport<number>> {
  return systemDb.forEachTenant("assess-purge-receipts", async (_tx, tenant) => unwrap(await purgeBatchReceipts(deps, createSystemContext(tenant.id), input)));
}
