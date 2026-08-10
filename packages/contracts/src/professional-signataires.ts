import { z } from "zod";

/**
 * Signataires configurables des documents officiels du module professionnel
 * (attestation de réussite, diplôme, attestation d'authenticité).
 *
 * Un seul enregistrement par « titre » (`cle`) et par établissement — voir la
 * migration `0087_professional_signataires.sql`.
 */

export const SignataireCleSchema = z.enum([
  "attestation_reussite",
  "diplome_gauche",
  "diplome_droite",
  "authenticite",
]);

export const SignataireDtoSchema = z.object({
  cle: SignataireCleSchema,
  /** Nom imprimé sur le document. */
  nom: z.string(),
  /** Qualité (ex. « Enseignant Chercheur »), facultative. */
  qualite: z.string().nullable().optional(),
  /** Fonction / titre, éventuellement sur plusieurs lignes (séparateur « \n »). */
  fonction: z.string().nullable().optional(),
});

export const SignataireUpdateInputSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis.").max(160),
  qualite: z.string().trim().max(160).nullable().optional(),
  fonction: z.string().trim().max(320).nullable().optional(),
});

export type SignataireCle = z.infer<typeof SignataireCleSchema>;
export type SignataireDto = z.infer<typeof SignataireDtoSchema>;
export type SignataireUpdateInput = z.infer<typeof SignataireUpdateInputSchema>;

/** Libellés d'administration de chaque titre (ordre d'affichage). */
export const SIGNATAIRE_LABELS: Array<{
  cle: SignataireCle;
  titre: string;
  description: string;
  /** La qualité est-elle utilisée pour ce titre ? */
  withQualite: boolean;
  /** La fonction peut-elle tenir sur plusieurs lignes ? */
  fonctionMultiligne: boolean;
}> = [
  {
    cle: "attestation_reussite",
    titre: "Attestation de réussite — signataire",
    description:
      "Apparaît dans « Je soussigné, <nom>, <qualité>, <fonction> de l'Institut… atteste que : » et dans le bloc de signature.",
    withQualite: true,
    fonctionMultiligne: false,
  },
  {
    cle: "diplome_gauche",
    titre: "Diplôme — signataire de gauche",
    description: "Bloc de signature gauche du diplôme (nom puis titre sur une ou deux lignes).",
    withQualite: false,
    fonctionMultiligne: true,
  },
  {
    cle: "diplome_droite",
    titre: "Diplôme — signataire de droite",
    description: "Bloc de signature droit du diplôme (nom puis titre sur une ou deux lignes).",
    withQualite: false,
    fonctionMultiligne: true,
  },
  {
    cle: "authenticite",
    titre: "Attestation d'authenticité — signataire",
    description:
      "Apparaît dans « Je soussigné(e), <nom>, <fonction>… » et dans le bloc « Le Responsable ».",
    withQualite: false,
    fonctionMultiligne: false,
  },
];
