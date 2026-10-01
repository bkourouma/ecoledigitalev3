// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Notice,
  ResponsiveTable,
  StatusBadge,
} from "@ecoledigitale/ui";
import { ApiError } from "@/platform/api/errors";
import { createApiClient, PLATFORM_SCOPE } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";
import { MyPermissionsSchema } from "@/platform/access/types";
import { NavigationResponseSchema } from "@/platform/navigation/types";
import { TenancyProfileSchema } from "@/platform/theme/theme";
import { errorMessageSpec, fieldErrorsOf, isUnavailableEndpoint, permissionsFromDetails } from "./errors";
import { createOperatorClient, tokenExpiry } from "./operator";
import { json } from "./test-utils";

describe("erreurs d'API -> messages", () => {
  const err = (code: string, status: number, details?: unknown) => new ApiError({ code, message: "Message de l'API.", status, details });

  it("anti-escalade : clé dédiée et permissions manquantes", () => {
    const spec = errorMessageSpec(err("rbac.escalation_denied", 403, { permissions: ["finance.payment.read", "audit.export"], roleId: "r" }));
    expect(spec.key).toBe("apiErrors.escalationDenied");
    expect(spec.values).toEqual({ permissions: "finance.payment.read, audit.export" });
  });

  it("codes RBAC connus, erreurs techniques du client, repli sur le message métier de l'API", () => {
    expect(errorMessageSpec(err("rbac.last_owner", 409)).key).toBe("apiErrors.lastOwner");
    expect(errorMessageSpec(err("rbac.role_locked", 409)).key).toBe("apiErrors.roleLocked");
    expect(errorMessageSpec(err("rbac.mfa_required", 403)).key).toBe("apiErrors.mfaRequired");
    expect(errorMessageSpec(err("NETWORK_ERROR", 0)).key).toBe("errors.network");
    expect(errorMessageSpec(err("TIMEOUT", 0)).key).toBe("errors.timeout");
    expect(errorMessageSpec(err("tenancy.campus_default_protected", 409))).toMatchObject({ key: "errors.conflict", raw: "Message de l'API." });
    expect(errorMessageSpec(err("INTERNAL", 500))).toEqual({ key: "errors.generic" });
    expect(errorMessageSpec(new Error("x")).key).toBe("errors.generic");
  });

  it("extrait les permissions et les erreurs par champ", () => {
    expect(permissionsFromDetails({ unknown: ["a.b"] })).toEqual(["a.b"]);
    expect(permissionsFromDetails(null)).toEqual([]);
    const e = err("VALIDATION_FAILED", 400, [{ path: ["permissions", 0], message: "Clé invalide." }, { path: ["label"], message: "Obligatoire." }]);
    expect(fieldErrorsOf(e)).toEqual({ "permissions.0": "Clé invalide.", label: "Obligatoire." });
    expect(fieldErrorsOf(err("X", 400, { issues: [{ path: ["a"], message: "m" }] }))).toEqual({ a: "m" });
    expect(isUnavailableEndpoint(err("NOT_FOUND", 404))).toBe(true);
    expect(isUnavailableEndpoint(err("INTERNAL", 500))).toBe(false);
  });
});

describe("contrats réels acceptés par platform/ (rétro-compatibles)", () => {
  it("permissions : forme réelle { key, sensitive, scopes } et ancienne forme string[]", () => {
    const real = MyPermissionsSchema.parse({
      tenantId: "t",
      userId: "u",
      mfa: false,
      permissions: [{ key: "audit.export", sensitive: true, scopes: [{ type: "tenant" }] }, { key: "audit.read", sensitive: false, scopes: [] }],
      requiresMfa: ["rbac.role.manage"],
    });
    expect(real.permissions).toEqual(["audit.export", "audit.read"]);
    expect(real.sensitive).toEqual(["audit.export"]);
    expect(real.requiresMfa).toEqual(["rbac.role.manage"]);
    expect(MyPermissionsSchema.parse({ permissions: ["a.b", "c.*"] }).permissions).toEqual(["a.b", "c.*"]);
  });

  it("navigation : { portals } aplati, { items } et tableau conservés", () => {
    const entry = { key: "a", label: "A", href: "/a", permission: "a.read", portal: "admin" };
    const portals = { admin: [entry], teacher: [{ ...entry, key: "t", portal: "teacher" }] };
    expect(NavigationResponseSchema.parse({ portals, availablePortals: ["admin"] }).map((i) => i.key)).toEqual(["a", "t"]);
    expect(NavigationResponseSchema.parse({ items: [entry] })).toHaveLength(1);
    expect(NavigationResponseSchema.parse([entry])).toHaveLength(1);
  });

  it("profil de tenant : ancienne forme { theme } et forme réelle { branding }", () => {
    expect(TenancyProfileSchema.parse({ name: "X", theme: { primaryColor: "#112233" } })).toEqual({ name: "X", theme: { primaryColor: "#112233" } });
    expect(TenancyProfileSchema.parse({ tradeName: "Marque", legalName: "Légal", branding: { primaryColor: "#445566", logoUrl: null } })).toEqual({
      name: "Marque",
      theme: { primaryColor: "#445566", logoUrl: null },
    });
  });
});

