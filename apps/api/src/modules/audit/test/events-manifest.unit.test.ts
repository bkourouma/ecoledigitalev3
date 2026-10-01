import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDomainEvent, createRequestContext, resolveModuleOrder, type DomainEvent } from "@ecoledigitale/kernel";
import { loadMigrations } from "@ecoledigitale/database";
import {
  AUDIT_CONSUMED_EVENTS,
  AUDIT_EVENT_SUBSCRIPTIONS,
  genericEventHandler,
  patternMatches,
  resolveAuditHandler,
  tenantOf,
} from "../domain/events";
import manifest from "../manifest";
import { csvCell, decodeCursor, encodeCursor, toCsv } from "../application/queries";
import { auditIsolationAllowlist } from "../../isolation-allowlist.audit";

const here = dirname(fileURLToPath(import.meta.url));
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const ctx = createRequestContext({ tenantId: TENANT, userId: USER, requestId: "req-42" });

const evt = (type: string, payload: unknown, over: Partial<DomainEvent> = {}): DomainEvent => ({
  ...createDomainEvent({ type, payload, ctx, id: "44444444-4444-4444-8444-444444444444" }),
  ...over,
});

describe("handlers d'événements (fonctions pures)", () => {
  it("sont déterministes : même événement, même entrée", () => {
    const e = evt("rbac.role.changed", { roleId: "r1", before: { perms: ["a"] }, after: { perms: ["a", "b"] } });
    const h = resolveAuditHandler(e.type);
    expect(h).toBeDefined();
    expect(h!(e)).toEqual(h!(e));
  });

  it("reprennent id, instant et tenant de l'événement (idempotence par clé primaire)", () => {
    const e = evt("rbac.role.changed", { roleId: "r1" });
    const entry = resolveAuditHandler(e.type)!(e)!;
    expect(entry.id).toBe(e.id);
    expect(entry.occurredAt).toBe(e.occurredAt);
    expect(entry.tenantId).toBe(TENANT);
    expect(entry.idempotent).toBe(true);
  });

  it("iam.impersonation.started : critique, acteur superAdmin, cible en entité", () => {
    const e = evt("iam.impersonation.started", { superAdminId: ADMIN, targetUserId: USER, reason: "support #123", ip: "1.2.3.4", userAgent: "curl/8" });
    const entry = resolveAuditHandler(e.type)!(e)!;
    expect(entry).toMatchObject({
      action: "impersonation.started",
      entity: "user",
      entityId: USER,
      severity: "critical",
      reason: "support #123",
      actor: { type: "superAdmin", id: ADMIN },
      request: { ip: "1.2.3.4", userAgent: "curl/8", requestId: "req-42" },
    });
  });

  it("iam.login.failed : l'auteur n'est jamais « user » ; verrouillage = warning", () => {
    const failed = resolveAuditHandler("iam.login.failed")!(evt("iam.login.failed", { email: "x@y.ci", cause: "bad_password", attempts: 3 }))!;
    expect(failed.actor).toEqual({ type: "system", id: null });
    expect(failed.severity).toBe("notice");
    expect(failed.metadata).toMatchObject({ identifier: "x@y.ci", cause: "bad_password", attempts: 3, locked: false });
    const locked = resolveAuditHandler("iam.login.failed")!(evt("iam.login.failed", { email: "x@y.ci", locked: true }))!;
    expect(locked.severity).toBe("warning");
  });

  it("iam.* sans tenant exploitable -> tenantId null (journal de plateforme)", () => {
    for (const tenantId of ["", "00000000-0000-0000-0000-000000000000", "pas-un-uuid"]) {
      const e = evt("iam.login.failed", { email: "x@y.ci" }, { tenantId });
      expect(tenantOf(e)).toBeNull();
      expect(resolveAuditHandler(e.type)!(e)!.tenantId).toBeNull();
    }
    // Le tenant peut aussi venir du payload.
    const fromPayload = evt("iam.login.failed", { tenantId: TENANT }, { tenantId: "" });
    expect(tenantOf(fromPayload)).toBe(TENANT);
  });

  it("iam.session.revoked : réutilisation de jeton = warning", () => {
    const e = evt("iam.session.revoked", { sessionId: "s1", userId: USER, cause: "refresh_reuse_detected" });
    const entry = resolveAuditHandler(e.type)!(e)!;
    expect(entry).toMatchObject({ action: "session.revoked", entity: "session", entityId: "s1", severity: "warning" });
  });

  it("rbac.* : avant/après transmis (le diff est calculé par record)", () => {
    const e = evt("rbac.assignment.changed", { assignmentId: "a1", userId: USER, roleId: "teacher", before: null, after: { role: "teacher" } });
    const entry = resolveAuditHandler(e.type)!(e)!;
    expect(entry).toMatchObject({ action: "assignment.changed", entity: "role_assignment", entityId: "a1", after: { role: "teacher" } });
    expect(entry.actor).toEqual({ type: "user", id: USER });
  });

  it("tenancy.* / entitlements.* : action entité.verbe dérivée du type", () => {
    const suspended = genericEventHandler(evt("tenancy.tenant.suspended", { tenantId: TENANT, reason: "impayé" }))!;
    expect(suspended).toMatchObject({ action: "tenant.suspended", entity: "tenant", severity: "warning", reason: "impayé" });
    const override = genericEventHandler(evt("entitlements.override.granted", { overrideId: "o1" }))!;
    expect(override).toMatchObject({ action: "override.granted", entity: "override", entityId: "o1" });
    const short = genericEventHandler(evt("tenancy.provisioned", {}))!;
    expect(short).toMatchObject({ action: "tenancy.provisioned", entity: "tenancy" });
  });

  it("charges inattendues : jamais d'exception", () => {
    for (const payload of [null, undefined, "texte", 42, [], { before: 1n }]) {
      for (const sub of AUDIT_EVENT_SUBSCRIPTIONS) {
        const type = sub.pattern.endsWith(".*") ? `${sub.pattern.slice(0, -1)}thing.happened` : sub.pattern;
        expect(() => sub.handle(evt(type, payload as never))).not.toThrow();
      }
    }
  });

  it("types non abonnés : aucun handler", () => {
    expect(resolveAuditHandler("finance.payment.completed")).toBeUndefined();
    expect(patternMatches("tenancy.*", "tenancyx.y")).toBe(false);
    expect(patternMatches("tenancy.*", "tenancy.tenant.created")).toBe(true);
  });
});

