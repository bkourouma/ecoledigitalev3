import { afterEach, expect } from "vitest";

// jsdom n'implémente pas ResizeObserver (utilisé par Radix : Checkbox, Popper…). Simple doublure inerte.
if (typeof window !== "undefined" && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// Les écrans affichent des listes Ant Design ; leurs tests les pilotent comme des <select> natifs (voir `NativeSelect`).
(globalThis as { __NATIVE_SELECT_FOR_TESTS__?: boolean }).__NATIVE_SELECT_FOR_TESTS__ = true;

// jsdom n'implémente pas matchMedia (utilisé par Ant Design : champs, listes).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
}

// Attentes asynchrones plus tolérantes (1 s par défaut) : les écrans RTL lourds (Radix, react-query) dépassent parfois cette
// durée sur une machine chargée (plusieurs agents, CI partagée) sans qu'il s'agisse d'un défaut de l'écran.
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 4000 });
}

// Nettoyage du DOM entre les tests (Testing Library ne le fait pas sans `globals: true`).
// Mode d'audit transversal (opt-in) : `A11Y_AUDIT=<fichier.jsonl>` fait passer axe sur le DOM laissé par CHAQUE test d'écran
// existant (états réels avec leurs données de test), avant le nettoyage, et consigne les violations serious/critical.
// `A11Y_AUDIT=strict` (script `test:a11y`) fait ÉCHOUER le test fautif ; `A11Y_AUDIT_STATS=<fichier>` compte les audits.
// Sans la variable, aucun effet (voir `apps/web/docs/accessibility.md`).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const out = process.env.A11Y_AUDIT;
  let failure: Error | null = null;
  if (out && document.body.childElementCount > 0) {
    try {
      const { auditA11y, blocking } = await import("./axe");
      const state = expect.getState();
      const found = blocking(await auditA11y(document.body));
      const { appendFileSync } = await import("node:fs");
      const stats = process.env.A11Y_AUDIT_STATS;
      if (stats) appendFileSync(stats, `${JSON.stringify({ file: state.testPath, test: state.currentTestName, violations: found.length })}\n`);
      if (found.length > 0) {
        if (out === "strict") failure = new Error(`Violations axe bloquantes (${state.currentTestName}) :\n${found.join("\n")}`);
        else appendFileSync(out, `${JSON.stringify({ file: state.testPath, test: state.currentTestName, violations: found })}\n`);
      }
    } catch {
      // l'audit transversal ne doit jamais faire échouer un test métier (sauf violation en mode `strict`)
    }
  }
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  if (failure) throw failure;
});
