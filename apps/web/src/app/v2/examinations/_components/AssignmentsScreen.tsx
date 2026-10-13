"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExamAssignmentDto, ExamAssignmentsOverviewDto, ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, CheckControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useAssignCandidate, useAssignments, useAutoAssign, useSetSessionCenters, useUnassignCandidate } from "@/platform/v2/examinations";
import { SessionScope } from "./shared";

function MoveDialog({ overview, assignment, onClose }: { overview: ExamAssignmentsOverviewDto; assignment: ExamAssignmentDto | null; onClose: () => void }) {
  const t = useTranslations("v2Examinations.assignments.move");
  const assign = useAssignCandidate();
  const [roomId, setRoomId] = useState("");
  const [seat, setSeat] = useState("");
  useEffect(() => {
    setRoomId(assignment?.roomId ?? "");
    setSeat("");
  }, [assignment]);
  const room = overview.rooms.find((r) => r.roomId === roomId);
  async function submit() {
    if (!assignment || !room) return;
    try {
      await assign.mutateAsync({ candidateId: assignment.candidateId, centerId: room.centerId, roomId: room.roomId, ...(seat.trim() ? { seatNumber: Number(seat) } : {}) });
      onClose();
    } catch {
      /* erreur affichée dans la fenêtre */
    }
  }
  return (
    <FormDialog open={assignment !== null} onOpenChange={(o) => !o && onClose()} title={t("title", { name: assignment?.displayName ?? assignment?.candidateNumber ?? "" })} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={assign.isPending} error={assign.error}>
      <div className="space-y-3">
        <FormField label={t("room")} required>
          {(c) => <NativeSelect {...c} value={roomId} placeholder={t("choose")} options={overview.rooms.filter((r) => r.active).map((r) => ({ value: r.roomId, label: `${r.centerName} — ${r.code} (${r.used}/${r.capacity})` }))} onChange={setRoomId} />}
        </FormField>
        <FormField label={t("seat")} hint={t("seatHint")}>{(c) => <TextControl {...c} type="number" min={1} value={seat} onChange={setSeat} />}</FormField>
      </div>
    </FormDialog>
  );
}

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.assignments");
  const query = useAssignments(session.id);
  const setCenters = useSetSessionCenters(session.id);
  const auto = useAutoAssign(session.id);
  const unassign = useUnassignCandidate();
  const flash = useFlash();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [reassign, setReassign] = useState(false);
  const [moving, setMoving] = useState<ExamAssignmentDto | null>(null);

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const o = query.data;
  const selected = chosen ?? o.centerIds;
  const toggle = (id: string) => setChosen(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  async function saveCenters() {
    flash.show(null);
    try {
      await setCenters.mutateAsync({ centerIds: selected });
      setChosen(null);
      flash.show(t("centersSaved"));
    } catch {
      /* erreur affichée */
    }
  }
  async function runAuto() {
    flash.show(null);
    try {
      const out = await auto.mutateAsync({ reassign });
      flash.show(t("autoDone", { assigned: out.assigned, already: out.alreadyAssigned }));
    } catch {
      /* erreur affichée */
    }
  }

  const columns: DataTableColumn<ExamAssignmentDto>[] = [
    { id: "number", header: t("columns.number"), rowHeader: true, cell: (a) => a.candidateNumber ?? "—" },
    { id: "name", header: t("columns.name"), cell: (a) => a.displayName ?? "—" },
    { id: "center", header: t("columns.center"), cell: (a) => a.centerName, className: "hidden sm:table-cell" },
    { id: "room", header: t("columns.room"), cell: (a) => a.roomCode },
    { id: "seat", header: t("columns.seat"), cell: (a) => a.seatNumber, align: "right" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (a) => (
        <Can permission="exam.center.manage">
          <span className="flex justify-end gap-1">
            <button type="button" className={buttonClass.ghost} disabled={o.frozen} onClick={() => setMoving(a)}>{t("move.open")}</button>
            <button type="button" className={buttonClass.ghost} disabled={o.frozen || unassign.isPending} onClick={() => unassign.mutate(a.candidateId)}>{t("unassign")}</button>
          </span>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {flash.node}
      {o.frozen ? <Notice kind="info">{t("frozen")}</Notice> : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t("summary")}>
        {(
          [
            ["registered", o.registered],
            ["unassigned", o.unassigned],
            ["capacity", o.capacity],
            ["assigned", o.assignments.length],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><dt className="text-xs text-muted-foreground">{t(`summaryItem.${k}` as never)}</dt><dd className="text-xl font-semibold" data-testid={`assign-${k}`}>{v}</dd></div>
        ))}
      </dl>
      {o.unassigned > 0 && o.capacity < o.registered ? <Notice kind="warning">{t("insufficient", { missing: o.registered - o.capacity })}</Notice> : null}

      <Can permission="exam.center.manage">
        <section aria-labelledby="centers-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 id="centers-title" className="text-base font-semibold">{t("centersTitle")}</h2>
          {o.centers.length === 0 ? <p className="text-sm text-muted-foreground">{t("noCenters")}</p> : (
            <fieldset className="space-y-1" disabled={o.frozen}>
              <legend className="sr-only">{t("centersTitle")}</legend>
              {o.centers.map((c) => <CheckControl key={c.id} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} label={`${c.code} — ${c.name}`} />)}
            </fieldset>
          )}
          <button type="button" className={buttonClass.secondary} disabled={o.frozen || setCenters.isPending || o.centers.length === 0} onClick={() => void saveCenters()}>{t("saveCenters")}</button>
          {setCenters.isError ? <ErrorBlock error={setCenters.error} /> : null}
        </section>
        <section aria-labelledby="auto-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 id="auto-title" className="text-base font-semibold">{t("autoTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("autoHint")}</p>
          <CheckControl checked={reassign} onChange={setReassign} label={t("reassign")} hint={t("reassignHint")} />
          <button type="button" className={buttonClass.primary} disabled={o.frozen || auto.isPending} onClick={() => void runAuto()}>{t("auto")}</button>
          {auto.isError ? <ErrorBlock error={auto.error} /> : null}
        </section>
      </Can>

      <section aria-labelledby="rooms-title" className="space-y-2">
        <h2 id="rooms-title" className="text-base font-semibold">{t("roomsTitle")}</h2>
        {o.rooms.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRooms")}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {o.rooms.map((r) => (
              <li key={r.roomId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <p className="font-medium">{r.centerName} — {r.code}</p>
                <p className="text-muted-foreground">{t("occupancy", { used: r.used, capacity: r.capacity })}{r.active ? "" : ` (${t("inactive")})`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DataTable caption={t("caption")} columns={columns} rows={o.assignments} getRowId={(a) => a.candidateId} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {unassign.isError ? <ErrorBlock error={unassign.error} /> : null}
      <MoveDialog overview={o} assignment={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

/** Centres de la session et répartition des candidats par salle et par place (automatique, puis ajustements à la main). */
export function AssignmentsScreen() {
  const t = useTranslations("v2Examinations.assignments");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope>{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
