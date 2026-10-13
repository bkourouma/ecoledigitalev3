"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CouncilsFamilyDecisionsDto } from "@ecoledigitale/contracts/v2/councils";
import { useChildDecisions, useMyDecisions } from "@/platform/v2/councils";
import { useMyChildren } from "@/platform/v2/schoollife";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock } from "@/platform/ui/states";
import { FamilyOrientation } from "./FamilyOrientation";
import { CouncilsBoundary, EnumLabel, useDateTime } from "./shared";

/**
 * Portail FAMILLE (tuteur) ou ÉLÈVE : la décision, la cible éventuelle, l'appréciation générale et les distinctions selon le
 * réglage de visibilité de l'établissement. Jamais la suggestion de la règle, le vote ni la justification interne : l'API
 * ne les renvoie pas et ce portail n'a aucun champ pour les afficher. Hors lien tuteur / enfant : « introuvable ».
 */
export function PortalScreen({ mode }: { mode: "guardian" | "student" }) {
  const t = useTranslations("v2Councils.portal");
  const children = useMyChildren(mode === "guardian");
  const [childId, setChildId] = useState("");
  const selected = mode === "guardian" ? childId || children.data?.[0]?.studentId || null : null;
  const childQuery = useChildDecisions(selected);
  const myQuery = useMyDecisions(mode === "student");
  const q = mode === "guardian" ? childQuery : myQuery;
  const data = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title={mode === "guardian" ? t("titleGuardian") : t("titleStudent")} description={mode === "guardian" ? t("descriptionGuardian") : t("descriptionStudent")} />
      {mode === "guardian" && (children.data ?? []).length > 1 ? (
        <FormField label={t("child")}>
          {(c) => <NativeSelect {...c} value={selected ?? ""} onChange={setChildId} options={(children.data ?? []).map((x) => ({ value: x.studentId, label: x.studentName ?? "—" }))} className="max-w-sm" />}
        </FormField>
      ) : null}
      {mode === "guardian" && children.isSuccess && (children.data ?? []).length === 0 ? <EmptyBlock title={t("noChild")} description={t("noChildHint")} /> : null}
      {mode === "student" || selected ? (
        <CouncilsBoundary query={q} isEmpty={(data?.items ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
          {data ? <Decisions data={data} /> : null}
        </CouncilsBoundary>
      ) : null}
      {mode === "student" || selected ? <FamilyOrientation mode={mode} studentId={selected} /> : null}
    </div>
  );
}

function Decisions({ data }: { data: CouncilsFamilyDecisionsDto }) {
  const t = useTranslations("v2Councils.portal");
  const dt = useDateTime();
  return (
    <div className="space-y-4">
      {data.studentName ? <p className="text-sm text-muted-foreground">{t("about", { name: data.studentName })}</p> : null}
      <ul className="space-y-3" aria-label={t("listLabel")}>
        {data.items.map((i, idx) => (
          <li key={`${i.councilId}-${idx}`} className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{i.decisionTypeLabel}</h2>
              <EnumLabel group="decisionFamily" value={i.family} />
            </div>
            <p className="text-sm text-muted-foreground">
              {i.councilTypeLabel}
              {i.periodLabel ? ` · ${i.periodLabel}` : ""}
              {i.heldOn ? ` · ${dt.date(i.heldOn)}` : ""}
            </p>
            {i.targetLabel ? (
              <p className="text-sm">
                <span className="font-medium">{t("target")} : </span>
                {i.targetLabel}
              </p>
            ) : null}
            {i.appreciation ? (
              <p className="text-sm">
                <span className="font-medium">{t("appreciation")} : </span>
                {i.appreciation}
              </p>
            ) : null}
            {i.distinctions.length > 0 ? (
              <ul className="flex flex-wrap gap-1" aria-label={t("distinctions")}>
                {i.distinctions.map((d) => (
                  <li key={d}>
                    <StatusBadge label={d} tone="success" />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
