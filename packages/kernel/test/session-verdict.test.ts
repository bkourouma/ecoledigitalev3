import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_VERDICT_UNAVAILABLE,
  hasSessionVerdictInvalidator,
  invalidateSessionVerdict,
  registerSessionVerdictInvalidator,
  type SessionVerdictTarget,
  type SettleHost,
} from "../src";

function fakeTx() {
  const hooks: Array<() => void | Promise<void>> = [];
  const tx: SettleHost = { onSettled: (fn) => void hooks.push(fn) };
  return { tx, hooks, settle: async () => { for (const h of hooks) await h(); } };
}

afterEach(() => registerSessionVerdictInvalidator(null));

describe("invalidateSessionVerdict (port du noyau)", () => {
  it("sans invalidateur enregistré : no-op, même avec une transaction sans point de fin", async () => {
    expect(hasSessionVerdictInvalidator()).toBe(false);
    await expect(invalidateSessionVerdict({}, { kind: "tenant", tenantId: "t" })).resolves.toBeUndefined();
  });

  it("begin dans la transaction, end après sa fin ; idempotent par transaction et par cible", async () => {
    const calls: string[] = [];
    registerSessionVerdictInvalidator({
      begin: async (t) => void calls.push(`begin:${t.map((x: SessionVerdictTarget) => x.kind).join(",")}`),
      end: async (t) => void calls.push(`end:${t.map((x: SessionVerdictTarget) => x.kind).join(",")}`),
    });
    const { tx, settle } = fakeTx();
    await invalidateSessionVerdict(tx, { kind: "identity", identityId: "i1" });
    await invalidateSessionVerdict(tx, { kind: "identity", identityId: "i1" });
    await invalidateSessionVerdict(tx, [{ kind: "identity", identityId: "i1" }, { kind: "session", tenantId: "t", sessionId: "s" }]);
    expect(calls).toEqual(["begin:identity", "begin:session"]);
    await settle();
    expect(calls).toEqual(["begin:identity", "begin:session", "end:identity", "end:session"]);
    // une autre transaction n'hérite d'aucun état
    const other = fakeTx();
    await invalidateSessionVerdict(other.tx, { kind: "identity", identityId: "i1" });
    expect(calls.filter((c) => c === "begin:identity")).toHaveLength(2);
  });

  it("échec fermé : si begin échoue, une erreur 503 `iam.session_cache_unavailable` annule l'appelant", async () => {
    registerSessionVerdictInvalidator({
      begin: async () => {
        throw new Error("redis down");
      },
      end: async () => undefined,
    });
    const { tx, hooks } = fakeTx();
    await expect(invalidateSessionVerdict(tx, { kind: "tenant", tenantId: "t" })).rejects.toMatchObject({ code: SESSION_VERDICT_UNAVAILABLE, httpStatus: 503 });
    expect(hooks).toHaveLength(0); // rien à retirer : le marqueur n'a pas été posé
  });

  it("échec fermé : une transaction sans onSettled ne peut pas porter une invalidation", async () => {
    registerSessionVerdictInvalidator({ begin: async () => undefined, end: async () => undefined });
    await expect(invalidateSessionVerdict({}, { kind: "tenant", tenantId: "t" })).rejects.toMatchObject({ code: SESSION_VERDICT_UNAVAILABLE });
  });
});
