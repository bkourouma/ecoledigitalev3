// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, renderScreen, routes, text, type RecordedCall } from "@/platform/admin/test-utils";
import { AuditPage } from "./AuditPage";
import { AuditDetailPage } from "./AuditDetail";
import { countCsvRows } from "./hooks";
import { diffRows, displayPath, formatDiffValue, isMasked } from "./diff";
import {
  EMPTY_FILTERS,
  toExportQuery,
  toIsoInstant,
  toListQuery,
  validateExport,
  validateFilters,
  type AuditFilterState,
} from "./filters";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ACTOR = "11111111-1111-4111-8111-111111111111";

function entry(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tenantId: "22222222-2222-4222-8222-222222222222",
    seq: n,
    occurredAt: "2026-10-01T10:00:00.000Z",
    recordedAt: "2026-10-01T10:00:01.000Z",
    actorType: "user",
    actorId: ACTOR,
    impersonatedBy: null,
    action: "role.changed",
    entity: "role",
    entityId: `role-${n}`,
    diff: { label: { from: "A", to: "B" } },
    ip: "10.0.0.1",
    device: "Chrome",
    requestId: "req-1",
    reason: null,
    severity: "notice",
    hash: "a".repeat(64),
    ...over,
  };
}

const permissions = (...keys: string[]) =>
  json({
    tenantId: "22222222-2222-4222-8222-222222222222",
    userId: ACTOR,
    mfa: true,
    permissions: keys.map((key) => ({ key, sensitive: key === "audit.export", scopes: [{ type: "tenant" }] })),
    requiresMfa: [],
  });

describe("filtres (fonctions pures)", () => {
  const base: AuditFilterState = { ...EMPTY_FILTERS };

  it("omet les champs vides et convertit les dates en instants ISO UTC", () => {
    expect(toListQuery(base)).toEqual({});
    const query = toListQuery({ ...base, action: " role.* ", severity: ["warning", "critical"], from: "2026-10-01T08:00" });
    expect(query.action).toBe("role.*");
    expect(query.severity).toBe("warning,critical");
    expect(query.from).toBe(new Date("2026-10-01T08:00").toISOString());
    expect(toIsoInstant("")).toBeNull();
    expect(toIsoInstant("pas une date")).toBeNull();
  });

  it("valide acteur, entité, action et ordre de la période", () => {
    expect(validateFilters({ ...base, actorId: "abc", entity: "Role", action: "Role Changed" })).toEqual({
      actorId: "actorId",
      entity: "entity",
      action: "action",
    });
    expect(validateFilters({ ...base, actorId: ACTOR, action: "role.*" })).toEqual({});
    expect(validateFilters({ ...base, from: "2026-10-02T00:00", to: "2026-10-01T00:00" }).to).toBe("period");
  });

  it("l'export exige une période d'au plus 31 jours", () => {
    expect(validateExport(base)).toMatchObject({ from: "exportPeriodRequired", to: "exportPeriodRequired" });
    expect(validateExport({ ...base, from: "2026-08-01T00:00", to: "2026-10-01T00:00" }).to).toBe("exportPeriodTooLong");
    expect(validateExport({ ...base, from: "2026-09-20T00:00", to: "2026-10-01T00:00" })).toEqual({});
    expect(toExportQuery({ ...base, from: "2026-09-20T00:00", to: "2026-10-01T00:00" }).limit).toBe(10_000);
  });
});

describe("diff (fonctions pures)", () => {
  it("classe ajouté / retiré / modifié et trie par chemin", () => {
    const rows = diffRows({ b: { to: 1 }, a: { from: "x" }, c: { from: 1, to: 2 } });
    expect(rows.map((r) => [r.path, r.kind])).toEqual([
      ["a", "removed"],
      ["b", "added"],
      ["c", "changed"],
    ]);
    expect(diffRows(null)).toEqual([]);
    expect(diffRows([1, 2])).toEqual([]);
  });

  it("formate les valeurs et repère les valeurs masquées", () => {
    expect(formatDiffValue("abc")).toBe("abc");
    expect(formatDiffValue({ a: 1 })).toContain('"a": 1');
    expect(formatDiffValue(undefined)).toBe("");
    expect(isMasked("[MASKED]")).toBe(true);
    expect(displayPath("a\\.b.c")).toBe("a.b.c");
  });

  it("compte les lignes CSV hors en-tête", () => {
    expect(countCsvRows("a,b\n1,2\n3,4\n")).toBe(2);
    expect(countCsvRows("")).toBe(0);
  });
});

