"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { Checkbox, EmptyState, Field, Input } from "@ecoledigitale/ui";
import type { RbacPermissionEntry } from "@ecoledigitale/contracts/v2/rbac";
import { groupPermissions, groupState, toggleGroup, togglePermission } from "./matrix";

export interface PermissionMatrixProps {
  catalog: readonly RbacPermissionEntry[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Lecture seule (rôle système verrouillé, droits insuffisants). */
  readOnly?: boolean;
  /**
   * Permissions que l'utilisateur courant détient (anti-escalade : il ne peut accorder que celles-là). `null` quand
   * elles sont inconnues : aucune pré-vérification, c'est l'API qui tranche.
   */
  held?: ReadonlySet<string> | null;
}

/** Indicateur « sensible / MFA » : icône + texte (jamais la couleur seule). */
export function SensitiveBadge() {
  const t = useTranslations("access.matrix");
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
      title={t("sensitiveHelp")}
    >
      <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      {t("sensitive")}
    </span>
  );
}

/**
 * Matrice de permissions groupée par module : recherche, case « tout sélectionner » par module (état mixte),
 * indicateur sensible/MFA, permissions non accordables désactivées avec explication (anti-escalade côté UI ; la
 * décision finale reste celle de l'API).
 */
export function PermissionMatrix({ catalog, selected, onChange, readOnly, held = null }: PermissionMatrixProps) {
  const t = useTranslations("access.matrix");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupPermissions(catalog, query, t("otherModule")), [catalog, query, t]);
  const grantable = (key: string) => held === null || held.has(key);

  return (
    <fieldset className="space-y-4">
      <legend className="text-base font-semibold">{t("legend")}</legend>
      <Field label={t("search")} hint={t("searchHint")}>
        {(c) => <Input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />}
      </Field>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("selected", { count: selected.size })}
      </p>

      {groups.length === 0 ? <EmptyState title={t("noResults")} /> : null}

      {groups.map((group) => {
        const state = groupState(group, selected);
        const groupId = `perm-group-${group.moduleKey}`;
        const selectedCount = group.entries.filter((e) => selected.has(e.key)).length;
        const anyGrantable = group.entries.some((e) => grantable(e.key));
        return (
          <section key={group.moduleKey} aria-labelledby={`${groupId}-title`} className="rounded-lg border">
            <div className="flex min-h-11 items-center gap-3 border-b bg-muted/40 px-3 py-2">
              <Checkbox
                id={`${groupId}-all`}
                aria-label={t("selectGroup", { module: group.title })}
                checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
                disabled={readOnly || (!anyGrantable && state === "none")}
                onCheckedChange={(checked) => onChange(toggleGroup(selected, group, checked === true, grantable))}
              />
              <h3 id={`${groupId}-title`} className="flex-1 text-sm font-semibold">
                {group.title}
              </h3>
              <span className="text-xs text-muted-foreground">{t("group", { selected: selectedCount, total: group.entries.length })}</span>
            </div>
            <ul className="divide-y">
              {group.entries.map((entry) => {
                const id = `perm-${entry.key}`;
                const checked = selected.has(entry.key);
                const blocked = !grantable(entry.key) && !checked;
                return (
                  <li key={entry.key} className="flex items-start gap-3 px-3 py-2">
                    <Checkbox
                      id={id}
                      className="mt-1"
                      checked={checked}
                      disabled={readOnly || blocked}
                      aria-describedby={`${id}-desc`}
                      onCheckedChange={(next) => onChange(togglePermission(selected, entry.key, next === true))}
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={id} className="flex min-h-6 flex-wrap items-center gap-2 text-sm font-medium">
                        <span>{entry.label}</span>
                        {entry.sensitive ? <SensitiveBadge /> : null}
                      </label>
                      <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                        <code className="break-all">{entry.key}</code>
                        {entry.description ? <span> — {entry.description}</span> : null}
                        {blocked ? <span className="block font-medium text-amber-800">{t("notGrantable")}</span> : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </fieldset>
  );
}
