"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { traceRecordsOf, useExplain, type Explanation, type TraceRecordDto } from "@/platform/v2/results";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, QueryBoundary } from "@/platform/ui/states";
import { toneOfStatus, useNodeLabels } from "../../assessments/_components/shared";
import { shortHash } from "./shared";

/**
 * « Pourquoi ce résultat ? » : version de règle, empreintes d'entrées et de sorties et trace de chaque ligne (étapes de
 * règle, contexte de l'appel, pas de calcul du moteur). Un résultat FINAL affiche la trace STOCKÉE ; un brouillon est
 * expliqué par un REJEU avec les données courantes (rien n'est enregistré).
 */
export function ExplainScreen({ resultId, classroomId = "" }: { resultId: string; classroomId?: string }) {
  const t = useTranslations("v2Results.explain");
  const query = useExplain(resultId);
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          classroomId ? (
            <Link href={`/v2/results/matrix?classroom=${classroomId}`} className={buttonClass.secondary}>
              {t("back")}
            </Link>
          ) : null
        }
      />
      <QueryBoundary query={query}>{query.data ? <ExplainBody data={query.data} classroomId={classroomId} /> : null}</QueryBoundary>
    </div>
  );
}

function ExplainBody({ data, classroomId }: { data: Explanation; classroomId: string }) {
  const t = useTranslations("v2Results.explain");
  const tResult = useTranslations("v2Results.resultStatus");
  const date = useDateFormat();
  const nodeLabels = useNodeLabels(classroomId || null);
  const h = data.header;
  return (
    <div className="space-y-6">
      <Notice kind={data.source === "STORED" ? "success" : "warning"}>{t(data.source === "STORED" ? "sourceStored" : "sourceReplay")}</Notice>
      <section aria-label={t("headerTitle")} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{t("headerTitle")}</h2>
          <StatusBadge label={tResult(h.status)} tone={toneOfStatus(h.status)} />
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t("ruleSet")}>{`${h.ruleSetCode} · v${h.ruleVersionNo}`}</Info>
          <Info label={t("contract")}>{h.contractId}</Info>
          <Info label={t("engine")}>{h.engineVersion}</Info>
          <Info label={t("version")}>{h.version}</Info>
          <Info label={t("computedAt")}>{date.instant(h.computedAt)}</Info>
          <Info label={t("finalizedAt")}>{date.instant(h.finalizedAt)}</Info>
          <Info label={t("definitionHash")}>
            <Hash value={h.definitionHash} />
          </Info>
          <Info label={t("inputsHash")}>
            <Hash value={h.inputsHash} />
          </Info>
          <Info label={t("outputsHash")}>
            <Hash value={h.outputsHash} />
          </Info>
          <Info label={t("average")}>{showDecimal(h.averageDisplay ?? h.average)}</Info>
        </dl>
      </section>

      <section aria-labelledby="lines-h" className="space-y-2">
        <h2 id="lines-h" className="text-lg font-semibold">
          {t("lines", { count: data.lines.length })}
        </h2>
        {data.lines.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLines")}</p> : null}
        <ul className="space-y-2">
          {data.lines.map((line, i) => {
            const records = traceRecordsOf(line.trace);
            const title = [t(`levels.${line.level}`), line.curriculumNodeId ? (nodeLabels.get(line.curriculumNodeId) ?? line.curriculumNodeId.slice(0, 8)) : null].filter(Boolean).join(" · ");
            return (
              <li key={`${line.level}-${line.curriculumNodeId ?? "x"}-${i}`}>
                <details className="rounded-md border">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                    <span>{title}</span>
                    <span className="flex flex-wrap items-center gap-2 font-normal">
                      <span className="tabular-nums">{showDecimal(line.value)}</span>
                      {line.statusCode ? <StatusBadge label={line.statusCode} tone="neutral" /> : null}
                      {line.overridden ? <StatusBadge label={t("overridden")} tone="warning" /> : null}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t p-3">
                    {records.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTrace")}</p> : <TraceTable records={records} />}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function TraceTable({ records }: { records: TraceRecordDto[] }) {
  const t = useTranslations("v2Results.explain");
  return (
    <ol className="space-y-3" aria-label={t("steps")}>
      {records.map((r, i) => (
        <li key={`${r.ruleKey}-${i}`} className="rounded-md bg-white/[0.04] p-3 text-sm">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono font-medium">{r.ruleKey}</span>
            <span className="tabular-nums">{r.value === null || r.value === undefined ? "—" : String(r.value)}</span>
          </p>
          {r.overridden ? <p className="mt-1 text-xs text-amber-300">{t("overriddenFrom", { value: String(r.overridden.original ?? "—") })}</p> : null}
          <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            {r.nodesEvaluated !== undefined ? <span>{t("nodes", { count: r.nodesEvaluated })}</span> : null}
            {r.inputsHash ? (
              <span>
                {t("inputsHash")} <Hash value={r.inputsHash} />
              </span>
            ) : null}
            {r.outputsHash ? (
              <span>
                {t("outputsHash")} <Hash value={r.outputsHash} />
              </span>
            ) : null}
          </p>
          {r.variables && Object.keys(r.variables).length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">{t("variables", { count: Object.keys(r.variables).length })}</summary>
              <table className="mt-1 w-full text-left text-xs">
                <caption className="sr-only">{t("variablesCaption", { rule: r.ruleKey })}</caption>
                <tbody>
                  {Object.entries(r.variables).map(([k, v]) => (
                    <tr key={k} className="border-t">
                      <th scope="row" className="py-0.5 pr-3 font-mono font-normal">{k}</th>
                      <td className="py-0.5 break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          <Steps trace={r.trace} />
        </li>
      ))}
    </ol>
  );
}

interface EngineStep {
  seq: number;
  kind: string;
  label: string;
  source: string;
  type: string;
  value: unknown;
}

function engineSteps(trace: unknown): EngineStep[] {
  if (!Array.isArray(trace)) return [];
  return trace.filter((s): s is EngineStep => Boolean(s) && typeof s === "object" && typeof (s as EngineStep).seq === "number");
}

function Steps({ trace }: { trace: unknown }) {
  const t = useTranslations("v2Results.explain");
  const steps = engineSteps(trace);
  if (steps.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium">{t("engineSteps", { count: steps.length })}</summary>
      <table className="mt-1 w-full text-left text-xs">
        <caption className="sr-only">{t("engineStepsCaption")}</caption>
        <thead>
          <tr>
            <th scope="col" className="py-0.5 pr-2">#</th>
            <th scope="col" className="py-0.5 pr-2">{t("stepLabel")}</th>
            <th scope="col" className="py-0.5 pr-2">{t("stepSource")}</th>
            <th scope="col" className="py-0.5">{t("stepValue")}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.seq} className="border-t">
              <td className="py-0.5 pr-2 tabular-nums">{s.seq}</td>
              <td className="py-0.5 pr-2">{s.label}</td>
              <td className="py-0.5 pr-2 font-mono">{s.source}</td>
              <td className="py-0.5 break-all">{s.value === null || s.value === undefined ? "—" : String(s.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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

function Hash({ value }: { value: string | null }) {
  return (
    <span title={value ?? undefined} className="font-mono text-xs">
      {shortHash(value)}
    </span>
  );
}
