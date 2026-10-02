"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomOptions, useStaffOptions, useStudentOptions } from "@/platform/v2/lookups";
import { useMyChildren } from "@/platform/v2/people";
import { fetchIcsDownload, useCreateIcsToken, useIcsTokens, useMyTimetable, useRevokeIcsToken, useRooms, type IcsTokenDto } from "@/platform/v2/scheduling";
import { ApiError } from "@/platform/api/errors";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { downloadTextFile } from "@/platform/ui/download";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice, useFlash } from "@/platform/ui/states";

type Scope = "CLASSROOM" | "STAFF" | "STUDENT" | "ROOM";
type Source = "mine" | "children" | "classroom" | "staff" | "student" | "room";

const useStaffPick = (search: string, enabled: boolean) => useStaffOptions(search, enabled, {});

/**
 * Export iCalendar : téléchargement ponctuel, ou abonnement par JETON RÉVOCABLE (secret, limité à UN sujet et en lecture
 * seule). Le lien d'abonnement n'est montré qu'à sa création : il n'est pas relisible ensuite, on le révoque et on en crée un autre.
 */
export function ExportScreen() {
  const t = useTranslations("v2Schedule.export");
  const date = useDateFormat();
  const flash = useFlash();
  const ownStaff = usePermission("schedule.own.read").allowed;
  const ownStudent = usePermission("schedule.self.read").allowed;
  const own = ownStaff || ownStudent;
  const child = usePermission("schedule.child.read").allowed;
  const all = usePermission("schedule.read").allowed;
  const sources = useMemo<Source[]>(() => [...(own ? (["mine"] as const) : []), ...(child ? (["children"] as const) : []), ...(all ? (["classroom", "staff", "student", "room"] as const) : [])], [own, child, all]);
  const [picked, setPicked] = useState<Source | null>(null);
  const source: Source | null = picked && sources.includes(picked) ? picked : (sources[0] ?? null);
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [student, setStudent] = useState<SelectOption | null>(null);
  const [roomId, setRoomId] = useState("");
  const [childId, setChildId] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [revoking, setRevoking] = useState<IcsTokenDto | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const today = todayCivil();
  const mine = useMyTimetable({ from: today, to: today }, source === "mine");
  const rooms = useRooms({}, source === "room");
  const children = useMyChildren(source === "children");
  const subject = ((): { scope: Scope; id: string } | null => {
    if (source === "mine") return mine.data ? { scope: mine.data.subject === "STAFF" ? "STAFF" : "STUDENT", id: mine.data.subjectId } : null;
    if (source === "children") return childId ? { scope: "STUDENT", id: childId } : null;
    if (source === "classroom") return classroom ? { scope: "CLASSROOM", id: classroom.value } : null;
    if (source === "staff") return person ? { scope: "STAFF", id: person.value } : null;
    if (source === "student") return student ? { scope: "STUDENT", id: student.value } : null;
    if (source === "room") return roomId ? { scope: "ROOM", id: roomId } : null;
    return null;
  })();
  const tokens = useIcsTokens(subject?.scope ?? "STAFF", subject?.id ?? null);
  const createToken = useCreateIcsToken();
  const revoke = useRevokeIcsToken();

  async function download() {
    if (!subject) return;
    setDownloadError(null);
    try {
      const ics = await fetchIcsDownload({ scope: subject.scope, subjectId: subject.id, from: today, to: addDays(today, 120) });
      downloadTextFile("emploi-du-temps.ics", ics, "text/calendar");
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : t("downloadFailed"));
    }
  }

  function create() {
    if (!subject) return;
    const expires = days.trim() ? Number(days) : undefined;
    createToken.mutate(
      { scope: subject.scope, subjectId: subject.id, ...(label.trim() ? { label: label.trim() } : {}), ...(expires ? { expiresInDays: expires } : {}) },
      {
        onSuccess: (r) => {
          setCreated({ url: `${window.location.origin}${r.path}` });
          setCopyState("idle");
          setLabel("");
          setDays("");
        },
      },
    );
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const columns: DataTableColumn<IcsTokenDto>[] = [
    { id: "label", header: t("columns.label"), rowHeader: true, cell: (k) => k.label ?? t("noLabel") },
    { id: "created", header: t("columns.created"), cell: (k) => date.instant(k.createdAt), className: "hidden sm:table-cell" },
    { id: "expires", header: t("columns.expires"), cell: (k) => (k.expiresAt ? date.instant(k.expiresAt) : t("never")), className: "hidden md:table-cell" },
    { id: "used", header: t("columns.lastUsed"), cell: (k) => (k.lastUsedAt ? date.instant(k.lastUsedAt) : t("neverUsed")), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (k) => (k.revokedAt ? <StatusBadge label={t("revoked")} tone="neutral" /> : <StatusBadge label={t("active")} tone="success" />) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (k) =>
        k.revokedAt ? null : (
          <button type="button" className={buttonClass.ghost} onClick={() => setRevoking(k)}>
            {t("revoke")}
          </button>
        ),
    },
  ];

  if (sources.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <Notice kind="info">{t("noAccess")}</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <div role="search" aria-label={t("subject")} className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("source")}>{(c) => <NativeSelect {...c} value={source ?? ""} onChange={(v) => setPicked(v as Source)} options={sources.map((s) => ({ value: s, label: t(`sources.${s}`) }))} />}</FormField>
        {source === "classroom" ? <FormField label={t("sources.classroom")}>{(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassroomOptions} ariaLabel={t("sources.classroom")} placeholder={t("choose")} />}</FormField> : null}
        {source === "staff" ? <FormField label={t("sources.staff")}>{(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={useStaffPick} ariaLabel={t("sources.staff")} placeholder={t("choose")} />}</FormField> : null}
        {source === "student" ? <FormField label={t("sources.student")}>{(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} ariaLabel={t("sources.student")} placeholder={t("choose")} />}</FormField> : null}
        {source === "room" ? <FormField label={t("sources.room")}>{(c) => <NativeSelect {...c} value={roomId} onChange={setRoomId} placeholder={t("choose")} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}</FormField> : null}
        {source === "children" ? <FormField label={t("sources.children")}>{(c) => <NativeSelect {...c} value={childId} onChange={setChildId} placeholder={t("choose")} options={(children.data ?? []).map((k) => ({ value: k.id, label: k.displayName }))} />}</FormField> : null}
      </div>

      {!subject ? (
        <Notice kind="info">{t("chooseSubject")}</Notice>
      ) : (
        <>
          <section aria-labelledby="dl-title" className="space-y-2 rounded-lg border p-4">
            <h2 id="dl-title" className="text-lg font-semibold">
              {t("downloadTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("downloadHint")}</p>
            <button type="button" className={buttonClass.secondary} onClick={() => void download()}>
              {t("download")}
            </button>
            {downloadError ? <Notice kind="error">{downloadError}</Notice> : null}
          </section>

          <section aria-labelledby="sub-title" className="space-y-3 rounded-lg border p-4">
            <h2 id="sub-title" className="text-lg font-semibold">
              {t("subscribeTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("subscribeHint")}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <FormField label={t("tokenLabel")}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} placeholder={t("tokenLabelPlaceholder")} />}</FormField>
              <FormField label={t("expiresInDays")} hint={t("expiresHint")}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} max={3650} value={days} onChange={setDays} />}</FormField>
              <button type="button" className={buttonClass.primary} disabled={createToken.isPending} onClick={create}>
                {t("createToken")}
              </button>
            </div>
            {createToken.error ? <Notice kind="error">{createToken.error.message}</Notice> : null}
            {created ? (
              <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950" role="status">
                <p className="font-medium">{t("createdTitle")}</p>
                <label className="block text-xs" htmlFor="ics-url">
                  {t("createdLabel")}
                </label>
                <input id="ics-url" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-md border bg-background px-2 font-mono text-xs" />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={buttonClass.secondary} onClick={() => void copy(created.url)}>
                    {t("copy")}
                  </button>
                  {copyState === "copied" ? <span>{t("copied")}</span> : null}
                  {copyState === "failed" ? <span className="text-destructive">{t("copyFailed")}</span> : null}
                </div>
                <p className="text-xs">{t("createdWarning")}</p>
              </div>
            ) : null}
            <DataTable caption={t("tokensCaption")} columns={columns} rows={tokens.data ?? []} getRowId={(k) => k.id} isLoading={tokens.isFetching} error={tokens.error} onRetry={() => void tokens.refetch()} emptyTitle={t("noTokens")} />
          </section>
        </>
      )}

      {revoking ? (
        <ModalDialog open onOpenChange={(o) => !o && setRevoking(null)} title={t("revokeTitle")} description={t("revokeDescription")}>
          <div className="space-y-4">
            {revoke.error ? <Notice kind="error">{revoke.error.message}</Notice> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonClass.secondary} onClick={() => setRevoking(null)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className={buttonClass.danger}
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(
                    { id: revoking.id },
                    {
                      onSuccess: () => {
                        setRevoking(null);
                        flash.show(t("revokedDone"));
                      },
                    },
                  )
                }
              >
                {t("revoke")}
              </button>
            </div>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
