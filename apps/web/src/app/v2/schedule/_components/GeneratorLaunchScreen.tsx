"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { schedulingAutogenRunBodySchema } from "@ecoledigitale/contracts/v2/scheduling";
import { useAcademicYears, useClassroomNodes, useClassrooms } from "@/platform/v2/academic";
import { useInstitutions, useStaffOptions } from "@/platform/v2/lookups";
import { useAutogenDefaults, useStartAutogenRun, useTimetables } from "@/platform/v2/scheduling";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

interface NeedRow {
  key: number;
  classroomId: string;
  classLabel: string;
  nodeId: string;
  nodeLabel: string;
  sessions: string;
  periods: string;
  teacher: SelectOption | null;
}

const NUMBER_INPUT = "h-11 w-20 rounded-xl border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const WEIGHT_KEYS = ["gap", "teacherGap", "spread", "balance", "preference", "teacherChange"] as const;
const useTeacherOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { canTeach: true, status: "ACTIVE" });

/**
 * Lancement du générateur : cadre (année, validité), besoins (classe × matière × séances par semaine × durée × enseignant),
 * paramètres (jours, pondérations, graine, limites). Les contraintes dures (aucun conflit enseignant / classe / salle,
 * disponibilités déclarées, capacité des salles) sont toujours imposées par l'API ; ici on ne règle que les préférences.
 */
