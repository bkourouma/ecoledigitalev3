"use client";

/**
 * Hooks typés des prérequis entre UE du module `higher` (`/api/v1/higher/ue/:nodeId/prerequisites`,
 * `/api/v1/higher/students/:id/prerequisites-check`). Schémas Zod de `packages/contracts/src/v2/higher.ts`.
 *
 * Le web n'évalue JAMAIS un prérequis : le serveur détecte les cycles, refuse les prérequis hors programme et dit si un
 * étudiant les satisfait ; l'écran affiche le résultat.
 *
 * Clés de cache : `["higher", "prerequisites", …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { higherPrerequisiteCheckDtoSchema, higherPrerequisiteDtoSchema, higherSetPrerequisitesResultDtoSchema, type higherSetPrerequisitesBodySchema } from "@ecoledigitale/contracts/v2/higher";
import { useApiAction } from "./actions";
import { HIGHER_BASE } from "./higher";

export type SetPrerequisitesBody = z.input<typeof higherSetPrerequisitesBodySchema>;

/** Prérequis d'une UE. */
export function useUePrerequisites(nodeId: string | null) {
  return hooks.useApiQuery(["higher", "prerequisites", "ue", nodeId], `${HIGHER_BASE}/ue/${nodeId}/prerequisites`, {
    schema: z.object({ items: z.array(higherPrerequisiteDtoSchema) }),
    select: (d) => d.items,
    enabled: nodeId !== null,
    retry: false,
  });
}

/** Remplace la liste des prérequis d'une UE (PUT) : le serveur refuse les cycles et renvoie les inscrits concernés. */
export function useSetUePrerequisites() {
  return useApiAction({
    method: "PUT",
    path: (v: { nodeId: string; body: SetPrerequisitesBody }) => `${HIGHER_BASE}/ue/${v.nodeId}/prerequisites`,
    body: (v) => v.body,
    schema: higherSetPrerequisitesResultDtoSchema,
    invalidate: [["higher", "prerequisites"]],
  });
}

/** « Cet étudiant satisfait-il les prérequis de cette UE ? » (décision du serveur). */
export function usePrerequisitesCheck(studentId: string | null, nodeId: string | null) {
  return hooks.useApiQuery(["higher", "prerequisites", "check", studentId, nodeId], `${HIGHER_BASE}/students/${studentId}/prerequisites-check`, {
    schema: higherPrerequisiteCheckDtoSchema,
    query: nodeId ? { nodeId } : undefined,
    enabled: studentId !== null && nodeId !== null,
    retry: false,
  });
}
