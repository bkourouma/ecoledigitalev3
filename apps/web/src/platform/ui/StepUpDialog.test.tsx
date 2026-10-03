// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/platform/api/errors";
import { setTestApi } from "@/platform/test/api-mock";
import { expectNoBlockingViolations } from "@/platform/test/axe";
import { json, renderWithProviders } from "@/platform/test/render";
import { StepUpDialog } from "./StepUpDialog";
import { isMfaRequiredError, useStepUp } from "./useStepUp";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.setConfig({ testTimeout: 30_000 });

const STEP_UP = "POST /api/v1/iam/mfa/step-up";
const OK = { elevated: true, expiresAt: "2026-10-02T10:05:00.000Z", ttlSec: 300 };
const mfaError = (code = "rbac.mfa_required") => new ApiError({ code, message: "Authentification forte (MFA) requise pour cette action.", status: 403 });
const iamError = (status: number, code: string) => json({ code, message: "x", status }, { status });

function Harness({ action }: { action: () => Promise<string> }) {
  const stepUp = useStepUp();
  const [outcome, setOutcome] = useState("");
  return (
    <div>
      <button type="button" onClick={() => void stepUp.run(action).then((v) => setOutcome(`ok:${v}`), (e: ApiError) => setOutcome(`err:${e.code}`))}>
        Lancer
      </button>
      <p data-testid="outcome">{outcome}</p>
      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
}

const type = (code: string) => fireEvent.change(screen.getByLabelText(/Code à 6 chiffres/), { target: { value: code } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Confirmer et continuer" }));
const outcome = () => screen.getByTestId("outcome").textContent;

describe("isMfaRequiredError", () => {
  it("reconnaît tous les préfixes de module, uniquement en 403", () => {
    expect(isMfaRequiredError(mfaError("rbac.mfa_required"))).toBe(true);
    expect(isMfaRequiredError(mfaError("imports.mfa_required"))).toBe(true);
    expect(isMfaRequiredError(mfaError("reportcards.mfa_required"))).toBe(true);
    expect(isMfaRequiredError(new ApiError({ code: "rbac.mfa_required", message: "x", status: 401 }))).toBe(false);
    expect(isMfaRequiredError(mfaError("rbac.forbidden"))).toBe(false);
    expect(isMfaRequiredError(new Error("mfa_required"))).toBe(false);
  });
});

describe("useStepUp + StepUpDialog", () => {
  it("action réussie du premier coup : aucun dialogue, aucun appel de vérification", async () => {
    const api = setTestApi({ [STEP_UP]: OK });
    const action = vi.fn().mockResolvedValue("fait");
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await waitFor(() => expect(outcome()).toBe("ok:fait"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it("*.mfa_required : demande le code, vérifie, puis rejoue l'action UNE fois", async () => {
    const api = setTestApi({ [STEP_UP]: OK });
    const action = vi.fn().mockRejectedValueOnce(mfaError("imports.mfa_required")).mockResolvedValueOnce("fait");
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    expect(await screen.findByRole("dialog", { name: "Confirmez votre identité" })).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
    type("123 456");
    submit();
    await waitFor(() => expect(outcome()).toBe("ok:fait"));
    expect(action).toHaveBeenCalledTimes(2);
    const calls = api.calls.filter((c) => c.path === "/api/v1/iam/mfa/step-up");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ code: "123456" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("code invalide : message annoncé, dialogue ouvert, champ vidé, action non rejouée ; puis bon code", async () => {
    let attempt = 0;
    setTestApi({ [STEP_UP]: () => (++attempt === 1 ? iamError(401, "iam.mfa_invalid_code") : json(OK)) });
    const action = vi.fn().mockRejectedValueOnce(mfaError()).mockResolvedValueOnce("fait");
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("000000");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Code invalide");
    expect(action).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Code à 6 chiffres/) as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText(/Code à 6 chiffres/).getAttribute("aria-invalid")).toBe("true");
    type("654321");
    submit();
    await waitFor(() => expect(outcome()).toBe("ok:fait"));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("format invalide : refusé sans appel réseau", async () => {
    const api = setTestApi({ [STEP_UP]: OK });
    renderWithProviders(<Harness action={vi.fn().mockRejectedValueOnce(mfaError())} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("12ab");
    expect((screen.getByLabelText(/Code à 6 chiffres/) as HTMLInputElement).value).toBe("12");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("6 chiffres");
    expect(api.calls).toHaveLength(0);
  });

  it("limite de tentatives atteinte (429) : message dédié et saisie bloquée", async () => {
    setTestApi({ [STEP_UP]: () => iamError(429, "iam.too_many_attempts") });
    const action = vi.fn().mockRejectedValueOnce(mfaError());
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("111111");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Trop de tentatives");
    expect((screen.getByRole("button", { name: "Confirmer et continuer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Code à 6 chiffres/) as HTMLInputElement).disabled).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("MFA non activée sur le compte : explication, pas de nouvelle tentative possible", async () => {
    setTestApi({ [STEP_UP]: () => iamError(409, "iam.mfa_not_enabled") });
    renderWithProviders(<Harness action={vi.fn().mockRejectedValueOnce(mfaError())} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("111111");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("n'est pas activée");
    expect((screen.getByRole("button", { name: "Confirmer et continuer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("annuler : l'appelant reçoit l'erreur d'origine, l'action n'est pas rejouée", async () => {
    const api = setTestApi({ [STEP_UP]: OK });
    const action = vi.fn().mockRejectedValueOnce(mfaError());
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(outcome()).toBe("err:rbac.mfa_required"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Échap ferme le dialogue (annulation)", async () => {
    setTestApi({ [STEP_UP]: OK });
    renderWithProviders(<Harness action={vi.fn().mockRejectedValueOnce(mfaError())} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(outcome()).toBe("err:rbac.mfa_required"));
  });

  it("rejeu refusé à nouveau en mfa_required : une seule relance, pas de boucle, l'erreur remonte", async () => {
    setTestApi({ [STEP_UP]: OK });
    const action = vi.fn().mockRejectedValue(mfaError());
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("222222");
    submit();
    await waitFor(() => expect(outcome()).toBe("err:rbac.mfa_required"));
    expect(action).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("une autre erreur (403 sans MFA, 409…) traverse sans dialogue", async () => {
    const api = setTestApi({ [STEP_UP]: OK });
    const action = vi.fn().mockRejectedValue(new ApiError({ code: "finance.not_found", message: "x", status: 404 }));
    renderWithProviders(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await waitFor(() => expect(outcome()).toBe("err:finance.not_found"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it("le code saisi n'apparaît ni dans l'URL ni dans le stockage du navigateur", async () => {
    setTestApi({ [STEP_UP]: OK });
    renderWithProviders(<Harness action={vi.fn().mockRejectedValueOnce(mfaError()).mockResolvedValueOnce("ok")} />);
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await screen.findByRole("dialog");
    type("987654");
    submit();
    await waitFor(() => expect(outcome()).toBe("ok:ok"));
    expect(window.location.href).not.toContain("987654");
    expect(JSON.stringify({ ...localStorage })).not.toContain("987654");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("987654");
  });
});

describe("StepUpDialog accessibilité", () => {
  it("fenêtre nommée, champ libellé et relié à son aide : aucune violation axe, focus dans le dialogue", async () => {
    renderWithProviders(<StepUpDialog open pending={false} error={null} onSubmit={() => undefined} onCancel={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const input = screen.getByLabelText(/Code à 6 chiffres/);
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("aria-describedby")).toContain("-hint");
    await expectNoBlockingViolations(document.body);
  });

  it("état d'erreur : région d'alerte annoncée (aria-live) et aucune violation axe", async () => {
    renderWithProviders(<StepUpDialog open pending={false} error={new ApiError({ code: "iam.mfa_invalid_code", message: "x", status: 401 })} onSubmit={() => undefined} onCancel={() => undefined} />);
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("Code invalide");
    await expectNoBlockingViolations(document.body);
  });

  it("état de limite atteinte : aucune violation axe", async () => {
    renderWithProviders(<StepUpDialog open pending={false} error={new ApiError({ code: "iam.too_many_attempts", message: "x", status: 429 })} onSubmit={() => undefined} onCancel={() => undefined} />);
    await screen.findByText(/Trop de tentatives/);
    await expectNoBlockingViolations(document.body);
  });

  it("vérification en cours : annoncée aux lecteurs d'écran", async () => {
    renderWithProviders(<StepUpDialog open pending error={null} onSubmit={() => undefined} onCancel={() => undefined} />);
    await screen.findByRole("dialog");
    expect(screen.getByText("Vérification en cours…").closest("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });
});
