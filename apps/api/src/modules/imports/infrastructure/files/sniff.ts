/**
 * Contrôle du TYPE RÉEL d'un fichier sur ses octets (INV-S1). Le nom, l'extension et le `Content-Type` annoncés par le
 * client ne sont que des déclarations : ils servent à repérer une incohérence (refusée), jamais à décider.
 *
 *   XLSX : archive ZIP (`PK\x03\x04`) ;   CSV : texte sans octet NUL, décodable, imprimable à plus de 95 %.
 *   Refusés avec un message précis : OLE2 (`.xls`), PDF, images, exécutables, archives non ZIP, HTML / XML.
 */
import type { ImportFileKind } from "@ecoledigitale/contracts/src/v2/imports";
import { FileRejectedError } from "../../domain/errors";

const startsWith = (bytes: Uint8Array, magic: readonly number[], offset = 0): boolean => magic.every((b, i) => bytes[offset + i] === b);

interface Signature {
  readonly name: string;
  readonly magic: readonly number[];
}

/** Formats reconnus que l'on REFUSE explicitement (message adapté). */
const FORBIDDEN_SIGNATURES: readonly Signature[] = [
  { name: "un classeur Excel ancien (.xls) : enregistrez-le au format .xlsx ou .csv", magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { name: "un PDF", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { name: "une image PNG", magic: [0x89, 0x50, 0x4e, 0x47] },
  { name: "une image JPEG", magic: [0xff, 0xd8, 0xff] },
  { name: "une image GIF", magic: [0x47, 0x49, 0x46, 0x38] },
  { name: "un exécutable Windows", magic: [0x4d, 0x5a] },
  { name: "un exécutable Linux", magic: [0x7f, 0x45, 0x4c, 0x46] },
  { name: "une archive RAR", magic: [0x52, 0x61, 0x72, 0x21] },
  { name: "une archive 7-Zip", magic: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: "une archive GZIP", magic: [0x1f, 0x8b] },
];

export const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

const XLSX_EXTENSIONS = new Set(["xlsx", "xlsm"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv", "txt"]);

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Nom de fichier sûr à conserver et à afficher : sans chemin, sans contrôle, 255 caractères au plus. */
export function safeFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "import").normalize("NFC");
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "_").trim();
  return (cleaned === "" || cleaned === "." || cleaned === ".." ? "import" : cleaned).slice(0, 255);
}

const MIME_CONFLICTS = /^(image\/|video\/|audio\/|application\/(pdf|zip-compressed|x-msdownload|x-msdos-program|x-sh|javascript|json|xml)|text\/(html|javascript|xml))/i;

export interface SniffResult {
  readonly kind: ImportFileKind;
  /** `true` si le classeur déclare des macros (partie `vbaProject.bin` ou type de contenu macro). */
  readonly extension: string;
}

/**
 * Détermine le type réel. Lève `FileRejectedError` :
 *  - `imports.file_empty`           fichier vide ;
 *  - `imports.file_type_unsupported` extension ou format non pris en charge (PDF, .xls, exécutable...) ;
 *  - `imports.file_type_mismatch`   extension, type annoncé et contenu ne concordent pas.
 */
export function sniffFile(bytes: Uint8Array, declared: { fileName: string; contentType?: string | undefined }): SniffResult {
  if (bytes.length === 0) throw new FileRejectedError("imports.file_empty", "Le fichier est vide.");
  const ext = extensionOf(declared.fileName);
  const mime = (declared.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  for (const sig of FORBIDDEN_SIGNATURES) {
    if (startsWith(bytes, sig.magic)) throw new FileRejectedError("imports.file_type_unsupported", `Ce fichier est ${sig.name}. Seuls les fichiers .xlsx et .csv sont acceptés.`);
  }
  if (ext !== "" && !XLSX_EXTENSIONS.has(ext) && !CSV_EXTENSIONS.has(ext)) {
    throw new FileRejectedError("imports.file_type_unsupported", `L'extension « .${ext} » n'est pas prise en charge. Utilisez un fichier .xlsx ou .csv.`);
  }
  if (mime !== "" && MIME_CONFLICTS.test(mime)) {
    throw new FileRejectedError("imports.file_type_mismatch", "Le type de contenu annoncé ne correspond pas à un fichier Excel ou CSV.");
  }

  if (startsWith(bytes, ZIP_MAGIC)) {
    if (ext !== "" && !XLSX_EXTENSIONS.has(ext)) {
      throw new FileRejectedError("imports.file_type_mismatch", `Le contenu est une archive ZIP (classeur Excel) mais le fichier se nomme « .${ext} ».`);
    }
    return { kind: "XLSX", extension: ext };
  }
  if (startsWith(bytes, [0x50, 0x4b])) {
    throw new FileRejectedError("imports.file_corrupt", "Archive ZIP invalide ou vide : le classeur est illisible.");
  }

  // Texte : pas d'octet NUL (sauf UTF-16 avec BOM), imprimable à plus de 95 %.
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (!utf16) {
    let controls = 0;
    for (const b of sample) {
      if (b === 0) throw new FileRejectedError("imports.file_type_unsupported", "Ce fichier n'est pas un fichier texte (CSV) : il contient des données binaires.");
      if (b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f) controls += 1;
    }
    if (controls / sample.length > 0.05) throw new FileRejectedError("imports.file_type_unsupported", "Ce fichier n'est pas un fichier texte (CSV) lisible.");
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(sample.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<html") || head.startsWith("<!doctype") || head.startsWith("<script")) {
    throw new FileRejectedError("imports.file_type_unsupported", "Ce fichier est du XML ou du HTML, pas un tableau. Utilisez un fichier .xlsx ou .csv.");
  }
  if (XLSX_EXTENSIONS.has(ext)) {
    throw new FileRejectedError("imports.file_type_mismatch", `Le fichier se nomme « .${ext} » mais son contenu est du texte, pas un classeur Excel.`);
  }
  return { kind: "CSV", extension: ext };
}
