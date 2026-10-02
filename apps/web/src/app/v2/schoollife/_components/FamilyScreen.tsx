"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SchoolLifeFamilyItemDto } from "@ecoledigitale/contracts/v2/schoollife";
import { useChildLife, useConvocationAction, useFileAppeal, useMyChildren, useMyLife } from "@/platform/v2/schoollife";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { StatusLabel, useDateTime } from "./shared";

/**
 * Vue FAMILLE (tuteur) ou ÉLÈVE : uniquement ce que la règle de visibilité de l'API leur ouvre — une mesure NOTIFIÉE et
 * partageable, les notes partagées, les convocations envoyées ; jamais un incident, un élément confidentiel ni une
 * validation interne. Le lien tuteur / enfant est revérifié par l'API à chaque lecture (hors lien : introuvable).
 */
export function FamilyScreen({ mode }: { mode: "guardian" | "student" }) {
  const t = useTranslations("v2Schoollife.family");
  const children = useMyChildren(mode === "guardian");
  const [childId, setChildId] = useState("");
  const selected = mode === "guardian" ? childId || children.data?.[0]?.studentId || null : null;
  const childLife = useChildLife(selected);
  const myLife = useMyLife(mode === "student");
  const q = mode === "guardian" ? childLife : myLife;
  const life = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title={mode === "guardian" ? t("titleGuardian") : t("titleStudent")} description={mode === "guardian" ? t("descriptionGuardian") : t("descriptionStudent")} />
      {mode === "guardian" && (children.data ?? []).length > 1 ? (
        <FormField label={t("child")}>
          {(c) => <NativeSelect {...c} value={selected ?? ""} onChange={setChildId} options={(children.data ?? []).map((x) => ({ value: x.studentId, label: x.studentName ?? "—" }))} className="max-w-sm" />}
        </FormField>
      ) : null}
      {mode === "guardian" && children.isSuccess && (children.data ?? []).length === 0 ? <EmptyBlock title={t("noChild")} description={t("noChildHint")} /> : null}
      {(mode === "student" || selected) ? (
        <QueryBoundary query={q} isEmpty={(life?.items ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
          {life ? <Items mode={mode} studentName={life.studentName} items={life.items} /> : null}
        </QueryBoundary>
      ) : null}
    </div>
  );
}

function Items({ mode, studentName, items }: { mode: "guardian" | "student"; studentName: string | null; items: readonly SchoolLifeFamilyItemDto[] }) {
  const t = useTranslations("v2Schoollife.family");
  const dt = useDateTime();
  const flash = useFlash();
  const appeal = useFileAppeal();
  const ack = useConvocationAction("acknowledge");
  const [appealing, setAppealing] = useState<SchoolLifeFamilyItemDto | null>(null);
  const groups: Array<{ key: "MEASURE" | "CONVOCATION" | "NOTE"; items: SchoolLifeFamilyItemDto[] }> = [
    { key: "CONVOCATION", items: items.filter((i) => i.entityKind === "CONVOCATION") },
    { key: "MEASURE", items: items.filter((i) => i.entityKind === "MEASURE") },
    { key: "NOTE", items: items.filter((i) => i.entityKind === "NOTE") },
  ];
  return (
    <div className="space-y-6">
      {studentName ? <p className="text-sm text-muted-foreground">{t("about", { name: studentName })}</p> : null}
      {flash.node}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.key} aria-labelledby={`fam-${g.key}`} className="space-y-2">
            <h2 id={`fam-${g.key}`} className="text-lg font-semibold">
              {t(`groups.${g.key}`)}
            </h2>
            <ul className="divide-y rounded-lg border">
              {g.items.map((i) => (
                <li key={i.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.title}</span>
                    <StatusLabel status={i.status} />
                    {i.appealStatus ? <StatusBadge label={t("appealStatus", { status: t(`appealStatuses.${i.appealStatus}`) })} tone="info" /> : null}
                  </div>
                  {i.text ? <p className="text-sm">{i.text}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {i.startsOn && i.endsOn ? t("period", { from: dt.date(i.startsOn), to: dt.date(i.endsOn) }) : i.scheduledAt ? dt.dateTime(i.scheduledAt) : i.occurredOn ? dt.date(i.occurredOn) : ""}
                    {i.location ? ` · ${i.location}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {i.canAcknowledge ? (
                      <Can permission="schoollife.child.acknowledge">
                        <button type="button" className={buttonClass.primary} disabled={ack.isPending} onClick={() => ack.mutate({ id: i.id }, { onSuccess: () => flash.show(t("acknowledged")) })}>
                          {t("acknowledge")}
                        </button>
                      </Can>
                    ) : null}
                    {i.appealable ? (
                      <Can permission={mode === "guardian" ? "schoollife.child.appeal" : "schoollife.self.appeal"}>
                        <button type="button" className={buttonClass.secondary} onClick={() => setAppealing(i)}>
                          {t("appeal")}
                        </button>
                      </Can>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {ack.error ? <Notice kind="error">{(ack.error as Error).message}</Notice> : null}
      {appealing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setAppealing(null)}
          title={t("appealDialog.title")}
          description={t("appealDialog.description")}
          reasonLabel={t("appealDialog.label")}
          confirmLabel={t("appealDialog.confirm")}
          minLength={10}
          maxLength={2000}
          isPending={appeal.isPending}
          error={appeal.error}
          onConfirm={(reason) => appeal.mutate({ measureId: appealing.id, reason }, { onSuccess: () => { flash.show(t("appealed")); setAppealing(null); } })}
        />
      ) : null}
    </div>
  );
}
