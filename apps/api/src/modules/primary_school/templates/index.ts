/**
 * Modèles de pack de la section `primary_school` : un fichier JSON par système éducatif, validé à l'usage par le module
 * (`PrimarySchoolPackTemplateSchema`). Ajouter un pays = ajouter un fichier JSON et l'inscrire ci-dessous ; aucune logique ne change.
 *
 * Fournisseur par défaut du port `TemplatePort`. Quand `tenancy` exposera `getPackTemplateSection('PRIMARY', système,
 * 'primary_school')`, un adaptateur de câblage le remplacera sans toucher au module.
 */
import type { TemplatePort } from "../application/ports";
import ciPrimary from "./CI/primary.json";

const BUNDLED: ReadonlyMap<string, unknown> = new Map([["CI", ciPrimary as unknown]]);

export const bundledTemplatePort: TemplatePort = Object.freeze({
  getSection(educationSystem: string): unknown | null {
    return BUNDLED.get(educationSystem) ?? null;
  },
});
