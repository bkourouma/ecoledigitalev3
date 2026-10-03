"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button, Field, Input, LoadingState, Notice, PageHeader } from "@ecoledigitale/ui";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";
import { ApiErrorState } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { MfaSessionNotice, useHeldPermissions } from "./access-info";
import { useCreateRole, usePermissionCatalog } from "./hooks";
import { PermissionMatrix } from "./PermissionMatrix";

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

/** `/v2/access/roles/new` : création d'un rôle personnalisé (libellé, clé facultative, permissions). */
export function RoleCreatePage() {
  const t = useTranslations("access.form");
  const tBack = useTranslations("access.detail");
  const tu = useTranslations("ui");
  const router = useRouter();
  const message = useErrorMessage();
  const catalog = usePermissionCatalog();
  const held = useHeldPermissions();
  const create = useCreateRole();
  const stepUp = useStepUp();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<{ label?: string; key?: string }>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!label.trim()) found.label = t("labelRequired");
    if (key.trim() && !KEY_PATTERN.test(key.trim())) found.key = t("keyInvalid");
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = {
      label: label.trim(),
      permissions: [...selected].sort(),
      ...(key.trim() ? { key: key.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    // Gestion des rôles = permission sensible : refus `rbac.mfa_required` -> confirmation TOTP puis relance unique.
    void stepUp.run(() => create.mutateAsync(body)).then(
      (role) => {
        notifySuccess(t("created", { label: role.label }));
        router.push(`/v2/access/roles/${role.id}`);
      },
      () => undefined,
    );
  };

  const server = fieldErrorsOf(create.error);

  return (
    <div className="space-y-6">
      <Link
        href="/v2/access/roles"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tBack("back")}
      </Link>
      <PageHeader title={t("createTitle")} description={t("createDescription")} />
      <MfaSessionNotice />
      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("label")} required requiredLabel={tu("required")} error={errors.label ?? server.label}>
            {(c) => <Input {...c} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label={t("key")} hint={t("keyHint")} error={errors.key ?? server.key}>
            {(c) => <Input {...c} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t("description")} className="sm:col-span-2" error={server.description}>
            {(c) => <Input {...c} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>

        {catalog.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
        {catalog.isError ? <ApiErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : null}
        {catalog.data ? <PermissionMatrix catalog={catalog.data} selected={selected} onChange={setSelected} held={held} /> : null}

        {create.error ? <Notice tone="danger">{message(create.error)}</Notice> : null}
        <Button type="submit" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={create.isPending || catalog.isPending}>
          {create.isPending ? t("creating") : t("submit")}
        </Button>
      </form>
      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
}
