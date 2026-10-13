"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { NOTIF_CONSENT_MODELS, type NotifChannel, type NotifChannelHealth, type NotifSettings, type NotifUpdateSettingsBody } from "@ecoledigitale/contracts/v2/notifications";
import { usePermission } from "@/platform/access";
import { useChannelTest, useNotifChannels, useNotifSettings, useUpdateNotifSettings } from "@/platform/v2/notifications";
import { useDateFormat } from "@/platform/ui/format";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField, AntSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { CHANNELS, SETTINGS } from "./notifications-utils";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const STATE_TONE: Record<NotifChannelHealth["state"], Tone> = { OK: "success", DEGRADED: "warning", NOT_CONFIGURED: "danger", DISABLED: "neutral" };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function HealthCard({ h, canTest, onTest, testing }: { h: NotifChannelHealth; canTest: boolean; onTest: () => void; testing: boolean }) {
  const t = useTranslations("v2NotificationsChannels");
  const fmt = useDateFormat();
  return (
    <li className="space-y-2 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t(`names.${h.channel}`)}</h3>
        <StatusBadge label={t(`states.${h.state}`)} tone={STATE_TONE[h.state]} />
      </div>
      <p className="text-xs text-muted-foreground">{h.provider ? t("provider", { name: h.provider }) : t("noProvider")}</p>
      {h.missing.length > 0 ? (
        <Notice kind="warning">
          <p>{t("missing")}</p>
          <p className="mt-1 break-all font-mono text-xs">{h.missing.join(", ")}</p>
        </Notice>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("last24h")}</dt>
        <dd>{t("last24hValue", { sent: h.last24h.sent, failed: h.last24h.failed, bounced: h.last24h.bounced, skipped: h.last24h.skipped })}</dd>
        <dt className="text-muted-foreground">{t("pending")}</dt>
        <dd>{h.pending > 0 && h.oldestPendingAt ? t("pendingValue", { n: h.pending, since: fmt.instant(h.oldestPendingAt) }) : String(h.pending)}</dd>
        <dt className="text-muted-foreground">{t("quota")}</dt>
        <dd>{t("quotaValue", { sent: h.sentToday, cap: h.dailyCap })}</dd>
      </dl>
      {h.lastErrorCode ? (
        <p className="text-sm text-destructive">
          {t("lastError")} <span className="font-mono">{h.lastErrorCode}</span>
          {h.lastErrorAt ? ` · ${fmt.instant(h.lastErrorAt)}` : ""}
        </p>
      ) : null}
      {canTest ? (
        <button type="button" className={buttonClass.secondary} onClick={onTest} disabled={testing || h.state === "NOT_CONFIGURED" || h.state === "DISABLED"} aria-label={t("testChannel", { channel: t(`names.${h.channel}`) })}>
          {t("test")}
        </button>
      ) : null}
    </li>
  );
}

function SettingsForm({ settings, canEdit }: { settings: NotifSettings; canEdit: boolean }) {
  const t = useTranslations("v2NotificationsChannels.settings");
  const describe = useDescribeError();
  const flash = useFlash();
  const update = useUpdateNotifSettings();
  const [enabled, setEnabled] = useState<NotifChannel[]>(settings.enabledChannels);
  const [senderName, setSenderName] = useState(settings.senderName ?? "");
  const [replyTo, setReplyTo] = useState(settings.replyTo ?? "");
  const [timezone, setTimezone] = useState(settings.timezone);
  const [dial, setDial] = useState(settings.defaultDialCode);
  const [quietOn, setQuietOn] = useState(settings.quietHoursEnabled);
  const [quietStart, setQuietStart] = useState(settings.quietStart);
  const [quietEnd, setQuietEnd] = useState(settings.quietEnd);
  const [caps, setCaps] = useState<Record<string, string>>(Object.fromEntries(CHANNELS.map((c) => [c, settings.dailyCaps[c] === undefined ? "" : String(settings.dailyCaps[c])])));
  const [perRecipient, setPerRecipient] = useState(String(settings.perRecipientDailyCap));
  const [models, setModels] = useState(settings.consentModels);
  const [urgentBypass, setUrgentBypass] = useState(settings.urgentBypassesRevocations);
  const [maxAttempts, setMaxAttempts] = useState(String(settings.maxAttempts));
  const [retention, setRetention] = useState(String(settings.journalRetentionDays));
  const [footer, setFooter] = useState(settings.legalFooter ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{1,4}$/.test(dial)) return setError(t("errors.dial"));
    if (!TIME.test(quietStart) || !TIME.test(quietEnd)) return setError(t("errors.time"));
    if (replyTo.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo.trim())) return setError(t("errors.email"));
    const dailyCaps: Record<string, number> = {};
    for (const c of CHANNELS) {
      const raw = (caps[c] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return setError(t("errors.cap"));
      dailyCaps[c] = n;
    }
    const per = Number(perRecipient);
    const attempts = Number(maxAttempts);
    const days = Number(retention);
    if (!Number.isInteger(per) || per < 1 || per > 500) return setError(t("errors.perRecipient"));
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) return setError(t("errors.attempts"));
    if (!Number.isInteger(days) || days < 7 || days > 3650) return setError(t("errors.retention"));
    setError(null);
    const body: NotifUpdateSettingsBody = {
      enabledChannels: enabled,
      senderName: senderName.trim() === "" ? null : senderName.trim(),
      replyTo: replyTo.trim() === "" ? null : replyTo.trim(),
      timezone: timezone.trim(),
      defaultDialCode: dial,
      quietHoursEnabled: quietOn,
      quietStart,
      quietEnd,
      dailyCaps,
      perRecipientDailyCap: per,
      consentModels: models,
      urgentBypassesRevocations: urgentBypass,
      maxAttempts: attempts,
      journalRetentionDays: days,
      legalFooter: footer.trim() === "" ? null : footer.trim(),
    };
    update.mutate(body, { onSuccess: () => flash.show(t("saved")) });
  }

  const ro = !canEdit;
  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-label={t("title")}>
      <fieldset className="space-y-2 rounded-lg border p-3 sm:p-4" disabled={ro}>
        <legend className="px-1 text-sm font-semibold">{t("enabledChannels")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {CHANNELS.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={enabled.includes(c)} onChange={(e) => setEnabled(e.target.checked ? [...enabled, c] : enabled.filter((x) => x !== c))} /> {t(`channels.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={ro}>
        <FormField label={t("senderName")} hint={t("senderNameHint")}>
          {(c) => <input {...c} type="text" maxLength={80} value={senderName} onChange={(e) => setSenderName(e.target.value)} className={inputClass} />}
        </FormField>
        <FormField label={t("replyTo")}>{(c) => <input {...c} type="email" maxLength={200} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} className={inputClass} />}</FormField>
        <FormField label={t("timezone")}>{(c) => <input {...c} type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass} />}</FormField>
        <FormField label={t("dialCode")} hint={t("dialCodeHint")}>
          {(c) => <input {...c} type="text" inputMode="numeric" value={dial} onChange={(e) => setDial(e.target.value)} className={inputClass} />}
        </FormField>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4" disabled={ro}>
        <legend className="px-1 text-sm font-semibold">{t("quietHours")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={quietOn} onChange={(e) => setQuietOn(e.target.checked)} /> {t("quietEnabled")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("quietStart")}>{(c) => <input {...c} type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className={inputClass} />}</FormField>
          <FormField label={t("quietEnd")}>{(c) => <input {...c} type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className={inputClass} />}</FormField>
        </div>
        <p className="text-xs text-muted-foreground">{t("quietHint")}</p>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4" disabled={ro}>
        <legend className="px-1 text-sm font-semibold">{t("caps")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {CHANNELS.map((c) => (
            <FormField key={c} label={t("capOf", { channel: t(`channels.${c}`) })} hint={t("capHint")}>
              {(ctl) => <input {...ctl} type="number" min={0} max={1000000} value={caps[c] ?? ""} onChange={(e) => setCaps({ ...caps, [c]: e.target.value })} className={inputClass} />}
            </FormField>
          ))}
        </div>
        <FormField label={t("perRecipient")} hint={t("perRecipientHint")} className="sm:max-w-xs">
          {(c) => <input {...c} type="number" min={1} max={500} value={perRecipient} onChange={(e) => setPerRecipient(e.target.value)} className={inputClass} />}
        </FormField>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4" disabled={ro}>
        <legend className="px-1 text-sm font-semibold">{t("consent")}</legend>
        <p className="text-xs text-muted-foreground">{t("consentHint")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {CHANNELS.map((c) => (
            <FormField key={c} label={t("modelOf", { channel: t(`channels.${c}`) })}>
              {(ctl) => (
                <AntSelect {...ctl} value={models[c] ?? "IMPLIED"} onChange={(e) => setModels({ ...models, [c]: e.target.value as (typeof NOTIF_CONSENT_MODELS)[number] })} className={inputClass}>
                  {NOTIF_CONSENT_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {t(`models.${m}`)}
                    </option>
                  ))}
                </AntSelect>
              )}
            </FormField>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={urgentBypass} onChange={(e) => setUrgentBypass(e.target.checked)} /> <span>{t("urgentBypass")}</span>
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={ro}>
        <FormField label={t("maxAttempts")} hint={t("maxAttemptsHint")}>
          {(c) => <input {...c} type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} className={inputClass} />}
        </FormField>
        <FormField label={t("retention")} hint={t("retentionHint")}>
          {(c) => <input {...c} type="number" min={7} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className={inputClass} />}
        </FormField>
        <FormField label={t("legalFooter")} hint={t("legalFooterHint")} className="sm:col-span-2">
          {(c) => <textarea {...c} rows={3} maxLength={500} value={footer} onChange={(e) => setFooter(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />}
        </FormField>
      </fieldset>

      {flash.node}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      {canEdit ? (
        <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
          {t("save")}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      )}
    </form>
  );
}

/** Canaux : état de santé, envoi d'essai, plafonds, heures calmes, modèles de consentement, nouvelles tentatives. */
export function ChannelsScreen() {
  const t = useTranslations("v2NotificationsChannels");
  const describe = useDescribeError();
  const canEdit = usePermission(SETTINGS).allowed;
  const channels = useNotifChannels();
  const settings = useNotifSettings();
  const test = useChannelTest();
  const flash = useFlash();

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {channels.isPending ? (
        <LoadingBlock />
      ) : channels.isError ? (
        <ErrorBlock error={channels.error} onRetry={() => void channels.refetch()} />
      ) : (
        <section aria-label={t("health")} className="space-y-3">
          {channels.data.simulation ? <Notice kind="warning">{t("simulation")}</Notice> : null}
          {flash.node}
          {test.error ? <Notice kind="error">{describe(test.error)}</Notice> : null}
          <ul className="grid gap-4 md:grid-cols-2">
            {channels.data.items.map((h) => (
              <HealthCard
                key={h.channel}
                h={h}
                canTest={canEdit}
                testing={test.isPending}
                onTest={() => test.mutate({ channels: [h.channel] }, { onSuccess: (r) => flash.show(t("testResult", { queued: r.queued, skipped: r.skipped })) })}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="settings-title" className="space-y-3">
        <h2 id="settings-title" className="text-lg font-semibold">
          {t("settings.title")}
        </h2>
        {settings.isPending ? <LoadingBlock /> : settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} canEdit={canEdit} />}
      </section>
    </div>
  );
}
