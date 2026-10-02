"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SchedulingConflictViewDto } from "@ecoledigitale/contracts/v2/scheduling";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory, useRoomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { usePendingReplacements, type OccurrenceDto } from "@/platform/v2/scheduling";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { ConflictList, OccurrenceCard } from "./OccurrenceCard";
import { SubstituteDialog } from "./OccurrenceDialogs";

/** Séances à remplacer (absence approuvée, fin d'affectation…) avec propositions de remplaçants classées par l'API. */
export function ReplacementsScreen() {
  const t = useTranslations("v2Schedule.replacements");
  const flash = useFlash();
  const today = todayCivil();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const q = usePendingReplacements({ from, to });
  const dirs = { classrooms: useClassroomDirectory(), staff: useStaffDirectory(), rooms: useRoomDirectory() };
  const [target, setTarget] = useState<OccurrenceDto | null>(null);
  const [warnings, setWarnings] = useState<SchedulingConflictViewDto[]>([]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      {warnings.length > 0 ? <ConflictList conflicts={warnings} title={t("warningsTitle")} /> : null}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.items.map((o) => (
            <li key={o.id} className="space-y-1">
              <p className="text-sm font-semibold">{o.occursOn}</p>
              <OccurrenceCard
                o={o}
                dirs={dirs}
                actions={
                  <>
                    {o.replacementReason ? <p className="w-full text-xs text-muted-foreground">{t("reason", { reason: o.replacementReason })}</p> : null}
                    <button type="button" className={buttonClass.primary} onClick={() => setTarget(o)}>
                      {t("replace")}
                    </button>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {target ? (
        <SubstituteDialog
          o={target}
          staffName={(id) => dirs.staff.name(id)}
          onClose={() => setTarget(null)}
          onDone={(message, w) => {
            flash.show(message);
            setWarnings(w);
          }}
        />
      ) : null}
    </div>
  );
}
