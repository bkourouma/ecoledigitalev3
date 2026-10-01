import { describe, expect, it, vi } from "vitest";
import { resolvePwaMode, syncServiceWorker } from "./register";

describe("resolvePwaMode", () => {
  it("actif en production par défaut, inactif sinon", () => {
    expect(resolvePwaMode(undefined, "production")).toBe("enabled");
    expect(resolvePwaMode(undefined, "development")).toBe("disabled");
    expect(resolvePwaMode("", "test")).toBe("disabled");
  });

  it("NEXT_PUBLIC_PWA=1 force l'activation, =0 l'interdit même en production", () => {
    expect(resolvePwaMode("1", "development")).toBe("enabled");
    expect(resolvePwaMode("true", "development")).toBe("enabled");
    expect(resolvePwaMode("0", "production")).toBe("disabled");
    expect(resolvePwaMode("off", "production")).toBe("disabled");
  });
});

describe("syncServiceWorker", () => {
  const registration = () => ({ unregister: vi.fn(async () => true) });

  it("enregistre /sw.js à la racine quand c'est autorisé", async () => {
    const register = vi.fn(async () => ({}));
    const nav = { serviceWorker: { register, getRegistrations: vi.fn(async () => []) } };
    await expect(syncServiceWorker(nav, { flag: undefined, nodeEnv: "production" })).resolves.toBe("registered");
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("ne fait rien en développement sans drapeau", async () => {
    const register = vi.fn();
    const getRegistrations = vi.fn(async () => []);
    const nav = { serviceWorker: { register, getRegistrations } };
    await expect(syncServiceWorker(nav, { flag: undefined, nodeEnv: "development" })).resolves.toBe("skipped");
    expect(register).not.toHaveBeenCalled();
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("interrupteur d'arrêt (=0) : désinscrit les service workers existants", async () => {
    const regs = [registration(), registration()];
    const register = vi.fn();
    const nav = { serviceWorker: { register, getRegistrations: vi.fn(async () => regs) } };
    await expect(syncServiceWorker(nav, { flag: "0", nodeEnv: "production" })).resolves.toBe("unregistered");
    expect(regs.every((r) => r.unregister.mock.calls.length === 1)).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });

  it("navigateur sans service worker", async () => {
    await expect(syncServiceWorker({}, { flag: "1", nodeEnv: "production" })).resolves.toBe("unsupported");
  });
});
