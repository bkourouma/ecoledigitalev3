import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ErrorCode,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
  httpStatusFor,
  isAppError,
  toAppError,
  toErrorBody,
} from "../src/errors";
import { all, andThen, andThenAsync, err, isErr, isOk, map, mapErr, match, ok, tryCatch, unwrap, unwrapOr } from "../src/result";

describe("erreurs applicatives", () => {
  it.each([
    [new NotFoundError(), 404, "NOT_FOUND", "not_found"],
    [new ForbiddenError(), 403, "FORBIDDEN", "forbidden"],
    [new ConflictError(), 409, "CONFLICT", "conflict"],
    [new ValidationError(), 400, "VALIDATION_FAILED", "validation"],
    [new UnauthorizedError(), 401, "UNAUTHORIZED", "unauthorized"],
    [new UnavailableError(), 503, "UNAVAILABLE", "unavailable"],
    [new InternalError(), 500, "INTERNAL", "internal"],
  ])("%s → HTTP %i, code %s", (error, status, code, kind) => {
    expect(error.httpStatus).toBe(status);
    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(httpStatusFor(error)).toBe(status);
  });

  it("les codes par défaut sont stables (contrat d'API)", () => {
    expect(ErrorCode).toEqual({
      NOT_FOUND: "NOT_FOUND",
      FORBIDDEN: "FORBIDDEN",
      CONFLICT: "CONFLICT",
      VALIDATION_FAILED: "VALIDATION_FAILED",
      UNAUTHORIZED: "UNAUTHORIZED",
      UNAVAILABLE: "UNAVAILABLE",
      INTERNAL: "INTERNAL",
    });
  });

  it("accepte un code spécifique valide et refuse un code malformé", () => {
    const e = new ConflictError("Facture déjà payée.", { code: "finance.invoice_already_paid" });
    expect(e.code).toBe("finance.invoice_already_paid");
    expect(e.httpStatus).toBe(409);
    expect(() => new ConflictError("x", { code: "mauvais code!" })).toThrowError(TypeError);
  });

  it("NotFoundError.of fabrique un message et des détails homogènes", () => {
    const e = NotFoundError.of("Élève", "abc");
    expect(e.message).toBe("Élève introuvable (abc).");
    expect(e.details).toEqual({ resource: "Élève", id: "abc" });
  });

  it("ValidationError.field porte une violation structurée", () => {
    const e = ValidationError.field(["lines", 0, "amount"], "Montant négatif.", "too_small");
    expect(e.issues).toEqual([{ path: ["lines", 0, "amount"], message: "Montant négatif.", code: "too_small" }]);
  });

  it("toAppError n'expose pas le message d'une erreur inconnue", () => {
    const raw = new Error("select * from users where password='x'");
    const e = toAppError(raw);
    expect(e).toBeInstanceOf(InternalError);
    expect(e.message).toBe("Erreur interne.");
    expect(e.cause).toBe(raw);
    expect(toAppError("chaîne").kind).toBe("internal");
    const known = new NotFoundError();
    expect(toAppError(known)).toBe(known);
    expect(isAppError(raw)).toBe(false);
  });

  it("toErrorBody est sérialisable, sans stack ni cause", () => {
    const body = toErrorBody(new ValidationError("Invalide.", [{ path: ["a"], message: "m" }]), "req-1");
    expect(body).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      kind: "validation",
      message: "Invalide.",
      issues: [{ path: ["a"], message: "m" }],
      requestId: "req-1",
    });
    const internal = toErrorBody(new Error("secret"));
    expect(internal.status).toBe(500);
    expect(JSON.stringify(internal)).not.toContain("secret");
  });
});

describe("Result", () => {
  it("construit et discrimine", () => {
    const a = ok(1);
    const b = err(new NotFoundError());
    expect(isOk(a) && !isErr(a)).toBe(true);
    expect(isErr(b) && !isOk(b)).toBe(true);
  });

  it("map / mapErr / andThen ne touchent que la bonne branche", () => {
    expect(map(ok(2), (x) => x * 3)).toEqual(ok(6));
    const e = err("boom");
    expect(map(e, () => 1)).toBe(e);
    expect(mapErr(e, (x) => x.toUpperCase())).toEqual(err("BOOM"));
    expect(mapErr(ok(1), () => "x")).toEqual(ok(1));
    expect(andThen(ok(2), (x) => ok(x + 1))).toEqual(ok(3));
    expect(andThen(ok(2), () => err("non"))).toEqual(err("non"));
    expect(andThen(e, () => ok(9))).toBe(e);
  });

  it("andThenAsync court-circuite", async () => {
    expect(await andThenAsync(ok(2), async (x) => ok(x * 2))).toEqual(ok(4));
    let called = false;
    const r = await andThenAsync(err("x"), async () => {
      called = true;
      return ok(1);
    });
    expect(called).toBe(false);
    expect(r).toEqual(err("x"));
  });

  it("match, unwrapOr, unwrap", () => {
    expect(match(ok(2), { ok: (v) => `ok:${v}`, err: () => "err" })).toBe("ok:2");
    expect(match(err("e"), { ok: () => "ok", err: (x) => `err:${x}` })).toBe("err:e");
    expect(unwrapOr(err("e"), 7)).toBe(7);
    expect(unwrapOr(ok(1), 7)).toBe(1);
    expect(unwrap(ok("v"))).toBe("v");
    const nf = new NotFoundError();
    expect(() => unwrap(err(nf))).toThrowError(nf);
    expect(() => unwrap(err("chaîne"))).toThrowError(InternalError);
  });

  it("tryCatch convertit les exceptions en Err typée", async () => {
    expect(await tryCatch(() => 5)).toEqual(ok(5));
    expect(await tryCatch(async () => 6)).toEqual(ok(6));
    const r = await tryCatch(() => {
      throw new ForbiddenError();
    });
    expect(isErr(r) && r.error.kind === "forbidden").toBe(true);
    const r2 = await tryCatch(async () => {
      throw new Error("inconnue");
    });
    expect(isErr(r2) && r2.error.kind === "internal").toBe(true);
  });

  it("all agrège ou renvoie le premier échec", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err("a"), err("b")])).toEqual(err("a"));
    expect(all([])).toEqual(ok([]));
  });
});
