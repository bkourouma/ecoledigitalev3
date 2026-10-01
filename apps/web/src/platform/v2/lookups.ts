"use client";

/**
 * Sources d'options pour `SelectAsync` : une fonction `(search, enabled) => { options, isLoading, error }` par entité.
 * La recherche textuelle est faite par l'API quand elle la propose (élèves, tuteurs, personnel : paramètre `q`) ; pour
 * les listes complètes et courtes (années, programmes, classes d'une année) le filtre ne porte que sur l'AFFICHAGE de
 * la liste déjà chargée.
 */

import { platformHooks } from "@/platform/api/default-client";
import { ListInstitutionsResponseSchema } from "@ecoledigitale/contracts/v2/tenancy";
import type { OptionsResult, SelectOption } from "@/platform/ui/SelectAsync";
import { useAcademicYears, useClassrooms, usePrograms, useSubjects } from "./academic";
import { useGuardians, useStaffList, useStudents } from "./people";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function localFilter(options: ReadonlyArray<SelectOption>, search: string): SelectOption[] {
  const q = norm(search.trim());
  if (!q) return [...options];
  return options.filter((o) => norm(`${o.label} ${o.description ?? ""}`).includes(q));
}

export function useStudentOptions(search: string, enabled: boolean): OptionsResult {
  const q = useStudents({ q: search || undefined, limit: 20 }, { enabled });
  return {
    options: (q.data?.items ?? []).map((s) => ({ value: s.id, label: s.displayName, description: [s.studentNumber, s.currentEnrollment?.classroomName].filter(Boolean).join(" · ") })),
    isLoading: q.isFetching,
    error: q.error,
  };
}

export function useGuardianOptions(search: string, enabled: boolean): OptionsResult {
  const q = useGuardians({ q: search || undefined, limit: 20 }, { enabled });
  return {
    options: (q.data?.items ?? []).map((g) => ({ value: g.id, label: g.displayName, description: g.phone ?? g.email ?? undefined })),
    isLoading: q.isFetching,
    error: q.error,
  };
}

export function useStaffOptions(search: string, enabled: boolean, filter: { canTeach?: boolean; status?: "ACTIVE" } = {}): OptionsResult {
  const q = useStaffList({ q: search || undefined, limit: 20, canTeach: filter.canTeach, status: filter.status }, { enabled });
  return {
    options: (q.data?.items ?? []).map((s) => ({ value: s.id, label: s.displayName, description: [s.staffNumber, s.jobTitle].filter(Boolean).join(" · ") })),
    isLoading: q.isFetching,
    error: q.error,
  };
}

export function useClassroomOptions(search: string, enabled: boolean, filter: { academicYearId?: string; status?: string } = {}): OptionsResult {
  const q = useClassrooms({ pageSize: 200, academicYearId: filter.academicYearId, status: filter.status }, { enabled });
  const all: SelectOption[] = (q.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, description: c.code }));
  return { options: localFilter(all, search), isLoading: q.isFetching, error: q.error };
}

export function useYearOptions(search: string, enabled: boolean): OptionsResult {
  const q = useAcademicYears({});
  const all: SelectOption[] = (q.data ?? []).map((y) => ({ value: y.id, label: y.label, description: y.code }));
  return { options: enabled ? localFilter(all, search) : [], isLoading: q.isFetching, error: q.error };
}

export function useProgramOptions(search: string, enabled: boolean): OptionsResult {
  const q = usePrograms({ status: "ACTIVE" });
  const all: SelectOption[] = (q.data ?? []).map((p) => ({ value: p.id, label: p.label, description: p.code }));
  return { options: enabled ? localFilter(all, search) : [], isLoading: q.isFetching, error: q.error };
}

export function useSubjectOptions(search: string, enabled: boolean): OptionsResult {
  const q = useSubjects({ status: "ACTIVE", search: search || undefined }, { enabled });
  return {
    options: (q.data ?? []).map((s) => ({ value: s.id, label: s.label, description: s.code })),
    isLoading: q.isFetching,
    error: q.error,
  };
}

/**
 * Établissements du tenant (`GET /api/v1/tenancy/institutions`). Les créations d'années, programmes et classes exigent un
 * `institutionId` : un seul établissement => choisi d'office par l'écran, plusieurs => liste de choix.
 */
export function useInstitutions() {
  return platformHooks.useApiQuery(["tenancy", "institutions"], "/api/v1/tenancy/institutions", {
    schema: ListInstitutionsResponseSchema,
    select: (d) => d.items,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
