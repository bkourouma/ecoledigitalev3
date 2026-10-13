"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { NOTIF_CHANNELS, NOTIF_STRATEGIES, type NotifCatalogEntry, type NotifChannel, type NotifManualAudience, type NotifSendBody, type NotifStrategy, type NotifVariableDef } from "@ecoledigitale/contracts/v2/notifications";
import { usePermission } from "@/platform/access";
import { useNotifCatalog, useNotifChannels, useSendNotification } from "@/platform/v2/notifications";
import { useClassroomOptions, useStudentOptions } from "@/platform/v2/lookups";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField, AntSelect } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { CLASSROOM_INCLUDES, type ClassroomInclude } from "./rules-utils";
import { SEND_URGENT } from "./notifications-utils";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const AUDIENCES = ["STUDENT_GUARDIANS", "CLASSROOM", "ROLES"] as const;
type Audience = (typeof AUDIENCES)[number];
const ROLE_KEY = /^[a-z][a-z0-9_]{1,59}$/;
const useActiveClassrooms = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { status: "ACTIVE" });

function Chips({ items, onRemove, label }: { items: SelectOption[]; onRemove: (value: string) => void; label: string }) {
  const t = useTranslations("v2NotificationsSend");
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {items.map((o) => (
        <li key={o.value} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-sm">
          {o.label}
          <button type="button" onClick={() => onRemove(o.value)} aria-label={t("remove", { name: o.label })} className="rounded-full p-0.5 hover:bg-accent">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Clé d'idempotence d'UN envoi confirmé : créée à la validation du formulaire, conservée par la fenêtre de confirmation
 * (un nouvel essai après une erreur réseau ne double donc pas l'envoi) ; un nouvel envoi aura sa propre clé.
 */
const newClientKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Valeur saisie -> valeur typée du contrat (le serveur valide à nouveau). `undefined` : variable facultative laissée vide. */
function typedValue(def: NotifVariableDef, raw: string, currency: string): unknown {
  const text = raw.trim();
  if (text === "") return undefined;
  if (def.type === "number") return Number(text.replace(",", "."));
  if (def.type === "money") return { amount: Number(text), currency };
  return text;
}

export function SendScreen() {
  const t = useTranslations("v2NotificationsSend");
  const describe = useDescribeError();
  const canUrgent = usePermission(SEND_URGENT).allowed;
  const catalog = useNotifCatalog();
  const channelsHealth = useNotifChannels();
  const send = useSendNotification();

  const [code, setCode] = useState<string>("");
  const [channels, setChannels] = useState<NotifChannel[]>([]);
  const [strategy, setStrategy] = useState<NotifStrategy>("ALL");
  const [urgent, setUrgent] = useState(false);
  const [audience, setAudience] = useState<Audience>("STUDENT_GUARDIANS");
  const [students, setStudents] = useState<SelectOption[]>([]);
  const [classrooms, setClassrooms] = useState<SelectOption[]>([]);
  const [include, setInclude] = useState<ClassroomInclude[]>(["GUARDIANS"]);
  const [financialFirst, setFinancialFirst] = useState(false);
  const [roleKeys, setRoleKeys] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NotifSendBody | null>(null);
  const [result, setResult] = useState<{ recipients: number; deliveries: number; skipped: number; reused: boolean } | null>(null);

  const manual = (catalog.data?.items ?? []).filter((e) => e.manual);
  const entry: NotifCatalogEntry | undefined = manual.find((e) => e.code === code) ?? manual[0];
  const usable = (channelsHealth.data?.items ?? []).filter((h) => h.enabled && h.configured).map((h) => h.channel);
  const channelChoices = NOTIF_CHANNELS.filter((c) => (entry?.channels ?? []).includes(c));

  function build(): NotifSendBody | null {
    if (!entry) return null;
    if (channels.length === 0) {
      setError(t("errors.channels"));
      return null;
    }
    let target: NotifManualAudience;
    if (audience === "STUDENT_GUARDIANS") {
      if (students.length === 0) return (setError(t("errors.students")), null);
      target = { kind: "STUDENT_GUARDIANS", studentIds: students.map((s) => s.value), financialFirst };
    } else if (audience === "CLASSROOM") {
      if (classrooms.length === 0) return (setError(t("errors.classrooms")), null);
      if (include.length === 0) return (setError(t("errors.include")), null);
      target = { kind: "CLASSROOM", classroomIds: classrooms.map((c) => c.value), include };
    } else {
      const keys = roleKeys.split(/[,\s;]+/).filter(Boolean);
      if (keys.length === 0 || keys.length > 10 || !keys.every((k) => ROLE_KEY.test(k))) return (setError(t("errors.roles")), null);
      target = { kind: "ROLES", roleKeys: keys };
    }
    const variables: Record<string, unknown> = {};
    for (const def of entry.variables) {
      const v = typedValue(def, values[def.name] ?? "", values[`${def.name}__currency`] ?? "XOF");
      if (v === undefined) {
        if (def.required) return (setError(t("errors.required", { name: def.label })), null);
        continue;
      }
      if (typeof v === "number" && !Number.isFinite(v)) return (setError(t("errors.number", { name: def.label })), null);
      variables[def.name] = v;
    }
    setError(null);
    return { templateCode: entry.code, audience: target, variables, channels, strategy, urgent: urgent && canUrgent, clientKey: newClientKey() } as NotifSendBody;
  }

  function toggleChannel(c: NotifChannel, on: boolean) {
    setChannels((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)));
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {catalog.isPending ? (
        <LoadingBlock />
      ) : catalog.isError ? (
        <ErrorBlock error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : (
        <form
          className="space-y-5"
          noValidate
          aria-label={t("form")}
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            const body = build();
            if (body) setConfirm(body);
          }}
        >
          <FormField label={t("template")}>
            {(c) => (
              <AntSelect
                {...c}
                value={entry?.code ?? ""}
                onChange={(e) => {
                  setCode(e.target.value);
                  setChannels([]);
                  setValues({});
                  setUrgent(false);
                }}
                className={inputClass}
              >
                {manual.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.label}
                  </option>
                ))}
              </AntSelect>
            )}
          </FormField>
          {entry ? <p className="text-sm text-muted-foreground">{entry.description}</p> : null}

          <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
            <legend className="px-1 text-sm font-semibold">{t("audience")}</legend>
            <FormField label={t("audienceKind")}>
              {(c) => (
                <AntSelect {...c} value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={inputClass}>
                  {AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {t(`audiences.${a}`)}
                    </option>
                  ))}
                </AntSelect>
              )}
            </FormField>
            {audience === "STUDENT_GUARDIANS" ? (
              <>
                <FormField label={t("addStudent")}>
                  {(c) => <SelectAsync {...c} value={null} onChange={(o) => o && !students.some((s) => s.value === o.value) && setStudents([...students, o])} useOptions={useStudentOptions} placeholder={t("studentPlaceholder")} />}
                </FormField>
                <Chips items={students} onRemove={(v) => setStudents(students.filter((s) => s.value !== v))} label={t("selectedStudents")} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={financialFirst} onChange={(e) => setFinancialFirst(e.target.checked)} /> {t("financialFirst")}
                </label>
              </>
            ) : null}
            {audience === "CLASSROOM" ? (
              <>
                <FormField label={t("addClassroom")}>
                  {(c) => <SelectAsync {...c} value={null} onChange={(o) => o && !classrooms.some((s) => s.value === o.value) && setClassrooms([...classrooms, o])} useOptions={useActiveClassrooms} placeholder={t("classroomPlaceholder")} />}
                </FormField>
                <Chips items={classrooms} onRemove={(v) => setClassrooms(classrooms.filter((s) => s.value !== v))} label={t("selectedClassrooms")} />
                <div className="flex flex-wrap gap-4 text-sm">
                  {CLASSROOM_INCLUDES.map((inc) => (
                    <label key={inc} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={include.includes(inc)} onChange={(e) => setInclude(e.target.checked ? [...include, inc] : include.filter((x) => x !== inc))} /> {t(`includes.${inc}`)}
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            {audience === "ROLES" ? (
              <FormField label={t("roleKeys")} hint={t("roleKeysHint")}>
                {(c) => <input {...c} type="text" value={roleKeys} onChange={(e) => setRoleKeys(e.target.value)} className={inputClass} />}
              </FormField>
            ) : null}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
            <legend className="px-1 text-sm font-semibold">{t("channelsLegend")}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {channelChoices.map((c) => {
                const ok = channelsHealth.data ? usable.includes(c) : true;
                return (
                  <label key={c} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={channels.includes(c)} onChange={(e) => toggleChannel(c, e.target.checked)} disabled={!ok} /> {t(`channels.${c}`)}
                    {!ok ? <span className="text-xs text-muted-foreground">({t("unavailable")})</span> : null}
                  </label>
                );
              })}
            </div>
            <FormField label={t("strategy")} hint={t("strategyHint")}>
              {(c) => (
                <AntSelect {...c} value={strategy} onChange={(e) => setStrategy(e.target.value as NotifStrategy)} className={inputClass}>
                  {NOTIF_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {t(`strategies.${s}`)}
                    </option>
                  ))}
                </AntSelect>
              )}
            </FormField>
            {canUrgent ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> <span>{t("urgent")}</span>
              </label>
            ) : null}
          </fieldset>

          {entry ? (
            <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold">{t("variables")}</legend>
              {entry.variables.map((def) => (
                <FormField key={`${entry.code}-${def.name}`} label={def.label} required={def.required}>
                  {(c) =>
                    def.type === "text" ? (
                      <textarea {...c} rows={3} maxLength={2000} value={values[def.name] ?? ""} onChange={(e) => setValues({ ...values, [def.name]: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    ) : def.type === "date" ? (
                      <input {...c} type="date" value={values[def.name] ?? ""} onChange={(e) => setValues({ ...values, [def.name]: e.target.value })} className={inputClass} />
                    ) : def.type === "number" || def.type === "money" ? (
                      <input {...c} type="number" inputMode="decimal" value={values[def.name] ?? ""} onChange={(e) => setValues({ ...values, [def.name]: e.target.value })} className={inputClass} />
                    ) : (
                      <input {...c} type="text" maxLength={500} value={values[def.name] ?? ""} onChange={(e) => setValues({ ...values, [def.name]: e.target.value })} className={inputClass} />
                    )
                  }
                </FormField>
              ))}
            </fieldset>
          ) : null}

          {error ? <Notice kind="error">{error}</Notice> : null}
          {result ? (
            <Notice kind="success">
              {result.reused ? t("reused") : t("done", { recipients: result.recipients, deliveries: result.deliveries, skipped: result.skipped })}
            </Notice>
          ) : null}
          <button type="submit" className={buttonClass.primary} disabled={!entry}>
            {t("review")}
          </button>
        </form>
      )}

      <ModalDialog open={confirm !== null} onOpenChange={(o) => (!o ? setConfirm(null) : undefined)} title={t("confirm.title")} description={confirm?.urgent ? t("confirm.urgentHint") : t("confirm.hint")}>
        {confirm ? (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>{t("confirm.template", { name: entry?.label ?? confirm.templateCode })}</li>
              <li>{t("confirm.channels", { list: confirm.channels.map((c) => t(`channels.${c}`)).join(", ") })}</li>
              <li>{t(`confirm.audience.${confirm.audience.kind}`)}</li>
              {confirm.urgent ? <li className="font-semibold text-destructive">{t("confirm.urgent")}</li> : null}
            </ul>
            {send.error ? <Notice kind="error">{describe(send.error)}</Notice> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setConfirm(null)}>
                {t("confirm.cancel")}
              </button>
              <button
                type="button"
                className={confirm.urgent ? buttonClass.danger : buttonClass.primary}
                disabled={send.isPending}
                onClick={() =>
                  send.mutate(confirm, {
                    onSuccess: (r) => {
                      setResult(r);
                      setConfirm(null);
                      setStudents([]);
                      setClassrooms([]);
                      setValues({});
                    },
                  })
                }
              >
                {t("confirm.send")}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
