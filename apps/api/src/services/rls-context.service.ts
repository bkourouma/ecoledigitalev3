import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";

export interface RlsContext {
  tenantId?: string | null;
  isSuperAdmin?: boolean;
}

const rlsContextStorage = new AsyncLocalStorage<RlsContext>();

export function enterRlsRequestContext(initialContext: RlsContext = {}): void {
  rlsContextStorage.enterWith({ ...initialContext });
}

export function setRlsContext(context: RlsContext): void {
  const existing = rlsContextStorage.getStore();

  if (existing) {
    Object.assign(existing, context);
    return;
  }

  rlsContextStorage.enterWith({ ...context });
}

export function getRlsContext(): RlsContext | undefined {
  return rlsContextStorage.getStore();
}

export async function applyRlsContextToClient(
  client: Pick<PoolClient, "query">
): Promise<void> {
  const context = getRlsContext() ?? { isSuperAdmin: true };
  const tenantId = context.tenantId ?? "";
  const isSuperAdmin = context.isSuperAdmin === true ? "true" : "false";

  await client.query(
    `
      SELECT
        set_config('app.tenant_id', $1, false),
        set_config('app.current_tenant_id', $1, false),
        set_config('app.super_admin', $2, false)
    `,
    [tenantId, isSuperAdmin]
  );
}
