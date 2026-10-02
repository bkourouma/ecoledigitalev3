/**
 * Infrastructure : SQL via le Tx d'un TenantDb.run (jamais de pool direct). La RLS isole par tenant ;
 * on écrit quand même tenant_id à l'insertion (colonne NOT NULL, WITH CHECK de la policy).
 */
import type { Tx } from "@ecoledigitale/database";
import type { Item } from "../domain/item";

interface ItemRow {
  id: string;
  tenant_id: string;
  label: string;
  created_at: Date;
}

export async function insertItem(tx: Tx, item: Item): Promise<void> {
  await tx.query("INSERT INTO zz_gate_13b6ce.items (id, tenant_id, label, created_at) VALUES ($1, $2, $3, $4)", [
    item.id,
    item.tenantId,
    item.label,
    item.createdAt,
  ]);
}

export async function selectItems(tx: Tx): Promise<Item[]> {
  const rows = await tx.many<ItemRow>(
    "SELECT id, tenant_id, label, created_at FROM zz_gate_13b6ce.items ORDER BY created_at DESC, id LIMIT 200",
  );
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, label: r.label, createdAt: r.created_at }));
}
