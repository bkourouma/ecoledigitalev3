"use client";

/**
 * Contexte d'enseignement de l'enseignant (portail `/v2/teacher`) : SES classes, avec nom, périodes de l'année et matières qu'il peut
 * évaluer, lus dans `GET /people/me/classes`. Sert aux écrans qui, pour un enseignant sans `academic.classroom.read`, ne peuvent
 * pas interroger la structure académique (liste des classes, périodes, cours d'une classe).
 *
 * Rien n'est décidé ici : une classe qui n'est pas dans cette liste n'est jamais proposée ; l'API reste la barrière (404 / 403).
 */

import { useMemo } from "react";
import type { z } from "zod";
import type { peopleMyClassDtoSchema } from "@ecoledigitale/contracts/v2/people";
import { payrollPayslipDtoSchema } from "@ecoledigitale/contracts/v2/payroll";
import { usePermission } from "@/platform/access";
import type { OptionsResult, SelectOption } from "@/platform/ui/SelectAsync";
import { useApiAction } from "./actions";
import { useClassrooms } from "./academic";
import { useMyClasses } from "./people";

export type MyClass = z.infer<typeof peopleMyClassDtoSchema>;

export interface TeachingContext {
  classes: readonly MyClass[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  classroomName(id: string | null | undefined): string | null;
  classroomCode(id: string | null | undefined): string | null;
  periodLabel(id: string | null | undefined): string | null;
  nodeLabel(id: string | null | undefined): string | null;
  periodsOf(classroomId: string | null | undefined): Array<{ id: string; label: string }>;
  nodesOf(classroomId: string | null | undefined): Array<{ id: string; label: string }>;
  has(classroomId: string | null | undefined): boolean;
}

export function teachingContextOf(classes: readonly MyClass[], state: { isLoading: boolean; error: unknown; refetch: () => void }): TeachingContext {
  const byId = new Map(classes.map((c) => [c.classroomId, c]));
  const periods = new Map<string, string>();
  const nodes = new Map<string, string>();
  for (const c of classes) {
    for (const p of c.periods ?? []) periods.set(p.id, p.label);
    for (const n of c.nodes ?? []) nodes.set(n.id, n.label);
    for (const a of c.assignments) if (a.curriculumNodeId && a.nodeLabel) nodes.set(a.curriculumNodeId, a.nodeLabel);
  }
  return {
    classes,
    ...state,
    classroomName: (id) => (id ? (byId.get(id)?.classroomName ?? null) : null),
    classroomCode: (id) => (id ? (byId.get(id)?.classroomCode ?? null) : null),
    periodLabel: (id) => (id ? (periods.get(id) ?? null) : null),
    nodeLabel: (id) => (id ? (nodes.get(id) ?? null) : null),
    periodsOf: (id) => (id ? (byId.get(id)?.periods ?? []).map((p) => ({ id: p.id, label: p.label })) : []),
    nodesOf: (id) => (id ? (byId.get(id)?.nodes ?? []) : []),
    has: (id) => (id ? byId.has(id) : false),
  };
}

export function useTeachingContext(enabled = true): TeachingContext {
  const q = useMyClasses(enabled);
  return useMemo(
    () => teachingContextOf(q.data ?? [], { isLoading: q.isPending && q.fetchStatus !== "idle", error: q.error, refetch: () => void q.refetch() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `q` change à chaque rendu ; on dépend des données
    [q.data, q.isPending, q.fetchStatus, q.error],
  );
}

/**
 * Un enseignant (droit « mes classes ») SANS droit de lire la structure académique s'appuie sur son contexte d'enseignement ;
 * tout autre profil garde les lectures académiques habituelles (comportement inchangé).
 */
export function useTeachingScope(): TeachingContext & { useMine: boolean } {
  const academic = usePermission("academic.classroom.read");
  const teacher = usePermission("staff.own.read");
  const useMine = teacher.allowed && !academic.allowed && !academic.isLoading;
  const ctx = useTeachingContext(useMine);
  return { ...ctx, useMine, isLoading: ctx.isLoading || academic.isLoading };
}

/** Options du sélecteur de classe des évaluations : toutes les classes (gestion) ou SES classes (enseignant sans lecture académique). */
export function useAssessmentClassroomOptions(search: string, enabled: boolean): OptionsResult {
  const scope = useTeachingScope();
  // Hors enseignant sans lecture académique, comportement historique : la liste est demandée à l'API (qui applique les droits).
  const all = useClassrooms({ pageSize: 200 }, { enabled: enabled && !scope.useMine && !scope.isLoading });
  const needle = search.trim().toLowerCase();
  const matches = (o: SelectOption) => needle === "" || o.label.toLowerCase().includes(needle) || (o.description ?? "").toLowerCase().includes(needle);
  const mine: SelectOption[] = scope.classes.map((c) => ({ value: c.classroomId, label: c.classroomName ?? c.classroomId.slice(0, 8), description: c.classroomCode ?? undefined }));
  const admin: SelectOption[] = (all.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, description: c.code }));
  return scope.useMine ? { options: mine.filter(matches), isLoading: scope.isLoading, error: scope.error } : { options: admin.filter(matches), isLoading: all.isFetching, error: all.error };
}

// ---------------------------------------------------------------------------
// Paie de l'enseignant : SES bulletins (`/payroll/my/*`)
// ---------------------------------------------------------------------------

export const myPayslipPdfPath = (id: string): string => `/api/v1/payroll/my/payslips/${id}/pdf`;

/**
 * Contestation de SON bulletin par son titulaire (`payroll.my.dispute`) : motif obligatoire (3 à 500 caractères). Seul un bulletin
 * arrêté et non versé est contestable : tout autre état, ou le bulletin d'un autre, est refusé par l'API (409 / 404 uniforme).
 */
export function useDisputeMyPayslip() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `/api/v1/payroll/my/payslips/${v.id}/dispute`,
    body: (v) => ({ reason: v.reason }),
    schema: payrollPayslipDtoSchema,
    invalidate: [["payroll", "my"]],
  });
}
