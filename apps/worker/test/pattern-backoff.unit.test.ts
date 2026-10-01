import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/events/pattern";
import { computeBackoff } from "../src/events/backoff";
import { SubscriberRegistry, registerSubscriber } from "../src/events/registry";

describe("compilePattern : routage par motif", () => {
  it("type exact", () => {
    const m = compilePattern("finance.payment.completed");
    expect(m("finance.payment.completed")).toBe(true);
    expect(m("finance.payment.failed")).toBe(false);
    expect(m("finance.payment.completed.v2")).toBe(false);
    expect(m("finance.payment")).toBe(false);
  });

  it("« * » = exactement un segment", () => {
    const m = compilePattern("finance.*.completed");
    expect(m("finance.payment.completed")).toBe(true);
    expect(m("finance.invoice.completed")).toBe(true);
    expect(m("finance.payment.refund.completed")).toBe(false);
    expect(m("finance.completed")).toBe(false);
    const m2 = compilePattern("student.*");
    expect(m2("student.enrolled")).toBe(true);
    expect(m2("student.enrolled.late")).toBe(false);
  });

  it("« ** » final = un ou plusieurs segments", () => {
    const m = compilePattern("finance.**");
    expect(m("finance.payment")).toBe(true);
    expect(m("finance.payment.completed")).toBe(true);
    expect(m("finance")).toBe(false);
    expect(m("academic.class.created")).toBe(false);
    expect(compilePattern("**")("anything.at.all")).toBe(true);
  });

  it("RegExp (sans état même avec le drapeau g)", () => {
    const m = compilePattern(/^audit\./g);
    expect(m("audit.entry.recorded")).toBe(true);
    expect(m("audit.entry.recorded")).toBe(true); // lastIndex d'une RegExp globale ne doit pas fuir
    expect(m("finance.payment.completed")).toBe(false);
  });

  it("refuse les motifs invalides", () => {
    expect(() => compilePattern("")).toThrow();
    expect(() => compilePattern("a.**.b")).toThrow(/dernier/);
    expect(() => compilePattern("A.b")).toThrow(/invalide/);
    expect(() => compilePattern("a..b")).toThrow(/invalide/);
  });
});

describe("computeBackoff", () => {
  const opts = { baseMs: 1000, maxMs: 60_000, jitter: 0 };

  it("croît exponentiellement puis plafonne", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => computeBackoff(n, opts))).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ]);
  });

  it("ne déborde pas pour de très grands nombres de tentatives", () => {
    expect(computeBackoff(10_000, opts)).toBe(60_000);
  });

  it("le jitter ne fait que RACCOURCIR le délai et reste borné", () => {
    const withJitter = { baseMs: 1000, maxMs: 60_000, jitter: 0.2 };
    expect(computeBackoff(3, withJitter, () => 0)).toBe(4000); // aucun retrait
    expect(computeBackoff(3, withJitter, () => 0.999999)).toBe(3200); // -20 % au maximum
    for (let i = 0; i < 200; i++) {
      const d = computeBackoff(20, withJitter);
      expect(d).toBeGreaterThanOrEqual(48_000);
      expect(d).toBeLessThanOrEqual(60_000);
    }
  });

  it("tentative < 1 traitée comme 1", () => {
    expect(computeBackoff(0, opts)).toBe(1000);
    expect(computeBackoff(-5, opts)).toBe(1000);
  });
});

describe("SubscriberRegistry", () => {
  const noop = async (): Promise<void> => undefined;

  it("applique les valeurs par défaut et route plusieurs abonnés", () => {
    const reg = new SubscriberRegistry();
    reg.add({ name: "a.exact", pattern: "x.y.z", handler: noop });
    reg.add({ name: "a.family", pattern: "x.**", handler: noop, concurrency: 2, retry: { attempts: 3, backoffMs: 10, maxBackoffMs: 20 } });
    reg.add({ name: "a.regex", pattern: /^other\./, handler: noop });

    expect(reg.match("x.y.z").map((s) => s.name)).toEqual(["a.exact", "a.family"]);
    expect(reg.match("x.q").map((s) => s.name)).toEqual(["a.family"]);
    expect(reg.match("other.thing").map((s) => s.name)).toEqual(["a.regex"]);
    expect(reg.match("nothing.here")).toEqual([]);

    const exact = reg.get("a.exact");
    expect(exact).toMatchObject({ attempts: 5, concurrency: 5, queueName: "domain-events-sub-a.exact" });
    expect(reg.get("a.family")).toMatchObject({ attempts: 3, concurrency: 2, backoffMs: 10, maxBackoffMs: 20 });
  });

  it("refuse un nom dupliqué, invalide ou des options incohérentes", () => {
    const reg = new SubscriberRegistry();
    reg.add({ name: "dup", pattern: "a.b", handler: noop });
    expect(() => reg.add({ name: "dup", pattern: "a.c", handler: noop })).toThrow(/deux fois/);
    expect(() => reg.add({ name: "Bad Name", pattern: "a.b", handler: noop })).toThrow(/nom invalide/);
    expect(() => reg.add({ name: "ok1", pattern: "a.b", handler: noop, concurrency: 0 })).toThrow(/concurrency/);
    expect(() => reg.add({ name: "ok2", pattern: "a.b", handler: noop, retry: { backoffMs: 100, maxBackoffMs: 10 } })).toThrow(/maxBackoffMs/);
    expect(() => reg.add({ name: "ok3", pattern: "a..b", handler: noop })).toThrow();
  });

  it("registerSubscriber(pattern, handler, options) enregistre dans le registre fourni", () => {
    const reg = new SubscriberRegistry();
    const sub = registerSubscriber("student.enrolled", noop, { name: "billing.open-account", concurrency: 3 }, reg);
    expect(sub.name).toBe("billing.open-account");
    expect(reg.match("student.enrolled")).toHaveLength(1);
  });
});
