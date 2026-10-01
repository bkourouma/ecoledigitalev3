"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@ecoledigitale/ui";
import { AuditExportButton } from "./AuditExportButton";
import { AuditFiltersForm } from "./AuditFiltersForm";
import { AuditLogList } from "./AuditLogList";
import { AuditVerifyPanel } from "./AuditVerifyPanel";
import { EMPTY_FILTERS, type AuditFilterErrors, type AuditFilterState } from "./filters";

/** `/v2/audit` : recherche filtrée, vérification de la chaîne, export CSV. */
export function AuditPage() {
  const t = useTranslations("audit");
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [exportErrors, setExportErrors] = useState<AuditFilterErrors>({});

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<AuditExportButton filters={filters} onErrors={setExportErrors} />} />
      <AuditFiltersForm
        value={filters}
        externalErrors={exportErrors}
        onApply={(next) => {
          setExportErrors({});
          setFilters(next);
        }}
      />
      <AuditVerifyPanel filters={filters} />
      <AuditLogList filters={filters} />
    </div>
  );
}
