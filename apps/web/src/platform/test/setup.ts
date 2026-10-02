import { afterEach } from "vitest";

// jsdom n'implémente pas ResizeObserver (utilisé par Radix : Checkbox, Popper…). Simple doublure inerte.
if (typeof window !== "undefined" && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// Attentes asynchrones plus tolérantes (1 s par défaut) : les écrans RTL lourds (Radix, react-query) dépassent parfois cette
// durée sur une machine chargée (plusieurs agents, CI partagée) sans qu'il s'agisse d'un défaut de l'écran.
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 4000 });
}

// Nettoyage du DOM entre les tests (Testing Library ne le fait pas sans `globals: true`).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
