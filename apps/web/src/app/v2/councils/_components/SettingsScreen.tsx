"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  COUNCIL_DECISION_APPLIES_TO,
  COUNCIL_DECISION_FAMILIES,
  COUNCIL_EFFECT_TRIGGERS,
  COUNCIL_FUNCTIONS,
  COUNCIL_GUARDIAN_VISIBILITIES,
  COUNCIL_RESULTS_STATUSES,
  COUNCIL_SCOPES,
  councilsCouncilTypeInputSchema,
  councilsDecisionTypeInputSchema,
  councilsParticipantRoleInputSchema,
  councilsSettingsInputSchema,
  type CouncilsCouncilTypeDto,
  type CouncilsDecisionTypeDto,
  type CouncilsParticipantRoleDto,
  type CouncilsSettingsDto,
} from "@ecoledigitale/contracts/v2/councils";
import { useCouncilsReference, useUpsertCouncilSettings, useUpsertCouncilType, useUpsertDecisionType, useUpsertParticipantRole } from "@/platform/v2/councils";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CouncilsBoundary, ScrollTable, Section, TD, TH, useEnumText } from "./shared";

type Editing = { kind: "role"; row: CouncilsParticipantRoleDto | null } | { kind: "councilType"; row: CouncilsCouncilTypeDto | null } | { kind: "decisionType"; row: CouncilsDecisionTypeDto | null } | { kind: "settings"; row: CouncilsSettingsDto } | null;

/**
 * Paramètres du conseil de classe : rôles de participants, types de conseil, types de décision et réglages de
 * l'établissement. Ce sont des DONNÉES : aucune valeur réglementaire n'est fournie par le code (quorum vide par défaut).
 */
export function SettingsScreen() {
  const t = useTranslations("v2Councils.settings");
  const ref = useCouncilsReference();
  const flash = useFlash();
  const [editing, setEditing] = useState<Editing>(null);
  const data = ref.data;
  const done = () => flash.show(t("saved"));
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <CouncilsBoundary query={ref}>
        {data ? (
          <div className="space-y-6">
            <RolesSection roles={data.roles} onEdit={(row) => setEditing({ kind: "role", row })} />
            <CouncilTypesSection types={data.councilTypes} onEdit={(row) => setEditing({ kind: "councilType", row })} />
            <DecisionTypesSection types={data.decisionTypes} onEdit={(row) => setEditing({ kind: "decisionType", row })} />
            <SettingsSection settings={data.settings} onEdit={(row) => setEditing({ kind: "settings", row })} />
          </div>
        ) : null}
      </CouncilsBoundary>
      {editing?.kind === "role" ? <RoleDialog row={editing.row} onClose={() => setEditing(null)} onDone={done} /> : null}
      {editing?.kind === "councilType" ? <CouncilTypeDialog row={editing.row} roles={data?.roles ?? []} onClose={() => setEditing(null)} onDone={done} /> : null}
      {editing?.kind === "decisionType" ? <DecisionTypeDialog row={editing.row} onClose={() => setEditing(null)} onDone={done} /> : null}
      {editing?.kind === "settings" ? <SettingsDialog row={editing.row} onClose={() => setEditing(null)} onDone={done} /> : null}
    </div>
  );
}

function yesNo(t: (k: string) => string, v: boolean) {
  return v ? t("yes") : t("no");
}

