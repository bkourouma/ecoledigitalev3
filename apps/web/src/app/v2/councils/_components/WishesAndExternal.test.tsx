// @vitest-environment jsdom
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { gradeLevels, program } from "../../_test/fixtures";
import { guardian } from "../../_test/fixtures-people";
import { agendaDto, councilDto, detailDto, IDS, referenceDto, uuid } from "../_test/fixtures";
import { CouncilFileScreen } from "./CouncilFileScreen";
import { OrientationScreen } from "./OrientationScreen";

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const C = "/api/v1/councils";
const COUNCIL = `${C}/councils/${IDS.council}`;
const FILE = uuid(7001);

const orientationFile = (over: Record<string, unknown> = {}) => ({
  id: FILE,
  institutionId: uuid(1),
  academicYearId: uuid(2),
  enrollmentId: uuid(3),
  studentId: uuid(4),
  studentName: "Awa KONE",
  currentProgramId: program().id,
  currentGradeLevelId: gradeLevels[0]!.id,
  status: "OPEN",
  guardianConsent: "PENDING",
  consentRecordedAt: null,
  decisionId: null,
  notes: null,
  wishes: [],
  createdAt: "2026-09-01T08:00:00.000Z",
  ...over,
});

describe("OrientationScreen : vœux d'orientation et consentement du tuteur", () => {
  const routes = (perms: string[], files: unknown[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms),
    [`GET ${C}/orientation-paths`]: { items: [] },
    [`GET ${C}/orientation-files`]: { items: files, total: files.length, page: 1, pageSize: 100 },
    [`GET ${C}/series-transfers`]: { items: [] },
    "GET /api/v1/academic/programs": { items: [program()] },
    "GET /api/v1/academic/reference/grade-levels": { items: gradeLevels },
    ...extra,
  });

  it("valide le vœu côté client, l'envoie, puis consigne le consentement choisi", async () => {
    const api = setTestApi(
      routes(["council.orientation.read", "council.orientation.manage"], [orientationFile()], {
        [`POST ${C}/orientation-files/${FILE}/wishes`]: () => json(orientationFile({ status: "WISHES_COLLECTED" })),
        [`POST ${C}/orientation-files/${FILE}/consent`]: () => json(orientationFile({ guardianConsent: "GIVEN" })),
      }),
    );
    renderWithProviders(<OrientationScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un vœu pour Awa KONE" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le vœu" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Série souhaitée/), { target: { value: program().id } });
    fireEvent.change(within(dialog).getByLabelText(/^Niveau souhaité/), { target: { value: gradeLevels[0]!.id } });
    fireEvent.change(within(dialog).getByLabelText("Consentement du tuteur"), { target: { value: "GIVEN" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le vœu" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/consent"))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith("/wishes"))!.body).toEqual({ rank: 1, toProgramId: program().id, toGradeLevelId: gradeLevels[0]!.id, source: "GUARDIAN", optionIds: [] });
    expect(api.calls.find((c) => c.path.endsWith("/consent"))!.body).toEqual({ state: "GIVEN" });
    expect(await screen.findByText("Vœu enregistré.")).toBeTruthy();
  });

  it("sans permission de gestion ou dossier appliqué : pas de bouton de vœu", async () => {
    setTestApi(routes(["council.orientation.read"], [orientationFile()]));
    const first = renderWithProviders(<OrientationScreen />);
    await screen.findByText("Awa KONE");
    expect(screen.queryByRole("button", { name: /Ajouter un vœu/ })).toBeNull();
    first.unmount();
    setTestApi(routes(["council.orientation.read", "council.orientation.manage"], [orientationFile({ status: "APPLIED", guardianConsent: "GIVEN" })]));
    renderWithProviders(<OrientationScreen />);
    await screen.findByText("Awa KONE");
    expect(screen.queryByRole("button", { name: /Ajouter un vœu/ })).toBeNull();
  });
});

describe("CouncilFileScreen : participant externe", () => {
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms),
    [`GET ${COUNCIL}`]: detailDto({ council: councilDto() }),
    [`GET ${COUNCIL}/agenda`]: agendaDto(),
    [`GET ${COUNCIL}/proposed-participants`]: { items: [] },
    [`GET ${C}/reference`]: referenceDto(),
    ...extra,
  });
  const GUARDIANS = "GET /api/v1/people/guardians";

  it("recherche un tuteur du registre et ajoute sa personne (personId) à la feuille de présence", async () => {
    const api = setTestApi(
      routes(["council.read", "council.manage", "guardian.read"], {
        [GUARDIANS]: { items: [guardian()], total: 1, limit: 20, offset: 0 },
        [`POST ${COUNCIL}/participants`]: () => json(detailDto().participants[0]),
      }),
    );
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un participant" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Type de participant"), { target: { value: "external" } });
    fireEvent.change(within(dialog).getByLabelText(/Rechercher une personne externe/), { target: { value: "kon" } });
    const select = await within(dialog).findByLabelText(/^Personne externe/);
    fireEvent.change(select, { target: { value: guardian().personId } });
    fireEvent.change(within(dialog).getByLabelText(/^Rôle/), { target: { value: referenceDto().roles[0]!.code } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/participants"))).toBe(true));
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/participants"))!.body).toMatchObject({ personId: guardian().personId, displayName: "KONE Mariam" });
  });

  it("sans guardian.read : le choix « personne externe » n'est pas proposé", async () => {
    setTestApi(routes(["council.read", "council.manage"]));
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un participant" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Type de participant")).toBeNull();
  });
});
