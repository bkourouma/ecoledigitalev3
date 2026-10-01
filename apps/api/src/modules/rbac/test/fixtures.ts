import { defineModule, type ModuleManifest } from "@ecoledigitale/kernel";
import rbacManifest from "../manifest";
import {
  activeScopeOf,
  buildPermissionSet,
  createAuthorizationContext,
  type AssignmentRecord,
  type AuthorizationContext,
  type PermissionSet,
} from "../index";
import { createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import type { ScopeTree } from "../domain/scope";
import { TENANT_SCOPE, type ScopeRef } from "../domain/scope";

export const T1 = "11111111-1111-4111-8111-111111111111";
export const T2 = "22222222-2222-4222-8222-222222222222";
export const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const INST_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
export const INST_B = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
export const CAMPUS_A1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
export const CAMPUS_A2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
export const CAMPUS_B1 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

/** Modules fictifs reproduisant les conventions de nommage attendues. */
export const assessManifest = defineModule({
  key: "assess",
  title: "Évaluations",
  packs: ["CORE"],
  permissions: [
    { key: "grade.read", label: "Consulter les notes" },
    { key: "grade.enter", label: "Saisir les notes" },
    { key: "grade.validate", label: "Valider les notes" },
    { key: "grade.publish", label: "Publier les notes", sensitive: true },
    { key: "grade.self.read", label: "Consulter ses notes" },
    { key: "grade.child.read", label: "Consulter les notes de ses enfants" },
    { key: "assessment.read", label: "Consulter les évaluations" },
    { key: "assessment.create", label: "Créer une évaluation" },
    { key: "assessment.update", label: "Modifier une évaluation" },
  ],
  features: [{ key: "assess.advanced-reports", label: "Rapports avancés", packs: ["HIGHER"] }],
  menus: [
    { key: "assess.grades", label: "Notes", href: "/teacher/notes", permission: "grade.enter", portal: "teacher", order: 10 },
    {
      key: "assess.reports",
      label: "Rapports de notes",
      href: "/admin/rapports-notes",
      permission: "grade.read",
      feature: "assess.advanced-reports",
      portal: "admin",
      order: 20,
    },
    { key: "assess.mygrades", label: "Mes notes", href: "/student/notes", permission: "grade.self.read", portal: "student" },
  ],
});

export const financeManifest = defineModule({
  key: "finance",
  title: "Finances",
  packs: ["CORE"],
  permissions: [
    { key: "finance.invoice.read", label: "Consulter les factures" },
    { key: "finance.invoice.create", label: "Créer une facture" },
    { key: "finance.payment.read", label: "Consulter les paiements" },
    { key: "finance.payment.create", label: "Encaisser un paiement", sensitive: true },
    { key: "finance.child.read", label: "Consulter la scolarité de ses enfants" },
    { key: "finance.settings.manage", label: "Configurer la finance", sensitive: true },
  ],
  menus: [
    { key: "finance.payments", label: "Paiements", href: "/admin/finances/paiements", permission: "finance.payment.read", portal: "admin", order: 30 },
  ],
});

export const studentManifest = defineModule({
  key: "students",
  title: "Élèves",
  packs: ["CORE"],
  permissions: [
    { key: "student.read", label: "Consulter un élève" },
    { key: "student.list", label: "Lister les élèves" },
    { key: "student.create", label: "Inscrire un élève" },
    { key: "student.update", label: "Modifier un élève" },
    { key: "portal.parent.access", label: "Accéder au portail parent" },
    { key: "portal.student.access", label: "Accéder au portail élève" },
  ],
  menus: [{ key: "students.list", label: "Élèves", href: "/admin/eleves", permission: "student.list", portal: "admin", order: 5 }],
});

export const tenantManifest = defineModule({
  key: "tenancy",
  title: "Organisation",
  packs: ["CORE"],
  permissions: [
    { key: "tenant.billing.manage", label: "Gérer l'abonnement", sensitive: true },
    { key: "tenant.close", label: "Clore l'organisation", sensitive: true },
  ],
});

export const ALL_MANIFESTS: readonly ModuleManifest[] = [rbacManifest, assessManifest, financeManifest, studentManifest, tenantManifest];

export function ctxFor(overrides: { tenantId?: string; userId?: string; mfa?: boolean; campusId?: string; institutionId?: string } = {}): RequestContext {
  return createRequestContext({
    tenantId: overrides.tenantId ?? T1,
    userId: overrides.userId ?? U1,
    mfa: overrides.mfa ?? false,
    ...(overrides.campusId ? { campusId: overrides.campusId } : {}),
    ...(overrides.institutionId ? { institutionId: overrides.institutionId } : {}),
  });
}

export const NOW = new Date("2026-10-01T12:00:00.000Z");

export interface GrantSpec {
  permissions: readonly string[];
  scope?: ScopeRef;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** Construit un contexte d'autorisation à partir de « rôles » décrits à plat. */
export function authFor(
  grants: readonly GrantSpec[],
  options: {
    mfa?: boolean;
    sensitive?: readonly string[];
    tree?: ScopeTree;
    /** Instant du chargement (les assignations déjà expirées à cet instant sont ignorées). */
    now?: Date;
    /** Instant d'évaluation, si différent du chargement (cache : le set vieillit). */
    evalNow?: Date;
    ctx?: RequestContext;
  } = {},
): AuthorizationContext {
  const ctx = options.ctx ?? ctxFor({ mfa: options.mfa ?? false });
  const assignments: AssignmentRecord[] = [];
  const rolePermissions = new Map<string, string[]>();
  grants.forEach((g, i) => {
    const roleId = `role-${i}`;
    rolePermissions.set(roleId, [...g.permissions]);
    assignments.push({
      assignmentId: `assignment-${i}`,
      roleId,
      scope: g.scope ?? TENANT_SCOPE,
      validFrom: g.validFrom ? new Date(g.validFrom) : null,
      validUntil: g.validUntil ? new Date(g.validUntil) : null,
    });
  });
  const permissionSet: PermissionSet = buildPermissionSet({
    tenantId: ctx.tenantId,
    userId: ctx.userId as string,
    assignments,
    rolePermissions,
    sensitive: options.sensitive ?? [],
    now: options.now ?? NOW,
  });
  return createAuthorizationContext({
    ctx,
    permissionSet,
    now: options.evalNow ?? options.now ?? NOW,
    ...(options.tree ? { tree: options.tree } : {}),
  });
}

export { activeScopeOf };
