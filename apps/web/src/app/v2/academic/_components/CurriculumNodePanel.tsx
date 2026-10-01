"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  academicAmendBodySchema,
  academicCreateNodeBodySchema,
  academicUpdateNodeBodySchema,
  type AcademicCurriculumTreeDto,
  type AcademicCurriculumTreeNodeDto,
  type AcademicCurriculumVersionDto,
  type AcademicNodeTypeDto,
} from "@ecoledigitale/contracts/v2/academic";
import {
  useAddCurriculumNode,
  useAmendCurriculumVersion,
  useMoveCurriculumNode,
  useReference,
  useRemoveCurriculumNode,
  useSetNodePrerequisites,
  useUpdateCurriculumNode,
} from "@/platform/v2/academic";
import { useSubjectOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { showDecimal } from "@/platform/ui/format";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { computeReorder, flattenForest } from "./tree-utils";

type TreeNode = AcademicCurriculumTreeNodeDto;

function findParent(roots: ReadonlyArray<TreeNode>, id: string): TreeNode | null {
  for (const n of roots) {
    if (n.children.some((c) => c.id === id)) return n;
    const deeper = findParent(n.children, id);
    if (deeper) return deeper;
  }
  return null;
}

function descendantIds(node: TreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode) => n.children.forEach((c) => { out.add(c.id); walk(c); });
  walk(node);
  return out;
}

/** « 2,5 » saisi à la française -> « 2.5 » (le contrat attend un décimal canonique avec point). */
const decimalInput = (value: string) => value.trim().replace(",", ".");

// ---------------------------------------------------------------------------
// Panneau d'un nœud
// ---------------------------------------------------------------------------

