"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useClassrooms } from "@/platform/v2/academic";
import { useMyClasses, useStudents } from "@/platform/v2/people";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import type { Tone } from "@/platform/ui/PageHeader";
import { StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock } from "@/platform/ui/states";

/** Élève choisi : l'API dérive l'établissement, l'année et l'élève de l'INSCRIPTION (jamais fournis séparément). */
export interface PickedStudent {
  studentId: string;
  enrollmentId: string;
  name: string;
}

/** Classes que l'utilisateur peut choisir : toutes (lecture académique) ou « mes classes » (enseignant). */
export function useClassChoices(): { options: Array<{ value: string; label: string }>; isLoading: boolean } {
  const canRead = usePermission("academic.classroom.read").allowed;
  const all = useClassrooms({ pageSize: 200 }, { enabled: canRead });
  const mine = useMyClasses(!canRead);
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of mine.data ?? []) map.set(c.classroomId, c.classroomName ?? c.classroomId);
    for (const c of all.data?.items ?? []) map.set(c.id, c.name);
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [all.data, mine.data]);
  return { options, isLoading: all.isFetching || mine.isFetching };
}

/**
 * Classe puis élève (zones tactiles larges, liste native : meilleure saisie sur smartphone). L'inscription vient de la
 * fiche de l'élève ; sans inscription courante l'élève n'est pas proposé (l'API refuserait toute saisie).
 */
export function StudentPicker({ value, onChange, error }: { value: PickedStudent | null; onChange: (next: PickedStudent | null) => void; error?: string | null }) {
  const t = useTranslations("v2Schoollife.picker");
  const classes = useClassChoices();
  const [classroomId, setClassroomId] = useState("");
  const students = useStudents({ classroomId: classroomId || undefined, limit: 200 }, { enabled: classroomId !== "" });
  const choices = (students.data?.items ?? []).filter((s) => s.currentEnrollment !== null);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={t("classroom")} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={classroomId}
            placeholder={t("chooseClassroom")}
            onChange={(next) => {
              setClassroomId(next);
              onChange(null);
            }}
            options={classes.options}
          />
        )}
      </FormField>
      <FormField label={t("student")} required error={error ?? null}>
        {(c) => (
          <NativeSelect
            {...c}
            value={value?.studentId ?? ""}
            placeholder={classroomId ? t("chooseStudent") : t("chooseClassroomFirst")}
            disabled={classroomId === "" || students.isFetching}
            onChange={(id) => {
              const s = choices.find((x) => x.id === id);
              onChange(s && s.currentEnrollment ? { studentId: s.id, enrollmentId: s.currentEnrollment.enrollmentId, name: s.displayName } : null);
            }}
            options={choices.map((s) => ({ value: s.id, label: s.displayName }))}
          />
        )}
      </FormField>
    </div>
  );
}

export function kindTone(kind: string): Tone {
  switch (kind) {
    case "TEMP_EXCLUSION":
      return "danger";
    case "SANCTION":
      return "warning";
    case "ENCOURAGEMENT":
      return "success";
    case "WARNING":
      return "warning";
    default:
      return "neutral";
  }
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "VALIDATED":
    case "NOTIFIED":
    case "EXECUTED":
    case "HELD":
    case "ACKNOWLEDGED":
    case "UPHELD":
    case "APPLIED":
    case "ACTIVE":
    case "CONFIRMED":
      return "success";
    case "PROPOSED":
    case "DECLARED":
    case "UNDER_REVIEW":
    case "DRAFT":
    case "SENT":
    case "AWAITING_HUMAN":
    case "FILED":
    case "APPEALED":
      return "info";
    case "REJECTED":
    case "CANCELLED":
    case "REVOKED":
    case "NO_SHOW":
    case "OVERTURNED":
    case "WITHDRAWN":
    case "DISMISSED":
    case "SKIPPED":
      return "danger";
    default:
      return "neutral";
  }
}

/** Libellé traduit d'un statut (`v2Schoollife.status.<STATUT>`), sinon le code brut. */
export function StatusLabel({ status }: { status: string }) {
  const t = useTranslations("v2Schoollife.status");
  return <StatusBadge label={t.has(status) ? t(status) : status} tone={statusTone(status)} />;
}

export function KindLabel({ kind }: { kind: string }) {
  const t = useTranslations("v2Schoollife.kind");
  return <StatusBadge label={t.has(kind) ? t(kind) : kind} tone={kindTone(kind)} />;
}

/** Date et heure locales de l'établissement, depuis un instant ISO. */
export function useDateTime() {
  const format = useFormatter();
  return {
    dateTime: (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—"),
    date: (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso), { dateStyle: "medium" }) : "—"),
  };
}

export function Loading() {
  return <LoadingBlock />;
}

/** `datetime-local` -> instant ISO (le navigateur donne l'heure locale ; l'API stocke un instant). */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}

export function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function todayInput(): string {
  return nowLocalInput().slice(0, 10);
}
