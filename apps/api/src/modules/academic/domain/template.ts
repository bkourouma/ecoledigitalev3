/**
 * Modèle de pack de la section `academic` (D-21) : de la DONNÉE par système éducatif et par pack, validée au
 * chargement. Ajouter un pack ou ajuster un niveau ne demande aucun code. Aucune règle réglementaire : les
 * coefficients, séries et matières officiels ne figurent pas dans les modèles tant que le propriétaire n'a pas
 * fourni les textes de référence (O-02).
 */
import { z } from "zod";
import {
  academicCalculationContractSchema,
  academicConfirmationPolicySchema,
  academicCourseConfirmationPolicySchema,
  academicFundingCodeSchema,
  academicOutcomeKindSchema,
  academicPackSchema,
  academicPeriodKindSchema,
  academicPeriodPlanSlotSchema,
} from "@ecoledigitale/contracts/src/v2/academic";

const code = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/);
const label = z.string().trim().min(1).max(200);

/**
 * Provenance d'une valeur de modèle qui n'est PAS un simple libellé (contrat de calcul, drapeau d'examen terminal, poids
 * de période). Aucune valeur ne doit rester « non sourcée » (test de cohérence des modèles, pack-template.md §1) :
 *   - `neutral`     : sans hypothèse métier (poids 1, branchement technique d'un contrat de calcul) ;
 *   - `placeholder` : valeur de démonstration ou à confirmer par le propriétaire ; jamais décisionnelle ;
 *   - `regulation`  : valeur issue d'un texte officiel — exige `sourceReference` (aucun modèle livré n'en contient tant que
 *                     les textes n'ont pas été fournis).
 */
export const TEMPLATE_SOURCE_KINDS = ["neutral", "placeholder", "regulation"] as const;
export const templateSourceKindSchema = z.enum(TEMPLATE_SOURCE_KINDS);
export type TemplateSourceKind = z.infer<typeof templateSourceKindSchema>;
const provenance = {
  sourceKind: templateSourceKindSchema.optional(),
  sourceReference: z.string().trim().min(1).max(300).optional(),
  sourceNote: z.string().trim().min(1).max(300).optional(),
};

