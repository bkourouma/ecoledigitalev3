"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleCreateGuardianBodySchema, peopleCreateStudentBodySchema, peopleLinkGuardianBodySchema, type PeopleDuplicateCandidateDto, type PeopleStudentDetailDto } from "@ecoledigitale/contracts/v2/people";
import { useGuardianOptions } from "@/platform/v2/lookups";
import { duplicateCandidatesOf, useCreateGuardian, useCreateStudent, useLinkGuardian } from "@/platform/v2/people";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { Wizard } from "@/platform/ui/Wizard";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useDescribeError } from "@/platform/ui/errors";
import { defaultFlags, FlagsFields, RelationshipSelect, type LinkFlags } from "./guardian-forms";
import { DuplicateWarning, emptyIdentity, IdentityFields, identityToInput, type IdentityValue } from "./identity";

interface GuardianEntry {
  key: string;
  kind: "existing" | "new";
  existing: SelectOption | null;
  identity: IdentityValue;
  occupation: string;
  relationshipCode: string;
  flags: LinkFlags;
  done: boolean;
  error: string | null;
}

const newEntry = (kind: GuardianEntry["kind"]): GuardianEntry => ({ key: Math.random().toString(36).slice(2), kind, existing: null, identity: emptyIdentity(), occupation: "", relationshipCode: "", flags: { ...defaultFlags(), isPrimaryContact: true, isEmergencyContact: true }, done: false, error: null });

