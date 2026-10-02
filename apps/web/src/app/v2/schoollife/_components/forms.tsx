"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  schoollifeConvocationCreateSchema,
  schoollifeIncidentCreateSchema,
  schoollifeMeasureProposeSchema,
  schoollifeNoteCreateSchema,
  type SchoolLifeEventTypeDto,
} from "@ecoledigitale/contracts/v2/schoollife";
import { useCreateConvocation, useCreateNote, useDeclareIncident, useProposeMeasure, useSchoolLifeReference } from "@/platform/v2/schoollife";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { localToIso, nowLocalInput, StudentPicker, todayInput, type PickedStudent } from "./shared";

/** Types ACTIFS d'une ou plusieurs familles : des DONNÉES d'établissement (aucune liste de fautes dans le code). */
export function useTypesOfKind(...kinds: string[]): SchoolLifeEventTypeDto[] {
  const ref = useSchoolLifeReference();
  return (ref.data?.eventTypes ?? []).filter((t) => t.active && kinds.includes(t.kind));
}

const CONFIDENTIALITY = ["STANDARD", "RESTRICTED", "CONFIDENTIAL"] as const;

function ConfidentialityField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const t = useTranslations("v2Schoollife.form");
  const tl = useTranslations("v2Schoollife.confidentiality");
  return (
    <FormField label={t("confidentiality")} hint={t("confidentialityHint")} error={error ?? null}>
      {(c) => <NativeSelect {...c} value={value} placeholder={t("typeDefault")} onChange={onChange} options={CONFIDENTIALITY.map((l) => ({ value: l, label: tl(l) }))} />}
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------

export function IncidentFormDialog({ open, onOpenChange, student, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; student?: PickedStudent | null; onDone: () => void }) {
  const t = useTranslations("v2Schoollife.incident");
  const tf = useTranslations("v2Schoollife.form");
  const tr = useTranslations("v2Schoollife.role");
  const types = useTypesOfKind("INCIDENT");
  const ref = useSchoolLifeReference();
  const declare = useDeclareIncident();
  const [picked, setPicked] = useState<PickedStudent | null>(student ?? null);
  const [typeId, setTypeId] = useState("");
  const [severity, setSeverity] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalInput());
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("AUTHOR");
  const [statement, setStatement] = useState("");
  const [confidentiality, setConfidentiality] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const target = student ?? picked;

  function submit() {
    const payload = compact({
      typeId,
      severityCode: severity,
      occurredAt: occurredAt ? localToIso(occurredAt) : "",
      location,
      description,
      confidentiality,
      involvements: target ? [compact({ enrollmentId: target.enrollmentId, role, statement })] : [],
    });
    const v = validateWith(schoollifeIncidentCreateSchema, payload);
    if (!v.ok) return setErrors({ ...v.errors, ...(v.errors.involvements ? { student: v.errors.involvements } : {}) });
    setErrors({});
    declare.mutate(v.data, {
      onSuccess: () => {
        setDescription("");
        setStatement("");
        setLocation("");
        onDone();
        onOpenChange(false);
      },
      onError: (e) => setErrors(apiErrorToFieldErrors(e)),
    });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={declare.isPending} error={declare.error && Object.keys(apiErrorToFieldErrors(declare.error)).length === 0 ? declare.error : undefined} wide>
      {student ? <p className="text-sm font-medium">{student.name}</p> : <StudentPicker value={picked} onChange={setPicked} error={errors.student ?? null} />}
      <FormField label={tf("type")} required error={errors.typeId ?? null}>
        {(c) => <NativeSelect {...c} value={typeId} placeholder={tf("chooseType")} onChange={setTypeId} options={types.map((x) => ({ value: x.id, label: x.label }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tf("severity")} error={errors.severityCode ?? null}>
          {(c) => <NativeSelect {...c} value={severity} placeholder={tf("typeDefault")} onChange={setSeverity} options={(ref.data?.severityLevels ?? []).filter((s) => s.active).map((s) => ({ value: s.code, label: s.label }))} />}
        </FormField>
        <FormField label={t("occurredAt")} required error={errors.occurredAt ?? null}>
          {(c) => <TextControl {...c} type="date" value={occurredAt.slice(0, 10)} onChange={(d) => setOccurredAt(`${d}T${occurredAt.slice(11, 16) || "08:00"}`)} />}
        </FormField>
      </div>
      <FormField label={t("time")} error={null}>
        {(c) => <TextControl {...c} type="time" value={occurredAt.slice(11, 16)} onChange={(h) => setOccurredAt(`${occurredAt.slice(0, 10)}T${h || "00:00"}`)} />}
      </FormField>
      <FormField label={t("descriptionLabel")} required error={errors.description ?? null}>
        {(c) => <TextAreaControl {...c} value={description} onChange={setDescription} rows={4} maxLength={4000} />}
      </FormField>
      <FormField label={t("location")} error={errors.location ?? null}>
        {(c) => <TextControl {...c} value={location} onChange={setLocation} maxLength={200} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("role")} required>
          {(c) => <NativeSelect {...c} value={role} onChange={setRole} options={(["AUTHOR", "VICTIM", "WITNESS", "OTHER"] as const).map((r) => ({ value: r, label: tr(r) }))} />}
        </FormField>
        <ConfidentialityField value={confidentiality} onChange={setConfidentiality} error={errors.confidentiality} />
      </div>
      <FormField label={t("statement")} hint={t("statementHint")}>
        {(c) => <TextAreaControl {...c} value={statement} onChange={setStatement} rows={2} maxLength={2000} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Encouragement ou observation
// ---------------------------------------------------------------------------

export function NoteFormDialog({ open, onOpenChange, student, kind, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; student?: PickedStudent | null; kind: "ENCOURAGEMENT" | "OBSERVATION"; onDone: () => void }) {
  const t = useTranslations("v2Schoollife.note");
  const tf = useTranslations("v2Schoollife.form");
  const tv = useTranslations("v2Schoollife.visibility");
  const types = useTypesOfKind(kind);
  const create = useCreateNote();
  const [picked, setPicked] = useState<PickedStudent | null>(student ?? null);
  const [typeId, setTypeId] = useState("");
  const [body, setBody] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayInput());
  const [visibility, setVisibility] = useState("STAFF_ONLY");
  const [confidentiality, setConfidentiality] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const target = student ?? picked;
  const type = types.find((x) => x.id === typeId);

  function submit() {
    const payload = compact({ enrollmentId: target?.enrollmentId ?? "", typeId, body, occurredOn, visibility, confidentiality });
    const v = validateWith(schoollifeNoteCreateSchema, payload);
    if (!v.ok) return setErrors({ ...v.errors, ...(v.errors.enrollmentId ? { student: v.errors.enrollmentId } : {}) });
    setErrors({});
    create.mutate(v.data, {
      onSuccess: () => {
        setBody("");
        onDone();
        onOpenChange(false);
      },
      onError: (e) => setErrors(apiErrorToFieldErrors(e)),
    });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t(`title.${kind}`)} description={t(`description.${kind}`)} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      {student ? <p className="text-sm font-medium">{student.name}</p> : <StudentPicker value={picked} onChange={setPicked} error={errors.student ?? null} />}
      <FormField label={tf("type")} required error={errors.typeId ?? null}>
        {(c) => <NativeSelect {...c} value={typeId} placeholder={tf("chooseType")} onChange={setTypeId} options={types.map((x) => ({ value: x.id, label: x.label }))} />}
      </FormField>
      <FormField label={t("body")} required error={errors.body ?? null}>
        {(c) => <TextAreaControl {...c} value={body} onChange={setBody} rows={4} maxLength={2000} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("occurredOn")} required error={errors.occurredOn ?? null}>
          {(c) => <TextControl {...c} type="date" value={occurredOn} onChange={setOccurredOn} />}
        </FormField>
        <FormField label={t("visibility")} hint={type && !type.visibleToGuardians ? t("notShareable") : t("visibilityHint")} error={errors.visibility ?? null}>
          {(c) => (
            <NativeSelect
              {...c}
              value={visibility}
              onChange={setVisibility}
              options={(["STAFF_ONLY", "GUARDIANS", "STUDENT_AND_GUARDIANS"] as const).map((v) => ({ value: v, label: tv(v), disabled: v !== "STAFF_ONLY" && type !== undefined && !type.visibleToGuardians }))}
            />
          )}
        </FormField>
      </div>
      <ConfidentialityField value={confidentiality} onChange={setConfidentiality} error={errors.confidentiality} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Mesure (sanction, avertissement, exclusion temporaire) : le TYPE porte le circuit
// ---------------------------------------------------------------------------

export function MeasureFormDialog({ open, onOpenChange, student, incidentId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; student?: PickedStudent | null; incidentId?: string; onDone: () => void }) {
  const t = useTranslations("v2Schoollife.measure");
  const tf = useTranslations("v2Schoollife.form");
  const types = useTypesOfKind("SANCTION", "WARNING", "TEMP_EXCLUSION");
  const ref = useSchoolLifeReference();
  const propose = useProposeMeasure();
  const [picked, setPicked] = useState<PickedStudent | null>(student ?? null);
  const [typeId, setTypeId] = useState("");
  const [severity, setSeverity] = useState("");
  const [reason, setReason] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [confidentiality, setConfidentiality] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const target = student ?? picked;
  const type = types.find((x) => x.id === typeId);

  function submit() {
    const payload = compact({ enrollmentId: target?.enrollmentId ?? "", typeId, incidentId, severityCode: severity, reason, startsOn: type?.requiresDates ? startsOn : "", endsOn: type?.requiresDates ? endsOn : "", confidentiality });
    const v = validateWith(schoollifeMeasureProposeSchema, payload);
    if (!v.ok) return setErrors({ ...v.errors, ...(v.errors.enrollmentId ? { student: v.errors.enrollmentId } : {}) });
    if (type?.requiresDates && (!startsOn || !endsOn)) return setErrors({ startsOn: t("datesRequired") });
    setErrors({});
    propose.mutate(v.data, {
      onSuccess: () => {
        setReason("");
        onDone();
        onOpenChange(false);
      },
      onError: (e) => setErrors(apiErrorToFieldErrors(e)),
    });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={propose.isPending} error={propose.error && Object.keys(apiErrorToFieldErrors(propose.error)).length === 0 ? propose.error : undefined} wide>
      {student ? <p className="text-sm font-medium">{student.name}</p> : <StudentPicker value={picked} onChange={setPicked} error={errors.student ?? null} />}
      <FormField label={tf("type")} required error={errors.typeId ?? null}>
        {(c) => <NativeSelect {...c} value={typeId} placeholder={tf("chooseType")} onChange={setTypeId} options={types.map((x) => ({ value: x.id, label: x.label }))} />}
      </FormField>
      {type ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label={t("circuit")}>
          <li>{type.requiresValidation ? t("circuitValidation") : t("circuitDirect")}</li>
          {type.requiresFourEyes ? <li>{t("circuitFourEyes")}</li> : null}
          {type.appealable ? <li>{t("circuitAppealable")}</li> : null}
          {type.notifyGuardians ? <li>{t("circuitNotify")}</li> : null}
        </ul>
      ) : null}
      <FormField label={tf("severity")} error={errors.severityCode ?? null}>
        {(c) => <NativeSelect {...c} value={severity} placeholder={tf("typeDefault")} onChange={setSeverity} options={(ref.data?.severityLevels ?? []).filter((s) => s.active).map((s) => ({ value: s.code, label: s.label }))} />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason ?? null}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} rows={3} maxLength={2000} />}
      </FormField>
      {type?.requiresDates ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("startsOn")} required error={errors.startsOn ?? null}>
            {(c) => <TextControl {...c} type="date" value={startsOn} onChange={setStartsOn} />}
          </FormField>
          <FormField label={t("endsOn")} required error={errors.endsOn ?? null}>
            {(c) => <TextControl {...c} type="date" value={endsOn} min={startsOn || undefined} onChange={setEndsOn} />}
          </FormField>
        </div>
      ) : null}
      <ConfidentialityField value={confidentiality} onChange={setConfidentiality} error={errors.confidentiality} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Convocation
// ---------------------------------------------------------------------------

export function ConvocationFormDialog({ open, onOpenChange, student, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; student?: PickedStudent | null; onDone: () => void }) {
  const t = useTranslations("v2Schoollife.convocation");
  const tr = useTranslations("v2Schoollife.reasonKind");
  const create = useCreateConvocation();
  const [picked, setPicked] = useState<PickedStudent | null>(student ?? null);
  const [reasonKind, setReasonKind] = useState("DISCIPLINE");
  const [reason, setReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const target = student ?? picked;

  function submit() {
    const payload = compact({ enrollmentId: target?.enrollmentId ?? "", reasonKind, reason, scheduledAt: scheduledDate ? localToIso(`${scheduledDate}T${scheduledTime || "09:00"}`) : "", location });
    const v = validateWith(schoollifeConvocationCreateSchema, payload);
    if (!v.ok) return setErrors({ ...v.errors, ...(v.errors.enrollmentId ? { student: v.errors.enrollmentId } : {}) });
    setErrors({});
    create.mutate(v.data, {
      onSuccess: () => {
        setReason("");
        onDone();
        onOpenChange(false);
      },
      onError: (e) => setErrors(apiErrorToFieldErrors(e)),
    });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("create.title")} description={t("create.description")} submitLabel={t("create.submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      {student ? <p className="text-sm font-medium">{student.name}</p> : <StudentPicker value={picked} onChange={setPicked} error={errors.student ?? null} />}
      <FormField label={t("create.reasonKind")} required>
        {(c) => <NativeSelect {...c} value={reasonKind} onChange={setReasonKind} options={(["DISCIPLINE", "ABSENCES", "ACADEMIC", "HEALTH", "OTHER"] as const).map((k) => ({ value: k, label: tr(k) }))} />}
      </FormField>
      <FormField label={t("create.reason")} required hint={t("create.reasonHint")} error={errors.reason ?? null}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} rows={3} maxLength={2000} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("create.scheduledDate")} required error={errors.scheduledAt ?? null}>
          {(c) => <TextControl {...c} type="date" value={scheduledDate} onChange={setScheduledDate} />}
        </FormField>
        <FormField label={t("create.scheduledTime")} required>
          {(c) => <TextControl {...c} type="time" value={scheduledTime} onChange={setScheduledTime} />}
        </FormField>
        <FormField label={t("create.location")} error={errors.location ?? null}>
          {(c) => <TextControl {...c} value={location} onChange={setLocation} maxLength={200} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

