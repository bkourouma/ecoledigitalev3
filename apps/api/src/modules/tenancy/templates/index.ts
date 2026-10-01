/**
 * Modèles de pack (plan §3.4 : « fin du clonage depuis un tenant de référence »).
 *
 * Un modèle est de la DONNÉE (un fichier JSON par pack), validée au chargement
 * par un schéma Zod : ajouter ou ajuster un pack ne demande pas de code.
 * À ce stade, un modèle ne contient que ce qui relève du socle : l'établissement
 * (nom, code), son campus par défaut et le drapeau de pack. `levels` et
 * `periods` sont réservés (listes vides) : les modules académiques les
 * renseigneront lorsqu'ils existeront, sans changer ce contrat.
 */
import { z } from "zod";
import { INSTITUTION_PACKS, InstitutionPackSchema, TenancyCodeSchema, type InstitutionPack } from "@ecoledigitale/contracts/src/v2/tenancy";
import primary from "./primary.json";
import secondary from "./secondary.json";
import higher from "./higher.json";
import virtual from "./virtual.json";

export const PackTemplateSchema = z
  .object({
    version: z.literal(1),
    /** Drapeau de pack posé sur l'établissement créé. */
    pack: InstitutionPackSchema,
    label: z.string().min(1),
    institution: z.object({
      code: TenancyCodeSchema,
      /** `{organisation}` est remplacé par le nom de l'organisation. */
      nameTemplate: z.string().min(1).refine((s) => s.includes("{organisation}"), "nameTemplate doit contenir {organisation}."),
    }),
    defaultCampus: z.object({ code: TenancyCodeSchema, name: z.string().min(2) }),
    /** Réservé : niveaux scolaires du pack (données, renseignées par les modules académiques). */
    levels: z.array(z.object({ code: z.string(), label: z.string() })).default([]),
    /** Réservé : périodes types (trimestres, semestres…). */
    periods: z.array(z.object({ code: z.string(), label: z.string() })).default([]),
  })
  .strict();

export type PackTemplate = z.infer<typeof PackTemplateSchema>;
export type PackTemplates = ReadonlyMap<InstitutionPack, PackTemplate>;

/** Valide une liste de modèles : un par pack, aucun doublon, tous les packs présents. */
export function buildPackTemplates(raw: readonly unknown[]): PackTemplates {
  const map = new Map<InstitutionPack, PackTemplate>();
  for (const entry of raw) {
    const t = PackTemplateSchema.parse(entry);
    if (map.has(t.pack)) throw new Error(`Modèle de pack en double : ${t.pack}.`);
    map.set(t.pack, t);
  }
  for (const pack of INSTITUTION_PACKS) {
    if (!map.has(pack)) throw new Error(`Modèle de pack manquant : ${pack}.`);
  }
  return map;
}

let cached: PackTemplates | undefined;

/** Modèles livrés avec le module (chargés et validés une fois). */
export function defaultPackTemplates(): PackTemplates {
  cached ??= buildPackTemplates([primary, secondary, higher, virtual]);
  return cached;
}
