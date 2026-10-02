/**
 * Fabrique de fichiers de test : octets réels (PDF, images, ZIP / Office / OpenDocument minimaux) pour exercer la détection
 * du type RÉEL. Un ZIP « stocké » (sans compression) suffit : le module ne lit que le répertoire central.
 */
const enc = new TextEncoder();

export const pdfBytes = (extra = ""): Uint8Array => enc.encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

export const jpegBytes = (): Uint8Array => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

export const pngBytes = (): Uint8Array =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89]);

export const gifBytes = (): Uint8Array => enc.encode("GIF89a\u0001\u0000\u0001\u0000");

export const webpBytes = (): Uint8Array => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

export const textBytes = (s = "nom;note\nAwa;14\n"): Uint8Array => enc.encode(s);

export const exeBytes = (): Uint8Array => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]);

export const oleBytes = (extra?: Uint8Array): Uint8Array => {
  const head = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]);
  if (!extra) return head;
  const out = new Uint8Array(head.length + extra.length);
  out.set(head);
  out.set(extra, head.length);
  return out;
};

export const utf16le = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i += 1) out[i * 2] = s.charCodeAt(i);
  return out;
};

export interface ZipEntry {
  name: string;
  content?: string;
  /** Taille décompressée déclarée (pour simuler une bombe) ; sinon la taille réelle. */
  declaredSize?: number;
}

/** ZIP minimal, entrées « stockées ». */
export function zipBytes(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const e of entries) {
    const name = [...enc.encode(e.name)];
    const data = [...enc.encode(e.content ?? "")];
    const offset = chunks.length;
    chunks.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(e.declaredSize ?? data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    );
  }
  const cdOffset = chunks.length;
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(cdOffset), ...u16(0)];
  return Uint8Array.from([...chunks, ...central, ...eocd]);
}

export const docxBytes = (extra: readonly ZipEntry[] = []): Uint8Array =>
  zipBytes([{ name: "[Content_Types].xml", content: "<Types/>" }, { name: "word/document.xml", content: "<w:document/>" }, ...extra]);

export const xlsxBytes = (): Uint8Array => zipBytes([{ name: "[Content_Types].xml", content: "<Types/>" }, { name: "xl/workbook.xml", content: "<workbook/>" }]);

export const pptxBytes = (): Uint8Array => zipBytes([{ name: "[Content_Types].xml", content: "<Types/>" }, { name: "ppt/presentation.xml", content: "<p/>" }]);

export const odtBytes = (): Uint8Array => zipBytes([{ name: "mimetype", content: "application/vnd.oasis.opendocument.text" }, { name: "content.xml", content: "<office/>" }]);

export const plainZipBytes = (): Uint8Array => zipBytes([{ name: "a.txt", content: "bonjour" }]);

/** Contenu unique par appel (le dédoublonnage par SHA-256 refuse deux dépôts identiques). */
let counter = 0;
export const uniquePdf = (): Uint8Array => pdfBytes(`% unique ${(counter += 1)} ${Math.random()}`);
