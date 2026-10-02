"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { COUNCIL_FUNCTIONS, councilsParticipantInputSchema, type CouncilsCouncilDetailDto, type CouncilsParticipantDto } from "@ecoledigitale/contracts/v2/councils";
import {
  useAddParticipant,
  useAgenda,
  useCancelCouncil,
  useCloseCouncil,
  useConvokeCouncil,
  useCouncil,
  useCouncilsReference,
  useOpenCouncil,
  usePrepareCouncil,
  useProposedParticipants,
  useRemoveParticipant,
  useSetPresence,
  useUpdateCouncil,
} from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, nullifyEmpty, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CouncilStatusBar, CouncilWarnings } from "./CouncilParts";
import { ActionError, CouncilSubNav, CouncilsBoundary, EnumLabel, PlaceholderBanner, ScrollTable, Section, TD, TH, councilTitle, localToIso, useDateTime, useEnumText } from "./shared";

type Dialog = "open" | "close" | "cancel" | "edit" | null;

/**
 * Dossier de classe d'une séance : état et quorum (valeurs de l'API), participants et présence, convocation, ordre du jour par
 * élève, actions préparer / convoquer / ouvrir / clore / annuler. Le web n'évalue rien : un refus de l'API s'affiche tel quel.
 */
export function CouncilFileScreen({ councilId }: { councilId: string }) {
  const t = useTranslations("v2Councils.file");
  const council = useCouncil(councilId);
  const detail = council.data;
  return (
    <div className="space-y-4">
      <PageHeader title={detail ? councilTitle(detail.council) : t("title")} description={t("description")} />
      <CouncilSubNav councilId={councilId} current="file" />
      <CouncilsBoundary query={council}>{detail ? <FileBody detail={detail} /> : null}</CouncilsBoundary>
    </div>
  );
}

