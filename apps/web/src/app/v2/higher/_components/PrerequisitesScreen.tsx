"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { HIGHER_PREREQUISITE_MODES, higherSetPrerequisitesBodySchema } from "@ecoledigitale/contracts/v2/higher";
import type { z } from "zod";
import { useFeature, usePermission } from "@/platform/access";
import { useAcademicYears, useCurriculumTree, useCurriculumVersions, usePrograms, useReference } from "@/platform/v2/academic";
import { useStudentOptions } from "@/platform/v2/lookups";
import { usePrerequisitesCheck, useSetUePrerequisites, useUePrerequisites } from "@/platform/v2/prerequisites";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import { candidateUes, flattenTree, type UeNode } from "./prerequisites-model";
import { StudentName } from "./shared";

type Mode = (typeof HIGHER_PREREQUISITE_MODES)[number];
interface Row {
  prerequisiteNodeId: string;
  mode: Mode;
  minAverage: string;
}

/**
 * Prérequis entre UE : choix d'un programme, d'une année et d'une version du curriculum, puis, pour chaque UE, ses prérequis
 * (validée, suivie, moyenne minimale). Lecture avec `higher.credits.read`, édition avec `higher.prerequisite.manage`,
 * fonction `higher.prerequisites`. Cycles, prérequis hors programme et satisfaction par un étudiant : décidés par le serveur.
 */
export function PrerequisitesScreen() {
  const t = useTranslations("v2HigherPrerequisites");
  const tErrors = useTranslations("errors");
  const manage = usePermission("higher.prerequisite.manage");
  const read = usePermission("higher.credits.read");
  const feature = useFeature("higher.prerequisites");

  const body = (() => {
    if (manage.isLoading || read.isLoading || feature.isLoading) return <LoadingBlock />;
    if (!manage.allowed && !read.allowed) return <Notice kind="warning">{tErrors("forbidden")}</Notice>;
    if (!feature.allowed && !feature.isUnavailable) return <FeatureNotice>{t("featureOff")}</FeatureNotice>;
    return <PrerequisitesContent canManage={manage.allowed} canCheck={read.allowed} />;
  })();

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {body}
    </div>
  );
}

