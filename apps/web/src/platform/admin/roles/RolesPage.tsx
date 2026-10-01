"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy, Plus } from "lucide-react";
import { Button, EmptyState, LoadingState, PageHeader, ResponsiveTable, StatusBadge, type Column } from "@ecoledigitale/ui";
import type { RbacRoleSummary } from "@ecoledigitale/contracts/v2/rbac";
import { usePermission } from "@/platform/access";
import { ApiErrorState } from "../common";
import { CloneRoleDialog } from "./CloneRoleDialog";
import { MfaSessionNotice } from "./access-info";
import { useRoles } from "./hooks";

export function roleHref(id: string): string {
  return `/v2/access/roles/${id}`;
}

/** `/v2/access/roles` : liste des rôles du tenant (système verrouillés et personnalisés). */
export function RolesPage() {
  const t = useTranslations("access.roles");
  const tu = useTranslations("ui");
  const roles = useRoles();
  const manage = usePermission("rbac.role.manage");
  const [cloning, setCloning] = useState<RbacRoleSummary | null>(null);

  const columns: Column<RbacRoleSummary>[] = [
    {
      key: "label",
      header: t("label"),
      cell: (r) => (
        <span>
          <Link
            href={roleHref(r.id)}
            aria-label={t("open", { label: r.label })}
            className="font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {r.label}
          </Link>
          <span className="block font-mono text-xs text-muted-foreground">{r.key}</span>
        </span>
      ),
    },
    {
      key: "type",
      header: t("type"),
      cell: (r) => <StatusBadge tone={r.isSystem ? "info" : "neutral"}>{r.isSystem ? t("system") : t("custom")}</StatusBadge>,
    },
    {
      key: "permissions",
      header: t("permissions"),
      cell: (r) => (
        <span>
          {t("permissionsCount", { count: r.permissionCount })}
          {r.pendingCount > 0 ? <span className="block text-xs text-amber-800">{t("pending", { count: r.pendingCount })}</span> : null}
        </span>
      ),
    },
    { key: "assignments", header: t("assignments"), hideOnMobile: true, cell: (r) => t("assignmentsCount", { count: r.assignmentCount }) },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      label: "",
      cell: (r) =>
        manage.allowed ? (
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("cloneRole", { label: r.label })} onClick={() => setCloning(r)}>
            <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
            {t("clone")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manage.allowed ? (
            <Button asChild className="min-h-11 sm:min-h-10">
              <Link href="/v2/access/roles/new">
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                {t("new")}
              </Link>
            </Button>
          ) : null
        }
      />
      <MfaSessionNotice />
      {roles.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {roles.isError ? <ApiErrorState error={roles.error} onRetry={() => void roles.refetch()} /> : null}
      {roles.data && roles.data.length === 0 ? <EmptyState title={t("empty")} description={t("emptyHint")} /> : null}
      {roles.data && roles.data.length > 0 ? <ResponsiveTable columns={columns} rows={roles.data} rowKey={(r) => r.id} caption={t("caption")} /> : null}
      <CloneRoleDialog role={cloning} onClose={() => setCloning(null)} />
    </div>
  );
}
