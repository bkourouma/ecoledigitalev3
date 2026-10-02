"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AssignmentDetailDto } from "@ecoledigitale/contracts/v2/stateassign";
import { useAssignment } from "@/platform/v2/stateassign";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, QueryBoundary } from "@/platform/ui/states";
import { AssignmentActions } from "./AssignmentActions";
import { ControlsPanel } from "./ControlsPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { ReceivablesPanel } from "./ReceivablesPanel";
import { ASSIGNMENT_TONE, RECONCILIATION_TONE } from "./stateassign-utils";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Montants DÉCLARÉS par l'acte face aux montants FACTURÉS dans `finance` : l'écart est calculé par l'API, le statut par la base. */
function SharesBlock({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.detail.shares");
  const tRecon = useTranslations("v2Stateassign.reconciliation");
  const date = useDateFormat();
  const money = useMoney();
  const a = detail.assignment;
  const r = a.reconciliation;
  return (
    <section aria-labelledby="shares-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="shares-title" className="text-base font-semibold">{t("title")}</h2>
        <StatusBadge label={tRecon(r.status)} tone={RECONCILIATION_TONE[r.status]} />
      </div>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">{t("share")}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{t("declared")}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{t("billed")}</th>
              <th scope="col" className="py-1 text-right font-medium">{t("delta")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="py-1 pr-3 text-left font-medium">{t("state")}</th>
              <td className="py-1 pr-3 text-right">{money.of(a.declaredState)}</td>
              <td className="py-1 pr-3 text-right">{money.of(r.stateBilled)}</td>
              <td className="py-1 text-right">{money.of(r.stateDelta)}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1 pr-3 text-left font-medium">{t("parent")}</th>
              <td className="py-1 pr-3 text-right">{money.of(a.declaredParent)}</td>
              <td className="py-1 pr-3 text-right">{money.of(r.parentBilled)}</td>
              <td className="py-1 text-right">{money.of(r.parentDelta)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{r.lastReconciledAt ? t("lastReconciled", { date: date.instant(r.lastReconciledAt) }) : t("never")}</p>
      {r.status === "DISCREPANCY" ? <Notice kind="warning">{t("discrepancy")}</Notice> : null}
    </section>
  );
}

function VersionsAndHistory({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.detail.history");
  const tStatus = useTranslations("v2Stateassign.status");
  const tAction = useTranslations("v2Stateassign.detail.history.actions");
  const tActor = useTranslations("v2Stateassign.detail.history.actors");
  const date = useDateFormat();
  const money = useMoney();
  return (
    <section aria-labelledby="history-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="history-title" className="text-base font-semibold">{t("title")}</h2>
      <h3 className="text-sm font-medium">{t("versions")}</h3>
      <ul className="divide-y rounded-md border" aria-label={t("versionsList")}>
        {detail.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {t("version", { n: v.version })} · {v.reference}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("amounts", { state: money.of(v.declaredState), parent: money.of(v.declaredParent) })}
                {v.endedOn ? ` · ${t("endedOn", { date: date.civil(v.endedOn) })}` : ""}
                {v.endReason ? ` · ${v.endReason}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={tStatus(v.status)} tone={ASSIGNMENT_TONE[v.status]} />
              {v.id !== detail.assignment.id ? (
                <Link href={`/v2/stateassign/${v.id}`} className={buttonClass.ghost}>
                  {t("open")}
                  <span className="sr-only"> — {t("version", { n: v.version })}</span>
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="text-sm font-medium">{t("events")}</h3>
      <ol className="space-y-1" aria-label={t("eventsList")}>
        {[...detail.events].reverse().map((e) => (
          <li key={e.id} className="rounded-md border p-2 text-sm">
            <p className="font-medium">
              {tAction(e.action)}
              {e.toStatus ? ` · ${e.fromStatus ? `${tStatus(e.fromStatus)} → ` : ""}${tStatus(e.toStatus)}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {date.instant(e.occurredAt)} · {tActor(e.actorKind ?? "unknown")}
              {e.reason ? ` · ${e.reason}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DetailBody({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.detail");
  const tStatus = useTranslations("v2Stateassign.status");
  const tSource = useTranslations("v2Stateassign.source");
  const date = useDateFormat();
  const a = detail.assignment;
  const e = detail.enrollment;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title", { reference: a.reference, version: a.version })}
        description={a.studentName ?? t("unknownStudent")}
        actions={
          <Link href="/v2/stateassign" className={buttonClass.secondary}>
            {t("back")}
          </Link>
        }
      />
      <section aria-labelledby="summary-title" className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="summary-title" className="text-base font-semibold">{t("summary")}</h2>
          <StatusBadge label={tStatus(a.status)} tone={ASSIGNMENT_TONE[a.status]} />
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Field label={t("fields.authority")}>{a.issuingAuthority ?? "—"}</Field>
          <Field label={t("fields.issuedOn")}>{date.civil(a.issuedOn)}</Field>
          <Field label={t("fields.source")}>{tSource(a.source)}</Field>
          <Field label={t("fields.received")}>{date.instant(a.receivedAt)}</Field>
          <Field label={t("fields.verified")}>{a.verifiedAt ? date.instant(a.verifiedAt) : "—"}</Field>
          <Field label={t("fields.note")}>{a.verificationNote ?? "—"}</Field>
          {a.endedOn ? <Field label={t("fields.endedOn")}>{date.civil(a.endedOn)}</Field> : null}
          {a.endReason ? <Field label={t("fields.endReason")}>{a.endReason}</Field> : null}
          {a.suspensionReason && a.status === "SUSPENDED" ? <Field label={t("fields.suspension")}>{a.suspensionReason}</Field> : null}
          {a.rejectionReason ? <Field label={t("fields.rejection")}>{a.rejectionReason}</Field> : null}
          {a.notes ? <Field label={t("fields.notes")}>{a.notes}</Field> : null}
        </dl>
        {e ? (
          <p className="text-sm" data-testid="enrollment-check">
            {e.referenceMatchesAssignment ? t("enrollment.matches", { reference: e.assignmentReference ?? "—" }) : a.status === "RECEIVED" ? t("enrollment.pending") : t("enrollment.mismatch", { funding: e.fundingType, reference: e.assignmentReference ?? "—" })}
          </p>
        ) : null}
        <AssignmentActions a={a} />
      </section>
      <SharesBlock detail={detail} />
      <ReceivablesPanel detail={detail} />
      <ControlsPanel detail={detail} />
      <DocumentsPanel detail={detail} />
      <VersionsAndHistory detail={detail} />
    </div>
  );
}

/** Fiche d'un dossier : état, parts État / famille, créances, contrôles, pièces, versions et historique. Les actes sont ceux de l'API. */
export function AssignmentDetailScreen({ id }: { id: string }) {
  const query = useAssignment(id);
  return <QueryBoundary query={query}>{query.data ? <DetailBody detail={query.data} /> : null}</QueryBoundary>;
}
