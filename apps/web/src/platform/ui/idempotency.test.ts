import { describe, expect, it } from "vitest";
import { createIdempotentRunner, newIdempotencyKey } from "./idempotency";

const KEY_FORMAT = /^[A-Za-z0-9._:\-]{8,120}$/;

describe("newIdempotencyKey", () => {
  it("respecte le format du contrat finance et ne se répète pas", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey("pay")));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k).toMatch(KEY_FORMAT);
  });
});

describe("createIdempotentRunner", () => {
  it("double clic : un seul envoi, la seconde exécution est ignorée pendant la première", async () => {
    const runner = createIdempotentRunner<{ amount: number }>((p) => String(p.amount));
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const exec = async () => {
      calls += 1;
      await gate;
      return "ok";
    };
    const first = runner.run({ amount: 5000 }, exec);
    const second = runner.run({ amount: 5000 }, exec);
    release();
    expect(await first).toBe("ok");
    expect(await second).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("échec réseau : la nouvelle tentative de la MÊME demande reprend la MÊME clé", async () => {
    const runner = createIdempotentRunner<{ amount: number }>((p) => String(p.amount));
    const keys: string[] = [];
    await expect(runner.run({ amount: 5000 }, async (k) => (keys.push(k), Promise.reject(new Error("réseau"))))).rejects.toThrow("réseau");
    await runner.run({ amount: 5000 }, async (k) => (keys.push(k), "ok"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("demande corrigée : nouvelle clé (l'API refuserait une clé réutilisée avec un autre contenu)", async () => {
    const runner = createIdempotentRunner<{ amount: number }>((p) => String(p.amount));
    const keys: string[] = [];
    await runner.run({ amount: 5000 }, async (k) => (keys.push(k), Promise.reject(new Error("refus")))).catch(() => undefined);
    await runner.run({ amount: 6000 }, async (k) => (keys.push(k), "ok"));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("après un succès, la même saisie est une NOUVELLE opération (nouvelle clé)", async () => {
    const runner = createIdempotentRunner<{ amount: number }>((p) => String(p.amount));
    const keys: string[] = [];
    await runner.run({ amount: 5000 }, async (k) => (keys.push(k), "ok"));
    expect(runner.current()).toBeNull();
    await runner.run({ amount: 5000 }, async (k) => (keys.push(k), "ok"));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("le verrou est relâché après une erreur (l'utilisateur peut réessayer)", async () => {
    const runner = createIdempotentRunner<number>(String);
    await runner.run(1, () => Promise.reject(new Error("x"))).catch(() => undefined);
    expect(await runner.run(1, async () => "ok")).toBe("ok");
  });
});
