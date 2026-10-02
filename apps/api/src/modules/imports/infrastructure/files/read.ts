/**
 * Point d'entrée de la lecture d'un fichier téléversé : contrôle du type réel, de la taille, puis ouverture du lecteur
 * adapté. Lève `FileRejectedError` pour tout fichier refusé.
 */
import { createHash } from "node:crypto";
import { FileRejectedError } from "../../domain/errors";
import { openCsv } from "./csv";
import { safeFileName, sniffFile } from "./sniff";
import type { FileLimits, TableReader } from "./types";
import { openXlsx } from "./xlsx";

export interface OpenedFile {
  readonly reader: TableReader;
  readonly fileName: string;
  readonly sha256: string;
  readonly size: number;
}

export async function openUploadedFile(
  bytes: Uint8Array,
  declared: { fileName: string; contentType?: string | undefined; sheet?: string | undefined },
  limits: FileLimits,
): Promise<OpenedFile> {
  if (bytes.length > limits.maxBytes) {
    throw new FileRejectedError("imports.file_too_large", `Le fichier dépasse la taille autorisée (${Math.floor(limits.maxBytes / (1024 * 1024))} Mio).`, { maxBytes: limits.maxBytes });
  }
  const sniffed = sniffFile(bytes, declared);
  const options = { limits, sheet: declared.sheet };
  const reader = sniffed.kind === "XLSX" ? await openXlsx(bytes, options) : openCsv(bytes, options);
  return { reader, fileName: safeFileName(declared.fileName), sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

export { safeFileName, sniffFile } from "./sniff";
export type { FileLimits, RawRow, TableReader } from "./types";
export { DEFAULT_FILE_LIMITS, MIB } from "./types";
