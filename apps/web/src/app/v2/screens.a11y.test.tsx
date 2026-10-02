// @vitest-environment jsdom
import { configure, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { expectNoBlockingViolations } from "@/platform/test/axe";
import { board, campaign, IDS, lookups, publicForm, settings, SLUG, uuid } from "./admissions/_test/fixtures";
import { PipelineScreen } from "./admissions/_components/PipelineScreen";
import { PublicFormScreen } from "./apply/_components/PublicFormScreen";
import { PublicTrackScreen } from "./apply/_components/PublicTrackScreen";
import { GradeEntryScreen } from "./assessments/_components/GradeEntry";
import { assessment, assessmentType, grade, SETTINGS, STUDENTS } from "./assessments/_test/fixtures";
import { classroom } from "./_test/fixtures";
import { VerifyScreen } from "./verify/_components/VerifyScreen";

/**
 * Passe axe (0 violation serious/critical) sur un écran représentatif par module à fort enjeu, avec les données de test
 * du module. Le balayage de TOUS les écrans existants se fait avec `pnpm test:a11y` (voir `docs/accessibility.md`).
 */
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admissions", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(() => vi.restoreAllMocks());

const A = "/api/v1/admissions";

describe("accessibilité (axe) des écrans représentatifs", () => {
  it("admissions : kanban du pipeline, puis dialogue de déplacement ouvert", async () => {
    setTestApi({
      ...accessRoutes(["admission.read", "admission.application.transition"]),
      [`GET ${A}/campaigns`]: { items: [campaign()] },
      [`GET ${A}/lookups`]: lookups,
      [`GET ${A}/settings`]: settings(),
      [`GET ${A}/applications/board`]: board(),
    });
    const { container } = renderWithProviders(<PipelineScreen />);
    const region = await screen.findByRole("region", { name: "Tableau des étapes de candidature" });
    await expectNoBlockingViolations(container);
    fireEvent.click(within(region).getByRole("button", { name: "Déplacer le dossier de Awa KONÉ" }));
    await expectNoBlockingViolations(document.body);
  });

  it("saisie de notes : grille de notes", async () => {
    setTestApi({
      ...accessRoutes(["grade.enter", "grade.read", "assessment.read"]),
      [`GET /api/v1/assess/assessments/${uuid(800)}/grades`]: {
        assessment: assessment({ status: "DRAFT" }),
        grades: [grade(1, { score: "12.000", entryStatus: "ENTERED" }), grade(2)],
        pending: [{ enrollmentId: uuid(2003), studentId: uuid(3003) }],
      },
      "GET /api/v1/people/students": STUDENTS,
      "GET /api/v1/assess/settings": SETTINGS,
      "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
      [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: { items: [] },
      [`GET /api/v1/assess/classrooms/${uuid(500)}/periods/${uuid(200)}/lock`]: { lock: null },
    });
    const { container } = renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    await screen.findByLabelText("Note de Aka Marie");
    await expectNoBlockingViolations(container);
  });

  it("pages publiques : candidature, suivi, vérification de document", async () => {
    setTestApi({ [`GET /api/v1/public/admissions/forms/${SLUG}`]: publicForm() });
    const form = renderWithProviders(<PublicFormScreen school={SLUG} />);
    await screen.findByRole("heading", { level: 1 });
    await expectNoBlockingViolations(form.container);
    form.unmount();

    const track = renderWithProviders(<PublicTrackScreen school={SLUG} />);
    await expectNoBlockingViolations(track.container);
    track.unmount();

    setTestApi({ "GET /api/v1/public/verify/ABCDEFGHIJKLMNOPQRSTUVWXYZ": () => json({ code: "NOT_FOUND", message: "Introuvable" }, { status: 404 }) });
    const verify = renderWithProviders(<VerifyScreen initialCode="ABCDEFGHIJKLMNOPQRSTUVWXYZ" />);
    await screen.findByRole("heading", { level: 1 });
    await expectNoBlockingViolations(verify.container);
  });
});

void IDS;
