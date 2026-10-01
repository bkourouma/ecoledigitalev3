"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  peopleCreateGuardianBodySchema,
  peopleEmergencyContactBodySchema,
  peopleLinkGuardianBodySchema,
  peoplePriorEducationBodySchema,
  peopleUpdateLinkBodySchema,
  type PeopleEmergencyContactDto,
  type PeoplePriorEducationDto,
  type PeopleStudentGuardianDto,
} from "@ecoledigitale/contracts/v2/people";
import {
  useAddEmergencyContact,
  useAddPriorEducation,
  useCreateGuardian,
  useInvitePortalAccess,
  useLinkGuardian,
  useRelationshipTypes,
  useRemoveEmergencyContact,
  useRemovePriorEducation,
  useStudentEmergencyContacts,
  useStudentEnrollments,
  useStudentGuardians,
  useStudentPriorEducation,
  useUnlinkGuardian,
  useUpdateGuardianLink,
} from "@/platform/v2/people";
import { useGuardianOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { enrollmentTone } from "../../enrollments/_components/labels";
import { defaultFlags, FlagsFields, FLAG_KEYS, RelationshipSelect, type LinkFlags } from "./guardian-forms";
import { emptyIdentity, IdentityFields, identityToInput } from "./identity";

// ---------------------------------------------------------------------------
// Tuteurs de l'élève
// ---------------------------------------------------------------------------

export function GuardiansTab({ studentId }: { studentId: string }) {
  const t = useTranslations("v2Students.detail.guardians");
  const date = useDateFormat();
  const list = useStudentGuardians(studentId);
  const types = useRelationshipTypes();
  const invite = useInvitePortalAccess();
  const flash = useFlash();
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState<PeopleStudentGuardianDto | null>(null);
  const [closing, setClosing] = useState<PeopleStudentGuardianDto | null>(null);
  const [inviteError, setInviteError] = useState<unknown>(null);
  const label = (code: string) => (types.data ?? []).find((x) => x.code === code)?.label ?? code;

  const columns: DataTableColumn<PeopleStudentGuardianDto>[] = [
    {
      id: "guardian",
      header: t("columns.guardian"),
      rowHeader: true,
      cell: (g) => (
        <span>
          <Link href={`/v2/guardians/${g.guardian.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {g.guardian.displayName}
          </Link>
          {g.guardian.phone ? <span className="block text-xs text-muted-foreground">{g.guardian.phone}</span> : null}
        </span>
      ),
    },
    { id: "relationship", header: t("columns.relationship"), cell: (g) => label(g.link.relationshipCode) },
    {
      id: "flags",
      header: t("columns.flags"),
      cell: (g) => (
        <span className="flex flex-wrap gap-1">
          {FLAG_KEYS.filter((k) => g.link[k]).map((k) => (
            <StatusBadge key={k} label={t(`flagShort.${k}`)} tone={k === "isPrimaryContact" ? "info" : "neutral"} />
          ))}
        </span>
      ),
      className: "hidden md:table-cell",
    },
    { id: "validity", header: t("columns.validity"), cell: (g) => (g.link.validTo ? t("closedOn", { date: date.civil(g.link.validTo) }) : t("since", { date: date.civil(g.link.validFrom) })), className: "hidden sm:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (g) => (
        <span className="flex flex-wrap justify-end gap-1">
          <Can permission="guardian.manage">
            {!g.link.validTo ? (
              <>
                <button type="button" className={buttonClass.ghost} onClick={() => setEditing(g)} aria-label={`${t("edit")} — ${g.guardian.displayName}`}>
                  {t("edit")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setClosing(g)} aria-label={`${t("unlink")} — ${g.guardian.displayName}`}>
                  {t("unlink")}
                </button>
                {g.guardian.portalAccount === "NONE" ? (
                  <button
                    type="button"
                    className={buttonClass.ghost}
                    disabled={invite.isPending}
                    onClick={() => {
                      setInviteError(null);
                      void invite.mutateAsync({ personId: g.guardian.personId, quality: "GUARDIAN" }).then(() => flash.show(t("invited", { name: g.guardian.displayName }))).catch(setInviteError);
                    }}
                    aria-label={`${t("invite")} — ${g.guardian.displayName}`}
                  >
                    {t("invite")}
                  </button>
                ) : null}
              </>
            ) : null}
          </Can>
        </span>
      ),
    },
  ];

  return (
    <section aria-labelledby="st-guardians" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="st-guardians" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="guardian.manage">
          <button type="button" className={buttonClass.primary} onClick={() => setLinking(true)}>
            {t("link")}
          </button>
        </Can>
      </div>
      {flash.node}
      {inviteError ? <ErrorBlock error={inviteError} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(g) => g.link.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {linking ? <LinkGuardianDialog studentId={studentId} onClose={() => setLinking(false)} onDone={() => flash.show(t("linked"))} /> : null}
      {editing ? <EditLinkDialog studentId={studentId} item={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("updated"))} /> : null}
      {closing ? <UnlinkDialog studentId={studentId} item={closing} onClose={() => setClosing(null)} onDone={() => flash.show(t("unlinked"))} /> : null}
    </section>
  );
}

function LinkGuardianDialog({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.guardians");
  const link = useLinkGuardian();
  const createGuardian = useCreateGuardian();
  const [kind, setKind] = useState<"existing" | "new">("existing");
  const [guardian, setGuardian] = useState<SelectOption | null>(null);
  const [identity, setIdentity] = useState(emptyIdentity());
  const [occupation, setOccupation] = useState("");
  const [relationshipCode, setRelationshipCode] = useState("");
  const [flags, setFlags] = useState<LinkFlags>(defaultFlags());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<unknown>(null);

  async function submit() {
    const e: FieldErrors = {};
    let guardianId = guardian?.value ?? "";
    if (kind === "existing" && !guardian) e.existing = t("guardianRequired");
    if (kind === "new") {
      const v = validateWith(peopleCreateGuardianBodySchema, { person: identityToInput(identity), ...(occupation.trim() ? { occupation: occupation.trim() } : {}) });
      if (!v.ok) Object.assign(e, v.errors);
    }
    if (!relationshipCode) e.relationshipCode = t("relationshipRequired");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setFailure(null);
    try {
      if (kind === "new") {
        const body = peopleCreateGuardianBodySchema.parse({ person: identityToInput(identity), ...(occupation.trim() ? { occupation: occupation.trim() } : {}) });
        guardianId = (await createGuardian.mutateAsync(body)).guardian.id;
      }
      const v = validateWith(peopleLinkGuardianBodySchema, { guardianId, relationshipCode, ...flags });
      if (!v.ok) return setErrors(v.errors);
      await link.mutateAsync({ studentId, body: v.data });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
      setFailure(err);
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("linkTitle")} description={t("linkDescription")} submitLabel={t("link")} onSubmit={() => void submit()} isPending={link.isPending || createGuardian.isPending} error={failure} wide>
      <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <legend className="sr-only">{t("kindLabel")}</legend>
        {(["existing", "new"] as const).map((k) => (
          <label key={k} className="flex min-h-[2.75rem] items-center gap-2 text-sm">
            <input type="radio" name="guardian-kind" checked={kind === k} onChange={() => setKind(k)} className="h-4 w-4 accent-primary" />
            {t(`kind.${k}`)}
          </label>
        ))}
      </fieldset>
      {kind === "existing" ? (
        <FormField label={t("search")} required error={errors.existing ?? errors.guardianId}>
          {(c) => <SelectAsync {...c} value={guardian} onChange={setGuardian} useOptions={useGuardianOptions} placeholder={t("searchPlaceholder")} ariaLabel={t("search")} />}
        </FormField>
      ) : (
        <>
          <IdentityFields value={identity} onChange={setIdentity} errors={errors} sexRequired={false} compact />
          <FormField label={t("occupation")}>{(c) => <TextControl {...c} value={occupation} onChange={setOccupation} maxLength={160} />}</FormField>
        </>
      )}
      <RelationshipSelect value={relationshipCode} onChange={setRelationshipCode} error={errors.relationshipCode} />
      <FlagsFields value={flags} onChange={setFlags} />
    </FormDialog>
  );
}

function EditLinkDialog({ studentId, item, onClose, onDone }: { studentId: string; item: PeopleStudentGuardianDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.guardians");
  const update = useUpdateGuardianLink();
  const [relationshipCode, setRelationshipCode] = useState(item.link.relationshipCode);
  const [flags, setFlags] = useState<LinkFlags>(Object.fromEntries(FLAG_KEYS.map((k) => [k, item.link[k]])) as unknown as LinkFlags);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const patch: Record<string, unknown> = {};
    if (relationshipCode !== item.link.relationshipCode) patch.relationshipCode = relationshipCode;
    for (const k of FLAG_KEYS) if (flags[k] !== item.link[k]) patch[k] = flags[k];
    if (Object.keys(patch).length === 0) return onClose();
    const v = validateWith(peopleUpdateLinkBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    try {
      await update.mutateAsync({ studentId, linkId: item.link.id, patch: v.data });
      onDone();
      onClose();
    } catch (err) {
      setErrors(apiErrorToFieldErrors(err));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { name: item.guardian.displayName })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error} wide>
      <RelationshipSelect value={relationshipCode} onChange={setRelationshipCode} error={errors.relationshipCode} />
      <FlagsFields value={flags} onChange={setFlags} />
    </FormDialog>
  );
}

function UnlinkDialog({ studentId, item, onClose, onDone }: { studentId: string; item: PeopleStudentGuardianDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.guardians");
  const unlink = useUnlinkGuardian();
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("unlinkTitle", { name: item.guardian.displayName })}
      description={t("unlinkDescription")}
      reasonLabel={t("reason")}
      reasonRequired={false}
      confirmLabel={t("unlink")}
      destructive
      isPending={unlink.isPending}
      error={unlink.error}
      onConfirm={async (reason) => {
        try {
          await unlink.mutateAsync({ studentId, linkId: item.link.id, reason: reason || undefined });
          onDone();
          onClose();
        } catch {
          /* affichée par la boîte de dialogue */
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Contacts d'urgence
// ---------------------------------------------------------------------------

export function EmergencyTab({ studentId }: { studentId: string }) {
  const t = useTranslations("v2Students.detail.emergency");
  const list = useStudentEmergencyContacts(studentId);
  const remove = useRemoveEmergencyContact();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const columns: DataTableColumn<PeopleEmergencyContactDto>[] = [
    { id: "name", header: t("columns.name"), rowHeader: true, cell: (c) => <span className="font-medium">{c.contactName}</span> },
    { id: "relationship", header: t("columns.relationship"), cell: (c) => c.relationshipLabel ?? "—", className: "hidden sm:table-cell" },
    { id: "phone", header: t("columns.phone"), cell: (c) => <a href={`tel:${c.phone}`} className="text-primary underline-offset-4 hover:underline">{c.phone}</a> },
    { id: "priority", header: t("columns.priority"), align: "right", cell: (c) => c.priority, className: "hidden md:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (c) => (
        <Can permission="student.update">
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={remove.isPending}
            aria-label={`${t("remove")} — ${c.contactName}`}
            onClick={() => {
              setError(null);
              void remove.mutateAsync({ studentId, contactId: c.id }).then(() => flash.show(t("removed"))).catch(setError);
            }}
          >
            {t("remove")}
          </button>
        </Can>
      ),
    },
  ];

  return (
    <section aria-labelledby="st-emergency" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="st-emergency" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="student.update">
          <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        </Can>
      </div>
      {flash.node}
      {error ? <ErrorBlock error={error} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(c) => c.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} />
      {adding ? <AddEmergencyDialog studentId={studentId} onClose={() => setAdding(false)} onDone={() => flash.show(t("added"))} /> : null}
    </section>
  );
}

function AddEmergencyDialog({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.emergency");
  const add = useAddEmergencyContact();
  const [form, setForm] = useState({ contactName: "", relationshipLabel: "", phone: "", phoneAlt: "", email: "", priority: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) if (v.trim() !== "") body[k] = k === "priority" ? Number(v) : v.trim();
    const v = validateWith(peopleEmergencyContactBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await add.mutateAsync({ studentId, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("addTitle")} submitLabel={t("add")} onSubmit={() => void submit()} isPending={add.isPending} error={add.error}>
      <FormField label={t("fields.contactName")} required error={errors.contactName}>
        {(c) => <TextControl {...c} value={form.contactName} onChange={set("contactName")} maxLength={160} />}
      </FormField>
      <FormField label={t("fields.relationshipLabel")} error={errors.relationshipLabel}>
        {(c) => <TextControl {...c} value={form.relationshipLabel} onChange={set("relationshipLabel")} maxLength={80} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.phone")} required error={errors.phone}>
          {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={set("phone")} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.phoneAlt")} error={errors.phoneAlt}>
          {(c) => <TextControl {...c} type="tel" value={form.phoneAlt} onChange={set("phoneAlt")} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.email")} error={errors.email}>
          {(c) => <TextControl {...c} type="email" value={form.email} onChange={set("email")} maxLength={320} />}
        </FormField>
        <FormField label={t("fields.priority")} hint={t("fields.priorityHint")} error={errors.priority}>
          {(c) => <TextControl {...c} type="number" min={0} inputMode="numeric" value={form.priority} onChange={set("priority")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Parcours scolaire : inscriptions et antécédents
// ---------------------------------------------------------------------------

export function SchoolingTab({ studentId }: { studentId: string }) {
  const t = useTranslations("v2Students.detail.schooling");
  const tEnr = useTranslations("v2Enrollments.status");
  const date = useDateFormat();
  const enrollments = useStudentEnrollments(studentId);
  const prior = useStudentPriorEducation(studentId);
  const remove = useRemovePriorEducation();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  type EnrollmentRow = NonNullable<typeof enrollments.data>[number];
  const enrollmentColumns: DataTableColumn<EnrollmentRow>[] = [
    { id: "year", header: t("enrollments.enrolledOn"), rowHeader: true, cell: (e) => date.civil(e.enrolledOn) },
    { id: "classroom", header: t("enrollments.classroom"), cell: (e) => e.classroomName ?? "—" },
    { id: "program", header: t("enrollments.program"), cell: (e) => [e.programLabel, e.gradeLevelLabel].filter(Boolean).join(" — ") || "—", className: "hidden md:table-cell" },
    { id: "status", header: t("enrollments.status"), cell: (e) => <StatusBadge label={tEnr(e.status)} tone={enrollmentTone(e.status)} /> },
    { id: "open", header: <span className="sr-only">{t("enrollments.actions")}</span>, align: "right", cell: (e) => (<Link href={`/v2/enrollments/${e.enrollmentId}`} className={buttonClass.ghost}>{t("enrollments.open")}</Link>) },
  ];
  const priorColumns: DataTableColumn<PeoplePriorEducationDto>[] = [
    { id: "label", header: t("prior.label"), rowHeader: true, cell: (p) => <span><span className="font-medium">{p.label}</span><span className="block text-xs text-muted-foreground">{t(`prior.kind.${p.kind}`)}</span></span> },
    { id: "institution", header: t("prior.institution"), cell: (p) => p.institutionName ?? "—", className: "hidden sm:table-cell" },
    { id: "year", header: t("prior.schoolYear"), cell: (p) => p.schoolYear ?? "—", className: "hidden md:table-cell" },
    { id: "level", header: t("prior.level"), cell: (p) => [p.levelLabel, p.seriesLabel].filter(Boolean).join(" / ") || "—", className: "hidden md:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("prior.actions")}</span>,
      align: "right",
      cell: (p) => (
        <Can permission="student.update">
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={remove.isPending}
            aria-label={`${t("prior.remove")} — ${p.label}`}
            onClick={() => {
              setError(null);
              void remove.mutateAsync({ studentId, entryId: p.id }).then(() => flash.show(t("prior.removed"))).catch(setError);
            }}
          >
            {t("prior.remove")}
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <section aria-labelledby="st-enrollments" className="space-y-2">
        <h2 id="st-enrollments" className="text-lg font-semibold">
          {t("enrollments.title")}
        </h2>
        <DataTable caption={t("enrollments.caption")} columns={enrollmentColumns} rows={enrollments.data ?? []} getRowId={(e) => e.enrollmentId} isLoading={enrollments.isFetching} error={enrollments.error} onRetry={() => void enrollments.refetch()} emptyTitle={t("enrollments.empty")} />
      </section>
      <section aria-labelledby="st-prior" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="st-prior" className="text-lg font-semibold">
            {t("prior.title")}
          </h2>
          <Can permission="student.update">
            <button type="button" className={buttonClass.secondary} onClick={() => setAdding(true)}>
              {t("prior.add")}
            </button>
          </Can>
        </div>
        {flash.node}
        {error ? <ErrorBlock error={error} /> : null}
        <DataTable caption={t("prior.caption")} columns={priorColumns} rows={prior.data ?? []} getRowId={(p) => p.id} isLoading={prior.isFetching} error={prior.error} onRetry={() => void prior.refetch()} emptyTitle={t("prior.empty")} />
      </section>
      {adding ? <AddPriorDialog studentId={studentId} onClose={() => setAdding(false)} onDone={() => flash.show(t("prior.added"))} /> : null}
    </div>
  );
}

function AddPriorDialog({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.schooling.prior");
  const add = useAddPriorEducation();
  const [form, setForm] = useState({ kind: "SCHOOL", label: "", institutionName: "", schoolYear: "", levelLabel: "", seriesLabel: "", obtainedOn: "", note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) if (v.trim() !== "") body[k] = v.trim();
    const v = validateWith(peoplePriorEducationBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await add.mutateAsync({ studentId, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("addTitle")} submitLabel={t("add")} onSubmit={() => void submit()} isPending={add.isPending} error={add.error} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.kind")} required error={errors.kind}>
          {(c) => <NativeSelect {...c} value={form.kind} onChange={set("kind")} options={(["SCHOOL", "DIPLOMA", "CERTIFICATE", "OTHER"] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.institutionName")} error={errors.institutionName}>
          {(c) => <TextControl {...c} value={form.institutionName} onChange={set("institutionName")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.schoolYear")} error={errors.schoolYear}>
          {(c) => <TextControl {...c} value={form.schoolYear} onChange={set("schoolYear")} maxLength={20} />}
        </FormField>
        <FormField label={t("fields.levelLabel")} error={errors.levelLabel}>
          {(c) => <TextControl {...c} value={form.levelLabel} onChange={set("levelLabel")} maxLength={120} />}
        </FormField>
        <FormField label={t("fields.seriesLabel")} error={errors.seriesLabel}>
          {(c) => <TextControl {...c} value={form.seriesLabel} onChange={set("seriesLabel")} maxLength={120} />}
        </FormField>
        <FormField label={t("fields.obtainedOn")} error={errors.obtainedOn}>
          {(c) => <TextControl {...c} type="date" value={form.obtainedOn} onChange={set("obtainedOn")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

