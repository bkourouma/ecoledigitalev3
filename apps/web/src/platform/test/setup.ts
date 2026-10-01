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

// Nettoyage du DOM entre les tests (Testing Library ne le fait pas sans `globals: true`).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