export const AcademicPackTemplateSchema = z
  .object({
    section: z.literal("academic"),
    schemaVersion: z.literal(1),
    /** Version du CONTENU du modèle (enregistrée dans `template_applications`). */
    templateVersion: z.number().int().min(1),
    educationSystem: z.string().regex(/^[A-Z0-9_]{1,20}$/),
    pack: academicPackSchema,
    educationLevels: z.array(z.object({ code, label, ordinal: z.number().int().min(0), calculationContract: academicCalculationContractSchema.optional(), ...provenance }).strict()),
    gradeLevels: z.array(
      z
        .object({
          code,
          label,
          shortLabel: z.string().trim().min(1).max(40).optional(),
          educationLevel: code,
          ordinal: z.number().int().min(0),
          next: code.nullable(),
          isFinal: z.boolean().optional(),
          /** Informatif (le niveau se conclut par un examen terminal) : jamais décisionnel. */
          terminalExamRequired: z.boolean().optional(),
          ...provenance,
        })
        .strict(),
    ),
    periodTypes: z.array(z.object({ code, label, kind: academicPeriodKindSchema }).strict()),
    /** `sourceKind` d'un plan couvre les poids de ses créneaux (`slots[].weight`). */
    periodPlans: z.array(z.object({ code, label, slots: z.array(academicPeriodPlanSlotSchema).min(1), ...provenance }).strict()),
    nodeTypes: z.array(
      z
        .object({
          code,
          label,
          allowedParents: z.array(z.string().regex(/^(ROOT|[A-Z][A-Z0-9_]{0,39})$/)).min(1),
          requiresGradeLevel: z.boolean().optional(),
          requiresPeriodSlot: z.boolean().optional(),
          requiresSubject: z.boolean().optional(),
          allowsCoefficient: z.boolean().optional(),
          allowsCredits: z.boolean().optional(),
          creditsMustEqualChildren: z.boolean().optional(),
          enrollable: z.boolean().optional(),
          system: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
        })
        .strict(),
    ),
    fundingTypes: z.array(
      z.object({ code: academicFundingCodeSchema, label, requiresReference: z.boolean().optional(), requiresFunder: z.boolean().optional() }).strict(),
    ),
    enrollmentOutcomes: z.array(z.object({ code, label, kind: academicOutcomeKindSchema }).strict()),
    programs: z.array(
      z
        .object({
          code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
          label,
          educationLevel: code,
          gradeLevels: z.array(code).min(1),
          kindCode: code.optional(),
          domainCode: z.string().optional(),
        })
        .strict(),
    ),
    settings: z
      .object({
        enrollmentConfirmationPolicy: academicConfirmationPolicySchema,
        courseConfirmationPolicy: academicCourseConfirmationPolicySchema.optional(),
        pendingHoldMinutes: z.number().int().positive().nullable(),
        registrationNumberPrefix: z.string().regex(/^[A-Z0-9]{1,12}$/).nullable().optional(),
        registrationNumberPattern: z.string().min(3).max(80).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((t, ctx) => {
    const levels = new Set(t.educationLevels.map((l) => l.code));
    const grades = new Set(t.gradeLevels.map((g) => g.code));
    const periodTypes = new Set(t.periodTypes.map((p) => p.code));
    const issue = (message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const dup = (items: readonly string[], what: string): void => {
      if (new Set(items).size !== items.length) issue(`${what} en double.`);
    };
    for (const [what, items] of [
      ["Cycle", t.educationLevels],
      ["Niveau", t.gradeLevels],
      ["Plan de périodes", t.periodPlans],
    ] as const) {
      for (const item of items) {
        if (item.sourceKind === "regulation" && !item.sourceReference) issue(`${what} ${item.code} : une valeur « regulation » exige sa référence (sourceReference).`);
        if (item.sourceReference && item.sourceKind !== "regulation") issue(`${what} ${item.code} : une référence réglementaire n'accompagne qu'une valeur « regulation ».`);
      }
    }
    dup(t.educationLevels.map((l) => l.code), "Cycle");
    dup(t.gradeLevels.map((g) => g.code), "Niveau");
    dup(t.periodTypes.map((p) => p.code), "Type de période");
    dup(t.periodPlans.map((p) => p.code), "Plan de périodes");
    dup(t.nodeTypes.map((n) => n.code), "Type de nœud");
    dup(t.fundingTypes.map((f) => f.code), "Type de financement");
    dup(t.enrollmentOutcomes.map((o) => o.code), "Issue d'inscription");
    dup(t.programs.map((p) => p.code), "Programme");
    for (const g of t.gradeLevels) {
      if (!levels.has(g.educationLevel)) issue(`Niveau ${g.code} : cycle inconnu ${g.educationLevel}.`);
      if (g.next !== null && !grades.has(g.next)) issue(`Niveau ${g.code} : niveau suivant inconnu ${g.next}.`);
      if (g.isFinal && g.next !== null) issue(`Niveau ${g.code} : un niveau final n'a pas de niveau suivant.`);
      if (g.next === g.code) issue(`Niveau ${g.code} : son propre suivant.`);
    }
    for (const plan of t.periodPlans) {
      for (const slot of plan.slots) if (!periodTypes.has(slot.type)) issue(`Plan ${plan.code} : type de période inconnu ${slot.type}.`);
    }
    for (const p of t.programs) {
      if (!levels.has(p.educationLevel)) issue(`Programme ${p.code} : cycle inconnu ${p.educationLevel}.`);
      for (const g of p.gradeLevels) if (!grades.has(g)) issue(`Programme ${p.code} : niveau inconnu ${g}.`);
    }
    const nodeCodes = new Set(t.nodeTypes.map((n) => n.code));
    for (const n of t.nodeTypes) {
      for (const parent of n.allowedParents) if (parent !== "ROOT" && !nodeCodes.has(parent)) issue(`Type ${n.code} : parent admis inconnu ${parent}.`);
      if (n.requiresGradeLevel && n.requiresPeriodSlot) issue(`Type ${n.code} : niveau et période s'excluent.`);
    }
    if (t.settings.registrationNumberPattern && /\{PREFIX\}/.test(t.settings.registrationNumberPattern) && !t.settings.registrationNumberPrefix) {
      issue("Le motif de numéro d'inscription utilise {PREFIX} sans préfixe.");
    }
  });

export type AcademicPackTemplate = z.infer<typeof AcademicPackTemplateSchema>;
