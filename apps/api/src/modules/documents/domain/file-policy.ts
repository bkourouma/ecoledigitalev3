/**
 * Contrôle d'un fichier déposé — FONCTIONS PURES (spec 024 §7) : nom assaini, type RÉEL par octets magiques, cohérence
 * extension / type, liste blanche de la catégorie, taille. Le type MIME déclaré par le client n'est JAMAIS utilisé.
 *
 * Types reconnus (liste fermée, `DOCUMENT_SUPPORTED_EXTENSIONS` des contrats) : PDF, JPEG, PNG, WebP, GIF, TIFF, Office OOXML
 * (docx, xlsx, pptx ; macros refusées), Office 97 (doc, xls, ppt : en-tête OLE + extension cohérente), OpenDocument (odt, ods,
 * odp), texte (txt, csv : UTF-8 strict, aucun balisage HTML / XML / SVG). Archives, médias, SVG, HTML : jamais acceptés.
 */
import { createHash } from "node:crypto";
import { DOCUMENT_SUPPORTED_EXTENSIONS, type DocumentExtension } from "@ecoledigitale/contracts/src/v2/documents";

// ---------------------------------------------------------------------------
// Nom de fichier
// ---------------------------------------------------------------------------

/** Extensions « intermédiaires » dangereuses : `facture.exe.pdf` est refusé (nom piégé). */
const DANGEROUS_SEGMENTS: ReadonlySet<string> = new Set([
  "exe", "com", "bat", "cmd", "sh", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "dll", "scr", "jar", "php", "phtml", "asp",
  "aspx", "jsp", "cgi", "py", "rb", "pl", "html", "htm", "xhtml", "svg", "hta", "lnk", "reg", "apk", "app", "docm", "xlsm", "pptm", "dotm",
  "xlam", "iso", "dmg", "bin", "pif", "gadget", "msc", "cpl",
]);

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Marques bidirectionnelles, espaces de largeur nulle, séparateurs de ligne : invisibles, servent à tromper l'affichage.
// eslint-disable-next-line no-control-regex
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff],
];
const escapeCode = (n: number): string => String.fromCharCode(92) + "u" + n.toString(16).padStart(4, "0");
const INVISIBLE = new RegExp("[" + INVISIBLE_RANGES.map(([a, b]) => escapeCode(a) + "-" + escapeCode(b)).join("") + "]", "g");
const BOM = String.fromCharCode(0xfeff);

export const FILE_NAME_MAX = 120;

export type SanitizedName = { ok: true; fileName: string; base: string; extension: string } | { ok: false; reason: string };

/**
 * Assainit un nom de fichier fourni par le client : composante finale seulement, NFC, caractères invisibles et réservés
 * remplacés, points / espaces de bord retirés, 120 caractères max en conservant l'extension. Refuse l'absence d'extension et
 * toute extension intermédiaire dangereuse.
 */
export function sanitizeFileName(raw: string): SanitizedName {
  if (typeof raw !== "string") return { ok: false, reason: "Nom de fichier absent." };
  let name = raw.normalize("NFC");
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(INVISIBLE, "").replace(/[<>:"|?*\\/]/g, "_").replace(/\s+/g, " ").trim();
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (name.length === 0) return { ok: false, reason: "Nom de fichier vide." };
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { ok: false, reason: "Le nom du fichier doit comporter une extension (ex. .pdf)." };
  let base = name.slice(0, dot).replace(/[.\s]+$/, "");
  const extension = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(extension)) return { ok: false, reason: "Extension de fichier invalide." };
  for (const segment of base.split(".")) {
    if (DANGEROUS_SEGMENTS.has(segment.trim().toLowerCase())) return { ok: false, reason: "Nom de fichier refusé (extension intermédiaire dangereuse)." };
  }
  if (base.length === 0) base = "document";
  if (RESERVED_WINDOWS.test(base)) base = `_${base}`;
  const room = FILE_NAME_MAX - extension.length - 1;
  if (base.length > room) base = base.slice(0, room).replace(/[.\s]+$/, "");
  if (base.length === 0) base = "document";
  return { ok: true, fileName: `${base}.${extension}`, base, extension };
}

// ---------------------------------------------------------------------------
// Détection du type réel
// ---------------------------------------------------------------------------

export type DetectedKind = "pdf" | "jpeg" | "png" | "webp" | "gif" | "tiff" | "docx" | "xlsx" | "pptx" | "ole" | "odt" | "ods" | "odp" | "text";

export interface DetectedType {
  readonly kind: DetectedKind;
  /** Type MIME RÉEL. Pour `ole` et `text`, il dépend de l'extension déclarée (voir `resolveMime`). */
  readonly mime: string;
  /** Extensions cohérentes avec ce contenu. */
  readonly extensions: readonly DocumentExtension[];
}

export type DetectResult =
  | { ok: true; type: DetectedType }
  | { ok: false; code: "type_undetected" | "macro_content" | "type_not_allowed"; message: string };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04] as const;

