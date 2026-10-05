/**
 * Modèle de pack « primaire » : le CEPE, première instance du moteur, en DONNÉES FICTIVES de démonstration.
 *
 * AVERTISSEMENT — aucune règle d'examen officielle n'est écrite ici. Les épreuves `EP1`–`EP3`, leurs barèmes et leurs
 * coefficients, la pièce exigée, les formats d'export et d'import sont des VALEURS FICTIVES qui servent à exercer le mécanisme
 * (`source_kind = placeholder`, libellés suffixés « (fictif) »). Les textes officiels (épreuves, coefficients, conditions,
 * formats d'échange) sont à obtenir (`specs/v2/018-examinations/regulatory-sources-needed.md`) : chacun s'ajoute ensuite comme
 * une ligne de données de source `regulation`, jamais comme du code.
 *
 * Le RuleSet fictif `CI-EXAM-PLACEHOLDER` (contrat `exam-national@1`) est un jeu de données de `rules`, pas de ce module.
 */
import type { ExportColumn, ExportFileFormat, ExportKind, ImportColumn, BatchKind, SourceKind } from "./types";

export const PACK_PLACEHOLDER_NOTICE = "Données et règles de démonstration (fictives) : aucune valeur officielle.";

export interface PackExamType {
  code: string;
  label: string;
  educationLevelCode: string;
  gradeLevelCode: string | null;
  resultContractId: string;
  candidateNumberPattern: string;
  /** Q-E18 : le résultat et la moyenne partent vers les admissions (CEPE -> 6e). Décision métier, modifiable par l'établissement. */
  transmitsToAdmission: boolean;
  sourceKind: SourceKind;
  tracks: Array<{ code: string; label: string; sourceKind: SourceKind }>;
  papers: Array<{ trackCode: string | null; code: string; label: string; coefficient: string; scaleMax: string; isOptional: boolean; ordinal: number; sourceKind: SourceKind }>;
  requirements: Array<{ code: string; label: string; required: boolean; sortOrder: number; sourceKind: SourceKind }>;
}

export interface PackExportFormat {
  code: string;
  label: string;
  examTypeCode: string;
  kind: ExportKind;
  fileFormat: ExportFileFormat;
  delimiter: string;
  columns: ExportColumn[];
  sourceKind: SourceKind;
}

export interface PackImportFormat {
  code: string;
  label: string;
  examTypeCode: string;
  kind: BatchKind;
  delimiter: string;
  decimalSeparator: "." | ",";
  columns: ImportColumn[];
  valueMap: Record<string, Record<string, string>>;
  sourceKind: SourceKind;
}

export interface PackTemplate {
  key: string;
  examTypes: PackExamType[];
  exportFormats: PackExportFormat[];
  importFormats: PackImportFormat[];
}

const P: SourceKind = "placeholder";

export const PRIMARY_PACK: PackTemplate = {
  key: "PRIMARY",
  examTypes: [
    {
      code: "CEPE",
      label: "CEPE (données fictives de démonstration)",
      educationLevelCode: "PRIMARY",
      gradeLevelCode: "CM2",
      resultContractId: "exam-national@1",
      candidateNumberPattern: "{TYPE}{YEAR}-{SEQ:5}",
      transmitsToAdmission: true,
      sourceKind: P,
      tracks: [],
      papers: [
        { trackCode: null, code: "EP1", label: "Épreuve 1 (fictive)", coefficient: "1", scaleMax: "20", isOptional: false, ordinal: 1, sourceKind: P },
        { trackCode: null, code: "EP2", label: "Épreuve 2 (fictive)", coefficient: "2", scaleMax: "20", isOptional: false, ordinal: 2, sourceKind: P },
        { trackCode: null, code: "EP3", label: "Épreuve 3 (fictive)", coefficient: "1", scaleMax: "10", isOptional: false, ordinal: 3, sourceKind: P },
      ],
      requirements: [{ code: "ACTE_NAISSANCE", label: "Acte de naissance (pièce fictive)", required: true, sortOrder: 1, sourceKind: P }],
    },
  ],
  exportFormats: [
    {
      code: "LISTE_CANDIDATS_FICTIF",
      label: "Liste des candidats (format fictif)",
      examTypeCode: "CEPE",
      kind: "CANDIDATE_LIST",
      fileFormat: "CSV",
      delimiter: ";",
      sourceKind: P,
      columns: [
        { header: "NUMERO", source: "candidate.number" },
        { header: "NOM", source: "candidate.last_name", transform: "upper" },
        { header: "PRENOMS", source: "candidate.first_name" },
        { header: "NAISSANCE", source: "candidate.birth_date", transform: "date_dmy" },
        { header: "LIEU_NAISSANCE", source: "candidate.birth_place" },
        { header: "SEXE", source: "candidate.sex", transform: "sex_fm" },
        { header: "CODE_CEPE", source: "candidate.identifier.cepe_code" },
      ],
    },
    {
      code: "RESULTATS_FICTIF",
      label: "Résultats (format fictif)",
      examTypeCode: "CEPE",
      kind: "RESULTS",
      fileFormat: "CSV",
      delimiter: ";",
      sourceKind: P,
      columns: [
        { header: "NUMERO", source: "candidate.number" },
        { header: "NUMERO_OFFICIEL", source: "candidate.official_number" },
        { header: "DECISION", source: "result.code" },
        { header: "MOYENNE", source: "result.average", transform: "decimal_comma" },
        { header: "EP1", source: "paper.score", paper: "EP1", transform: "decimal_comma" },
        { header: "EP2", source: "paper.score", paper: "EP2", transform: "decimal_comma" },
        { header: "EP3", source: "paper.score", paper: "EP3", transform: "decimal_comma" },
      ],
    },
  ],
  importFormats: [
    {
      code: "RESULTATS_IMPORT_FICTIF",
      label: "Résultats de l'autorité (format fictif)",
      examTypeCode: "CEPE",
      kind: "RESULTS",
      delimiter: ";",
      decimalSeparator: ",",
      sourceKind: P,
      columns: [
        { header: "NUMERO", target: "key.candidate_number" },
        { header: "DECISION", target: "result.code" },
        { header: "MOYENNE", target: "result.average" },
      ],
      valueMap: { "result.code": { ADMIS: "ADMITTED", AJOURNE: "FAILED", ABSENT: "ABSENT", EXCLU: "EXCLUDED", DIFFERE: "DEFERRED" } },
    },
  ],
};

/** Modèles disponibles par clé de pack. Ajouter un pack = ajouter une entrée de DONNÉES, jamais une branche de code. */
export const PACK_TEMPLATES: Readonly<Record<string, PackTemplate>> = Object.freeze({ PRIMARY: PRIMARY_PACK });
