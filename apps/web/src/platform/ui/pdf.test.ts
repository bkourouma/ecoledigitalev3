// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/platform/api/errors";
import { setTestApi } from "@/platform/test/api-mock";
import { json } from "@/platform/test/render";
import { downloadPdf } from "./pdf";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const pdf = () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200, headers: { "content-type": "application/pdf" } });

describe("downloadPdf", () => {
  it("enregistre le PDF reçu (jeton dans l'en-tête, jamais un lien public)", async () => {
    const api = setTestApi({ "GET /api/v1/x/pdf": () => pdf() });
    const save = vi.fn();
    expect(await downloadPdf("/api/v1/x/pdf", "recu.pdf", { save })).toEqual({ state: "done" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toBe("recu.pdf");
    expect(api.calls[0]!.headers.authorization).toBe("Bearer jeton");
  });

  it("202 pendant le rendu : nouvelle interrogation puis enregistrement", async () => {
    let n = 0;
    const api = setTestApi({ "GET /api/v1/x/pdf": () => (++n < 3 ? json({ status: "RENDERING", retryAfterSeconds: 1 }, { status: 202 }) : pdf()) });
    const save = vi.fn();
    const sleep = vi.fn(async () => undefined);
    expect(await downloadPdf("/api/v1/x/pdf", "recu.pdf", { save, sleep })).toEqual({ state: "done" });
    expect(api.calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("document toujours en rendu : « en attente » signalé, rien d'enregistré, nombre d'essais borné", async () => {
    const api = setTestApi({ "GET /api/v1/x/pdf": () => json({ status: "RENDERING", retryAfterSeconds: 5 }, { status: 202 }) });
    const save = vi.fn();
    const out = await downloadPdf("/api/v1/x/pdf", "recu.pdf", { save, sleep: async () => undefined, attempts: 2 });
    expect(out).toEqual({ state: "pending", retryAfterSeconds: 5 });
    expect(save).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(3);
  });

  it("erreur de l'API (404 hors périmètre, 409 rendu échoué) remontée telle quelle", async () => {
    setTestApi({ "GET /api/v1/x/pdf": () => json({ code: "finance.not_found", message: "Ressource introuvable." }, { status: 404 }) });
    await expect(downloadPdf("/api/v1/x/pdf", "recu.pdf", { save: vi.fn() })).rejects.toMatchObject({ status: 404, message: "Ressource introuvable." } satisfies Partial<ApiError>);
  });
});
