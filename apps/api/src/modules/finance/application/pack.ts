/**
 * Amorçage du catalogue de frais depuis le modèle de pack `finance` (catégories de frais, libellés seulement, AUCUN montant).
 *
 * Idempotent et NON destructif : un frais qui existe déjà (même code) n'est jamais modifié ; ce que l'établissement a
 * désactivé ou renommé reste tel quel. Aucun barème n'est créé : tant que l'établissement n'en saisit pas, aucun frais n'est dû.
 * Appelé par la plateforme au provisioning d'un établissement (câblage : voir `platform-assembly.md`) ou à la demande.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict } from "../domain/errors";
import { validateFeeDraft } from "../domain/fee";
import { feeTemplatesForPack } from "../domain/pack-template";
import { getFeeByCode, insertFee } from "../infrastructure/catalog-repository";
import { audit, inTx, insertOrConflict, type FinanceDeps } from "./deps";

export interface FinancePackReport {
  /** Codes de frais créés par cet appel. */
  readonly created: readonly string[];
  /** Codes qui existaient déjà (laissés tels quels). */
  readonly existing: readonly string[];
}

/** Instancie les catégories de frais du pack (`PRIMARY`, `SECONDARY`…) pour le tenant du contexte. Un pack sans modèle : rapport vide. */
export async function instantiateFinancePack(deps: FinanceDeps, ctx: RequestContext, input: { pack: string }): Promise<Result<FinancePackReport, AppError>> {
  const templates = feeTemplatesForPack(input.pack);
  if (templates.length === 0) return ok({ created: [], existing: [] });
  return inTx(deps, ctx, async (tx) => {
    const created: string[] = [];
    const existing: string[] = [];
    for (const template of templates) {
      const draft = validateFeeDraft({ ...template, currency: deps.config.defaultCurrency });
      if (!draft.ok) return draft;
      if (await getFeeByCode(tx, draft.value.code)) {
        existing.push(draft.value.code);
        continue;
      }
      // Savepoint : deux amorçages simultanés ne s'empoisonnent pas, le perdant compte le frais comme « existant ».
      const inserted = await insertOrConflict(
        tx,
        (sp) => insertFee(sp, ctx.tenantId, { id: deps.newId(), ...draft.value }),
        () => conflict(FinanceCode.INVALID_INPUT, `Le code de frais "${draft.value.code}" existe déjà.`, { code: draft.value.code }),
      );
      if (!inserted.ok) {
        existing.push(draft.value.code);
        continue;
      }
      await audit(deps, tx, ctx, { action: "finance.fee.created", resourceType: "fee", resourceId: inserted.value.id, after: inserted.value });
      created.push(draft.value.code);
    }
    return ok({ created, existing });
  });
}
