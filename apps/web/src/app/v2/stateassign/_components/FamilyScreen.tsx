"use client";

import { useTranslations } from "next-intl";
import { useMyChildren } from "@/platform/v2/people";
import { useChildAssignment } from "@/platform/v2/stateassign";
import { useDateFormat } from "@/platform/ui/format";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { ASSIGNMENT_TONE } from "./stateassign-utils";

/** Statut de l'affectation d'un enfant : le STATUT seulement, jamais les montants de l'État, les échéances, les écarts ni les contrôles. */
export function ChildAssignmentCard({ studentId, name }: { studentId: string; name: string }) {
  const t = useTranslations("v2Stateassign.family");
  const tStatus = useTranslations("v2Stateassign.status");
  const date = useDateFormat();
  const query = useChildAssignment(studentId);
  return (
    <section aria-labelledby={`child-${studentId}`} className="space-y-2 rounded-lg border p-4">
      <h2 id={`child-${studentId}`} className="text-lg font-semibold">{name}</h2>
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && !query.data.hasAssignment ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      {query.data?.hasAssignment && query.data.status ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("status")}</dt>
            <dd><StatusBadge label={tStatus(query.data.status)} tone={ASSIGNMENT_TONE[query.data.status]} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("reference")}</dt>
            <dd>{query.data.reference ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("issuedOn")}</dt>
            <dd>{date.civil(query.data.issuedOn)}</dd>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">{query.data.verified ? t("verified") : t("notVerified")}</p>
        </dl>
      ) : null}
    </section>
  );
}

/** Vue famille : un bloc par enfant lié (l'API ne renvoie que les enfants dont le compte est tuteur vivant). */
export function FamilyScreen() {
  const t = useTranslations("v2Stateassign.family");
  const children = useMyChildren();
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {children.isPending ? <LoadingBlock /> : null}
      {children.isError ? <ErrorBlock error={children.error} onRetry={() => void children.refetch()} /> : null}
      {children.data && children.data.length === 0 ? <EmptyBlock title={t("noChildren")} /> : null}
      <ul className="space-y-4" aria-label={t("list")}>
        {(children.data ?? []).map((c) => (
          <li key={c.id}>
            <ChildAssignmentCard studentId={c.id} name={c.displayName} />
          </li>
        ))}
      </ul>
    </div>
  );
}
