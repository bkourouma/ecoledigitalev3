/**
 * Données de référence par défaut d'un tenant (section `people` du modèle de pack « CI », spec 008 data-model §7).
 *
 * Ce sont des DONNÉES (libellés, drapeaux d'enseignement), pas des règles : un tenant les modifie par les routes de
 * référentiel (`people.settings.manage`). Elles sont instanciées de façon IDEMPOTENTE (`ON CONFLICT DO NOTHING` : une
 * ligne personnalisée n'est jamais écrasée) à l'événement `tenancy.tenant.provisioned` et, pour les tenants déjà
 * existants (rattrapage legacy), au premier usage du module (`ensureTenantDefaults`).
 *
 * Tant que `PackTemplateSchema` (tenancy) n'accueille pas de section `people` (demande à 003), ce fichier tient lieu de
 * modèle de pack unique ; le jour où la section existe, `instantiatePeopleReferenceData` lira le modèle du pack.
 */
export interface RelationshipTypeSeed {
  code: string;
  label: string;
  kind: "GUARDIAN" | "EMERGENCY" | "OTHER";
}
export interface StaffCategorySeed {
  code: string;
  label: string;
  canTeach: boolean;
  canSupervise: boolean;
}
export interface ContractTypeSeed {
  code: string;
  label: string;
  kind: "PERMANENT" | "FIXED_TERM" | "CASUAL" | "OTHER";
}

export const DEFAULT_RELATIONSHIP_TYPES: readonly RelationshipTypeSeed[] = [
  { code: "FATHER", label: "Père", kind: "GUARDIAN" },
  { code: "MOTHER", label: "Mère", kind: "GUARDIAN" },
  { code: "LEGAL_GUARDIAN", label: "Tuteur légal", kind: "GUARDIAN" },
  { code: "GRANDPARENT", label: "Grand-parent", kind: "GUARDIAN" },
  { code: "SIBLING", label: "Frère ou sœur", kind: "GUARDIAN" },
  { code: "UNCLE_AUNT", label: "Oncle ou tante", kind: "GUARDIAN" },
  { code: "EMERGENCY_CONTACT", label: "Contact d'urgence", kind: "EMERGENCY" },
  { code: "OTHER", label: "Autre", kind: "OTHER" },
];

export const DEFAULT_STAFF_CATEGORIES: readonly StaffCategorySeed[] = [
  { code: "TEACHER", label: "Enseignant", canTeach: true, canSupervise: false },
  { code: "EDUCATOR", label: "Éducateur", canTeach: false, canSupervise: true },
  { code: "ADMIN", label: "Personnel administratif", canTeach: false, canSupervise: false },
  { code: "DIRECTION", label: "Direction", canTeach: false, canSupervise: false },
  { code: "SUPPORT", label: "Personnel d'appui", canTeach: false, canSupervise: false },
];

export const DEFAULT_CONTRACT_TYPES: readonly ContractTypeSeed[] = [
  { code: "CDI", label: "Contrat à durée indéterminée", kind: "PERMANENT" },
  { code: "CDD", label: "Contrat à durée déterminée", kind: "FIXED_TERM" },
  { code: "VACATION", label: "Vacation", kind: "CASUAL" },
  { code: "OTHER", label: "Autre", kind: "OTHER" },
];

export const DEFAULT_SETTINGS = Object.freeze({
  studentNumberPattern: "{SEQ:5}",
  staffNumberPattern: "P{SEQ:4}",
  duplicateCheckEnabled: true,
  /** Préavis d'alerte de qualification qui expire : donnée du pack CI (modifiable par le tenant). */
  expiryAlertDays: 60 as number | null,
});

