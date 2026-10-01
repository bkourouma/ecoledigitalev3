import { afterEach } from "vitest";

// Nettoyage du DOM entre les tests (Testing Library ne le fait pas sans `globals: true`).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
