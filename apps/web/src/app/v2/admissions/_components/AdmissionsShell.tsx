"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AdmissionsCampaignDto } from "@ecoledigitale/contracts/v2/admissions";
import { useCampaigns } from "@/platform/v2/admissions";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { SectionNav } from "@/platform/ui/SectionNav";
import { buttonClass } from "@/platform/ui/PageHeader";
import { VIEW_PERMISSIONS } from "./admissions-utils";

/** Navigation de la section admissions (onglets défilants sur mobile) : chaque entrée suit la permission de son écran. */
export function AdmissionsNav() {
  const t = useTranslations("v2Admissions.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/admissions", label: t("pipeline"), anyPermission: VIEW_PERMISSIONS, exact: true },
        { href: "/v2/admissions/applications", label: t("applications"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/admissions/waitlist", label: t("waitlist"), permission: "admission.waitlist.manage" },
        { href: "/v2/admissions/prospects", label: t("prospects"), permission: "admission.prospect.manage" },
        { href: "/v2/admissions/campaigns", label: t("campaigns"), anyPermission: ["admission.campaign.manage", "admission.read"] },
        { href: "/v2/admissions/reports", label: t("reports"), permission: "admission.report.read" },
        { href: "/v2/admissions/settings", label: t("settings"), permission: "admission.settings.manage", exact: true },
        { href: "/v2/admissions/settings/workflow", label: t("workflow"), permission: "admission.workflow.manage" },
      ]}
    />
  );
}

export function AdmissionsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <AdmissionsNav />
      {children}
    </div>
  );
}

/**
 * Campagne de travail : l'écran choisit par défaut la campagne OUVERTE la plus récente (sinon la première de la liste). Le choix
 * reste local à l'écran ; aucune règle d'admission n'est calculée ici.
 */
export function useSelectedCampaign() {
  const campaigns = useCampaigns();
  const [chosen, setChosen] = useState<string | null>(null);
  const items: AdmissionsCampaignDto[] = campaigns.data?.items ?? [];
  const fallback = items.find((c) => c.status === "OPEN") ?? items[0] ?? null;
  const selected = items.find((c) => c.id === chosen) ?? fallback;
  return { query: campaigns, campaigns: items, selected, campaignId: selected?.id ?? null, select: setChosen };
}

export function CampaignPicker({ campaigns, value, onChange, className }: { campaigns: ReadonlyArray<AdmissionsCampaignDto>; value: string | null; onChange: (id: string) => void; className?: string }) {
  const t = useTranslations("v2Admissions.common");
  return (
    <FormField label={t("campaign")} className={className}>
      {(c) => <NativeSelect {...c} value={value ?? ""} onChange={onChange} options={campaigns.map((x) => ({ value: x.id, label: `${x.label} (${x.code})` }))} />}
    </FormField>
  );
}

/** Lien ou secret à copier : champ en lecture seule + bouton « Copier » (échec silencieux : la valeur reste sélectionnable). */
export function CopyableValue({ label, value }: { label: string; value: string }) {
  const t = useTranslations("v2Admissions.common");
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <FormField label={label}>
        {(c) => <input {...c} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs" />}
      </FormField>
      <button
        type="button"
        className={buttonClass.secondary}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {t("copy")}
      </button>
      <span role="status" className="ml-2 text-xs text-muted-foreground">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}
