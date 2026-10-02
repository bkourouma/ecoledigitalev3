"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReportcardSnapshot } from "@ecoledigitale/contracts/v2/reportcards";
import { usePermission } from "@/platform/access";
import { cardDownloadPath, useReportCard, useReportCardExplain } from "@/platform/v2/reportcards";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { shortHash } from "../../results/_components/shared";
import { toneOfStatus } from "../../assessments/_components/shared";
import { CardActions } from "./CardsScreen";
import { DownloadButton } from "./shared";

/** QR du lien de vérification (SVG produit localement, aucune donnée ne quitte la page). */
function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((m) => m.toString(value, { type: "svg", margin: 1, width: 160 }))
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);
  if (!svg) return null;
  return <div role="img" aria-label={label} className="h-40 w-40 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function CardDetail({ id }: { id: string }) {
  const t = useTranslations("v2Reportcards.detail");
  const tStatus = useTranslations("v2Reportcards.status");
  const tRender = useTranslations("v2Reportcards.renderStatus");
  const date = useDateFormat();
  const flash = useFlash();
  const query = useReportCard(id);
  const canExplain = usePermission("reportcard.explain");
  const [showTrace, setShowTrace] = useState(false);
  const explain = useReportCardExplain(id, showTrace && canExplain.allowed);
  const card = query.data;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const verifyUrl = card ? `${origin}/v2/verify/${card.verificationCode}` : "";

  return (
    <QueryBoundary query={query}>
      {card ? (
        <div className="space-y-6">
          <PageHeader
            title={card.title}
            description={card.studentName}
            actions={
              <>
                <StatusBadge label={tStatus(card.status)} tone={toneOfStatus(card.status)} />
                <StatusBadge label={tRender(card.renderStatus)} tone={toneOfStatus(card.renderStatus)} />
                {card.provisional ? <StatusBadge label={t("provisional")} tone="warning" /> : null}
              </>
            }
          />
          {flash.node}
          {card.needsReissue ? <Notice kind="warning">{t("needsReissue")}</Notice> : null}
          {card.status === "SUPERSEDED" ? <Notice kind="info">{t("superseded", { date: date.instant(card.supersededAt) })}</Notice> : null}
          {card.status === "REVOKED" ? <Notice kind="error">{t("revoked", { date: date.instant(card.revokedAt) })}</Notice> : null}

          <div className="flex flex-wrap items-start gap-2">
            {card.renderStatus === "RENDERED" && (card.status === "ISSUED" || card.status === "PUBLISHED") ? <DownloadButton path={cardDownloadPath(card.id)} label={t("download")} variant="primary" /> : null}
            <CardActions card={card} onMessage={flash.show} />
          </div>
          <p className="text-xs text-muted-foreground">{t("downloadNote")}</p>

          <Summary snapshot={card.snapshot} />

          <section aria-labelledby="verif-h" className="space-y-2 rounded-md border p-4">
            <h2 id="verif-h" className="text-lg font-semibold">
              {t("verification")}
            </h2>
            <div className="flex flex-wrap items-start gap-4">
              <QrCode value={verifyUrl} label={t("qrLabel")} />
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("code")}</dt>
                  <dd className="font-mono text-base font-semibold tracking-wider" data-testid="verification-code">
                    {card.verificationCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("hash")}</dt>
                  <dd className="font-mono text-xs" title={card.snapshotHash}>
                    {shortHash(card.snapshotHash)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("link")}</dt>
                  <dd>
                    <Link href={`/v2/verify/${card.verificationCode}`} className="text-primary underline-offset-4 hover:underline">
                      {t("openVerify")}
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
            <p className="text-xs text-muted-foreground">{t("verificationNote")}</p>
          </section>

          <section aria-labelledby="renders-h" className="space-y-2">
            <h2 id="renders-h" className="text-lg font-semibold">
              {t("renders")}
            </h2>
            {card.renders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noRender")}</p>
            ) : (
              <ul className="space-y-2">
                {card.renders.map((r) => (
                  <li key={r.id} className="rounded-md border p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={tRender(r.status)} tone={toneOfStatus(r.status)} />
                      <span className="text-muted-foreground">{t("attempts", { count: r.attempts })}</span>
                      {r.pages !== null ? <span className="text-muted-foreground">{t("pages", { count: r.pages })}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("requestedAt", { date: date.instant(r.requestedAt) })}</p>
                    {r.error ? <p className="text-destructive">{r.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canExplain.allowed ? (
            <section aria-labelledby="trace-h" className="space-y-2">
              <h2 id="trace-h" className="text-lg font-semibold">
                {t("trace")}
              </h2>
              {!showTrace ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("traceAudited")}</p>
                  <button type="button" className={buttonClass.secondary} onClick={() => setShowTrace(true)}>
                    {t("showTrace")}
                  </button>
                </>
              ) : explain.isPending ? (
                <p className="text-sm text-muted-foreground">…</p>
              ) : explain.isError ? (
                <ErrorBlock error={explain.error} />
              ) : (
                <ul className="space-y-2 text-sm">
                  {(explain.data?.explain ?? []).map((e) => (
                    <li key={e.lineCode} className="rounded-md border p-2">
                      <p className="font-mono font-medium">{e.lineCode}</p>
                      <p className="text-xs text-muted-foreground">{e.rules.map((r) => `${r.key} = ${r.output === null ? "—" : String(r.output)}`).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </QueryBoundary>
  );
}

function Summary({ snapshot }: { snapshot: ReportcardSnapshot }) {
  const t = useTranslations("v2Reportcards.detail");
  const date = useDateFormat();
  const s = snapshot.results.summary;
  const label = (code: string | null) => (code ? (snapshot.labels[code] ?? code) : "—");
  return (
    <section aria-labelledby="sum-h" className="space-y-3 rounded-md border p-4">
      <h2 id="sum-h" className="text-lg font-semibold">
        {t("summary")}
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Info label={t("classroom")}>{snapshot.enrollment.classroomLabel ?? "—"}</Info>
        <Info label={t("period")}>{snapshot.enrollment.periodLabel ?? snapshot.enrollment.academicYearLabel}</Info>
        <Info label={t("average")}>{showDecimal(s.averageDisplay)}</Info>
        <Info label={t("rank")}>{s.rank !== null ? (s.classSize !== null ? t("rankOf", { rank: s.rank, total: s.classSize }) : s.rank) : "—"}</Info>
        <Info label={t("mention")}>{label(s.mention)}</Info>
        <Info label={t("decision")}>{label(s.decisionCode)}</Info>
        <Info label={t("credits")}>{s.creditsAcquired !== null ? `${showDecimal(s.creditsAcquired)} / ${showDecimal(s.creditsRequired)}` : "—"}</Info>
        <Info label={t("deliberation")}>{snapshot.deliberation ? t("deliberationOn", { date: date.civil(snapshot.deliberation.heldOn) }) : "—"}</Info>
        <Info label={t("rule")}>{`${snapshot.rules.ruleSetCode} · v${snapshot.rules.ruleVersionNo} (${t("resultsVersion", { version: snapshot.rules.resultsVersion })})`}</Info>
        <Info label={t("template")}>{`${snapshot.template.key} · v${snapshot.template.version}`}</Info>
      </dl>
      {snapshot.signatories.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t("signatories", { names: snapshot.signatories.map((x) => `${x.name} (${x.slotLabel})`).join(", ") })}</p>
      ) : null}
    </section>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
