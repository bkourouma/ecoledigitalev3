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

/** Clé de section : nom de module en `snake_case` (`academic`, `primary_school`, `schoollife`…). */
export const PackTemplateSectionKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Clé de section attendue : minuscules, chiffres et « _ ».");
/** Système éducatif : code en majuscules (`CI`…), même forme que `educationSystem` des sections de module. */
export const EducationSystemKeySchema = z.string().regex(/^[A-Z0-9_]{1,20}$/, "Code de système éducatif attendu (ex. CI).");

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
    /**
     * Sections de modèle PAR MODULE (`academic`, `primary_school`, `councils`, `schoollife`, `admissions`, `examinations`…) :
     * `sections[<section>][<système éducatif>]` = contenu OPAQUE pour le noyau. Le module propriétaire de la section en est le
     * seul à connaître le schéma et le valide à la lecture (`getPackTemplateSection` ne renvoie que du JSON brut). Une section
     * inconnue du noyau est donc acceptée telle quelle ; aucun modèle livré n'en contient pour l'instant (clé facultative,
     * rétro-compatible). Aucune donnée réglementaire n'y a sa place sans source (specs 005 pack-template §1, 006 data-model §7).
     */
    sections: z.record(PackTemplateSectionKeySchema, z.record(EducationSystemKeySchema, z.unknown())).optional(),
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

/**
 * Section de modèle d'un module pour (pack, système éducatif) — contrat de la spec 004 §6 / 003 : renvoie le contenu BRUT
 * (`unknown`) de `sections[section][educationSystem]` du modèle du pack, ou `undefined` si le pack, la section ou le système
 * n'existent pas. Aucune section n'est connue du noyau : n'importe quel module peut en déclarer une sans modifier ce fichier ;
 * le module propriétaire valide le contenu avec son propre schéma (ex. `AcademicPackTemplateSchema`).
 */
export function getPackTemplateSection(pack: InstitutionPack, educationSystem: string, section: string, templates: PackTemplates = defaultPackTemplates()): unknown {
  return templates.get(pack)?.sections?.[section]?.[educationSystem];
}