const OOXML_MIME: Readonly<Record<"docx" | "xlsx" | "pptx", string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ODF_MIME: Readonly<Record<"odt" | "ods" | "odp", string>> = {
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};
const OLE_MIME: Readonly<Record<"doc" | "xls" | "ppt", string>> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED = 1024 * 1024 * 1024; // 1 Gio déclaré : au-delà, bombe de décompression probable.

interface ZipEntries {
  readonly names: string[];
  readonly totalUncompressed: number;
}

/** Noms et tailles déclarées des entrées d'un ZIP, lus dans le répertoire central (aucune décompression). `null` : invalide. */
export function readZipEntries(bytes: Uint8Array): ZipEntries | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  if (bytes.length < minEocd) return null;
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - minEocd - 0xffff);
  for (let i = bytes.length - minEocd; i >= lowest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // ZIP64 : non pris en charge
  if (count > MAX_ZIP_ENTRIES || cdOffset + cdSize > eocd) return null;
  const names: string[] = [];
  let total = 0;
  let p = cdOffset;
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return null;
    const uncompressed = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > bytes.length) return null;
    names.push(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    total += uncompressed;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { names, totalUncompressed: total };
}

/** Contenu de la première entrée d'un ZIP SI elle est stockée sans compression et de petite taille (`mimetype` d'OpenDocument). */
function readFirstStoredEntry(bytes: Uint8Array): { name: string; content: string } | null {
  if (!startsWith(bytes, ZIP_LOCAL) || bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  if (method !== 0 || size > 200 || start + size > bytes.length) return null;
  return {
    name: new TextDecoder().decode(bytes.subarray(30, 30 + nameLen)),
    content: new TextDecoder().decode(bytes.subarray(start, start + size)),
  };
}

const utf16 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i += 1) out[i * 2] = s.charCodeAt(i);
  return out;
};
const VBA_UTF16 = utf16("_VBA_PROJECT");

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Texte brut : UTF-8 valide, aucun octet nul, peu de contrôles, pas de balisage HTML / XML / SVG en tête. */
function looksLikeSafeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 1_000_000));
  let controls = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) controls += 1;
  }
  if (controls > sample.length * 0.01) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
  } catch {
    // un caractère multi-octets coupé en bordure d'échantillon reste valide : on retente sans la fin
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, Math.max(0, sample.length - 3)));
    } catch {
      return false;
    }
  }
  const head = text.split(BOM).join("").trimStart().slice(0, 512).toLowerCase();
  return !/^<(!doctype|html|\?xml|svg|script|body|head|iframe|object|embed|a\s|\?php)/.test(head);
}

/** Détecte le type RÉEL d'après les octets (jamais le type déclaré). */
export function detectFileType(bytes: Uint8Array): DetectResult {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return ok("pdf", "application/pdf", ["pdf"]);
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return ok("jpeg", "image/jpeg", ["jpg", "jpeg"]);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok("png", "image/png", ["png"]);
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return ok("webp", "image/webp", ["webp"]);
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return ok("gif", "image/gif", ["gif"]);
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return ok("tiff", "image/tiff", ["tif", "tiff"]);

  if (startsWith(bytes, OLE_SIGNATURE)) {
    if (includesBytes(bytes, VBA_UTF16)) return { ok: false, code: "macro_content", message: "Document Office contenant des macros : refusé." };
    return ok("ole", "application/x-ole-storage", ["doc", "xls", "ppt"]);
  }

  if (startsWith(bytes, ZIP_LOCAL)) {
    const zip = readZipEntries(bytes);
    if (!zip) return { ok: false, code: "type_undetected", message: "Archive illisible : type de fichier non reconnu." };
    if (zip.totalUncompressed > MAX_ZIP_UNCOMPRESSED) return { ok: false, code: "type_not_allowed", message: "Contenu compressé excessif : refusé." };
    const names = new Set(zip.names.map((n) => n.toLowerCase()));
    const has = (n: string): boolean => names.has(n);
    if (has("[content_types].xml")) {
      if (zip.names.some((n) => /(^|\/)vbaproject\.bin$/i.test(n))) return { ok: false, code: "macro_content", message: "Document Office contenant des macros : refusé." };
      if (has("word/document.xml")) return ok("docx", OOXML_MIME.docx, ["docx"]);
      if (has("xl/workbook.xml")) return ok("xlsx", OOXML_MIME.xlsx, ["xlsx"]);
      if (has("ppt/presentation.xml")) return ok("pptx", OOXML_MIME.pptx, ["pptx"]);
      return { ok: false, code: "type_not_allowed", message: "Archive Office non reconnue : refusée." };
    }
    const first = readFirstStoredEntry(bytes);
    if (first && first.name === "mimetype") {
      const m = first.content.trim();
      if (m === ODF_MIME.odt) return ok("odt", m, ["odt"]);
      if (m === ODF_MIME.ods) return ok("ods", m, ["ods"]);
      if (m === ODF_MIME.odp) return ok("odp", m, ["odp"]);
    }
    return { ok: false, code: "type_not_allowed", message: "Les archives ne sont pas acceptées." };
  }

  if (looksLikeSafeText(bytes)) return ok("text", "text/plain", ["txt", "csv"]);
  return { ok: false, code: "type_undetected", message: "Type de fichier non reconnu (contrôlé sur le contenu réel du fichier)." };
}

