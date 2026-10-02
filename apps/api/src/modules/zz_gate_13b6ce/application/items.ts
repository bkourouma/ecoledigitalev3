/**
 * Application : un cas d'usage = une fonction (deps, ctx, input) => Promise<Result<T, E>>.
 * Écriture, événement d'outbox et audit sont validés ou annulés ENSEMBLE (une seule transaction).
 */
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createDomainEvent, newId, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ITEM_CREATED, type ItemCreatedPayload } from "../domain/events";
import { normalizeLabel, type Item } from "../domain/item";
import { insertItem, selectItems } from "../infrastructure/item-repository";
import type { ItemsDeps } from "./ports";

export async function createItem(deps: ItemsDeps, ctx: RequestContext, input: { label: unknown }): Promise<Result<Item, AppError>> {
  const label = normalizeLabel(input.label);
  if (!label.ok) return label;

  const item: Item = { id: newId(), tenantId: ctx.tenantId, label: label.value, createdAt: deps.clock.now() };
  await deps.tenantDb.run(ctx, async (tx) => {
    await insertItem(tx, item);

    const payload: ItemCreatedPayload = { v: 1, itemId: item.id };
    await new PgOutboxWriter(tx).append([
      createDomainEvent({
        type: ITEM_CREATED,
        ctx,
        clock: deps.clock,
        aggregateType: "zz_gate_13b6ce.item",
        aggregateId: item.id,
        payload,
      }),
    ]);

    // Audit EN DERNIER dans la transaction : un échec d'audit annule l'opération entière.
    await deps.audit.record(tx, {
      action: "zz_gate_13b6ce.item.create",
      entity: "item",
      entityId: item.id,
      after: { label: item.label },
    });
  });
  return ok(item);
}

export async function listItems(deps: ItemsDeps, ctx: RequestContext): Promise<Item[]> {
  return await deps.tenantDb.run(ctx, (tx) => selectItems(tx), { readOnly: true });
}
