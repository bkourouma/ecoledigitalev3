// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/platform/api/errors";
import { renderWithProviders } from "@/platform/test/render";
import { describeError } from "./errors";
import { ReasonDialog } from "./ModalDialog";

function open(onConfirm = vi.fn(), error?: unknown) {
  renderWithProviders(<ReasonDialog open onOpenChange={() => undefined} title="Clôturer l'année" reasonLabel="Motif" confirmLabel="Clôturer" onConfirm={onConfirm} error={error} />);
  return onConfirm;
}

describe("ReasonDialog", () => {
  it("expose une boîte de dialogue nommée et refuse un motif trop court (contrat : 5 caractères)", () => {
    const onConfirm = open();
    expect(screen.getByRole("dialog", { name: "Clôturer l'année" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Clôturer" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("au moins 5 caractères");
    expect(screen.getByLabelText(/Motif/).getAttribute("aria-invalid")).toBe("true");
  });

  it("transmet le motif nettoyé", async () => {
    const onConfirm = open();
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: "  Fin de l'exercice  " } });
    fireEvent.click(screen.getByRole("button", { name: "Clôturer" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Fin de l'exercice"));
  });

  it("affiche l'erreur de l'API", () => {
    open(vi.fn(), new ApiError({ code: "academic.year_has_open_periods", message: "Des périodes sont encore ouvertes.", status: 409 }));
    expect(screen.getByRole("alert").textContent).toContain("Des périodes sont encore ouvertes.");
  });
});

describe("describeError", () => {
  const tErr = (k: string) => `E:${k}`;
  const tCom = (k: string) => `C:${k}`;
  it("erreurs métier : message du serveur ; techniques : message traduit", () => {
    expect(describeError(new ApiError({ code: "academic.offering_full", message: "L'offre est complète.", status: 409 }), tErr, tCom)).toBe("L'offre est complète.");
    expect(describeError(new ApiError({ code: "NETWORK_ERROR", message: "x" }), tErr, tCom)).toBe("E:network");
    expect(describeError(new ApiError({ code: "TIMEOUT", message: "x" }), tErr, tCom)).toBe("E:timeout");
    expect(describeError(new ApiError({ code: "TENANT_UNKNOWN", message: "x" }), tErr, tCom)).toBe("C:tenantUnknown");
    expect(describeError(new ApiError({ code: "UNAUTHORIZED", message: "x", status: 401 }), tErr, tCom)).toBe("E:unauthorized");
    expect(describeError(new ApiError({ code: "INTERNAL", message: "stack SQL ...", status: 500 }), tErr, tCom)).toBe("E:generic");
    expect(describeError("boom", tErr, tCom)).toBe("E:generic");
  });
});
