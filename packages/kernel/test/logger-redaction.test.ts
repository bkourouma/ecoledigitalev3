import { describe, expect, it } from "vitest";
import {
  REDACTED,
  assertNoForbiddenLogContent,
  buildPinoOptions,
  findForbiddenLogContent,
  isForbiddenLogKey,
  normalizeCorrelationKeys,
  sanitizeForLog,
  sanitizeLogArguments,
  sanitizeLogObject,
  scrubLogString,
} from "../src/logger";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("clés interdites", () => {
  it.each([
    "password",
    "newPassword",
    "x-api-key",
    "accessToken",
    "refresh_token",
    "Authorization",
    "cookie",
    "set-cookie",
    "mfaSecret",
    "totpSecret",
    "email",
    "contactEmail",
    "phoneNumber",
    "cardNumber",
    "iban",
    "body",
    "messageBody",
    "content",
    "payload",
    "firstName",
    "connectionString",
    "otp",
  ])("masque %s", (key) => {
    expect(isForbiddenLogKey(key)).toBe(true);
  });

  it.each(["request_id", "tenant_id", "user_id", "module", "job_id", "event_id", "durationMs", "status", "route", "method", "footprint", "attempts", "subscriber"])(
    "laisse passer %s",
    (key) => {
      expect(isForbiddenLogKey(key)).toBe(false);
    },
  );
});

describe("scrubLogString", () => {
  it("masque e-mail, JWT, Bearer, identifiants d'URL et paramètres sensibles", () => {
    // Valeur factice : l'URL de connexion est assemblée à l'exécution (le test de redaction a besoin d'un motif d'URL à identifiants).
    const dbUrl = `${"postgres"}://app:s3cr3t-pass@db:5432/x`;
    const s = scrubLogString(
      `login de jean.dupont@ecole.ci avec ${JWT} ; Authorization: Bearer abcdefghij1234567 ; ${dbUrl} ; GET /r?token=abc123&page=2&email=a%40b.ci`,
    );
    expect(s).not.toMatch(/jean\.dupont/);
    expect(s).not.toContain("eyJ");
    expect(s).not.toContain("abcdefghij1234567");
    expect(s).not.toContain("s3cr3t-pass");
    expect(s).not.toContain("abc123");
    expect(s).toContain("page=2");
    expect(s).toContain("[EMAIL]");
    expect(s).toContain("[JWT]");
  });

  it("masque un numéro de carte valide (Luhn) et un IBAN valide, pas un identifiant ordinaire", () => {
    expect(scrubLogString("carte 4111 1111 1111 1111 ok")).toContain("[CARD]");
    expect(scrubLogString("carte 4111-1111-1111-1112 ok")).not.toContain("[CARD]");
    expect(scrubLogString("iban FR76 3000 6000 0112 3456 7890 189")).toContain("[IBAN]");
    expect(scrubLogString("horodatage 1727870000000 et id 0192f0a4-7b1e-7c3a-8d2e-123456789012")).toBe(
      "horodatage 1727870000000 et id 0192f0a4-7b1e-7c3a-8d2e-123456789012",
    );
  });

  it("est idempotente", () => {
    const once = scrubLogString(`a@b.ci ${JWT}`);
    expect(scrubLogString(once)).toBe(once);
  });
});

describe("sanitizeForLog", () => {
  it("masque en profondeur, sans modifier l'entrée", () => {
    const input = { user: { id: "u1", email: "x@y.ci", nested: { password: "p", list: [{ token: "t" }, "z@z.ci"] } }, ok: 1 };
    const out = sanitizeForLog(input) as any;
    expect(out.user.id).toBe("u1");
    expect(out.user.email).toBe(REDACTED);
    expect(out.user.nested.password).toBe(REDACTED);
    expect(out.user.nested.list[0].token).toBe(REDACTED);
    expect(out.user.nested.list[1]).toBe("[EMAIL]");
    expect(out.ok).toBe(1);
    expect(input.user.email).toBe("x@y.ci");
  });

  it("coupe les cycles, borne la profondeur et réduit les erreurs pg", () => {
    const a: any = { name: "a" };
    a.self = a;
    expect((sanitizeForLog(a) as any).self).toBe("[circulaire]");
    const err = Object.assign(new Error('duplicate key (email)=(jean@ecole.ci)'), {
      code: "23505",
      detail: "Key (email)=(jean@ecole.ci) already exists.",
      parameters: ["jean@ecole.ci"],
    });
    const out = sanitizeForLog({ err }) as any;
    expect(out.err.code).toBe("23505");
    expect(out.err.detail).toBeUndefined();
    expect(out.err.parameters).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("jean@ecole.ci");
  });

  it("n'embarque pas les octets, les Map ni les fonctions", () => {
    const out = sanitizeForLog({ b: Buffer.from("secret"), m: new Map([["a", 1]]), f: () => 1 }) as any;
    expect(out.b).toMatch(/binaire/);
    expect(out.m).toBe("[Map]");
    expect(out.f).toBeUndefined();
  });
});

