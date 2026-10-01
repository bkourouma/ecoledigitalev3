// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RbacPermissionEntry } from "@ecoledigitale/contracts/v2/rbac";
import { apiError, json, noContent, renderScreen, routes, type RecordedCall } from "@/platform/admin/test-utils";
import { AssignmentsPage } from "./AssignmentsPage";
import { RoleCreatePage } from "./RoleCreatePage";
import { RoleDetailPage } from "./RoleDetailPage";
import { RolesPage } from "./RolesPage";
import {
  buildScope,
  EMPTY_ASSIGNMENT_FORM,
  shortId,
  toCreateBody,
  toLocalInput,
  validateAssignmentForm,
  validityStatus,
} from "./assignments";
import { diffPermissions, groupPermissions, groupState, sameSet, toggleGroup, togglePermission } from "./matrix";

const h = vi.hoisted(() => {
  const push = vi.fn();
  return { fetchMock: vi.fn(), push, router: { push, replace: vi.fn() } };
});
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/access/roles", useRouter: () => h.router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = U(900);
const ME = U(901);
const NOW = "2026-10-01T10:00:00.000Z";

const entry = (key: string, over: Partial<RbacPermissionEntry> = {}): RbacPermissionEntry => ({
  key,
  label: `Libellé ${key}`,
  description: null,
  sensitive: false,
  moduleKey: key.split(".")[0]!,
  moduleTitle: null,
  ...over,
});

const CATALOG: RbacPermissionEntry[] = [
  entry("finance.payment.read", { moduleTitle: "Finance", label: "Consulter les paiements" }),
  entry("finance.payment.create", { moduleTitle: "Finance", label: "Encaisser un paiement", sensitive: true }),
  entry("audit.read", { moduleTitle: "Audit", label: "Lire le journal d'audit" }),
  entry("rbac.role.manage", { moduleTitle: "Rôles et accès", label: "Gérer les rôles", sensitive: true }),
];

