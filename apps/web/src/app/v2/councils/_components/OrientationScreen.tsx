"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  COUNCIL_ORIENTATION_PATH_KINDS,
  councilsOrientationPathInputSchema,
  councilsSeriesTransferInputSchema,
  type CouncilsOrientationFileDto,
  type CouncilsOrientationPathDto,
  type CouncilsSeriesTransferDto,
} from "@ecoledigitale/contracts/v2/councils";
import { usePrograms, useReference } from "@/platform/v2/academic";
import {
  useApplySeriesTransfer,
  useCancelSeriesTransfer,
  useCreateOrientationFile,
  useCreateSeriesTransfer,
  useOrientationFiles,
  useOrientationPaths,
  useRecordConsent,
  useSeriesTransfers,
  useUpsertOrientationPath,
} from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { canExpressWishes, WishDialog } from "./WishDialog";
import { ActionError, CouncilsBoundary, EnumLabel, ScrollTable, Section, StudentPicker, TD, TH, useClassChoices, useDateTime, useEnumText, type PickedStudent } from "./shared";

/** Libellés des programmes (séries) et niveaux : DONNÉES de l'API, jamais codés en dur. */
function useLookups() {
  const programs = usePrograms();
  const grades = useReference("grade-levels");
  const programLabel = (id: string | null) => (id ? ((programs.data ?? []).find((p) => p.id === id)?.label ?? "—") : "—");
  const gradeLabel = (id: string | null) => (id ? ((grades.data ?? []).find((g) => g.id === id)?.label ?? "—") : "—");
  return { programs: programs.data ?? [], grades: (grades.data ?? []).filter((g) => g.active), programLabel, gradeLabel };
}

type Dialog = { kind: "path"; row: CouncilsOrientationPathDto | null } | { kind: "file" } | { kind: "wish"; file: CouncilsOrientationFileDto } | { kind: "transfer" } | { kind: "cancelTransfer"; row: CouncilsSeriesTransferDto } | null;

/**
 * Orientation : parcours autorisés (données d'établissement), dossiers d'orientation (vœux, consentement du tuteur) et
 * transferts de série. L'API contrôle les parcours autorisés ; une dérogation exige un motif et une permission dédiée.
 */
export function OrientationScreen() {
  const t = useTranslations("v2Councils.orientation");
  const tWish = useTranslations("v2CouncilsExtra.wish");
  const flash = useFlash();
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = (key: string) => flash.show(t(key));
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <PathsSection onEdit={(row) => setDialog({ kind: "path", row })} />
      <FilesSection onCreate={() => setDialog({ kind: "file" })} onWish={(file) => setDialog({ kind: "wish", file })} onDone={done} />
      <TransfersSection onCreate={() => setDialog({ kind: "transfer" })} onCancel={(row) => setDialog({ kind: "cancelTransfer", row })} onDone={done} />
      {dialog?.kind === "path" ? <PathDialog row={dialog.row} onClose={() => setDialog(null)} onDone={() => done("done.pathSaved")} /> : null}
      {dialog?.kind === "file" ? <FileDialog onClose={() => setDialog(null)} onDone={() => done("done.fileCreated")} /> : null}
      {dialog?.kind === "wish" ? <WishDialog file={dialog.file} onClose={() => setDialog(null)} onDone={() => flash.show(tWish("saved"))} /> : null}
      {dialog?.kind === "transfer" ? <TransferDialog onClose={() => setDialog(null)} onDone={() => done("done.transferCreated")} /> : null}
      {dialog?.kind === "cancelTransfer" ? <CancelTransferDialog row={dialog.row} onClose={() => setDialog(null)} onDone={() => done("done.transferCancelled")} /> : null}
    </div>
  );
}

