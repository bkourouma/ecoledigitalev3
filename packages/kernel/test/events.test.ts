import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "../src/clock";
import { createRequestContext } from "../src/context";
import {
  EventPublishError,
  InMemoryEventBus,
  createDomainEvent,
  isValidEventType,
  type DomainEvent,
  type OutboxWriter,
} from "../src/events";
import { isUuid } from "../src/id";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const ctx = createRequestContext({ tenantId: T, userId: U, requestId: "req-42" });
const clock = new ManualClock("2026-10-01T08:00:00Z");

type Events = {
  "student.enrolled": { studentId: string };
  "invoice.paid": { invoiceId: string; amount: number };
};

const enrolled = (studentId = "s1") =>
  createDomainEvent<"student.enrolled", Events["student.enrolled"]>({
    type: "student.enrolled",
    payload: { studentId },
    ctx,
    clock,
  });

describe("createDomainEvent", () => {
  it("reprend tenant, acteur et requestId du contexte", () => {
    const e = createDomainEvent({
      type: "invoice.paid",
      payload: { invoiceId: "i1" },
      ctx,
      clock,
      aggregateType: "invoice",
      aggregateId: "i1",
      version: 2,
    });
    expect(isUuid(e.id)).toBe(true);
    expect(e).toMatchObject({
      type: "invoice.paid",
      version: 2,
      tenantId: T,
      actorId: U,
      requestId: "req-42",
      occurredAt: "2026-10-01T08:00:00.000Z",
      aggregateType: "invoice",
      aggregateId: "i1",
    });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("est sérialisable en JSON sans perte", () => {
    const e = enrolled();
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("valide le type et la version", () => {
    expect(isValidEventType("student.enrolled")).toBe(true);
    expect(isValidEventType("finance.invoice.paid")).toBe(true);
    expect(isValidEventType("Student.Enrolled")).toBe(false);
    expect(isValidEventType("enrolled")).toBe(false);
    expect(() => createDomainEvent({ type: "bad", payload: {}, ctx })).toThrowError(/invalide/);
    expect(() => createDomainEvent({ type: "a.b", payload: {}, ctx, version: 0 })).toThrowError(/version/);
  });
});

describe("InMemoryEventBus", () => {
  it("livre aux abonnés du type, dans l'ordre d'abonnement", async () => {
    const bus = new InMemoryEventBus<Events>();
    const calls: string[] = [];
    bus.subscribe("student.enrolled", () => void calls.push("a"));
    bus.subscribe("student.enrolled", async () => {
      await new Promise((r) => setTimeout(r, 10));
      calls.push("b");
    });
    bus.subscribe("student.enrolled", () => void calls.push("c"));
    bus.subscribe("invoice.paid", () => void calls.push("autre"));
    await bus.publish(enrolled());
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("le handler reçoit un événement typé", async () => {
    const bus = new InMemoryEventBus<Events>();
    const seen: string[] = [];
    bus.subscribe("student.enrolled", (e) => void seen.push(e.payload.studentId));
    await bus.publish(enrolled("s9"));
    expect(seen).toEqual(["s9"]);
  });

  it("subscribeAll reçoit tout ; unsubscribe retire", async () => {
    const bus = new InMemoryEventBus<Events>();
    const all: string[] = [];
    const off = bus.subscribeAll((e) => void all.push(e.type));
    const typed = vi.fn();
    const offTyped = bus.subscribe("student.enrolled", typed);
    await bus.publish(enrolled());
    off();
    offTyped();
    await bus.publish(enrolled());
    expect(all).toEqual(["student.enrolled"]);
    expect(typed).toHaveBeenCalledTimes(1);
    expect(bus.size).toBe(0);
  });

  it("mode throw : tous les handlers s'exécutent, puis EventPublishError", async () => {
    const bus = new InMemoryEventBus<Events>();
    const after = vi.fn();
    bus.subscribe("student.enrolled", () => {
      throw new Error("un");
    });
    bus.subscribe("student.enrolled", async () => {
      throw new Error("deux");
    });
    bus.subscribe("student.enrolled", after);
    const e = enrolled();
    const failure = await bus.publish(e).catch((x: unknown) => x);
    expect(failure).toBeInstanceOf(EventPublishError);
    const f = failure as EventPublishError;
    expect(f.errors).toHaveLength(2);
    expect(f.eventId).toBe(e.id);
    expect(f.code).toBe("EVENT_HANDLER_FAILED");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("mode isolate : onError reçoit les échecs, publish résout", async () => {
    const onError = vi.fn();
    const bus = new InMemoryEventBus<Events>({ errorMode: "isolate", onError });
    bus.subscribe("student.enrolled", () => {
      throw new Error("x");
    });
    await expect(bus.publish(enrolled())).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("un abonnement ajouté pendant un publish n'affecte pas ce publish", async () => {
    const bus = new InMemoryEventBus<Events>();
    const late = vi.fn();
    bus.subscribe("student.enrolled", () => {
      bus.subscribe("student.enrolled", late);
    });
    await bus.publish(enrolled());
    expect(late).not.toHaveBeenCalled();
    await bus.publish(enrolled());
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("publier sans abonné est sans effet", async () => {
    await expect(new InMemoryEventBus<Events>().publish(enrolled())).resolves.toBeUndefined();
  });
});

describe("OutboxWriter (port)", () => {
  it("peut être implémenté en mémoire pour les tests de use cases", async () => {
    const written: DomainEvent[] = [];
    const writer: OutboxWriter = {
      append: async (events) => void written.push(...events),
    };
    await writer.append([enrolled("a"), enrolled("b")]);
    expect(written.map((e) => (e.payload as { studentId: string }).studentId)).toEqual(["a", "b"]);
  });
});