describe("manifeste", () => {
  it("est valide et déclare les permissions attendues", () => {
    expect(manifest.key).toBe("audit");
    expect(manifest.packs).toEqual(["CORE"]);
    const perms = Object.fromEntries(manifest.permissions.map((p) => [p.key, p]));
    expect(perms["audit.read"]).toBeDefined();
    expect(perms["audit.export"]?.sensitive).toBe(true);
    expect(perms["audit.read"]?.sensitive).toBeFalsy();
    expect(manifest.events.consumes).toEqual([...AUDIT_CONSUMED_EVENTS]);
    expect(manifest.events.consumes).toEqual(
      expect.arrayContaining(["iam.impersonation.started", "iam.login.failed", "iam.session.revoked", "rbac.role.changed", "rbac.assignment.changed", "tenancy.*", "entitlements.*"]),
    );
    expect(resolveModuleOrder([manifest]).map((m) => m.key)).toEqual(["audit"]);
  });
});

describe("migrations", () => {
  it("se chargent avec la baseline sans collision de version (plage 0300-0399)", () => {
    const baseline = resolve(here, "../../../../../../packages/database/migrations");
    const files = loadMigrations([baseline, resolve(here, "../migrations")]);
    const audit = files.filter((f) => Number(f.version) >= 300 && Number(f.version) < 400);
    expect(audit.map((f) => f.filename)).toEqual(["0300_audit_log.sql", "0301_audit_retention.sql"]);
    expect(files.map((f) => f.version)).toEqual([...files.map((f) => f.version)].sort((a, b) => Number(a) - Number(b)));
  });
});

describe("allowlist d'isolation", () => {
  it("ne contient que les tables globales du journal de plateforme", () => {
    expect([...auditIsolationAllowlist].sort()).toEqual(["audit.platform_audit_log", "audit.platform_chain_head"]);
  });
});

describe("curseur et CSV", () => {
  it("curseur aller-retour ; curseur forgé refusé", () => {
    expect(decodeCursor(encodeCursor(1234))).toBe(1234);
    for (const bad of ["xx", Buffer.from('{"s":-1}').toString("base64url"), Buffer.from('{"s":"1; DROP"}').toString("base64url")]) {
      expect(() => decodeCursor(bad)).toThrow(/Curseur/);
    }
  });

  it("neutralise l'injection de formule et échappe guillemets / virgules / sauts de ligne", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(12)).toBe("12");
  });

  it("toCsv : BOM, en-têtes, CRLF", () => {
    const csv = toCsv([]);
    expect(csv.startsWith("﻿seq,id,occurred_at")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
