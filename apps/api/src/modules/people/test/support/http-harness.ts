/**
 * Banc d'essai HTTP : Fastify + `peoplePlugin` avec une authentification et une autorisation SIMULÉES qui reproduisent le
 * contrat du module rbac :
 *  - `request.ctx` est posé en amont (module iam en production) à partir des en-têtes de TEST `x-test-*` — le module ne lit
 *    JAMAIS d'en-tête client comme `x-user-id` (un test le vérifie) ;
 *  - les permissions d'un rôle viennent des VRAIS modèles de rôles système résolus contre le catalogue réel des manifestes
 *    (avec le modèle d'enseignant CIBLE demandé à rbac), la MFA étant exigée pour les permissions sensibles.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import { buildPermissionCatalog, rbacManifest, resolveSystemRoles, SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "../../../rbac";
import manifest from "../../manifest";
import { peoplePlugin } from "../../http/plugin";
import type { PeopleDeps } from "../../application/deps";

/** Modèles de rôles avec l'enseignant CIBLE : `student.class.read` et `staff.own.*` au lieu de `student.read` / `student.list`. */
export const TARGET_TEMPLATES: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES.map((t) =>
  t.key === "enseignant" ? { ...t, permissions: [...t.permissions.filter((p) => p !== "student.read" && p !== "student.list"), "student.class.read", "staff.own.*"] } : t,
);

const catalog = buildPermissionCatalog([rbacManifest, manifest]);
const resolved = new Map(resolveSystemRoles(catalog, TARGET_TEMPLATES).map((r) => [r.template.key, new Set(r.permissions)]));
/** Modèle d'enseignant ACTUEL d'rbac (student.read + student.list) : le garde-fou de people doit le restreindre à ses classes. */
// (le modèle système a depuis reçu `student.class.read` ; ce profil rejoue l'ANCIEN modèle pour garder le garde-fou testé)
resolved.set("enseignant_actuel", new Set([...(resolved.get("enseignant") ?? []).values()].filter((p) => p !== "student.class.read").concat(["student.read", "student.list"])));
const sensitive = new Set(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key));

export type TestRole = "secretariat" | "directeur" | "directeur_etudes" | "econome" | "enseignant" | "enseignant_actuel" | "educateur" | "parent" | "eleve" | "responsable_pedagogique" | "aucun";

export function permissionsOf(role: TestRole): ReadonlySet<string> {
  if (role === "aucun") return new Set();
  return resolved.get(role) ?? new Set();
}

export interface CallOptions {
  role?: TestRole;
  /** Identité (UUID de l'utilisateur IAM). */
  user?: string;
  tenant?: string;
  mfa?: boolean;
  /** Pas d'authentification du tout. */
  anonymous?: boolean;
  body?: unknown;
  rawBody?: Buffer | string;
  contentType?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface HttpHarness {
  app: FastifyInstance;
  call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, options?: CallOptions): Promise<{ status: number; json: any; text: string; headers: Record<string, unknown> }>;
  close(): Promise<void>;
}

export async function buildHarness(deps: PeopleDeps, defaults: { tenant: string }): Promise<HttpHarness> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-anonymous"] === "1") return;
    const tenant = req.headers["x-test-tenant"];
    const user = req.headers["x-test-user"];
    if (typeof tenant === "string") {
      (req as unknown as { ctx: unknown }).ctx = createRequestContext({
        tenantId: tenant,
        userId: typeof user === "string" && user !== "" ? user : newId(),
        roles: [String(req.headers["x-test-role"] ?? "")],
        mfa: req.headers["x-test-mfa"] === "1",
      });
    }
  });
  await app.register(peoplePlugin, {
    deps,
    requirePermission: (permission) => async (req) => {
      const ctx = (req as unknown as { ctx?: { mfa: boolean } }).ctx;
      if (!ctx) throw new UnauthorizedError();
      const role = String(req.headers["x-test-role"] ?? "aucun") as TestRole;
      if (!permissionsOf(role).has(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      if (sensitive.has(permission) && !ctx.mfa) throw new ForbiddenError("Authentification forte (MFA) requise pour cette action.", { code: "rbac.mfa_required", details: { permission } });
    },
  });
  await app.ready();

  return {
    app,
    async call(method, url, o = {}) {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      if (o.anonymous) headers["x-test-anonymous"] = "1";
      headers["x-test-tenant"] = o.tenant ?? defaults.tenant;
      headers["x-test-role"] = o.role ?? "secretariat";
      if (o.user) headers["x-test-user"] = o.user;
      if (o.mfa) headers["x-test-mfa"] = "1";
      let payload: string | Buffer | undefined;
      if (o.rawBody !== undefined) {
        payload = o.rawBody;
        headers["content-type"] = o.contentType ?? "application/octet-stream";
      } else if (o.body !== undefined) {
        payload = JSON.stringify(o.body);
        headers["content-type"] = "application/json";
      }
      const res = await app.inject({ method, url: `/${url.replace(/^\//, "")}`, headers, payload, query: o.query });
      let json: unknown;
      try {
        json = res.json();
      } catch {
        json = undefined;
      }
      return { status: res.statusCode, json, text: res.body, headers: res.headers };
    },
    close: () => app.close(),
  };
}