function RolesSection({ roles, onEdit }: { roles: CouncilsParticipantRoleDto[]; onEdit: (row: CouncilsParticipantRoleDto | null) => void }) {
  const t = useTranslations("v2Councils.settings.roles");
  const tc = useTranslations("v2Councils.settings.common");
  return (
    <Section id="set-roles" title={t("title")} actions={<button type="button" className={buttonClass.secondary} onClick={() => onEdit(null)}>{t("add")}</button>}>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {roles.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{tc("code")}</th>
              <th scope="col" className={TH}>{tc("label")}</th>
              <th scope="col" className={TH}>{t("isVoting")}</th>
              <th scope="col" className={TH}>{t("countsForQuorum")}</th>
              <th scope="col" className={TH}>{t("maySign")}</th>
              <th scope="col" className={TH}>{t("canDecide")}</th>
              <th scope="col" className={TH}>{tc("active")}</th>
              <th scope="col" className={TH}><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {roles.map((r) => (
              <tr key={r.id}>
                <td className={TD}><code>{r.code}</code></td>
                <td className={TD}>{r.label}{r.isExternal ? <StatusBadge label={t("external")} className="ml-2" /> : null}</td>
                <td className={TD}>{yesNo(tc, r.isVoting)}</td>
                <td className={TD}>{yesNo(tc, r.countsForQuorum)}</td>
                <td className={TD}>{yesNo(tc, r.maySign)}</td>
                <td className={TD}>{yesNo(tc, r.canDecide)}</td>
                <td className={TD}>{yesNo(tc, r.active)}</td>
                <td className={TD}><button type="button" className={buttonClass.ghost} onClick={() => onEdit(r)} aria-label={tc("editNamed", { name: r.label })}>{tc("edit")}</button></td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

function CouncilTypesSection({ types, onEdit }: { types: CouncilsCouncilTypeDto[]; onEdit: (row: CouncilsCouncilTypeDto | null) => void }) {
  const t = useTranslations("v2Councils.settings.councilTypes");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  return (
    <Section id="set-council-types" title={t("title")} actions={<button type="button" className={buttonClass.secondary} onClick={() => onEdit(null)}>{t("add")}</button>}>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {types.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{tc("code")}</th>
              <th scope="col" className={TH}>{tc("label")}</th>
              <th scope="col" className={TH}>{t("scope")}</th>
              <th scope="col" className={TH}>{t("minResultsStatus")}</th>
              <th scope="col" className={TH}>{t("minParticipants")}</th>
              <th scope="col" className={TH}>{tc("active")}</th>
              <th scope="col" className={TH}><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {types.map((x) => (
              <tr key={x.id}>
                <td className={TD}><code>{x.code}</code></td>
                <td className={TD}>{x.label}</td>
                <td className={TD}>{text("scope", x.scope)}</td>
                <td className={TD}>{text("resultsStatus", x.minResultsStatus)}</td>
                <td className={TD}>{x.minParticipants === null ? t("noQuorum") : x.minParticipants}</td>
                <td className={TD}>{yesNo(tc, x.active)}</td>
                <td className={TD}><button type="button" className={buttonClass.ghost} onClick={() => onEdit(x)} aria-label={tc("editNamed", { name: x.label })}>{tc("edit")}</button></td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

function DecisionTypesSection({ types, onEdit }: { types: CouncilsDecisionTypeDto[]; onEdit: (row: CouncilsDecisionTypeDto | null) => void }) {
  const t = useTranslations("v2Councils.settings.decisionTypes");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  return (
    <Section id="set-decision-types" title={t("title")} actions={<button type="button" className={buttonClass.secondary} onClick={() => onEdit(null)}>{t("add")}</button>}>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {types.length === 0 ? (
        <EmptyBlock title={t("empty")} />
      ) : (
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{tc("code")}</th>
              <th scope="col" className={TH}>{tc("label")}</th>
              <th scope="col" className={TH}>{t("family")}</th>
              <th scope="col" className={TH}>{t("exclusiveGroup")}</th>
              <th scope="col" className={TH}>{t("rules")}</th>
              <th scope="col" className={TH}>{tc("active")}</th>
              <th scope="col" className={TH}><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {types.map((x) => (
              <tr key={x.id}>
                <td className={TD}><code>{x.code}</code>{x.isSystem ? <StatusBadge label={t("system")} className="ml-2" /> : null}</td>
                <td className={TD}>{x.label}</td>
                <td className={TD}>{text("decisionFamily", x.family)}</td>
                <td className={TD}>{x.exclusiveGroup ?? "—"}</td>
                <td className={TD}>
                  <div className="flex flex-wrap gap-1">
                    {x.requiresJustification ? <StatusBadge label={t("flags.justification")} /> : null}
                    {x.requiresVote ? <StatusBadge label={t("flags.vote")} /> : null}
                    {x.requiresTarget ? <StatusBadge label={t("flags.target")} /> : null}
                    {x.needsHumanApplication ? <StatusBadge label={t("flags.humanApplication")} tone="warning" /> : null}
                  </div>
                </td>
                <td className={TD}>{yesNo(tc, x.active)}</td>
                <td className={TD}><button type="button" className={buttonClass.ghost} onClick={() => onEdit(x)} aria-label={tc("editNamed", { name: x.label })}>{tc("edit")}</button></td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

function SettingsSection({ settings, onEdit }: { settings: CouncilsSettingsDto[]; onEdit: (row: CouncilsSettingsDto) => void }) {
  const t = useTranslations("v2Councils.settings.institution");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  return (
    <Section id="set-institution" title={t("title")}>
      {settings.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="space-y-3">
          {settings.map((s) => (
            <li key={s.institutionId} className="space-y-2 rounded-md border p-3">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">{t("requireSeparateUnlocker")}</dt><dd className="text-sm font-medium">{yesNo(tc, s.requireSeparateUnlocker)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("effectsTrigger")}</dt><dd className="text-sm font-medium">{text("effectsTrigger", s.effectsTrigger)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("guardianVisibility")}</dt><dd className="text-sm font-medium">{text("guardianVisibility", s.guardianVisibility)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("allowQuorumWaiver")}</dt><dd className="text-sm font-medium">{yesNo(tc, s.allowQuorumWaiver)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("minutesTemplateKey")}</dt><dd className="text-sm font-medium">{s.minutesTemplateKey ?? "—"}</dd></div>
              </dl>
              <button type="button" className={buttonClass.secondary} onClick={() => onEdit(s)}>{tc("edit")}</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Formulaires d'édition (PUT = création ou mise à jour par code)
// ---------------------------------------------------------------------------

const numberOrUndefined = (s: string) => (s.trim() === "" ? undefined : Number(s));
const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());
const generalError = (e: unknown) => (e && Object.keys(apiErrorToFieldErrors(e)).length === 0 ? e : undefined);

function RoleDialog({ row, onClose, onDone }: { row: CouncilsParticipantRoleDto | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.settings.roles");
  const tc = useTranslations("v2Councils.settings.common");
  const upsert = useUpsertParticipantRole();
  const [code, setCode] = useState(row?.code ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [isVoting, setIsVoting] = useState(row?.isVoting ?? true);
  const [countsForQuorum, setCounts] = useState(row?.countsForQuorum ?? true);
  const [maySign, setMaySign] = useState(row?.maySign ?? true);
  const [canDecide, setCanDecide] = useState(row?.canDecide ?? false);
  const [isExternal, setExternal] = useState(row?.isExternal ?? false);
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const v = validateWith(councilsParticipantRoleInputSchema, { code: code.trim(), label: label.trim(), isVoting, countsForQuorum, maySign, canDecide, isExternal, sortOrder: numberOrUndefined(sortOrder), active });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    upsert.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={row ? t("editTitle") : t("addTitle")} description={t("dialogHint")} submitLabel={tc("save")} onSubmit={submit} isPending={upsert.isPending} error={generalError(upsert.error)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("code")} hint={tc("codeHint")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} disabled={row !== null} maxLength={40} />}</FormField>
        <FormField label={tc("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}</FormField>
      </div>
      <CheckControl checked={isVoting} onChange={setIsVoting} label={t("isVoting")} />
      <CheckControl checked={countsForQuorum} onChange={setCounts} label={t("countsForQuorum")} />
      <CheckControl checked={maySign} onChange={setMaySign} label={t("maySign")} />
      <CheckControl checked={canDecide} onChange={setCanDecide} label={t("canDecide")} hint={t("canDecideHint")} />
      <CheckControl checked={isExternal} onChange={setExternal} label={t("isExternal")} />
      <FormField label={tc("sortOrder")} error={errors.sortOrder ?? null}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={sortOrder} onChange={setSortOrder} />}</FormField>
      <CheckControl checked={active} onChange={setActive} label={tc("active")} />
    </FormDialog>
  );
}

function ToggleList({ legend, items, selected, onChange, error }: { legend: string; items: Array<{ value: string; label: string }>; selected: string[]; onChange: (next: string[]) => void; error?: string | null }) {
  return (
    <fieldset className="rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {items.map((i) => (
        <CheckControl key={i.value} checked={selected.includes(i.value)} onChange={(on) => onChange(on ? [...selected, i.value] : selected.filter((x) => x !== i.value))} label={i.label} />
      ))}
      {error ? <p role="alert" className="text-xs font-medium text-destructive">{error}</p> : null}
    </fieldset>
  );
}

function CouncilTypeDialog({ row, roles, onClose, onDone }: { row: CouncilsCouncilTypeDto | null; roles: CouncilsParticipantRoleDto[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.settings.councilTypes");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  const upsert = useUpsertCouncilType();
  const [code, setCode] = useState(row?.code ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [scope, setScope] = useState<string>(row?.scope ?? "PERIOD");
  const [minResultsStatus, setMinStatus] = useState<string>(row?.minResultsStatus ?? "GRADING_LOCKED");
  const [minParticipants, setMinParticipants] = useState(row?.minParticipants === null || row?.minParticipants === undefined ? "" : String(row.minParticipants));
  const [requiredRoleCodes, setRequired] = useState<string[]>(row?.requiredRoleCodes ?? []);
  const [signerFunctions, setSignerFunctions] = useState<string[]>(row?.signerFunctions ?? ["PRESIDENT", "SECRETARY"]);
  const [signerRoleCodes, setSignerRoles] = useState<string[]>(row?.signerRoleCodes ?? []);
  const [perStudent, setPerStudent] = useState(row?.requiresDecisionPerStudent ?? false);
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const roleItems = roles.filter((r) => r.active).map((r) => ({ value: r.code, label: r.label }));
  function submit() {
    const v = validateWith(councilsCouncilTypeInputSchema, {
      code: code.trim(),
      label: label.trim(),
      scope,
      minResultsStatus,
      minParticipants: numberOrUndefined(minParticipants) ?? null,
      requiredRoleCodes,
      signerFunctions,
      signerRoleCodes,
      requiresDecisionPerStudent: perStudent,
      sortOrder: numberOrUndefined(sortOrder),
      active,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    upsert.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={row ? t("editTitle") : t("addTitle")} description={t("dialogHint")} submitLabel={tc("save")} onSubmit={submit} isPending={upsert.isPending} error={generalError(upsert.error)} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("code")} hint={tc("codeHint")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} disabled={row !== null} maxLength={40} />}</FormField>
        <FormField label={tc("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}</FormField>
        <FormField label={t("scope")} required error={errors.scope ?? null}>{(c) => <NativeSelect {...c} value={scope} onChange={setScope} options={COUNCIL_SCOPES.map((s) => ({ value: s, label: text("scope", s) }))} />}</FormField>
        <FormField label={t("minResultsStatus")} required error={errors.minResultsStatus ?? null}>{(c) => <NativeSelect {...c} value={minResultsStatus} onChange={setMinStatus} options={COUNCIL_RESULTS_STATUSES.map((s) => ({ value: s, label: text("resultsStatus", s) }))} />}</FormField>
        <FormField label={t("minParticipants")} hint={t("minParticipantsHint")} error={errors.minParticipants ?? null}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} value={minParticipants} onChange={setMinParticipants} />}</FormField>
        <FormField label={tc("sortOrder")} error={errors.sortOrder ?? null}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={sortOrder} onChange={setSortOrder} />}</FormField>
      </div>
      <ToggleList legend={t("requiredRoles")} items={roleItems} selected={requiredRoleCodes} onChange={setRequired} error={errors.requiredRoleCodes ?? null} />
      <ToggleList legend={t("signerFunctions")} items={COUNCIL_FUNCTIONS.map((f) => ({ value: f, label: text("function", f) }))} selected={signerFunctions} onChange={setSignerFunctions} error={errors.signerFunctions ?? null} />
      <ToggleList legend={t("signerRoles")} items={roleItems} selected={signerRoleCodes} onChange={setSignerRoles} error={errors.signerRoleCodes ?? null} />
      <CheckControl checked={perStudent} onChange={setPerStudent} label={t("requiresDecisionPerStudent")} />
      <CheckControl checked={active} onChange={setActive} label={tc("active")} />
    </FormDialog>
  );
}

function DecisionTypeDialog({ row, onClose, onDone }: { row: CouncilsDecisionTypeDto | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.settings.decisionTypes");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  const upsert = useUpsertDecisionType();
  const [code, setCode] = useState(row?.code ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [family, setFamily] = useState<string>(row?.family ?? "OTHER");
  const [appliesTo, setAppliesTo] = useState<string>(row?.appliesTo ?? "YEAR");
  const [exclusiveGroup, setExclusive] = useState(row?.exclusiveGroup ?? "");
  const [requiresJustification, setReqJust] = useState(row?.requiresJustification ?? false);
  const [requiresVote, setReqVote] = useState(row?.requiresVote ?? false);
  const [requiresTarget, setReqTarget] = useState(row?.requiresTarget ?? false);
  const [resultsDecisionKind, setRdk] = useState(row?.resultsDecisionKind ?? "");
  const [resultsFinalCode, setRfc] = useState(row?.resultsFinalCode ?? "");
  const [academicOutcomeCode, setAoc] = useState(row?.academicOutcomeCode ?? "");
  const [needsHumanApplication, setHuman] = useState(row?.needsHumanApplication ?? false);
  const [studentStatus, setStudentStatus] = useState<string>(row?.studentStatus ?? "");
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const v = validateWith(councilsDecisionTypeInputSchema, {
      code: code.trim(),
      label: label.trim(),
      family,
      appliesTo,
      exclusiveGroup: nullIfEmpty(exclusiveGroup),
      requiresJustification,
      requiresVote,
      requiresTarget,
      resultsDecisionKind: nullIfEmpty(resultsDecisionKind),
      resultsFinalCode: nullIfEmpty(resultsFinalCode),
      academicOutcomeCode: nullIfEmpty(academicOutcomeCode),
      needsHumanApplication,
      studentStatus: studentStatus || null,
      sortOrder: numberOrUndefined(sortOrder),
      active,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    upsert.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  const codeField = (label2: string, value: string, set: (v: string) => void, key: string, hint?: string) => (
    <FormField label={label2} hint={hint} error={errors[key] ?? null}>{(c) => <TextControl {...c} value={value} onChange={(v) => set(v.toUpperCase())} maxLength={40} />}</FormField>
  );
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={row ? t("editTitle") : t("addTitle")} description={t("dialogHint")} submitLabel={tc("save")} onSubmit={submit} isPending={upsert.isPending} error={generalError(upsert.error)} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("code")} hint={tc("codeHint")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} disabled={row !== null} maxLength={40} />}</FormField>
        <FormField label={tc("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}</FormField>
        <FormField label={t("family")} required error={errors.family ?? null}>{(c) => <NativeSelect {...c} value={family} onChange={setFamily} options={COUNCIL_DECISION_FAMILIES.map((f) => ({ value: f, label: text("decisionFamily", f) }))} />}</FormField>
        <FormField label={t("appliesTo")} required error={errors.appliesTo ?? null}>{(c) => <NativeSelect {...c} value={appliesTo} onChange={setAppliesTo} options={COUNCIL_DECISION_APPLIES_TO.map((a) => ({ value: a, label: text("appliesTo", a) }))} />}</FormField>
        {codeField(t("exclusiveGroup"), exclusiveGroup, setExclusive, "exclusiveGroup", t("exclusiveGroupHint"))}
        <FormField label={tc("sortOrder")} error={errors.sortOrder ?? null}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={sortOrder} onChange={setSortOrder} />}</FormField>
        {codeField(t("resultsDecisionKind"), resultsDecisionKind, setRdk, "resultsDecisionKind", t("resultsHint"))}
        {codeField(t("resultsFinalCode"), resultsFinalCode, setRfc, "resultsFinalCode")}
        {codeField(t("academicOutcomeCode"), academicOutcomeCode, setAoc, "academicOutcomeCode")}
        <FormField label={t("studentStatus")} hint={t("studentStatusHint")} error={errors.studentStatus ?? null}>
          {(c) => <NativeSelect {...c} value={studentStatus} placeholder={t("studentStatusNone")} onChange={setStudentStatus} options={(["SUSPENDED", "EXCLUDED"] as const).map((x) => ({ value: x, label: text("studentStatus", x) }))} />}
        </FormField>
      </div>
      <CheckControl checked={requiresJustification} onChange={setReqJust} label={t("flags.justification")} />
      <CheckControl checked={requiresVote} onChange={setReqVote} label={t("flags.vote")} />
      <CheckControl checked={requiresTarget} onChange={setReqTarget} label={t("flags.target")} />
      <CheckControl checked={needsHumanApplication} onChange={setHuman} label={t("flags.humanApplication")} hint={t("humanApplicationHint")} />
      <CheckControl checked={active} onChange={setActive} label={tc("active")} />
    </FormDialog>
  );
}

function SettingsDialog({ row, onClose, onDone }: { row: CouncilsSettingsDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.settings.institution");
  const tc = useTranslations("v2Councils.settings.common");
  const text = useEnumText();
  const upsert = useUpsertCouncilSettings();
  const [requireSeparateUnlocker, setSeparate] = useState(row.requireSeparateUnlocker);
  const [effectsTrigger, setTrigger] = useState<string>(row.effectsTrigger);
  const [guardianVisibility, setVisibility] = useState<string>(row.guardianVisibility);
  const [allowQuorumWaiver, setWaiver] = useState(row.allowQuorumWaiver);
  const [minutesTemplateKey, setTemplate] = useState(row.minutesTemplateKey ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const v = validateWith(councilsSettingsInputSchema, { institutionId: row.institutionId, requireSeparateUnlocker, effectsTrigger, guardianVisibility, allowQuorumWaiver, minutesTemplateKey: nullIfEmpty(minutesTemplateKey) });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    upsert.mutate(v.data, { onSuccess: () => { onDone(); onClose(); }, onError: (e) => setErrors(apiErrorToFieldErrors(e)) });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle")} description={t("dialogHint")} submitLabel={tc("save")} onSubmit={submit} isPending={upsert.isPending} error={generalError(upsert.error)}>
      <CheckControl checked={requireSeparateUnlocker} onChange={setSeparate} label={t("requireSeparateUnlocker")} hint={t("requireSeparateUnlockerHint")} />
      <FormField label={t("effectsTrigger")} hint={t("effectsTriggerHint")} error={errors.effectsTrigger ?? null}>{(c) => <NativeSelect {...c} value={effectsTrigger} onChange={setTrigger} options={COUNCIL_EFFECT_TRIGGERS.map((x) => ({ value: x, label: text("effectsTrigger", x) }))} />}</FormField>
      <FormField label={t("guardianVisibility")} hint={t("guardianVisibilityHint")} error={errors.guardianVisibility ?? null}>{(c) => <NativeSelect {...c} value={guardianVisibility} onChange={setVisibility} options={COUNCIL_GUARDIAN_VISIBILITIES.map((x) => ({ value: x, label: text("guardianVisibility", x) }))} />}</FormField>
      <CheckControl checked={allowQuorumWaiver} onChange={setWaiver} label={t("allowQuorumWaiver")} hint={t("allowQuorumWaiverHint")} />
      <FormField label={t("minutesTemplateKey")} hint={t("minutesTemplateKeyHint")} error={errors.minutesTemplateKey ?? null}>{(c) => <TextControl {...c} value={minutesTemplateKey} onChange={setTemplate} maxLength={61} />}</FormField>
    </FormDialog>
  );
}
