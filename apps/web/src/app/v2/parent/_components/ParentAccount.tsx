"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { isAuthV2 } from "@/platform/auth/iam-config";
import { usePermission } from "@/platform/access";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { OwnContactForm } from "../../_family/OwnContactForm";

/**
 * Paramètres du compte du parent : coordonnées modifiables par lui-même (jamais l'identité) et accès à la sécurité du compte
 * (mot de passe, double authentification, sessions) quand l'authentification v2 est active. Un parent dont les enfants sont dans
 * plusieurs établissements change d'établissement depuis « Mes établissements ».
 */
export function ParentAccount() {
  const t = useTranslations("v2Portal.parent.account");
  const session = useSession();
  const canEdit = usePermission("student.child.update").allowed;
  const v2 = isAuthV2();
  const name = session.data?.user?.name ?? null;
  const email = session.data?.user?.email ?? null;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="acc-identity" className="rounded-lg border p-4">
        <h2 id="acc-identity" className="mb-2 text-lg font-semibold">
          {t("identity")}
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("name")}</dt>
            <dd>{name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("loginEmail")}</dt>
            <dd>{email ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{t("identityHint")}</p>
      </section>
      {canEdit ? (
        <section aria-labelledby="acc-contact" className="space-y-3 rounded-lg border p-4">
          <h2 id="acc-contact" className="text-lg font-semibold">
            {t("contact")}
          </h2>
          <OwnContactForm kind="guardian" initial={{}} known={false} />
        </section>
      ) : null}
      {v2 ? (
        <section aria-labelledby="acc-security" className="space-y-2 rounded-lg border p-4">
          <h2 id="acc-security" className="text-lg font-semibold">
            {t("security")}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/v2/account/security" className={buttonClass.secondary}>
              {t("securityLink")}
            </Link>
            <Link href="/v2/account/sessions" className={buttonClass.secondary}>
              {t("sessionsLink")}
            </Link>
            <Link href="/v2/account/tenants" className={buttonClass.secondary}>
              {t("tenantsLink")}
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