describe("corrélation", () => {
  it("normalise les clés camelCase vers le schéma snake_case, la forme snake_case l'emporte", () => {
    const out = normalizeCorrelationKeys({ requestId: "r1", tenantId: "t1", jobId: "j1", eventId: "e1", userId: "u1", other: 1 });
    expect(out).toEqual({ request_id: "r1", tenant_id: "t1", job_id: "j1", event_id: "e1", user_id: "u1", other: 1 });
    expect(normalizeCorrelationKeys({ requestId: "a", request_id: "b" })).toEqual({ request_id: "b" });
  });

  it("lignes de SystemDb : le requestId de la transaction système ne masque pas le request_id de corrélation", () => {
    expect(normalizeCorrelationKeys({ event: "system_db", requestId: "tx-1", tenantId: "t", phase: "start" })).toEqual({
      event: "system_db",
      tx_request_id: "tx-1",
      tenant_id: "t",
      phase: "start",
    });
    expect(normalizeCorrelationKeys({ requestId: "r-1" })).toEqual({ request_id: "r-1" });
  });

  it("sanitizeLogObject = masque + normalise", () => {
    expect(sanitizeLogObject({ tenantId: "t", password: "p" })).toEqual({ tenant_id: "t", password: REDACTED });
  });
});

describe("arguments d'un appel pino", () => {
  it("nettoie l'objet, le message et les interpolations", () => {
    const [obj, msg, extra] = sanitizeLogArguments([{ token: "t", tenantId: "x" }, "mail a@b.ci %s", "c@d.ci"]) as [any, string, string];
    expect(obj).toEqual({ token: REDACTED, tenant_id: "x" });
    expect(msg).toBe("mail [EMAIL] %s");
    expect(extra).toBe("[EMAIL]");
  });

  it("une Error seule devient { err } et un message filtré", () => {
    const [obj, msg] = sanitizeLogArguments([new Error("échec pour a@b.ci")]) as [any, string];
    expect(obj.err.message).toBe("échec pour [EMAIL]");
    expect(msg).toBe("échec pour [EMAIL]");
  });

  it("le hook pino applique la redaction avant écriture", () => {
    const options = buildPinoOptions({ service: "api", level: "info", mixin: () => ({ request_id: "r" }) });
    const seen: unknown[][] = [];
    options.hooks.logMethod.call({}, [{ authorization: "Bearer abcdefghijkl", status: 200 }, "ok"], (...a) => void seen.push(a));
    expect(seen[0]?.[0]).toEqual({ authorization: REDACTED, status: 200 });
    expect(options.base).toEqual({ service: "api" });
    expect(options.mixin()).toEqual({ request_id: "r" });
  });
});

describe("garde-fou findForbiddenLogContent", () => {
  it("accepte une ligne propre et les champs masqués", () => {
    expect(findForbiddenLogContent({ msg: "ok", request_id: "r", token: REDACTED, route: "/api/v1/x" })).toEqual([]);
    expect(() => assertNoForbiddenLogContent([{ msg: "ok" }, JSON.stringify({ a: 1 })])).not.toThrow();
  });

  it("échoue sur une clé interdite non masquée ou une valeur sensible, sans recopier la valeur", () => {
    const v = findForbiddenLogContent({ msg: "x", nested: { password: "hunter2" }, note: "écrit à a@b.ci" });
    expect(v.map((x) => x.reason).sort()).toEqual(["forbidden_key", "sensitive_value"]);
    expect(JSON.stringify(v)).not.toContain("hunter2");
    expect(JSON.stringify(v)).not.toContain("a@b.ci");
    expect(() => assertNoForbiddenLogContent([{ authorization: "Bearer abcdefghij12" }])).toThrow(/fuite/);
  });
});