export function StudentCreateWizard() {
  const t = useTranslations("v2Students.create");
  const describe = useDescribeError();
  const createStudent = useCreateStudent();
  const createGuardian = useCreateGuardian();
  const link = useLinkGuardian();

  const [identity, setIdentity] = useState(emptyIdentity());
  const [duplicates, setDuplicates] = useState<PeopleDuplicateCandidateDto[]>([]);
  const [ack, setAck] = useState(false);
  const [ackReason, setAckReason] = useState("");
  const [entries, setEntries] = useState<GuardianEntry[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<PeopleStudentDetailDto | null>(null);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const body = (validateOnly: boolean) => ({ person: identityToInput(identity), validateOnly, ...(ack ? { acknowledgeDuplicate: true, duplicateReason: ackReason.trim() } : {}) });

  async function validateIdentity(): Promise<boolean> {
    if (created) return true;
    const local = validateWith(peopleCreateStudentBodySchema, body(true));
    if (!local.ok) {
      setErrors(local.errors);
      return false;
    }
    if (duplicates.length > 0 && ack) {
      setErrors({});
      return true;
    }
    try {
      const result = await createStudent.mutateAsync(local.data);
      const found = "duplicates" in result ? result.duplicates : [];
      setDuplicates(found);
      if (found.length > 0 && !ack) {
        setErrors({ duplicate: t("duplicateBlocking") });
        return false;
      }
      setErrors({});
      return true;
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
      return false;
    }
  }

  function validateGuardians(): boolean {
    const next: FieldErrors = {};
    entries.forEach((e, i) => {
      if (e.done) return;
      if (e.kind === "existing" && !e.existing) next[`g${i}.existing`] = t("guardians.required");
      if (!e.relationshipCode) next[`g${i}.relationshipCode`] = t("guardians.relationshipRequired");
      if (e.kind === "new") {
        const v = validateWith(peopleCreateGuardianBodySchema, { person: identityToInput(e.identity), ...(e.occupation.trim() ? { occupation: e.occupation.trim() } : {}) });
        if (!v.ok) for (const [k, msg] of Object.entries(v.errors)) next[`g${i}.${k}`] = msg;
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const update = (key: string, patch: Partial<GuardianEntry>) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  async function finish() {
    setSubmitting(true);
    try {
      let student = created;
      if (!student) {
        const v = validateWith(peopleCreateStudentBodySchema, body(false));
        if (!v.ok) return setErrors(v.errors);
        const result = await createStudent.mutateAsync(v.data);
        if (!("student" in result)) return;
        student = result.student;
        setCreated(student);
      }
      // Les tuteurs sont liés un à un : un échec n'annule pas les autres et reste réessayable (les liens faits sont mémorisés).
      const results = [...entries];
      for (const [i, e] of results.entries()) {
        if (e.done) continue;
        try {
          let guardianId = e.existing?.value ?? "";
          if (e.kind === "new") {
            const gBody = validateWith(peopleCreateGuardianBodySchema, { person: identityToInput(e.identity), ...(e.occupation.trim() ? { occupation: e.occupation.trim() } : {}), ...(ack ? { acknowledgeDuplicate: true, duplicateReason: ackReason.trim() || t("guardians.autoReason") } : {}) });
            if (!gBody.ok) throw new Error(Object.values(gBody.errors)[0]);
            guardianId = (await createGuardian.mutateAsync(gBody.data)).guardian.id;
          }
          const lBody = validateWith(peopleLinkGuardianBodySchema, { guardianId, relationshipCode: e.relationshipCode, ...e.flags });
          if (!lBody.ok) throw new Error(Object.values(lBody.errors)[0]);
          await link.mutateAsync({ studentId: student.id, body: lBody.data });
          results[i] = { ...e, done: true, error: null };
        } catch (err) {
          const candidates = duplicateCandidatesOf(err);
          results[i] = { ...e, error: candidates.length > 0 ? t("guardians.duplicateGuardian", { name: candidates[0]!.displayName }) : err instanceof Error ? describe(err) : t("guardians.failed") };
        }
      }
      setEntries(results);
      setFinished(true);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (finished && created) {
    const failed = entries.filter((e) => !e.done);
    return (
      <div className="space-y-4">
        <PageHeader title={t("doneTitle")} />
        <Notice kind="success">{t("doneBody", { number: created.studentNumber, name: created.displayName })}</Notice>
        {failed.length > 0 ? (
          <Notice kind="warning">
            <p className="font-medium">{t("guardians.partial", { count: failed.length })}</p>
            <ul className="mt-1 list-disc pl-5">
              {failed.map((e) => (
                <li key={e.key}>{e.error}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link href={`/v2/students/${created.id}`} className={buttonClass.primary}>
            {t("openStudent")}
          </Link>
          <Link href={`/v2/enrollments/new?studentId=${created.id}`} className={buttonClass.secondary}>
            {t("enrollNow")}
          </Link>
          {failed.length > 0 ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setFinished(false)}>
              {t("retryGuardians")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const apiError = createStudent.error ?? createGuardian.error ?? link.error;
  const apiDup = duplicateCandidatesOf(createStudent.error);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <Wizard
        label={t("title")}
        finishLabel={t("finish")}
        isSubmitting={submitting}
        onFinish={finish}
        footerNotice={errors.duplicate ? <Notice kind="warning">{errors.duplicate}</Notice> : apiError && apiDup.length === 0 ? <ErrorBlock error={apiError} /> : null}
        steps={[
          {
            id: "identity",
            title: t("identityStep"),
            description: t("identityHint"),
            validate: validateIdentity,
            content: (
              <div className="space-y-4">
                {created ? <Notice kind="success">{t("alreadyCreated")}</Notice> : null}
                <fieldset disabled={!!created} className="space-y-4">
                  <IdentityFields value={identity} onChange={(v) => { setIdentity(v); setDuplicates([]); setAck(false); }} errors={errors} />
                </fieldset>
                <DuplicateWarning candidates={duplicates.length > 0 ? duplicates : apiDup} acknowledged={ack} onAcknowledge={setAck} reason={ackReason} onReason={setAckReason} reasonError={errors.duplicateReason} />
              </div>
            ),
          },
          {
            id: "guardians",
            title: t("guardiansStep"),
            description: t("guardiansHint"),
            validate: validateGuardians,
            content: (
              <div className="space-y-4">
                {entries.length === 0 ? <p className="text-sm text-muted-foreground">{t("guardians.none")}</p> : null}
                {entries.map((e, i) => (
                  <fieldset key={e.key} disabled={e.done} className="space-y-4 rounded-md border p-3">
                    <legend className="px-1 text-sm font-semibold">{t("guardians.entry", { n: i + 1 })}</legend>
                    {e.kind === "existing" ? (
                      <FormField label={t("guardians.search")} required error={errors[`g${i}.existing`]}>
                        {(c) => <SelectAsync {...c} value={e.existing} onChange={(o) => update(e.key, { existing: o })} useOptions={useGuardianOptions} placeholder={t("guardians.searchPlaceholder")} ariaLabel={t("guardians.search")} />}
                      </FormField>
                    ) : (
                      <>
                        <IdentityFields value={e.identity} onChange={(v) => update(e.key, { identity: v })} errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`g${i}.`)).map(([k, v]) => [k.slice(`g${i}.`.length), v]))} prefix="person" sexRequired={false} compact />
                        <FormField label={t("guardians.occupation")}>
                          {(c) => <TextControl {...c} value={e.occupation} onChange={(v) => update(e.key, { occupation: v })} maxLength={160} />}
                        </FormField>
                      </>
                    )}
                    <RelationshipSelect value={e.relationshipCode} onChange={(v) => update(e.key, { relationshipCode: v })} error={errors[`g${i}.relationshipCode`]} />
                    <FlagsFields value={e.flags} onChange={(flags) => update(e.key, { flags })} />
                    {e.done ? <Notice kind="success">{t("guardians.linked")}</Notice> : null}
                    {e.error ? <Notice kind="error">{e.error}</Notice> : null}
                    {!e.done ? (
                      <button type="button" className={buttonClass.ghost} onClick={() => setEntries((list) => list.filter((x) => x.key !== e.key))}>
                        {t("guardians.remove")}
                      </button>
                    ) : null}
                  </fieldset>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass.secondary} onClick={() => setEntries((l) => [...l, newEntry("existing")])}>
                    {t("guardians.addExisting")}
                  </button>
                  <button type="button" className={buttonClass.secondary} onClick={() => setEntries((l) => [...l, newEntry("new")])}>
                    {t("guardians.addNew")}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t("guardians.optionalNote")}</p>
              </div>
            ),
          },
          {
            id: "review",
            title: t("reviewStep"),
            content: (
              <div className="space-y-3">
                <dl className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("review.name")}</dt>
                    <dd>{`${identity.lastName} ${identity.firstName}`.trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("review.birthDate")}</dt>
                    <dd>{identity.birthDate || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("review.guardians")}</dt>
                    <dd>{entries.length}</dd>
                  </div>
                </dl>
                <Notice kind="info">{t("review.numberNote")}</Notice>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
