/**
 * Lecteur XML linéaire, en flux, pour les parties d'un classeur XLSX (INV-S4).
 *
 * Volontairement minimal et DÉFENSIF :
 *  - `<!DOCTYPE` et `<!ENTITY` sont REFUSÉS : aucune expansion d'entité définie par le document (« billion laughs ») ;
 *    seules les cinq entités prédéfinies et les références numériques sont décodées ;
 *  - profondeur, longueur d'une balise, nombre d'attributs et longueur d'un texte sont bornés ;
 *  - jamais de résolution externe (DTD, XInclude), jamais de `eval` ;
 *  - le préfixe d'espace de noms est ignoré (`x:row` = `row`) : les producteurs de classeurs en emploient plusieurs.
 *
 * `XmlScanner.push(chunk)` renvoie les événements complets du morceau ; un jeton coupé en deux est conservé pour le
 * morceau suivant. Mémoire : au plus la balise ou le texte en cours (borné).
 */
import { FileRejectedError } from "../../domain/errors";

export type XmlEvent =
  | { readonly type: "open"; readonly name: string; readonly attrs: Readonly<Record<string, string>>; readonly selfClosing: boolean }
  | { readonly type: "close"; readonly name: string }
  | { readonly type: "text"; readonly text: string };

export interface XmlLimits {
  readonly maxDepth: number;
  readonly maxTagLength: number;
  readonly maxTextLength: number;
  readonly maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = { maxDepth: 64, maxTagLength: 65_536, maxTextLength: 4_000_000, maxAttributes: 64 };

const unsafe = (message: string): FileRejectedError => new FileRejectedError("imports.file_unsafe", message);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,5});/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) return "";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? whole;
  });
}

const localName = (qname: string): string => {
  const i = qname.indexOf(":");
  return i < 0 ? qname : qname.slice(i + 1);
};

function parseAttributes(source: string, limits: XmlLimits): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    count += 1;
    if (count > limits.maxAttributes) throw unsafe("Balise XML avec trop d'attributs.");
    attrs[localName(m[1] as string)] = decodeEntities((m[2] ?? m[3]) as string);
  }
  return attrs;
}

export class XmlScanner {
  private buffer = "";
  private depth = 0;
  private started = false;

  constructor(private readonly limits: XmlLimits = DEFAULT_XML_LIMITS) {}

  push(chunk: string): XmlEvent[] {
    this.buffer += chunk;
    const events: XmlEvent[] = [];
    let pos = 0;
    const buf = this.buffer;
    while (pos < buf.length) {
      if (buf[pos] !== "<") {
        const next = buf.indexOf("<", pos);
        if (next < 0) {
          // Texte jusqu'à la fin du morceau : on le garde (il peut continuer) sauf s'il devient trop long.
          if (buf.length - pos > this.limits.maxTextLength) throw unsafe("Texte XML trop long.");
          break;
        }
        const text = buf.slice(pos, next);
        if (this.depth > 0 && text !== "") events.push({ type: "text", text: decodeEntities(text) });
        pos = next;
        continue;
      }
      // Jeton markup.
      if (buf.startsWith("<!--", pos)) {
        const end = buf.indexOf("-->", pos + 4);
        if (end < 0) {
          if (buf.length - pos > this.limits.maxTagLength) throw unsafe("Commentaire XML trop long.");
          break;
        }
        pos = end + 3;
        continue;
      }
      if (buf.startsWith("<![CDATA[", pos)) {
        const end = buf.indexOf("]]>", pos + 9);
        if (end < 0) {
          if (buf.length - pos > this.limits.maxTextLength) throw unsafe("Section CDATA trop longue.");
          break;
        }
        if (this.depth > 0) events.push({ type: "text", text: buf.slice(pos + 9, end) });
        pos = end + 3;
        continue;
      }
      if (/^<!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(buf.slice(pos, pos + 12))) throw unsafe("Déclaration de type de document (DOCTYPE / ENTITY) interdite : fichier refusé.");
      if (buf.startsWith("<?", pos)) {
        const end = buf.indexOf("?>", pos + 2);
        if (end < 0) {
          if (buf.length - pos > this.limits.maxTagLength) throw unsafe("Instruction XML trop longue.");
          break;
        }
        pos = end + 2;
        continue;
      }
      // Balise : trouver le `>` en respectant les guillemets des attributs.
      let i = pos + 1;
      let quote = "";
      let end = -1;
      for (; i < buf.length; i += 1) {
        const c = buf[i] as string;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") {
          end = i;
          break;
        }
        if (i - pos > this.limits.maxTagLength) throw unsafe("Balise XML trop longue.");
      }
      if (end < 0) break;
      const body = buf.slice(pos + 1, end);
      pos = end + 1;
      if (body.startsWith("/")) {
        this.depth -= 1;
        if (this.depth < 0) throw unsafe("XML mal formé (balise fermante inattendue).");
        events.push({ type: "close", name: localName(body.slice(1).trim()) });
        continue;
      }
      const selfClosing = body.endsWith("/");
      const inner = selfClosing ? body.slice(0, -1) : body;
      const nameMatch = /^([^\s/>]+)/.exec(inner);
      if (!nameMatch) throw unsafe("XML mal formé (balise sans nom).");
      const name = localName(nameMatch[1] as string);
      events.push({ type: "open", name, attrs: parseAttributes(inner.slice((nameMatch[1] as string).length), this.limits), selfClosing });
      this.started = true;
      if (!selfClosing) {
        this.depth += 1;
        if (this.depth > this.limits.maxDepth) throw unsafe("XML trop profond.");
      } else events.push({ type: "close", name });
    }
    this.buffer = buf.slice(pos);
    return events;
  }

  /** Fin du flux : le document doit être entièrement refermé. */
  end(): void {
    if (this.buffer.trim() !== "" && this.started) throw unsafe("XML tronqué.");
    if (this.depth !== 0) throw unsafe("XML tronqué (balises non refermées).");
  }
}

/** Décode un flux d'octets UTF-8 en chaînes (un caractère multi-octets coupé entre deux morceaux est conservé). */
export function createUtf8Decoder(): (chunk: Uint8Array, last?: boolean) => string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return (chunk, last = false) => {
    let text = decoder.decode(chunk, { stream: !last });
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  };
}
