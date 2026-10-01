/**
 * Modèles de pack de la section `academic` : un fichier JSON par (système éducatif, pack), validé au chargement.
 * Ajouter un pays ou un pack = ajouter un fichier JSON et l'inscrire ci-dessous ; aucune logique ne change.
 *
 * Fournisseur par défaut du port `TemplateProvider` (`application/ports.ts`). Quand `tenancy` exposera
 * `getPackTemplateSection(pack, educationSystem, 'academic')`, un adaptateur de câblage le remplacera sans
 * toucher au module (voir spec 004, §7.3).
 */
import { AcademicPackTemplateSchema, type AcademicPackTemplate } from "../domain/template";
import ciHigher from "./CI/higher.json";
import ciPrimary from "./CI/primary.json";
import ciSecondary from "./CI/secondary.json";
import ciVirtual from "./CI/virtual.json";

export type AcademicTemplates = ReadonlyMap<string, AcademicPackTemplate>;

export const templateKey = (educationSystem: string, pack: string): string => `${educationSystem}:${pack}`;

/** Valide une liste de modèles : un seul par (système éducatif, pack). */
export function buildAcademicTemplates(raw: readonly unknown[]): AcademicTemplates {
  const map = new Map<string, AcademicPackTemplate>();
  for (const entry of raw) {
    const t = AcademicPackTemplateSchema.parse(entry);
    const key = templateKey(t.educationSystem, t.pack);
    if (map.has(key)) throw new Error(`Modèle académique en double : ${key}.`);
    map.set(key, t);
  }
  return map;
}

let cached: AcademicTemplates | undefined;

/** Modèles livrés avec le module (chargés et validés une fois). */
export function defaultAcademicTemplates(): AcademicTemplates {
  cached ??= buildAcademicTemplates([ciPrimary, ciSecondary, ciHigher, ciVirtual]);
  return cached;
}

export function getAcademicTemplate(educationSystem: string, pack: string, templates: AcademicTemplates = defaultAcademicTemplates()): AcademicPackTemplate | undefined {
  return templates.get(templateKey(educationSystem, pack));
}
