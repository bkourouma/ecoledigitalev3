"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ListChecks, Pencil, Plus } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Notice,
  PageHeader,
  ResponsiveTable,
  StatusBadge,
  type Column,
} from "@ecoledigitale/ui";
import type { Feature, Pack, Plan } from "@ecoledigitale/contracts/v2/entitlements";
import { ApiErrorState } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCatalog, useSetPlanFeatures, useUpsertPlan } from "./hooks";
import { EMPTY_PLAN, validatePlan, type PlanField, type PlanFormState } from "./lib";

/** `/v2/platform/plans` : plans commerciaux, packs et catalogue de fonctionnalités. */
export function PlansPage() {
  const t = useTranslations("platform.plans");
  const tu = useTranslations("ui");
  const catalog = useCatalog();
  const [planDialog, setPlanDialog] = useState<{ mode: "create" } | { mode: "edit"; plan: Plan } | null>(null);
  const [featuresFor, setFeaturesFor] = useState<Plan | null>(null);

  const packColumns: Column<Pack>[] = [
    { key: "key", header: t("key"), cell: (p) => <code className="text-xs">{p.key}</code> },
    { key: "label", header: t("label"), cell: (p) => p.label },
    { key: "active", header: t("active"), cell: (p) => <StatusBadge tone={p.active ? "success" : "neutral"}>{p.active ? t("active") : t("inactive")}</StatusBadge> },
  ];
  const featureColumns: Column<Feature>[] = [
    {
      key: "key",
      header: t("key"),
      cell: (f) => (
        <span>
          <code className="break-all text-xs">{f.key}</code>
          {f.retired ? <StatusBadge tone="neutral" className="ml-2">{t("retiredBadge")}</StatusBadge> : null}
        </span>
      ),
    },
    { key: "label", header: t("label"), cell: (f) => f.label },
    { key: "module", header: t("module"), hideOnMobile: true, cell: (f) => f.moduleKey },
    { key: "packs", header: t("packsIncluded"), hideOnMobile: true, cell: (f) => f.packs.join(", ") },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button type="button" className="min-h-11 sm:min-h-10" onClick={() => setPlanDialog({ mode: "create" })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            {t("newPlan")}
          </Button>
        }
      />
      {catalog.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {catalog.isError ? <ApiErrorState error={catalog.error} onRetry={() => void catalog.refetch()} /> : null}

      {catalog.data ? (
        <>
          <section aria-labelledby="plans-list" className="space-y-3">
            <h2 id="plans-list" className="text-base font-semibold">
              {t("plansTitle")}
            </h2>
            {catalog.data.plans.length === 0 ? <EmptyState title={t("empty")} /> : null}
            <ul className="grid gap-4 md:grid-cols-2">
              {[...catalog.data.plans]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
                .map((plan) => (
                  <li key={plan.key} className="space-y-2 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{plan.label}</h3>
                      <code className="text-xs text-muted-foreground">{plan.key}</code>
                      <StatusBadge tone={plan.active ? "success" : "neutral"}>{plan.active ? t("active") : t("inactive")}</StatusBadge>
                    </div>
                    {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {t("featuresCount", { count: plan.featureKeys.length })} · {t("order", { order: plan.sortOrder })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("edit", { label: plan.label })} onClick={() => setPlanDialog({ mode: "edit", plan })}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("editFeatures", { label: plan.label })} onClick={() => setFeaturesFor(plan)}>
                        <ListChecks className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>

          <section aria-labelledby="packs-list" className="space-y-3">
            <h2 id="packs-list" className="text-base font-semibold">
              {t("packsTitle")}
            </h2>
            <ResponsiveTable columns={packColumns} rows={catalog.data.packs} rowKey={(p) => p.key} caption={t("packCaption")} />
          </section>

          <section aria-labelledby="features-list" className="space-y-3">
            <h2 id="features-list" className="text-base font-semibold">
              {t("featuresTitle")}
            </h2>
            <ResponsiveTable columns={featureColumns} rows={catalog.data.features} rowKey={(f) => f.key} caption={t("featureCaption")} />
          </section>
        </>
      ) : null}

      <PlanDialog target={planDialog} onClose={() => setPlanDialog(null)} />
      <PlanFeaturesDialog plan={featuresFor} features={catalog.data?.features ?? []} onClose={() => setFeaturesFor(null)} />
    </div>
  );
}

function PlanDialog({ target, onClose }: { target: { mode: "create" } | { mode: "edit"; plan: Plan } | null; onClose: () => void }) {
  const t = useTranslations("platform.plans.planForm");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const upsert = useUpsertPlan();
  const [form, setForm] = useState<PlanFormState>(EMPTY_PLAN);
  const [errors, setErrors] = useState<Partial<Record<PlanField, string>>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const creating = target?.mode === "create";
  const server = fieldErrorsOf(upsert.error);

  const key = target ? (target.mode === "create" ? "create" : target.plan.key) : null;
  if (target && loadedFor !== key) {
    setLoadedFor(key);
    setErrors({});
    setForm(
      target.mode === "edit"
        ? { key: target.plan.key, label: target.plan.label, description: target.plan.description ?? "", sortOrder: String(target.plan.sortOrder), active: target.plan.active }
        : EMPTY_PLAN,
    );
  }

  const close = () => {
    upsert.reset();
    setLoadedFor(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validatePlan(form, creating);
    setErrors(result.errors);
    if (!result.data) return;
    upsert.mutate(result.data, {
      onSuccess: () => {
        notifySuccess(t("done"));
        close();
      },
    });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{creating ? t("createTitle") : t("editTitle")}</DialogTitle>
          <DialogDescription>{target?.mode === "edit" ? target.plan.key : t("keyHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("key")} hint={t("keyHint")} required={creating} requiredLabel={tu("required")} error={errors.key ?? server.key}>
            {(c) => <Input {...c} value={form.key} readOnly={!creating} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t("label")} required requiredLabel={tu("required")} error={errors.label ?? server.label}>
            {(c) => <Input {...c} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />}
          </Field>
          <Field label={t("description")} error={errors.description ?? server.description}>
            {(c) => <Input {...c} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}
          </Field>
          <Field label={t("sortOrder")} error={errors.sortOrder ?? server.sortOrder}>
            {(c) => <Input {...c} type="number" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />}
          </Field>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox id="plan-active" checked={form.active} onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked === true }))} />
            <label htmlFor="plan-active" className="cursor-pointer text-sm">
              {t("active")}
            </label>
          </div>
          {upsert.error ? <Notice tone="danger">{message(upsert.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={upsert.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={upsert.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanFeaturesDialog({ plan, features, onClose }: { plan: Plan | null; features: readonly Feature[]; onClose: () => void }) {
  const t = useTranslations("platform.plans.featuresForm");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const save = useSetPlanFeatures();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (plan && loadedFor !== plan.key) {
    setLoadedFor(plan.key);
    setSelected(new Set(plan.featureKeys));
    setQuery("");
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, Feature[]>();
    for (const f of features) {
      if (needle && !`${f.key} ${f.label}`.toLowerCase().includes(needle)) continue;
      map.set(f.moduleKey, [...(map.get(f.moduleKey) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([moduleKey, list]) => ({ moduleKey, list: list.sort((a, b) => a.key.localeCompare(b.key)) }));
  }, [features, query]);

  const close = () => {
    save.reset();
    setLoadedFor(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!plan) return;
    save.mutate(
      { key: plan.key, featureKeys: [...selected].sort() },
      {
        onSuccess: () => {
          notifySuccess(t("done"));
          close();
        },
      },
    );
  };

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { label: plan?.label ?? "" })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("search")}>{(c) => <Input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />}</Field>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("selected", { count: selected.size })}
          </p>
          <div className="max-h-[50dvh] space-y-3 overflow-y-auto pr-1">
            {groups.map((group) => (
              <fieldset key={group.moduleKey} className="rounded-md border p-3">
                <legend className="px-1 text-sm font-semibold">{group.moduleKey}</legend>
                <ul className="space-y-1">
                  {group.list.map((f) => {
                    const id = `plan-feature-${f.key}`;
                    return (
                      <li key={f.key} className="flex min-h-11 items-start gap-2 py-1">
                        <Checkbox
                          id={id}
                          className="mt-1"
                          checked={selected.has(f.key)}
                          onCheckedChange={(checked) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(f.key);
                              else next.delete(f.key);
                              return next;
                            })
                          }
                        />
                        <label htmlFor={id} className="cursor-pointer text-sm">
                          {f.label}
                          <code className="block break-all text-xs text-muted-foreground">{f.key}</code>
                          {f.retired ? <span className="text-xs text-amber-800">{t("retired")}</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
          {save.error ? <Notice tone="danger">{message(save.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={save.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={save.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
