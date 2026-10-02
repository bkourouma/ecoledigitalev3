/**
 * Modèles de pack de la section `councils` : un fichier JSON par système éducatif, validé à l'usage par le module
 * (`CouncilsPackTemplateSchema`). Ajouter un pays = ajouter un fichier JSON et l'inscrire ci-dessous ; aucune logique ne change.
 *
 * Fournisseur par défaut du port `TemplatePort`. La plateforme le complète par `tenancy.getPackTemplateSection('SECONDARY', système,
 * 'councils')` quand la section existe (adaptateur de câblage) : une section propre au tenant l'emporte sans toucher au module.
 */
import type { TemplatePort } from "../application/ports";
import ciSecondary from "./CI/secondary.json";

const BUNDLED: ReadonlyMap<string, unknown> = new Map([["CI", ciSecondary as unknown]]);

export const bundledTemplatePort: TemplatePort = Object.freeze({
  getSection(educationSystem: string): unknown | null {
    return BUNDLED.get(educationSystem) ?? null;
  },
});
