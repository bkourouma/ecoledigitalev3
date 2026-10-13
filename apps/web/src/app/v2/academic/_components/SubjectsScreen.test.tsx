// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { SubjectsScreen } from "./SubjectsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const subject = (over: Record<string, unknown> = {}) => ({ id: uuid(900), institutionId: null, code: "MATH", label: "Mathématiques", shortLabel: null, domainCode: null, description: null, attributes: {}, status: "ACTIVE", ...over });

describe("SubjectsScreen — catalogue des matières (L-10)", () => {
  it("liste, crée (code validé par le contrat) et désactive une matière", async () => {
    const api = setTestApi({
      ...accessRoutes(["curriculum.read", "curriculum.manage"]),
      "GET /api/v1/academic/subjects": { items: [subject()] },
      "POST /api/v1/academic/subjects": () => json(subject({ id: uuid(901), code: "HIST", label: "Histoire" }), { status: 201 }),
      [`PATCH /api/v1/academic/subjects/${uuid(900)}`]: () => json(subject({ status: "INACTIVE" })),
    });
    renderWithProviders(<SubjectsScreen />);
    const table = await screen.findByRole("table", { name: "Matières de l'établissement" });
    expect(await within(table).findByText("Mathématiques")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle matière" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "histoire fr" } });
    fireEvent.change(within(dialog).getByLabelText(/^Intitulé(?! court)/), { target: { value: "Histoire" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "HIST" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Matière créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ code: "HIST", label: "Histoire" });

    fireEvent.click(within(table).getByRole("button", { name: /Modifier/ }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^État/), { target: { value: "INACTIVE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Matière modifiée.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ label: "Mathématiques", status: "INACTIVE" });
  }, 120_000);
});