describe("client sans tenant (console plateforme)", () => {
  it("n'envoie pas X-Tenant, envoie le jeton, et utilise une portée de cache dédiée", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const client = createOperatorClient({ fetch: fetchMock as never, getToken: () => "op", retries: 0 });
    expect(client.getTenant()).toBe(PLATFORM_SCOPE);
    await client.get("/api/v1/platform/tenants");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get("x-tenant")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer op");
    expect(createQueryHooks(client).queryKey("tenants")).toEqual(["api", "platform", "tenants"]);
  });

  it("sans jeton : échec 401 local, aucune requête", async () => {
    const fetchMock = vi.fn();
    const client = createOperatorClient({ fetch: fetchMock as never, getToken: () => null });
    await expect(client.get("/api/v1/platform/tenants")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un client tenant sans tenant échoue toujours en TENANT_UNKNOWN", async () => {
    const client = createApiClient({ baseUrl: "", getTenant: () => null, getToken: () => "t", fetch: vi.fn() as never });
    await expect(client.get("/x")).rejects.toMatchObject({ code: "TENANT_UNKNOWN" });
  });

  it("lit l'expiration d'un JWT", () => {
    const payload = btoa(JSON.stringify({ exp: 2_000_000_000 }));
    expect(tokenExpiry(`h.${payload}.s`)).toBe(2_000_000_000_000);
    expect(tokenExpiry("pas-un-jwt")).toBeNull();
  });
});

describe("briques de packages/ui", () => {
  it("Field relie libellé, aide et erreur (aria-describedby, aria-invalid)", () => {
    render(
      <Field label="Nom" hint="Aide" error="Erreur" required requiredLabel="obligatoire">
        {(c) => <Input {...c} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Nom/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    const described = input.getAttribute("aria-describedby")!.split(" ");
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[1]!)!.textContent).toBe("Erreur");
    expect(screen.getByRole("alert").textContent).toBe("Erreur");
  });

  it("états : chargement annoncé, vide avec action, erreur avec réessai", () => {
    const retry = vi.fn();
    render(
      <div>
        <LoadingState label="Chargement…" />
        <EmptyState title="Rien" description="Créez-en un" action={<button>Créer</button>} />
        <ErrorState message="Oups" reference="req-1" onRetry={retry} retryLabel="Réessayer" />
        <Notice tone="warning">Attention</Notice>
        <Notice tone="success">Bravo</Notice>
      </div>,
    );
    expect(screen.getByText("Chargement…").closest("[role=status]")!.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Créer")).toBeTruthy();
    const alert = screen.getByText("Oups").closest("[role=alert]")!;
    fireEvent.click(within(alert as HTMLElement).getByRole("button", { name: "Réessayer" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText("Attention").getAttribute("role")).toBe("alert");
    expect(screen.getByText("Bravo").getAttribute("role")).toBe("status");
  });

  it("ResponsiveTable : rôles ARIA tableau, libellés de colonnes répétés pour le mobile", () => {
    render(
      <ResponsiveTable
        caption="Rôles"
        rows={[{ id: "1", name: "Directeur", n: 3 }]}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", header: "Nom", cell: (r) => r.name },
          { key: "n", header: "Permissions", cell: (r) => r.n, hideOnMobile: true },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Rôles" });
    expect(within(table).getAllByRole("columnheader", { hidden: true })).toHaveLength(2);
    const cell = within(table).getByText("Directeur").closest("[role=cell]")!;
    expect(cell.getAttribute("data-label")).toBe("Nom");
  });

  it("StatusBadge affiche toujours un texte", () => {
    render(<StatusBadge tone="danger">Suspendu</StatusBadge>);
    expect(screen.getByText("Suspendu")).toBeTruthy();
  });

  it("ConfirmDialog : annuler / confirmer, confirmation désactivable", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Suspendre ?"
        confirmLabel="Suspendre"
        cancelLabel="Annuler"
        closeLabel="Fermer"
        destructive
        confirmDisabled
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Suspendre ?" });
    expect((within(dialog).getByRole("button", { name: "Suspendre" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(within(dialog).getByRole("button", { name: "Fermer" })).toBeTruthy();
  });
});
