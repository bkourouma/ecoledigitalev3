"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { SchoolLifeConvocationDto, SchoolLifeIncidentDto, SchoolLifeMeasureDto, SchoolLifeNoteDto, SchoolLifeStudentLifeDto } from "@ecoledigitale/contracts/v2/schoollife";
import { useAdjustConduct, useReadConfidential, useStudentLife, useWithdrawNote, type ConfidentialContent } from "@/platform/v2/schoollife";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith } from "@/platform/ui/validation";
import { schoollifeManualAdjustmentSchema } from "@ecoledigitale/contracts/v2/schoollife";
import { ConvocationFormDialog, IncidentFormDialog, MeasureFormDialog, NoteFormDialog } from "./forms";
import { KindLabel, StatusLabel, useDateTime, type PickedStudent } from "./shared";

type Entry =
  | { type: "INCIDENT"; at: string; row: SchoolLifeIncidentDto }
  | { type: "MEASURE"; at: string; row: SchoolLifeMeasureDto }
  | { type: "NOTE"; at: string; row: SchoolLifeNoteDto }
  | { type: "CONVOCATION"; at: string; row: SchoolLifeConvocationDto };

type Dialog = "incident" | "ENCOURAGEMENT" | "OBSERVATION" | "measure" | "convocation" | "adjust" | null;

