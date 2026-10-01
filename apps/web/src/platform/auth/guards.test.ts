import { describe, expect, it, vi } from "vitest";
import { createGuards, FORBIDDEN_PATH, LOGIN_PATH, SELECT_ROLE_PATH, type GuardDeps } from "./guards";
import {
  canAccessAdminDashboard,
  canAccessOwnerPath,
  canAccessProfessionalAdminPath,
  hasAnyRole,
  hasPermission,
  matchesPermission,
  type SessionLike,
} from "./policies";

class Redirected extends Error {
  constructor(public readonly path: string) {
    super(`redirect:${path}`);
  }
}

function session(roles: string[], extra: Partial<SessionLike> = {}): SessionLike {
  return { user: { id: "u1" }, roles, activeRole: roles[0], ...extra };
}

function guards(current: SessionLike | null, overrides: Partial<GuardDeps> = {}) {
  return createGuards({
    getSession: async () => current,
    redirect: (path) => {
      throw new Redirected(path);
    },
    getPathname: () => "/x",
    fetchPermissions: async () => ["grade.read"],
    ...overrides,
  });
}

describe("policies — rôles", () => {
  it("accepte les alias historiques, sans tenir compte de la casse", () => {
    expect(hasAnyRole(session(["Administrateur"]), ["admin"])).toBe(true);
    expect(hasAnyRole(session(["SUPER_ADMIN"]), ["admin"])).toBe(true);
    expect(hasAnyRole(session(["Enseignant"]), ["teacher"])).toBe(true);
    expect(hasAnyRole(session(["Étudiant"]), ["student"])).toBe(true);
    expect(hasAnyRole(session(["student"]), ["admin", "owner"])).toBe(false);
    expect(hasAnyRole(session([]), ["admin"])).toBe(false);
    expect(hasAnyRole(null, ["admin"])).toBe(false);
  });

  it("jokers de permissions", () => {
    expect(matchesPermission("*", "a.b")).toBe(true);
    expect(matchesPermission("finance.*", "finance.payment.create")).toBe(true);
    expect(matchesPermission("finance.*", "financeX.read")).toBe(false);
    expect(matchesPermission("grade.read", "grade.read")).toBe(true);
    expect(matchesPermission("grade.read", "grade.enter")).toBe(false);
    expect(hasPermission(["a.b", "c.*"], "c.d")).toBe(true);
    expect(hasPermission([], "c.d")).toBe(false);
  });
});

describe("policies — espaces protégés", () => {
  it("/owner : propriétaire partout, administrateur seulement sur /owner/acces", () => {
    expect(canAccessOwnerPath(session(["owner"]), "/owner/dashboard")).toBe(true);
    expect(canAccessOwnerPath(session(["admin"]), "/owner/acces")).toBe(true);
    expect(canAccessOwnerPath(session(["admin"]), "/owner/acces/roles")).toBe(true);
    expect(canAccessOwnerPath(session(["admin"]), "/owner/dashboard")).toBe(false);
    expect(canAccessOwnerPath(session(["admin"]), "/owner/acces-secret")).toBe(false);
    expect(canAccessOwnerPath(session(["admin"]), null)).toBe(false);
    expect(canAccessOwnerPath(session(["teacher"]), "/owner/acces")).toBe(false);
  });

  it("/tableau-de-bord : administration seulement (pas le propriétaire)", () => {
    expect(canAccessAdminDashboard(session(["admin"]))).toBe(true);
    expect(canAccessAdminDashboard(session(["Administrateur"]))).toBe(true);
    expect(canAccessAdminDashboard(session(["owner"]))).toBe(false);
    expect(canAccessAdminDashboard(session(["student"]))).toBe(false);
  });

  it("/professionnel/admin : admin et owner ; l'enseignant uniquement sur les notes", () => {
    const admin = session(["admin"]);
    const owner = session(["owner"]);
    const teacher = session(["teacher"]);
    expect(canAccessProfessionalAdminPath(admin, "/professionnel/admin/ue")).toBe(true);
    expect(canAccessProfessionalAdminPath(owner, "/professionnel/admin/prospection")).toBe(true);
    expect(canAccessProfessionalAdminPath(teacher, "/professionnel/admin/notes")).toBe(true);
    expect(canAccessProfessionalAdminPath(teacher, "/professionnel/admin/notes/rattrapages")).toBe(true);
    expect(canAccessProfessionalAdminPath(teacher, "/professionnel/admin/notesx")).toBe(false);
    expect(canAccessProfessionalAdminPath(teacher, "/professionnel/admin/ue")).toBe(false);
    expect(canAccessProfessionalAdminPath(teacher, null)).toBe(false);
    expect(canAccessProfessionalAdminPath(session(["student"]), "/professionnel/admin/notes")).toBe(false);
  });
});