function ok(kind: DetectedKind, mime: string, extensions: readonly DocumentExtension[]): DetectResult {
  return { ok: true, type: { kind, mime, extensions } };
}

/** Type MIME final : celui du contenu, affiné par l'extension déclarée pour `ole` (doc / xls / ppt) et `text` (txt / csv). */
export function resolveMime(type: DetectedType, extension: string): string {
  if (type.kind === "ole" && (extension === "doc" || extension === "xls" || extension === "ppt")) return OLE_MIME[extension];
  if (type.kind === "text") return extension === "csv" ? "text/csv" : "text/plain";
  return type.mime;
}

export type FileCheckCode = "type_undetected" | "macro_content" | "type_not_allowed" | "type_mismatch";

export interface FileCheckOk {
  readonly ok: true;
  readonly fileName: string;
  readonly extension: DocumentExtension;
  readonly mime: string;
  readonly kind: DetectedKind;
  readonly sha256: string;
  readonly size: number;
}

export type FileCheck = FileCheckOk | { readonly ok: false; readonly code: FileCheckCode | "file_name_rejected" | "file_empty" | "file_too_large"; readonly message: string };

export interface FileLimits {
  /** Plafond effectif en octets (catégorie ?? établissement, borné par la plateforme). */
  readonly maxBytes: number;
  /** Liste blanche de la catégorie. */
  readonly allowedExtensions: readonly string[];
}

const isSupported = (ext: string): ext is DocumentExtension => (DOCUMENT_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);

/**
 * Contrôle complet, dans l'ordre : taille, nom, type réel, cohérence extension / type, liste blanche. Le hachage est calculé en
 * dernier (le plus coûteux) et seulement si tout est accepté.
 */
export function checkFile(input: { fileName: string; bytes: Uint8Array }, limits: FileLimits): FileCheck {
  const size = input.bytes.byteLength;
  if (size === 0) return { ok: false, code: "file_empty", message: "Le fichier est vide." };
  if (size > limits.maxBytes) {
    return { ok: false, code: "file_too_large", message: `Le fichier dépasse la taille maximale autorisée (${formatBytes(limits.maxBytes)}).` };
  }
  const name = sanitizeFileName(input.fileName);
  if (!name.ok) return { ok: false, code: "file_name_rejected", message: name.reason };
  const detected = detectFileType(input.bytes);
  if (!detected.ok) return { ok: false, code: detected.code, message: detected.message };
  const ext = name.extension;
  if (!detected.type.extensions.includes(ext as DocumentExtension)) {
    return { ok: false, code: "type_mismatch", message: `Le contenu du fichier ne correspond pas à l'extension « .${ext} » (contenu réel : ${describeKind(detected.type.kind)}).` };
  }
  if (!isSupported(ext) || !limits.allowedExtensions.includes(ext)) {
    return { ok: false, code: "type_not_allowed", message: `Les fichiers « .${ext} » ne sont pas acceptés dans cette catégorie.` };
  }
  return { ok: true, fileName: name.fileName, extension: ext, mime: resolveMime(detected.type, ext), kind: detected.type.kind, sha256: sha256Hex(input.bytes), size };
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const KIND_LABELS: Readonly<Record<DetectedKind, string>> = {
  pdf: "PDF", jpeg: "image JPEG", png: "image PNG", webp: "image WebP", gif: "image GIF", tiff: "image TIFF", docx: "Word", xlsx: "Excel", pptx: "PowerPoint",
  ole: "Office 97", odt: "OpenDocument texte", ods: "OpenDocument tableur", odp: "OpenDocument présentation", text: "texte",
};
export const describeKind = (kind: DetectedKind): string => KIND_LABELS[kind];

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1).replace(".", ",")} Go`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1).replace(".", ",")} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

// ---------------------------------------------------------------------------
// Prévisualisation
// ---------------------------------------------------------------------------

export type PreviewKind = "IMAGE" | "PDF" | "TEXT" | "OFFICE" | "NONE";

/** Famille de prévisualisation d'un type MIME RÉEL (déjà contrôlé à l'upload). */
export function previewKindOf(mime: string): PreviewKind {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") return "IMAGE";
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/plain" || mime === "text/csv") return "TEXT";
  if (
    mime.startsWith("application/vnd.openxmlformats-officedocument.") ||
    mime.startsWith("application/vnd.oasis.opendocument.") ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return "OFFICE";
  }
  return "NONE";
}
