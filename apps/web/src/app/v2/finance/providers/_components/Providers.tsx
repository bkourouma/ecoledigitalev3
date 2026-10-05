"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_PROVIDER_MODES, type FinanceProviderDto, type FinanceProviderFieldDto, type FinanceProviderTestResultDto, type FinanceSaveProviderBody } from "@ecoledigitale/contracts/v2/finance";
import { cn } from "@/lib/utils";
import {
  useClearProviderCredentials,
  useFinanceProviders,
  useRotateProviderSecrets,
  useSaveProvider,
  useSetProviderEnabled,
  useTestProvider,
} from "@/platform/v2/finance-providers";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { useProviderError } from "./errors";

/**
 * Configuration des fournisseurs de paiement du tenant (`finance.provider.manage`, action sensible).
 *
 * RÈGLES SUR LES SECRETS : l'API ne renvoie jamais un secret ; l'écran affiche seulement « enregistré » ou « non renseigné ».
 * Un champ secret est un `<input type="password">` toujours VIDE au chargement ; ce qui est saisi n'est envoyé que s'il est
 * non vide (un secret omis est conservé par l'API) et l'état local est VIDÉ dès que l'enregistrement a réussi (aucune valeur
 * ne reste ni dans l'état React ni dans le DOM). Les champs « générés » par la plateforme ne sont jamais éditables.
 */

const CONTROL_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

type Mode = (typeof FINANCE_PROVIDER_MODES)[number];

interface FormState {
  mode: string;
  settings: Record<string, string>;
  secrets: Record<string, string>;
}

/** État initial d'un formulaire : valeurs NON secrètes du serveur (ou défaut) ; les secrets sont toujours vides. */
function initialState(provider: FinanceProviderDto): FormState {
  const settings: Record<string, string> = {};
  for (const f of provider.fields) if (!f.secret && !f.generated) settings[f.key] = f.value ?? f.defaultValue ?? "";
  return { mode: provider.mode ?? "", settings, secrets: {} };
}

/** Corps du PUT : seulement ce qui est renseigné ; un secret vide est ABSENT du corps (donc conservé côté API). */
export function buildSaveBody(provider: FinanceProviderDto, form: FormState): FinanceSaveProviderBody {
  const body: FinanceSaveProviderBody = {};
  if ((FINANCE_PROVIDER_MODES as readonly string[]).includes(form.mode)) body.mode = form.mode as Mode;
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of provider.fields) {
    if (f.generated) continue;
    if (f.secret) {
      const v = (form.secrets[f.key] ?? "").trim();
      if (v !== "") secrets[f.key] = v;
    } else {
      const v = (form.settings[f.key] ?? "").trim();
      if (v !== "") settings[f.key] = v;
    }
  }
  if (Object.keys(settings).length > 0) body.settings = settings;
  if (Object.keys(secrets).length > 0) body.secrets = secrets;
  return body;
}

function stateOf(provider: FinanceProviderDto): { key: "disabled" | "active" | "incomplete"; tone: Tone } {
  if (!provider.complete) return { key: "incomplete", tone: "warning" };
  if (provider.enabled) return { key: "active", tone: "success" };
  return { key: "disabled", tone: "neutral" };
}

/** Copie dans le presse-papiers ; repli : sélection du champ (copie manuelle). */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // repli ci-dessous
  }
  try {
    input?.focus();
    input?.select();
    return typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  } catch {
    input?.select();
    return false;
  }
}

type Dialog = { kind: "clearSecret"; field: FinanceProviderFieldDto } | { kind: "regenerate"; field: FinanceProviderFieldDto } | { kind: "clearAll" } | null;

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  isPending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const message = useProviderError();
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={title} description={description} submitLabel={confirmLabel} isPending={isPending} onSubmit={onConfirm}>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {message(error)}
        </p>
      ) : null}
    </FormDialog>
  );
}

/** Champ secret : jamais pré-rempli. L'indicateur « enregistré » vient de l'API (`isSet`), jamais d'une valeur. */
function SecretField({
  field,
  value,
  onChange,
  disabled,
  onClear,
}: {
  field: FinanceProviderFieldDto;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onClear: () => void;
}) {
  const t = useTranslations("v2FinanceProviders");
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {field.label}
          {field.required ? (
            <>
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
              <span className="sr-only"> ({t("fields.required")})</span>
            </>
          ) : null}
        </label>
        <StatusBadge label={field.isSet ? t("fields.secretSet") : t("fields.secretUnset")} tone={field.isSet ? "success" : "neutral"} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={512}
          aria-describedby={hintId}
          aria-required={field.required ? true : undefined}
          data-lpignore="true"
          data-1p-ignore="true"
          className={CONTROL_CLASS}
        />
        {field.isSet ? (
          <button type="button" className={cn(buttonClass.secondary, "shrink-0")} disabled={disabled} onClick={onClear} aria-label={t("fields.clearLabel", { field: field.label })}>
            {t("fields.clear")}
          </button>
        ) : null}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {field.isSet ? t("fields.secretKeepHint") : t("fields.secretEnterHint")}
        {field.help ? ` ${field.help}` : ""}
      </p>
    </div>
  );
}

