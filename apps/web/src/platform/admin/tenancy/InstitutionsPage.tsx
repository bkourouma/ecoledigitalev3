"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, LoadingState, Notice, PageHeader, ResponsiveTable, StatusBadge, type Column, type StatusTone } from "@ecoledigitale/ui";
import type { Campus, EntityStatus, Institution } from "@ecoledigitale/contracts/v2/tenancy";
import { usePermission } from "@/platform/access";
import { ApiErrorState } from "../common";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCampuses, useDeleteCampus, useInstitutions, useUpdateCampus } from "./hooks";
import { CampusDialog, CreateInstitutionDialog, EditInstitutionDialog, type CampusDialogTarget } from "./InstitutionDialogs";

const STATUS_TONE: Record<EntityStatus, StatusTone> = { ACTIVE: "success", SUSPENDED: "warning", ARCHIVED: "neutral" };

/** `/v2/settings/institutions` : établissements et campus (création, modification, suppression de campus). */
export function InstitutionsPage() {
  const t = useTranslations("settings.institutions");
  const tSettings = useTranslations("settings");
  const tu = useTranslations("ui");
  const institutions = useInstitutions();
  const manage = usePermission("tenancy.institution.manage");
  const manageCampus = usePermission("tenancy.campus.manage");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Institution | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [campusTarget, setCampusTarget] = useState<CampusDialogTarget>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manage.allowed ? (
            <Button type="button" className="min-h-11 sm:min-h-10" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("new")}
            </Button>
          ) : null
        }
      />
      {!manage.allowed && !manage.isLoading ? <Notice tone="info">{tSettings("readOnly")}</Notice> : null}
      {institutions.isPending ? <LoadingState label={tu("loading")} rows={3} /> : null}
      {institutions.isError ? <ApiErrorState error={institutions.error} onRetry={() => void institutions.refetch()} /> : null}
      {institutions.data && institutions.data.length === 0 ? <EmptyState title={t("empty")} description={t("emptyHint")} /> : null}

      {institutions.data && institutions.data.length > 0 ? (
        <ul aria-label={t("list")} className="space-y-4">
          {institutions.data.map((institution) => {
            const open = openId === institution.id;
            const panelId = `campuses-${institution.id}`;
            return (
              <li key={institution.id} className="rounded-lg border">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-base font-semibold">{institution.name}</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="info">{t(`pack.${institution.pack}`)}</StatusBadge>
                      <StatusBadge tone={STATUS_TONE[institution.status]}>{t(`status.${institution.status}`)}</StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("code", { code: institution.code })} · {t("country", { country: institution.countryCode })} · {t("system", { system: institution.educationSystem })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {manage.allowed ? (
                      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("edit", { name: institution.name })} onClick={() => setEditing(institution)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      aria-expanded={open}
                      aria-controls={panelId}
                      aria-label={open ? t("hideCampuses", { name: institution.name }) : t("showCampuses", { name: institution.name })}
                      onClick={() => setOpenId(open ? null : institution.id)}
                    >
                      {open ? <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" /> : <ChevronRight className="mr-1 h-4 w-4" aria-hidden="true" />}
                      {t("campuses")}
                    </Button>
                  </div>
                </div>
                {open ? (
                  <div id={panelId} className="border-t p-4">
                    <CampusPanel institution={institution} canManage={manageCampus.allowed} onEdit={(campus) => setCampusTarget({ mode: "edit", campus })} onCreate={() => setCampusTarget({ mode: "create", institution })} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <CreateInstitutionDialog open={creating} onClose={() => setCreating(false)} />
      <EditInstitutionDialog institution={editing} onClose={() => setEditing(null)} />
      <CampusDialog target={campusTarget} onClose={() => setCampusTarget(null)} />
    </div>
  );
}

function CampusPanel({
  institution,
  canManage,
  onEdit,
  onCreate,
}: {
  institution: Institution;
  canManage: boolean;
  onEdit: (campus: Campus) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("settings.campuses");
  const tStatus = useTranslations("settings.institutions.status");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const campuses = useCampuses(institution.id);
  const update = useUpdateCampus();
  const del = useDeleteCampus();
  const [deleting, setDeleting] = useState<Campus | null>(null);

  const columns: Column<Campus>[] = [
    {
      key: "name",
      header: t("name"),
      cell: (c) => (
        <span>
          {c.name}
          {c.isDefault ? <StatusBadge tone="info" className="ml-2">{t("default")}</StatusBadge> : null}
          <span className="block font-mono text-xs text-muted-foreground">{c.code}</span>
        </span>
      ),
    },
    { key: "city", header: t("city"), hideOnMobile: true, cell: (c) => c.city ?? tu("dash") },
    { key: "status", header: t("status"), cell: (c) => <StatusBadge tone={STATUS_TONE[c.status]}>{tStatus(c.status)}</StatusBadge> },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      label: "",
      cell: (c) =>
        canManage ? (
          <span className="flex flex-wrap justify-end gap-2 md:justify-start">
            {!c.isDefault ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                aria-label={t("makeDefault", { name: c.name })}
                disabled={update.isPending}
                onClick={() => update.mutate({ id: c.id, isDefault: true }, { onSuccess: () => notifySuccess(t("form.defaultDone")) })}
              >
                <Star className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("edit", { name: c.name })} onClick={() => onEdit(c)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("delete", { name: c.name })} onClick={() => setDeleting(c)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      ) : null}
      {campuses.isPending ? <LoadingState label={tu("loading")} rows={2} /> : null}
      {campuses.isError ? <ApiErrorState error={campuses.error} onRetry={() => void campuses.refetch()} /> : null}
      {update.error ? <Notice tone="danger">{message(update.error)}</Notice> : null}
      {campuses.data && campuses.data.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {campuses.data && campuses.data.length > 0 ? (
        <ResponsiveTable columns={columns} rows={campuses.data} rowKey={(c) => c.id} caption={t("caption", { name: institution.name })} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            del.reset();
          }
        }}
        title={t("deleteTitle")}
        description={deleting ? t("deleteBody", { name: deleting.name }) : ""}
        confirmLabel={tu("confirm")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        destructive
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(
            { id: deleting.id },
            {
              onSuccess: () => {
                notifySuccess(t("deleteDone"));
                setDeleting(null);
              },
            },
          )
        }
      >
        {del.error ? <Notice tone="danger">{message(del.error)}</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}
