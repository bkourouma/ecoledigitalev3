"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/platform/api/errors";
import { useFeature } from "@/platform/access";
import { useResolveSyncConflict, useSyncConflicts } from "@/platform/v2/attendance";
import { useDateFormat } from "@/platform/ui/format";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { StudentName } from "./JustificationsScreen";
import { statusTone } from "./call-utils";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Conflits de synchronisation à arbitrer (direction) : pointages saisis hors ligne que l'API n'a PAS appliqués (appel déjà
 * validé, fenêtre de correction dépassée, saisie plus ancienne qu'une autre). Rien n'est écrit sans décision humaine.
 */
export function ConflictsScreen() {
  const t = useTranslations("v2Attendance.conflicts");
  const tStatus = useTranslations("v2Attendance.status");
  const date = useDateFormat();
  const flash = useFlash();
  const feature = useFeature("attendance.offline");
  const [state, setState] = useState<"OPEN" | "RESOLVED">("OPEN");
  const list = useSyncConflicts({ status: state }, feature.allowed);
  const resolve = useResolveSyncConflict();
  const [pending, setPending] = useState<{ id: string; resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING" } | null>(null);
  const label = (code: string | null) => (code === null ? "—" : ["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"].includes(code) ? tStatus(code) : code);

  if (!feature.isLoading && !feature.allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <FeatureNotice>{t("featureOff")}</FeatureNotice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <div className="max-w-xs">
        <FormField label={t("show")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={state}
              onChange={(v) => setState(v as typeof state)}
              options={[
                { value: "OPEN", label: t("stateOpen") },
                { value: "RESOLVED", label: t("stateResolved") },
              ]}
            />
          )}
        </FormField>
      </div>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyBlock title={state === "OPEN" ? t("emptyOpen") : t("emptyResolved")} description={state === "OPEN" ? t("emptyOpenHint") : undefined} />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((c) => {
            const incoming = str(c.incoming.statusCode);
            const existing = c.existing ? str(c.existing.statusCode) : null;
            return (
              <li key={c.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    <StudentName id={c.studentId} />
                  </p>
                  <StatusBadge label={t(`kind.${c.kind}`)} tone="warning" />
                  {c.status === "RESOLVED" ? <StatusBadge label={t(`resolution.${c.resolution ?? "KEEP_EXISTING"}`)} tone="neutral" /> : null}
                </div>
                <p className="text-sm text-muted-foreground">{t(`kindHint.${c.kind}`)}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium">{t("incoming")}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={label(incoming)} tone={incoming ? statusTone(incoming) : "neutral"} />
                      <span className="text-muted-foreground">{t("markedAt", { at: date.instant(c.clientMarkedAt) })}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">{t("existing")}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {c.existing ? (
                        <>
                          <StatusBadge label={label(existing)} tone={existing ? statusTone(existing) : "neutral"} />
                          <span className="text-muted-foreground">{t("markedAt", { at: date.instant(str(c.existing.markedAt)) })}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("noExisting")}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {c.status === "OPEN" ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" className={buttonClass.secondary} onClick={() => setPending({ id: c.id, resolution: "KEEP_EXISTING" })}>
                      {t("keepExisting")}
                    </button>
                    <button type="button" className={buttonClass.primary} onClick={() => setPending({ id: c.id, resolution: "ACCEPT_INCOMING" })}>
                      {t("acceptIncoming")}
                    </button>
                  </div>
                ) : c.resolutionNote ? (
                  <p className="text-sm">{t("note", { note: c.resolutionNote })}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {resolve.error instanceof ApiError && !pending ? <Notice kind="error">{resolve.error.message}</Notice> : null}
      {pending ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setPending(null);
              resolve.reset();
            }
          }}
          title={pending.resolution === "ACCEPT_INCOMING" ? t("acceptTitle") : t("keepTitle")}
          description={pending.resolution === "ACCEPT_INCOMING" ? t("acceptDescription") : t("keepDescription")}
          reasonLabel={t("noteOptional")}
          confirmLabel={pending.resolution === "ACCEPT_INCOMING" ? t("acceptIncoming") : t("keepExisting")}
          reasonRequired={false}
          isPending={resolve.isPending}
          error={resolve.error}
          onConfirm={(note) =>
            resolve.mutate(
              { id: pending.id, resolution: pending.resolution, ...(note ? { note } : {}) },
              {
                onSuccess: () => {
                  setPending(null);
                  flash.show(t("resolved"));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
