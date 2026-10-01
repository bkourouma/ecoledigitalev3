/**
 * `iam.memberships` — table de TENANT (RLS forcée). À appeler dans une transaction
 * `TenantDb.run(ctx, ...)` : la RLS borne les lignes au tenant du contexte, sans
 * `WHERE tenant_id` (on l'écrit quand même pour l'index et la lisibilité).
 */
import type { Tx } from "@ecoledigitale/database";

export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";

export interface MembershipRow {
  id: string;
  tenant_id: string;
  identity_id: string;
  status: MembershipStatus;
  base_role: string;
  roles: string[];
  active_role: string | null;
  invited_by: string | null;
  created_at: Date;
}

const COLUMNS = "id, tenant_id, identity_id, status, base_role, roles, active_role, invited_by, created_at";

export function findMembershipByIdentity(tx: Tx, tenantId: string, identityId: string): Promise<MembershipRow | null> {
  return tx.queryOne<MembershipRow>(`SELECT ${COLUMNS} FROM iam.memberships WHERE tenant_id = $1 AND identity_id = $2`, [tenantId, identityId]);
}

export function findMembershipById(tx: Tx, tenantId: string, id: string): Promise<MembershipRow | null> {
  return tx.queryOne<MembershipRow>(`SELECT ${COLUMNS} FROM iam.memberships WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

export async function insertMembership(
  tx: Tx,
  input: {
    id: string;
    tenantId: string;
    identityId: string;
    status: MembershipStatus;
    roles: readonly string[];
    invitedBy: string | null;
    now: Date;
  },
): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO iam.memberships (id, tenant_id, identity_id, status, base_role, roles, invited_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $8)
     ON CONFLICT (tenant_id, identity_id) DO NOTHING`,
    [input.id, input.tenantId, input.identityId, input.status, input.roles[0], [...input.roles], input.invitedBy, input.now],
  );
  return res.rowCount === 1;
}

export async function updateMembership(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: { status?: MembershipStatus; roles?: readonly string[]; activeRole?: string | null },
  now: Date,
): Promise<MembershipRow | null> {
  const sets: string[] = ["updated_at = $3"];
  const params: unknown[] = [tenantId, id, now];
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.roles !== undefined) {
    params.push([...patch.roles]);
    sets.push(`roles = $${params.length}::text[]`);
    sets.push(`base_role = ($${params.length}::text[])[1]`);
    // L'ancien rôle actif peut ne plus exister : on le remet à NULL (le prochain login re-choisit).
    sets.push(`active_role = CASE WHEN active_role = ANY ($${params.length}::text[]) THEN active_role ELSE NULL END`);
  }
  if (patch.activeRole !== undefined) {
    params.push(patch.activeRole);
    sets.push(`active_role = $${params.length}`);
  }
  return tx.queryOne<MembershipRow>(
    `UPDATE iam.memberships SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    params,
  );
}

export interface MemberListRow extends MembershipRow {
  email: string;
  mfa_enabled: boolean;
}

export function listMembers(tx: Tx, tenantId: string, limit = 200, offset = 0): Promise<MemberListRow[]> {
  return tx.many<MemberListRow>(
    `SELECT m.id, m.tenant_id, m.identity_id, m.status, m.base_role, m.roles, m.active_role, m.invited_by, m.created_at,
            i.email, i.mfa_enabled
       FROM iam.memberships m
       JOIN iam.identities i ON i.id = m.identity_id
      WHERE m.tenant_id = $1
      ORDER BY m.created_at, m.id
      LIMIT $2 OFFSET $3`,
    [tenantId, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  );
}
