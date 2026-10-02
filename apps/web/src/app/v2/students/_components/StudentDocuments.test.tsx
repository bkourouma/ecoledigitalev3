// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { peopleStudentDocumentDtoSchema } from "@ecoledigitale/contracts/v2/people";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { checkFile, DocumentsTab, formatBytes } from "./StudentDocuments";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const S = uuid(2000);
const D = `/api/v1/people/students/${S}/documents`;
const READ = accessRoutes(["student.sensitive.read"]);
const WRITE = accessRoutes(["student.sensitive.read", "student.update"]);

function doc(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(5000),
    studentId: S,
    typeCode: "ID_CARD",
    title: "Carte d'identité de l'élève",
    fileName: "cni.pdf",
    contentType: "application/pdf",
    sizeBytes: 250_000,
    sha256: "a".repeat(64),
    version: 1,
    supersedesId: null,
    status: "ACTIVE",
    issuedOn: "2024-01-10",
    expiresOn: "2034-01-09",
    expiryState: "VALID",
    daysLeft: 2700,
    uploadedBy: null,
    uploadedAt: "2026-09-05T08:00:00.000Z",
    replacedAt: null,
    removedAt: null,
    removedReason: null,
    ...over,
  };
}

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const pdf = (name = "cni.pdf") => new File([new Uint8Array(PDF_BYTES)], name, { type: "application/pdf" });
const pick = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } });

describe("pur", () => {
  it("fixtures conformes au contrat ; contrôle de commodité du fichier ; taille lisible", () => {
    expect(peopleStudentDocumentDtoSchema.safeParse(doc()).success).toBe(true);
    expect(checkFile(null)).toBe("required");
    expect(checkFile(new File(["x"], "a.exe", { type: "application/x-msdownload" }))).toBe("badType");
    expect(checkFile(pdf())).toBeNull();
    const big = pdf();
    Object.defineProperty(big, "size", { value: 8 * 1024 * 1024 + 1 });
    expect(checkFile(big)).toBe("tooLarge");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(250_000)).toBe("244 Ko");
    expect(formatBytes(3 * 1024 * 1024 + 200_000)).toBe("3,2 Mo");
  });
});

