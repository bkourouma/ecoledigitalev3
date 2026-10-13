"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AcademicCurriculumTreeDto, AcademicCurriculumTreeNodeDto, AcademicCurriculumVersionDto } from "@ecoledigitale/contracts/v2/academic";
import {
  useAcademicYears,
  useCloneCurriculumVersion,
  useCreateCurriculumVersion,
  useCurriculumAmendments,
  useCurriculumTree,
  useCurriculumValidation,
  useCurriculumVersions,
  usePrograms,
  usePublishCurriculumVersion,
  useReference,
} from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { TreeEditor } from "@/platform/ui/TreeEditor";
import { toneOf } from "./shared";
import { AddNodeButton, CurriculumNodePanel } from "./CurriculumNodePanel";
import { countNodes } from "./tree-utils";

export type TreeNode = AcademicCurriculumTreeNodeDto;
const getId = (n: TreeNode) => n.id;
const getChildren = (n: TreeNode) => n.children;

export function findNode(roots: ReadonlyArray<TreeNode>, id: string | null): TreeNode | null {
  if (!id) return null;
  for (const n of roots) {
    if (n.id === id) return n;
    const inChild = findNode(n.children, id);
    if (inChild) return inChild;
  }
  return null;
}

export function CurriculumScreen() {
  const t = useTranslations("v2Academic.curriculum");
  const programs = usePrograms({ status: "ACTIVE" });
  const years = useAcademicYears();
  const [programId, setProgramId] = useState("");
  const [yearId, setYearId] = useState("");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flash = useFlash();

  const ready = programId !== "" && yearId !== "";
  const versions = useCurriculumVersions({ programId: programId || undefined, yearId: yearId || undefined }, { enabled: ready });

  // La version affichée suit la sélection programme + année : la première trouvée, sinon aucune.
  useEffect(() => {
    if (!ready) return setVersionId(null);
    const list = versions.data ?? [];
    setVersionId((current) => (current && list.some((v) => v.id === current) ? current : (list[0]?.id ?? null)));
  }, [ready, versions.data]);

  const tree = useCurriculumTree(versionId);
  const nodeTypes = useReference("node-types");
  const selected = findNode(tree.data?.roots ?? [], selectedId);

  const create = useCreateCurriculumVersion();

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <FormField label={t("program")}>
          {(c) => <NativeSelect {...c} value={programId} onChange={(v) => { setProgramId(v); setSelectedId(null); }} placeholder={t("chooseProgram")} options={(programs.data ?? []).map((p) => ({ value: p.id, label: `${p.label} (${p.code})` }))} />}
        </FormField>
        <FormField label={t("year")}>
          {(c) => <NativeSelect {...c} value={yearId} onChange={(v) => { setYearId(v); setSelectedId(null); }} placeholder={t("chooseYear")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
      </div>
      {flash.node}
      {!ready ? <EmptyBlock title={t("pickBoth")} /> : null}
      {ready && versions.isPending && versions.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {ready && versions.isError ? <ErrorBlock error={versions.error} onRetry={() => void versions.refetch()} /> : null}
      {ready && versions.data && versions.data.length === 0 ? (
        <EmptyBlock
          title={t("noVersion")}
          description={t("noVersionHint")}
          action={
            <Can permission="curriculum.manage">
              <button type="button" className={buttonClass.primary} disabled={create.isPending} onClick={() => void create.mutateAsync({ programId, academicYearId: yearId }).then((v) => { setVersionId(v.id); flash.show(t("versionCreated")); }).catch(() => undefined)}>
                {t("createVersion")}
              </button>
            </Can>
          }
        />
      ) : null}
      {create.error ? <ErrorBlock error={create.error} /> : null}
      {versions.data && versions.data.length > 1 ? (
        <FormField label={t("versionPicker")} className="mb-4 max-w-md">
          {(c) => <NativeSelect {...c} value={versionId ?? ""} onChange={setVersionId} options={versions.data!.map((v, i) => ({ value: v.id, label: `${t("versionN", { n: i + 1 })} — ${v.status}` }))} />}
        </FormField>
      ) : null}

      {versionId ? (
        <>
          {tree.isPending && tree.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          {tree.isError ? <ErrorBlock error={tree.error} onRetry={() => void tree.refetch()} /> : null}
          {tree.data ? (
            <div className="space-y-4">
              <VersionBar
                data={tree.data}
                yearOptions={(years.data ?? []).map((y) => ({ id: y.id, label: y.label, startsOn: y.startsOn }))}
                currentYearId={yearId}
                programId={programId}
                onFlash={flash.show}
                onOpenVersion={(id, targetYearId) => {
                  setYearId(targetYearId);
                  setVersionId(id);
                  setSelectedId(null);
                }}
                onSelectNode={setSelectedId}
              />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <section aria-labelledby="curriculum-tree-title" className="rounded-2xl border border-white/10 bg-card/40 p-3">
                  <h2 id="curriculum-tree-title" className="mb-2 text-sm font-semibold">
                    {t("treeTitle")}
                  </h2>
                  <TreeEditor
                    roots={tree.data.roots}
                    getId={getId}
                    getChildren={getChildren}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    ariaLabel={t("treeLabel")}
                    emptyMessage={<p className="text-sm text-muted-foreground">{t("treeEmpty")}</p>}
                    renderLabel={(n) => <NodeLabel node={n} typeLabel={(nodeTypes.data ?? []).find((x) => x.code === n.nodeTypeCode)?.label ?? n.nodeTypeCode} />}
                  />
                  <Can permission="curriculum.manage">
                    {tree.data.version.status === "DRAFT" ? (
                      <div className="mt-3 border-t pt-3">
                        <AddNodeButton tree={tree.data} parent={null} onFlash={flash.show} onCreated={setSelectedId} />
                      </div>
                    ) : null}
                  </Can>
                </section>
                <section aria-live="polite">
                  {selected ? (
                    <CurriculumNodePanel node={selected} tree={tree.data} onFlash={flash.show} onSelect={setSelectedId} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("selectNode")}</p>
                  )}
                </section>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NodeLabel({ node, typeLabel }: { node: TreeNode; typeLabel: string }) {
  const t = useTranslations("v2Academic.curriculum");
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">{typeLabel}</span>
      <span className="truncate font-medium">{node.label}</span>
      <span className="text-xs text-muted-foreground">{node.code}</span>
      {node.coefficient !== null ? <span className="text-xs text-muted-foreground">{t("coefShort", { value: showDecimal(node.coefficient) })}</span> : null}
      {node.credits !== null ? <span className="text-xs text-muted-foreground">{t("creditsShort", { value: showDecimal(node.credits) })}</span> : null}
      {node.status === "INACTIVE" ? <StatusBadge label={t("inactive")} tone="neutral" /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Barre de version : validation, publication, amendements, clonage
// ---------------------------------------------------------------------------

function VersionBar({
  data,
  yearOptions,
  currentYearId,
  programId,
  onFlash,
  onOpenVersion,
  onSelectNode,
}: {
  data: AcademicCurriculumTreeDto;
  yearOptions: ReadonlyArray<{ id: string; label: string; startsOn: string }>;
  currentYearId: string;
  programId: string;
  onFlash: (message: string) => void;
  onOpenVersion: (versionId: string, yearId: string) => void;
  onSelectNode: (id: string) => void;
}) {
  const t = useTranslations("v2Academic.curriculum");
  const tStatus = useTranslations("v2Academic.status.version");
  const date = useDateFormat();
  const { version } = data;
  const [showValidation, setShowValidation] = useState(false);
  const [showAmendments, setShowAmendments] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [cloning, setCloning] = useState(false);
  const publish = usePublishCurriculumVersion();
  const validation = useCurriculumValidation(version.id, showValidation);
  const amendments = useCurriculumAmendments(version.id, showAmendments);

  return (
    <section aria-labelledby="version-title" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="version-title" className="text-lg font-semibold">
            {t("versionTitle")}
          </h2>
          <StatusBadge label={tStatus(version.status)} tone={toneOf(version.status)} />
          <span className="text-sm text-muted-foreground">{t("nodeCount", { count: version.nodeCount })}</span>
          {version.publishedAt ? <span className="text-sm text-muted-foreground">{t("publishedAt", { date: date.instant(version.publishedAt) })}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.secondary} aria-pressed={showValidation} onClick={() => setShowValidation((v) => !v)}>
            {t("validate")}
          </button>
          <button type="button" className={buttonClass.secondary} aria-pressed={showAmendments} onClick={() => setShowAmendments((v) => !v)}>
            {t("amendments")}
          </button>
          <Can permission="curriculum.manage">
            <button type="button" className={buttonClass.secondary} onClick={() => setCloning(true)}>
              {t("cloneAction")}
            </button>
          </Can>
          {version.status === "DRAFT" ? (
            <Can permission="curriculum.publish">
              <button type="button" className={buttonClass.primary} onClick={() => setConfirmPublish(true)}>
                {t("publish")}
              </button>
            </Can>
          ) : null}
        </div>
      </div>
      {version.note ? <p className="text-sm text-muted-foreground">{version.note}</p> : null}
      {version.status !== "DRAFT" ? <Notice kind="info">{version.status === "PUBLISHED" ? t("publishedInfo") : t("readOnlyInfo")}</Notice> : null}

      {showValidation ? (
        <div aria-live="polite">
          {validation.isPending && validation.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          {validation.isError ? <ErrorBlock error={validation.error} onRetry={() => void validation.refetch()} /> : null}
          {validation.data ? (
            <div className="space-y-2">
              <Notice kind={validation.data.valid ? "success" : "error"}>
                {validation.data.valid ? t("validOk", { warnings: validation.data.warnings }) : t("validKo", { errors: validation.data.errors, warnings: validation.data.warnings })}
              </Notice>
              {validation.data.issues.length > 0 ? (
                <ul className="divide-y rounded-md border text-sm">
                  {validation.data.issues.map((issue, i) => (
                    <li key={`${issue.code}-${issue.nodeId ?? i}-${i}`} className="flex flex-wrap items-center gap-2 p-2">
                      <StatusBadge label={issue.severity === "ERROR" ? t("severityError") : t("severityWarn")} tone={issue.severity === "ERROR" ? "danger" : "warning"} />
                      <span className="min-w-0 flex-1">{issue.message}</span>
                      {issue.nodeId ? (
                        <button type="button" className={buttonClass.ghost} onClick={() => onSelectNode(issue.nodeId!)}>
                          {t("goToNode")}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showAmendments ? (
        <div aria-live="polite">
          {amendments.isPending && amendments.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          {amendments.isError ? <ErrorBlock error={amendments.error} onRetry={() => void amendments.refetch()} /> : null}
          {amendments.data && amendments.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAmendments")}</p> : null}
          {amendments.data && amendments.data.length > 0 ? (
            <ol className="divide-y rounded-md border text-sm">
              {amendments.data.map((a) => (
                <li key={a.id} className="space-y-0.5 p-2">
                  <p className="font-medium">
                    {t(`amendmentKind.${a.kind}`)} · {date.instant(a.amendedAt)}
                  </p>
                  <p className="text-muted-foreground">{a.reason}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {confirmPublish ? (
        <ModalDialog open onOpenChange={(o) => !o && setConfirmPublish(false)} title={t("publishTitle")} description={t("publishDescription")}>
          <div className="space-y-3">
            {publish.error ? <ErrorBlock error={publish.error} /> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonClass.secondary} onClick={() => setConfirmPublish(false)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className={buttonClass.primary}
                disabled={publish.isPending}
                onClick={() => void publish.mutateAsync({ id: version.id }).then(() => { onFlash(t("published")); setConfirmPublish(false); }).catch(() => undefined)}
              >
                {t("publish")}
              </button>
            </div>
          </div>
        </ModalDialog>
      ) : null}

      {cloning ? (
        <CloneDialog
          data={data}
          programId={programId}
          currentYearId={currentYearId}
          yearOptions={yearOptions}
          onClose={() => setCloning(false)}
          onDone={(v, yearId) => {
            onFlash(t("cloned"));
            onOpenVersion(v.id, yearId);
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Clonage vers une autre année, avec aperçu
// ---------------------------------------------------------------------------

function summarize(roots: ReadonlyArray<TreeNode>, acc: Record<string, number> = {}): Record<string, number> {
  for (const n of roots) {
    acc[n.nodeTypeCode] = (acc[n.nodeTypeCode] ?? 0) + 1;
    summarize(n.children, acc);
  }
  return acc;
}

function CloneDialog({
  data,
  programId,
  currentYearId,
  yearOptions,
  onClose,
  onDone,
}: {
  data: AcademicCurriculumTreeDto;
  programId: string;
  currentYearId: string;
  yearOptions: ReadonlyArray<{ id: string; label: string; startsOn: string }>;
  onClose: () => void;
  onDone: (version: AcademicCurriculumVersionDto, yearId: string) => void;
}) {
  const t = useTranslations("v2Academic.curriculum");
  const nodeTypes = useReference("node-types");
  const clone = useCloneCurriculumVersion();
  // Année suivante proposée : la première année qui commence après l'année source (présentation seulement).
  const source = yearOptions.find((y) => y.id === currentYearId);
  const suggestion = useMemo(() => [...yearOptions].filter((y) => y.id !== currentYearId && (!source || y.startsOn > source.startsOn)).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]?.id ?? "", [yearOptions, currentYearId, source]);
  const [targetYearId, setTargetYearId] = useState(suggestion);
  const [note, setNote] = useState("");
  const existing = useCurriculumVersions({ programId, yearId: targetYearId || undefined }, { enabled: targetYearId !== "" });
  const counts = useMemo(() => summarize(data.roots), [data.roots]);
  const typeLabel = (code: string) => (nodeTypes.data ?? []).find((x) => x.code === code)?.label ?? code;
  const hasExisting = (existing.data ?? []).length > 0;
  const validation = useCurriculumValidation(data.version.id, true);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("cloneTitle")}
      description={t("cloneDescription")}
      submitLabel={t("cloneConfirm")}
      isPending={clone.isPending}
      error={clone.error}
      wide
      onSubmit={() => {
        if (!targetYearId) return;
        void clone
          .mutateAsync({ sourceVersionId: data.version.id, academicYearId: targetYearId, note: note.trim() || undefined })
          .then((v) => {
            onDone(v, targetYearId);
            onClose();
          })
          .catch(() => undefined);
      }}
    >
      <FormField label={t("targetYear")} required>
        {(c) => <NativeSelect {...c} value={targetYearId} onChange={setTargetYearId} placeholder={t("chooseYear")} options={yearOptions.filter((y) => y.id !== currentYearId).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      <FormField label={t("cloneNote")}>
        {(c) => <input {...c} type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
      </FormField>
      <section aria-labelledby="clone-preview" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
        <h3 id="clone-preview" className="font-semibold">
          {t("preview")}
        </h3>
        <p>{t("previewCount", { count: countNodes(data.roots) })}</p>
        <ul className="list-disc pl-5">
          {Object.entries(counts).map(([code, n]) => (
            <li key={code}>{t("previewType", { type: typeLabel(code), count: n })}</li>
          ))}
        </ul>
        {validation.data && !validation.data.valid ? <Notice kind="warning">{t("previewInvalid", { errors: validation.data.errors })}</Notice> : null}
        {targetYearId && existing.isPending && existing.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {hasExisting ? <Notice kind="warning">{t("previewExisting")}</Notice> : targetYearId && existing.data ? <Notice kind="info">{t("previewEmptyTarget")}</Notice> : null}
        <p className="text-xs text-muted-foreground">{t("previewNote")}</p>
      </section>
    </FormDialog>
  );
}
