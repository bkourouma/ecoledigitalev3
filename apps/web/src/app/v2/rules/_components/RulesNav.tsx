"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

/** Navigation des règles : catalogue des jeux de règles et liaisons contrat / périmètre. Chaque entrée exige sa permission. */
export function RulesNav() {
  const t = useTranslations("v2RulesBindings.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/rules", label: t("catalog"), permission: "rules.ruleset.read", exact: true },
        { href: "/v2/rules/bindings", label: t("bindings"), permission: "rules.ruleset.read" },
      ]}
    />
  );
}