/** Champ généré par la plateforme : jamais éditable ; seule action possible : le régénérer (avec confirmation). */
function GeneratedField({ field, disabled, onRegenerate }: { field: FinanceProviderFieldDto; disabled: boolean; onRegenerate: () => void }) {
  const t = useTranslations("v2FinanceProviders");
  return (
    <div role="group" aria-label={field.label} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium leading-none">{field.label}</span>
        <StatusBadge label={field.isSet ? t("fields.generatedSet") : t("fields.generatedUnset")} tone={field.isSet ? "success" : "neutral"} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{t("fields.generated")}</p>
        <button type="button" className={cn(buttonClass.secondary, "sm:ml-auto")} disabled={disabled} onClick={onRegenerate} aria-label={t("fields.regenerateLabel", { field: field.label })}>
          {t("fields.regenerate")}
        </button>
      </div>
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </div>
  );
}

function WebhookUrl({ provider }: { provider: FinanceProviderDto }) {
  const t = useTranslations("v2FinanceProviders");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const url = provider.webhookUrl;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium leading-none">
        {t("webhook.label")}
      </label>
      {url ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input ref={input} id={id} type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={cn(CONTROL_CLASS, "font-mono text-xs")} autoComplete="off" spellCheck={false} />
          <button
            type="button"
            className={cn(buttonClass.secondary, "shrink-0")}
            onClick={() => void copyText(url, input.current).then((ok) => setStatus(ok ? "copied" : "failed"))}
          >
            {t("webhook.copy")}
          </button>
        </div>
      ) : (
        <Notice kind="warning">{t("webhook.missing")}</Notice>
      )}
      <div role="status" aria-live="polite" className="text-xs">
        {status === "copied" ? <span className="text-emerald-700">{t("webhook.copied")}</span> : null}
        {status === "failed" ? <span className="text-destructive">{t("webhook.copyFailed")}</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("webhook.help")}</p>
      {provider.webhookAuth === "signed_url" ? (
        <p className="text-xs font-medium text-amber-800">{t("webhook.signedUrl")}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("webhook.signature")}</p>
      )}
    </div>
  );
}

