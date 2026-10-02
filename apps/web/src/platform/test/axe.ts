import axe from "axe-core";

/**
 * Audit d'accessibilité (axe-core, WCAG 2.0/2.1 A + AA + bonnes pratiques) d'un fragment DOM rendu par Testing Library.
 *
 * Limites assumées de jsdom : pas de mise en page ni de CSS réel, donc `color-contrast` (vérifié séparément sur les jetons
 * de couleur, voir `contrast.test.ts`) et les règles de mise en page ne sont pas fiables ici. Les règles de page entière
 * (`region`, `landmark-one-main`, `page-has-heading-one`, `bypass`) sont désactivées car on audite des écrans isolés,
 * sans la coquille ; la coquille est auditée à part (`shell.a11y.test.tsx`).
 */
export const IMPACTS_BLOCKING = ["serious", "critical"] as const;

const DISABLED_RULES = ["color-contrast", "region", "landmark-one-main", "page-has-heading-one", "bypass", "scrollable-region-focusable"];

export async function auditA11y(root: Element = document.body, extraDisabled: string[] = []): Promise<axe.Result[]> {
  const rules: Record<string, { enabled: boolean }> = {};
  for (const id of [...DISABLED_RULES, ...extraDisabled]) rules[id] = { enabled: false };
  const results = await axe.run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
    rules,
  });
  return results.violations;
}

/** Violations bloquantes (serious/critical) formatées pour un message d'échec lisible. */
export function blocking(violations: axe.Result[]): string[] {
  return violations
    .filter((v) => v.impact && (IMPACTS_BLOCKING as readonly string[]).includes(v.impact))
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.html.slice(0, 160)).join(" | ")}`);
}

/** Vérifie 0 violation serious/critical ; les autres sont rapportées en avertissement console (A11Y_VERBOSE=1). */
export async function expectNoBlockingViolations(root: Element = document.body, extraDisabled: string[] = []): Promise<void> {
  const violations = await auditA11y(root, extraDisabled);
  const list = blocking(violations);
  if (list.length > 0) throw new Error(`Violations axe bloquantes :\n${list.join("\n")}`);
  const minor = violations.filter((v) => !v.impact || !(IMPACTS_BLOCKING as readonly string[]).includes(v.impact));
  if (minor.length > 0 && process.env.A11Y_VERBOSE) console.warn(`axe (non bloquant) : ${minor.map((v) => `${v.id}(${v.impact})`).join(", ")}`);
}
