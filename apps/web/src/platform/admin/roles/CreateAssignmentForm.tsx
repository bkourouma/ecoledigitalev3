"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, NativeSelect, Notice } from "@ecoledigitale/ui";
import type { RbacRoleSummary } from "@ecoledigitale/contracts/v2/rbac";
import type { MemberSummary } from "@ecoledigitale/contracts/v2/iam";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useCampuses, useInstitutions } from "../tenancy/hooks";
import { useErrorMessage } from "../use-error-message";
import {
  EMPTY_ASSIGNMENT_FORM,
  toCreateBody,
  validateAssignmentForm,
  type AssignmentFormErrors,
  type AssignmentFormState,
  type ScopeType,
} from "./assignments";
import { useCreateAssignment } from "./hooks";

export interface CreateAssignmentFormProps {
  roles: readonly RbacRoleSummary[];
  /** `null` : liste des membres inaccessible (droits) -> saisie libre de l'identifiant. */
  members: readonly MemberSummary[] | null;
}

/**
 * Nouvelle attribution : utilisateur, rôle, périmètre (tenant / établissement / campus) et validité. L'anti-escalade
 * est annoncée avant l'envoi ; son refus par l'API est restitué tel quel avec les permissions manquantes.
 */
export function CreateAssignmentForm({ roles, members }: CreateAssignmentFormProps) {
  const t = useTranslations("access.assignments.create");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const create = useCreateAssignment();
  const [form, setForm] = useState<AssignmentFormState>(EMPTY_ASSIGNMENT_FORM);
  const [errors, setErrors] = useState<AssignmentFormErrors>({});

  const needsInstitution = form.scopeType !== "tenant";
  const institutions = useInstitutions();
  const campuses = useCampuses(form.scopeType === "campus" && form.institutionId ? form.institutionId : null);

  const set = <K extends keyof AssignmentFormState>(key: K, value: AssignmentFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const errorText = (key: keyof AssignmentFormErrors) => (errors[key] ? t(`errors.${errors[key]}` as never) : undefined);
  const server = fieldErrorsOf(create.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateAssignmentForm(form);
    setErrors(found);
    const body = toCreateBody(form);
    if (Object.keys(found).length > 0 || !body) return;
    create.mutate(body, {
      onSuccess: () => {
        notifySuccess(t("done"));
        setForm(EMPTY_ASSIGNMENT_FORM);
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-labelledby="assignment-create-title" className="space-y-4 rounded-lg border p-4">
      <h2 id="assignment-create-title" className="text-base font-semibold">
        {t("title")}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {members ? (
          <Field label={t("user")} required requiredLabel={tu("required")} error={errorText("userId") ?? server.userId}>
            {(c) => (
              <NativeSelect {...c} value={form.userId} onChange={(e) => set("userId", e.target.value)}>
                <option value="">{t("userChoose")}</option>
                {members.map((m) => (
                  <option key={m.membershipId} value={m.identityId}>
                    {m.email}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : (
          <Field label={t("userId")} hint={t("userIdHint")} required requiredLabel={tu("required")} error={errorText("userId") ?? server.userId}>
            {(c) => <Input {...c} value={form.userId} onChange={(e) => set("userId", e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
        )}

        <Field label={t("role")} required requiredLabel={tu("required")} error={errorText("roleId") ?? server.roleId}>
          {(c) => (
            <NativeSelect {...c} value={form.roleId} onChange={(e) => set("roleId", e.target.value)}>
              <option value="">{t("roleChoose")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Field label={t("scopeType")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={form.scopeType}
              onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as ScopeType, institutionId: "", campusId: "" }))}
            >
              <option value="tenant">{t("scopeTenant")}</option>
              <option value="institution">{t("scopeInstitution")}</option>
              <option value="campus">{t("scopeCampus")}</option>
            </NativeSelect>
          )}
        </Field>

        {needsInstitution ? (
          <Field label={t("institution")} required requiredLabel={tu("required")} error={errorText("institutionId")}>
            {(c) => (
              <NativeSelect {...c} value={form.institutionId} onChange={(e) => setForm((f) => ({ ...f, institutionId: e.target.value, campusId: "" }))}>
                <option value="">{t("institutionChoose")}</option>
                {(institutions.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}

        {form.scopeType === "campus" ? (
          <Field label={t("campus")} required requiredLabel={tu("required")} error={errorText("campusId")}>
            {(c) => (
              <NativeSelect {...c} value={form.campusId} disabled={!form.institutionId} onChange={(e) => set("campusId", e.target.value)}>
                <option value="">{t("campusChoose")}</option>
                {(campuses.data ?? []).map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}

        <Field label={t("validFrom")} hint={t("validityHint")}>
          {(c) => <Input {...c} type="datetime-local" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} />}
        </Field>
        <Field label={t("validUntil")} error={errorText("validUntil")}>
          {(c) => <Input {...c} type="datetime-local" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />}
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">{t("escalationHint")}</p>
      {create.error ? <Notice tone="danger">{message(create.error)}</Notice> : null}
      <Button type="submit" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={create.isPending}>
        {create.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
