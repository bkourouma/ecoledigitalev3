import { afterEach, describe, expect, it } from "vitest";
import { createDomainEvent, createRequestContext, type DomainEvent } from "@ecoledigitale/kernel";
import { PgOutboxWriter, fetchPendingEvents, setOutboxTraceparentProvider } from "../src/outbox";
import type { Tx } from "../src/types";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const TP = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function recorder(): { tx: Tx; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params: [...params] });
      return { rows: [], rowCount: 0 };
    },
    many: async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params: [...params] });
      return [];
    },
  } as unknown as Tx;
  return { tx, calls };
}

const event = (): DomainEvent =>
  createDomainEvent({ type: "finance.payment.completed", payload: { v: 1 }, ctx: createRequestContext({ tenantId: T, userId: U, requestId: "req-trace-1" }) });

afterEach(() => setOutboxTraceparentProvider(undefined));

describe("outbox : contexte de trace (ADR-009)", () => {
  it("sans fournisseur : SQL d'insertion INCHANGÉ (aucune colonne traceparent)", async () => {
    const { tx, calls } = recorder();
    await new PgOutboxWriter(tx).append([event()]);
    expect(calls[0]?.sql).not.toContain("traceparent");
    expect(calls[0]?.params).toHaveLength(10);
  });

  it("avec un fournisseur actif : écrit le traceparent ambiant de chaque événement", async () => {
    setOutboxTraceparentProvider(() => TP);
    const { tx, calls } = recorder();
    await new PgOutboxWriter(tx).append([event(), event()]);
    expect(calls[0]?.sql).toContain("traceparent");
    expect(calls[0]?.params).toHaveLength(22);
    expect(calls[0]?.params[10]).toBe(TP);
    expect(calls[0]?.params[21]).toBe(TP);
  });

  it("le traceparent propre à l'événement l'emporte ; une valeur invalide est ignorée", async () => {
    const own = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00";
    setOutboxTraceparentProvider(() => "pas-un-traceparent");
    const a = recorder();
    await new PgOutboxWriter(a.tx).append([{ ...event(), traceparent: own }]);
    expect(a.calls[0]?.params[10]).toBe(own);
    const b = recorder();
    await new PgOutboxWriter(b.tx).append([event()]);
    expect(b.calls[0]?.sql).not.toContain("traceparent");
  });

  it("un fournisseur qui lève ne fait jamais échouer l'écriture", async () => {
    setOutboxTraceparentProvider(() => {
      throw new Error("boom");
    });
    const { tx, calls } = recorder();
    await expect(new PgOutboxWriter(tx).append([event()])).resolves.toBeUndefined();
    expect(calls[0]?.sql).not.toContain("traceparent");
  });

  it("fetchPendingEvents ne lit la colonne que sur demande", async () => {
    const a = recorder();
    await fetchPendingEvents(a.tx, 10);
    expect(a.calls[0]?.sql).not.toContain("traceparent");
    const b = recorder();
    await fetchPendingEvents(b.tx, 10, { withTraceparent: true });
    expect(b.calls[0]?.sql).toContain(", traceparent");
  });
});
