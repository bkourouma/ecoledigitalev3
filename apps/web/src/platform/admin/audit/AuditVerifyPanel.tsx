"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, LoadingState, NativeSelect, Notice, Field } from "@ecoledigitale/ui";
import { ApiErrorState } from "../common";
import { useAuditVerify } from "./hooks";
import { toIsoInstant, type AuditFilterState } from "./filters";

/**
 * Vérification de la chaîne d'audit. Lancée à la demande (jamais à l'affichage) : sur toute la chaîne ou sur la période
 * des filtres appliqués. Le résultat est annoncé (`role="status"` / `alert` selon le verdict).
 */
export function AuditVerifyPanel({ filters }: { filters: AuditFilterState }) {
  const t = useTranslations("audit.verify");
  const [scope, setScope] = useState<"all" | "period">("all");
  const verify = useAuditVerify();

  const period = { from: toIsoInstant(filters.from) ?? undefined, to: toIsoInstant(filters.to) ?? undefined };
  const hasPeriod = Boolean(period.from || period.to);

  const start = () => {
    if (verify.started) void verify.refetch();
    else verify.run(scope === "period" ? period : {});
  };

  return (
    <section aria-labelledby="audit-verify-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="audit-verify-title" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t("scope")} className="sm:w-72">
          {(c) => (
            <NativeSelect
              {...c}
              value={scope}
              disabled={verify.started}
              onChange={(e) => setScope(e.target.value === "period" ? "period" : "all")}
            >
              <option value="all">{t("scopeAll")}</option>
              <option value="period" disabled={!hasPeriod}>
                {t("scopePeriod")}
              </option>
            </NativeSelect>
          )}
        </Field>
        <Button type="button" className="min-h-11 sm:min-h-10" disabled={verify.isFetching} onClick={start}>
          {verify.isFetching ? t("running") : verify.started ? t("rerun") : t("run")}
        </Button>
      </div>

      {verify.isFetching ? <LoadingState label={t("running")} rows={1} /> : null}
      {verify.isError ? <ApiErrorState error={verify.error} onRetry={() => void verify.refetch()} /> : null}

      {verify.data && !verify.isFetching ? <VerifyResult result={verify.data} /> : null}
    </section>
  );
}

function VerifyResult({ result }: { result: NonNullable<ReturnType<typeof useAuditVerify>["data"]> }) {
  const t = useTranslations("audit.verify");
  const anchorLabel =
    result.anchor === "genesis" ? t("anchorGenesis") : result.anchor === "trusted-anchor" ? t("anchorTrusted") : t("anchorEmpty");

  if (result.checked === 0 && result.ok) {
    return <Notice tone="info">{t("empty")}</Notice>;
  }

  return (
    <div className="space-y-3">
      <Notice tone={result.ok ? "success" : "danger"}>
        <p className="font-semibold">{result.ok ? t("ok") : t("ko")}</p>
        <p>
          {result.ok
            ? t("okDetail", { checked: result.checked, first: result.firstSeq ?? 0, last: result.lastSeq ?? 0 })
            : t("koDetail", { checked: result.checked })}
        </p>
        <p className="mt-1 text-xs">
          {t("anchor")} : {anchorLabel}
          {result.headSeq !== null ? ` — ${t("head", { seq: result.headSeq })}` : ""}
        </p>
      </Notice>

      {result.issues.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("issues")}</h3>
          <ul className="space-y-2">
            {result.issues.map((issue, index) => (
              <li key={`${issue.kind}-${issue.seq ?? "x"}-${index}`} className="rounded-md border p-2 text-sm">
                <span className="font-medium">{t(`kinds.${issue.kind}` as never)}</span>
                {issue.seq !== null ? <span className="ml-2 text-xs text-muted-foreground">{t("issueSeq", { seq: issue.seq })}</span> : null}
                <p className="text-xs text-muted-foreground">{issue.detail}</p>
              </li>
            ))}
          </ul>
          {result.issuesTruncated ? <p className="mt-2 text-xs text-muted-foreground">{t("truncated")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
