"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { academicCurriculumTreeDtoSchema, type AcademicCurriculumTreeNodeDto } from "@ecoledigitale/contracts/v2/academic";
import { platformApi, platformHooks } from "@/platform/api/default-client";
import { useAcademicYears, useCurriculumVersions, usePrograms } from "@/platform/v2/academic";
import { FormField, AntSelect } from "@/platform/ui/FormField";

export interface CurriculumNodeOption {
  id: string;
  label: string;
  versionLabel: string;
}

function flatten(nodes: ReadonlyArray<AcademicCurriculumTreeNodeDto>, out: AcademicCurriculumTreeNodeDto[] = []): AcademicCurriculumTreeNodeDto[] {
  for (const n of nodes) {
    // Un nœud « payable » est une matière / un cours : une feuille de l'arbre ou un nœud rattaché à une matière.
    if (n.children.length === 0 || n.subjectId !== null) out.push(n);
    flatten(n.children, out);
  }
  return out;
}

/**
 * Cours (nœuds de curriculum) des versions PUBLIÉES, avec le libellé « Programme — année ». Les tarifs horaires portent
 * l'identifiant d'un nœud ; ce sélecteur évite de saisir un UUID. Au plus 20 versions sont chargées.
 */
export function useCurriculumNodes(enabled = true): { nodes: CurriculumNodeOption[]; byId: ReadonlyMap<string, CurriculumNodeOption>; isLoading: boolean } {
  const versions = useCurriculumVersions({ status: "PUBLISHED" }, { enabled });
  const programs = usePrograms({});
  const years = useAcademicYears({});
  const list = useMemo(() => (versions.data ?? []).slice(0, 20), [versions.data]);
  const trees = useQueries({
    queries: list.map((v) => ({
      queryKey: platformHooks.queryKey("academic", "curriculum", "tree", v.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => platformApi.get(`/api/v1/academic/curriculum-versions/${v.id}`, { schema: academicCurriculumTreeDtoSchema, signal }),
      enabled: enabled && platformHooks.client.getTenant() !== null,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const programLabel = new Map((programs.data ?? []).map((p) => [p.id, p.label]));
  const yearLabel = new Map((years.data ?? []).map((y) => [y.id, y.label]));
  const stamp = trees.map((q) => q.dataUpdatedAt).join(",");
  const nodes = useMemo(() => {
    const out: CurriculumNodeOption[] = [];
    list.forEach((v, index) => {
      const tree = trees[index]?.data;
      if (!tree) return;
      const versionLabel = `${programLabel.get(v.programId) ?? v.programId.slice(0, 8)} — ${yearLabel.get(v.academicYearId) ?? v.academicYearId.slice(0, 8)}`;
      for (const n of flatten(tree.roots)) out.push({ id: n.id, label: `${n.code} · ${n.label}`, versionLabel });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, stamp, programs.data, years.data]);
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), isLoading: versions.isPending || trees.some((q) => q.isPending) };
}

/** Choix d'un cours de curriculum (liste groupée par version publiée). */
export function NodePicker({ value, onChange, label, error, required, hint }: { value: string; onChange: (id: string) => void; label: string; error?: string | null; required?: boolean; hint?: string }) {
  const t = useTranslations("v2Payroll.common");
  const { nodes, isLoading } = useCurriculumNodes();
  const groups = useMemo(() => {
    const map = new Map<string, CurriculumNodeOption[]>();
    for (const n of nodes) map.set(n.versionLabel, [...(map.get(n.versionLabel) ?? []), n]);
    return [...map.entries()];
  }, [nodes]);
  return (
    <FormField label={label} required={required} error={error} hint={hint}>
      {(c) => (
        <AntSelect {...c} value={value} onChange={(e) => onChange(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive">
          <option value="">{isLoading ? t("loading") : t("chooseNode")}</option>
          {groups.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </optgroup>
          ))}
        </AntSelect>
      )}
    </FormField>
  );
}

