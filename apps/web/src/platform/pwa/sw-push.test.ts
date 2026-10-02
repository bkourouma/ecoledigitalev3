import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Web Push du service worker (public/sw.js) : affichage borné de ce que le serveur envoie, et lien de la notification
 * suivi UNIQUEMENT s'il est de même origine. Aucune écriture dans les caches.
 */
const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
const ORIGIN = "https://app.ecoledigitale.test";

type Listener = (event: Record<string, unknown>) => void;

function load() {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const focused: string[] = [];
  let windows: Array<{ url: string; focus: () => unknown }> = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void shown.push({ title, options })) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async (url: string) => void opened.push(url)), claim: vi.fn() },
  };
  const cjsModule = { exports: {} as Record<string, (...a: unknown[]) => unknown> };
  vm.runInNewContext(SW_SOURCE, { self, caches: {}, fetch: vi.fn(), URL, Response: class {}, Promise, module: cjsModule, Array, Set });
  const run = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => void (pending = Promise.resolve(p)) });
    await pending;
  };
  return {
    exports: cjsModule.exports,
    shown,
    opened,
    focused,
    setWindows: (w: string[]) => {
      windows = w.map((url) => ({ url, focus: () => void focused.push(url) }));
    },
    push: (data: unknown) => run("push", { data: { json: () => data } }),
    click: (data: unknown) => {
      const closed = vi.fn();
      return run("notificationclick", { notification: { close: closed, data } }).then(() => closed);
    },
  };
}

describe("sw.js — Web Push", () => {
  it("affiche un titre, un extrait borné et un lien de même origine", async () => {
    const sw = load();
    await sw.push({ title: "Facture", body: "x".repeat(500), url: `${ORIGIN}/v2/finance`, tag: "payment_reminder", urgent: true });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe("Facture");
    expect((sw.shown[0]!.options.body as string).length).toBe(300);
    expect(sw.shown[0]!.options.data).toEqual({ url: "/v2/finance" });
    expect(sw.shown[0]!.options.tag).toBe("payment_reminder");
    expect(sw.shown[0]!.options.requireInteraction).toBe(true);
  });

  it("une charge utile vide ou illisible n'empêche pas l'affichage (titre par défaut)", async () => {
    const sw = load();
    await sw.push(null);
    expect(sw.shown[0]!.title).toBe("EcoleDigitale");
    expect(sw.shown[0]!.options.data).toEqual({ url: "/v2" });
  });

  it("un lien d'une autre origine ou invalide est remplacé par l'accueil", () => {
    const { exports } = load();
    expect(exports.safeTargetUrl!("https://evil.example/phish", ORIGIN)).toBe("/v2");
    expect(exports.safeTargetUrl!("javascript:alert(1)", ORIGIN)).toBe("/v2");
    expect(exports.safeTargetUrl!("//evil.example/x", ORIGIN)).toBe("/v2");
    expect(exports.safeTargetUrl!(42, ORIGIN)).toBe("/v2");
    expect(exports.safeTargetUrl!("/v2/messages?x=1#a", ORIGIN)).toBe("/v2/messages?x=1#a");
  });

  it("le clic ferme la notification, réutilise l'onglet ouvert sinon ouvre le lien", async () => {
    const sw = load();
    sw.setWindows([`${ORIGIN}/v2/messages`]);
    const closed = await sw.click({ url: "/v2/messages" });
    expect(closed).toHaveBeenCalled();
    expect(sw.focused).toEqual([`${ORIGIN}/v2/messages`]);
    expect(sw.opened).toEqual([]);

    sw.setWindows([]);
    await sw.click({ url: "/v2/finance" });
    expect(sw.opened).toEqual(["/v2/finance"]);
  });
});
