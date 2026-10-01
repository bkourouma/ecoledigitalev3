/**
 * Export iCalendar (RFC 5545) d'un emploi du temps (spec 017 AC6.4). Domaine PUR.
 *
 * Les instants sont émis en UTC (`DTSTART:20261005T080000Z`), non ambigus quel que soit le client ;
 * le fuseau de l'établissement est annoncé par `X-WR-TIMEZONE` (affichage par défaut des clients).
 * Les séances annulées sont exportées avec `STATUS:CANCELLED` pour que l'agenda externe les retire.
 * Les lignes sont pliées à 75 octets et les caractères spéciaux échappés.
 */

export interface IcsEvent {
  readonly uid: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly summary: string;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly status: "CONFIRMED" | "CANCELLED";
  /** Dernière modification (DTSTAMP / LAST-MODIFIED). */
  readonly updatedAt: Date;
}

export interface IcsCalendar {
  readonly name: string;
  readonly timeZone: string;
  readonly prodId?: string;
  readonly events: readonly IcsEvent[];
  readonly now: Date;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export function formatIcsInstant(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Plie une ligne à 75 octets UTF-8 au plus (RFC 5545 §3.1) sans couper un caractère. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = ch;
      bytes = size;
      limit = 74; // la ligne de continuation commence par une espace
    } else {
      current += ch;
      bytes += size;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${cal.prodId ?? "-//EcoleDigitale//Emploi du temps//FR"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(cal.name)}`,
    `X-WR-TIMEZONE:${cal.timeZone}`,
  ];
  const events = [...cal.events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.uid.localeCompare(b.uid));
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@ecoledigitale`,
      `DTSTAMP:${formatIcsInstant(cal.now)}`,
      `LAST-MODIFIED:${formatIcsInstant(e.updatedAt)}`,
      `DTSTART:${formatIcsInstant(e.startsAt)}`,
      `DTEND:${formatIcsInstant(e.endsAt)}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    lines.push(`STATUS:${e.status}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
