"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MessagingTarget, MessagingTargetKind } from "@ecoledigitale/contracts/v2/messaging";
import { usePermission } from "@/platform/access";
import { useCampuses } from "@/platform/admin/tenancy/hooks";
import { useRoles } from "@/platform/admin/roles/hooks";
import { useReference } from "@/platform/v2/academic";
import { useClassroomOptions, useInstitutions } from "@/platform/v2/lookups";
import { useMyAudience } from "@/platform/v2/messaging";
import { FormField } from "@/platform/ui/FormField";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { buttonClass } from "@/platform/ui/PageHeader";

export interface TargetItem extends MessagingTarget {
  label: string;
}

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
/** Rôles du tenant : requête faite seulement quand la cible « rôle » est choisie (droit de lecture des rôles requis). */
function RoleOptions() {
  const roles = useRoles();
  return <>{(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</>;
}

const useActiveClassrooms = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { status: "ACTIVE" });

/**
 * Ciblage d'une annonce : établissement, établissement scolaire, campus, niveau, classe, rôle. Un enseignant (droit
 * « publier vers ses classes ») ne voit que ses classes ; l'API refuse de toute façon une cible hors de ses droits.
 */
export function TargetsEditor({ value, onChange, error }: { value: ReadonlyArray<TargetItem>; onChange: (next: TargetItem[]) => void; error?: string | undefined }) {
  const t = useTranslations("v2MessagingAnnouncements");
  const canPublish = usePermission("messaging.announcement.publish").allowed;
  const canManage = usePermission("messaging.announcement.manage").allowed;
  const wide = canPublish || canManage;
  const audience = useMyAudience();
  const kinds: MessagingTargetKind[] = wide ? ["TENANT", "INSTITUTION", "CAMPUS", "LEVEL", "CLASSROOM", "ROLE"] : ["CLASSROOM"];
  const [kind, setKind] = useState<MessagingTargetKind>(kinds[0]!);
  const [institutionId, setInstitutionId] = useState("");
  const [pick, setPick] = useState("");
  const [classPick, setClassPick] = useState<SelectOption | null>(null);
  const institutions = useInstitutions();
  const campuses = useCampuses(kind === "CAMPUS" && institutionId ? institutionId : null);
  const levels = useReference("grade-levels", { enabled: kind === "LEVEL" });

  function add() {
    let item: TargetItem | null = null;
    if (kind === "TENANT") item = { kind, label: t("targets.TENANT") };
    else if (kind === "INSTITUTION") {
      const i = institutions.data?.find((x) => x.id === pick);
      if (i) item = { kind, ref: i.id, label: i.name };
    } else if (kind === "CAMPUS") {
      const c = campuses.data?.find((x) => x.id === pick);
      if (c) item = { kind, ref: c.id, label: c.name };
    } else if (kind === "LEVEL") {
      const l = levels.data?.find((x) => x.id === pick);
      if (l) item = { kind, ref: l.id, label: l.label };
    } else if (kind === "ROLE") {
      if (pick) item = { kind, ref: pick, label: pick };
    } else if (kind === "CLASSROOM" && classPick) item = { kind, ref: classPick.value, label: classPick.label };
    if (!item) return;
    const key = `${item.kind}:${item.ref ?? ""}`;
    if (!value.some((v) => `${v.kind}:${v.ref ?? ""}` === key)) onChange([...value, item]);
    setPick("");
    setClassPick(null);
  }

  const staffClasses = audience.data?.classrooms ?? [];

  return (
    <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">{t("editor.targets")}</legend>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("editor.chosenTargets")}>
          {value.map((v) => (
            <li key={`${v.kind}:${v.ref ?? ""}`} className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">{t(`targets.${v.kind}`)} · </span>
                {v.label}
              </span>
              <button type="button" aria-label={t("editor.removeTarget", { name: v.label })} className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(value.filter((x) => !(x.kind === v.kind && x.ref === v.ref)))}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("editor.noTarget")}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <FormField label={t("editor.targetKind")}>
          {(c) => (
            <select {...c} value={kind} onChange={(e) => { setKind(e.target.value as MessagingTargetKind); setPick(""); setClassPick(null); }} className={selectClass}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`targets.${k}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {kind === "TENANT" ? (
          <p className="pb-2 text-sm text-muted-foreground">{t("editor.tenantHint")}</p>
        ) : kind === "CLASSROOM" ? (
          <FormField label={t("targets.CLASSROOM")}>
            {(c) =>
              wide ? (
                <SelectAsync {...c} value={classPick} onChange={setClassPick} useOptions={useActiveClassrooms} placeholder={t("editor.choose")} />
              ) : (
                <select {...c} value={classPick?.value ?? ""} onChange={(e) => { const cl = staffClasses.find((x) => x.id === e.target.value); setClassPick(cl ? { value: cl.id, label: cl.name } : null); }} className={selectClass}>
                  <option value="">{t("editor.choose")}</option>
                  {staffClasses.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.name}
                    </option>
                  ))}
                </select>
              )
            }
          </FormField>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {kind === "CAMPUS" ? (
              <FormField label={t("targets.INSTITUTION")}>
                {(c) => (
                  <select {...c} value={institutionId} onChange={(e) => { setInstitutionId(e.target.value); setPick(""); }} className={selectClass}>
                    <option value="">{t("editor.choose")}</option>
                    {(institutions.data ?? []).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            ) : null}
            <FormField label={t(`targets.${kind}`)}>
              {(c) => (
                <select {...c} value={pick} onChange={(e) => setPick(e.target.value)} className={selectClass}>
                  <option value="">{t("editor.choose")}</option>
                  {kind === "INSTITUTION" ? (institutions.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>) : null}
                  {kind === "CAMPUS" ? (campuses.data ?? []).map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>) : null}
                  {kind === "LEVEL" ? (levels.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.label}</option>) : null}
                  {kind === "ROLE" ? <RoleOptions /> : null}
                </select>
              )}
            </FormField>
          </div>
        )}
        <button type="button" className={buttonClass.secondary} onClick={add}>
          {t("editor.addTarget")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