function FileBody({ detail }: { detail: CouncilsCouncilDetailDto }) {
  const t = useTranslations("v2Councils.file");
  const flash = useFlash();
  const { council, quorum } = detail;
  const councilId = council.id;
  const prepare = usePrepareCouncil();
  const convoke = useConvokeCouncil();
  const open = useOpenCouncil();
  const close = useCloseCouncil();
  const cancel = useCancelCouncil();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const planned = council.status === "PLANNED";
  const isOpen = council.status === "OPEN";
  const canOpenWithoutWaiver = quorum.met;
  const openBlocked = !quorum.met && !quorum.waiverAllowed;

  return (
    <div className="space-y-4">
      <PlaceholderBanner ruleSourceKind={council.ruleSourceKind} />
      <CouncilStatusBar detail={detail} />
      <CouncilWarnings warnings={detail.warnings} />
      {flash.node}
      <ActionError error={prepare.error ?? convoke.error} />
      {warnings.length > 0 ? <CouncilWarnings warnings={warnings} /> : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("actions.label")}>
        {planned ? (
          <Can permission="council.prepare">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={prepare.isPending}
              onClick={() =>
                prepare.mutate(
                  { id: councilId },
                  {
                    onSuccess: (r) => {
                      flash.show(t("actions.prepared", { created: r.created, rebuilt: r.rebuilt, unchanged: r.unchanged, skipped: r.skipped }));
                      setWarnings(r.warnings);
                    },
                  },
                )
              }
            >
              {t("actions.prepare")}
            </button>
          </Can>
        ) : null}
        {planned ? (
          <Can permission="council.manage">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={convoke.isPending}
              onClick={() =>
                convoke.mutate(
                  { id: councilId },
                  {
                    onSuccess: (r) => {
                      flash.show(t("actions.convoked", { convoked: r.convoked, notified: r.notified }));
                      setWarnings(r.warnings);
                    },
                  },
                )
              }
            >
              {t("actions.convoke")}
            </button>
          </Can>
        ) : null}
        {planned ? (
          <Can permission="council.session.run">
            <button type="button" className={buttonClass.primary} disabled={openBlocked} onClick={() => setDialog("open")} aria-describedby={openBlocked ? "open-blocked" : undefined}>
              {t("actions.open")}
            </button>
          </Can>
        ) : null}
        {isOpen ? (
          <Can permission="council.session.run">
            <button type="button" className={buttonClass.primary} onClick={() => setDialog("close")}>
              {t("actions.close")}
            </button>
          </Can>
        ) : null}
        {planned || isOpen ? (
          <Can permission="council.manage">
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog("edit")}>
              {t("actions.edit")}
            </button>
            <button type="button" className={buttonClass.danger} onClick={() => setDialog("cancel")}>
              {t("actions.cancel")}
            </button>
          </Can>
        ) : null}
        {isOpen ? (
          <Link href={`/v2/councils/${councilId}/deliberation`} className={buttonClass.primary}>
            {t("actions.deliberate")}
          </Link>
        ) : null}
        <Link href={`/v2/councils/effets?councilId=${councilId}`} className={buttonClass.ghost}>
          {t("actions.effects")}
        </Link>
      </div>
      {planned && openBlocked ? (
        <p id="open-blocked" className="text-sm text-muted-foreground">
          {t("actions.openBlocked")}
        </p>
      ) : null}
      {planned && !quorum.met && quorum.waiverAllowed ? <p className="text-sm text-muted-foreground">{t("actions.openWaiverHint")}</p> : null}

      <ParticipantsSection detail={detail} />
      <AgendaSection councilId={councilId} />

      {dialog === "open" && canOpenWithoutWaiver ? (
        <FormDialog open onOpenChange={(o) => !o && setDialog(null)} title={t("dialogs.open.title")} description={t("dialogs.open.description")} submitLabel={t("dialogs.open.confirm")} onSubmit={() => open.mutate({ id: councilId }, { onSuccess: () => { flash.show(t("done.opened")); setDialog(null); } })} isPending={open.isPending} error={open.error}>
          <p className="text-sm">{t("dialogs.open.quorumMet")}</p>
        </FormDialog>
      ) : null}
      {dialog === "open" && !canOpenWithoutWaiver ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("dialogs.waiver.title")}
          description={t("dialogs.waiver.description")}
          reasonLabel={t("dialogs.waiver.label")}
          confirmLabel={t("dialogs.waiver.confirm")}
          minLength={10}
          maxLength={1000}
          isPending={open.isPending}
          error={open.error}
          onConfirm={(reason) => open.mutate({ id: councilId, quorumWaiverReason: reason }, { onSuccess: () => { flash.show(t("done.openedWaived")); setDialog(null); } })}
        />
      ) : null}
      {dialog === "close" ? (
        <FormDialog open onOpenChange={(o) => !o && setDialog(null)} title={t("dialogs.close.title")} description={t("dialogs.close.description")} submitLabel={t("dialogs.close.confirm")} onSubmit={() => close.mutate({ id: councilId }, { onSuccess: () => { flash.show(t("done.closed")); setDialog(null); } })} isPending={close.isPending} error={close.error}>
          <p className="text-sm">{t("dialogs.close.body")}</p>
        </FormDialog>
      ) : null}
      {dialog === "cancel" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("dialogs.cancel.title")}
          description={t("dialogs.cancel.description")}
          reasonLabel={t("dialogs.cancel.label")}
          confirmLabel={t("dialogs.cancel.confirm")}
          destructive
          maxLength={1000}
          isPending={cancel.isPending}
          error={cancel.error}
          onConfirm={(reason) => cancel.mutate({ id: councilId, reason }, { onSuccess: () => { flash.show(t("done.cancelled")); setDialog(null); } })}
        />
      ) : null}
      {dialog === "edit" ? <EditDialog detail={detail} onClose={() => setDialog(null)} onDone={() => flash.show(t("done.updated"))} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

function ParticipantsSection({ detail }: { detail: CouncilsCouncilDetailDto }) {
  const t = useTranslations("v2Councils.participants");
  const { council } = detail;
  const councilId = council.id;
  const setPresence = useSetPresence();
  const remove = useRemoveParticipant();
  const proposed = useProposedParticipants(councilId, council.status === "PLANNED");
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const flash = useFlash();
  const editable = council.status === "PLANNED" || council.status === "OPEN";
  const dt = useDateTime();
  const taken = new Set(detail.participants.map((p) => p.staffId).filter(Boolean));
  const suggestions = (proposed.data ?? []).filter((p) => !taken.has(p.staffId));
  return (
    <Section
      id="file-participants"
      title={t("title")}
      actions={
        council.status === "PLANNED" ? (
          <Can permission="council.manage">
            <button type="button" className={buttonClass.secondary} onClick={() => setAdding(null)}>
              {t("add")}
            </button>
          </Can>
        ) : undefined
      }
    >
      {flash.node}
      <ActionError error={setPresence.error ?? remove.error} />
      {detail.participants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("name")}</th>
              <th scope="col" className={TH}>{t("role")}</th>
              <th scope="col" className={TH}>{t("function")}</th>
              <th scope="col" className={TH}>{t("presence")}</th>
              <th scope="col" className={TH}>{t("convoked")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {detail.participants.map((p) => (
              <ParticipantRow key={p.id} p={p} councilId={councilId} editable={editable} planned={council.status === "PLANNED"} onPresence={(presence) => setPresence.mutate({ councilId, participantId: p.id, presence })} onRemove={() => remove.mutate({ councilId, participantId: p.id }, { onSuccess: () => flash.show(t("removed")) })} convokedLabel={p.convokedAt ? dt.dateTime(p.convokedAt) : t("notConvoked")} />
            ))}
          </tbody>
        </ScrollTable>
      )}
      {council.status === "PLANNED" ? (
        <div>
          <h3 className="text-sm font-semibold">{t("proposedTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("proposedHint")}</p>
          {suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("proposedNone")}</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {suggestions.map((p) => (
                <li key={p.staffId} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span className="text-sm">
                    {p.displayName}
                    {p.roleCode ? <span className="ml-2 text-xs text-muted-foreground">{p.roleCode}</span> : null}
                  </span>
                  <Can permission="council.manage">
                    <button type="button" className={buttonClass.secondary} onClick={() => setAdding(p.staffId)}>
                      {t("addProposed", { name: p.displayName })}
                    </button>
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {adding !== undefined ? <AddParticipantDialog councilId={councilId} participants={detail.participants} initialStaffId={adding ?? undefined} onClose={() => setAdding(undefined)} onDone={() => flash.show(t("added"))} /> : null}
    </Section>
  );
}

function ParticipantRow({ p, editable, planned, onPresence, onRemove, convokedLabel }: { p: CouncilsParticipantDto; councilId: string; editable: boolean; planned: boolean; onPresence: (presence: "INVITED" | "PRESENT" | "ABSENT" | "EXCUSED") => void; onRemove: () => void; convokedLabel: string }) {
  const t = useTranslations("v2Councils.participants");
  const text = useEnumText();
  const id = `presence-${p.id}`;
  return (
    <tr>
      <td className={TD}>{p.displayName}{p.isVoting ? null : <span className="ml-2 text-xs text-muted-foreground">{t("nonVoting")}</span>}</td>
      <td className={TD}>{p.roleLabel ?? p.roleCode}</td>
      <td className={TD}>{p.councilFunction ? text("function", p.councilFunction) : "—"}</td>
      <td className={TD}>
        <Can permission="council.session.run" fallback={<EnumLabel group="presence" value={p.presence} />}>
          {editable ? (
            <>
              <label htmlFor={id} className="sr-only">
                {t("presenceOf", { name: p.displayName })}
              </label>
              <NativeSelect id={id} value={p.presence} onChange={(v) => onPresence(v as "INVITED" | "PRESENT" | "ABSENT" | "EXCUSED")} options={(["INVITED", "PRESENT", "ABSENT", "EXCUSED"] as const).map((v) => ({ value: v, label: text("presence", v) }))} className="min-w-[8rem]" />
            </>
          ) : (
            <EnumLabel group="presence" value={p.presence} />
          )}
        </Can>
      </td>
      <td className={TD}>{convokedLabel}</td>
      <td className={TD}>
        {planned ? (
          <Can permission="council.manage">
            <button type="button" className={buttonClass.ghost} onClick={onRemove} aria-label={t("remove", { name: p.displayName })}>
              {t("removeShort")}
            </button>
          </Can>
        ) : null}
      </td>
    </tr>
  );
}

function AddParticipantDialog({ councilId, participants, initialStaffId, onClose, onDone }: { councilId: string; participants: readonly CouncilsParticipantDto[]; initialStaffId?: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.participants.form");
  const text = useEnumText();
  const ref = useCouncilsReference();
  const proposed = useProposedParticipants(councilId);
  const add = useAddParticipant();
  const initial = (proposed.data ?? []).find((p) => p.staffId === initialStaffId);
  const [staffId, setStaffId] = useState(initialStaffId ?? "");
  const [roleCode, setRoleCode] = useState(initial?.roleCode ?? "");
  const [fn, setFn] = useState(initial?.councilFunction ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const taken = new Set(participants.map((p) => p.staffId).filter(Boolean));
  const staff = (proposed.data ?? []).filter((p) => !taken.has(p.staffId) || p.staffId === initialStaffId);
  function pickStaff(id: string) {
    setStaffId(id);
    const p = (proposed.data ?? []).find((x) => x.staffId === id);
    if (p?.roleCode) setRoleCode(p.roleCode);
    if (p?.councilFunction) setFn(p.councilFunction);
  }
  function submit() {
    const v = validateWith(councilsParticipantInputSchema, compact({ roleCode, staffId, councilFunction: fn }));
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    add.mutate(
      { councilId, input: v.data },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
        onError: (e) => setErrors(apiErrorToFieldErrors(e)),
      },
    );
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={add.isPending} error={add.error && Object.keys(apiErrorToFieldErrors(add.error)).length === 0 ? add.error : undefined}>
      <FormField label={t("staff")} required error={errors.staffId ?? null}>
        {(c) => <NativeSelect {...c} value={staffId} placeholder={t("chooseStaff")} onChange={pickStaff} options={staff.map((p) => ({ value: p.staffId, label: p.displayName }))} />}
      </FormField>
      <FormField label={t("role")} required error={errors.roleCode ?? null}>
        {(c) => <NativeSelect {...c} value={roleCode} placeholder={t("chooseRole")} onChange={setRoleCode} options={(ref.data?.roles ?? []).filter((r) => r.active).map((r) => ({ value: r.code, label: r.label }))} />}
      </FormField>
      <FormField label={t("function")} error={errors.councilFunction ?? null}>
        {(c) => <NativeSelect {...c} value={fn} placeholder={t("noFunction")} onChange={setFn} options={COUNCIL_FUNCTIONS.map((f) => ({ value: f, label: text("function", f) }))} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Ordre du jour par élève
// ---------------------------------------------------------------------------

function AgendaSection({ councilId }: { councilId: string }) {
  const t = useTranslations("v2Councils.agenda");
  const agenda = useAgenda(councilId);
  const items = [...(agenda.data?.items ?? [])].sort((a, b) => a.position - b.position);
  return (
    <Section id="file-agenda" title={t("title")}>
      <CouncilsBoundary query={agenda} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("position")}</th>
              <th scope="col" className={TH}>{t("student")}</th>
              <th scope="col" className={TH}>{t("status")}</th>
              <th scope="col" className={TH}>{t("facts")}</th>
              <th scope="col" className={TH}>{t("decisions")}</th>
              <th scope="col" className={TH}>{t("proposals")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => (
              <tr key={i.id}>
                <td className={TD}>{i.position}</td>
                <td className={TD}>
                  <Link href={`/v2/councils/${councilId}/eleves/${i.id}`} className="font-medium underline-offset-2 hover:underline" aria-label={t("openFile", { name: i.studentName })}>
                    {i.studentName}
                  </Link>
                  {i.missingResults ? <StatusBadge label={t("missingResults")} tone="warning" className="ml-2" /> : null}
                </td>
                <td className={TD}><EnumLabel group="agendaStatus" value={i.status} /></td>
                <td className={TD}>{i.preparedAt ? t("factsVersion", { version: i.factsVersion }) : t("notPrepared")}</td>
                <td className={TD}>{i.decisionCount}</td>
                <td className={TD}>{i.pendingProposals}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </CouncilsBoundary>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Modification (intitulé, date, lieu)
// ---------------------------------------------------------------------------

function EditDialog({ detail, onClose, onDone }: { detail: CouncilsCouncilDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.file.edit");
  const { council } = detail;
  const update = useUpdateCouncil();
  const [title, setTitle] = useState(council.title ?? "");
  const [date, setDate] = useState(council.scheduledAt ? council.scheduledAt.slice(0, 10) : "");
  const [time, setTime] = useState(council.scheduledAt ? new Date(council.scheduledAt).toTimeString().slice(0, 5) : "14:00");
  const [location, setLocation] = useState(council.location ?? "");
  const [heldOn, setHeldOn] = useState(council.heldOn ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const patch = nullifyEmpty({ title: title.trim(), scheduledAt: date ? localToIso(`${date}T${time || "14:00"}`) : "", location: location.trim(), heldOn });
    update.mutate(
      { id: council.id, patch },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
        onError: (e) => setErrors(apiErrorToFieldErrors(e)),
      },
    );
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={update.isPending} error={update.error && Object.keys(apiErrorToFieldErrors(update.error)).length === 0 ? update.error : undefined}>
      <FormField label={t("titleLabel")} error={errors.title ?? null}>{(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={200} />}</FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("date")} error={errors.scheduledAt ?? null}>{(c) => <TextControl {...c} type="date" value={date} onChange={setDate} />}</FormField>
        <FormField label={t("time")}>{(c) => <TextControl {...c} type="time" value={time} onChange={setTime} />}</FormField>
      </div>
      <FormField label={t("location")} error={errors.location ?? null}>{(c) => <TextControl {...c} value={location} onChange={setLocation} maxLength={200} />}</FormField>
      <FormField label={t("heldOn")} hint={t("heldOnHint")} error={errors.heldOn ?? null}>{(c) => <TextControl {...c} type="date" value={heldOn} onChange={setHeldOn} />}</FormField>
    </FormDialog>
  );
}
