"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { buttonClass, DataTable, Notice, PageHeader, QueryBoundary, useDateFormat, useDescribeError, type DataTableColumn } from "@/platform/ui";
import type { ImportMappingTemplateDto } from "@ecoledigitale/contracts/v2/imports";
import { downloadImportFile, templatePath, useDeleteTemplate, useImporters, useMappingTemplates } from "@/platform/v2/imports";

/** Modèles de fichier à télécharger (un par importeur) et modèles de mapping enregistrés par l'établissement. */
export function TemplatesScreen() {
  const t = useTranslations("v2Imports.templates");
  const describe = useDescribeError();
  const dates = useDateFormat();
  const canManage = usePermission("imports.template.manage").allowed;
  const importers = useImporters();
  const mappings = useMappingTemplates(null);
  const remove = useDeleteTemplate();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function download(key: string, format: "csv" | "xlsx") {
    setError(null);
    try {
      await downloadImportFile(templatePath(key as never), { format }, `modele-import-${key}.${format}`);
    } catch (e) {
      setError(describe(e));
    }
  }
  const labelOf = (key: string): string => importers.data?.items.find((i) => i.key === key)?.label ?? key;

  const columns: Array<DataTableColumn<ImportMappingTemplateDto>> = [
    { id: "name", header: t("mapping.name"), headerLabel: t("mapping.name"), rowHeader: true, cell: (m) => <span className="font-medium">{m.name}</span> },
    { id: "importer", header: t("mapping.importer"), headerLabel: t("mapping.importer"), cell: (m) => labelOf(m.importerKey), className: "hidden sm:table-cell" },
    { id: "fields", header: t("mapping.fields"), headerLabel: t("mapping.fields"), cell: (m) => Object.values(m.mapping).filter(Boolean).length, className: "hidden md:table-cell" },
    { id: "updated", header: t("mapping.updated"), headerLabel: t("mapping.updated"), cell: (m) => dates.instant(m.updatedAt), className: "hidden md:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("mapping.actions")}</span>,
      headerLabel: t("mapping.actions"),
      cell: (m) =>
        !canManage ? null : confirming === m.id ? (
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass.danger} disabled={remove.isPending} onClick={() => remove.mutate({ id: m.id }, { onSuccess: () => setConfirming(null) })}>
              {t("mapping.confirmDelete")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirming(null)}>
              {t("mapping.cancel")}
            </button>
          </span>
        ) : (
          <button type="button" className={buttonClass.secondary} aria-label={t("mapping.deleteLabel", { name: m.name })} onClick={() => setConfirming(m.id)}>
            {t("mapping.delete")}
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="tpl-files" className="space-y-3">
        <h2 id="tpl-files" className="text-lg font-semibold">
          {t("files.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("files.hint")}</p>
        <QueryBoundary query={importers}>
          <ul className="grid gap-3 md:grid-cols-2">
            {(importers.data?.items ?? []).map((i) => (
              <li key={i.key} className="rounded-md border p-4">
                <h3 className="font-medium">{i.label}</h3>
                <p className="mb-3 text-sm text-muted-foreground">{i.description}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass.secondary} aria-label={t("files.xlsxLabel", { importer: i.label })} onClick={() => void download(i.key, "xlsx")}>
                    {t("files.xlsx")}
                  </button>
                  <button type="button" className={buttonClass.secondary} aria-label={t("files.csvLabel", { importer: i.label })} onClick={() => void download(i.key, "csv")}>
                    {t("files.csv")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </QueryBoundary>
        {error ? <Notice kind="error">{error}</Notice> : null}
      </section>

      <section aria-labelledby="tpl-mappings" className="space-y-3">
        <h2 id="tpl-mappings" className="text-lg font-semibold">
          {t("mapping.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("mapping.hint")}</p>
        {remove.isError ? <Notice kind="error">{describe(remove.error)}</Notice> : null}
        <DataTable
          caption={t("mapping.caption")}
          columns={columns}
          rows={mappings.data?.items ?? []}
          getRowId={(m) => m.id}
          isLoading={mappings.isLoading}
          error={mappings.error}
          onRetry={() => void mappings.refetch()}
          emptyTitle={t("mapping.empty")}
          emptyDescription={t("mapping.emptyHint")}
        />
      </section>
    </div>
  );
}
