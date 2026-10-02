/**
 * Modèle de pack de la section `councils` (DONNÉES, jamais du code) : rôles de participants, types de conseil, types de décision,
 * réglages. Validé à l'usage par le module (la section est opaque pour `tenancy`).
 *
 * AUCUNE valeur réglementaire par défaut (spec 006 AC13.3) : `minParticipants = null`, `requiredRoleCodes = []`, `orientationPaths = []`.
 * Les codes de résultats (`PROMOTED`, `REPEAT`) et d'issues d'inscription sont des CODES D'INTÉGRATION des contrats de règles et du
 * modèle `academic`, pas des règles. Tout le modèle livré est marqué de démonstration.
 */
import { z } from "zod";

const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/);

export const CouncilsPackTemplateSchema = z
  .object({
    section: z.literal("councils"),
    schemaVersion: z.literal(1),
    templateVersion: z.number().int().min(1),
    educationSystem: z.string().min(2).max(10),
    pack: z.literal("SECONDARY"),
    participantRoles: z.array(
      z
        .object({
          code,
          label: z.string().min(1).max(160),
          isVoting: z.boolean().default(true),
          countsForQuorum: z.boolean().default(true),
          maySign: z.boolean().default(true),
          canDecide: z.boolean().default(false),
          isExternal: z.boolean().default(false),
          sortOrder: z.number().int().min(0).default(0),
        })
        .strict(),
    ),
    councilTypes: z.array(
      z
        .object({
          code,
          label: z.string().min(1).max(160),
          scope: z.enum(["PERIOD", "YEAR"]),
          minResultsStatus: z.enum(["OPEN", "GRADING_LOCKED"]).default("GRADING_LOCKED"),
          // Aucun quorum officiel : `null` (aucun contrôle) tant que le texte et un exemple validé ne sont pas fournis.
          minParticipants: z.null().default(null),
          requiredRoleCodes: z.array(code).max(0).default([]),
          signerFunctions: z.array(z.enum(["PRESIDENT", "SECRETARY"])).default(["PRESIDENT", "SECRETARY"]),
          signerRoleCodes: z.array(code).default([]),
          requiresDecisionPerStudent: z.boolean().default(false),
          sortOrder: z.number().int().min(0).default(0),
        })
        .strict(),
    ),
    decisionTypes: z.array(
      z
        .object({
          code,
          label: z.string().min(1).max(160),
          family: z.enum(["PASSAGE", "REPEAT", "ORIENTATION", "REORIENTATION", "EXCLUSION", "REQUIRED_OPINION", "OTHER"]),
          appliesTo: z.enum(["PERIOD", "YEAR", "BOTH"]).default("YEAR"),
          exclusiveGroup: code.nullable().default(null),
          requiresJustification: z.boolean().default(false),
          requiresVote: z.boolean().default(false),
          requiresTarget: z.boolean().default(false),
          resultsDecisionKind: code.nullable().default(null),
          resultsFinalCode: code.nullable().default(null),
          academicOutcomeCode: code.nullable().default(null),
          needsHumanApplication: z.boolean().default(false),
          studentStatus: z.enum(["SUSPENDED", "EXCLUDED"]).nullable().default(null),
          sortOrder: z.number().int().min(0).default(0),
        })
        .strict(),
    ),
    settings: z
      .object({
        requireSeparateUnlocker: z.boolean(),
        effectsTrigger: z.enum(["CLOSED", "SIGNED"]),
        guardianVisibility: z.enum(["NEVER", "AFTER_SIGNATURE", "AFTER_NOTIFICATION"]),
        allowQuorumWaiver: z.boolean(),
      })
      .strict(),
    // Aucun parcours d'orientation officiel : la liste est VIDE par construction (le schéma refuse tout élément).
    orientationPaths: z.array(z.never()).max(0),
  })
  .strict();

export type CouncilsPackTemplate = z.infer<typeof CouncilsPackTemplateSchema>;