describe("écran /v2/audit", () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    h.fetchMock.mockReset();
  });

  const logCalls = () => calls.filter((c) => c.path === "/api/v1/audit/logs");

  it("affiche l'état de chargement puis la liste, avec un lien vers le détail", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [entry(1), entry(2, { action: "campus.created", severity: "critical" })], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);

    const table = await screen.findByRole("table", { name: "Entrées du journal d'audit" });
    const link = within(table).getByRole("link", { name: /campus\.created/ });
    expect(link.getAttribute("href")).toBe("/v2/audit/00000000-0000-4000-8000-000000000002");
    expect(within(table).getAllByText("Critique").length).toBe(1);
    expect(screen.getByText("2 entrées chargées")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Charger plus d'entrées" })).toBeNull();
    // Chaque ligne de la liste porte le nombre de champs modifiés.
    expect(within(table).getAllByText("1 champ").length).toBe(2);
  });

  it("état vide : message distinct avec et sans filtre", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    expect(await screen.findByText("Aucune entrée dans le journal pour le moment.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "role.*" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer les filtres" }));
    expect(await screen.findByText("Aucune entrée ne correspond à ces filtres.")).toBeTruthy();
  });

  it("applique les filtres dans la requête et refuse une saisie invalide sans appel", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [entry(1)], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText(/Acteur/), { target: { value: "pas-un-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer les filtres" }));
    expect(await screen.findByText("Saisissez un identifiant UUID valide.")).toBeTruthy();
    const before = logCalls().length;

    fireEvent.change(screen.getByLabelText(/Acteur/), { target: { value: ACTOR } });
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "role.*" } });
    fireEvent.click(screen.getByLabelText("Critique"));
    fireEvent.click(screen.getByRole("button", { name: "Appliquer les filtres" }));

    await waitFor(() => expect(logCalls().length).toBe(before + 1));
    const last = logCalls().at(-1)!;
    expect(last.query.get("actorId")).toBe(ACTOR);
    expect(last.query.get("action")).toBe("role.*");
    expect(last.query.get("severity")).toBe("critical");
    expect(last.query.get("limit")).toBe("50");
  });

  it("pagination par curseur : « Charger plus » ajoute la page suivante", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": (call) =>
        call.query.get("cursor") === "C2"
          ? json({ items: [entry(3, { action: "role.deleted" })], nextCursor: null })
          : json({ items: [entry(1), entry(2)], nextCursor: "C2" }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    const more = await screen.findByRole("button", { name: "Charger plus d'entrées" });
    fireEvent.click(more);
    expect(await screen.findByRole("link", { name: /role\.deleted/ })).toBeTruthy();
    expect(screen.getByText("3 entrées chargées")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Charger plus d'entrées" })).toBeNull();
  });

  it("erreur : message localisé, référence de support, et « Réessayer » relance l'appel", async () => {
    let attempt = 0;
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": () => {
        attempt += 1;
        return attempt === 1
          ? json({ code: "INTERNAL", message: "boom", requestId: "req-42" }, { status: 500 })
          : json({ items: [entry(1)], nextCursor: null });
      },
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Une erreur est survenue");
    expect(alert.textContent).toContain("req-42");
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("export : désactivé sans permission, avec explication", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
    });
    renderScreen(<AuditPage />);
    const button = await screen.findByRole("button", { name: /Exporter en CSV/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/réservé aux profils disposant de la permission/i)).toBeTruthy();
  });

  it("export : exige une période, puis télécharge le CSV (client typé, corps texte)", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read", "audit.export"),
      "GET /api/v1/audit/logs/export": text("id,action\n1,role.changed\n2,role.deleted\n"),
    });
    renderScreen(<AuditPage />);
    const button = await screen.findByRole("button", { name: /Exporter en CSV/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    // Sans période : message, aucun appel d'export.
    fireEvent.click(button);
    expect(await screen.findAllByText("L'export exige une période : renseignez les deux dates.")).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/export"))).toBe(false);

    // Avec période appliquée : l'export part avec from/to/limit.
    fireEvent.change(await screen.findByLabelText("Du"), { target: { value: "2026-09-20T00:00" } });
    fireEvent.change(screen.getByLabelText("Au"), { target: { value: "2026-10-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer les filtres" }));
    await waitFor(() => expect(logCalls().at(-1)!.query.get("from")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Exporter en CSV/ }));

    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/export"))).toBe(true));
    const exportCall = calls.find((c) => c.path.endsWith("/export"))!;
    expect(exportCall.query.get("limit")).toBe("10000");
    expect(exportCall.query.get("from")).toBe(new Date("2026-09-20T00:00").toISOString());
    expect(exportCall.headers.get("accept")).toBe("text/csv");
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 lignes")));
  });

  it("export : un refus MFA de l'API est expliqué", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.export"),
      "GET /api/v1/audit/logs/export": apiError(403, "rbac.mfa_required", "MFA requise."),
    });
    renderScreen(<AuditPage />);
    const button = await screen.findByRole("button", { name: /Exporter en CSV/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(await screen.findByLabelText("Du"), { target: { value: "2026-09-20T00:00" } });
    fireEvent.change(screen.getByLabelText("Au"), { target: { value: "2026-10-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer les filtres" }));
    await waitFor(() => expect(logCalls().at(-1)!.query.get("from")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Exporter en CSV/ }));
    expect((await screen.findAllByText(/authentification à deux facteurs/)).length).toBeGreaterThan(0);
  });

  it("vérification de la chaîne : verdict intègre", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
      "GET /api/v1/audit/verify": json({
        ok: true,
        checked: 120,
        firstSeq: 1,
        lastSeq: 120,
        headSeq: 120,
        anchor: "genesis",
        issues: [],
        issuesTruncated: false,
      }),
    });
    renderScreen(<AuditPage />);
    await screen.findByText("Aucune entrée dans le journal pour le moment.");
    // Rien n'est vérifié à l'affichage.
    expect(calls.some((c) => c.path.endsWith("/verify"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier la chaîne" }));
    expect(await screen.findByText("Chaîne intègre")).toBeTruthy();
    expect(screen.getByText(/120 entrées vérifiées/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vérifier à nouveau" })).toBeTruthy();
  });

  it("vérification de la chaîne : anomalies détaillées", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/audit/logs": json({ items: [], nextCursor: null }),
      "GET /api/v1/rbac/me/permissions": permissions("audit.read"),
      "GET /api/v1/audit/verify": json({
        ok: false,
        checked: 10,
        firstSeq: 1,
        lastSeq: 10,
        headSeq: 10,
        anchor: "genesis",
        issues: [{ kind: "hash_mismatch", seq: 7, id: null, detail: "Empreinte recalculée différente." }],
        issuesTruncated: true,
      }),
    });
    renderScreen(<AuditPage />);
    await screen.findByText("Aucune entrée dans le journal pour le moment.");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier la chaîne" }));
    expect(await screen.findByText("Chaîne altérée")).toBeTruthy();
    expect(screen.getByText("Empreinte incohérente")).toBeTruthy();
    expect(screen.getByText("séquence 7")).toBeTruthy();
    expect(screen.getByText("La liste d'anomalies est tronquée.")).toBeTruthy();
  });
});

