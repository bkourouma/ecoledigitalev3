import { describe, expect, it } from "vitest";
import { createRequestContext } from "@ecoledigitale/kernel";
import { TenantDb, type PgPoolLike, type PoolClientLike } from "../src";

const A = "11111111-1111-4111-8111-111111111111";
const U = "33333333-3333-4333-8333-333333333333";
const ctx = createRequestContext({ tenantId: A, userId: U, roles: ["admin"], requestId: "req-1" });

function pool(order: string[], failCommit = false): PgPoolLike {
  const client: PoolClientLike = {
    async query(sql: string) {
      const s = sql.trim();
      order.push(s.split(" ")[0] as string);
      if (failCommit && s === "COMMIT") throw new Error("commit perdu");
      return { rows: [], rowCount: 0 };
    },
    release() {
      order.push("release");
    },
  };
  return { connect: async () => client };
}

describe("Tx.onSettled", () => {
  it("s'exécute après COMMIT et après la libération de la connexion, avant le retour de run", async () => {
    const order: string[] = [];
    const out = await new TenantDb(pool(order)).run(ctx, async (tx) => {
      tx.onSettled?.(() => {
        order.push("hook");
      });
      return 7;
    });
    expect(out).toBe(7);
    expect(order.slice(-3)).toEqual(["COMMIT", "release", "hook"]);
  });

  it("s'exécute aussi après ROLLBACK (erreur d'origine conservée) et ses erreurs sont avalées", async () => {
    const order: string[] = [];
    await expect(
      new TenantDb(pool(order)).run(ctx, async (tx) => {
        tx.onSettled?.(async () => {
          order.push("hook1");
          throw new Error("redis coupé");
        });
        tx.onSettled?.(() => {
          order.push("hook2");
        });
        throw new Error("métier");
      }),
    ).rejects.toThrow("métier");
    expect(order.slice(-4)).toEqual(["ROLLBACK", "release", "hook1", "hook2"]);
  });

  it("une transaction imbriquée (SAVEPOINT) enregistre sur la transaction externe : un seul passage", async () => {
    const order: string[] = [];
    await new TenantDb(pool(order)).run(ctx, async (outer) => {
      await outer.transaction(async (inner) => {
        inner.onSettled?.(() => {
          order.push("hook");
        });
      });
    });
    expect(order.filter((x) => x === "hook")).toHaveLength(1);
    expect(order.at(-1)).toBe("hook");
  });

  it("COMMIT en échec : ROLLBACK puis effets de fin, l'erreur remonte", async () => {
    const order: string[] = [];
    await expect(
      new TenantDb(pool(order, true)).run(ctx, async (tx) => {
        tx.onSettled?.(() => {
          order.push("hook");
        });
      }),
    ).rejects.toThrow("commit perdu");
    expect(order.slice(-3)).toEqual(["ROLLBACK", "release", "hook"]);
  });
});
