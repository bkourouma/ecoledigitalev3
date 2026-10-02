import type { Tx } from "@ecoledigitale/database";
import type { BindingRecord } from "../domain/types";
import { BINDING_COLUMNS, toBinding, type BindingRow } from "./rows";

export async function listBindings(tx: Tx, filter: { contractId?: string } = {}): Promise<BindingRecord[]> {
  const rows = filter.contractId
    ? await tx.many<BindingRow>(`SELECT ${BINDING_COLUMNS} FROM rules.rule_bindings WHERE contract_id = $1 ORDER BY effective_from, id`, [filter.contractId])
    : await tx.many<BindingRow>(`SELECT ${BINDING_COLUMNS} FROM rules.rule_bindings ORDER BY contract_id, effective_from, id`);
  return rows.map(toBinding);
}

export async function getBinding(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<BindingRecord | null> {
  const row = await tx.queryOne<BindingRow>(`SELECT ${BINDING_COLUMNS} FROM rules.rule_bindings WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return row ? toBinding(row) : null;
}

/** Liaison de même identité (contrat, périmètre exact, début d'effet) : sert à l'« upsert » de `PUT /bindings`. */
export async function findBindingByIdentity(
  tx: Tx,
  b: { contractId: string; institutionId: string | null; curriculumNodeId: string | null; levelCode: string | null; effectiveFrom: string },
): Promise<BindingRecord | null> {
  const row = await tx.queryOne<BindingRow>(
    `SELECT ${BINDING_COLUMNS} FROM rules.rule_bindings
      WHERE contract_id = $1 AND institution_id IS NOT DISTINCT FROM $2 AND curriculum_node_id IS NOT DISTINCT FROM $3
        AND level_code IS NOT DISTINCT FROM $4 AND effective_from = $5::date
      FOR UPDATE`,
    [b.contractId, b.institutionId, b.curriculumNodeId, b.levelCode, b.effectiveFrom],
  );
  return row ? toBinding(row) : null;
}

export interface NewBinding {
  readonly id: string;
  readonly contractId: string;
  readonly ruleSetCode: string;
  readonly institutionId: string | null;
  readonly curriculumNodeId: string | null;
  readonly levelCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdBy: string | null;
  /** Accusé de l'usage d'un jeu fictif (`null` : aucun). */
  readonly placeholderAck?: { readonly by: string; readonly at: Date; readonly reason: string } | null;
}

export async function insertBinding(tx: Tx, tenantId: string, b: NewBinding): Promise<BindingRecord> {
  await tx.query(
    `INSERT INTO rules.rule_bindings (id, tenant_id, contract_id, rule_set_code, institution_id, curriculum_node_id, level_code, effective_from, effective_to, created_by,
                                      placeholder_ack_by, placeholder_ack_at, placeholder_ack_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      b.id, tenantId, b.contractId, b.ruleSetCode, b.institutionId, b.curriculumNodeId, b.levelCode, b.effectiveFrom, b.effectiveTo, b.createdBy,
      b.placeholderAck?.by ?? null, b.placeholderAck?.at ?? null, b.placeholderAck?.reason ?? null,
    ],
  );
  return (await getBinding(tx, b.id)) as BindingRecord;
}

export async function updateBinding(
  tx: Tx,
  id: string,
  patch: { ruleSetCode: string; effectiveTo: string | null; placeholderAck?: { readonly by: string; readonly at: Date; readonly reason: string } | null },
): Promise<BindingRecord> {
  await tx.query(
    `UPDATE rules.rule_bindings
        SET rule_set_code = $2, effective_to = $3, placeholder_ack_by = $4, placeholder_ack_at = $5, placeholder_ack_reason = $6
      WHERE id = $1`,
    [id, patch.ruleSetCode, patch.effectiveTo, patch.placeholderAck?.by ?? null, patch.placeholderAck?.at ?? null, patch.placeholderAck?.reason ?? null],
  );
  return (await getBinding(tx, id)) as BindingRecord;
}

export async function deleteBinding(tx: Tx, id: string): Promise<boolean> {
  const res = await tx.query(`DELETE FROM rules.rule_bindings WHERE id = $1`, [id]);
  return res.rowCount > 0;
}