describe("requireSession", () => {
  it("renvoie la session si elle existe", async () => {
    const s = session(["admin"]);
    await expect(guards(s).requireSession()).resolves.toBe(s);
  });

  it("redirige vers /login sans session", async () => {
    await expect(guards(null).requireSession()).rejects.toMatchObject({ path: LOGIN_PATH });
  });

  it("ne force PAS /select-role par défaut (comportement des gardes client actuels)", async () => {
    const s = session(["owner", "admin"], { requiresRoleSelection: true });
    await expect(guards(s).requireSession()).resolves.toBe(s);
  });

  it("renvoie vers /select-role si requireRoleSelected", async () => {
    const s = session(["owner", "admin"], { requiresRoleSelection: true });
    await expect(guards(s).requireSession({ requireRoleSelected: true })).rejects.toMatchObject({ path: SELECT_ROLE_PATH });
  });
});

describe("requireRole / requireAccess", () => {
  it("passe si un des rôles correspond, sinon /unauthorized", async () => {
    await expect(guards(session(["owner"])).requireRole("admin", "owner")).resolves.toBeDefined();
    await expect(guards(session(["student"])).requireRole("admin", "owner")).rejects.toMatchObject({ path: FORBIDDEN_PATH });
  });

  it("sans session : /login (pas /unauthorized)", async () => {
    await expect(guards(null).requireRole("admin")).rejects.toMatchObject({ path: LOGIN_PATH });
  });

  it("requireAccess reçoit le chemin courant", async () => {
    const predicate = vi.fn(() => true);
    await guards(session(["admin"]), { getPathname: async () => "/owner/acces" }).requireAccess(predicate);
    expect(predicate).toHaveBeenCalledWith(expect.anything(), "/owner/acces");
  });

  it("requireAccess refuse quand le prédicat est faux", async () => {
    await expect(guards(session(["admin"])).requireAccess(() => false)).rejects.toMatchObject({ path: FORBIDDEN_PATH });
  });
});

describe("requirePermission", () => {
  it("accorde quand la permission est présente (joker compris)", async () => {
    await expect(guards(session(["teacher"])).requirePermission("grade.read")).resolves.toBeDefined();
    const g = guards(session(["teacher"]), { fetchPermissions: async () => ["grade.*"] });
    await expect(g.requirePermission("grade.enter")).resolves.toBeDefined();
  });

  it("refuse quand la permission manque", async () => {
    await expect(guards(session(["teacher"])).requirePermission("finance.payment.create")).rejects.toMatchObject({ path: FORBIDDEN_PATH });
  });

  it("fail-closed quand l'API RBAC est indisponible", async () => {
    const g = guards(session(["admin"]), { fetchPermissions: async () => null });
    await expect(g.requirePermission("grade.read")).rejects.toMatchObject({ path: FORBIDDEN_PATH });
    const boom = guards(session(["admin"]), {
      fetchPermissions: async () => {
        throw new Error("down");
      },
    });
    await expect(boom.requirePermission("grade.read")).rejects.toMatchObject({ path: FORBIDDEN_PATH });
  });

  it("repli explicite par rôles pendant la transition", async () => {
    const g = guards(session(["admin"]), { fetchPermissions: async () => null });
    await expect(g.requirePermission("grade.read", { fallbackRoles: ["admin"] })).resolves.toBeDefined();
    const other = guards(session(["student"]), { fetchPermissions: async () => null });
    await expect(other.requirePermission("grade.read", { fallbackRoles: ["admin"] })).rejects.toMatchObject({ path: FORBIDDEN_PATH });
  });
});
