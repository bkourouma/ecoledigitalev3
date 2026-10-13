"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { academicOpenPeriodOffersTypeGuard, buildOpenPeriodBody } from "./offerings-utils";
import type { AcademicOfferingDto } from "@ecoledigitale/contracts/v2/academic";
import { academicOpenPeriodOfferingsBodySchema } from "@ecoledigitale/contracts/v2/academic";
import { useClassroom, useClassroomOfferings, useCurriculumTree, useOfferingAction, useOpenPeriodOfferings, useReference, type OfferingAction } from "@/platform/v2/academic";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useFeature } from "@/platform/access";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { Wizard } from "@/platform/ui/Wizard";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { flattenForest } from "./tree-utils";
import { toneOf } from "./shared";

/** Boutons proposés selon l'état d'une offre (affordance d'écran) ; la transition est décidée par l'API. */
const OFFERING_ACTIONS: Record<string, OfferingAction[]> = { DRAFT: ["open", "cancel"], OPEN: ["start", "cancel"], FULL: ["start", "cancel"], IN_PROGRESS: ["complete", "cancel"], COMPLETED: [], CANCELLED: [] };

const useClassOptions = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, {});

export function OfferingsScreen({ initialClassroomId }: { initialClassroomId?: string }) {
  const t = useTranslations("v2Academic.offerings");
  const feature = useFeature("academic.a-la-carte");
  const [classroom, setClassroom] = useState<SelectOption | null>(initialClassroomId ? { value: initialClassroomId, label: initialClassroomId } : null);
  const [opening, setOpening] = useState(false);
  const flash = useFlash();

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          classroom ? (
            <Can permission="academic.classroom.manage">
              <button type="button" className={buttonClass.primary} onClick={() => setOpening(true)}>
                {t("openSemester")}
              </button>
            </Can>
          ) : null
        }
      />
      {!feature.isLoading && !feature.allowed ? <div className="mb-4"><FeatureNotice>{feature.isUnavailable ? undefined : t("featureOff")}</FeatureNotice></div> : null}
      <div className="mb-4 max-w-xl">
        <FormField label={t("classroom")} required>
          {(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); setOpening(false); }} useOptions={useClassOptions} placeholder={t("chooseClassroom")} ariaLabel={t("classroom")} />}
        </FormField>
      </div>
      {flash.node}
      {classroom ? (opening ? <OpenSemesterWizard classroomId={classroom.value} onCancel={() => setOpening(false)} onDone={(msg) => { flash.show(msg); setOpening(false); }} /> : <OfferingsList classroomId={classroom.value} onFlash={flash.show} />) : <EmptyBlock title={t("pickClassroom")} />}
    </div>
  );
}

