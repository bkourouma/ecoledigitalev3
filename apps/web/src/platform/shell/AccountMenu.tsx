"use client";

import Link from "next/link";
import { Building2, LogOut, User, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { isAuthV2 } from "@/platform/auth/iam-config";
import { HeaderPopover } from "./HeaderPopover";
import { roleLabel } from "./labels";
import { signOutEverywhere, useSessionSwitch, useShellSession } from "./session";

const ITEM = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

/**
 * Compte de l'utilisateur dans l'en-tête : identité, rôle actif, changement de rôle et d'établissement (quand le compte en a
 * plusieurs et que l'authentification V2 le permet), liens de sécurité du compte. La déconnexion est un bouton à part, toujours
 * visible (`SignOutButton`).
 */
export function AccountMenu() {
  const t = useTranslations("v2Shell.account");
  const tRoles = useTranslations("v2Shell.roles");
  const session = useShellSession();
  const sw = useSessionSwitch();
  const v2 = isAuthV2();
  const otherRoles = session.roles.filter((r) => r.toLowerCase() !== (session.activeRole ?? "").toLowerCase());
  const otherTenants = session.tenants.filter((x) => x.id !== session.tenantId);
  const who = session.name ?? session.email ?? t("anonymous");

  return (
    <HeaderPopover label={t("button")} icon={<User className="h-4 w-4" aria-hidden="true" />} align="right" hideLabelOnMobile>
      {({ close }) => (
        <div className="space-y-2">
          <div className="px-3 py-1 text-sm">
            <p className="truncate font-semibold">{who}</p>
            {session.name && session.email ? <p className="truncate text-xs text-muted-foreground">{session.email}</p> : null}
            {session.activeRole ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("activeRole")} : <span className="font-medium text-foreground">{roleLabel(tRoles, session.activeRole)}</span>
              </p>
            ) : null}
          </div>

          {sw.available && otherRoles.length > 0 ? (
            <section aria-label={t("switchRole")} className="border-t pt-2">
              <p aria-hidden="true" className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("switchRole")}</p>
              <ul>
                {otherRoles.map((role) => (
                  <li key={role}>
                    <button type="button" className={ITEM} disabled={sw.busy !== null} onClick={() => void sw.switchRole(role)}>
                      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{roleLabel(tRoles, role)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sw.available && otherTenants.length > 0 ? (
            <section aria-label={t("switchTenant")} className="border-t pt-2">
              <p aria-hidden="true" className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("switchTenant")}</p>
              <ul>
                {otherTenants.map((tenant) => (
                  <li key={tenant.id}>
                    <button type="button" className={ITEM} disabled={sw.busy !== null} onClick={() => void sw.switchTenant(tenant.id)}>
                      <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{tenant.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sw.error ? (
            <p role="alert" className="px-3 text-xs font-medium text-destructive">
              {sw.error}
            </p>
          ) : null}

          {v2 ? (
            <ul className="border-t pt-2">
              <li>
                <Link href="/v2/account/security" onClick={close} className={ITEM}>
                  {t("security")}
                </Link>
              </li>
              <li>
                <Link href="/v2/account/sessions" onClick={close} className={ITEM}>
                  {t("sessions")}
                </Link>
              </li>
              <li>
                <Link href="/v2/account/notifications" onClick={close} className={ITEM}>
                  {t("notifications")}
                </Link>
              </li>
              {session.tenants.length > 1 ? (
                <li>
                  <Link href="/v2/account/tenants" onClick={close} className={ITEM}>
                    {t("tenants")}
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </HeaderPopover>
  );
}

/** Déconnexion : toujours visible dans l'en-tête (un geste, y compris sur mobile). */
export function SignOutButton() {
  const t = useTranslations("v2Shell.account");
  return (
    <button
      type="button"
      onClick={() => void signOutEverywhere()}
      className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{t("signOut")}</span>
    </button>
  );
}
