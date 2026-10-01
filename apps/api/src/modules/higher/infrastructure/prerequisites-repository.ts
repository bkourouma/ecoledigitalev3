/** Prérequis entre UE (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { DecimalString, Prerequisite, PrerequisiteMode, Uuid } from "../domain/types";
import { PREREQUISITE_COLUMNS, toPrerequisite, type PrerequisiteRow } from "./rows";

export async function listPrerequisites(tx: Tx, ueNodeId: Uuid): Promise<Prerequisite[]> {
  const rows = await tx.many<PrerequisiteRow>(
    `SELECT ${PREREQUISITE_COLUMNS} FROM higher.ue_prerequisites WHERE ue_node_id = $1 ORDER BY created_at, id`,
    [ueNodeId],
  );
  return rows.map(toPrerequisite);
}

/** Toutes les arêtes du tenant (graphe pour la détection de cycle). */
export async function listAllEdges(tx: Tx): Promise<Array<{ ueNodeId: Uuid; prerequisiteNodeId: Uuid }>> {
  const rows = await tx.many<{ ue_node_id: Uuid; prerequisite_node_id: Uuid }>(`SELECT ue_node_id, prerequisite_node_id FROM higher.ue_prerequisites`);
  return rows.map((r) => ({ ueNodeId: r.ue_node_id, prerequisiteNodeId: r.prerequisite_node_id }));
}

/** UE qui exigent `prerequisiteNodeId` (impact d'un retrait). */
export async function listDependents(tx: Tx, prerequisiteNodeId: Uuid): Promise<Uuid[]> {
  const rows = await tx.many<{ ue_node_id: Uuid }>(`SELECT ue_node_id FROM higher.ue_prerequisites WHERE prerequisite_node_id = $1`, [prerequisiteNodeId]);
  return rows.map((r) => r.ue_node_id);
}

export async function replacePrerequisites(
  tx: Tx,
  tenantId: Uuid,
  ueNodeId: Uuid,
  items: ReadonlyArray<{ id: Uuid; prerequisiteNodeId: Uuid; mode: PrerequisiteMode; minAverage: DecimalString | null }>,
  createdBy: Uuid | null,
): Promise<Prerequisite[]> {
  await tx.query(`DELETE FROM higher.ue_prerequisites WHERE ue_node_id = $1`, [ueNodeId]);
  for (const it of items) {
    await tx.query(
      `INSERT INTO higher.ue_prerequisites (id, tenant_id, ue_node_id, prerequisite_node_id, mode, min_average, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [it.id, tenantId, ueNodeId, it.prerequisiteNodeId, it.mode, it.minAverage, createdBy],
    );
  }
  return listPrerequisites(tx, ueNodeId);
}
