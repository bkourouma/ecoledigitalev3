"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Notice,
  PageHeader,
  StatusBadge,
} from "@ecoledigitale/ui";
import type { RbacRoleDetail } from "@ecoledigitale/contracts/v2/rbac";
import { usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";
import { ApiErrorState } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { MfaSessionNotice, useHeldPermissions } from "./access-info";
import { CloneRoleDialog } from "./CloneRoleDialog";
import { useDeleteRole, usePermissionCatalog, useRole, useUpdateRole } from "./hooks";
import { diffPermissions, sameSet } from "./matrix";
import { PermissionMatrix } from "./PermissionMatrix";

/** `/v2/access/roles/[id]` : consultation, modification (rôles personnalisés), clonage et suppression. */
export function RoleDetailPage({ id }: { id: string }) {
  const t = useTranslations("access.detail");
  const tu = useTranslations("ui");
  const role = useRole(id);

  return (
    <div className="space-y-6">
      <Link
        href="/v2/access/roles"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      {role.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {role.isError ? (
        role.error instanceof ApiError && role.error.isNotFound ? (
          <EmptyState title={t("notFound")} />
        ) : (
          <ApiErrorState error={role.error} onRetry={() => void role.refetch()} />
        )
      ) : null}
      {role.data ? <RoleEditor key={`${role.data.id}:${role.data.updatedAt}`} role={role.data} /> : null}
    </div>
  );
}

function RoleEditor({ role }: { role: RbacRoleDetail }) {
  const t = useTranslations("access.detail");
  const tForm = useTranslations("access.form");
  const tRoles = useTranslations("access.roles");
  const tu = useTranslations("ui");
  const router = useRouter();
  const message = useErrorMessage();
  const catalog = usePermissionCatalog();
  const held = useHeldPermissions();
  const manage = usePermission("rbac.role.manage");
  const update = useUpdateRole();
  const del = useDeleteRole();
  const stepUp = useStepUp();

  const original = useMemo(() => new Set(role.permissions), [role.permissions]);
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [labelError, setLabelError] = useState<string | undefined>();

  const editable = !role.locked && manage.allowed;
  const labelChanged = label.trim() !== role.label;
  const descriptionChanged = (description.trim() || null) !== role.description;
  const permissionsChanged = !sameSet(selected, original);
  const dirty = labelChanged || descriptionChanged || permissionsChanged;
  const delta = diffPermissions(original, selected);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) {
      setLabelError(tForm("labelRequired"));
      return;
    }
    setLabelError(undefined);
    const body = {
      id: role.id,
      ...(labelChanged ? { label: label.trim() } : {}),
      ...(descriptionChanged ? { description: description.trim() || null } : {}),
      ...(permissionsChanged ? { permissions: [...selected].sort() } : {}),
    };
    // Permission sensible : refus `rbac.mfa_required` -> confirmation TOTP puis relance unique.
    void stepUp.run(() => update.mutateAsync(body)).then(() => notifySuccess(t("saved")), () => undefined);
  };

  const remove = () =>
    void stepUp.run(() => del.mutateAsync({ id: role.id })).then(
      () => {
        notifySuccess(t("deleted"));
        setConfirmDelete(false);
        router.push("/v2/access/roles");
      },
      () => undefined,
    );

  const server = fieldErrorsOf(update.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title={role.label}
        description={t("key", { key: role.key })}
        actions={
          <>
            <StatusBadge tone={role.isSystem ? "info" : "neutral"}>{role.isSystem ? tRoles("system") : tRoles("custom")}</StatusBadge>
            <span className="text-sm text-muted-foreground">{t("assignedTo", { count: role.assignmentCount })}</span>
            {manage.allowed ? (
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={() => setCloning(true)}>
                <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
                {tRoles("clone")}
              </Button>
            ) : null}
            {editable ? (
              <Button type="button" variant="destructive" className="min-h-11 sm:min-h-10" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                {t("delete")}
              </Button>
            ) : null}
          </>
        }
      />

      <MfaSessionNotice />
      {role.locked ? (
        <Notice tone="info">
          <p className="font-medium">{t("lockedTitle")}</p>
          <p>{t("lockedBody")}</p>
        </Notice>
      ) : null}
      {!role.locked && !manage.allowed && !manage.isLoading ? <Notice tone="info">{t("readOnly")}</Notice> : null}
      {role.clonedFromRoleId ? <p className="text-sm text-muted-foreground">{t("clonedFrom")}</p> : null}
      {role.pendingPermissions.length > 0 ? (
        <Notice tone="warning">
          <p className="font-medium">{t("pendingTitle")}</p>
          <p>{t("pendingBody", { patterns: role.pendingPermissions.join(", ") })}</p>
        </Notice>
      ) : null}

      <form onSubmit={save} noValidate className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tForm("label")} required={editable} requiredLabel={tu("required")} error={labelError ?? server.label}>
            {(c) => <Input {...c} value={label} readOnly={!editable} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label={tForm("description")} error={server.description}>
            {(c) => <Input {...c} value={description} readOnly={!editable} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>

        {catalog.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
        {catalog.isError ? <ApiErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : null}
        {catalog.data ? (
          <PermissionMatrix catalog={catalog.data} selected={selected} onChange={setSelected} readOnly={!editable} held={held} />
        ) : null}

        {update.error ? <Notice tone="danger">{message(update.error)}</Notice> : null}

        {editable ? (
          <div className="space-y-2">
            {permissionsChanged ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {[
                  delta.added.length > 0 ? t("changesAdded", { count: delta.added.length }) : null,
                  delta.removed.length > 0 ? t("changesRemoved", { count: delta.removed.length }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="min-h-11 sm:min-h-10" disabled={!dirty || update.isPending}>
                {update.isPending ? t("saving") : t("save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-10"
                disabled={!dirty || update.isPending}
                onClick={() => {
                  setLabel(role.label);
                  setDescription(role.description ?? "");
                  setSelected(new Set(role.permissions));
                  update.reset();
                }}
              >
                {t("reset")}
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) del.reset();
        }}
        title={t("deleteTitle")}
        description={t("deleteBody", { label: role.label })}
        confirmLabel={t("delete")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        destructive
        pending={del.isPending}
        onConfirm={remove}
      >
        {del.error ? <Notice tone="danger">{message(del.error)}</Notice> : null}
      </ConfirmDialog>

      <CloneRoleDialog role={cloning ? { id: role.id, label: role.label } : null} onClose={() => setCloning(false)} />
      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
}
