"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { PRIMARY_PLACEHOLDER_NOTICE, type PrimaryMyClassroomDto } from "@ecoledigitale/contracts/v2/primary_school";
import { useFeature, usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDescribeError } from "@/platform/ui/errors";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, type Tone } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { primaryBlockersSchema, useMyPrimaryClassrooms, usePrimaryRuleBanner, usePrimaryYearLabels } from "@/platform/v2/primary";

// ---------------------------------------------------------------------------
// Libellés de CODES (jamais l'inverse : le web ne compare pas un libellé)
// ---------------------------------------------------------------------------

type CodeGroup = "reviewStatus" | "archiveStatus" | "caseStatus" | "councilRole" | "reasonCode" | "ruleProposal" | "phraseScope" | "sourceKind" | "reportKey" | "assessmentStatus" | "frameworkStatus" | "outcomeCode";

/** Traduit un CODE par table de libellés ; un code inconnu s'affiche tel quel (rien n'est inventé). */
export function useCodeLabels(): (group: CodeGroup, code: string | null | undefined) => string {
  const t = useTranslations("v2PrimaryCommon");
  return (group, code) => {
    if (!code) return "—";
    const key = `${group}.${code}`;
    return t.has(key) ? t(key) : code;
  };
}

/** Tonalité d'une pastille d'état (affichage seulement : le libellé porte le sens). */
export function toneOfReview(status: string): Tone {
  if (status === "SEALED") return "success";
  if (status === "READY") return "info";
  if (status === "SUPERSEDED") return "neutral";
  return "warning";
}

export function toneOfCase(status: string): Tone {
  if (status === "DECIDED") return "success";
  if (status === "DEFERRED") return "neutral";
  return "info";
}

export function toneOfArchive(status: string): Tone {
  if (status === "FROZEN") return "success";
  if (status === "READY") return "info";
  return "warning";
}

export const shortHash = (hash: string | null | undefined): string => (hash ? `${hash.slice(0, 12)}…` : "—");
export const shortRef = (id: string | null | undefined): string => (id ? id.slice(0, 8) : "—");

// ---------------------------------------------------------------------------
// Erreurs de l'API : message tel quel + piste d'action connue
// ---------------------------------------------------------------------------

/** Manques d'un refus 409 (`details.blockers`) : scellement d'un bilan, publication d'un référentiel. */
export function blockersOf(error: unknown): Array<{ code: string; message: string }> {
  if (!(error instanceof ApiError) || error.details === null || typeof error.details !== "object") return [];
  const parsed = primaryBlockersSchema.safeParse((error.details as { blockers?: unknown }).blockers);
  return parsed.success ? parsed.data : [];
}

const CODE_PREFIX = "primary_school.";

/**
 * Erreur d'une action ou d'une lecture. Le message français de l'API est affiché TEL QUEL ; une piste d'action est ajoutée pour
 * les codes connus. Un service indisponible (`port_unavailable`, 500) est expliqué au lieu d'une erreur brute.
 */
