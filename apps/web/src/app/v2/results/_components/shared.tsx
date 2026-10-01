"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRuleVersion } from "@/platform/v2/rules";
import { FormField } from "@/platform/ui/FormField";
import { ClassroomPicker, PeriodPicker } from "../../assessments/_components/shared";

/**
 * Libellés des codes de résultat (mention, décision, statut d'UE…) : ils viennent du `label_map` de la version de règle
 * épinglée (module `rules`). Aucune logique ne compare un libellé ; si la lecture de la règle est refusée ou absente, le
 * code lui-même est affiché.
 */
export function useCodeLabels(ruleVersionId: string | null) {
  const version = useRuleVersion(ruleVersionId);
  const rules = useMemo(
    () =>
      (version.data?.rules ?? []).map((r) => ({
        key: r.key,
        map: Object.fromEntries(Object.entries(r.labelMap).map(([code, byLocale]) => [code, byLocale.fr ?? Object.values(byLocale)[0] ?? code])),
      })),
    [version.data],
  );
  return useCallback(
    (code: string | null | undefined, prefer?: RegExp): string => {
      if (!code) return "—";
      const ordered = prefer ? [...rules.filter((r) => prefer.test(r.key)), ...rules.filter((r) => !prefer.test(r.key))] : rules;
      for (const r of ordered) if (r.map[code]) return r.map[code]!;
      return code;
    },
    [rules],
  );
}

/** Codes et libellés proposés par les règles dont la clé correspond (liste de choix d'une décision). */
export function useRuleCodeOptions(ruleVersionId: string | null, prefer: RegExp) {
  const version = useRuleVersion(ruleVersionId);
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const r of version.data?.rules ?? []) {
      if (!prefer.test(r.key)) continue;
      for (const [code, byLocale] of Object.entries(r.labelMap)) if (!out.has(code)) out.set(code, byLocale.fr ?? Object.values(byLocale)[0] ?? code);
    }
    return [...out].map(([value, label]) => ({ value, label }));
  }, [version.data, prefer]);
}

export const MENTION_RULE = /mention|appreciation/;
export const DECISION_RULE = /decision|promotion/;

/**
 * Sélection « classe + période » synchronisée avec l'adresse (lien profond, rechargement) sans navigation : l'état est local,
 * l'URL est mise à jour avec `history.replaceState` (Next la reflète dans `useSearchParams`).
 */
export function useClassPeriodSelection(initial: { classroom?: string; period?: string }) {
  const [classroomId, setClassroomState] = useState(initial.classroom ?? "");
  const [periodId, setPeriodState] = useState(initial.period ?? "");
  const sync = useCallback((classroom: string, period: string) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (classroom) url.searchParams.set("classroom", classroom);
      else url.searchParams.delete("classroom");
      if (period) url.searchParams.set("period", period);
      else url.searchParams.delete("period");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* adresse non modifiable (aperçu, test) : sans conséquence */
    }
  }, []);
  const setClassroom = useCallback(
    (id: string) => {
      setClassroomState(id);
      setPeriodState("");
      sync(id, "");
    },
    [sync],
  );
  const setPeriod = useCallback(
    (id: string) => {
      setPeriodState(id);
      sync(classroomId, id);
    },
    [sync, classroomId],
  );
  return { classroomId, periodId, setClassroom, setPeriod };
}

export function ClassPeriodSelector({ classroomId, periodId, onClassroom, onPeriod }: { classroomId: string; periodId: string; onClassroom: (id: string) => void; onPeriod: (id: string) => void }) {
  const t = useTranslations("v2Results.common");
  return (
    <form className="mb-4 grid gap-3 sm:grid-cols-2" aria-label={t("selector")} onSubmit={(e) => e.preventDefault()}>
      <FormField label={t("classroom")}>{(c) => <ClassroomPicker {...c} value={classroomId} onChange={onClassroom} />}</FormField>
      <FormField label={t("period")}>{(c) => <PeriodPicker {...c} classroomId={classroomId} value={periodId} onChange={onPeriod} />}</FormField>
    </form>
  );
}

/** Court identifiant affichable d'un hash (le détail complet reste copiable dans le titre). */
export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "—";
}
