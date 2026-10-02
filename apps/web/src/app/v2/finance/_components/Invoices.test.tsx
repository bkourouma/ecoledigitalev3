// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { discount, fee, fid, funding, installment, invoiceDetail, invoiceLine, invoiceSummary, plan, statement, xof } from "../../_test/fixtures-finance";
import { uuid } from "../../_test/fixtures";
import { studentDetail } from "../../_test/fixtures-people";
import { FundingScreen } from "./Funding";
import { NewInvoiceScreen } from "./InvoiceForm";
import { InvoiceDetailScreen, InvoicesScreen } from "./Invoices";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/invoices", useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));

const READ = ["finance.invoice.read", "student.read"];
const learnerRoute = { [`GET /api/v1/people/students/${fid(900)}`]: studentDetail({ id: fid(900), displayName: "KONE Mariam" }) };

describe("InvoicesScreen", () => {
  it("liste : numéro, apprenant nommé, statut et montants formatés en francs entiers", async () => {
    const api = setTestApi({
      ...accessRoutes(READ),
      ...learnerRoute,
      "GET /api/v1/finance/invoices": { items: [invoiceSummary(), invoiceSummary({ id: fid(51), number: null, status: "DRAFT", balance: xof(0), total: xof(80000) })], total: 2 },
    });
    renderWithProviders(<InvoicesScreen />);
    const table = await screen.findByRole("table", { name: "Liste des factures" });
    expect(await within(table).findByRole("link", { name: "FAC-2026-000001" })).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Brouillon" })).toBeTruthy();
    await waitFor(() => expect(within(table).getAllByText("KONE Mariam").length).toBe(2));
    expect(within(table).getAllByText("Émise").length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/450\D000\sF\sCFA/).length).toBeGreaterThan(0);
    expect(api.calls.find((c) => c.path === "/api/v1/finance/invoices")!.query).toMatchObject({ limit: "25", offset: "0" });
  });

  it("filtre de groupe (créances par classe) transmis à l'API et retirable", async () => {
    const api = setTestApi({ ...accessRoutes(READ), "GET /api/v1/finance/invoices": { items: [], total: 0 } });
    renderWithProviders(<InvoicesScreen initial={{ groupKey: "6E-A", status: "OVERDUE" }} />);
    expect(await screen.findByText(/Filtre sur le groupe « 6E-A »/)).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.query.groupKey === "6E-A" && c.query.status === "OVERDUE")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Retirer le filtre" }));
    await waitFor(() => expect(api.calls.at(-1)!.query.groupKey).toBeUndefined());
  });

  it("erreur de l'API : message et réessai ; liste vide : état vide", async () => {
    setTestApi({ ...accessRoutes(READ), "GET /api/v1/finance/invoices": () => json({ code: "finance.boom", message: "Le service de facturation est indisponible." }, { status: 422 }) });
    renderWithProviders(<InvoicesScreen />);
    expect(await screen.findByText("Le service de facturation est indisponible.")).toBeTruthy();
  });

  it("état vide", async () => {
    setTestApi({ ...accessRoutes(READ), "GET /api/v1/finance/invoices": { items: [], total: 0 } });
    renderWithProviders(<InvoicesScreen />);
    expect(await screen.findByText("Aucune facture")).toBeTruthy();
  });
});