export function PrimaryError({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations("v2PrimaryCommon");
  const describe = useDescribeError();
  if (!error) return null;
  const code = error instanceof ApiError && error.code.startsWith(CODE_PREFIX) ? error.code.slice(CODE_PREFIX.length) : null;
  const hintKey = code ? `errorHints.${code}` : null;
  const hint = hintKey && t.has(hintKey) ? t(hintKey) : null;
  // 404 hors périmètre (classe non affectée, enfant non lié) : message NEUTRE, qui ne révèle pas l'existence de la ressource.
  const notFound = error instanceof ApiError && error.status === 404;
  const message = notFound ? t("notFoundNeutral") : code === "port_unavailable" ? (hint ?? describe(error)) : describe(error);
  const blockers = blockersOf(error);
  return (
    <div role="alert" className={className ?? "space-y-2 rounded-xl border border-red-400/40 bg-red-400/10 p-3.5 text-sm text-red-200"}>
      <p>{message}</p>
      {hint && code !== "port_unavailable" ? <p className="text-xs">{hint}</p> : null}
      {blockers.length > 0 ? (
        <div>
          <p className="text-xs font-medium">{t("blockersTitle")}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bandeau « Règles de démonstration »
// ---------------------------------------------------------------------------

/** Mention fixe du contrat, reprise telle quelle. Utilisée sur chaque document ou écran dont les règles sont fictives. */
export function PlaceholderNotice({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("v2PrimaryCommon");
  return (
    <aside role="note" aria-label={t("ruleBanner.label")} className="flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3.5 text-sm text-amber-100" data-testid="placeholder-notice">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{PRIMARY_PLACEHOLDER_NOTICE}</p>
        {compact ? null : <p className="mt-0.5 text-xs">{t("ruleBanner.explain")}</p>}
      </div>
    </aside>
  );
}

/**
 * Bandeau PERMANENT des écrans du personnel : visible tant que le RuleSet lié est fictif (`GET /rule-banner`). Si l'état des
 * règles ne peut pas être lu, on le DIT plutôt que de cacher une éventuelle mention.
 */
export function RuleBanner({ classroomId }: { classroomId?: string | null }) {
  const t = useTranslations("v2PrimaryCommon");
  const banner = usePrimaryRuleBanner(classroomId ?? null);
  if (banner.isPending) return null;
  if (banner.isError) return <Notice kind="info">{t("ruleBanner.unknown")}</Notice>;
  return banner.data.isPlaceholder ? <PlaceholderNotice /> : null;
}

// ---------------------------------------------------------------------------
// Garde de fonctionnalité de l'offre
// ---------------------------------------------------------------------------

/** Masque l'écran quand la fonctionnalité de l'offre n'est pas incluse (l'API reste la barrière). */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const t = useTranslations("v2PrimaryCommon");
  const { allowed, isLoading } = useFeature(feature);
  if (isLoading) return <LoadingBlock />;
  if (!allowed) return <Notice kind="info">{t("featureUnavailable")}</Notice>;
  return <>{children}</>;
}

/** Affiche `children` seulement si la permission est détenue (masque, ne désactive pas). */
export function IfPermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { allowed } = usePermission(permission);
  return allowed ? <>{children}</> : null;
}

// ---------------------------------------------------------------------------
// Classes, périodes, années
// ---------------------------------------------------------------------------

export function useClassSelection(initialClassroomId?: string | null) {
  const classes = useMyPrimaryClassrooms();
  const list = useMemo(() => classes.data ?? [], [classes.data]);
  const [classroomId, setClassroomId] = useState<string>(initialClassroomId ?? "");
  const [periodId, setPeriodId] = useState<string>("");
  const classroom = list.find((c) => c.classroomId === classroomId) ?? null;

  // Une seule classe (cas courant de l'instituteur) : choisie d'office ; une seule période : idem.
  useEffect(() => {
    if (!classroomId && list.length === 1) setClassroomId(list[0]!.classroomId);
    // Classe demandée par l'adresse mais hors périmètre (ou inconnue) : on ne la retient pas.
    if (classroomId && list.length > 0 && !list.some((c) => c.classroomId === classroomId)) setClassroomId("");
  }, [list, classroomId]);
  useEffect(() => {
    if (classroom && !classroom.periods.some((p) => p.id === periodId)) setPeriodId(classroom.periods.length === 1 ? classroom.periods[0]!.id : "");
  }, [classroom, periodId]);

  return {
    classes,
    list,
    classroom,
    classroomId,
    periodId,
    period: classroom?.periods.find((p) => p.id === periodId) ?? null,
    setClassroomId: (id: string) => {
      setClassroomId(id);
      setPeriodId("");
    },
    setPeriodId,
  };
}

export function classLabel(c: Pick<PrimaryMyClassroomDto, "name" | "gradeLevelCode" | "classroomId">): string {
  return c.name ?? c.gradeLevelCode ?? c.classroomId.slice(0, 8);
}

export function ClassPeriodPicker({
  classes,
  classroomId,
  periodId,
  onClassroom,
  onPeriod,
  showPeriod = true,
}: {
  classes: ReadonlyArray<PrimaryMyClassroomDto>;
  classroomId: string;
  periodId: string;
  onClassroom: (id: string) => void;
  onPeriod: (id: string) => void;
  showPeriod?: boolean;
}) {
  const t = useTranslations("v2PrimaryCommon");
  const classroom = classes.find((c) => c.classroomId === classroomId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={t("pickers.classroom")}>
        {(c) => <NativeSelect {...c} value={classroomId} onChange={onClassroom} placeholder={t("pickers.chooseClassroom")} options={classes.map((x) => ({ value: x.classroomId, label: classLabel(x) }))} />}
      </FormField>
      {showPeriod ? (
        <FormField label={t("pickers.period")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={periodId}
              onChange={onPeriod}
              disabled={!classroom}
              placeholder={t("pickers.choosePeriod")}
              options={(classroom?.periods ?? []).map((p) => ({ value: p.id, label: p.locked ? t("pickers.periodLocked", { label: p.label }) : p.label }))}
            />
          )}
        </FormField>
      ) : null}
    </div>
  );
}

/** Années proposées : celles des classes visibles, libellées quand la lecture académique est permise (identifiant court sinon). */
export function useYearOptions(classes: ReadonlyArray<PrimaryMyClassroomDto>): Array<{ value: string; label: string }> {
  const t = useTranslations("v2PrimaryCommon");
  const canRead = usePermission("academic.year.read").allowed;
  const labels = usePrimaryYearLabels(canRead);
  return useMemo(() => {
    const ids = [...new Set(classes.map((c) => c.academicYearId))];
    return ids.map((id) => ({ value: id, label: labels.data?.get(id) ?? t("pickers.yearFallback", { id: id.slice(0, 8) }) }));
  }, [classes, labels.data, t]);
}

// ---------------------------------------------------------------------------
// Confirmation d'une action sensible
// ---------------------------------------------------------------------------

/**
 * Confirmation explicite d'une action sensible. `ackLabel` : case à cocher qui doit être cochée pour activer la confirmation
 * (actions IRRÉVERSIBLES). Le focus est piégé dans la fenêtre (Radix) et rendu au déclencheur à la fermeture.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  ackLabel,
  isPending = false,
  error,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  ackLabel?: string;
  isPending?: boolean;
  error?: unknown;
  children?: ReactNode;
  onConfirm: () => void;
}) {
  const t = useTranslations("v2PrimaryCommon");
  const id = useId();
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (!open) setAck(false);
  }, [open]);
  const disabled = isPending || (ackLabel !== undefined && !ack);
  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="space-y-4">
        {children}
        {ackLabel ? (
          <div className="flex min-h-[2.75rem] items-start gap-3">
            <input id={`${id}-ack`} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <label htmlFor={`${id}-ack`} className="text-sm font-medium leading-snug">
              {ackLabel}
            </label>
          </div>
        ) : null}
        <PrimaryError error={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass.secondary} disabled={isPending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </button>
          <button type="button" className={destructive ? buttonClass.dangerSolid : buttonClass.primary} disabled={disabled} onClick={onConfirm}>
            {isPending ? t("working") : confirmLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
