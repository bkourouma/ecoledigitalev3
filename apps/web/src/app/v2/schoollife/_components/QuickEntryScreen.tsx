"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Can } from "@/platform/ui/AccessGate";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { Notice, useFlash } from "@/platform/ui/states";
import { IncidentFormDialog, NoteFormDialog } from "./forms";

type Entry = "incident" | "ENCOURAGEMENT" | "OBSERVATION";

/**
 * Saisie rapide (mobile d'abord) : un incident, un encouragement ou une observation en trois gestes — classe, élève, texte. Les
 * retards et absences ne se saisissent PAS ici : ils appartiennent à l'appel (Présences) ; la fiche de l'élève les affiche en
 * lecture seule. L'élève est dérivé de l'inscription par l'API ; le déclarant est l'utilisateur connecté.
 */
export function QuickEntryScreen() {
  const t = useTranslations("v2Schoollife.quick");
  const flash = useFlash();
  const [open, setOpen] = useState<Entry | null>(null);
  const done = (key: string) => () => flash.show(t(`saved.${key}`));
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <ul className="grid gap-3 sm:grid-cols-3" aria-label={t("choices")}>
        <Can permission="schoollife.incident.write">
          <li>
            <button type="button" className={`${buttonClass.primary} h-auto w-full flex-col items-start gap-1 py-4 text-left`} onClick={() => setOpen("incident")}>
              <span className="text-base">{t("incident.title")}</span>
              <span className="text-xs font-normal opacity-90">{t("incident.hint")}</span>
            </button>
          </li>
        </Can>
        <Can permission="schoollife.note.write">
          <li>
            <button type="button" className={`${buttonClass.secondary} h-auto w-full flex-col items-start gap-1 py-4 text-left`} onClick={() => setOpen("ENCOURAGEMENT")}>
              <span className="text-base">{t("encouragement.title")}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("encouragement.hint")}</span>
            </button>
          </li>
          <li>
            <button type="button" className={`${buttonClass.secondary} h-auto w-full flex-col items-start gap-1 py-4 text-left`} onClick={() => setOpen("OBSERVATION")}>
              <span className="text-base">{t("observation.title")}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("observation.hint")}</span>
            </button>
          </li>
        </Can>
      </ul>
      <Notice kind="info">
        {t("attendanceHint")}{" "}
        <Can permission="attendance.take">
          <Link href="/v2/attendance/call" className="font-medium underline underline-offset-4">
            {t("attendanceLink")}
          </Link>
        </Can>
      </Notice>
      <IncidentFormDialog open={open === "incident"} onOpenChange={(o) => setOpen(o ? "incident" : null)} onDone={done("incident")} />
      <NoteFormDialog open={open === "ENCOURAGEMENT"} onOpenChange={(o) => setOpen(o ? "ENCOURAGEMENT" : null)} kind="ENCOURAGEMENT" onDone={done("encouragement")} />
      <NoteFormDialog open={open === "OBSERVATION"} onOpenChange={(o) => setOpen(o ? "OBSERVATION" : null)} kind="OBSERVATION" onDone={done("observation")} />
    </div>
  );
}
