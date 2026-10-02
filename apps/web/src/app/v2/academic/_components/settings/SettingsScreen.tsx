"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useInstitutions } from "@/platform/v2/lookups";
import { RequirePermission } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { CalendarTab } from "./CalendarTab";
import { EnrollmentPoliciesTab } from "./EnrollmentPoliciesTab";
import { FundingTab } from "./FundingTab";
import { LevelsTab } from "./LevelsTab";
import { NumberingTab } from "./NumberingTab";
import { PeriodsTab } from "./PeriodsTab";
import { SETTINGS_TABS, type SettingsTab } from "./settings-tabs";

/**
 * Paramètres académiques : périodes, niveaux, statuts et financements, politiques d'inscription, numérotation, calendrier.
 * Lecture avec `academic.read`, écriture avec `academic.settings.manage` (les champs deviennent en lecture seule sans elle).
 * Les référentiels sont des upserts par code : aucun bouton « supprimer ». L'API refuse les entrées invalides.
 */
export function SettingsScreen({ initialTab = "periods" }: { initialTab?: SettingsTab }) {
  return (
    <RequirePermission permission="academic.read">
      <SettingsContent initialTab={initialTab} />
    </RequirePermission>
  );
}

function SettingsContent({ initialTab }: { initialTab: SettingsTab }) {
  const t = useTranslations("v2AcademicSettings");
  const manage = usePermission("academic.settings.manage");
  const institutions = useInstitutions();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [chosen, setChosen] = useState("");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const items = institutions.data ?? [];
  const institutionId = chosen || items[0]?.id || null;
  const canManage = manage.allowed;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -index : e.key === "End" ? SETTINGS_TABS.length - 1 - index : 0;
    if (move === 0) return;
    e.preventDefault();
    const next = SETTINGS_TABS[(index + move + SETTINGS_TABS.length) % SETTINGS_TABS.length]!;
    setTab(next);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-4">
        {!manage.isLoading && !canManage ? <Notice kind="info">{t("readOnly")}</Notice> : null}
        {institutions.isError ? <ErrorBlock error={institutions.error} onRetry={() => void institutions.refetch()} /> : null}
        {items.length > 1 ? (
          <FormField label={t("institution")} className="max-w-md">
            {(c) => <NativeSelect {...c} value={institutionId ?? ""} onChange={setChosen} options={items.map((i) => ({ value: i.id, label: i.name }))} />}
          </FormField>
        ) : null}

        <div role="tablist" aria-label={t("tabs.label")} className="flex gap-1 overflow-x-auto border-b">
          {SETTINGS_TABS.map((x, i) => (
            <button
              key={x}
              ref={(el) => {
                refs.current[x] = el;
              }}
              id={`settings-tab-${x}`}
              type="button"
              role="tab"
              aria-selected={tab === x}
              aria-controls={`settings-panel-${x}`}
              tabIndex={tab === x ? 0 : -1}
              onClick={() => setTab(x)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 ${tab === x ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${x}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} tabIndex={0} className="pt-2 focus-visible:outline-none">
          {tab === "periods" ? <PeriodsTab canManage={canManage} /> : null}
          {tab === "levels" ? <LevelsTab canManage={canManage} /> : null}
          {tab === "funding" ? <FundingTab canManage={canManage} /> : null}
          {tab === "enrollments" ? <EnrollmentPoliciesTab institutionId={institutionId} canManage={canManage} /> : null}
          {tab === "numbering" ? <NumberingTab institutionId={institutionId} canManage={canManage} /> : null}
          {tab === "calendar" ? <CalendarTab institutionId={institutionId} canManage={canManage} /> : null}
        </div>
      </div>
    </div>
  );
}
