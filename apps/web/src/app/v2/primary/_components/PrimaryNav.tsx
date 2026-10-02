"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";
import { PRIMARY_GUARDS } from "./guards";

/** Navigation de section : seules les entrées dont l'utilisateur détient une permission sont affichées. */
export function PrimaryNav() {
  const t = useTranslations("v2PrimaryNav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/primary/classe", label: t("classe"), anyPermission: PRIMARY_GUARDS.classe },
        { href: "/v2/primary/competences", label: t("competences"), anyPermission: PRIMARY_GUARDS.competences },
        { href: "/v2/primary/appreciations", label: t("appreciations"), anyPermission: PRIMARY_GUARDS.appreciations },
        { href: "/v2/primary/conseil", label: t("conseil"), anyPermission: PRIMARY_GUARDS.conseil },
        { href: "/v2/primary/direction", label: t("direction"), anyPermission: PRIMARY_GUARDS.direction },
        { href: "/v2/primary/bilans", label: t("bilans"), anyPermission: PRIMARY_GUARDS.bilans },
        { href: "/v2/primary/archives", label: t("archives"), anyPermission: PRIMARY_GUARDS.archives },
        { href: "/v2/primary/etats", label: t("etats"), anyPermission: PRIMARY_GUARDS.etats },
        { href: "/v2/primary/parametres", label: t("parametres"), anyPermission: PRIMARY_GUARDS.parametres },
        { href: "/v2/primary/mon-enfant", label: t("monEnfant"), anyPermission: PRIMARY_GUARDS["mon-enfant"] },
      ]}
    />
  );
}