export function CurriculumNodePanel({ node, tree, onFlash, onSelect }: { node: TreeNode; tree: AcademicCurriculumTreeDto; onFlash: (message: string) => void; onSelect: (id: string | null) => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const nodeTypes = useReference("node-types");
  const type = (nodeTypes.data ?? []).find((x) => x.code === node.nodeTypeCode);
  const { version } = tree;
  const draft = version.status === "DRAFT";
  const parent = findParent(tree.roots, node.id);
  const siblings = useMemo(() => [...(parent ? parent.children : tree.roots)].sort((a, b) => a.ordinal - b.ordinal), [parent, tree.roots]);
  const index = siblings.findIndex((s) => s.id === node.id);
  const byLineage = useMemo(() => new Map(flattenForest(tree.roots).map(({ node: n }) => [n.lineageId, n])), [tree.roots]);

  const [editing, setEditing] = useState(false);
  const [amending, setAmending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [prereq, setPrereq] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reorderError, setReorderError] = useState<unknown>(null);
  const update = useUpdateCurriculumNode();
  const remove = useRemoveCurriculumNode();

  async function reorder(to: number) {
    setReorderError(null);
    try {
      for (const u of computeReorder(siblings, index, to)) await update.mutateAsync({ id: u.id, patch: { ordinal: u.ordinal } });
    } catch (e) {
      setReorderError(e);
    }
  }

  return (
    <article className="space-y-4 rounded-lg border p-4" aria-labelledby="node-title">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="node-title" className="text-lg font-semibold">
            {node.label}
          </h2>
          <StatusBadge label={type?.label ?? node.nodeTypeCode} tone="info" />
          {!node.isMandatory ? <StatusBadge label={t("optional")} tone="neutral" /> : null}
          {node.isTransversal ? <StatusBadge label={t("transversal")} tone="neutral" /> : null}
        </div>
        <p className="text-sm text-muted-foreground">{node.code}</p>
      </header>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label={t("fields.coefficient")} value={showDecimal(node.coefficient)} />
        <Row label={t("fields.credits")} value={showDecimal(node.credits)} />
        <Row label={t("fields.hoursTotal")} value={showDecimal(node.hoursTotal)} />
        <Row label={t("fields.categoryCode")} value={node.categoryCode ?? "—"} />
        <Row label={t("fields.hoursLecture")} value={showDecimal(node.hoursLecture)} />
        <Row label={t("fields.hoursTutorial")} value={showDecimal(node.hoursTutorial)} />
        <Row label={t("fields.hoursPractical")} value={showDecimal(node.hoursPractical)} />
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("prerequisites")}</dt>
          <dd>
            {node.prerequisiteLineageIds.length === 0
              ? "—"
              : node.prerequisiteLineageIds.map((l) => byLineage.get(l)).map((n, i) => <span key={n?.id ?? i} className="mr-2 inline-block">{n ? `${n.code} — ${n.label}` : t("unknownNode")}</span>)}
          </dd>
        </div>
      </dl>

      {reorderError ? <ErrorBlock error={reorderError} /> : null}
      {remove.error ? <ErrorBlock error={remove.error} /> : null}

      <Can permission="curriculum.manage">
        {draft ? (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {t("edit")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setAdding(true)}>
              {t("addChild")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setMoving(true)}>
              {t("move")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setPrereq(true)}>
              {t("setPrerequisites")}
            </button>
            <button type="button" className={buttonClass.secondary} disabled={index <= 0 || update.isPending} onClick={() => void reorder(index - 1)} aria-label={t("moveUp")}>
              ↑ {t("moveUp")}
            </button>
            <button type="button" className={buttonClass.secondary} disabled={index < 0 || index >= siblings.length - 1 || update.isPending} onClick={() => void reorder(index + 1)} aria-label={t("moveDown")}>
              ↓ {t("moveDown")}
            </button>
            <button type="button" className={buttonClass.danger} onClick={() => setRemoving(true)}>
              {t("remove")}
            </button>
          </div>
        ) : null}
      </Can>
      {version.status === "PUBLISHED" ? (
        <Can permission="curriculum.amend">
          <div className="border-t pt-3">
            <button type="button" className={buttonClass.secondary} onClick={() => setAmending(true)}>
              {t("amend")}
            </button>
          </div>
        </Can>
      ) : null}

      {editing && draft ? <NodeEditForm key={node.id} node={node} type={type} onDone={() => { setEditing(false); onFlash(t("nodeUpdated")); }} /> : null}
      {adding ? <AddNodeDialog version={version} parent={node} onClose={() => setAdding(false)} onDone={(n) => { onFlash(t("nodeAdded", { label: n.label })); onSelect(n.id); }} /> : null}
      {moving ? <MoveDialog node={node} tree={tree} onClose={() => setMoving(false)} onDone={() => onFlash(t("nodeMoved"))} /> : null}
      {prereq ? <PrerequisitesDialog node={node} tree={tree} onClose={() => setPrereq(false)} onDone={() => onFlash(t("prerequisitesSaved"))} /> : null}
      {amending ? <AmendDialog node={node} type={type} versionId={version.id} onClose={() => setAmending(false)} onDone={() => onFlash(t("amended"))} /> : null}
      {removing ? (
        <ModalDialog open onOpenChange={(o) => !o && setRemoving(false)} title={t("removeTitle", { label: node.label })} description={t("removeDescription", { count: descendantIds(node).size })}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} onClick={() => setRemoving(false)}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className={buttonClass.danger}
              disabled={remove.isPending}
              onClick={() => void remove.mutateAsync({ id: node.id }).then(() => { onFlash(t("nodeRemoved")); onSelect(null); setRemoving(false); }).catch(() => setRemoving(false))}
            >
              {t("remove")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Édition (version brouillon)
// ---------------------------------------------------------------------------

interface NodeForm {
  label: string;
  code: string;
  coefficient: string;
  credits: string;
  hoursTotal: string;
  hoursLecture: string;
  hoursTutorial: string;
  hoursPractical: string;
  categoryCode: string;
  isMandatory: boolean;
  isTransversal: boolean;
}

function formOf(node: TreeNode): NodeForm {
  return {
    label: node.label,
    code: node.code,
    coefficient: node.coefficient ?? "",
    credits: node.credits ?? "",
    hoursTotal: node.hoursTotal ?? "",
    hoursLecture: node.hoursLecture ?? "",
    hoursTutorial: node.hoursTutorial ?? "",
    hoursPractical: node.hoursPractical ?? "",
    categoryCode: node.categoryCode ?? "",
    isMandatory: node.isMandatory,
    isTransversal: node.isTransversal,
  };
}

const DECIMAL_KEYS = ["coefficient", "credits", "hoursTotal", "hoursLecture", "hoursTutorial", "hoursPractical"] as const;

/** Différences entre le formulaire et le nœud, au format du contrat de mise à jour (`""` -> `null`). */
function diffPatch(form: NodeForm, node: TreeNode, only?: ReadonlyArray<keyof NodeForm>): Record<string, unknown> {
  const initial = formOf(node);
  const patch: Record<string, unknown> = {};
  (Object.keys(form) as Array<keyof NodeForm>).forEach((k) => {
    if (only && !only.includes(k)) return;
    if (form[k] === initial[k]) return;
    const v = form[k];
    if (typeof v === "boolean") patch[k] = v;
    else if ((DECIMAL_KEYS as readonly string[]).includes(k)) patch[k] = v.trim() === "" ? null : decimalInput(v);
    else if (k === "categoryCode") patch[k] = v.trim() === "" ? null : v.trim();
    else patch[k] = v.trim();
  });
  return patch;
}

function NodeFields({ form, set, errors, type, only }: { form: NodeForm; set: <K extends keyof NodeForm>(k: K, v: NodeForm[K]) => void; errors: FieldErrors; type?: AcademicNodeTypeDto; only?: ReadonlyArray<keyof NodeForm> }) {
  const t = useTranslations("v2Academic.curriculum");
  const show = (k: keyof NodeForm) => !only || only.includes(k);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {show("label") ? (
          <FormField label={t("fields.label")} required error={errors.label}>
            {(c) => <TextControl {...c} value={form.label} onChange={(v) => set("label", v)} maxLength={200} />}
          </FormField>
        ) : null}
        {show("code") ? (
          <FormField label={t("fields.code")} required error={errors.code}>
            {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code", v.toUpperCase())} maxLength={40} />}
          </FormField>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {type?.allowsCoefficient !== false ? (
          <FormField label={t("fields.coefficient")} error={errors.coefficient}>
            {(c) => <TextControl {...c} inputMode="decimal" value={form.coefficient} onChange={(v) => set("coefficient", v)} />}
          </FormField>
        ) : null}
        {type?.allowsCredits !== false ? (
          <FormField label={t("fields.credits")} hint={type?.creditsMustEqualChildren ? t("fields.creditsDerived") : undefined} error={errors.credits}>
            {(c) => <TextControl {...c} inputMode="decimal" value={form.credits} onChange={(v) => set("credits", v)} />}
          </FormField>
        ) : null}
        <FormField label={t("fields.categoryCode")} error={errors.categoryCode}>
          {(c) => <TextControl {...c} value={form.categoryCode} onChange={(v) => set("categoryCode", v.toUpperCase())} maxLength={40} />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {(["hoursTotal", "hoursLecture", "hoursTutorial", "hoursPractical"] as const).map((k) => (
          <FormField key={k} label={t(`fields.${k}`)} error={errors[k]}>
            {(c) => <TextControl {...c} inputMode="decimal" value={form[k]} onChange={(v) => set(k, v)} />}
          </FormField>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row sm:gap-6">
        <CheckControl checked={form.isMandatory} onChange={(v) => set("isMandatory", v)} label={t("fields.isMandatory")} />
        <CheckControl checked={form.isTransversal} onChange={(v) => set("isTransversal", v)} label={t("fields.isTransversal")} />
      </div>
    </div>
  );
}

function NodeEditForm({ node, type, onDone }: { node: TreeNode; type?: AcademicNodeTypeDto; onDone: () => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const [form, setForm] = useState<NodeForm>(() => formOf(node));
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateCurriculumNode();
  const set = <K extends keyof NodeForm>(k: K, v: NodeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const patch = diffPatch(form, node);
    if (Object.keys(patch).length === 0) return onDone();
    const v = validateWith(academicUpdateNodeBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync({ id: node.id, patch: v.data });
      onDone();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4 border-t pt-4"
      aria-label={t("editForm")}
    >
      <NodeFields form={form} set={set} errors={errors} type={type} />
      {update.error ? <ErrorBlock error={update.error} /> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Amendement d'une version publiée (motif obligatoire, opération UPDATE_NODE)
// ---------------------------------------------------------------------------

const AMENDABLE: ReadonlyArray<keyof NodeForm> = ["label", "coefficient", "credits", "hoursTotal", "hoursLecture", "hoursTutorial", "hoursPractical", "categoryCode", "isMandatory"];

function AmendDialog({ node, type, versionId, onClose, onDone }: { node: TreeNode; type?: AcademicNodeTypeDto; versionId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const amend = useAmendCurriculumVersion();
  const [form, setForm] = useState<NodeForm>(() => formOf(node));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [step, setStep] = useState<"form" | "reason">("form");
  const set = <K extends keyof NodeForm>(k: K, v: NodeForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const patch = useMemo(() => diffPatch(form, node, AMENDABLE), [form, node]);

  if (step === "reason") {
    return (
      <ReasonDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t("amendTitle", { label: node.label })}
        description={t("amendReasonDescription")}
        reasonLabel={t("amendReason")}
        confirmLabel={t("amend")}
        isPending={amend.isPending}
        error={amend.error}
        onConfirm={async (reason) => {
          const body = { reason, operations: [{ op: "UPDATE_NODE" as const, nodeId: node.id, patch }] };
          const v = validateWith(academicAmendBodySchema, body);
          if (!v.ok) return setErrors(v.errors);
          try {
            await amend.mutateAsync({ id: versionId, body: v.data });
            onDone();
            onClose();
          } catch {
            /* affichée par la boîte de dialogue */
          }
        }}
      />
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("amendTitle", { label: node.label })}
      description={t("amendDescription")}
      submitLabel={t("next")}
      wide
      onSubmit={() => {
        if (Object.keys(patch).length === 0) return setErrors({ label: t("nothingToAmend") });
        setErrors({});
        setStep("reason");
      }}
    >
      <NodeFields form={form} set={set} errors={errors} type={type} only={AMENDABLE} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Ajout d'un nœud (la grammaire — types, parents autorisés, champs requis — vient de l'API)
// ---------------------------------------------------------------------------

export function AddNodeButton({ tree, parent, onFlash, onCreated }: { tree: AcademicCurriculumTreeDto; parent: TreeNode | null; onFlash: (message: string) => void; onCreated: (id: string) => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)}>
        {parent ? t("addChild") : t("addRoot")}
      </button>
      {open ? <AddNodeDialog version={tree.version} parent={parent} onClose={() => setOpen(false)} onDone={(n) => { onFlash(t("nodeAdded", { label: n.label })); onCreated(n.id); }} /> : null}
    </>
  );
}

function AddNodeDialog({ version, parent, onClose, onDone }: { version: AcademicCurriculumVersionDto; parent: TreeNode | null; onClose: () => void; onDone: (node: AcademicCurriculumTreeNodeDto) => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const nodeTypes = useReference("node-types");
  const gradeLevels = useReference("grade-levels");
  const periodTypes = useReference("period-types");
  const add = useAddCurriculumNode();
  const [typeCode, setTypeCode] = useState("");
  const [form, setForm] = useState({ code: "", label: "", coefficient: "", credits: "", gradeLevelId: "", periodTypeCode: "", periodOrdinal: "1", isMandatory: true });
  const [subject, setSubject] = useState<SelectOption | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const parentCode = parent ? parent.nodeTypeCode : "ROOT";
  const allowed = (nodeTypes.data ?? []).filter((x) => x.allowedParentCodes.includes(parentCode));
  const type = allowed.find((x) => x.code === typeCode);

  async function submit() {
    if (!type) return setErrors({ nodeTypeCode: t("fields.typeRequired") });
    const body: Record<string, unknown> = {
      parentId: parent ? parent.id : null,
      nodeTypeCode: type.code,
      code: form.code.trim(),
      label: form.label.trim(),
      isMandatory: form.isMandatory,
    };
    if (type.allowsCoefficient && form.coefficient.trim()) body.coefficient = decimalInput(form.coefficient);
    if (type.allowsCredits && form.credits.trim()) body.credits = decimalInput(form.credits);
    if (type.requiresSubject && subject) body.subjectId = subject.value;
    if (type.requiresGradeLevel && form.gradeLevelId) body.gradeLevelId = form.gradeLevelId;
    if (type.requiresPeriodSlot && form.periodTypeCode) {
      body.periodTypeCode = form.periodTypeCode;
      body.periodOrdinal = Number(form.periodOrdinal);
    }
    const v = validateWith(academicCreateNodeBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await add.mutateAsync({ versionId: version.id, node: v.data });
      onDone({ ...created, children: [] });
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={parent ? t("addChildTitle", { label: parent.label }) : t("addRootTitle")}
      submitLabel={t("add")}
      isPending={add.isPending}
      error={add.error}
      wide
      onSubmit={() => void submit()}
    >
      {allowed.length === 0 && nodeTypes.data ? <Notice kind="warning">{t("noChildType")}</Notice> : null}
      <FormField label={t("fields.nodeType")} required error={errors.nodeTypeCode}>
        {(c) => <NativeSelect {...c} value={typeCode} onChange={setTypeCode} placeholder={t("choose")} options={allowed.map((x) => ({ value: x.code, label: x.label }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.code")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} maxLength={200} />}
        </FormField>
      </div>
      {type?.requiresSubject ? (
        <FormField label={t("fields.subject")} required error={errors.subjectId}>
          {(c) => <SelectAsync {...c} value={subject} onChange={setSubject} useOptions={useSubjectOptions} ariaLabel={t("fields.subject")} />}
        </FormField>
      ) : null}
      {type?.requiresGradeLevel ? (
        <FormField label={t("fields.gradeLevel")} required error={errors.gradeLevelId}>
          {(c) => <NativeSelect {...c} value={form.gradeLevelId} onChange={(v) => setForm((f) => ({ ...f, gradeLevelId: v }))} placeholder={t("choose")} options={(gradeLevels.data ?? []).filter((g) => g.active).map((g) => ({ value: g.id, label: g.label }))} />}
        </FormField>
      ) : null}
      {type?.requiresPeriodSlot ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("fields.periodType")} required error={errors.periodTypeCode}>
            {(c) => <NativeSelect {...c} value={form.periodTypeCode} onChange={(v) => setForm((f) => ({ ...f, periodTypeCode: v }))} placeholder={t("choose")} options={(periodTypes.data ?? []).filter((p) => p.active).map((p) => ({ value: p.code, label: p.label }))} />}
          </FormField>
          <FormField label={t("fields.periodOrdinal")} required error={errors.periodOrdinal}>
            {(c) => <TextControl {...c} type="number" min={1} max={99} inputMode="numeric" value={form.periodOrdinal} onChange={(v) => setForm((f) => ({ ...f, periodOrdinal: v }))} />}
          </FormField>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {type?.allowsCoefficient ? (
          <FormField label={t("fields.coefficient")} error={errors.coefficient}>
            {(c) => <TextControl {...c} inputMode="decimal" value={form.coefficient} onChange={(v) => setForm((f) => ({ ...f, coefficient: v }))} />}
          </FormField>
        ) : null}
        {type?.allowsCredits ? (
          <FormField label={t("fields.credits")} hint={type.creditsMustEqualChildren ? t("fields.creditsDerived") : undefined} error={errors.credits}>
            {(c) => <TextControl {...c} inputMode="decimal" value={form.credits} onChange={(v) => setForm((f) => ({ ...f, credits: v }))} />}
          </FormField>
        ) : null}
      </div>
      <CheckControl checked={form.isMandatory} onChange={(v) => setForm((f) => ({ ...f, isMandatory: v }))} label={t("fields.isMandatory")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Déplacement et prérequis
// ---------------------------------------------------------------------------

function MoveDialog({ node, tree, onClose, onDone }: { node: TreeNode; tree: AcademicCurriculumTreeDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const nodeTypes = useReference("node-types");
  const move = useMoveCurriculumNode();
  const [parentId, setParentId] = useState(findParent(tree.roots, node.id)?.id ?? "");
  const own = useMemo(() => descendantIds(node), [node]);
  const type = (nodeTypes.data ?? []).find((x) => x.code === node.nodeTypeCode);
  // Parents proposés : ni le nœud ni son sous-arbre (l'API refuse aussi les cycles et les parents non autorisés).
  const candidates = flattenForest(tree.roots).filter(({ node: n }) => n.id !== node.id && !own.has(n.id) && (!type || type.allowedParentCodes.includes(n.nodeTypeCode)));
  const canBeRoot = !type || type.allowedParentCodes.includes("ROOT");

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("moveTitle", { label: node.label })}
      description={t("moveDescription")}
      submitLabel={t("move")}
      isPending={move.isPending}
      error={move.error}
      onSubmit={() => void move.mutateAsync({ id: node.id, parentId: parentId || null }).then(() => { onDone(); onClose(); }).catch(() => undefined)}
    >
      <FormField label={t("newParent")} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={parentId}
            onChange={setParentId}
            placeholder={canBeRoot ? t("atRoot") : t("choose")}
            options={candidates.map(({ node: n, depth }) => ({ value: n.id, label: `${"— ".repeat(depth)}${n.code} — ${n.label}` }))}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function PrerequisitesDialog({ node, tree, onClose, onDone }: { node: TreeNode; tree: AcademicCurriculumTreeDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Academic.curriculum");
  const set = useSetNodePrerequisites();
  const [selected, setSelected] = useState<Set<string>>(new Set(node.prerequisiteLineageIds));
  const candidates = flattenForest(tree.roots).filter(({ node: n }) => n.id !== node.id);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("prerequisitesTitle", { label: node.label })}
      description={t("prerequisitesDescription")}
      submitLabel={t("save")}
      isPending={set.isPending}
      error={set.error}
      onSubmit={() => void set.mutateAsync({ id: node.id, requiredLineageIds: [...selected] }).then(() => { onDone(); onClose(); }).catch(() => undefined)}
    >
      <fieldset className="max-h-72 space-y-0 overflow-y-auto rounded-md border p-2">
        <legend className="sr-only">{t("prerequisites")}</legend>
        {candidates.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{t("treeEmpty")}</p> : null}
        {candidates.map(({ node: n, depth }) => (
          <div key={n.id} style={{ paddingLeft: `${depth * 1}rem` }}>
            <CheckControl
              checked={selected.has(n.lineageId)}
              onChange={(on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(n.lineageId);
                  else next.delete(n.lineageId);
                  return next;
                })
              }
              label={`${n.code} — ${n.label}`}
            />
          </div>
        ))}
      </fieldset>
    </FormDialog>
  );
}