describe("détail /v2/audit/[id]", () => {
  beforeEach(() => h.fetchMock.mockReset());
  const id = "00000000-0000-4000-8000-000000000009";
  const detail = (over: Record<string, unknown> = {}) => ({
    ...entry(9),
    id,
    before: { label: "A", password: "secret" },
    after: { label: "B", password: "secret2" },
    diff: { label: { from: "A", to: "B" }, password: { from: "[MASKED]", to: "[MASKED]" }, "extra.value": { to: 5 } },
    metadata: { source: "api" },
    userAgent: "Mozilla",
    hashAlg: "sha256",
    prevHash: "b".repeat(64),
    ...over,
  });

  it("affiche le diff avant/après champ par champ et masque les valeurs sensibles", async () => {
    routes(h.fetchMock, { [`GET /api/v1/audit/logs/${id}`]: json(detail()) });
    renderScreen(<AuditDetailPage id={id} />);
    const list = await screen.findByRole("list", { name: "Changements champ par champ" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(list).getAllByText("Valeur masquée")).toHaveLength(2);
    expect(within(list).getByText("Ajouté")).toBeTruthy();
    expect(within(list).getAllByText("Modifié", { selector: "div" })).toHaveLength(2);
    // L'affichage des changements ne contient jamais la valeur sensible.
    expect(list.textContent).not.toContain("secret");
    expect(screen.getByRole("link", { name: /Retour au journal/ }).getAttribute("href")).toBe("/v2/audit");
  });

  it("entrée sans diff : message explicite", async () => {
    routes(h.fetchMock, { [`GET /api/v1/audit/logs/${id}`]: json(detail({ diff: null, before: null, after: null, metadata: null })) });
    renderScreen(<AuditDetailPage id={id} />);
    expect(await screen.findByText(/Aucun changement de valeur/)).toBeTruthy();
  });

  it("404 : entrée introuvable", async () => {
    routes(h.fetchMock, { [`GET /api/v1/audit/logs/${id}`]: apiError(404, "NOT_FOUND", "x") });
    renderScreen(<AuditDetailPage id={id} />);
    expect(await screen.findByText(/n'existe pas ou n'appartient pas/)).toBeTruthy();
  });
});
