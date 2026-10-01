import { describe, expect, it, vi } from "vitest";
import { createIamServerClient, clientHintsFromHeaders, IamApiError } from "./iam-server";
import { iamRoleForLegacy, sessionRolesFromIam } from "./iam-roles";
import { accessExpiresWithin, applyAuthenticated, handleUpdate, rotateRefresh, type IamSessionToken } from "./iam-token";
import { createIamCallbacks, createIamEvents, createIamProviders } from "./iam-next-auth";

const UUID = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;
const NOW = Date.parse("2026-10-01T10:00:00Z");

function authenticated(over: Record<string, unknown> = {}) {
  return {
    status: "authenticated",
    tokenType: "Bearer",
    accessToken: "access.jwt.one",
    expiresIn: 900,
    refreshToken: "rt1.tenant.secret-one",
    refreshExpiresIn: 1_209_600,
    sessionId: UUID(10),
    user: { id: UUID(1), email: "prof@ecole.test", tenantId: UUID(2), tenantSlug: "ecole", activeRole: "teacher", roles: ["teacher"], availableRoles: ["teacher", "parent"], requiresRoleSelection: true, mfaEnabled: false },
    tenants: [{ id: UUID(2), slug: "ecole", name: "École" }],
    ...over,
  };
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** Faux `fetch` : une file de réponses, et le journal des requêtes (jamais de mot de passe dans les assertions de journal). */
function fakeApi(responses: Array<{ status?: number; json?: unknown; headers?: Record<string, string>; throws?: boolean }>) {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    const next = queue.shift() ?? { status: 500, json: { code: "x" } };
    if (next.throws) throw new Error("ECONNREFUSED");
    const status = next.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(next.json ?? {}), { status, headers: next.headers });
  });
  const client = createIamServerClient({ baseUrl: "http://api.internal:4000/", fetch: fetchImpl as unknown as typeof fetch });
  return { client, calls, fetchImpl };
}

describe("rôles : IAM -> vocabulaire de l'interface", () => {
  it("clés legacy conservées ; modèles RBAC traduits seulement si complets", () => {
    expect(sessionRolesFromIam("teacher", ["teacher", "parent"])).toEqual({ activeRole: "teacher", roles: ["teacher"], availableRoles: ["teacher", "parent"], iamActiveRole: "teacher", iamRoles: ["teacher", "parent"] });
    expect(sessionRolesFromIam("enseignant", ["enseignant"])).toMatchObject({ activeRole: "teacher", availableRoles: ["teacher"], iamActiveRole: "enseignant" });
    expect(sessionRolesFromIam("directeur", ["directeur", "secretariat", "econome"])).toMatchObject({ activeRole: "admin", availableRoles: ["admin"] });
    // Modèle partiel : l'interface garde le rôle IAM tel quel (l'API refusera les routes legacy).
    expect(sessionRolesFromIam("directeur", ["directeur"])).toMatchObject({ activeRole: "directeur", availableRoles: ["directeur"] });
  });

  it("rôle IAM à demander pour un rôle d'interface", () => {
    expect(iamRoleForLegacy("parent", ["teacher", "parent"])).toBe("parent");
    expect(iamRoleForLegacy("teacher", ["enseignant", "parent"])).toBe("enseignant");
    expect(iamRoleForLegacy("admin", ["directeur", "secretariat", "econome"])).toBe("directeur");
    expect(iamRoleForLegacy("admin", ["directeur"])).toBeNull();
    expect(iamRoleForLegacy("owner", ["teacher"])).toBeNull();
  });
});

