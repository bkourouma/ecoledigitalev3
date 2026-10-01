/**
 * Accès à `kernel.tenants` (table GLOBALE du socle, sans RLS).
 *
 * Le module `tenancy` est le propriétaire fonctionnel du cycle de vie d'un
 * tenant (création par le provisioning, statut). C'est la seule table hors du
 * schéma `tenancy` que ce module touche (ADR-006 : seules les références vers
 * `kernel.tenants` sont admises).
 *
 * Comme la table n'est pas filtrée par la RLS, TOUTES les requêtes ci-dessous
 * qualifient explicitement l'identifiant du tenant visé.
 */
import type { Tx } from "@ecoledigitale/database";
import type { TenantStatus } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { TenantRecord } from "../domain/entities";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

const toRecord = (r: TenantRow): TenantRecord => ({ id: r.id, slug: r.slug, name: r.name, status: r.status });

export async function insertTenant(
  tx: Tx,
  t: { id: string; slug: string; name: string },
  now: Date,
): Promise<TenantRecord> {
  const row = await tx.queryOne<TenantRow>(
    `INSERT INTO kernel.tenants (id, slug, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', $4, $4)
     RETURNING id, slug, name, status`,
    [t.id, t.slug, t.name, now],
  );
  return toRecord(row as TenantRow);
}

export async function findTenant(tx: Tx, id: string): Promise<TenantRecord | null> {
  const row = await tx.queryOne<TenantRow>("SELECT id, slug, name, status FROM kernel.tenants WHERE id = $1", [id]);
  return row ? toRecord(row) : null;
}

export async function updateTenantStatus(
  tx: Tx,
  id: string,
  status: TenantStatus,
  now: Date,
): Promise<TenantRecord | null> {
  const row = await tx.queryOne<TenantRow>(
    `UPDATE kernel.tenants SET status = $2, updated_at = $3 WHERE id = $1
     RETURNING id, slug, name, status`,
    [id, status, now],
  );
  return row ? toRecord(row) : null;
}