function TestOutcome({ result }: { result: Pick<FinanceProviderTestResultDto, "ok" | "code" | "at"> | null }) {
  const t = useTranslations("v2FinanceProviders");
  const date = useDateFormat();
  let message = "";
  if (result) {
    switch (result.code) {
      case "ok":
        message = t("test.ok");
        break;
      case "credentials_rejected":
        message = t("test.credentials_rejected");
        break;
      case "unreachable":
        message = t("test.unreachable");
        break;
      case "unexpected_response":
        message = t("test.unexpected_response");
        break;
      case "not_supported":
        message = t("test.not_supported");
        break;
      default:
        message = t("test.unknown");
    }
  }
  return (
    <div role="status" aria-live="polite">
      {result ? (
        <p className={cn("rounded-md border p-3 text-sm", result.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900")}>
          <span className="font-medium">{t("test.lastResult")} ({t("test.at", { date: date.instant(result.at) })}) : </span>
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ProviderCard({ provider, secretsAvailable }: { provider: FinanceProviderDto; secretsAvailable: boolean }) {
  const t = useTranslations("v2FinanceProviders");
  const message = useProviderError();
  const date = useDateFormat();
  const titleId = useId();
  const [form, setForm] = useState<FormState>(() => initialState(provider));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [testResult, setTestResult] = useState<FinanceProviderTestResultDto | null>(null);
  const save = useSaveProvider();
  const toggle = useSetProviderEnabled();
  const test = useTestProvider();
  const clearAll = useClearProviderCredentials();

  const name = provider.label;
  const state = stateOf(provider);
  const locked = !secretsAvailable;
  const busy = save.isPending || toggle.isPending || test.isPending || clearAll.isPending;
  const labelOf = (key: string) => provider.fields.find((f) => f.key === key)?.label ?? key;

  function startAction() {
    setNotice(null);
    setError(null);
    setDialogError(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    startAction();
    save.mutate(
      { provider: provider.provider, body: buildSaveBody(provider, form) },
      {
        onSuccess: (dto) => {
          // Les secrets saisis sont VIDÉS (état React ; les champs étant contrôlés, le DOM l'est aussi) et la variable de la
          // mutation est libérée.
          setForm(initialState(dto));
          save.reset();
          setNotice(t("actions.saved", { name }));
        },
        onError: (err) => {
          save.reset();
          setError(err);
        },
      },
    );
  }

  function confirmDialog() {
    if (!dialog) return;
    setDialogError(null);
    if (dialog.kind === "clearAll") {
      clearAll.mutate(
        { provider: provider.provider },
        {
          onSuccess: (dto) => {
            setForm(initialState(dto));
            setTestResult(null);
            setDialog(null);
            setNotice(t("actions.cleared", { name }));
          },
          onError: (err) => setDialogError(err),
        },
      );
      return;
    }
    const field = dialog.field;
    const body: FinanceSaveProviderBody = dialog.kind === "clearSecret" ? { clearSecrets: [field.key] } : { regenerateWebhookSecret: true };
    save.mutate(
      { provider: provider.provider, body },
      {
        onSuccess: () => {
          if (dialog.kind === "clearSecret") setForm((f) => ({ ...f, secrets: Object.fromEntries(Object.entries(f.secrets).filter(([k]) => k !== field.key)) }));
          setDialog(null);
          setNotice(dialog.kind === "clearSecret" ? t("actions.secretCleared", { field: field.label, name }) : t("actions.regenerated", { field: field.label, name }));
        },
        onError: (err) => setDialogError(err),
      },
    );
  }

  const pendingDialog = save.isPending || clearAll.isPending;

  return (
    <section aria-labelledby={titleId} className="space-y-5 rounded-lg border bg-card p-4 sm:p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="text-lg font-semibold">
            {name}
          </h2>
          <StatusBadge label={t(`state.${state.key}`)} tone={state.tone} />
          {provider.mode ? <StatusBadge label={t(`mode.${provider.mode}`)} tone={provider.mode === "production" ? "info" : "neutral"} /> : null}
        </div>
        <p className="text-sm text-muted-foreground">{provider.description}</p>
        <p className="text-xs text-muted-foreground">{provider.supportsRefund ? t("capabilities.refund") : t("capabilities.noRefund")}</p>
        <p className="text-xs text-muted-foreground">{provider.updatedAt ? t("updatedAt", { date: date.instant(provider.updatedAt) }) : t("never")}</p>
        <p className="text-xs text-muted-foreground">{provider.activeAccount ? t(`account.${provider.activeAccount}`) : t("account.none")}</p>
        {provider.activeAccount === "PLATFORM" || (provider.activeAccount === "TENANT" && provider.platformFallbackReady) ? <p className="text-xs text-muted-foreground">{t("account.frozen")}</p> : null}
      </header>

      <form onSubmit={onSubmit} noValidate autoComplete="off" aria-labelledby={titleId} className="space-y-4">
        <FormField label={t("mode.label")} required hint={provider.sandboxAllowed ? t("mode.hint") : t("mode.sandboxForbidden")} className="sm:max-w-xs">
          {(c) => (
            <NativeSelect
              {...c}
              value={form.mode}
              disabled={locked || busy}
              onChange={(mode) => setForm((f) => ({ ...f, mode }))}
              placeholder={t("mode.placeholder")}
              options={FINANCE_PROVIDER_MODES.map((m) => ({ value: m, label: t(`mode.${m}`), disabled: m === "sandbox" && !provider.sandboxAllowed }))}
            />
          )}
        </FormField>

        <div className="grid gap-4 md:grid-cols-2">
          {provider.fields.map((field) => {
            if (field.generated) {
              return <GeneratedField key={field.key} field={field} disabled={locked || busy} onRegenerate={() => (startAction(), setDialog({ kind: "regenerate", field }))} />;
            }
            if (field.secret) {
              return (
                <SecretField
                  key={field.key}
                  field={field}
                  value={form.secrets[field.key] ?? ""}
                  disabled={locked || busy}
                  onChange={(v) => setForm((f) => ({ ...f, secrets: { ...f.secrets, [field.key]: v } }))}
                  onClear={() => (startAction(), setDialog({ kind: "clearSecret", field }))}
                />
              );
            }
            const value = form.settings[field.key] ?? "";
            const onChange = (v: string) => setForm((f) => ({ ...f, settings: { ...f.settings, [field.key]: v } }));
            return (
              <FormField key={field.key} label={field.label} required={field.required} hint={field.help}>
                {(c) =>
                  field.kind === "select" ? (
                    <NativeSelect {...c} value={value} onChange={onChange} disabled={locked || busy} placeholder={t("fields.choose")} options={(field.options ?? []).map((o) => ({ value: o, label: o }))} />
                  ) : (
                    <TextControl {...c} value={value} onChange={onChange} disabled={locked || busy} autoComplete="off" maxLength={512} />
                  )
                }
              </FormField>
            );
          })}
        </div>

        <WebhookUrl provider={provider} />

        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass.primary} disabled={locked || busy}>
            {save.isPending ? t("actions.saving") : t("actions.save")}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={locked || busy || !provider.complete}
          onClick={() => {
            startAction();
            test.mutate({ provider: provider.provider }, { onSuccess: (r) => setTestResult(r), onError: (err) => setError(err) });
          }}
        >
          {test.isPending ? t("actions.testing") : t("actions.test")}
        </button>
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={busy || (!provider.enabled && (!provider.complete || locked))}
          onClick={() => {
            startAction();
            const enabled = !provider.enabled;
            toggle.mutate({ provider: provider.provider, enabled }, { onSuccess: () => setNotice(t(enabled ? "actions.enabled" : "actions.disabled", { name })), onError: (err) => setError(err) });
          }}
        >
          {provider.enabled ? t("actions.disable") : t("actions.enable")}
        </button>
        {provider.configured ? (
          <button type="button" className={cn(buttonClass.danger, "sm:ml-auto")} disabled={locked || busy} onClick={() => (startAction(), setDialog({ kind: "clearAll" }))}>
            {t("actions.clearAll")}
          </button>
        ) : null}
      </div>

      {!provider.complete ? (
        <p className="text-sm text-amber-900">
          {provider.missing.length > 0 ? t("actions.missing", { fields: provider.missing.map(labelOf).join(", ") }) : t("actions.enableBlocked")}
        </p>
      ) : null}

      <TestOutcome result={testResult ?? provider.lastTest} />
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{message(error)}</Notice> : null}

      {dialog ? (
        <ConfirmDialog
          title={t(`confirm.${dialog.kind}.title`)}
          description={dialog.kind === "clearAll" ? t("confirm.clearAll.description", { name }) : t(`confirm.${dialog.kind}.description`, { field: dialog.field.label })}
          confirmLabel={t(`confirm.${dialog.kind}.confirm`)}
          isPending={pendingDialog}
          error={dialogError}
          onConfirm={confirmDialog}
          onClose={() => (setDialog(null), setDialogError(null))}
        />
      ) : null}
    </section>
  );
}

export function ProvidersScreen() {
  const t = useTranslations("v2FinanceProviders");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("actions");
  const message = useProviderError();
  const list = useFinanceProviders();
  const rotate = useRotateProviderSecrets();
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateError, setRotateError] = useState<unknown>(null);
  const [rotated, setRotated] = useState<{ count: number; keyId: string } | null>(null);
  const data = list.data;

  function confirmRotate() {
    setRotateError(null);
    rotate.mutate(undefined, {
      onSuccess: (r) => {
        setRotated({ count: r.rotated, keyId: r.keyId });
        setRotateOpen(false);
      },
      onError: (err) => setRotateError(err),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          data ? (
            <button type="button" className={buttonClass.secondary} disabled={!data.secretsAvailable} onClick={() => (setRotated(null), setRotateError(null), setRotateOpen(true))}>
              {t("rotate.button")}
            </button>
          ) : null
        }
      />
      {rotated ? <Notice kind="success">{t("rotate.done", { count: rotated.count, keyId: rotated.keyId })}</Notice> : null}
      {list.isPending && list.fetchStatus === "idle" ? <Notice kind="warning">{tCommon("tenantUnknown")}</Notice> : null}
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? (
        <div className="space-y-3">
          <Notice kind="error">{message(list.error)}</Notice>
          <button type="button" className={buttonClass.secondary} onClick={() => void list.refetch()}>
            {tActions("retry")}
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          {!data.secretsAvailable ? <Notice kind="warning">{t("vaultUnavailable")}</Notice> : null}
          <p className="text-sm text-muted-foreground">
            {t("environment.label")} : <span className="font-medium text-foreground">{t(`environment.${data.environment}`)}</span>
          </p>
          <div className="space-y-6">
            {data.items.map((p) => (
              <ProviderCard key={p.provider} provider={p} secretsAvailable={data.secretsAvailable} />
            ))}
          </div>
        </>
      ) : null}
      {rotateOpen ? (
        <ConfirmDialog
          title={t("rotate.title")}
          description={t("rotate.description")}
          confirmLabel={t("rotate.confirm")}
          isPending={rotate.isPending}
          error={rotateError}
          onConfirm={confirmRotate}
          onClose={() => (setRotateOpen(false), setRotateError(null))}
        />
      ) : null}
    </div>
  );
}
