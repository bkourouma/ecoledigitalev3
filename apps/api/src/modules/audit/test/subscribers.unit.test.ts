/**
 * Abonnés du module audit pour le worker : un par abonnement du module, noms stables, motifs traduits.
 */
import { describe, expect, it } from "vitest";
import subscribers, { subscriberNameOf, workerPatternOf } from "../subscribers";
import { AUDIT_EVENT_SUBSCRIPTIONS, resolveAuditHandler } from "../domain/events";
import { auditHmacFromEnv } from "../config";

describe("abonnés d'audit (apps/worker)", () => {
  it("un abonné par entrée de AUDIT_EVENT_SUBSCRIPTIONS, aux noms uniques et conformes à la regex du worker", () => {
    expect(subscribers).toHaveLength(AUDIT_EVENT_SUBSCRIPTIONS.length);
    const names = subscribers.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_.-]{0,62}$/);
  });

  it("le motif « préfixe » du module (tenancy.*) devient celui du worker (tenancy.**) ; un type exact reste exact", () => {
    expect(workerPatternOf("tenancy.*")).toBe("tenancy.**");
    expect(workerPatternOf("iam.login.failed")).toBe("iam.login.failed");
    expect(subscriberNameOf("tenancy.*")).toBe("audit.tenancy");
    expect(subscriberNameOf("iam.login.failed")).toBe("audit.iam-login-failed");
    expect(subscribers.find((s) => s.name === "audit.iam-mfa")?.pattern).toBe("iam.mfa.**");
  });

  it("les événements de sécurité d'iam sont journalisés (MFA, mot de passe, accès) ; les événements de finance ne le sont PAS (audit direct)", () => {
    for (const type of ["iam.mfa.enabled", "iam.mfa.disabled", "iam.mfa.reset", "iam.password.changed", "iam.membership.created", "iam.membership.changed"]) {
      expect(resolveAuditHandler(type), type).toBeDefined();
    }
    expect(resolveAuditHandler("finance.payment.completed")).toBeUndefined();
    expect(resolveAuditHandler("iam.user.logged_in")).toBeUndefined();
  });

  it("le contact du fondateur (donnée personnelle) n'entre PAS dans le journal immuable à la création d'un tenant", () => {
    const type = "tenancy.tenant.provisioned";
    const entry = resolveAuditHandler(type)!({
      id: "0192f0a4-7b1e-7c3a-8d2e-000000000002",
      type,
      version: 1,
      tenantId: "0192f0a4-7b1e-7c3a-8d2e-0000000000aa",
      occurredAt: "2026-10-01T10:00:00Z",
      payload: { v: 1, slug: "alpha", packs: ["HIGHER"], adminContact: { name: "Awa Koné", email: "awa@alpha.test", phone: "+225 07 00 00 00 00" } },
    });
    expect(entry?.metadata).toMatchObject({ slug: "alpha", packs: ["HIGHER"] });
    expect(JSON.stringify(entry)).not.toContain("awa@alpha.test");
    expect(JSON.stringify(entry)).not.toContain("+225");
  });

  it("une réinitialisation de MFA est un événement de sévérité « warning » ; l'activation, « notice »", () => {
    const entry = (type: string) =>
      resolveAuditHandler(type)!({ id: "0192f0a4-7b1e-7c3a-8d2e-000000000001", type, version: 1, tenantId: "0192f0a4-7b1e-7c3a-8d2e-0000000000aa", occurredAt: "2026-10-01T10:00:00Z", payload: { identityId: "x" } });
    expect(entry("iam.mfa.reset")?.severity).toBe("warning");
    expect(entry("iam.mfa.disabled")?.severity).toBe("warning");
    expect(entry("iam.mfa.enabled")?.severity).toBe("notice");
  });
});

describe("clé HMAC d'audit depuis l'environnement (partagée API / worker)", () => {
  it("sans clé : SHA-256 simple (null) ; avec clé : HMAC, identifiant par défaut k1", () => {
    expect(auditHmacFromEnv({})).toBeNull();
    expect(auditHmacFromEnv({ AUDIT_HMAC_KEY: "0123456789abcdef" })).toEqual({ activeKeyId: "k1", keys: { k1: "0123456789abcdef" } });
  });
  it("rotation : l'ancienne clé reste connue pour VÉRIFIER, sous un identifiant distinct", () => {
    const hmac = auditHmacFromEnv({ AUDIT_HMAC_KEY: "nouvelle-cle-0123456", AUDIT_HMAC_KEY_ID: "k2", AUDIT_HMAC_KEY_PREVIOUS: "ancienne-cle-0123456" });
    expect(hmac).toEqual({ activeKeyId: "k2", keys: { k2: "nouvelle-cle-0123456", k0: "ancienne-cle-0123456" } });
    expect(() => auditHmacFromEnv({ AUDIT_HMAC_KEY: "x".repeat(16), AUDIT_HMAC_KEY_ID: "k1", AUDIT_HMAC_KEY_PREVIOUS: "y".repeat(16), AUDIT_HMAC_KEY_PREVIOUS_ID: "k1" })).toThrow();
  });
});