describe("DocumentsTab — lecture", () => {
  it("regroupe par type, affiche l'échéance donnée par le serveur et rappelle que la lecture est auditée", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${D}`]: {
        items: [
          doc(),
          doc({ id: uuid(5001), typeCode: "MEDICAL_CERTIFICATE", title: null, fileName: "certif.png", contentType: "image/png", expiresOn: "2026-10-20", expiryState: "EXPIRING", daysLeft: 18 }),
          doc({ id: uuid(5002), typeCode: "BIRTH_CERTIFICATE", title: "Acte", expiresOn: "2026-09-01", expiryState: "EXPIRED", daysLeft: -31 }),
          doc({ id: uuid(5003), typeCode: "OTHER", title: "Attestation", expiresOn: null, issuedOn: null, expiryState: "NO_EXPIRY", daysLeft: null }),
        ],
      },
    });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(await screen.findByText("Chaque consultation de ces pièces est enregistrée dans le journal d'audit de l'établissement.")).toBeTruthy();
    const idList = await screen.findByRole("list", { name: "Pièce d'identité" });
    expect(within(idList).getByText("Valide")).toBeTruthy();
    expect(within(idList).getByText("Version 1")).toBeTruthy();
    expect(within(idList).getByText("244 Ko")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Certificat médical" })).getByText("Bientôt échue")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Certificat médical" })).getByText("encore 18 jours")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Acte de naissance" })).getByText("Échue")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Acte de naissance" })).getByText("échue depuis 31 jours")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Autre pièce" })).getByText("Sans échéance")).toBeTruthy();
    expect(api.calls.find((c) => c.path === D)!.query).toEqual({});
    // Lecture seule : aucune action d'écriture, mais la consultation reste possible.
    expect(screen.queryByRole("button", { name: "Déposer une pièce" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remplacer —/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retirer —/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Ouvrir —/ })).toHaveLength(4);
  });

  it("filtre « à renouveler » et historique : paramètres envoyés au serveur ; versions remplacées et retirées sans action", async () => {
    const api = setTestApi({
      ...WRITE,
      [`GET ${D}`]: ({ url }) =>
        json({
          items: url.searchParams.get("includeHistory")
            ? [doc({ id: uuid(5010), version: 2, supersedesId: uuid(5009) }), doc({ id: uuid(5009), status: "REPLACED", expiryState: "VALID", replacedAt: "2026-09-06T08:00:00.000Z" }), doc({ id: uuid(5011), typeCode: "OTHER", title: "Ancienne", status: "REMOVED", removedReason: "Pièce illisible", removedAt: "2026-09-07T08:00:00.000Z" })]
            : [doc({ id: uuid(5010), version: 2 })],
        }),
    });
    renderWithProviders(<DocumentsTab studentId={S} />);
    await screen.findByText("Carte d'identité de l'élève");
    fireEvent.change(screen.getByLabelText("Échéance"), { target: { value: "EXPIRING" } });
    await waitFor(() => expect(api.calls.some((c) => c.query.expiry === "EXPIRING")).toBe(true));
    fireEvent.change(screen.getByLabelText("Échéance"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Afficher l'historique/ }));
    await screen.findByText("Version remplacée par une plus récente.");
    expect(api.calls.some((c) => c.query.includeHistory === "true")).toBe(true);
    expect(screen.getByText("Motif du retrait : Pièce illisible")).toBeTruthy();
    expect(screen.getByText("Remplacée")).toBeTruthy();
    expect(screen.getByText("Retirée")).toBeTruthy();
    // Aucune action sur une version remplacée ni sur une pièce retirée.
    expect(screen.queryByRole("button", { name: /Ouvrir — Ancienne/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Remplacer —/ })).toHaveLength(1);
  });

  it("filtre sans résultat : message dédié ; aucune pièce : invitation à déposer", async () => {
    setTestApi({ ...WRITE, [`GET ${D}`]: { items: [] } });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(await screen.findByText("Aucune pièce au dossier.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Échéance"), { target: { value: "EXPIRED" } });
    expect(await screen.findByText("Aucune pièce ne correspond à ce filtre.")).toBeTruthy();
  });

  it("sans student.sensitive.read : état « accès restreint », aucune requête de pièces", async () => {
    const api = setTestApi({ ...accessRoutes(["student.read"]), [`GET ${D}`]: { items: [doc()] } });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(await screen.findByText("Accès restreint")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.calls.some((c) => c.path === D)).toBe(false);
  });

  it("403 du serveur (authentification renforcée requise) : accès restreint avec le message de l'API, pas une erreur", async () => {
    setTestApi({ ...READ, [`GET ${D}`]: () => json({ code: "iam.mfa_required", message: "Une authentification renforcée est requise." }, { status: 403 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(await screen.findByText("Accès restreint")).toBeTruthy();
    expect(screen.getByText("Une authentification renforcée est requise.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });

  it("erreur de chargement : message du serveur et bouton Réessayer", async () => {
    setTestApi({ ...READ, [`GET ${D}`]: () => json({ code: "people.unavailable", message: "Le stockage est indisponible." }, { status: 503 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("DocumentsTab — consultation", () => {
  it("demande l'URL signée au clic, l'ouvre dans un nouvel onglet et ne l'affiche jamais", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = setTestApi({
      ...READ,
      [`GET ${D}`]: { items: [doc()] },
      [`GET ${D}/${uuid(5000)}/url`]: { url: "https://stockage.test/signe?sig=SECRET", expiresInSec: 300, fileName: "cni.pdf", contentType: "application/pdf" },
    });
    renderWithProviders(<DocumentsTab studentId={S} />);
    expect(api.calls.some((c) => c.path.endsWith("/url"))).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: /Ouvrir — Carte d'identité de l'élève/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.test/signe?sig=SECRET", "_blank", "noopener,noreferrer"));
    expect(document.body.textContent).not.toContain("SECRET");
    expect(document.body.innerHTML).not.toContain("stockage.test");
  });

  it("refus du serveur : message affiché, aucun onglet ouvert", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setTestApi({ ...READ, [`GET ${D}`]: { items: [doc()] }, [`GET ${D}/${uuid(5000)}/url`]: () => json({ code: "people.document_unavailable", message: "Cette pièce n'est plus consultable." }, { status: 410 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ouvrir —/ }));
    expect(await screen.findByText("Cette pièce n'est plus consultable.")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("DocumentsTab — dépôt", () => {
  it("contrôles de commodité sans appel (aucun fichier, format refusé, trop gros), puis corps binaire et métadonnées exacts", async () => {
    const api = setTestApi({ ...WRITE, [`GET ${D}`]: { items: [] }, [`PUT ${D}`]: () => json(doc({ id: uuid(5100) }), { status: 201 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: "Déposer une pièce" }));
    const dialog = await screen.findByRole("dialog", { name: "Déposer une pièce" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(within(dialog).getByText("Choisissez un fichier.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    const input = within(dialog).getByLabelText(/^Fichier/);
    pick(input, new File(["MZ"], "virus.exe", { type: "application/x-msdownload" }));
    expect(await within(dialog).findByText("Format non accepté : PDF, JPEG, PNG ou WebP uniquement.")).toBeTruthy();
    const big = pdf("gros.pdf");
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    pick(input, big);
    expect(await within(dialog).findByText("Le fichier dépasse 8 Mo.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    pick(input, pdf());
    fireEvent.change(within(dialog).getByLabelText(/Type de pièce/), { target: { value: "ID_CARD" } });
    fireEvent.change(within(dialog).getByLabelText(/^Intitulé/), { target: { value: "CNI de Awa" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'émission/), { target: { value: "2024-01-10" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'expiration/), { target: { value: "2034-01-09" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await screen.findByText("La pièce « CNI de Awa » est déposée.");
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe(D);
    expect(put.query).toEqual({ typeCode: "ID_CARD", fileName: "cni.pdf", title: "CNI de Awa", issuedOn: "2024-01-10", expiresOn: "2034-01-09" });
    expect(put.headers["content-type"]).toBe("application/pdf");
    // Octets exacts du fichier, pas du JSON.
    expect(Array.from(put.body as Uint8Array)).toEqual(PDF_BYTES);
  });

  it("expiration antérieure à l'émission : refusée par le contrat sans appel", async () => {
    const api = setTestApi({ ...WRITE, [`GET ${D}`]: { items: [] } });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: "Déposer une pièce" }));
    const dialog = await screen.findByRole("dialog");
    pick(within(dialog).getByLabelText(/^Fichier/), pdf());
    fireEvent.change(within(dialog).getByLabelText(/Type de pièce/), { target: { value: "OTHER" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'émission/), { target: { value: "2026-05-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'expiration/), { target: { value: "2026-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText("L'expiration précède la date d'émission.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("doublon (409 people.document_exists) : message du serveur et proposition de remplacer la pièce active", async () => {
    const api = setTestApi({
      ...WRITE,
      [`GET ${D}`]: { items: [doc()] },
      [`PUT ${D}`]: () => json({ code: "people.document_exists", message: "Une pièce de ce type existe déjà : remplacez-la." }, { status: 409 }),
      [`PUT ${D}/${uuid(5000)}`]: () => json(doc({ version: 2 }), { status: 201 }),
    });
    renderWithProviders(<DocumentsTab studentId={S} />);
    await screen.findByText("Carte d'identité de l'élève");
    fireEvent.click(screen.getByRole("button", { name: "Déposer une pièce" }));
    const dialog = await screen.findByRole("dialog", { name: "Déposer une pièce" });
    pick(within(dialog).getByLabelText(/^Fichier/), pdf("nouvelle.pdf"));
    fireEvent.change(within(dialog).getByLabelText(/Type de pièce/), { target: { value: "ID_CARD" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText("Une pièce de ce type existe déjà : remplacez-la.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer la pièce existante" }));
    await screen.findByText(/est remplacée par une nouvelle version/);
    const replace = api.calls.filter((c) => c.method === "PUT")[1]!;
    expect(replace.path).toBe(`${D}/${uuid(5000)}`);
    expect(replace.query).toEqual({ fileName: "nouvelle.pdf" });
    expect(Array.from(replace.body as Uint8Array)).toEqual(PDF_BYTES);
  });

  it("refus de format par le serveur (octets réels) : message affiché dans la boîte", async () => {
    setTestApi({
      ...WRITE,
      [`GET ${D}`]: { items: [] },
      [`PUT ${D}`]: () => json({ code: "people.document_type_mismatch", message: "Le contenu du fichier ne correspond pas à un PDF." }, { status: 400 }),
    });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: "Déposer une pièce" }));
    const dialog = await screen.findByRole("dialog");
    pick(within(dialog).getByLabelText(/^Fichier/), pdf());
    fireEvent.change(within(dialog).getByLabelText(/Type de pièce/), { target: { value: "OTHER" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText("Le contenu du fichier ne correspond pas à un PDF.")).toBeTruthy();
  });
});

describe("DocumentsTab — remplacement, dates, retrait", () => {
  it("remplacer : nouvelle version envoyée en binaire à l'identifiant de la pièce, sans le type", async () => {
    const api = setTestApi({ ...WRITE, [`GET ${D}`]: { items: [doc()] }, [`PUT ${D}/${uuid(5000)}`]: () => json(doc({ version: 2 }), { status: 201 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: /Remplacer — Carte d'identité de l'élève/ }));
    const dialog = await screen.findByRole("dialog", { name: /Remplacer « Carte d'identité de l'élève »/ });
    expect(within(dialog).getByText(/version 2/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    expect(await within(dialog).findByText("Choisissez un fichier.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    pick(within(dialog).getByLabelText(/^Fichier/), pdf("cni-v2.pdf"));
    fireEvent.change(within(dialog).getByLabelText(/Date d'expiration/), { target: { value: "2036-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    await screen.findByText(/est remplacée par une nouvelle version/);
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.query).toEqual({ fileName: "cni-v2.pdf", title: "Carte d'identité de l'élève", expiresOn: "2036-01-01" });
    expect(Array.from(put.body as Uint8Array)).toEqual(PDF_BYTES);
  });

  it("modifier : seuls les champs changés partent (PATCH), une date vidée devient null", async () => {
    const api = setTestApi({ ...WRITE, [`GET ${D}`]: { items: [doc()] }, [`PATCH ${D}/${uuid(5000)}`]: () => json(doc({ expiresOn: null, expiryState: "NO_EXPIRY", daysLeft: null, title: "CNI" })) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: /Modifier — Carte d'identité de l'élève/ }));
    const dialog = await screen.findByRole("dialog", { name: /Modifier « Carte d'identité de l'élève »/ });
    fireEvent.change(within(dialog).getByLabelText(/^Intitulé/), { target: { value: "CNI" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'expiration/), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Les informations de la pièce sont enregistrées.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ title: "CNI", expiresOn: null });
  });

  it("retirer : motif d'au moins 5 caractères, puis POST /remove avec le motif", async () => {
    const api = setTestApi({ ...WRITE, [`GET ${D}`]: { items: [doc()] }, [`POST ${D}/${uuid(5000)}/remove`]: { removed: true } });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: /Retirer — Carte d'identité de l'élève/ }));
    const dialog = await screen.findByRole("dialog", { name: /Retirer la pièce/ });
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "ok" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Pièce illisible" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await screen.findByText("La pièce « Carte d'identité de l'élève » est retirée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Pièce illisible" });
  });

  it("retrait refusé par le serveur : message affiché dans la boîte", async () => {
    setTestApi({ ...WRITE, [`GET ${D}`]: { items: [doc()] }, [`POST ${D}/${uuid(5000)}/remove`]: () => json({ code: "people.document_locked", message: "Cette pièce est exigée par une inscription en cours." }, { status: 409 }) });
    renderWithProviders(<DocumentsTab studentId={S} />);
    fireEvent.click(await screen.findByRole("button", { name: /Retirer —/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Doublon de dossier" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    expect(await within(dialog).findByText("Cette pièce est exigée par une inscription en cours.")).toBeTruthy();
  });
});
