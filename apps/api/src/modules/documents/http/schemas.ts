/**
 * Schémas Zod des entrées HTTP du module.
 *
 * TODO(contracts) : les schémas partagés avec le front vivent dans packages/contracts/src/v2/documents.ts
 * (réexportés par packages/contracts/src/v2/index.ts, convention n°9) ; déplacez-les là dès qu'ils sont stables.
 */
import { z } from "zod";

export const createItemBody = z.object({ label: z.string() });
