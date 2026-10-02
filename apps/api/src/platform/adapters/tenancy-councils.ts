/**
 * tenancy -> councils : `TemplatePort` — section `councils` du modèle de pack SECONDARY du système éducatif
 * (`tenancy.getPackTemplateSection('SECONDARY', système, 'councils')`), avec repli sur le modèle livré avec le module.
 *
 * Une section propre au tenant l'emporte sans toucher au module ; son schéma reste celui du module (validé à l'usage par
 * `instantiateCouncilsReferenceData`). Aucune valeur réglementaire n'est ajoutée ici.
 */
import { getPackTemplateSection } from "../../modules/tenancy";
import { councilsBundledTemplatePort, type CouncilsTemplatePort } from "../../modules/councils";

export function createCouncilsTemplatePort(): CouncilsTemplatePort {
  return {
    getSection(educationSystem) {
      const section = getPackTemplateSection("SECONDARY", educationSystem, "councils");
      return section ?? councilsBundledTemplatePort.getSection(educationSystem);
    },
  };
}