describe("client serveur iam", () => {
  it("relaie l'adresse du navigateur, utilise le transport « mobile » et valide la réponse", async () => {
    const { client, calls } = fakeApi([{ json: authenticated() }]);
    const out = await client.login({ email: "a@b.test", password: "x", tenantSlug: "ecole" }, { ip: "203.0.113.9", userAgent: "UA/1" });
    expect(out.status).toBe("authenticated");
    expect(calls[0]).toMatchObject({ url: "http://api.internal:4000/api/v1/iam/login", method: "POST" });
    expect(calls[0]?.body).toMatchObject({ email: "a@b.test", tenantSlug: "ecole", client: "mobile" });
    expect(calls[0]?.headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(calls[0]?.headers["User-Agent"]).toBe("UA/1");
  });

  it("erreurs : code stable, Retry-After, réponse invalide, panne réseau, jamais de corps brut dans le message", async () => {
    const wrong = fakeApi([{ status: 401, json: { code: "iam.invalid_credentials", message: "Identifiants invalides." } }]);
    await expect(wrong.client.login({ email: "a@b.test", password: "x" })).rejects.toMatchObject({ status: 401, code: "iam.invalid_credentials" });

    const limited = fakeApi([{ status: 429, json: { code: "iam.too_many_attempts" }, headers: { "retry-after": "42" } }]);
    await expect(limited.client.login({ email: "a@b.test", password: "x" })).rejects.toMatchObject({ status: 429, retryAfterSec: 42 });

    const bad = fakeApi([{ json: { status: "authenticated" } }]);
    await expect(bad.client.login({ email: "a@b.test", password: "x" })).rejects.toMatchObject({ status: 502, code: "iam.response_invalid" });

    const down = fakeApi([{ throws: true }]);
    await expect(down.client.login({ email: "a@b.test", password: "x" })).rejects.toMatchObject({ status: 0, code: "iam.unreachable" });
  });

  it("logout : jeton d'accès en en-tête, refresh dans le corps, 204 accepté", async () => {
    const { client, calls } = fakeApi([{ status: 204 }]);
    await client.logout({ accessToken: "acc", refreshToken: "rt1.t.s" });
    expect(calls[0]?.headers.Authorization).toBe("Bearer acc");
    expect(calls[0]?.body).toEqual({ refreshToken: "rt1.t.s" });
  });

  it("adresse client : premier élément de x-forwarded-for", () => {
    expect(clientHintsFromHeaders({ "x-forwarded-for": "198.51.100.4, 10.0.0.1", "user-agent": "UA" })).toEqual({ ip: "198.51.100.4", userAgent: "UA" });
    expect(clientHintsFromHeaders(undefined)).toEqual({ ip: null, userAgent: null });
  });
});

describe("état IAM du JWT NextAuth", () => {
  const deps = (client: ReturnType<typeof fakeApi>["client"]) => ({ client, now: () => NOW });

  it("applyAuthenticated : mêmes champs que le jeton legacy (jwtToken, jwtExpiresAt, roles, tenant) + état IAM", () => {
    const t = applyAuthenticated({}, authenticated() as never, NOW);
    expect(t).toMatchObject({
      userId: UUID(1), tenantSlug: "ecole", activeRole: "teacher", roles: ["teacher"], availableRoles: ["teacher", "parent"], requiresRoleSelection: true,
      jwtToken: "access.jwt.one", iamRefreshToken: "rt1.tenant.secret-one", iamSessionId: UUID(10), mfaEnabled: false,
    });
    expect(t.jwtExpiresAt).toBe(new Date(NOW + 900_000).toISOString());
  });

  it("rotation : met à jour accès ET refresh ; une seule requête pour deux appels simultanés (single-flight)", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const { client, fetchImpl } = fakeApi([{ json: { status: "refreshed", tokenType: "Bearer", accessToken: "access.jwt.two", expiresIn: 900, sessionId: UUID(10), refreshToken: "rt1.tenant.secret-two", refreshExpiresIn: 1000 } }]);
    const [a, b] = await Promise.all([rotateRefresh(base, deps(client)), rotateRefresh(base, deps(client))]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.jwtToken).toBe("access.jwt.two");
    expect(a.iamRefreshToken).toBe("rt1.tenant.secret-two");
    expect(b).toEqual(a);
  });

  it("refresh refusé (réutilisation, révocation) : la session web n'a plus de support, jetons effacés", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const { client } = fakeApi([{ status: 401, json: { code: "iam.refresh_invalid" } }]);
    const dead = await rotateRefresh(base, deps(client));
    expect(dead.iamExpired).toBe(true);
    expect(dead.jwtToken).toBeUndefined();
    expect(dead.iamRefreshToken).toBeUndefined();
  });

  it("panne passagère (5xx, réseau) : l'état est conservé, aucune déconnexion", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    for (const response of [{ status: 503, json: {} }, { throws: true }]) {
      const { client } = fakeApi([response]);
      const kept = await rotateRefresh(base, deps(client));
      expect(kept.iamExpired).toBeUndefined();
      expect(kept.jwtToken).toBe("access.jwt.one");
      expect(kept.iamRefreshToken).toBe("rt1.tenant.secret-one");
      expect(kept.iamError?.action).toBe("refresh");
    }
  });

  it("update : seules les actions connues sont prises en compte ; les champs envoyés par le navigateur sont IGNORÉS", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const { client, fetchImpl } = fakeApi([]);
    const forged = await handleUpdate(base, { jwtToken: "evil", activeRole: "owner", roles: ["owner"], iamRefreshToken: "evil" }, deps(client));
    expect(forged).toEqual(base);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Rôle non attribué : refus local, aucun appel.
    const denied = await handleUpdate(base, { action: "switch-role", activeRole: "owner" }, deps(client));
    expect(denied.iamError).toMatchObject({ action: "switch-role", code: "iam.forbidden" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("switch-role : demande le rôle IAM correspondant et remplace les jetons ; MFA requise -> étape en attente", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const next = authenticated({ accessToken: "access.jwt.parent", refreshToken: "rt1.tenant.parent", sessionId: UUID(11), user: { ...authenticated().user, activeRole: "parent", requiresRoleSelection: true } });
    const api = fakeApi([{ json: next }]);
    const out = await handleUpdate(base, { action: "switch-role", activeRole: "parent" }, deps(api.client));
    expect(api.calls[0]?.url).toMatch(/\/switch-role$/);
    expect(api.calls[0]?.headers.Authorization).toBe("Bearer access.jwt.one");
    expect(api.calls[0]?.body).toMatchObject({ activeRole: "parent", client: "mobile" });
    expect(out).toMatchObject({ activeRole: "parent", jwtToken: "access.jwt.parent", iamRefreshToken: "rt1.tenant.parent" });

    const pending = fakeApi([{ json: { status: "mfa_required", challengeToken: "step.token.value", expiresIn: 300, methods: ["totp"] } }]);
    const switched = await handleUpdate(base, { action: "switch-tenant", tenantId: UUID(3) }, deps(pending.client));
    expect(switched.iamPending).toEqual({ kind: "mfa_required", token: "step.token.value" });
    expect(switched.jwtToken).toBe("access.jwt.one"); // la session courante n'est pas touchée avant le défi
  });

  it("changement de mot de passe : erreurs transmises par code, jamais de mot de passe dans l'état", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const api = fakeApi([{ status: 400, json: { code: "iam.password_policy" } }]);
    const out = await handleUpdate(base, { action: "change-password", currentPassword: "ancien-secret", newPassword: "court" }, deps(api.client));
    expect(out.iamError).toMatchObject({ action: "change-password", code: "iam.password_policy" });
    expect(JSON.stringify(out)).not.toContain("ancien-secret");
    expect(JSON.stringify(out)).not.toContain("court");
  });

  it("disable-mfa : exactement un second facteur (code OU code de secours)", async () => {
    const base = applyAuthenticated({}, authenticated() as never, NOW);
    const none = await handleUpdate(base, { action: "disable-mfa", password: "p" }, deps(fakeApi([]).client));
    expect(none.iamError?.code).toBe("iam.bad_request");
    const both = await handleUpdate(base, { action: "disable-mfa", password: "p", code: "123456", recoveryCode: "abcd-efgh-ijkl" }, deps(fakeApi([]).client));
    expect(both.iamError?.code).toBe("iam.bad_request");
    const ok = fakeApi([{ json: authenticated({ accessToken: "access.jwt.after", user: { ...authenticated().user, mfaEnabled: false } }) }]);
    const done = await handleUpdate(base, { action: "disable-mfa", password: "p", code: "123456" }, deps(ok.client));
    expect(done).toMatchObject({ jwtToken: "access.jwt.after", mfaEnabled: false });
  });

  it("codes de secours : montrés une fois puis effacés ; refresh sans effet pour un jeton legacy (Google transitoire)", async () => {
    const withCodes: IamSessionToken = { ...applyAuthenticated({}, authenticated() as never, NOW), recoveryCodes: ["aaaa-bbbb-cccc"] };
    expect((await handleUpdate(withCodes, { action: "ack-recovery-codes" }, deps(fakeApi([]).client))).recoveryCodes).toBeUndefined();
    const legacy: IamSessionToken = { jwtToken: "legacy.jwt", legacyToken: true };
    const api = fakeApi([]);
    expect(await handleUpdate(legacy, { action: "refresh" }, deps(api.client))).toEqual(legacy);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("échéance du jeton d'accès", () => {
    const t = applyAuthenticated({}, authenticated() as never, NOW);
    expect(accessExpiresWithin(t, 120, NOW)).toBe(false);
    expect(accessExpiresWithin(t, 120, NOW + 800_000)).toBe(true);
    expect(accessExpiresWithin({}, 120, NOW)).toBe(true);
  });
});

describe("NextAuth V2 : fournisseurs, callbacks, événements", () => {
  function providers(responses: Parameters<typeof fakeApi>[0]) {
    const api = fakeApi(responses);
    // NextAuth fusionne `options` sur le fournisseur au démarrage : l'identifiant utile est `options.id`.
    const list = createIamProviders(() => api.client, () => NOW) as unknown as Array<{ options: { id: string; authorize(c: Record<string, string>, req: unknown): Promise<any> } }>;
    const by = (id: string) => list.find((p) => p.options.id === id)!.options.authorize;
    return { api, by };
  }
  const req = { headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "Navigateur" } };

  it("identifiants valides sans MFA : l'utilisateur porte l'état IAM", async () => {
    const { api, by } = providers([{ json: authenticated() }]);
    const user = await by("credentials")({ email: " Prof@Ecole.test ", password: "mdp" }, req);
    expect(user.iamToken).toMatchObject({ tenantSlug: "ecole", jwtToken: "access.jwt.one", iamRefreshToken: "rt1.tenant.secret-one" });
    expect(api.calls[0]?.body).toMatchObject({ email: "prof@ecole.test" }); // e-mail normalisé
    expect(api.calls[0]?.headers["X-Forwarded-For"]).toBe("203.0.113.5");
  });

  it("étapes MFA : le jeton d'étape est transmis dans l'erreur ; aucune session partielle", async () => {
    const challenge = providers([{ json: { status: "mfa_required", challengeToken: "challenge.token.value", expiresIn: 300, methods: ["totp"] } }]);
    await expect(challenge.by("credentials")({ email: "a@b.test", password: "x" }, req)).rejects.toThrow("MFA_REQUIRED:challenge.token.value");
    const enroll = providers([{ json: { status: "mfa_enrollment_required", enrollmentToken: "enroll.token.value", expiresIn: 600 } }]);
    await expect(enroll.by("credentials")({ email: "a@b.test", password: "x" }, req)).rejects.toThrow("MFA_ENROLLMENT_REQUIRED:enroll.token.value");
  });

  it("anti-énumération : identifiants invalides = null (même réponse), verrouillage = délai, indisponible = erreur dédiée", async () => {
    expect(await providers([{ status: 401, json: { code: "iam.invalid_credentials" } }]).by("credentials")({ email: "a@b.test", password: "x" }, req)).toBeNull();
    expect(await providers([{ status: 403, json: { code: "iam.forbidden" } }]).by("credentials")({ email: "a@b.test", password: "x" }, req)).toBeNull();
    await expect(providers([{ status: 429, json: { code: "iam.too_many_attempts" }, headers: { "retry-after": "30" } }]).by("credentials")({ email: "a@b.test", password: "x" }, req)).rejects.toThrow("RATE_LIMITED:30");
    await expect(providers([{ status: 403, json: { code: "iam.no_active_access" } }]).by("credentials")({ email: "a@b.test", password: "x" }, req)).rejects.toThrow("NO_ACCESS");
    await expect(providers([{ throws: true }]).by("credentials")({ email: "a@b.test", password: "x" }, req)).rejects.toThrow("UNREACHABLE");
    // Champs manquants ou démesurés : refus sans appel réseau.
    const none = providers([]);
    expect(await none.by("credentials")({ email: "", password: "x" }, req)).toBeNull();
    expect(await none.by("credentials")({ email: "a@b.test", password: "x".repeat(300) }, req)).toBeNull();
    expect(none.api.fetchImpl).not.toHaveBeenCalled();
  });

  it("défi MFA : exactement un code (TOTP ou secours) ; enrôlement : l'utilisateur reçoit les codes de secours UNE fois", async () => {
    const chal = providers([{ json: authenticated() }]);
    expect(await chal.by("iam-mfa")({ challengeToken: "challenge.token.value", code: "123456", recoveryCode: "abcd-efgh-ijkl" }, req)).toBeNull();
    expect(chal.api.fetchImpl).not.toHaveBeenCalled();
    expect((await chal.by("iam-mfa")({ challengeToken: "challenge.token.value", code: "123456" }, req)).iamToken.jwtToken).toBe("access.jwt.one");

    const enr = providers([{ json: { recoveryCodes: ["aaaa-bbbb-cccc", "dddd-eeee-ffff"], session: authenticated() } }]);
    const user = await enr.by("iam-enroll")({ enrollmentToken: "enroll.token.value", code: "654321" }, req);
    expect(user.iamToken.recoveryCodes).toEqual(["aaaa-bbbb-cccc", "dddd-eeee-ffff"]);
    expect(enr.api.calls[0]?.headers.Authorization).toBe("Bearer enroll.token.value");
  });

  it("callback session : expose l'accès et les rôles, JAMAIS le refresh token", async () => {
    const callbacks = createIamCallbacks(() => fakeApi([]).client, () => NOW);
    const issued = applyAuthenticated({}, authenticated() as never, NOW);
    const token = (await callbacks.jwt!({ token: {}, user: { id: UUID(1), iamToken: issued } as never } as never)) as Record<string, unknown>;
    expect(token.iamRefreshToken).toBe("rt1.tenant.secret-one");
    const session = (await callbacks.session!({ session: { user: {}, expires: "" }, token } as never)) as unknown as Record<string, unknown>;
    expect(session.jwtToken).toBe("access.jwt.one");
    expect(session.activeRole).toBe("teacher");
    expect(session.authVersion).toBe(2);
    expect(JSON.stringify(session)).not.toContain("rt1.tenant.secret-one");
    expect(JSON.stringify(session)).not.toContain("iamRefreshToken");
  });

  it("callback jwt : la rotation n'a lieu que sur trigger=update (jamais lors d'un simple rendu serveur)", async () => {
    const api = fakeApi([{ json: { status: "refreshed", tokenType: "Bearer", accessToken: "access.jwt.two", expiresIn: 900, sessionId: UUID(10), refreshToken: "rt1.tenant.secret-two", refreshExpiresIn: 1000 } }]);
    const callbacks = createIamCallbacks(() => api.client, () => NOW);
    const issued = { ...applyAuthenticated({}, authenticated() as never, NOW - 880_000) }; // proche de l'expiration
    const plain = await callbacks.jwt!({ token: issued, session: undefined } as never);
    expect((plain as IamSessionToken).jwtToken).toBe("access.jwt.one");
    expect(api.fetchImpl).not.toHaveBeenCalled();
    const updated = await callbacks.jwt!({ token: issued, trigger: "update", session: { action: "refresh" } } as never);
    expect((updated as IamSessionToken).jwtToken).toBe("access.jwt.two");
    expect(api.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("déconnexion : la session IAM est révoquée côté serveur (accès + refresh), erreurs absorbées", async () => {
    const api = fakeApi([{ status: 204 }]);
    const events = createIamEvents(() => api.client);
    await events.signOut!({ token: applyAuthenticated({}, authenticated() as never, NOW) } as never);
    expect(api.calls[0]).toMatchObject({ url: expect.stringMatching(/\/logout$/) });
    expect(api.calls[0]?.headers.Authorization).toBe("Bearer access.jwt.one");
    expect(api.calls[0]?.body).toEqual({ refreshToken: "rt1.tenant.secret-one" });
    const down = fakeApi([{ throws: true }]);
    await expect(createIamEvents(() => down.client).signOut!({ token: applyAuthenticated({}, authenticated() as never, NOW) } as never)).resolves.toBeUndefined();
    const empty = fakeApi([]);
    await createIamEvents(() => empty.client).signOut!({ token: {} } as never);
    expect(empty.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("IamApiError", () => {
  it("expose statut, code et délai", () => {
    const e = new IamApiError({ status: 429, code: "iam.too_many_attempts", retryAfterSec: 5 });
    expect(e).toMatchObject({ status: 429, code: "iam.too_many_attempts", retryAfterSec: 5 });
  });
});