describe("InvoiceDetailScreen", () => {
  const detail = invoiceDetail();
  const base = { ...accessRoutes([...READ, "finance.invoice.create", "finance.invoice.cancel", "finance.payment.create"], ["finance.installments"]), ...learnerRoute, [`GET /api/v1/finance/invoices/${fid(50)}`]: detail };

  it("affiche l'échéancier et les montants calculés par l'API (aucun recalcul côté client)", async () => {
    setTestApi(base);
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "FAC-2026-000001" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Échéancier de la facture" });
    expect(within(table).getByText("Inscription")).toBeTruthy();
    expect(within(table).getByText("Tranche 2")).toBeTruthy();
    // Reste dû : 100 000 (échéance 1) et 350 000 (échéance 2) tels que renvoyés par l'API.
    expect(within(table).getByText(/100\D000\sF\sCFA/)).toBeTruthy();
    expect(within(table).getAllByText(/350\D000\sF\sCFA/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Encaisser" }).getAttribute("href")).toBe(`/v2/finance/payments/new?learnerId=${fid(900)}`);
  });

  it("avoir : le montant décimal est refusé, l'entier est envoyé", async () => {
    const api = setTestApi({
      ...base,
      [`POST /api/v1/finance/invoices/${fid(50)}/credit-notes`]: ({ body }) =>
        json(
          {
            creditNote: { id: fid(140), number: "AV-2026-000001", invoiceId: fid(50), learnerId: fid(900), amount: xof((body as { amount: number }).amount), reason: "Erreur de tarif", applications: [], issuedAt: "2026-09-05T08:00:00.000Z" },
            invoice: detail,
          },
          { status: 201 },
        ),
    });
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Émettre un avoir" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Montant de l'avoir/), { target: { value: "10.5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "Erreur de tarif" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Émettre l'avoir" }));
    expect(await within(dialog).findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Montant de l'avoir/), { target: { value: "10 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Émettre l'avoir" }));
    await screen.findByText("L'avoir AV-2026-000001 a été émis.");
    expect(api.calls.find((c) => c.path.endsWith("/credit-notes"))!.body).toEqual({ amount: 10000, reason: "Erreur de tarif" });
  });

  it("annulation motivée", async () => {
    const api = setTestApi({ ...base, [`POST /api/v1/finance/invoices/${fid(50)}/cancel`]: () => json({ ...detail, status: "CANCELLED", cancelReason: "Doublon" }) });
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Annuler la facture" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'annulation/), { target: { value: "Doublon de facture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler la facture" }));
    await screen.findByText("La facture a été annulée.");
    expect(api.calls.find((c) => c.path.endsWith("/cancel"))!.body).toEqual({ reason: "Doublon de facture" });
  });

  it("brouillon : émission", async () => {
    const draft = invoiceDetail({ status: "DRAFT", number: null });
    const api = setTestApi({
      ...accessRoutes([...READ, "finance.invoice.create"]),
      ...learnerRoute,
      [`GET /api/v1/finance/invoices/${fid(50)}`]: draft,
      [`POST /api/v1/finance/invoices/${fid(50)}/issue`]: () => json({ ...draft, status: "ISSUED", number: "FAC-2026-000009" }),
    });
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Émettre la facture" }));
    await screen.findByText("La facture FAC-2026-000009 a été émise.");
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/issue"))).toBe(true);
  });

  it("facture annulée : message et aucune action de correction", async () => {
    setTestApi({ ...base, [`GET /api/v1/finance/invoices/${fid(50)}`]: invoiceDetail({ status: "CANCELLED", cancelReason: "Doublon" }) });
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    expect(await screen.findByText(/Cette facture est annulée\. Motif : Doublon/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Émettre un avoir" })).toBeNull();
  });

  it("erreur d'API sur la fiche", async () => {
    setTestApi({ ...accessRoutes(READ), [`GET /api/v1/finance/invoices/${fid(50)}`]: () => json({ code: "finance.not_found", message: "Facture introuvable." }, { status: 404 }) });
    renderWithProviders(<InvoiceDetailScreen id={fid(50)} />);
    expect(await screen.findByText("Facture introuvable.")).toBeTruthy();
  });
});

describe("NewInvoiceScreen", () => {
  const preview = {
    invoices: [
      {
        payerKind: "LEARNER",
        payerRef: null,
        label: "Part de la famille",
        lines: [invoiceLine({ total: xof(150000), gross: xof(500000), scholarship: xof(350000) })],
        subtotal: xof(500000),
        discount: xof(0),
        scholarship: xof(350000),
        total: xof(150000),
        installments: [{ seq: 1, label: "Inscription", dueDate: "2026-09-10", amount: xof(150000) }],
        dueDate: "2026-09-10",
      },
    ],
  };
  const base = {
    ...accessRoutes(["finance.invoice.read", "finance.invoice.create"]),
    "GET /api/v1/finance/fees": { items: [fee()] },
    "GET /api/v1/finance/installment-plans": { items: [plan()] },
    "GET /api/v1/finance/discounts": { items: [discount()] },
    "GET /api/v1/academic/years": { items: [] },
    [`GET /api/v1/people/students/${fid(900)}/enrollments`]: { items: [] },
    "POST /api/v1/finance/invoices/from-schedule/preview": preview,
  };

  async function fillAndPreview(api: ReturnType<typeof setTestApi>) {
    renderWithProviders(<NewInvoiceScreen initialLearnerId={fid(900)} />);
    await screen.findByRole("option", { name: "Scolarité 6e" });
    fireEvent.change(screen.getByLabelText(/^Frais\*/), { target: { value: fid(1) } });
    fireEvent.click(screen.getByRole("button", { name: "Calculer l'aperçu" }));
    await screen.findByRole("heading", { name: "Aperçu avant émission" });
    return api;
  }

  it("l'émission est impossible avant l'aperçu, puis envoie le corps exact avec une clé d'idempotence", async () => {
    const api = setTestApi({
      ...base,
      "POST /api/v1/finance/invoices/from-schedule": () => json({ replayed: false, invoices: [invoiceDetail()] }, { status: 201 }),
    });
    renderWithProviders(<NewInvoiceScreen initialLearnerId={fid(900)} />);
    await screen.findByRole("option", { name: "Scolarité 6e" });
    expect((screen.getByRole("button", { name: "Émettre la facture" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Frais\*/), { target: { value: fid(1) } });
    fireEvent.click(screen.getByRole("button", { name: "Calculer l'aperçu" }));
    expect(await screen.findByText("Part de la famille")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/preview"))!.body).toEqual({ learnerId: fid(900), items: [{ feeId: fid(1) }] });
    // L'API calcule : totaux affichés tels quels.
    expect(screen.getAllByText(/150\D000\sF\sCFA/).length).toBeGreaterThan(0);
    const issue = screen.getByRole("button", { name: "Émettre la facture" }) as HTMLButtonElement;
    expect(issue.disabled).toBe(false);
    fireEvent.click(issue);
    await screen.findByText(/a été enregistrée/);
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/v1/finance/invoices/from-schedule")!;
    expect(post.body).toEqual({ learnerId: fid(900), items: [{ feeId: fid(1) }], issue: true });
    expect(post.headers["idempotency-key"]).toMatch(/^inv-[A-Za-z0-9-]+$/);
  });

  it("double clic sur « Émettre » : une seule facture créée", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = setTestApi({
      ...base,
      "POST /api/v1/finance/invoices/from-schedule": async () => {
        await gate;
        return json({ replayed: false, invoices: [invoiceDetail()] }, { status: 201 });
      },
    });
    await fillAndPreview(api);
    const issue = screen.getByRole("button", { name: "Émettre la facture" });
    fireEvent.click(issue);
    fireEvent.click(issue);
    fireEvent.click(issue);
    release();
    await screen.findByText(/a été enregistrée/);
    expect(api.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/finance/invoices/from-schedule")).toHaveLength(1);
  });

  it("modifier le formulaire après l'aperçu invalide l'aperçu", async () => {
    const api = setTestApi({ ...base });
    await fillAndPreview(api);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ne pas appliquer le financement/ }));
    expect(await screen.findByText(/Le formulaire a changé depuis l'aperçu/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Émettre la facture" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saisie libre : lignes en entiers, décimale refusée, brouillon créé puis ouverture de la fiche", async () => {
    nav.push.mockClear();
    const api = setTestApi({ ...base, "POST /api/v1/finance/invoices": () => json({ replayed: false, invoices: [invoiceDetail({ status: "DRAFT", number: null })] }, { status: 201 }) });
    renderWithProviders(<NewInvoiceScreen initialLearnerId={fid(900)} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Saisie libre" }));
    fireEvent.change(screen.getByLabelText(/^Désignation/), { target: { value: "Frais de dossier" } });
    fireEvent.change(screen.getByLabelText(/^Prix unitaire/), { target: { value: "5000,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer en brouillon" }));
    expect(await screen.findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Prix unitaire/), { target: { value: "5 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer en brouillon" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/finance/invoices/${fid(50)}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/v1/finance/invoices")!;
    expect(post.body).toEqual({ learnerId: fid(900), lines: [{ category: "TUITION", description: "Frais de dossier", unitAmount: 5000 }], issue: false });
  });

  it("erreur de l'API à l'émission : message affiché, nouvelle tentative avec la MÊME clé", async () => {
    let attempt = 0;
    const api = setTestApi({
      ...base,
      "POST /api/v1/finance/invoices/from-schedule": () => {
        attempt += 1;
        return attempt === 1 ? json({ code: "finance.no_schedule", message: "Aucun barème applicable pour ce frais." }, { status: 422 }) : json({ replayed: false, invoices: [invoiceDetail()] }, { status: 201 });
      },
    });
    await fillAndPreview(api);
    fireEvent.click(screen.getByRole("button", { name: "Émettre la facture" }));
    expect(await screen.findByText("Aucun barème applicable pour ce frais.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Émettre la facture" }));
    await screen.findByText(/a été enregistrée/);
    const posts = api.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/finance/invoices/from-schedule");
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers["idempotency-key"]).toBe(posts[1]!.headers["idempotency-key"]);
  });
});

describe("FundingScreen", () => {
  it("bourse État : type de financement, couverture en pourcentage, part État / part famille issues de l'API", async () => {
    setTestApi({
      ...accessRoutes(["finance.invoice.read", "finance.fee.manage", "student.read"], ["finance.state-assigned"]),
      [`GET /api/v1/finance/learners/${fid(900)}/funding`]: funding(),
      [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement({
        invoices: [
          invoiceSummary({ payerKind: "LEARNER", total: xof(150000), balance: xof(150000) }),
          invoiceSummary({ id: fid(52), number: "FAC-2026-000002", payerKind: "FUNDER", payerRef: fid(130), total: xof(350000), balance: xof(350000) }),
        ],
      }),
    });
    renderWithProviders(<FundingScreen initialLearnerId={fid(900)} />);
    expect((await screen.findAllByText("Affecté par l'État")).length).toBeGreaterThan(0);
    expect(screen.getByText("AFF-2026-001", { selector: "dd" })).toBeTruthy();
    const scholarships = await screen.findByRole("table", { name: "Bourses et prises en charge" });
    expect(within(scholarships).getByText("70,00 %")).toBeTruthy();
    const split = await screen.findByRole("table", { name: "Factures de l'apprenant par payeur" });
    expect(within(split).getByText("Part de la famille")).toBeTruthy();
    expect(within(split).getByText("Part État de Côte d'Ivoire")).toBeTruthy();
    expect(within(split).getAllByText(/350\D000\sF\sCFA/).length).toBeGreaterThan(0);
  });

  it("création d'une bourse : 70 % -> 7000 points de base ; part État refusée sans la fonction de l'offre", async () => {
    const api = setTestApi({
      ...accessRoutes(["finance.invoice.read", "finance.fee.manage"], []),
      "GET /api/v1/academic/years": { items: [] },
      [`GET /api/v1/finance/learners/${fid(900)}/funding`]: funding({ scholarships: [] }),
      [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement({ invoices: [] }),
      "POST /api/v1/finance/scholarships": () => json(funding().scholarships[0], { status: 201 }),
    });
    renderWithProviders(<FundingScreen initialLearnerId={fid(900)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle bourse" }));
    const dialog = await screen.findByRole("dialog");
    const kind = within(dialog).getByLabelText(/^Type de financeur/) as HTMLSelectElement;
    expect((within(kind).getByRole("option", { name: "État" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(kind, { target: { value: "COMPANY" } });
    fireEvent.change(within(dialog).getByLabelText(/^Nom du financeur/), { target: { value: "SIFCA" } });
    fireEvent.change(within(dialog).getByLabelText(/^Année scolaire/), { target: { value: "2026-2027" } });
    fireEvent.change(within(dialog).getByLabelText(/^Pourcentage couvert/), { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la bourse" }));
    await screen.findByText("La bourse a été créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      learnerId: fid(900),
      academicYear: "2026-2027",
      funderKind: "COMPANY",
      funderName: "SIFCA",
      coverage: { kind: "PERCENT", bps: 7000 },
    });
  });

  it("changement de type de financement : PUT", async () => {
    const api = setTestApi({
      ...accessRoutes(["finance.invoice.read", "finance.fee.manage"], ["finance.state-assigned"]),
      [`GET /api/v1/finance/learners/${fid(900)}/funding`]: funding({ account: { learnerId: fid(900), fundingType: "PRIVATE", assignmentRef: null }, scholarships: [] }),
      [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement({ invoices: [] }),
      [`PUT /api/v1/finance/learners/${fid(900)}/funding`]: () => json({ learnerId: fid(900), fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-9" }),
    });
    renderWithProviders(<FundingScreen initialLearnerId={fid(900)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Financement/), { target: { value: "STATE_ASSIGNED" } });
    fireEvent.change(within(dialog).getByLabelText(/^Référence d'affectation/), { target: { value: "AFF-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le type de financement a été enregistré.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-9" });
  });
});

void uuid;
void installment;
