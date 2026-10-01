"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RulesDiagnostic, RulesRuleDefinitionDto, RulesVersionDetailDto } from "@ecoledigitale/contracts/v2/rules";
import { diagnosticsOf, useContract, useEditExpression, useEditParameters, useEvaluateRule } from "@/platform/v2/rules";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice } from "@/platform/ui/states";

/** Extrait de l'expression autour de la position d'une erreur (ligne, colonne) avec un repère `^` sous le caractère fautif. */
export function excerptAt(source: string, position: { line: number; column: number } | undefined): { text: string; pointer: string } | null {
  if (!position) return null;
  const line = source.split(/\r?\n/)[position.line - 1];
  if (line === undefined) return null;
  return { text: line, pointer: `${" ".repeat(Math.max(0, position.column - 1))}^` };
}

export function DiagnosticList({ diagnostics, source, id }: { diagnostics: RulesDiagnostic[]; source?: string; id?: string }) {
  const t = useTranslations("v2Rules.editor");
  if (diagnostics.length === 0) return null;
  return (
    <ul id={id} role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      {diagnostics.map((d, i) => {
        const excerpt = source ? excerptAt(source, d.position) : null;
        return (
          <li key={`${d.code}-${i}`}>
            <p className="font-medium text-destructive">
              {d.message}
              {d.position ? <span className="ml-1 font-normal">({t("position", { line: d.position.line, column: d.position.column })})</span> : null}
            </p>
            {d.hint ? <p className="text-muted-foreground">{t("hint", { hint: d.hint })}</p> : null}
            {excerpt ? (
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs" aria-hidden="true">
                {excerpt.text}
                {"\n"}
                {excerpt.pointer}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Règle d'une version : expression (éditable pour une variante en brouillon), paramètres bornés, aide du contrat, banc d'essai.
 * Le langage est vérifié par l'API : une expression invalide est REFUSÉE (rien n'est enregistré) avec ses diagnostics.
 */
export function RuleEditor({ version, rule, editableExpression, editableParameters }: { version: RulesVersionDetailDto; rule: RulesRuleDefinitionDto; editableExpression: boolean; editableParameters: boolean }) {
  const t = useTranslations("v2Rules.editor");
  const tType = useTranslations("v2Rules.ruleType");
  const contract = useContract(version.contractId);
  const contractRule = contract.data?.rules.find((r) => r.key === rule.key);
  const edit = useEditExpression();
  const [expression, setExpression] = useState(rule.expression);
  const [saved, setSaved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RulesDiagnostic[]>([]);
  const [otherError, setOtherError] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const dirty = expression !== rule.expression;
  const errId = `diag-${rule.key}`;

  async function save() {
    setSaved(false);
    setDiagnostics([]);
    setOtherError(null);
    try {
      await edit.mutateAsync({ id: version.id, key: rule.key, expression, expectedRowVersion: version.rowVersion ?? undefined });
      setSaved(true);
    } catch (e) {
      const found = diagnosticsOf(e);
      if (found.length > 0) {
        setDiagnostics(found);
        const p = found[0]!.position;
        if (p && area.current) {
          area.current.focus();
          area.current.setSelectionRange(p.start, p.end);
        }
      } else setOtherError(e);
    }
  }

  return (
    <article className="space-y-3 rounded-md border p-4" aria-label={rule.key}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-base font-semibold">{rule.key}</h3>
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tType(rule.type)} tone="neutral" />
          {rule.isOptional ? <StatusBadge label={t("optional")} tone="info" /> : null}
        </span>
      </header>
      {rule.description ? <p className="text-sm text-muted-foreground">{rule.description}</p> : null}

      <FormField label={t("expression")} hint={editableExpression ? t("expressionHint") : t("expressionReadOnly")}>
        {(c) => (
          <textarea
            {...c}
            ref={area}
            value={expression}
            readOnly={!editableExpression}
            onChange={(e) => {
              setExpression(e.target.value);
              setSaved(false);
            }}
            rows={Math.min(12, Math.max(3, expression.split("\n").length + 1))}
            spellCheck={false}
            aria-invalid={diagnostics.length > 0 ? true : undefined}
            aria-describedby={[c["aria-describedby"], diagnostics.length > 0 ? errId : undefined].filter(Boolean).join(" ") || undefined}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive read-only:bg-muted/40"
          />
        )}
      </FormField>
      <DiagnosticList diagnostics={diagnostics} source={expression} id={errId} />
      {otherError ? <ErrorBlock error={otherError} /> : null}
      {saved ? <Notice kind="success">{t("saved")}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        {editableExpression ? (
          <button type="button" className={buttonClass.primary} onClick={() => void save()} disabled={!dirty || edit.isPending} aria-label={t("saveOf", { key: rule.key })}>
            {t("save")}
          </button>
        ) : null}
        {editableExpression && dirty ? (
          <button
            type="button"
            className={buttonClass.ghost}
            onClick={() => {
              setExpression(rule.expression);
              setDiagnostics([]);
            }}
          >
            {t("reset")}
          </button>
        ) : null}
        <Can permission="rules.version.edit">
          <button type="button" className={buttonClass.secondary} onClick={() => setTesting(true)} aria-label={t("testOf", { key: rule.key })}>
            {t("test")}
          </button>
        </Can>
      </div>

      <ParametersTable version={version} rule={rule} editable={editableParameters} />

      {contractRule ? (
        <details className="rounded-md bg-muted/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("contractHelp")}</summary>
          <p className="mt-2 text-muted-foreground">{contractRule.description}</p>
          <p className="mt-2 font-medium">{t("inputs")}</p>
          <p className="font-mono text-xs">{Object.keys(contractRule.inputs).join(", ") || "—"}</p>
          {contractRule.outputCodes.length > 0 ? (
            <>
              <p className="mt-2 font-medium">{t("outputCodes")}</p>
              <p className="font-mono text-xs">{contractRule.outputCodes.join(", ")}</p>
            </>
          ) : null}
        </details>
      ) : null}

      {testing ? <EvaluateDialog versionId={version.id} ruleKey={rule.key} onClose={() => setTesting(false)} /> : null}
    </article>
  );
}

function ParametersTable({ version, rule, editable }: { version: RulesVersionDetailDto; rule: RulesRuleDefinitionDto; editable: boolean }) {
  const t = useTranslations("v2Rules.editor");
  const entries = Object.entries(rule.parameters);
  const edit = useEditParameters();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(entries.map(([k, s]) => [k, String(s.default)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  if (entries.length === 0) return null;

  const changed = entries.filter(([k, s]) => values[k] !== String(s.default));

  async function save() {
    setSaved(false);
    const next: Record<string, string> = {};
    const changes: Array<{ ruleKey: string; parameter: string; value: number | string | boolean }> = [];
    for (const [k, spec] of changed) {
      const raw = (values[k] ?? "").trim();
      if (spec.type === "number") {
        const n = Number(raw.replace(",", "."));
        if (raw === "" || !Number.isFinite(n)) next[k] = t("paramNumber");
        else if (spec.min !== undefined && n < spec.min) next[k] = t("paramMin", { min: spec.min });
        else if (spec.max !== undefined && n > spec.max) next[k] = t("paramMax", { max: spec.max });
        else changes.push({ ruleKey: rule.key, parameter: k, value: n });
      } else if (spec.type === "boolean") changes.push({ ruleKey: rule.key, parameter: k, value: raw === "true" });
      else changes.push({ ruleKey: rule.key, parameter: k, value: raw });
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || changes.length === 0) return;
    try {
      await edit.mutateAsync({ id: version.id, changes, expectedRowVersion: version.rowVersion ?? undefined });
      setSaved(true);
    } catch {
      /* affichée sous le tableau */
    }
  }

  return (
    <section aria-label={t("parametersOf", { key: rule.key })} className="space-y-2">
      <h4 className="text-sm font-semibold">{t("parameters")}</h4>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("parametersOf", { key: rule.key })}</caption>
        <tbody>
          {entries.map(([name, spec]) => (
            <tr key={name} className="border-t align-top">
              <th scope="row" className="w-1/3 py-2 pr-3 font-mono text-xs font-normal">
                {name}
                {spec.description ? <span className="block font-sans text-muted-foreground">{spec.description}</span> : null}
              </th>
              <td className="py-2">
                {editable ? (
                  <FormField label={t("paramValue", { name })} error={errors[name]} hint={spec.min !== undefined || spec.max !== undefined ? t("paramBounds", { min: spec.min ?? "—", max: spec.max ?? "—" }) : undefined}>
                    {(c) => <TextControl {...c} value={values[name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [name]: v }))} inputMode={spec.type === "number" ? "decimal" : "text"} className="max-w-[10rem]" />}
                  </FormField>
                ) : (
                  <span className="tabular-nums">{String(spec.default)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => void save()} disabled={changed.length === 0 || edit.isPending} aria-label={t("saveParametersOf", { key: rule.key })}>
            {t("saveParameters")}
          </button>
          {saved ? <span role="status" className="text-sm text-emerald-700">{t("saved")}</span> : null}
        </div>
      ) : null}
      {edit.error ? <ErrorBlock error={edit.error} /> : null}
    </section>
  );
}

function EvaluateDialog({ versionId, ruleKey, onClose }: { versionId: string; ruleKey: string; onClose: () => void }) {
  const t = useTranslations("v2Rules.editor");
  const evaluate = useEvaluateRule();
  const [text, setText] = useState("{\n  \n}");
  const [parseError, setParseError] = useState<string | null>(null);

  async function run() {
    let variables: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
      variables = parsed as Record<string, unknown>;
    } catch {
      return setParseError(t("jsonInvalid"));
    }
    setParseError(null);
    try {
      await evaluate.mutateAsync({ versionId, ruleKey, context: { variables }, trace: true });
    } catch {
      /* affichée dans la boîte de dialogue */
    }
  }

  const out = evaluate.data;
  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={t("testTitle", { key: ruleKey })} description={t("testDescription")} submitLabel={t("run")} onSubmit={() => void run()} isPending={evaluate.isPending} error={evaluate.error}>
      <FormField label={t("variables")} error={parseError} hint={t("variablesHint")}>
        {(c) => <TextAreaControl {...c} value={text} onChange={setText} rows={6} className="font-mono" />}
      </FormField>
      {out ? (
        <section aria-label={t("result")} className="space-y-2 rounded-md border p-3 text-sm">
          <p>
            {t("resultValue")} <span className="font-mono font-semibold" data-testid="evaluate-value">{out.value === null ? "—" : String(out.value)}</span> <span className="text-muted-foreground">({out.type})</span>
          </p>
          <p className="text-xs text-muted-foreground">{t("nodes", { count: out.nodesEvaluated })}</p>
          {out.trace.length > 0 ? (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t("traceCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-2">#</th>
                  <th scope="col" className="pr-2">{t("traceLabel")}</th>
                  <th scope="col" className="pr-2">{t("traceSource")}</th>
                  <th scope="col">{t("traceValue")}</th>
                </tr>
              </thead>
              <tbody>
                {out.trace.map((s) => (
                  <tr key={s.seq} className="border-t">
                    <td className="pr-2 tabular-nums">{s.seq}</td>
                    <td className="pr-2">{s.label}</td>
                    <td className="pr-2 font-mono">{s.source}</td>
                    <td>{s.value === null || s.value === undefined ? "—" : String(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {out.traceTruncated ? <p className="text-xs">{t("traceTruncated")}</p> : null}
        </section>
      ) : null}
    </FormDialog>
  );
}