function roleSummary(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    key: "directeur",
    label: "Directeur",
    description: null,
    isSystem: false,
    locked: false,
    templateKey: null,
    clonedFromRoleId: null,
    permissionCount: 2,
    pendingCount: 0,
    assignmentCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function roleDetail(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    key: "econome_adjoint",
    label: "Économe adjoint",
    description: "Suivi des encaissements",
    isSystem: false,
    locked: false,
    templateKey: null,
    clonedFromRoleId: null,
    assignmentCount: 0,
    permissions: ["finance.payment.read"],
    pendingPermissions: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const myPermissions = (keys: string[], extra: Record<string, unknown> = {}) =>
  json({
    tenantId: TENANT,
    userId: ME,
    mfa: true,
    permissions: keys.map((key) => ({ key, sensitive: false, scopes: [{ type: "tenant" }] })),
    requiresMfa: [],
    ...extra,
  });

const ALL_KEYS = ["rbac.role.read", "rbac.role.manage", "rbac.assignment.manage", "iam.user.read", ...CATALOG.map((e) => e.key)];

describe("matrice (fonctions pures)", () => {
  it("regroupe par module, trie, et filtre sans tenir compte des accents ni de la casse", () => {
    const groups = groupPermissions(CATALOG);
    expect(groups.map((g) => g.title)).toEqual(["Audit", "Finance", "Rôles et accès"]);
    expect(groups[1]!.entries.map((e) => e.key)).toEqual(["finance.payment.create", "finance.payment.read"]);
    expect(groupPermissions(CATALOG, "ENCAISSER").flatMap((g) => g.entries.map((e) => e.key))).toEqual(["finance.payment.create"]);
    expect(groupPermissions(CATALOG, "roles").map((g) => g.moduleKey)).toEqual(["rbac"]);
    expect(groupPermissions(CATALOG, "zzz")).toEqual([]);
  });

  it("module sans titre : repli sur sa clé", () => {
    expect(groupPermissions([entry("x.y.z")])[0]!.title).toBe("x");
  });

  it("état de groupe, bascule d'une permission et d'un groupe (seulement les accordables)", () => {
    const finance = groupPermissions(CATALOG).find((g) => g.moduleKey === "finance")!;
    expect(groupState(finance, new Set())).toBe("none");
    expect(groupState(finance, new Set(["finance.payment.read"]))).toBe("some");
    expect(groupState(finance, new Set(["finance.payment.read", "finance.payment.create"]))).toBe("all");

    const selected = togglePermission(new Set(), "audit.read", true);
    expect([...selected]).toEqual(["audit.read"]);
    expect(togglePermission(selected, "audit.read", false).size).toBe(0);

    const grantable = (k: string) => k !== "finance.payment.create";
    expect([...toggleGroup(new Set(), finance, true, grantable)]).toEqual(["finance.payment.read"]);
    expect(toggleGroup(new Set(["finance.payment.read", "finance.payment.create"]), finance, false, grantable).size).toBe(0);
  });

  it("différences entre deux ensembles", () => {
    expect(diffPermissions(["a.b", "c.d"], ["c.d", "e.f"])).toEqual({ added: ["e.f"], removed: ["a.b"] });
    expect(sameSet(new Set(["a"]), new Set(["a"]))).toBe(true);
    expect(sameSet(new Set(["a"]), new Set(["b"]))).toBe(false);
  });
});

describe("attributions (fonctions pures)", () => {
  it("statut de validité : actif, à venir, expiré (fin exclusive)", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    expect(validityStatus({ validFrom: null, validUntil: null }, now)).toBe("active");
    expect(validityStatus({ validFrom: "2026-10-02T00:00:00Z", validUntil: null }, now)).toBe("upcoming");
    expect(validityStatus({ validFrom: null, validUntil: "2026-10-01T10:00:00Z" }, now)).toBe("expired");
    expect(validityStatus({ validFrom: "2026-09-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z" }, now)).toBe("active");
  });

  it("périmètre et corps de création", () => {
    expect(buildScope("tenant", "", "")).toEqual({ type: "tenant" });
    expect(buildScope("institution", U(1), "")).toEqual({ type: "institution", id: U(1) });
    expect(buildScope("campus", U(1), U(2))).toEqual({ type: "campus", id: U(2) });
    expect(buildScope("campus", U(1), "")).toBeNull();
    const body = toCreateBody({ ...EMPTY_ASSIGNMENT_FORM, userId: ` ${U(5)} `, roleId: U(6), scopeType: "campus", institutionId: U(1), campusId: U(2), validUntil: "2026-12-31T00:00" });
    expect(body).toMatchObject({ userId: U(5), roleId: U(6), scope: { type: "campus", id: U(2) } });
    expect(body?.validUntil).toBe(new Date("2026-12-31T00:00").toISOString());
    expect(body && "validFrom" in body).toBe(false);
    expect(toCreateBody(EMPTY_ASSIGNMENT_FORM)).toBeNull();
  });

  it("validation du formulaire", () => {
    expect(validateAssignmentForm(EMPTY_ASSIGNMENT_FORM)).toEqual({ userId: "user", roleId: "role" });
    expect(validateAssignmentForm({ ...EMPTY_ASSIGNMENT_FORM, userId: "x", roleId: "r" }).userId).toBe("userInvalid");
    expect(validateAssignmentForm({ ...EMPTY_ASSIGNMENT_FORM, userId: U(1), roleId: "r", scopeType: "campus" })).toEqual({ institutionId: "institution", campusId: "campus" });
    expect(validateAssignmentForm({ ...EMPTY_ASSIGNMENT_FORM, userId: U(1), roleId: "r", validFrom: "2026-10-02T00:00", validUntil: "2026-10-01T00:00" }).validUntil).toBe("period");
  });

  it("préremplissage datetime-local et identifiant court", () => {
    expect(toLocalInput(null)).toBe("");
    const local = toLocalInput("2026-10-01T10:00:00.000Z");
    expect(new Date(local).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(shortId(U(123456))).toHaveLength(8);
  });
});

describe("liste des rôles", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
    h.push.mockReset();
  });

  const list = () =>
    json({
      roles: [
        roleSummary(U(1), { key: "owner", label: "Propriétaire", isSystem: true, locked: true, permissionCount: 40, pendingCount: 3, assignmentCount: 2 }),
        roleSummary(U(2), { key: "econome_adjoint", label: "Économe adjoint", permissionCount: 1, assignmentCount: 0 }),
      ],
    });

  it("affiche type, permissions (dont en attente) et attributions ; propose création et clonage avec la permission", async () => {
    routes(h.fetchMock, { "GET /api/v1/rbac/roles": list(), "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS) });
    renderScreen(<RolesPage />);
    const table = await screen.findByRole("table", { name: "Rôles de l'établissement" });
    expect(within(table).getByText("Système (verrouillé)")).toBeTruthy();
    expect(within(table).getByText("Personnalisé")).toBeTruthy();
    expect(within(table).getByText("40 permissions")).toBeTruthy();
    expect(within(table).getByText("dont 3 en attente")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Ouvrir le rôle Économe adjoint" }).getAttribute("href")).toBe(`/v2/access/roles/${U(2)}`);
    expect(await screen.findByRole("link", { name: /Nouveau rôle/ })).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Cloner le rôle Propriétaire" })).toBeTruthy();
  });

  it("sans permission de gestion : ni création ni clonage", async () => {
    routes(h.fetchMock, { "GET /api/v1/rbac/roles": list(), "GET /api/v1/rbac/me/permissions": myPermissions(["rbac.role.read"]) });
    renderScreen(<RolesPage />);
    await screen.findByRole("table");
    await waitFor(() => expect(h.fetchMock.mock.calls.some(([url]) => String(url).includes("me/permissions"))).toBe(true));
    expect(screen.queryByRole("link", { name: /Nouveau rôle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cloner/ })).toBeNull();
  });

  it("état vide et erreur", async () => {
    routes(h.fetchMock, { "GET /api/v1/rbac/roles": json({ roles: [] }), "GET /api/v1/rbac/me/permissions": myPermissions([]) });
    renderScreen(<RolesPage />);
    expect(await screen.findByText("Aucun rôle pour le moment.")).toBeTruthy();
  });

  it("alerte quand la session n'a pas satisfait la MFA", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/rbac/roles": list(),
      "GET /api/v1/rbac/me/permissions": myPermissions(["rbac.role.read"], { mfa: false, requiresMfa: ["rbac.role.manage"] }),
    });
    renderScreen(<RolesPage />);
    expect(await screen.findByText(/n'a pas satisfait la MFA/)).toBeTruthy();
  });

  it("clonage : envoie libellé/clé, puis ouvre le nouveau rôle", async () => {
    const calls = routes(h.fetchMock, {
      "GET /api/v1/rbac/roles": list(),
      "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS),
      [`POST /api/v1/rbac/roles/${U(1)}/clone`]: json(roleDetail(U(3), { label: "Propriétaire adjoint" }), { status: 201 }),
    });
    renderScreen(<RolesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cloner le rôle Propriétaire" }));
    const dialog = await screen.findByRole("dialog", { name: "Cloner le rôle" });

    // Libellé obligatoire.
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le clone" }));
    expect(await within(dialog).findByText("obligatoire")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Libellé du nouveau rôle/), { target: { value: "Propriétaire adjoint" } });
    fireEvent.change(within(dialog).getByLabelText(/Clé technique/), { target: { value: "proprietaire_adjoint" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le clone" }));

    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/v2/access/roles/${U(3)}`));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ label: "Propriétaire adjoint", key: "proprietaire_adjoint" });
  });

  it("clonage : clé déjà prise -> message clair dans la boîte de dialogue", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/rbac/roles": list(),
      "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS),
      [`POST /api/v1/rbac/roles/${U(1)}/clone`]: apiError(409, "rbac.role_key_taken", "Un rôle existe déjà."),
    });
    renderScreen(<RolesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cloner le rôle Propriétaire" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Libellé du nouveau rôle/), { target: { value: "X" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le clone" }));
    expect(await within(dialog).findByText("Un rôle utilise déjà cette clé. Choisissez-en une autre.")).toBeTruthy();
  });
});

describe("détail d'un rôle et matrice de permissions", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
    h.push.mockReset();
  });
  const catalog = () => json({ permissions: CATALOG });

  const base = (detail: Record<string, unknown>, held: string[] = ALL_KEYS) => ({
    [`GET /api/v1/rbac/roles/${U(2)}`]: json(detail),
    "GET /api/v1/rbac/permissions": catalog(),
    "GET /api/v1/rbac/me/permissions": myPermissions(held),
  });

  it("matrice groupée par module avec indicateur sensible/MFA et état mixte du module", async () => {
    routes(h.fetchMock, base(roleDetail(U(2))));
    renderScreen(<RoleDetailPage id={U(2)} />);
    await screen.findByText("Gérer les rôles");
    for (const title of ["Audit", "Finance", "Rôles et accès"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getAllByText("Sensible · MFA")).toHaveLength(2);
    expect(screen.getByText("1 sur 2")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Tout sélectionner : Finance" }).getAttribute("aria-checked")).toBe("mixed");
    expect(screen.getByText("1 permission sélectionnée")).toBeTruthy();
  });

  it("rôle système verrouillé : lecture seule, aucun bouton d'enregistrement ni de suppression", async () => {
    routes(h.fetchMock, base(roleDetail(U(2), { isSystem: true, locked: true, label: "Propriétaire", permissions: ["audit.read"] })));
    renderScreen(<RoleDetailPage id={U(2)} />);
    expect(await screen.findByText("Rôle système verrouillé")).toBeTruthy();
    const box = (await screen.findByRole("checkbox", { name: /Lire le journal d'audit/ })) as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Enregistrer les modifications" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer le rôle" })).toBeNull();
    expect(screen.getByRole("button", { name: /Cloner/ })).toBeTruthy();
  });

  it("modification : n'envoie que les champs changés (permissions triées)", async () => {
    const calls = routes(h.fetchMock, {
      ...base(roleDetail(U(2))),
      [`PATCH /api/v1/rbac/roles/${U(2)}`]: json(roleDetail(U(2), { permissions: ["audit.read", "finance.payment.read"], updatedAt: "2026-10-01T11:00:00.000Z" })),
    });
    renderScreen(<RoleDetailPage id={U(2)} />);
    const save = await screen.findByRole("button", { name: "Enregistrer les modifications" });
    await screen.findByText("Lire le journal d'audit");
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Lire le journal d'audit/ }));
    expect(screen.getByText("1 permission ajoutée")).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ permissions: ["audit.read", "finance.payment.read"] });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rôle enregistré."));
  });

  it("anti-escalade : permission non détenue désactivée avec explication ; refus API expliqué avec les permissions manquantes", async () => {
    const calls = routes(h.fetchMock, {
      ...base(roleDetail(U(2)), ["rbac.role.read", "rbac.role.manage", "finance.payment.read", "audit.read"]),
      [`PATCH /api/v1/rbac/roles/${U(2)}`]: apiError(403, "rbac.escalation_denied", "refus", { permissions: ["rbac.role.manage"], roleId: U(2) }),
    });
    renderScreen(<RoleDetailPage id={U(2)} />);
    await screen.findByText("Gérer les rôles");
    const blocked = screen.getByRole("checkbox", { name: /Encaisser un paiement/ }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(screen.getAllByText("Non accordable : vous ne détenez pas cette permission.").length).toBeGreaterThan(0);

    // On force un envoi : le serveur a le dernier mot, et son refus est restitué lisiblement.
    fireEvent.click(screen.getByRole("checkbox", { name: /Lire le journal d'audit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    const alert = await screen.findByText(/vous ne pouvez accorder que des permissions que vous détenez vous-même/);
    expect(alert.textContent).toContain("rbac.role.manage");
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
  });

  it("suppression : confirmation, puis retour à la liste ; rôle encore attribué -> message", async () => {
    let attempt = 0;
    routes(h.fetchMock, {
      ...base(roleDetail(U(2))),
      [`DELETE /api/v1/rbac/roles/${U(2)}`]: () => {
        attempt += 1;
        return attempt === 1 ? apiError(409, "rbac.role_in_use", "Rôle utilisé.") : json({ deleted: true });
      },
    });
    renderScreen(<RoleDetailPage id={U(2)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer le rôle" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer ce rôle ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer le rôle" }));
    expect(await within(dialog).findByText(/encore attribué à des utilisateurs/)).toBeTruthy();
    expect(h.push).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer le rôle" }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/v2/access/roles"));
  });

  it("permissions en attente signalées ; rôle introuvable", async () => {
    routes(h.fetchMock, base(roleDetail(U(2), { pendingPermissions: ["finance.*"] })));
    const { unmount } = renderScreen(<RoleDetailPage id={U(2)} />);
    expect(await screen.findByText("Permissions en attente")).toBeTruthy();
    expect(screen.getByText(/finance\.\*/)).toBeTruthy();
    unmount();

    h.fetchMock.mockReset();
    routes(h.fetchMock, { [`GET /api/v1/rbac/roles/${U(2)}`]: apiError(404, "NOT_FOUND", "x") });
    renderScreen(<RoleDetailPage id={U(2)} />);
    expect(await screen.findByText("Ce rôle n'existe pas dans votre établissement.")).toBeTruthy();
  });

  it("recherche dans la matrice", async () => {
    routes(h.fetchMock, base(roleDetail(U(2))));
    renderScreen(<RoleDetailPage id={U(2)} />);
    await screen.findByText("Gérer les rôles");
    fireEvent.change(screen.getByLabelText("Rechercher une permission"), { target: { value: "encaisser" } });
    expect(screen.queryByText("Gérer les rôles")).toBeNull();
    expect(screen.getByText("Encaisser un paiement")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rechercher une permission"), { target: { value: "zzzz" } });
    expect(screen.getByText("Aucune permission ne correspond à cette recherche.")).toBeTruthy();
  });
});

describe("création d'un rôle", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
    h.push.mockReset();
  });

  it("valide le libellé et la clé, puis envoie les permissions triées", async () => {
    const calls = routes(h.fetchMock, {
      "GET /api/v1/rbac/permissions": json({ permissions: CATALOG }),
      "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS),
      "POST /api/v1/rbac/roles": json(roleDetail(U(7), { label: "Surveillant" }), { status: 201 }),
    });
    renderScreen(<RoleCreatePage />);
    await screen.findByText("Gérer les rôles");

    fireEvent.click(screen.getByRole("button", { name: "Créer le rôle" }));
    expect(await screen.findByText("Le libellé est obligatoire.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Libellé/), { target: { value: "Surveillant" } });
    fireEvent.change(screen.getByLabelText(/Clé technique/), { target: { value: "Mauvaise Clé" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le rôle" }));
    expect(await screen.findByText(/Minuscules, chiffres et « _ » uniquement/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(screen.getByLabelText(/Clé technique/), { target: { value: "surveillant" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Tout sélectionner : Finance" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Lire le journal d'audit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Créer le rôle" }));

    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/v2/access/roles/${U(7)}`));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      label: "Surveillant",
      key: "surveillant",
      permissions: ["audit.read", "finance.payment.create", "finance.payment.read"],
    });
  });

  it("refus d'anti-escalade du serveur affiché dans le formulaire", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/rbac/permissions": json({ permissions: CATALOG }),
      "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS),
      "POST /api/v1/rbac/roles": apiError(403, "rbac.escalation_denied", "refus", { permissions: ["finance.payment.create"] }),
    });
    renderScreen(<RoleCreatePage />);
    await screen.findByText("Gérer les rôles");
    fireEvent.change(screen.getByLabelText(/Libellé/), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le rôle" }));
    expect(await screen.findByText(/Permissions qui vous manquent : finance\.payment\.create/)).toBeTruthy();
  });
});

