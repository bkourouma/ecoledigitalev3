"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleCreateStaffBodySchema, type PeopleStaffDetailDto } from "@ecoledigitale/contracts/v2/people";
import { duplicateCandidatesOf, useCreateStaff, useStaffCategories } from "@/platform/v2/people";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { DuplicateWarning, emptyIdentity, IdentityFields, identityToInput } from "../../students/_components/identity";

export function StaffCreate() {
  const t = useTranslations("v2Staff.create");
  const categories = useStaffCategories();
  const create = useCreateStaff();
  const [identity, setIdentity] = useState(emptyIdentity());
  const [job, setJob] = useState({ categoryCode: "", jobTitle: "", hiredOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const [created, setCreated] = useState<PeopleStaffDetailDto | null>(null);
  const candidates = duplicateCandidatesOf(create.error);

  async function submit() {
    const body = {
      person: identityToInput(identity),
      categoryCode: job.categoryCode,
      ...(job.jobTitle.trim() ? { jobTitle: job.jobTitle.trim() } : {}),
      ...(job.hiredOn ? { hiredOn: job.hiredOn } : {}),
      ...(ack ? { acknowledgeDuplicate: true, duplicateReason: reason.trim() } : {}),
    };
    const v = validateWith(peopleCreateStaffBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const result = await create.mutateAsync(v.data);
      if ("staff" in result) setCreated(result.staff);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("doneTitle")} />
        <Notice kind="success">{t("doneBody", { name: created.displayName, number: created.staffNumber })}</Notice>
        <div className="flex flex-wrap gap-2">
          <Link href={`/v2/staff/${created.id}`} className={buttonClass.primary}>
            {t("open")}
          </Link>
          <Link href="/v2/staff" className={buttonClass.secondary}>
            {t("backToList")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-6"
      >
        <IdentityFields value={identity} onChange={(v) => { setIdentity(v); setAck(false); create.reset(); }} errors={errors} sexRequired={false} />
        <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold">{t("job")}</legend>
          <FormField label={t("category")} required error={errors.categoryCode}>
            {(c) => <NativeSelect {...c} value={job.categoryCode} onChange={(v) => setJob((j) => ({ ...j, categoryCode: v }))} placeholder={t("choose")} options={(categories.data ?? []).filter((x) => x.active).map((x) => ({ value: x.code, label: x.label }))} />}
          </FormField>
          <FormField label={t("jobTitle")} error={errors.jobTitle}>
            {(c) => <TextControl {...c} value={job.jobTitle} onChange={(v) => setJob((j) => ({ ...j, jobTitle: v }))} maxLength={160} />}
          </FormField>
          <FormField label={t("hiredOn")} error={errors.hiredOn}>
            {(c) => <TextControl {...c} type="date" value={job.hiredOn} onChange={(v) => setJob((j) => ({ ...j, hiredOn: v }))} />}
          </FormField>
        </fieldset>
        <DuplicateWarning candidates={candidates} acknowledged={ack} onAcknowledge={setAck} reason={reason} onReason={setReason} reasonError={errors.duplicateReason} />
        {create.error && candidates.length === 0 ? <ErrorBlock error={create.error} /> : null}
        <button type="submit" className={buttonClass.primary} disabled={create.isPending}>
          {t("submit")}
        </button>
      </form>
    </div>
  );
}