export function GeneratorLaunchScreen() {
  const t = useTranslations("v2Schedule.generator.launch");
  const tDay = useTranslations("v2Schedule.weekdayShort");
  const tWeights = useTranslations("v2Schedule.generator.weights");
  const router = useRouter();
  const institutions = useInstitutions();
  const years = useAcademicYears();
  const start = useStartAutogenRun();
  const apiErrors = apiErrorToFieldErrors(start.error);

  const [yearId, setYearId] = useState("");
  const year = (years.data ?? []).find((y) => y.id === (yearId || years.data?.find((x) => x.isCurrent)?.id || years.data?.[0]?.id));
  const institutionId = year?.institutionId ?? institutions.data?.[0]?.id ?? null;
  const defaults = useAutogenDefaults(institutionId);

  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<NeedRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [pickClass, setPickClass] = useState("");
  const [seed, setSeed] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [iterations, setIterations] = useState("");
  const [days, setDays] = useState<number[] | null>(null);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [fixedId, setFixedId] = useState("");
  const [derive, setDerive] = useState(false);
  // Grille saisie à la main quand l'établissement n'en a pas (QA C-03-03) : journée type en périodes régulières.
  const [dayStart, setDayStart] = useState("08:00");
  const [dayEnd, setDayEnd] = useState("17:00");
  const [periodMinutes, setPeriodMinutes] = useState("60");
  const [errors, setErrors] = useState<FieldErrors>({});

  const classrooms = useClassrooms({ academicYearId: year?.id, pageSize: 200 }, { enabled: Boolean(year?.id) });
  const nodes = useClassroomNodes(pickClass || null);
  const timetables = useTimetables({ ...(institutionId ? { institutionId } : {}), ...(year?.id ? { academicYearId: year.id } : {}) }, Boolean(year?.id));
  const classItems = classrooms.data?.items ?? [];
  const pickedClass = classItems.find((c) => c.id === pickClass) ?? null;

  const weekdays = days ?? defaults.data?.weekdays ?? [];
  const periods = defaults.data?.periods ?? [];
  const sessionTotal = useMemo(() => rows.reduce((n, r) => n + (Number.isInteger(Number(r.sessions)) ? Number(r.sessions) : 0), 0), [rows]);

  function addNode(nodeId: string, nodeLabel: string) {
    if (!pickedClass) return;
    if (rows.some((r) => r.classroomId === pickedClass.id && r.nodeId === nodeId)) return;
    setRows((prev) => [...prev, { key: nextKey, classroomId: pickedClass.id, classLabel: pickedClass.name, nodeId, nodeLabel, sessions: "1", periods: "1", teacher: null }]);
    setNextKey((k) => k + 1);
  }
  function addAll() {
    if (!pickedClass) return;
    const known = new Set(rows.filter((r) => r.classroomId === pickedClass.id).map((r) => r.nodeId));
    let key = nextKey;
    const added: NeedRow[] = [];
    for (const n of nodes.data ?? []) {
      if (known.has(n.nodeId)) continue;
      added.push({ key: key++, classroomId: pickedClass.id, classLabel: pickedClass.name, nodeId: n.nodeId, nodeLabel: n.label, sessions: "1", periods: "1", teacher: null });
    }
    setNextKey(key);
    setRows((prev) => [...prev, ...added]);
  }
  const patch = (key: number, over: Partial<NeedRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...over } : r)));

  function submit() {
    const w: Record<string, number> = {};
    for (const k of WEIGHT_KEYS) if (weights[k] !== undefined && weights[k] !== "") w[k] = Number(weights[k]);
    const body = {
      institutionId: institutionId ?? "",
      academicYearId: year?.id ?? "",
      name: name.trim(),
      validFrom: from || year?.startsOn || "",
      validTo: to || year?.endsOn || "",
      ...(seed.trim() ? { seed: seed.trim() } : {}),
      ...(timeLimit ? { timeLimitSeconds: Number(timeLimit) } : {}),
      ...(iterations ? { maxIterations: Number(iterations) } : {}),
      ...(days ? { weekdays: days } : {}),
      ...(defaults.data?.gridSource === "NONE" ? { grid: { mode: "REGULAR" as const, dayStart, dayEnd, periodMinutes: Number(periodMinutes) } } : {}),
      ...(Object.keys(w).length > 0 ? { weights: w } : {}),
      ...(fixedId ? { fixedTimetableId: fixedId } : {}),
      deriveTeachers: derive,
      requirements: rows.map((r) => ({
        classroomId: r.classroomId,
        curriculumNodeId: r.nodeId,
        label: `${r.nodeLabel} — ${r.classLabel}`,
        sessionsPerWeek: Number(r.sessions),
        sessionPeriods: Number(r.periods),
        teacherIds: r.teacher ? [r.teacher.value] : [],
      })),
    };
    const checked = validateWith(schedulingAutogenRunBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    start.mutate(checked.data as never, { onSuccess: (r) => router.push(`/v2/schedule/generator/${r.run.id}`) });
  }

  const fieldError = (path: string) => errors[path] ?? apiErrors[path];
  const rowErrors = Object.entries(errors).filter(([k]) => k.startsWith("requirements"));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-8"
    >
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("safety")}</Notice>

      <section aria-labelledby="gen-frame" className="space-y-4">
        <h2 id="gen-frame" className="text-lg font-semibold">
          {t("frame.title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("frame.year")} required error={fieldError("academicYearId")}>
            {(c) => <NativeSelect {...c} value={year?.id ?? ""} onChange={(v) => { setYearId(v); setRows([]); setPickClass(""); }} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
          </FormField>
          <FormField label={t("frame.name")} required error={fieldError("name")}>
            {(c) => <TextControl {...c} value={name} onChange={setName} maxLength={200} />}
          </FormField>
          <FormField label={t("frame.validFrom")} hint={t("frame.defaultYear")} error={fieldError("validFrom")}>
            {(c) => <TextControl {...c} type="date" value={from || year?.startsOn || ""} onChange={setFrom} />}
          </FormField>
          <FormField label={t("frame.validTo")} error={fieldError("validTo")}>
            {(c) => <TextControl {...c} type="date" value={to || year?.endsOn || ""} onChange={setTo} />}
          </FormField>
        </div>
        {defaults.data ? (
          defaults.data.gridSource === "NONE" ? (
            <>
              <Notice kind="warning">{t("frame.noGrid")}</Notice>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label={t("frame.dayStart")} error={fieldError("grid.dayStart")}>
                  {(c) => <TextControl {...c} type="time" value={dayStart} onChange={setDayStart} />}
                </FormField>
                <FormField label={t("frame.dayEnd")} error={fieldError("grid.dayEnd")}>
                  {(c) => <TextControl {...c} type="time" value={dayEnd} onChange={setDayEnd} />}
                </FormField>
                <FormField label={t("frame.periodMinutes")} error={fieldError("grid.periodMinutes")} hint={t("frame.periodMinutesHint")}>
                  {(c) => <TextControl {...c} type="number" min={20} max={240} value={periodMinutes} onChange={setPeriodMinutes} />}
                </FormField>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("frame.gridSummary", { days: weekdays.map((d) => tDay(String(d))).join(", "), periods: periods.length, first: periods[0]?.startTime ?? "", last: periods[periods.length - 1]?.endTime ?? "", rooms: defaults.data.rooms })}
            </p>
          )
        ) : null}
      </section>

      <section aria-labelledby="gen-needs" className="space-y-4">
        <h2 id="gen-needs" className="text-lg font-semibold">
          {t("needs.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("needs.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <FormField label={t("needs.pickClass")}>
            {(c) => <NativeSelect {...c} value={pickClass} onChange={setPickClass} placeholder={t("needs.pickClassPlaceholder")} options={classItems.map((cl) => ({ value: cl.id, label: cl.name }))} />}
          </FormField>
          <button type="button" className={buttonClass.secondary} disabled={!pickClass || !nodes.data || nodes.data.length === 0} onClick={addAll}>
            {t("needs.addAll")}
          </button>
        </div>
        {pickClass && nodes.data && nodes.data.length > 0 ? (
          <ul aria-label={t("needs.nodesLabel")} className="flex flex-wrap gap-2">
            {nodes.data.map((n) => (
              <li key={n.nodeId}>
                <button type="button" className={buttonClass.ghost} onClick={() => addNode(n.nodeId, n.label)}>
                  + {n.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {pickClass && nodes.data && nodes.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("needs.noNodes")}</p> : null}

        {rows.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.02] border-dashed p-4 text-sm text-muted-foreground">{t("needs.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">{t("needs.caption")}</caption>
              <thead className="bg-white/[0.04] text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("needs.columns.subject")}</th>
                  <th scope="col" className="px-3 py-2">{t("needs.columns.sessions")}</th>
                  <th scope="col" className="px-3 py-2">{t("needs.columns.periods")}</th>
                  <th scope="col" className="px-3 py-2">{t("needs.columns.teacher")}</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">{t("needs.columns.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {r.nodeLabel}
                      <span className="block text-xs font-normal text-muted-foreground">{r.classLabel}</span>
                    </th>
                    <td className="px-3 py-2">
                      <input type="number" inputMode="numeric" min={1} max={40} value={r.sessions} onChange={(e) => patch(r.key, { sessions: e.target.value })} aria-label={t("needs.sessionsOf", { subject: r.nodeLabel, classroom: r.classLabel })} className={NUMBER_INPUT} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" inputMode="numeric" min={1} max={8} value={r.periods} onChange={(e) => patch(r.key, { periods: e.target.value })} aria-label={t("needs.periodsOf", { subject: r.nodeLabel, classroom: r.classLabel })} className={NUMBER_INPUT} />
                    </td>
                    <td className="min-w-56 px-3 py-2">
                      <SelectAsync value={r.teacher} onChange={(o) => patch(r.key, { teacher: o })} useOptions={useTeacherOptions} placeholder={derive ? t("needs.teacherAuto") : t("needs.teacherNone")} ariaLabel={t("needs.teacherOf", { subject: r.nodeLabel, classroom: r.classLabel })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className={buttonClass.ghost} onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                        {t("needs.remove")}
                        <span className="sr-only"> {r.nodeLabel} — {r.classLabel}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 ? <p className="text-sm text-muted-foreground">{t("needs.total", { rows: rows.length, sessions: sessionTotal })}</p> : null}
        {fieldError("requirements") ? <p role="alert" className="text-sm font-medium text-destructive">{fieldError("requirements")}</p> : null}
        {rowErrors.length > 0 ? (
          <ul role="alert" className="list-disc pl-5 text-sm font-medium text-destructive">
            {rowErrors.slice(0, 5).map(([k, m]) => (
              <li key={k}>{m}</li>
            ))}
          </ul>
        ) : null}
        <CheckControl checked={derive} onChange={setDerive} label={t("needs.derive")} hint={t("needs.deriveHint")} />
      </section>

      <section aria-labelledby="gen-params" className="space-y-4">
        <h2 id="gen-params" className="text-lg font-semibold">
          {t("params.title")}
        </h2>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("params.days")}</legend>
          <div className="flex flex-wrap gap-x-4">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <CheckControl key={d} checked={weekdays.includes(d)} onChange={(on) => setDays((on ? [...weekdays, d] : weekdays.filter((x) => x !== d)).sort((a, b) => a - b))} label={tDay(String(d))} />
            ))}
          </div>
          {fieldError("weekdays") ? <p role="alert" className="text-xs font-medium text-destructive">{fieldError("weekdays")}</p> : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t("params.seed")} hint={t("params.seedHint")} error={fieldError("seed")}>
            {(c) => <TextControl {...c} value={seed} onChange={setSeed} maxLength={100} />}
          </FormField>
          <FormField label={t("params.timeLimit")} hint={t("params.timeLimitHint", { max: defaults.data?.timeLimitSeconds.max ?? 600 })} error={fieldError("timeLimitSeconds")}>
            {(c) => <TextControl {...c} type="number" min={1} max={defaults.data?.timeLimitSeconds.max ?? 600} placeholder={String(defaults.data?.timeLimitSeconds.default ?? 20)} value={timeLimit} onChange={setTimeLimit} />}
          </FormField>
          <FormField label={t("params.iterations")} hint={t("params.iterationsHint")} error={fieldError("maxIterations")}>
            {(c) => <TextControl {...c} type="number" min={0} placeholder={String(defaults.data?.maxIterations.default ?? 100000)} value={iterations} onChange={setIterations} />}
          </FormField>
        </div>
        <FormField label={t("params.fixed")} hint={t("params.fixedHint")}>
          {(c) => <NativeSelect {...c} value={fixedId} onChange={setFixedId} placeholder={t("params.fixedNone")} options={(timetables.data ?? []).filter((x) => x.status !== "ARCHIVED").map((x) => ({ value: x.id, label: x.name }))} />}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("params.weights")}</legend>
          <p className="text-xs text-muted-foreground">{t("params.weightsHint")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {WEIGHT_KEYS.map((k) => (
              <FormField key={k} label={tWeights(k)} hint={tWeights(`${k}Hint`)} error={fieldError(`weights.${k}`)}>
                {(c) => <TextControl {...c} type="number" min={0} max={1000} placeholder={String(defaults.data?.weights[k] ?? "")} value={weights[k] ?? ""} onChange={(v) => setWeights((prev) => ({ ...prev, [k]: v }))} />}
              </FormField>
            ))}
          </div>
        </fieldset>
      </section>

      {start.isError && Object.keys(apiErrors).length === 0 ? <Notice kind="error">{start.error.message}</Notice> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/v2/schedule/generator" className={buttonClass.secondary}>
          {t("cancel")}
        </Link>
        <button type="submit" className={buttonClass.primary} disabled={start.isPending || rows.length === 0}>
          {start.isPending ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
