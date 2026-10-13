"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RulesBindingBodySchema, type RulesBindingDto } from "@ecoledigitale/contracts/v2/rules";
import { useReference, usePrograms } from "@/platform/v2/academic";
import { useInstitutions } from "@/platform/v2/lookups";
import { useBindings, useContracts, useDeleteBinding, usePutBinding, useRuleSets } from "@/platform/v2/rules";
import { Can, RequirePermission } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { bindingState, groupByContract, programsWithoutBinding, scopeKind } from "./bindings-model";

/** Date du jour (civile, UTC) : sert seulement à situer une liaison (à venir, en vigueur, échue). */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Liaisons contrat de calcul <-> jeu de règles, par périmètre (établissement, programme, niveau) et dates d'effet.
 * Lecture : `rules.ruleset.read` ; écriture : `rules.binding.manage` (permission sensible). La résolution réelle (quel jeu de
 * règles s'applique) est celle de l'API ; l'alerte « aucune règle active » n'est qu'un indicateur de vigilance.
 */
export function BindingsScreen() {
  return (
    <RequirePermission permission="rules.ruleset.read">
      <BindingsContent />
    </RequirePermission>
  );
}

type Editing = { binding: RulesBindingDto | null } | null;

function BindingsContent() {
  const t = useTranslations("v2RulesBindings");
  const tState = useTranslations("v2RulesBindings.state");
  const date = useDateFormat();
  const contracts = useContracts();
  const bindings = useBindings();
  const ruleSets = useRuleSets();
  const programs = usePrograms();
  const levels = useReference("education-levels");
  const institutions = useInstitutions();
  const del = useDeleteBinding();
  const flash = useFlash();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<RulesBindingDto | null>(null);
  const today = todayIso();

  const programById = useMemo(() => new Map((programs.data ?? []).map((p) => [p.id, p])), [programs.data]);
  const institutionById = useMemo(() => new Map((institutions.data ?? []).map((i) => [i.id, i])), [institutions.data]);
  const ruleSetName = useMemo(() => new Map((ruleSets.data ?? []).map((s) => [s.code, s.name])), [ruleSets.data]);
  const contractName = useMemo(() => new Map((contracts.data ?? []).map((c) => [c.id, c])), [contracts.data]);
  const groups = useMemo(() => groupByContract(bindings.data ?? [], (contracts.data ?? []).map((c) => c.id)), [bindings.data, contracts.data]);

  // Contrat effectif d'un programme : le sien, sinon celui de son cycle d'enseignement (données déclarées, aucun calcul).
  const levelContract = useMemo(() => new Map((levels.data ?? []).map((l) => [l.id, l.calculationContract])), [levels.data]);
  const contractOfProgram = (p: { calculationContract: string | null; educationLevelId: string }) => p.calculationContract ?? levelContract.get(p.educationLevelId) ?? null;
  const uncovered = useMemo(() => {
    const active = (programs.data ?? []).filter((p) => p.status === "ACTIVE");
    return (contracts.data ?? []).flatMap((c) => programsWithoutBinding(active, contractOfProgram, c.id, bindings.data ?? [], today).map((p) => ({ program: p, contractId: c.id })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `contractOfProgram` dépend uniquement de `levelContract`
  }, [programs.data, contracts.data, bindings.data, levelContract, today]);

  const scopeLabel = (b: RulesBindingDto): string => {
    switch (scopeKind(b)) {
      case "program":
        return t("scope.program", { label: programById.get(b.curriculumNodeId!)?.label ?? t("scope.unknownProgram") });
      case "level":
        return t("scope.level", { code: b.levelCode! });
      case "institution":
        return t("scope.institution", { name: institutionById.get(b.institutionId!)?.name ?? t("scope.unknownInstitution") });
      case "other":
        return t("scope.combined", { label: programById.get(b.curriculumNodeId!)?.label ?? t("scope.unknownProgram"), code: b.levelCode! });
      default:
        return t("scope.tenant");
    }
  };

  const columns: DataTableColumn<RulesBindingDto>[] = [
    {
      id: "ruleSet",
      header: t("columns.ruleSet"),
      rowHeader: true,
      cell: (b) => (
        <span>
          <span className="font-medium">{ruleSetName.get(b.ruleSetCode) ?? b.ruleSetCode}</span>
          <span className="block font-mono text-xs text-muted-foreground">{b.ruleSetCode}</span>
        </span>
      ),
    },
    { id: "scope", header: t("columns.scope"), cell: (b) => scopeLabel(b) },
    {
      id: "effect",
      header: t("columns.effect"),
      cell: (b) => (
        <span className="flex flex-col gap-1">
          <span>{b.effectiveTo ? t("period", { from: date.civil(b.effectiveFrom), to: date.civil(b.effectiveTo) }) : t("since", { from: date.civil(b.effectiveFrom) })}</span>
          <StatusBadge label={tState(bindingState(b, today))} tone={bindingState(b, today) === "active" ? "success" : bindingState(b, today) === "upcoming" ? "info" : "neutral"} className="self-start" />
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (b) => (
        <Can permission="rules.binding.manage">
          <span className="flex flex-wrap justify-end gap-1">
            <button type="button" className={buttonClass.ghost} onClick={() => setEditing({ binding: b })} aria-label={`${t("edit")} — ${b.ruleSetCode} (${scopeLabel(b)})`}>
              {t("edit")}
            </button>
            <button type="button" className={buttonClass.ghost} onClick={() => setDeleting(b)} aria-label={`${t("delete")} — ${b.ruleSetCode} (${scopeLabel(b)})`}>
              {t("delete")}
            </button>
          </span>
        </Can>
      ),
    },
  ];

  const loading = (contracts.isPending && contracts.fetchStatus !== "idle") || (bindings.isPending && bindings.fetchStatus !== "idle");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="rules.binding.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setEditing({ binding: null })} disabled={(contracts.data ?? []).length === 0}>
              {t("add")}
            </button>
          </Can>
        }
      />
      {flash.node}
      {loading ? <LoadingBlock /> : null}
      {contracts.isError ? <ErrorBlock error={contracts.error} onRetry={() => void contracts.refetch()} /> : null}
      {bindings.isError ? <ErrorBlock error={bindings.error} onRetry={() => void bindings.refetch()} /> : null}

      {uncovered.length > 0 ? (
        <Notice kind="warning">
          <p className="font-semibold">{t("uncovered.title", { count: uncovered.length })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {uncovered.map(({ program, contractId }) => (
              <li key={`${program.id}-${contractId}`}>{t("uncovered.item", { program: program.label, contract: contractName.get(contractId)?.name ?? contractId })}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">{t("uncovered.hint")}</p>
        </Notice>
      ) : null}

      {bindings.data && contracts.data
        ? groups.map(({ contractId, items }) => {
            const info = contractName.get(contractId);
            return (
              <section key={contractId} aria-labelledby={`contract-${contractId}`} className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
                <div>
                  <h2 id={`contract-${contractId}`} className="text-lg font-semibold">
                    {info?.name ?? contractId} <span className="font-mono text-xs font-normal text-muted-foreground">{contractId}</span>
                  </h2>
                  {info?.description ? <p className="text-sm text-muted-foreground">{info.description}</p> : null}
                </div>
                <DataTable caption={t("caption", { contract: info?.name ?? contractId })} columns={columns} rows={items} getRowId={(b) => b.id} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
              </section>
            );
          })
        : null}

      {editing ? (
        <BindingDialog
          initial={editing.binding}
          contracts={contracts.data ?? []}
          onClose={() => setEditing(null)}
          onDone={() => flash.show(editing.binding ? t("updated") : t("created"))}
        />
      ) : null}

      {deleting ? (
        <ModalDialog open onOpenChange={(o) => !o && setDeleting(null)} title={t("deleteTitle")} description={t("deleteDescription", { ruleSet: deleting.ruleSetCode, scope: scopeLabel(deleting) })}>
          <div className="space-y-4">
            {del.error ? <ErrorBlock error={del.error} /> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonClass.secondary} onClick={() => setDeleting(null)} disabled={del.isPending}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className={buttonClass.danger}
                disabled={del.isPending}
                onClick={async () => {
                  try {
                    await del.mutateAsync({ id: deleting.id });
                    flash.show(t("deleted"));
                    setDeleting(null);
                  } catch {
                    /* affichée dans la boîte de dialogue */
                  }
                }}
              >
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

type ScopeChoice = "tenant" | "program" | "level";

function BindingDialog({ initial, contracts, onClose, onDone }: { initial: RulesBindingDto | null; contracts: ReadonlyArray<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2RulesBindings.dialog");
  const tScope = useTranslations("v2RulesBindings.dialog.scopeChoice");
  const ruleSets = useRuleSets();
  const programs = usePrograms({ status: "ACTIVE" });
  const institutions = useInstitutions();
  const put = usePutBinding();
  const editing = initial !== null;
  const [form, setForm] = useState({
    contractId: initial?.contractId ?? contracts[0]?.id ?? "",
    ruleSetCode: initial?.ruleSetCode ?? "",
    scope: (initial ? (initial.curriculumNodeId ? "program" : initial.levelCode ? "level" : "tenant") : "tenant") as ScopeChoice,
    institutionId: initial?.institutionId ?? "",
    programId: initial?.curriculumNodeId ?? "",
    levelCode: initial?.levelCode ?? "",
    effectiveFrom: initial?.effectiveFrom ?? "",
    effectiveTo: initial?.effectiveTo ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const many = (institutions.data ?? []).length > 1;
  // Un jeu de règles par code : les versions d'un même jeu partagent la liaison (le serveur choisit la version en vigueur).
  const ruleSetOptions = (ruleSets.data ?? []).map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));
  if (initial && !ruleSetOptions.some((o) => o.value === initial.ruleSetCode)) ruleSetOptions.push({ value: initial.ruleSetCode, label: initial.ruleSetCode });

  async function submit() {
    const body = {
      contractId: form.contractId,
      ruleSetCode: form.ruleSetCode,
      institutionId: form.institutionId === "" ? null : form.institutionId,
      curriculumNodeId: form.scope === "program" ? (form.programId === "" ? null : form.programId) : null,
      levelCode: form.scope === "level" ? (form.levelCode.trim() === "" ? null : form.levelCode.trim()) : null,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo === "" ? null : form.effectiveTo,
    };
    const errs: FieldErrors = {};
    if (form.scope === "program" && !body.curriculumNodeId) errs.curriculumNodeId = t("programRequired");
    if (form.scope === "level" && !body.levelCode) errs.levelCode = t("levelRequired");
    const v = validateWith(RulesBindingBodySchema, body);
    if (!v.ok) Object.assign(errs, v.errors);
    if (Object.keys(errs).length > 0 || !v.ok) return setErrors(errs);
    setErrors({});
    try {
      await put.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={editing ? t("editTitle") : t("addTitle")} description={editing ? t("editHint") : t("addHint")} submitLabel={t("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <FormField label={t("contract")} required error={errors.contractId}>
        {(c) => <NativeSelect {...c} value={form.contractId} disabled={editing} onChange={set("contractId")} placeholder={t("choose")} options={contracts.map((x) => ({ value: x.id, label: `${x.name} (${x.id})` }))} />}
      </FormField>
      <FormField label={t("ruleSet")} required error={errors.ruleSetCode}>
        {(c) => <NativeSelect {...c} value={form.ruleSetCode} onChange={set("ruleSetCode")} placeholder={t("choose")} options={ruleSetOptions} />}
      </FormField>
      <fieldset className="space-y-2" disabled={editing}>
        <legend className="text-sm font-medium">{t("scope")}</legend>
        {(["tenant", "program", "level"] as const).map((k) => (
          <label key={k} className="flex min-h-[2.75rem] items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
            <input type="radio" name="binding-scope" value={k} checked={form.scope === k} onChange={() => set("scope")(k)} className="mt-1 h-4 w-4 accent-primary" />
            <span>
              <span className="block font-medium">{tScope(k)}</span>
              <span className="block text-muted-foreground">{tScope(`${k}Help`)}</span>
            </span>
          </label>
        ))}
        {form.scope === "program" ? (
          <FormField label={t("program")} required error={errors.curriculumNodeId}>
            {(c) => <NativeSelect {...c} value={form.programId} disabled={editing} onChange={set("programId")} placeholder={t("choose")} options={(programs.data ?? []).map((p) => ({ value: p.id, label: `${p.label} (${p.code})` }))} />}
          </FormField>
        ) : null}
        {form.scope === "level" ? (
          <FormField label={t("level")} hint={t("levelHint")} required error={errors.levelCode}>
            {(c) => <TextControl {...c} value={form.levelCode} disabled={editing} maxLength={64} onChange={set("levelCode")} />}
          </FormField>
        ) : null}
        {many ? (
          <FormField label={t("institution")} hint={t("institutionHint")} error={errors.institutionId}>
            {(c) => <NativeSelect {...c} value={form.institutionId} disabled={editing} onChange={set("institutionId")} placeholder={t("allInstitutions")} options={(institutions.data ?? []).map((i) => ({ value: i.id, label: i.name }))} />}
          </FormField>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("effectiveFrom")} required error={errors.effectiveFrom}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveFrom} disabled={editing} onChange={set("effectiveFrom")} />}
        </FormField>
        <FormField label={t("effectiveTo")} hint={t("effectiveToHint")} error={errors.effectiveTo}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveTo} min={form.effectiveFrom || undefined} onChange={set("effectiveTo")} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