describe("attributions de rôles", () => {
  let calls: RecordedCall[];
  beforeEach(() => {
    h.fetchMock.mockReset();
  });

  const assignment = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    userId: U(50),
    identityId: U(50),
    roleId: U(2),
    roleKey: "econome_adjoint",
    scope: { type: "tenant" },
    validFrom: null,
    validUntil: null,
    grantedBy: ME,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  const table = (extra: Record<string, Response | ((c: RecordedCall) => Response)> = {}) => ({
    "GET /api/v1/rbac/assignments": json({
      assignments: [
        assignment(U(60)),
        assignment(U(61), { scope: { type: "institution", id: U(70) }, validUntil: "2020-01-01T00:00:00.000Z" }),
        assignment(U(62), { scope: { type: "campus", id: U(71) }, validFrom: "2099-01-01T00:00:00.000Z" }),
      ],
    }),
    "GET /api/v1/rbac/roles": json({ roles: [roleSummary(U(2), { label: "Économe adjoint", key: "econome_adjoint" })] }),
    "GET /api/v1/rbac/me/permissions": myPermissions(ALL_KEYS),
    "GET /api/v1/iam/admin/members": json({
      members: [
        { membershipId: U(80), identityId: U(50), email: "awa@ecole.ci", status: "active", roles: ["admin"], baseRole: "admin", mfaEnabled: true, createdAt: NOW },
      ],
    }),
    "GET /api/v1/tenancy/institutions": json({
      items: [{ id: U(70), tenantId: TENANT, code: "lycee", name: "Lycée Central", pack: "SECONDARY", educationSystem: "ci", countryCode: "CI", status: "ACTIVE", createdAt: NOW, updatedAt: NOW }],
    }),
    [`GET /api/v1/tenancy/institutions/${U(70)}/campuses`]: json({
      items: [{ id: U(71), tenantId: TENANT, institutionId: U(70), code: "nord", name: "Campus Nord", address: null, city: null, phone: null, isDefault: true, status: "ACTIVE", createdAt: NOW, updatedAt: NOW }],
    }),
    ...extra,
  });

  it("liste : utilisateur (e-mail), rôle, périmètre nommé, validité et statut", async () => {
    calls = routes(h.fetchMock, table());
    renderScreen(<AssignmentsPage />);
    const grid = await screen.findByRole("table", { name: "Attributions de rôles" });
    await waitFor(() => expect(within(grid).getAllByText("awa@ecole.ci").length).toBe(3));
    expect(within(grid).getAllByText("Économe adjoint")).toHaveLength(3);
    expect(within(grid).getByText("Tout l'établissement")).toBeTruthy();
    expect(within(grid).getByText("Établissement : Lycée Central")).toBeTruthy();
    expect(within(grid).getByText(/^Campus /)).toBeTruthy();
    expect(within(grid).getByText("Active")).toBeTruthy();
    expect(within(grid).getByText("Expirée")).toBeTruthy();
    expect(within(grid).getByText("À venir")).toBeTruthy();
    expect(within(grid).getByText("Sans limite")).toBeTruthy();
  });

  it("filtre par rôle : l'appel porte roleId", async () => {
    calls = routes(h.fetchMock, table());
    renderScreen(<AssignmentsPage />);
    await screen.findByRole("table", { name: "Attributions de rôles" });
    fireEvent.change(screen.getByLabelText("Filtrer par rôle"), { target: { value: U(2) } });
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/assignments")).at(-1)!.query.get("roleId")).toBe(U(2)));
  });

  it("création : validation, puis envoi avec périmètre campus et validité", async () => {
    calls = routes(h.fetchMock, table({ "POST /api/v1/rbac/assignments": json(assignment(U(63)), { status: 201 }) }));
    renderScreen(<AssignmentsPage />);
    const form = await screen.findByRole("form", { name: "Nouvelle attribution" });
    await within(form).findByRole("option", { name: "awa@ecole.ci" });

    fireEvent.click(within(form).getByRole("button", { name: "Attribuer le rôle" }));
    expect(await within(form).findByText("Choisissez un utilisateur.")).toBeTruthy();
    expect(within(form).getByText("Choisissez un rôle.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(form).getByLabelText(/Utilisateur/), { target: { value: U(50) } });
    fireEvent.change(within(form).getByLabelText(/^Rôle/), { target: { value: U(2) } });
    fireEvent.change(within(form).getByLabelText("Périmètre"), { target: { value: "campus" } });
    fireEvent.click(within(form).getByRole("button", { name: "Attribuer le rôle" }));
    expect(await within(form).findByText("Choisissez un établissement.")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText(/^Établissement/), { target: { value: U(70) } });
    await within(form).findByRole("option", { name: "Campus Nord" });
    fireEvent.change(within(form).getByLabelText(/^Campus/), { target: { value: U(71) } });
    fireEvent.change(within(form).getByLabelText("Valide jusqu'au"), { target: { value: "2027-06-30T00:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Attribuer le rôle" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      userId: U(50),
      roleId: U(2),
      scope: { type: "campus", id: U(71) },
      validUntil: new Date("2027-06-30T00:00").toISOString(),
    });
  });

  it("création : l'anti-escalade du serveur est expliquée", async () => {
    calls = routes(
      h.fetchMock,
      table({ "POST /api/v1/rbac/assignments": apiError(403, "rbac.escalation_denied", "refus", { permissions: ["finance.payment.create", "audit.read"], roleId: U(2) }) }),
    );
    renderScreen(<AssignmentsPage />);
    const form = await screen.findByRole("form", { name: "Nouvelle attribution" });
    await within(form).findByRole("option", { name: "awa@ecole.ci" });
    fireEvent.change(within(form).getByLabelText(/Utilisateur/), { target: { value: U(50) } });
    fireEvent.change(within(form).getByLabelText(/^Rôle/), { target: { value: U(2) } });
    fireEvent.click(within(form).getByRole("button", { name: "Attribuer le rôle" }));
    const message = await within(form).findByText(/Permissions qui vous manquent/);
    expect(message.textContent).toContain("finance.payment.create, audit.read");
  });

  it("sans droit de lecture des membres : saisie de l'identifiant", async () => {
    calls = routes(h.fetchMock, table({ "GET /api/v1/rbac/me/permissions": myPermissions(["rbac.role.read", "rbac.assignment.manage"]) }));
    renderScreen(<AssignmentsPage />);
    const form = await screen.findByRole("form", { name: "Nouvelle attribution" });
    expect(within(form).getByLabelText(/Identifiant de l'utilisateur/)).toBeTruthy();
    expect(calls.some((c) => c.path.includes("/iam/"))).toBe(false);
  });

  it("révocation : confirmation, appel DELETE ; dernier propriétaire -> message", async () => {
    let attempt = 0;
    calls = routes(
      h.fetchMock,
      table({
        [`DELETE /api/v1/rbac/assignments/${U(60)}`]: () => {
          attempt += 1;
          return attempt === 1 ? apiError(409, "rbac.last_owner", "dernier") : json({ revoked: true });
        },
      }),
    );
    renderScreen(<AssignmentsPage />);
    const grid = await screen.findByRole("table", { name: "Attributions de rôles" });
    fireEvent.click(within(grid).getAllByRole("button", { name: "Révoquer l'attribution de Économe adjoint" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Révoquer cette attribution ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    expect(await within(dialog).findByText(/au moins un propriétaire/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  it("modification de la validité : retire la limite avec null", async () => {
    calls = routes(
      h.fetchMock,
      table({ [`PATCH /api/v1/rbac/assignments/${U(61)}`]: json(assignment(U(61), { scope: { type: "institution", id: U(70) } })) }),
    );
    renderScreen(<AssignmentsPage />);
    const grid = await screen.findByRole("table", { name: "Attributions de rôles" });
    fireEvent.click(within(grid).getAllByRole("button", { name: "Modifier la validité de l'attribution de Économe adjoint" })[1]!);
    const dialog = await screen.findByRole("dialog", { name: "Modifier la validité" });
    fireEvent.change(within(dialog).getByLabelText("Valide jusqu'au"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ validFrom: null, validUntil: null });
  });

  it("sans droit de gestion : formulaire et actions absents", async () => {
    calls = routes(h.fetchMock, table({ "GET /api/v1/rbac/me/permissions": myPermissions(["rbac.role.read"]) }));
    renderScreen(<AssignmentsPage />);
    const grid = await screen.findByRole("table", { name: "Attributions de rôles" });
    await waitFor(() => expect(calls.some((c) => c.path.includes("me/permissions"))).toBe(true));
    expect(screen.queryByRole("form", { name: "Nouvelle attribution" })).toBeNull();
    expect(within(grid).queryByRole("button", { name: /Révoquer/ })).toBeNull();
    void noContent;
  });
});
