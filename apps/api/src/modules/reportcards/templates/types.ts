import type { Pack, SignatureSlot, TemplateDocumentKind } from "../domain/types";

/** Gabarit livré avec la plateforme (publié par `ensureBuiltinTemplates`). */
export interface BuiltinTemplate {
  readonly key: string;
  readonly version: number;
  readonly documentKind: TemplateDocumentKind;
  readonly pack: Pack;
  readonly title: string;
  readonly body: string;
  readonly css: string;
  readonly optionsSchema: Record<string, unknown>;
  readonly signatureSlots: readonly SignatureSlot[];
}
