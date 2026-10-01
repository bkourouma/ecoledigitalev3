"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button, Notice } from "@ecoledigitale/ui";
import { usePermission } from "@/platform/access";
import { useErrorMessage } from "../use-error-message";
import { notifySuccess } from "../notify";
import { useAuditExport } from "./hooks";
import {
  AUDIT_EXPORT_MAX_DAYS,
  AUDIT_EXPORT_MAX_ROWS,
  validateExport,
  type AuditFilterErrors,
  type AuditFilterState,
} from "./filters";

export interface AuditExportButtonProps {
  filters: AuditFilterState;
  /** Remonte les erreurs de période au formulaire de filtres. */
  onErrors?: (errors: AuditFilterErrors) => void;
}

/**
 * Export CSV (permission sensible `audit.export`). Période obligatoire, validée avant l'appel ; le plafond de lignes
 * est annoncé. Sans permission : bouton désactivé avec l'explication (jamais masqué sans raison).
 */
export function AuditExportButton({ filters, onErrors }: AuditExportButtonProps) {
  const t = useTranslations("audit.export");
  const tFilters = useTranslations("audit.filters");
  const message = useErrorMessage();
  const permission = usePermission("audit.export");
  const exporter = useAuditExport();
  const [localErrors, setLocalErrors] = useState<AuditFilterErrors>({});

  const click = async () => {
    const errors = validateExport(filters);
    setLocalErrors(errors);
    onErrors?.(errors);
    if (Object.keys(errors).length > 0) return;
    const result = await exporter.run(filters);
    if (result) notifySuccess(t("done", { rows: result.rows ?? 0, filename: result.filename }));
  };

  const denied = !permission.isLoading && !permission.allowed;
  const periodError = localErrors.from ?? localErrors.to;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 sm:min-h-10"
        disabled={denied || permission.isLoading || exporter.pending}
        aria-describedby="audit-export-hint"
        onClick={() => void click()}
      >
        <Download className="mr-2 h-4 w-4" aria-hidden="true" />
        {exporter.pending ? t("pending") : t("button")}
      </Button>
      <p id="audit-export-hint" className="max-w-sm text-xs text-muted-foreground">
        {denied ? t("forbidden") : t("hint", { days: AUDIT_EXPORT_MAX_DAYS, rows: AUDIT_EXPORT_MAX_ROWS })}
      </p>
      {periodError && !onErrors ? <Notice tone="danger">{tFilters(`errors.${periodError}` as never, { days: AUDIT_EXPORT_MAX_DAYS } as never)}</Notice> : null}
      {exporter.error ? <Notice tone="danger">{message(exporter.error)}</Notice> : null}
      {exporter.last?.truncated ? <Notice tone="warning">{t("truncated", { rows: AUDIT_EXPORT_MAX_ROWS })}</Notice> : null}
    </div>
  );
}