function PrerequisitesContent({ canManage, canCheck }: { canManage: boolean; canCheck: boolean }) {
  const t = useTranslations("v2HigherPrerequisites");
  const programs = usePrograms({ status: "ACTIVE" });
  const years = useAcademicYears({});
  const nodeTypes = useReference("node-types");
  const [programId, setProgramId] = useState("");
  const [yearId, setYearId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const versions = useCurriculumVersions({ programId, yearId }, { enabled: Boolean(programId && yearId) });
  const tree = useCurriculumTree(versionId || null);

  useEffect(() => {
    const list = versions.data ?? [];
    if (list.length === 0) return setVersionId("");
    if (!list.some((v) => v.id === versionId)) setVersionId((list.find((v) => v.status === "PUBLISHED") ?? list[0]!).id);
  }, [versions.data, versionId]);

  const all = useMemo(() => flattenTree(tree.data?.roots ?? []), [tree.data]);
  const creditTypes = useMemo(() => (nodeTypes.data ? new Set(nodeTypes.data.filter((x) => x.allowsCredits).map((x) => x.code)) : null), [nodeTypes.data]);
  const candidates = useMemo(() => candidateUes(all, creditTypes, showAll), [all, creditTypes, showAll]);
  const selected = candidates.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <section aria-label={t("selection")} className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("program")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={programId}
              placeholder={t("chooseProgram")}
              onChange={(v) => {
                setProgramId(v);
                setSelectedId("");
              }}
              options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))}
            />
          )}
        </FormField>
        <FormField label={t("year")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={yearId}
              placeholder={t("chooseYear")}
              onChange={(v) => {
                setYearId(v);
                setSelectedId("");
              }}
              options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))}
            />
          )}
        </FormField>
        {(versions.data ?? []).length > 1 ? (
          <FormField label={t("version")}>
            {(c) => <NativeSelect {...c} value={versionId} onChange={(v) => {
                  setVersionId(v);
                  setSelectedId("");
                }} options={(versions.data ?? []).map((v, i) => ({ value: v.id, label: t("versionOption", { n: i + 1, status: v.status }) }))} />}
          </FormField>
        ) : null}
      </section>
      {versions.isError ? <ErrorBlock error={versions.error} onRetry={() => void versions.refetch()} /> : null}
      {programId && yearId && versions.data && versions.data.length === 0 ? <Notice kind="info">{t("noVersion")}</Notice> : null}
      {!programId || !yearId ? <Notice kind="info">{t("choose")}</Notice> : null}
      {tree.isPending && tree.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {tree.isError ? <ErrorBlock error={tree.error} onRetry={() => void tree.refetch()} /> : null}

      {tree.data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section aria-labelledby="ue-list-title" className="space-y-3">
            <h2 id="ue-list-title" className="text-lg font-semibold">
              {t("ueList")}
            </h2>
            <CheckControl label={t("showAll")} hint={t("showAllHint")} checked={showAll} onChange={setShowAll} />
            {candidates.length === 0 ? <EmptyBlock title={t("noUe")} description={t("noUeHint")} /> : null}
            <ul aria-label={t("ueList")} className="space-y-1">
              {candidates.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === n.id}
                    onClick={() => setSelectedId(n.id)}
                    className={`flex min-h-[2.75rem] w-full flex-col rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === n.id ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                  >
                    <span className="font-medium">{n.label}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{n.code}</span>
                      {n.credits ? ` · ${t("credits", { credits: showDecimal(n.credits) })}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <div>
            {selected ? <UePanel key={selected.id} ue={selected} candidates={candidates} all={all} canManage={canManage} canCheck={canCheck} /> : <Notice kind="info">{t("selectUe")}</Notice>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UePanel({ ue, candidates, all, canManage, canCheck }: { ue: UeNode; candidates: ReadonlyArray<UeNode>; all: ReadonlyArray<UeNode>; canManage: boolean; canCheck: boolean }) {
  const t = useTranslations("v2HigherPrerequisites");
  const current = useUePrerequisites(ue.id);
  return (
    <section aria-labelledby="ue-panel-title" className="space-y-6">
      <h2 id="ue-panel-title" className="text-lg font-semibold">
        {t("panelTitle", { label: ue.label })}
      </h2>
      {current.isPending && current.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {current.isError ? <ErrorBlock error={current.error} onRetry={() => void current.refetch()} /> : null}
      {current.data ? (
        <PrerequisitesEditor
          key={JSON.stringify(current.data.map((p) => [p.prerequisiteNodeId, p.mode, p.minAverage]))}
          ue={ue}
          current={current.data}
          candidates={candidates}
          all={all}
          canManage={canManage}
        />
      ) : null}
      {canCheck ? <StudentCheck ue={ue} all={all} /> : null}
    </section>
  );
}

function PrerequisitesEditor({
  ue,
  current,
  candidates,
  all,
  canManage,
}: {
  ue: UeNode;
  current: ReadonlyArray<{ prerequisiteNodeId: string; mode: Mode; minAverage: string | null }>;
  candidates: ReadonlyArray<UeNode>;
  all: ReadonlyArray<UeNode>;
  canManage: boolean;
}) {
  const t = useTranslations("v2HigherPrerequisites");
  const tMode = useTranslations("v2HigherPrerequisites.mode");
  const tReason = useTranslations("v2HigherPrerequisites.reason");
  const save = useSetUePrerequisites();
  const flash = useFlash();
  const [rows, setRows] = useState<Row[]>(current.map((p) => ({ prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage ?? "" })));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [warnings, setWarnings] = useState<Array<{ studentId: string; missing: Array<{ prerequisiteNodeId: string; mode: Mode; minAverage: string | null; reason: "NOT_ACQUIRED" | "NOT_ATTENDED" | "AVERAGE_TOO_LOW" }> }>>([]);
  const labelOf = (id: string) => all.find((n) => n.id === id)?.label ?? t("otherVersion", { id: id.slice(0, 8) });
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const options = (i: number) => {
    const taken = new Set(rows.filter((_, j) => j !== i).map((r) => r.prerequisiteNodeId));
    const list = candidates.filter((n) => n.id !== ue.id && !taken.has(n.id));
    const own = rows[i]?.prerequisiteNodeId;
    if (own && !list.some((n) => n.id === own)) list.push({ id: own, code: "", label: labelOf(own), nodeTypeCode: "", depth: 0, credits: null });
    return list.map((n) => ({ value: n.id, label: n.code ? `${n.code} — ${n.label}` : n.label }));
  };

  async function submit() {
    setWarnings([]);
    const body: z.input<typeof higherSetPrerequisitesBodySchema> = {
      prerequisites: rows.map((r) => ({
        prerequisiteNodeId: r.prerequisiteNodeId,
        mode: r.mode,
        ...(r.mode === "MIN_AVERAGE" ? { minAverage: r.minAverage.trim() === "" ? Number.NaN : Number(r.minAverage.replace(",", ".")) } : {}),
      })),
    };
    const v = validateWith(higherSetPrerequisitesBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const result = await save.mutateAsync({ nodeId: ue.id, body });
      flash.show(t("saved", { label: ue.label }));
      setWarnings(result.warnings);
    } catch {
      /* l'erreur du serveur (cycle, hors programme…) est affichée sous le formulaire */
    }
  }

  return (
    <form
      noValidate
      aria-label={t("editorLabel", { label: ue.label })}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {flash.node}
      <p className="text-sm text-muted-foreground">{t("editorHint")}</p>
      {rows.length === 0 ? <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="space-y-3" aria-label={t("prerequisites")}>
        {rows.map((r, i) =>
          canManage ? (
            <li key={i} className="space-y-3 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t("prerequisiteUe")} required error={errors[`prerequisites.${i}.prerequisiteNodeId`]}>
                  {(c) => <NativeSelect {...c} value={r.prerequisiteNodeId} placeholder={t("chooseUe")} onChange={(v) => setRow(i, { prerequisiteNodeId: v })} options={options(i)} />}
                </FormField>
                <FormField label={t("modeLabel")} required error={errors[`prerequisites.${i}.mode`]}>
                  {(c) => <NativeSelect {...c} value={r.mode} onChange={(v) => setRow(i, { mode: v as Mode })} options={HIGHER_PREREQUISITE_MODES.map((m) => ({ value: m, label: `${tMode(m)} — ${tMode(`${m}Help`)}` }))} />}
                </FormField>
              </div>
              {r.mode === "MIN_AVERAGE" ? (
                <FormField label={t("minAverage")} hint={t("minAverageHint")} required error={errors[`prerequisites.${i}.minAverage`]} className="max-w-xs">
                  {(c) => <TextControl {...c} inputMode="decimal" value={r.minAverage} onChange={(v) => setRow(i, { minAverage: v })} />}
                </FormField>
              ) : null}
              <button type="button" className={buttonClass.ghost} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={t("remove", { label: labelOf(r.prerequisiteNodeId) })}>
                {t("removeLabel")}
              </button>
            </li>
          ) : (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <span className="font-medium">{labelOf(r.prerequisiteNodeId)}</span>
              <StatusBadge label={tMode(r.mode)} tone="info" />
              {r.mode === "MIN_AVERAGE" ? <span className="text-muted-foreground">{t("minAverageValue", { value: showDecimal(r.minAverage) })}</span> : null}
            </li>
          ),
        )}
      </ul>
      {errors.prerequisites ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.prerequisites}
        </p>
      ) : null}
      {save.error ? <ErrorBlock error={save.error} /> : null}
      {warnings.length > 0 ? (
        <Notice kind="warning">
          <p className="font-medium">{t("warnings.title", { count: warnings.length })}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w.studentId}>
                <StudentName studentId={w.studentId} /> — {w.missing.map((m) => `${labelOf(m.prerequisiteNodeId)} (${tReason(m.reason)})`).join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">{t("warnings.hint")}</p>
        </Notice>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setRows((x) => [...x, { prerequisiteNodeId: "", mode: "VALIDATED", minAverage: "" }])}>
            {t("add")}
          </button>
          <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
            {t("save")}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function StudentCheck({ ue, all }: { ue: UeNode; all: ReadonlyArray<UeNode> }) {
  const t = useTranslations("v2HigherPrerequisites.check");
  const tMode = useTranslations("v2HigherPrerequisites.mode");
  const tReason = useTranslations("v2HigherPrerequisites.reason");
  const [student, setStudent] = useState<SelectOption | null>(null);
  const check = usePrerequisitesCheck(student?.value ?? null, ue.id);
  const labelOf = (id: string) => all.find((n) => n.id === id)?.label ?? id.slice(0, 8);
  return (
    <section aria-labelledby="check-title" className="space-y-3 rounded-lg border p-4">
      <h3 id="check-title" className="text-base font-semibold">
        {t("title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("description", { label: ue.label })}</p>
      <FormField label={t("student")} className="max-w-md">
        {(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} placeholder={t("placeholder")} />}
      </FormField>
      {check.isFetching && !check.data ? <LoadingBlock /> : null}
      {check.isError ? <ErrorBlock error={check.error} onRetry={() => void check.refetch()} /> : null}
      {student && check.data ? (
        <div aria-live="polite" className="space-y-2">
          <StatusBadge label={check.data.satisfied ? t("satisfied") : t("notSatisfied")} tone={check.data.satisfied ? "success" : "danger"} />
          {check.data.missing.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm" aria-label={t("missing")}>
              {check.data.missing.map((m) => (
                <li key={m.prerequisiteNodeId}>
                  <span className="font-medium">{labelOf(m.prerequisiteNodeId)}</span> — {tMode(m.mode)} : {tReason(m.reason)}
                  {m.minAverage ? ` (${t("minAverage", { value: showDecimal(m.minAverage) })})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
