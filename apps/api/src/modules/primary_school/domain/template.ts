/**
 * Schéma Zod du modèle de pack `primary_school` (section de modèle de pack, spec 003/005 `pack-template.md` §5).
 *
 * RÈGLE ABSOLUE : aucune valeur réglementaire. Toute échelle, tout référentiel et toute phrase DÉCLARE son origine
 * (`sourceKind` sans valeur par défaut : un modèle qui oublie l'origine est refusé) ; `regulation` exige `sourceReference`.
 * Le jeu livré est `placeholder` (démonstration).
 */
import { z } from "zod";

const sourceKind = z.enum(["regulation", "institution", "platform", "placeholder"]);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
const levelCode = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/);
const competencyCode = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/);
const label = z.string().trim().min(1).max(200);

const withSource = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, sourceKind, sourceReference: z.string().trim().min(1).optional() })
    .strict()
    .refine((v) => v.sourceKind !== "regulation" || Boolean(v.sourceReference), { message: "Une valeur réglementaire cite son texte (sourceReference).", path: ["sourceReference"] });

const ratingScale = withSource({
  code,
  label,
  levels: z
    .array(z.object({ code: levelCode, label, ordinal: z.number().int().min(1), meetsExpectation: z.boolean() }).strict())
    .min(2)
    .max(12),
});

const framework = withSource({
  code,
  label,
  /** Code de l'échelle (définie dans la même section). */
  scale: code,
  gradeLevels: z.array(levelCode).min(1).max(20),
  domains: z
    .array(
      z
        .object({
          code: competencyCode,
          label,
          competencies: z.array(z.object({ code: competencyCode, label, description: z.string().optional() }).strict()).min(1).max(200),
        })
        .strict(),
    )
    .min(1)
    .max(60),
});

const phrase = withSource({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/),
  scope: z.enum(["PERIOD", "YEAR", "COMPETENCY"]),
  body: z.string().trim().min(1).max(300),
  ratingLevelCode: levelCode.optional(),
  gradeLevelCode: levelCode.optional(),
});

export const PrimarySchoolPackTemplateSchema = z
  .object({
    section: z.literal("primary_school"),
    schemaVersion: z.literal(1),
    templateVersion: z.number().int().min(1),
    educationSystem: z.string().min(2).max(16),
    pack: z.literal("PRIMARY"),
    ratingScales: z.array(ratingScale).max(10),
    competencyFrameworks: z.array(framework).max(20),
    appreciationPhrases: z.array(phrase).max(500),
    settings: z
      .object({
        requireHomeroomForActivation: z.boolean(),
        councilRequiredForBilan: z.boolean(),
        phraseBankEnabled: z.boolean(),
        archiveRetentionYears: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((t, ctx) => {
    const scales = new Set(t.ratingScales.map((s) => s.code));
    if (scales.size !== t.ratingScales.length) ctx.addIssue({ code: "custom", path: ["ratingScales"], message: "Code d'échelle en double." });
    for (const [i, s] of t.ratingScales.entries()) {
      const codes = new Set(s.levels.map((l) => l.code));
      const ordinals = new Set(s.levels.map((l) => l.ordinal));
      if (codes.size !== s.levels.length || ordinals.size !== s.levels.length) {
        ctx.addIssue({ code: "custom", path: ["ratingScales", i, "levels"], message: "Codes et ordinaux de niveaux uniques attendus." });
      }
    }
    const fwCodes = new Set<string>();
    for (const [i, f] of t.competencyFrameworks.entries()) {
      if (!scales.has(f.scale)) ctx.addIssue({ code: "custom", path: ["competencyFrameworks", i, "scale"], message: `Échelle inconnue : ${f.scale}.` });
      if (fwCodes.has(f.code)) ctx.addIssue({ code: "custom", path: ["competencyFrameworks", i, "code"], message: "Code de référentiel en double." });
      fwCodes.add(f.code);
    }
    const phraseCodes = new Set<string>();
    for (const [i, p] of t.appreciationPhrases.entries()) {
      if (phraseCodes.has(p.code)) ctx.addIssue({ code: "custom", path: ["appreciationPhrases", i, "code"], message: "Code de phrase en double." });
      phraseCodes.add(p.code);
    }
  });

export type PrimarySchoolPackTemplate = z.infer<typeof PrimarySchoolPackTemplateSchema>;
