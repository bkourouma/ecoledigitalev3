"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useGuardians } from "@/platform/v2/people";

export interface PickedPerson {
  personId: string;
  displayName: string;
}

/**
 * Sélecteur de participant EXTERNE (parent délégué, représentant) : recherche d'un tuteur du registre, dont la fiche
 * « personne » (`personId`) est transmise à la feuille de présence. Ne propose que des identités ; aucun champ sensible.
 * Réservé aux détenteurs de `guardian.read` (l'appelant masque le sélecteur sinon).
 */
export function ExternalParticipantPicker({ value, onChange, error, excludePersonIds = [] }: { value: PickedPerson | null; onChange: (next: PickedPerson | null) => void; error?: string | null; excludePersonIds?: readonly string[] }) {
  const t = useTranslations("v2CouncilsExtra.external");
  const [q, setQ] = useState("");
  const term = q.trim();
  const search = useGuardians({ q: term, limit: 20 }, { enabled: term.length >= 2 });
  const taken = new Set(excludePersonIds);
  const found = (search.data?.items ?? []).filter((g) => !taken.has(g.personId));
  return (
    <div className="space-y-3">
      <FormField label={t("search")} hint={t("searchHint")}>
        {(c) => (
          <TextControl
            {...c}
            value={q}
            onChange={(v) => {
              setQ(v);
              onChange(null);
            }}
            maxLength={100}
          />
        )}
      </FormField>
      {term.length >= 2 && search.isLoading ? <LoadingBlock /> : null}
      {term.length >= 2 && search.isError ? <Notice kind="error">{t("error")}</Notice> : null}
      {term.length >= 2 && search.isSuccess && found.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      {found.length > 0 ? (
        <FormField label={t("person")} required error={error ?? null}>
          {(c) => (
            <NativeSelect
              {...c}
              value={value?.personId ?? ""}
              placeholder={t("choose")}
              onChange={(id) => {
                const g = found.find((x) => x.personId === id);
                onChange(g ? { personId: g.personId, displayName: g.displayName } : null);
              }}
              options={found.map((g) => ({ value: g.personId, label: g.displayName }))}
            />
          )}
        </FormField>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