function OfferingsList({ classroomId, onFlash }: { classroomId: string; onFlash: (m: string) => void }) {
  const t = useTranslations("v2Academic.offerings");
  const tStatus = useTranslations("v2Academic.status.offering");
  const offerings = useClassroomOfferings(classroomId);
  const action = useOfferingAction();
  const date = useDateFormat();
  const [cancelling, setCancelling] = useState<AcademicOfferingDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(a: OfferingAction, o: AcademicOfferingDto) {
    setError(null);
    try {
      await action.mutateAsync({ id: o.id, action: a });
      onFlash(t(`done.${a}`, { label: o.label }));
    } catch (e) {
      setError(e);
    }
  }

  const columns: DataTableColumn<AcademicOfferingDto>[] = [
    { id: "label", header: t("columns.label"), rowHeader: true, cell: (o) => <span className="font-medium">{o.label}</span> },
    { id: "dates", header: t("columns.dates"), cell: (o) => `${date.civil(o.startsOn)} → ${date.civil(o.endsOn)}`, className: "hidden sm:table-cell" },
    { id: "window", header: t("columns.window"), cell: (o) => (o.registrationOpensAt ? `${date.instant(o.registrationOpensAt)} → ${date.instant(o.registrationClosesAt)}` : "—"), className: "hidden lg:table-cell" },
    { id: "places", header: t("columns.places"), align: "right", cell: (o) => (o.capacity ? t("placesOf", { held: o.heldPlaces, capacity: o.capacity }) : String(o.heldPlaces)) },
    { id: "status", header: t("columns.status"), cell: (o) => <StatusBadge label={tStatus(o.status)} tone={toneOf(o.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (o) => (
        <Can permission="academic.classroom.manage">
          <span className="flex flex-wrap justify-end gap-1">
            {(OFFERING_ACTIONS[o.status] ?? []).map((a) =>
              a === "cancel" ? (
                <button key={a} type="button" className={buttonClass.ghost} onClick={() => setCancelling(o)} aria-label={`${t("actions.cancel")} — ${o.label}`}>
                  {t("actions.cancel")}
                </button>
              ) : (
                <button key={a} type="button" className={buttonClass.secondary} disabled={action.isPending} onClick={() => void run(a, o)} aria-label={`${t(`actions.${a}`)} — ${o.label}`}>
                  {t(`actions.${a}`)}
                </button>
              ),
            )}
          </span>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {error ? <ErrorBlock error={error} /> : null}
      <DataTable caption={t("tableCaption")} columns={columns} rows={offerings.data ?? []} getRowId={(o) => o.id} isLoading={offerings.isFetching} error={offerings.error} onRetry={() => void offerings.refetch()} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {cancelling ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setCancelling(null)}
          title={t("cancelTitle", { label: cancelling.label })}
          description={t("cancelDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("actions.cancel")}
          destructive
          isPending={action.isPending}
          error={action.error}
          onConfirm={async (reason) => {
            try {
              await action.mutateAsync({ id: cancelling.id, action: "cancel", reason });
              onFlash(t("done.cancel", { label: cancelling.label }));
              setCancelling(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** Assistant « ouvrir un semestre » : période du curriculum -> dates et fenêtre d'inscription -> récapitulatif. */
function OpenSemesterWizard({ classroomId, onCancel, onDone }: { classroomId: string; onCancel: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Academic.offerings");
  const classroom = useClassroom(classroomId);
  const tree = useCurriculumTree(classroom.data?.curriculumVersionId ?? null);
  const nodeTypes = useReference("node-types");
  const open = useOpenPeriodOfferings();
  const date = useDateFormat();
  const [form, setForm] = useState({ periodNodeId: "", startsOn: "", endsOn: "", registrationOpensAt: "", registrationClosesAt: "", capacity: "", open: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Nœuds « période » : ceux dont le type exige un créneau de période (la grammaire est une donnée de l'API).
  const periodNodes = useMemo(() => {
    const periodTypeCodes = new Set((nodeTypes.data ?? []).filter(academicOpenPeriodOffersTypeGuard).map((x) => x.code));
    return flattenForest(tree.data?.roots ?? []).filter(({ node }) => periodTypeCodes.has(node.nodeTypeCode));
  }, [tree.data, nodeTypes.data]);

  function validateStep(step: 0 | 1): boolean {
    const e: FieldErrors = {};
    if (step === 0 && !form.periodNodeId) e.periodNodeId = t("wizard.periodRequired");
    if (step === 1) {
      const v = validateWith(academicOpenPeriodOfferingsBodySchema, buildOpenPeriodBody(form));
      if (!v.ok) Object.assign(e, v.errors);
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function finish() {
    const v = validateWith(academicOpenPeriodOfferingsBodySchema, buildOpenPeriodBody(form));
    if (!v.ok) return setErrors(v.errors);
    try {
      const result = await open.mutateAsync({ classroomId, body: v.data });
      onDone(t("wizard.done", { created: result.created.length, existing: result.existing.length }));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  if (classroom.isPending && classroom.fetchStatus !== "idle") return <LoadingBlock />;
  if (classroom.isError) return <ErrorBlock error={classroom.error} />;
  if (!classroom.data?.curriculumVersionId) return <Notice kind="warning">{t("wizard.noCurriculum")}</Notice>;
  const chosen = periodNodes.find(({ node }) => node.id === form.periodNodeId)?.node;

  return (
    <Wizard
      label={t("wizard.title")}
      finishLabel={t("wizard.finish")}
      isSubmitting={open.isPending}
      onCancel={onCancel}
      onFinish={finish}
      footerNotice={open.error ? <ErrorBlock error={open.error} /> : null}
      steps={[
        {
          id: "period",
          title: t("wizard.stepPeriod"),
          description: t("wizard.stepPeriodHint"),
          validate: () => validateStep(0),
          content: (
            <>
              {tree.isPending && tree.fetchStatus !== "idle" ? <LoadingBlock /> : null}
              {tree.isError ? <ErrorBlock error={tree.error} /> : null}
              {tree.data && periodNodes.length === 0 ? <Notice kind="warning">{t("wizard.noPeriodNode")}</Notice> : null}
              <FormField label={t("wizard.period")} required error={errors.periodNodeId}>
                {(c) => <NativeSelect {...c} value={form.periodNodeId} onChange={set("periodNodeId")} placeholder={t("wizard.choose")} options={periodNodes.map(({ node, depth }) => ({ value: node.id, label: `${"— ".repeat(depth)}${node.label} (${node.code})` }))} />}
              </FormField>
            </>
          ),
        },
        {
          id: "dates",
          title: t("wizard.stepDates"),
          description: t("wizard.stepDatesHint"),
          validate: () => validateStep(1),
          content: (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("wizard.startsOn")} required error={errors.startsOn}>
                {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
              </FormField>
              <FormField label={t("wizard.endsOn")} required error={errors.endsOn}>
                {(c) => <TextControl {...c} type="date" value={form.endsOn} onChange={set("endsOn")} />}
              </FormField>
              <FormField label={t("wizard.registrationOpensAt")} hint={t("wizard.windowHint")} error={errors.registrationOpensAt}>
                {(c) => <TextControl {...c} type="date" value={form.registrationOpensAt} onChange={set("registrationOpensAt")} />}
              </FormField>
              <FormField label={t("wizard.registrationClosesAt")} error={errors.registrationClosesAt}>
                {(c) => <TextControl {...c} type="date" value={form.registrationClosesAt} onChange={set("registrationClosesAt")} />}
              </FormField>
              <FormField label={t("wizard.capacity")} hint={t("wizard.capacityHint")} error={errors.capacity}>
                {(c) => <TextControl {...c} type="number" min={1} inputMode="numeric" value={form.capacity} onChange={set("capacity")} />}
              </FormField>
            </div>
          ),
        },
        {
          id: "review",
          title: t("wizard.stepReview"),
          content: (
            <div className="space-y-3">
              <dl className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("wizard.period")}</dt>
                  <dd>{chosen ? `${chosen.label} (${chosen.code})` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("columns.dates")}</dt>
                  <dd>{`${date.civil(form.startsOn)} → ${date.civil(form.endsOn)}`}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("columns.window")}</dt>
                  <dd>{form.registrationOpensAt ? `${date.civil(form.registrationOpensAt)} → ${date.civil(form.registrationClosesAt)}` : t("wizard.noWindow")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("wizard.capacity")}</dt>
                  <dd>{form.capacity || t("wizard.unlimited")}</dd>
                </div>
              </dl>
              <CheckControl checked={form.open} onChange={set("open")} label={t("wizard.openNow")} hint={t("wizard.openNowHint")} />
              <p className="text-sm text-muted-foreground">{t("wizard.reviewNote")}</p>
            </div>
          ),
        },
      ]}
    />
  );
}