function PathsSection({ onEdit }: { onEdit: (row: CouncilsOrientationPathDto | null) => void }) {
  const t = useTranslations("v2Councils.orientation.paths");
  const text = useEnumText();
  const paths = useOrientationPaths();
  const lk = useLookups();
  const list = paths.data ?? [];
  return (
    <Section
      id="ori-paths"
      title={t("title")}
      actions={
        <Can permission="council.orientation.manage">
          <button type="button" className={buttonClass.secondary} onClick={() => onEdit(null)}>
            {t("add")}
          </button>
        </Can>
      }
    >
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <CouncilsBoundary query={paths} isEmpty={list.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("kind")}</th>
              <th scope="col" className={TH}>{t("from")}</th>
              <th scope="col" className={TH}>{t("to")}</th>
              <th scope="col" className={TH}>{t("rules")}</th>
              <th scope="col" className={TH}>{t("source")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((p) => (
              <tr key={p.id}>
                <td className={TD}>{text("pathKind", p.kind)}{p.label ? <div className="text-xs text-muted-foreground">{p.label}</div> : null}</td>
                <td className={TD}>{lk.programLabel(p.fromProgramId)} · {lk.gradeLabel(p.fromGradeLevelId)}</td>
                <td className={TD}>{lk.programLabel(p.toProgramId)} · {lk.gradeLabel(p.toGradeLevelId)}</td>
                <td className={TD}>
                  <div className="flex flex-wrap gap-1">
                    {p.requiresCouncilOpinion ? <StatusBadge label={t("opinion")} /> : null}
                    {p.requiresGuardianConsent ? <StatusBadge label={t("consent")} /> : null}
                    {!p.active ? <StatusBadge label={t("inactive")} tone="danger" /> : null}
                  </div>
                </td>
                <td className={TD}><EnumLabel group="ruleSource" value={p.sourceKind} /></td>
                <td className={TD}>
                  <Can permission="council.orientation.manage">
                    <button type="button" className={buttonClass.ghost} onClick={() => onEdit(p)}>{t("edit")}</button>
                  </Can>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </CouncilsBoundary>
    </Section>
  );
}

function FilesSection({ onCreate, onWish, onDone }: { onCreate: () => void; onWish: (file: CouncilsOrientationFileDto) => void; onDone: (key: string) => void }) {
  const t = useTranslations("v2Councils.orientation.files");
  const tWish = useTranslations("v2CouncilsExtra.wish");
  const files = useOrientationFiles({ pageSize: 100 });
  const consent = useRecordConsent();
  const list = files.data?.items ?? [];
  return (
    <Section
      id="ori-files"
      title={t("title")}
      actions={
        <Can permission="council.orientation.manage">
          <button type="button" className={buttonClass.secondary} onClick={onCreate}>
            {t("create")}
          </button>
        </Can>
      }
    >
      <ActionError error={consent.error} />
      <CouncilsBoundary query={files} isEmpty={list.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("student")}</th>
              <th scope="col" className={TH}>{t("status")}</th>
              <th scope="col" className={TH}>{t("wishes")}</th>
              <th scope="col" className={TH}>{t("consent")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((f: CouncilsOrientationFileDto) => (
              <tr key={f.id}>
                <td className={TD}>{f.studentName ?? "—"}{f.notes ? <div className="text-xs text-muted-foreground">{f.notes}</div> : null}</td>
                <td className={TD}><EnumLabel group="orientationStatus" value={f.status} /></td>
                <td className={TD}>{f.wishes.filter((w) => w.withdrawnAt === null).length}</td>
                <td className={TD}><EnumLabel group="consent" value={f.guardianConsent} /></td>
                <td className={TD}>
                  <Can permission="council.orientation.manage">
                    <div className="flex flex-wrap gap-2">
                      {canExpressWishes(f) ? (
                        <button type="button" className={buttonClass.secondary} onClick={() => onWish(f)} aria-label={tWish("addFor", { name: f.studentName ?? "—" })}>
                          {tWish("add")}
                        </button>
                      ) : null}
                    </div>
                  </Can>
                  {f.guardianConsent === "PENDING" ? (
                    <Can permission="council.orientation.manage">
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={buttonClass.secondary} disabled={consent.isPending} onClick={() => consent.mutate({ id: f.id, state: "GIVEN" }, { onSuccess: () => onDone("done.consentGiven") })}>
                          {t("consentGiven")}
                        </button>
                        <button type="button" className={buttonClass.ghost} disabled={consent.isPending} onClick={() => consent.mutate({ id: f.id, state: "REFUSED" }, { onSuccess: () => onDone("done.consentRefused") })}>
                          {t("consentRefused")}
                        </button>
                      </div>
                    </Can>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </CouncilsBoundary>
    </Section>
  );
}

function TransfersSection({ onCreate, onCancel, onDone }: { onCreate: () => void; onCancel: (row: CouncilsSeriesTransferDto) => void; onDone: (key: string) => void }) {
  const t = useTranslations("v2Councils.orientation.transfers");
  const dt = useDateTime();
  const text = useEnumText();
  const transfers = useSeriesTransfers();
  const apply = useApplySeriesTransfer();
  const lk = useLookups();
  const [applying, setApplying] = useState<CouncilsSeriesTransferDto | null>(null);
  const list = transfers.data ?? [];
  return (
    <Section
      id="ori-transfers"
      title={t("title")}
      actions={
        <Can permission="council.orientation.manage">
          <button type="button" className={buttonClass.secondary} onClick={onCreate}>
            {t("create")}
          </button>
        </Can>
      }
    >
      <ActionError error={apply.error} />
      <CouncilsBoundary query={transfers} isEmpty={list.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("from")}</th>
              <th scope="col" className={TH}>{t("to")}</th>
              <th scope="col" className={TH}>{t("effective")}</th>
              <th scope="col" className={TH}>{t("decidedVia")}</th>
              <th scope="col" className={TH}>{t("status")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((x) => (
              <tr key={x.id}>
                <td className={TD}>{lk.programLabel(x.fromProgramId)} · {lk.gradeLabel(x.fromGradeLevelId)}</td>
                <td className={TD}>{lk.programLabel(x.toProgramId)} · {lk.gradeLabel(x.toGradeLevelId)}{x.overridden ? <StatusBadge label={t("overridden")} tone="warning" className="ml-2" /> : null}</td>
                <td className={TD}>{text("effectiveKind", x.effectiveKind)}{x.effectiveOn ? ` · ${dt.date(x.effectiveOn)}` : ""}</td>
                <td className={TD}>{text("decidedVia", x.decidedVia)}{x.actReference ? <div className="text-xs text-muted-foreground">{x.actReference}</div> : null}</td>
                <td className={TD}>
                  <EnumLabel group="transferStatus" value={x.status} />
                  {x.lastError ? <div className="text-xs text-destructive">{x.lastError}</div> : null}
                  {x.cancelReason ? <div className="text-xs text-muted-foreground">{x.cancelReason}</div> : null}
                </td>
                <td className={TD}>
                  {x.status === "PLANNED" ? (
                    <Can permission="council.orientation.manage">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={buttonClass.primary} disabled={apply.isPending} onClick={() => (x.effectiveKind === "MID_YEAR" ? setApplying(x) : apply.mutate({ id: x.id }, { onSuccess: () => onDone("done.transferApplied") }))}>
                          {t("apply")}
                        </button>
                        <button type="button" className={buttonClass.ghost} onClick={() => onCancel(x)}>
                          {t("cancel")}
                        </button>
                      </div>
                    </Can>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </CouncilsBoundary>
      {applying ? (
        <ApplyTransferDialog
          isPending={apply.isPending}
          error={apply.error}
          onClose={() => setApplying(null)}
          onConfirm={(toClassroomId) => apply.mutate({ id: applying.id, toClassroomId }, { onSuccess: () => { onDone("done.transferApplied"); setApplying(null); } })}
        />
      ) : null}
    </Section>
  );
}

/** Transfert en cours d'année : la classe de destination est désignée à l'application (même établissement et même année). */
function ApplyTransferDialog({ isPending, error, onClose, onConfirm }: { isPending: boolean; error: unknown; onClose: () => void; onConfirm: (toClassroomId: string) => void }) {
  const t = useTranslations("v2Councils.orientation.transfers.applyDialog");
  const classes = useClassChoices();
  const [classroomId, setClassroomId] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("confirm")}
      onSubmit={() => {
        setTouched(true);
        if (classroomId) onConfirm(classroomId);
      }}
      isPending={isPending}
      error={error}
    >
      <FormField label={t("classroom")} required error={touched && !classroomId ? t("classroomRequired") : null}>
        {(c) => <NativeSelect {...c} value={classroomId} placeholder={t("choose")} onChange={setClassroomId} options={classes.options} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Fenêtres
// ---------------------------------------------------------------------------

const generalError = (e: unknown) => (e && Object.keys(apiErrorToFieldErrors(e)).length === 0 ? e : undefined);

function PathDialog({ row, onClose, onDone }: { row: CouncilsOrientationPathDto | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.orientation.paths.form");
  const text = useEnumText();
  const lk = useLookups();
  const upsert = useUpsertOrientationPath();
  const [kind, setKind] = useState<string>(row?.kind ?? "ORIENTATION");
  const [fromProgramId, setFromProgram] = useState(row?.fromProgramId ?? "");
  const [fromGradeLevelId, setFromGrade] = useState(row?.fromGradeLevelId ?? "");
  const [toProgramId, setToProgram] = useState(row?.toProgramId ?? "");
  const [toGradeLevelId, setToGrade] = useState(row?.toGradeLevelId ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [opinion, setOpinion] = useState(row?.requiresCouncilOpinion ?? true);
  const [consent, setConsent] = useState(row?.requiresGuardianConsent ?? false);
  const [active, setActive] = useState(row?.active ?? true);
  const [sourceKind, setSource] = useState<string>(row?.sourceKind ?? "institution");
  const [errors, setErrors] = useState<FieldErrors>({});
  const programOptions = lk.programs.map((p) => ({ value: p.id, label: p.label }));
  const gradeOptions = lk.grades.map((g) => ({ value: g.id, label: g.label }));
  function submit() {
    const v = validateWith(councilsOrientationPathInputSchema, {
      kind,
      fromProgramId: fromProgramId || null,
      fromGradeLevelId,
      toProgramId,
      toGradeLevelId,
      label: label.trim() || null,
      requiresCouncilOpinion: opinion,
      requiresGuardianConsent: consent,
      active,
      sourceKind,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    upsert.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={row ? t("editTitle") : t("addTitle")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={upsert.isPending} error={generalError(upsert.error)} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("kind")} required error={errors.kind ?? null}>{(c) => <NativeSelect {...c} value={kind} onChange={setKind} options={COUNCIL_ORIENTATION_PATH_KINDS.map((k) => ({ value: k, label: text("pathKind", k) }))} />}</FormField>
        <FormField label={t("sourceKind")} required error={errors.sourceKind ?? null}>{(c) => <NativeSelect {...c} value={sourceKind} onChange={setSource} options={(["regulation", "institution", "placeholder"] as const).map((k) => ({ value: k, label: text("ruleSource", k) }))} />}</FormField>
        <FormField label={t("fromProgram")} error={errors.fromProgramId ?? null}>{(c) => <NativeSelect {...c} value={fromProgramId} placeholder={t("any")} onChange={setFromProgram} options={programOptions} />}</FormField>
        <FormField label={t("fromGrade")} required error={errors.fromGradeLevelId ?? null}>{(c) => <NativeSelect {...c} value={fromGradeLevelId} placeholder={t("choose")} onChange={setFromGrade} options={gradeOptions} />}</FormField>
        <FormField label={t("toProgram")} required error={errors.toProgramId ?? null}>{(c) => <NativeSelect {...c} value={toProgramId} placeholder={t("choose")} onChange={setToProgram} options={programOptions} />}</FormField>
        <FormField label={t("toGrade")} required error={errors.toGradeLevelId ?? null}>{(c) => <NativeSelect {...c} value={toGradeLevelId} placeholder={t("choose")} onChange={setToGrade} options={gradeOptions} />}</FormField>
      </div>
      <FormField label={t("label")} error={errors.label ?? null}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}</FormField>
      <CheckControl checked={opinion} onChange={setOpinion} label={t("opinion")} />
      <CheckControl checked={consent} onChange={setConsent} label={t("consent")} />
      <CheckControl checked={active} onChange={setActive} label={t("active")} />
    </FormDialog>
  );
}

function FileDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.orientation.files.form");
  const create = useCreateOrientationFile();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    if (!student) return setErrors({ student: t("studentRequired") });
    setErrors({});
    create.mutate(compact({ enrollmentId: student.enrollmentId, notes: notes.trim() }) as { enrollmentId: string; notes?: string }, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={generalError(create.error)}>
      <StudentPicker value={student} onChange={setStudent} error={errors.student ?? errors.enrollmentId ?? null} />
      <FormField label={t("notes")} error={errors.notes ?? null}>{(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} rows={3} maxLength={2000} />}</FormField>
    </FormDialog>
  );
}

function TransferDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.orientation.transfers.form");
  const text = useEnumText();
  const lk = useLookups();
  const paths = useOrientationPaths();
  const create = useCreateSeriesTransfer();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [toProgramId, setToProgram] = useState("");
  const [toGradeLevelId, setToGrade] = useState("");
  const [effectiveKind, setEffectiveKind] = useState("NEXT_YEAR");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [decidedVia, setDecidedVia] = useState("COUNCIL");
  const [decisionId, setDecisionId] = useState("");
  const [actReference, setActReference] = useState("");
  const [pathId, setPathId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  function pickPath(id: string) {
    setPathId(id);
    const p = (paths.data ?? []).find((x) => x.id === id);
    if (p) {
      setToProgram(p.toProgramId);
      setToGrade(p.toGradeLevelId);
    }
  }
  function submit() {
    if (!student) return setErrors({ student: t("studentRequired") });
    const v = validateWith(
      councilsSeriesTransferInputSchema,
      compact({
        enrollmentId: student.enrollmentId,
        toProgramId,
        toGradeLevelId,
        effectiveKind,
        effectiveOn: effectiveKind === "MID_YEAR" ? effectiveOn : "",
        decidedVia,
        decisionId: decidedVia === "COUNCIL" ? decisionId.trim() : "",
        actReference: decidedVia === "DIRECTOR_ACT" ? actReference.trim() : "",
        pathId,
        overrideReason: pathId ? "" : overrideReason.trim(),
      }),
    );
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    create.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={generalError(create.error)} wide>
      <StudentPicker value={student} onChange={setStudent} error={errors.student ?? errors.enrollmentId ?? null} />
      <FormField label={t("path")} hint={t("pathHint")} error={errors.pathId ?? null}>
        {(c) => <NativeSelect {...c} value={pathId} placeholder={t("noPath")} onChange={pickPath} options={(paths.data ?? []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.label ?? `${lk.programLabel(p.toProgramId)} · ${lk.gradeLabel(p.toGradeLevelId)}` }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("toProgram")} required error={errors.toProgramId ?? null}>{(c) => <NativeSelect {...c} value={toProgramId} placeholder={t("choose")} onChange={setToProgram} options={lk.programs.map((p) => ({ value: p.id, label: p.label }))} />}</FormField>
        <FormField label={t("toGrade")} required error={errors.toGradeLevelId ?? null}>{(c) => <NativeSelect {...c} value={toGradeLevelId} placeholder={t("choose")} onChange={setToGrade} options={lk.grades.map((g) => ({ value: g.id, label: g.label }))} />}</FormField>
        <FormField label={t("effectiveKind")} required error={errors.effectiveKind ?? null}>{(c) => <NativeSelect {...c} value={effectiveKind} onChange={setEffectiveKind} options={(["NEXT_YEAR", "MID_YEAR"] as const).map((k) => ({ value: k, label: text("effectiveKind", k) }))} />}</FormField>
        {effectiveKind === "MID_YEAR" ? <FormField label={t("effectiveOn")} required error={errors.effectiveOn ?? null}>{(c) => <TextControl {...c} type="date" value={effectiveOn} onChange={setEffectiveOn} />}</FormField> : null}
        <FormField label={t("decidedVia")} required error={errors.decidedVia ?? null}>{(c) => <NativeSelect {...c} value={decidedVia} onChange={setDecidedVia} options={(["COUNCIL", "DIRECTOR_ACT"] as const).map((k) => ({ value: k, label: text("decidedVia", k) }))} />}</FormField>
        {decidedVia === "COUNCIL" ? (
          <FormField label={t("decisionId")} hint={t("decisionIdHint")} required error={errors.decisionId ?? null}>{(c) => <TextControl {...c} value={decisionId} onChange={setDecisionId} />}</FormField>
        ) : (
          <FormField label={t("actReference")} required error={errors.actReference ?? null}>{(c) => <TextControl {...c} value={actReference} onChange={setActReference} maxLength={200} />}</FormField>
        )}
      </div>
      {pathId === "" ? (
        <FormField label={t("overrideReason")} hint={t("overrideHint")} required error={errors.overrideReason ?? errors.pathId ?? null}>
          {(c) => <TextAreaControl {...c} value={overrideReason} onChange={setOverrideReason} rows={3} maxLength={2000} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}

function CancelTransferDialog({ row, onClose, onDone }: { row: CouncilsSeriesTransferDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.orientation.transfers.cancelDialog");
  const cancel = useCancelSeriesTransfer();
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      reasonLabel={t("label")}
      confirmLabel={t("confirm")}
      destructive
      maxLength={1000}
      isPending={cancel.isPending}
      error={cancel.error}
      onConfirm={(reason) => cancel.mutate({ id: row.id, reason }, { onSuccess: () => { onDone(); onClose(); } })}
    />
  );
}
