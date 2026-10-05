/**
 * Analyse d'un fichier CSV de candidats libres (import par l'établissement) : fonction PURE, sans règle d'examen.
 *
 * Colonnes reconnues (en-tête obligatoire, séparateur `;` ou `,`, ordre libre) :
 *   nom ; prenoms ; naissance (AAAA-MM-JJ) ; lieu ; sexe (F|M) ; telephone ; email ; adresse ; piece_type ; piece_numero ;
 *   tuteur ; lien_tuteur ; tel_tuteur ; email_tuteur ; classe_examen (oui|non) ; tentatives
 * Une ligne invalide est signalée (numéro de ligne + motif) ; les lignes valides partent à l'API, qui revalide tout.
 */
import type { ExternalCandidateInput } from "@/platform/v2/examinations-external";

export interface ParsedRow {
  line: number;
  value: ExternalCandidateInput | null;
  error: "MISSING_FIELD" | "BAD_DATE" | "BAD_SEX" | "BAD_BOOLEAN" | "BAD_NUMBER" | "NO_CONTACT" | null;
  field?: string;
}

const HEADERS = ["nom", "prenoms", "naissance", "lieu", "sexe", "telephone", "email", "adresse", "piece_type", "piece_numero", "tuteur", "lien_tuteur", "tel_tuteur", "email_tuteur", "classe_examen", "tentatives"] as const;
type Header = (typeof HEADERS)[number];

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const opt = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

export function parseExternalCsv(text: string): { rows: ParsedRow[]; unknownHeaders: string[]; missingHeaders: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], unknownHeaders: [], missingHeaders: [...HEADERS.slice(0, 5)] };
  const sep = (lines[0] as string).includes(";") ? ";" : ",";
  const headers = splitLine(lines[0] as string, sep).map(norm);
  const unknownHeaders = headers.filter((h) => !(HEADERS as readonly string[]).includes(h));
  const missingHeaders = (["nom", "prenoms", "naissance", "sexe", "classe_examen"] as const).filter((h) => !headers.includes(h));
  const rows: ParsedRow[] = [];
  if (missingHeaders.length > 0) return { rows, unknownHeaders, missingHeaders };
  lines.slice(1).forEach((raw, idx) => {
    const line = idx + 2;
    const cells = splitLine(raw, sep);
    const get = (h: Header): string | undefined => cells[headers.indexOf(h)];
    const fail = (error: NonNullable<ParsedRow["error"]>, field?: string): void => {
      rows.push({ line, value: null, error, ...(field ? { field } : {}) });
    };
    for (const h of ["nom", "prenoms", "naissance", "sexe", "classe_examen"] as const) if (!opt(get(h))) return fail("MISSING_FIELD", h);
    const birth = opt(get("naissance")) as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return fail("BAD_DATE", "naissance");
    const sex = (opt(get("sexe")) as string).toUpperCase();
    if (sex !== "F" && sex !== "M") return fail("BAD_SEX", "sexe");
    const gradeRaw = norm(opt(get("classe_examen")) as string);
    if (!["oui", "non", "true", "false", "1", "0"].includes(gradeRaw)) return fail("BAD_BOOLEAN", "classe_examen");
    const attemptsRaw = opt(get("tentatives")) ?? "0";
    if (!/^\d{1,2}$/.test(attemptsRaw)) return fail("BAD_NUMBER", "tentatives");
    const phone = opt(get("telephone"));
    const email = opt(get("email"));
    const gPhone = opt(get("tel_tuteur"));
    const gEmail = opt(get("email_tuteur"));
    if (!phone && !email && !gPhone && !gEmail) return fail("NO_CONTACT", "telephone");
    const pieceKind = opt(get("piece_type"));
    const pieceNumber = opt(get("piece_numero"));
    rows.push({
      line,
      error: null,
      value: {
        identity: { lastName: opt(get("nom")) as string, firstName: opt(get("prenoms")) as string, birthDate: birth, birthPlace: opt(get("lieu")), sex },
        profile: {
          contactPhone: phone, contactEmail: email, addressLine: opt(get("adresse")), idPieceKind: pieceKind ? pieceKind.toUpperCase().replace(/[^A-Z0-9_]/g, "_") : null, idPieceNumber: pieceNumber,
          guardianName: opt(get("tuteur")), guardianRelation: opt(get("lien_tuteur")), guardianPhone: gPhone, guardianEmail: gEmail,
          declaredInExamGrade: ["oui", "true", "1"].includes(gradeRaw), declaredPriorAttempts: Number(attemptsRaw),
        },
      },
    });
  });
  return { rows, unknownHeaders, missingHeaders };
}
