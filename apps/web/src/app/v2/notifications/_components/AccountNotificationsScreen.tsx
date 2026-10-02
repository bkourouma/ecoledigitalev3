"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { NOTIF_CATEGORIES, type NotifCategory, type NotifChannel, type NotifPreferences } from "@ecoledigitale/contracts/v2/notifications";
import { useMyNotifPreferences, useMyPushDevices, useRemovePushDevice, useSubscribePush, useUpdateMyNotifPreferences, useVapidKey } from "@/platform/v2/notifications";
import { useDateFormat } from "@/platform/ui/format";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { PushError, pushSupported, subscribeThisDevice } from "./push-client";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function ChannelCard({ ch, onChange, busy }: { ch: NotifPreferences["channels"][number]; onChange: (channel: NotifChannel, category: NotifCategory | "*", enabled: boolean) => void; busy: boolean }) {
  const t = useTranslations("v2NotificationsAccount");
  const name = t(`channels.${ch.channel}`);
  return (
    <li className="space-y-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <StatusBadge label={ch.consentModel === "EXPLICIT" ? t("explicit") : t("implied")} tone="neutral" />
      </div>
      {!ch.available ? (
        <p className="text-sm text-muted-foreground">{t("notAvailable")}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={ch.enabled} disabled={busy} onChange={(e) => onChange(ch.channel, "*", e.target.checked)} aria-label={t("channelToggle", { channel: name })} />
            {ch.enabled ? t("channelOn") : t("channelOff")}
          </label>
          {ch.enabled ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs text-muted-foreground">{t("categoriesHint")}</legend>
              {NOTIF_CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={ch.categories[cat] ?? true} disabled={busy} onChange={(e) => onChange(ch.channel, cat, e.target.checked)} aria-label={t("categoryToggle", { channel: name, category: t(`categories.${cat}`) })} />
                  {t(`categories.${cat}`)}
                </label>
              ))}
            </fieldset>
          ) : null}
        </>
      )}
    </li>
  );
}

function QuietHours({ prefs }: { prefs: NotifPreferences }) {
  const t = useTranslations("v2NotificationsAccount.quiet");
  const describe = useDescribeError();
  const flash = useFlash();
  const update = useUpdateMyNotifPreferences();
  const q = prefs.quietHours;
  const [inherit, setInherit] = useState(q.inherited);
  const [enabled, setEnabled] = useState(q.enabled);
  const [start, setStart] = useState(q.start);
  const [end, setEnd] = useState(q.end);
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!inherit && (!TIME.test(start) || !TIME.test(end))) return setError(t("invalid"));
    setError(null);
    update.mutate({ quietHours: inherit ? { inherit: true } : { inherit: false, enabled, start, end } }, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <section aria-labelledby="quiet-title" className="space-y-3 rounded-lg border p-3 sm:p-4">
      <h2 id="quiet-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} /> {t("inherit")}
      </label>
      {!inherit ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("enabled")}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("start")}>{(c) => <input {...c} type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />}</FormField>
            <FormField label={t("end")}>{(c) => <input {...c} type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />}</FormField>
          </div>
        </>
      ) : q.enabled ? (
        <p className="text-sm">{t("current", { start: q.start, end: q.end })}</p>
      ) : null}
      {prefs.urgentBypassesQuietHours ? <p className="text-xs text-muted-foreground">{t("urgentNote")}</p> : null}
      {flash.node}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      <button type="button" className={buttonClass.primary} onClick={save} disabled={update.isPending}>
        {t("save")}
      </button>
    </section>
  );
}

function PushDevices() {
  const t = useTranslations("v2NotificationsAccount.push");
  const describe = useDescribeError();
  const fmt = useDateFormat();
  const flash = useFlash();
  const vapid = useVapidKey();
  const devices = useMyPushDevices();
  const subscribe = useSubscribePush();
  const remove = useRemovePushDevice();
  const [label, setLabel] = useState(t("defaultLabel"));
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const supported = pushSupported();

  async function activate() {
    if (!vapid.data?.publicKey) return;
    setFailure(null);
    setWorking(true);
    try {
      const body = await subscribeThisDevice(vapid.data.publicKey, label);
      subscribe.mutate(body, { onSuccess: () => flash.show(t("activated")) });
    } catch (e) {
      setFailure(e instanceof PushError ? t(`failures.${e.reason}`) : t("failures.failed"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="push-title" className="space-y-3 rounded-lg border p-3 sm:p-4">
      <h2 id="push-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {vapid.isPending ? (
        <LoadingBlock />
      ) : vapid.isError ? (
        <ErrorBlock error={vapid.error} onRetry={() => void vapid.refetch()} />
      ) : !vapid.data.configured ? (
        <Notice kind="info">{t("notConfigured")}</Notice>
      ) : !supported ? (
        <Notice kind="info">{t("unsupported")}</Notice>
      ) : (
        <div className="space-y-3">
          <FormField label={t("deviceName")} hint={t("deviceNameHint")}>
            {(c) => <input {...c} type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />}
          </FormField>
          <button type="button" className={buttonClass.primary} onClick={() => void activate()} disabled={working || subscribe.isPending}>
            {t("activate")}
          </button>
        </div>
      )}
      {flash.node}
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      {subscribe.error ? <Notice kind="error">{describe(subscribe.error)}</Notice> : null}
      {remove.error ? <Notice kind="error">{describe(remove.error)}</Notice> : null}
      {devices.isPending ? null : devices.isError ? (
        <ErrorBlock error={devices.error} onRetry={() => void devices.refetch()} />
      ) : devices.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-2" aria-label={t("devices")}>
          {devices.data.items.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{d.deviceLabel ?? t("unnamed")}</p>
                <p className="text-xs text-muted-foreground">{t("since", { at: fmt.instant(d.createdAt) })}</p>
                {d.lastUsedAt ? <p className="text-xs text-muted-foreground">{t("lastUsed", { at: fmt.instant(d.lastUsedAt) })}</p> : null}
              </div>
              <button type="button" className={buttonClass.secondary} disabled={remove.isPending} onClick={() => remove.mutate({ id: d.id }, { onSuccess: () => flash.show(t("removed")) })} aria-label={t("remove", { name: d.deviceLabel ?? t("unnamed") })}>
                {t("removeAction")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** « Mes notifications » : canaux et catégories, heures calmes, appareils Web Push. Chaque case enregistre aussitôt. */
export function AccountNotificationsScreen() {
  const t = useTranslations("v2NotificationsAccount");
  const describe = useDescribeError();
  const flash = useFlash();
  const prefs = useMyNotifPreferences();
  const update = useUpdateMyNotifPreferences();

  function change(channel: NotifChannel, category: NotifCategory | "*", enabled: boolean) {
    update.mutate({ channels: [{ channel, category, enabled }] }, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {prefs.isPending ? (
        <LoadingBlock />
      ) : prefs.isError ? (
        <ErrorBlock error={prefs.error} onRetry={() => void prefs.refetch()} />
      ) : (
        <>
          <section aria-labelledby="channels-title" className="space-y-3">
            <h2 id="channels-title" className="text-lg font-semibold">
              {t("channelsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("channelsHint")}</p>
            {flash.node}
            {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
            <ul className="grid gap-3 sm:grid-cols-2">
              {prefs.data.channels.map((ch) => (
                <ChannelCard key={ch.channel} ch={ch} onChange={change} busy={update.isPending} />
              ))}
            </ul>
          </section>
          <QuietHours prefs={prefs.data} />
        </>
      )}
      <PushDevices />
    </div>
  );
}