function entriesOf(life: SchoolLifeStudentLifeDto): Entry[] {
  return [
    ...life.incidents.map((row): Entry => ({ type: "INCIDENT", at: row.occurredAt, row })),
    ...life.measures.map((row): Entry => ({ type: "MEASURE", at: row.proposedAt, row })),
    ...life.notes.map((row): Entry => ({ type: "NOTE", at: `${row.occurredOn}T12:00:00.000Z`, row })),
    ...life.convocations.map((row): Entry => ({ type: "CONVOCATION", at: row.scheduledAt, row })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Dossier de vie scolaire d'un élève. LE CONTRÔLE D'ACCÈS PAR NIVEAU DE CONFIDENTIALITÉ est celui de l'API : les éléments
 * absents de la réponse n'existent pas pour l'utilisateur (niveau insuffisant ou hors de ses classes) ; un élément
 * confidentiel arrive MASQUÉ et ne se lit que par une lecture journalisée avec motif (jamais mis en cache, jamais hors ligne).
 * Les retards et absences sont une VUE d'Présences : rien n'est copié ni saisi ici.
 */
export function StudentFileScreen({ studentId }: { studentId: string }) {
  const t = useTranslations("v2Schoollife.file");
  const flash = useFlash();
  const q = useStudentLife(studentId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const life = q.data;
  const picked: PickedStudent | null = life && life.enrollmentId ? { studentId: life.studentId, enrollmentId: life.enrollmentId, name: life.studentName ?? "—" } : null;
  const done = (key: string) => () => flash.show(t(`done.${key}`));

  return (
    <div className="space-y-6">
      <PageHeader
        title={life?.studentName ?? t("title")}
        description={t("description")}
        actions={
          picked ? (
            <>
              <Can permission="schoollife.incident.write">
                <button type="button" className={buttonClass.secondary} onClick={() => setDialog("incident")}>
                  {t("actions.incident")}
                </button>
              </Can>
              <Can permission="schoollife.note.write">
                <button type="button" className={buttonClass.secondary} onClick={() => setDialog("ENCOURAGEMENT")}>
                  {t("actions.encouragement")}
                </button>
                <button type="button" className={buttonClass.secondary} onClick={() => setDialog("OBSERVATION")}>
                  {t("actions.observation")}
                </button>
              </Can>
              <Can permission="schoollife.measure.propose">
                <button type="button" className={buttonClass.primary} onClick={() => setDialog("measure")}>
                  {t("actions.measure")}
                </button>
              </Can>
              <Can permission="schoollife.convocation.manage">
                <button type="button" className={buttonClass.secondary} onClick={() => setDialog("convocation")}>
                  {t("actions.convocation")}
                </button>
              </Can>
            </>
          ) : null
        }
      />
      {flash.node}
      <QueryBoundary query={q}>
        {life ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("clearance")} <StatusBadge label={t(`clearanceLevel.${life.clearance}`)} tone={life.clearance === "STANDARD" ? "neutral" : "warning"} />
              <span className="ml-2">{t(`clearanceHint.${life.clearance}`)}</span>
            </p>
            <Timeline life={life} />
            <AttendanceView life={life} />
            <ConductView life={life} onAdjust={() => setDialog("adjust")} />
            <History life={life} />
          </>
        ) : null}
      </QueryBoundary>
      {picked ? (
        <>
          <IncidentFormDialog open={dialog === "incident"} onOpenChange={(o) => setDialog(o ? "incident" : null)} student={picked} onDone={done("incident")} />
          <NoteFormDialog open={dialog === "ENCOURAGEMENT"} onOpenChange={(o) => setDialog(o ? "ENCOURAGEMENT" : null)} kind="ENCOURAGEMENT" student={picked} onDone={done("encouragement")} />
          <NoteFormDialog open={dialog === "OBSERVATION"} onOpenChange={(o) => setDialog(o ? "OBSERVATION" : null)} kind="OBSERVATION" student={picked} onDone={done("observation")} />
          <MeasureFormDialog open={dialog === "measure"} onOpenChange={(o) => setDialog(o ? "measure" : null)} student={picked} onDone={done("measure")} />
          <ConvocationFormDialog open={dialog === "convocation"} onOpenChange={(o) => setDialog(o ? "convocation" : null)} student={picked} onDone={done("convocation")} />
        </>
      ) : null}
      {life?.conduct.balance && dialog === "adjust" ? <AdjustDialog life={life} onClose={() => setDialog(null)} onDone={done("adjusted")} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chronologie (incidents, mesures, notes, convocations) avec éléments masqués
// ---------------------------------------------------------------------------

function Timeline({ life }: { life: SchoolLifeStudentLifeDto }) {
  const t = useTranslations("v2Schoollife.file.timeline");
  const dt = useDateTime();
  const entries = entriesOf(life);
  const [reading, setReading] = useState<{ type: Entry["type"]; id: string } | null>(null);
  const [content, setContent] = useState<ConfidentialContent | null>(null);
  const [withdrawing, setWithdrawing] = useState<SchoolLifeNoteDto | null>(null);
  const read = useReadConfidential();
  const withdraw = useWithdrawNote();

  return (
    <section aria-labelledby="sl-timeline" className="space-y-2">
      <h2 id="sl-timeline" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {entries.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {entries.map((e) => (
            <li key={`${e.type}-${e.row.id}`} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={t(`type.${e.type}`)} tone="neutral" />
                {e.type === "MEASURE" || e.type === "NOTE" ? <KindLabel kind={e.row.kind} /> : null}
                <StatusLabel status={e.row.status} />
                {e.row.confidentiality !== "STANDARD" ? <StatusBadge label={t(`confidentiality.${e.row.confidentiality}`)} tone="warning" /> : null}
                <span className="text-sm text-muted-foreground">{dt.dateTime(e.at)}</span>
              </div>
              {e.row.masked ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 border-dashed bg-white/[0.04] p-3">
                  <p className="text-sm italic text-muted-foreground">{t("masked")}</p>
                  {life.clearance === "CONFIDENTIAL" ? (
                    <Can permission="schoollife.confidential.read">
                      <button type="button" className={buttonClass.secondary} onClick={() => setReading({ type: e.type, id: e.row.id })}>
                        {t("read")}
                      </button>
                    </Can>
                  ) : null}
                </div>
              ) : (
                <EntryBody entry={e} />
              )}
              {e.type === "NOTE" && e.row.status === "ACTIVE" && !e.row.masked ? (
                <Can permission="schoollife.note.write">
                  <button type="button" className={buttonClass.ghost} onClick={() => setWithdrawing(e.row)}>
                    {t("withdraw")}
                  </button>
                </Can>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {reading ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setReading(null)}
          title={t("readDialog.title")}
          description={t("readDialog.description")}
          reasonLabel={t("readDialog.label")}
          confirmLabel={t("readDialog.confirm")}
          maxLength={500}
          isPending={read.isPending}
          error={read.error}
          onConfirm={(purpose) =>
            read.mutate(
              { entityKind: reading.type, entityId: reading.id, purpose },
              {
                onSuccess: (data) => {
                  setContent(data);
                  setReading(null);
                },
              },
            )
          }
        />
      ) : null}
      {content ? (
        <ModalDialog open onOpenChange={(o) => !o && setContent(null)} title={t("content.title")} description={t("content.description")}>
          <ConfidentialView content={content} />
          <div className="mt-4 flex justify-end">
            <button type="button" className={buttonClass.secondary} onClick={() => setContent(null)}>
              {t("content.close")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {withdrawing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setWithdrawing(null)}
          title={t("withdrawDialog.title")}
          description={t("withdrawDialog.description")}
          reasonLabel={t("withdrawDialog.label")}
          confirmLabel={t("withdrawDialog.confirm")}
          destructive
          isPending={withdraw.isPending}
          error={withdraw.error}
          onConfirm={(reason) => withdraw.mutate({ id: withdrawing.id, reason }, { onSuccess: () => setWithdrawing(null) })}
        />
      ) : null}
    </section>
  );
}

function EntryBody({ entry }: { entry: Entry }) {
  const t = useTranslations("v2Schoollife.file.timeline");
  const dt = useDateTime();
  switch (entry.type) {
    case "INCIDENT":
      return (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{entry.row.typeLabel}</p>
          <p>{entry.row.description}</p>
          {entry.row.location ? <p className="text-xs text-muted-foreground">{entry.row.location}</p> : null}
          <p className="text-xs text-muted-foreground">{t("reportedBy", { name: entry.row.reportedByName })}</p>
        </div>
      );
    case "MEASURE":
      return (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{entry.row.typeLabel}</p>
          <p>{entry.row.reason}</p>
          {entry.row.startsOn && entry.row.endsOn ? <p className="text-xs text-muted-foreground">{t("period", { from: dt.date(entry.row.startsOn), to: dt.date(entry.row.endsOn) })}</p> : null}
          <p className="text-xs text-muted-foreground">{t("proposedBy", { name: entry.row.proposedByName })}</p>
          {entry.row.appeals.map((a) => (
            <p key={a.id} className="text-xs text-muted-foreground">
              {t("appeal", { status: t(`appealStatus.${a.status}`), name: a.filedByName })}
            </p>
          ))}
        </div>
      );
    case "NOTE":
      return (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{entry.row.typeLabel}</p>
          <p>{entry.row.body}</p>
          <p className="text-xs text-muted-foreground">{t("noteBy", { name: entry.row.authorName, visibility: t(`visibility.${entry.row.visibility}`) })}</p>
        </div>
      );
    case "CONVOCATION":
      return (
        <div className="space-y-0.5 text-sm">
          <p>{entry.row.reason}</p>
          {entry.row.location ? <p className="text-xs text-muted-foreground">{entry.row.location}</p> : null}
          <p className="text-xs text-muted-foreground">{t("convenedBy", { name: entry.row.convenedByName })}</p>
        </div>
      );
  }
}

function ConfidentialView({ content }: { content: ConfidentialContent }) {
  const t = useTranslations("v2Schoollife.file.timeline");
  const rows: Array<[string, ReactNode]> = [];
  if (content.entityKind === "INCIDENT") {
    const i = content.incident;
    rows.push([t("content.type"), i.typeLabel], [t("content.fieldDescription"), i.description], [t("content.location"), i.location], [t("content.context"), i.contextNote], [t("content.resolution"), i.resolutionNote]);
    for (const v of i.involvements) rows.push([`${v.studentName ?? "—"} (${t(`involvementRole.${v.role}`)})`, v.statement]);
  } else if (content.entityKind === "MEASURE") {
    const m = content.measure;
    rows.push([t("content.type"), m.typeLabel], [t("content.reason"), m.reason], [t("content.validationNote"), m.validationNote], [t("content.revokedReason"), m.revokedReason]);
  } else if (content.entityKind === "NOTE") {
    rows.push([t("content.type"), content.note.typeLabel], [t("content.body"), content.note.body]);
  } else {
    rows.push([t("content.reason"), content.convocation.reason], [t("content.location"), content.convocation.location], [t("content.outcome"), content.convocation.outcomeNote]);
  }
  return (
    <dl className="space-y-2 text-sm">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium">{k}</dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Vue d'assiduité (lecture seule), points de conduite, historique
// ---------------------------------------------------------------------------

function AttendanceView({ life }: { life: SchoolLifeStudentLifeDto }) {
  const t = useTranslations("v2Schoollife.file.attendance");
  const dt = useDateTime();
  const a = life.attendance;
  return (
    <section aria-labelledby="sl-attendance" className="space-y-2">
      <h2 id="sl-attendance" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {!a.available ? (
        <Notice kind="warning">{t("unavailable")}</Notice>
      ) : (
        <>
          {a.summary ? <p className="text-sm">{t("summary", { absent: a.summary.absentCount, excused: a.summary.excusedCount, late: a.summary.lateCount })}</p> : null}
          {a.absences.length === 0 ? (
            <EmptyBlock title={t("empty")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("caption")}</caption>
                <thead className="bg-white/[0.04] text-left">
                  <tr>
                    <th scope="col" className="p-2">{t("columns.date")}</th>
                    <th scope="col" className="p-2">{t("columns.status")}</th>
                    <th scope="col" className="p-2">{t("columns.justified")}</th>
                    <th scope="col" className="p-2 text-right">{t("columns.minutes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.absences.map((r) => (
                    <tr key={r.recordId} className="border-t">
                      <th scope="row" className="p-2 font-normal">{dt.date(r.sessionDate)}</th>
                      <td className="p-2">{r.statusCode}</td>
                      <td className="p-2">{r.excused ? t("yes") : t("no")}</td>
                      <td className="p-2 text-right">{r.minutesLate ?? r.countedMinutes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ConductView({ life, onAdjust }: { life: SchoolLifeStudentLifeDto; onAdjust: () => void }) {
  const t = useTranslations("v2Schoollife.file.conduct");
  const dt = useDateTime();
  const c = life.conduct;
  if (!c.enabled) return null;
  return (
    <section aria-labelledby="sl-conduct" className="space-y-2">
      <h2 id="sl-conduct" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {c.balance ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-3xl font-bold tabular-nums">{c.balance.points}</p>
          <p className="text-sm">
            {c.balance.scaleLabel}
            {c.balance.isPlaceholder ? <StatusBadge label={t("placeholder")} tone="warning" className="ml-2" /> : null}
          </p>
          <Can permission="schoollife.conduct.adjust">
            <button type="button" className={buttonClass.secondary} onClick={onAdjust}>
              {t("adjust")}
            </button>
          </Can>
        </div>
      ) : (
        <EmptyBlock title={t("noScale")} />
      )}
      {c.movements.length > 0 ? (
        <ul className="divide-y rounded-lg border text-sm">
          {c.movements.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 p-2">
              <span className="w-12 text-right font-semibold tabular-nums">{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
              <span className="min-w-0 flex-1">{m.reason}</span>
              <span className="text-xs text-muted-foreground">
                {t(`source.${m.sourceKind}`)} · {dt.dateTime(m.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function History({ life }: { life: SchoolLifeStudentLifeDto }) {
  const t = useTranslations("v2Schoollife.file.history");
  const ts = useTranslations("v2Schoollife.status");
  const dt = useDateTime();
  return (
    <section aria-labelledby="sl-history" className="space-y-2">
      <h2 id="sl-history" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {life.history.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <ol className="divide-y rounded-lg border text-sm">
          {life.history.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 p-2">
              <span className="text-xs text-muted-foreground">{dt.dateTime(e.occurredAt)}</span>
              <span>{t(`entity.${e.entityKind}`)}</span>
              <span>{e.action === "CREATED" ? t("created") : t("changed", { from: e.fromStatus && ts.has(e.fromStatus) ? ts(e.fromStatus) : (e.fromStatus ?? "—"), to: e.toStatus && ts.has(e.toStatus) ? ts(e.toStatus) : (e.toStatus ?? "—") })}</span>
              <span className="text-xs text-muted-foreground">{e.actorName ?? t("system")}</span>
              {e.reason ? <span className="text-xs italic text-muted-foreground">« {e.reason} »</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AdjustDialog({ life, onClose, onDone }: { life: SchoolLifeStudentLifeDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Schoollife.file.conduct.adjustDialog");
  const adjust = useAdjustConduct();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const balance = life.conduct.balance;
  if (!balance) return null;
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("confirm")}
      isPending={adjust.isPending}
      error={adjust.error && Object.keys(apiErrorToFieldErrors(adjust.error)).length === 0 ? adjust.error : undefined}
      onSubmit={() => {
        const v = validateWith(schoollifeManualAdjustmentSchema, { enrollmentId: balance.enrollmentId, scaleId: balance.scaleId, delta: delta === "" ? undefined : Number(delta), reason });
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        adjust.mutate(v.data, {
          onSuccess: () => {
            onDone();
            onClose();
          },
          onError: (e) => setErrors(apiErrorToFieldErrors(e)),
        });
      }}
    >
      <FormField label={t("delta")} required hint={t("deltaHint")} error={errors.delta ?? null}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" value={delta} onChange={setDelta} step={1} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason ?? null}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} rows={3} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}
