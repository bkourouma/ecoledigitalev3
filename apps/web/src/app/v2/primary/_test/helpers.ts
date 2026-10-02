import { act, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { setTestApi } from "@/platform/test/api-mock";

/**
 * Les droits (`usePermission`) arrivent de façon asynchrone et le web est fail-closed (refus tant que la réponse n'est pas là) :
 * une assertion NÉGATIVE (« ce bouton n'existe pas ») n'a de sens qu'une fois les droits connus. On attend donc l'appel puis un cycle.
 */
export async function permissionsLoaded(api: ReturnType<typeof setTestApi>): Promise<void> {
  await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/rbac/me/permissions")).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
