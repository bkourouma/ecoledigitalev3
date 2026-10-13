"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AcademicCurriculumNodeDto, AcademicCurriculumTreeNodeDto } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears, useCurriculumTree, useCurriculumVersions, usePrograms } from "@/platform/v2/academic";
import { useStudent } from "@/platform/v2/people";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { ErrorBlock } from "@/platform/ui/states";

export interface FlatNode {
  id: string;
  label: string;
  nodeTypeCode: string;
  depth: number;
  node: AcademicCurriculumNodeDto;
}

function flatten(nodes: ReadonlyArray<AcademicCurriculumTreeNodeDto>, depth = 0): FlatNode[] {
  return nodes.flatMap((n) => [{ id: n.id, label: `${"— ".repeat(depth)}${n.code} — ${n.label}`, nodeTypeCode: n.nodeTypeCode, depth, node: n }, ...flatten(n.children, depth + 1)]);
}

/**
 * Choix d'un nœud du curriculum (cycle, programme, UE) : programme -> année -> version (la publiée d'abord) -> nœud.
 * Les identifiants de nœud changent à chaque version publiée : on choisit donc dans la version voulue.
 */
export function CurriculumNodePicker({
  value,
  onChange,
  label,
  error,
  filter,
  hint,
}: {
  value: string;
  onChange: (nodeId: string, node: AcademicCurriculumNodeDto | null) => void;
  label: string;
  error?: string | null;
  filter?: (node: FlatNode) => boolean;
  hint?: string;
}) {
  const t = useTranslations("v2Higher.common");
  const programs = usePrograms({ status: "ACTIVE" });
  const years = useAcademicYears({});
  const [programId, setProgramId] = useState("");
  const [yearId, setYearId] = useState("");
  const [versionId, setVersionId] = useState("");
  const versions = useCurriculumVersions({ programId, yearId }, { enabled: Boolean(programId && yearId) });
  const tree = useCurriculumTree(versionId || null);

  useEffect(() => {
    const list = versions.data ?? [];
    if (list.length === 0) return setVersionId("");
    if (!list.some((v) => v.id === versionId)) setVersionId((list.find((v) => v.status === "PUBLISHED") ?? list[0]!).id);
  }, [versions.data, versionId]);

  const nodes = useMemo(() => flatten(tree.data?.roots ?? []).filter((n) => (filter ? filter(n) : true)), [tree.data, filter]);

  return (
    <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("program")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={programId}
              onChange={(v) => {
                setProgramId(v);
                onChange("", null);
              }}
              placeholder={t("chooseProgram")}
              options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))}
            />
          )}
        </FormField>
        <FormField label={t("year")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={yearId}
              onChange={(v) => {
                setYearId(v);
                onChange("", null);
              }}
              placeholder={t("chooseYear")}
              options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))}
            />
          )}
        </FormField>
      </div>
      {(versions.data ?? []).length > 1 ? (
        <FormField label={t("version")}>
          {(c) => <NativeSelect {...c} value={versionId} onChange={setVersionId} options={(versions.data ?? []).map((v, i) => ({ value: v.id, label: t("versionOption", { n: i + 1, status: v.status }) }))} />}
        </FormField>
      ) : null}
      {versions.isError ? <ErrorBlock error={versions.error} /> : null}
      <FormField label={t("node")} required error={error} hint={hint}>
        {(c) => (
          <NativeSelect
            {...c}
            value={value}
            disabled={nodes.length === 0}
            onChange={(v) => onChange(v, nodes.find((n) => n.id === v)?.node ?? null)}
            placeholder={versionId ? t("chooseNode") : t("chooseProgramAndYear")}
            options={nodes.map((n) => ({ value: n.id, label: n.label }))}
          />
        )}
      </FormField>
    </fieldset>
  );
}

/** Nom d'un étudiant (fiche mise en cache) ; identifiant court en repli. */
export function useStudentName(studentId: string | null): string {
  const t = useTranslations("v2Higher.common");
  const q = useStudent(studentId);
  return q.data?.displayName ?? (studentId ? t("studentFallback", { id: studentId.slice(0, 4) }) : "—");
}

export function StudentName({ studentId }: { studentId: string }) {
  return <>{useStudentName(studentId)}</>;
}

/** Libellé court d'un nœud connu seulement par son identifiant. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
