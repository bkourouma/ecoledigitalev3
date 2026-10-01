import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { noopLogger, newId } from "@ecoledigitale/kernel";
import { migrate } from "@ecoledigitale/database";
import {
  BASELINE_DIR,
  createTestDb,
  describeIntegration,
  hasDb,
  type TestDb,
} from "../../../../../../packages/database/test/helpers";

export { createTestDb, describeIntegration, hasDb, type TestDb };

const here = dirname(fileURLToPath(import.meta.url));
export const AUDIT_MIGRATIONS = resolve(here, "../migrations");

/** Baseline kernel + migrations du module audit, sous le rôle `migrator`. */
export async function applyAuditSchema(db: TestDb) {
  return migrate({ client: db.admin, dirs: [BASELINE_DIR, AUDIT_MIGRATIONS], role: "migrator", logger: noopLogger });
}

export async function newTenant(db: TestDb, label = "t"): Promise<string> {
  const id = newId();
  await db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `${label}-${id.slice(-10)}`, `Tenant ${label}`]);
  return id;
}

/**
 * Exécute `sql` en SUPERUSER avec les triggers désactivés (session_replication_role=replica) :
 * simule un administrateur de base qui falsifie le journal.
 */
export async function tamper(db: TestDb, sql: string, params: unknown[] = []): Promise<void> {
  await db.admin.query("BEGIN");
  try {
    await db.admin.query("SET LOCAL session_replication_role = replica");
    await db.admin.query(sql, params);
    await db.admin.query("COMMIT");
  } catch (e) {
    await db.admin.query("ROLLBACK");
    throw e;
  }
}
