import type { GradeDecl, Key, StudentDecl, TeacherDecl } from "./types";

/**
 * Aides de rédaction : elles produisent des déclarations JSON ordinaires. Un scénario exporte des DONNÉES,
 * jamais de logique (le seeder v2 ne doit pas dépendre de ces aides).
 */

export function student(key: Key, firstName: string, lastName: string, extra: Partial<StudentDecl> = {}): StudentDecl {
  return { key, firstName, lastName, ...extra };
}

export function teacher(key: Key, firstName: string, lastName: string, status: TeacherDecl["status"]): TeacherDecl {
  return { key, firstName, lastName, status };
}

/**
 * Notes d'un étudiant sur une ECUE : une liste de devoirs (ou aucun) et la note d'examen (ou aucune).
 * `exam: null` = examen non encore passé ; `devoirs: []` = pas de contrôle continu.
 */
export function ecueGrades(
  group: Key,
  studentKey: Key,
  ecue: Key,
  devoirs: number | number[] | null,
  exam: number | null,
  extra: { max?: number; via?: "manual" | "assessment"; session?: 1 | 2 } = {},
): GradeDecl[] {
  const out: GradeDecl[] = [];
  const list = devoirs === null ? [] : Array.isArray(devoirs) ? devoirs : [devoirs];
  list.forEach((value, i) =>
    out.push({
      student: studentKey,
      group,
      ecue,
      nature: "devoir",
      value,
      label: `Devoir ${i + 1}`,
      ...(extra.max ? { max: extra.max } : {}),
      ...(extra.via ? { via: extra.via } : {}),
    }),
  );
  if (exam !== null) {
    out.push({
      student: studentKey,
      group,
      ecue,
      nature: "examen",
      value: exam,
      label: "Examen",
      session: extra.session ?? 1,
      ...(extra.max ? { max: extra.max } : {}),
      ...(extra.via ? { via: extra.via } : {}),
    });
  }
  return out;
}

/** Même couple (devoir, examen) pour plusieurs ECUE. */
export function sameOnEcues(
  group: Key,
  studentKey: Key,
  ecues: Key[],
  devoirs: number | number[] | null,
  exam: number | null,
): GradeDecl[] {
  return ecues.flatMap((e) => ecueGrades(group, studentKey, e, devoirs, exam));
}
