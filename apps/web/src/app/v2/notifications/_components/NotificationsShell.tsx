"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";
import { READ, SELF_PERMISSIONS, SEND_PERMISSIONS, VIEW_PERMISSIONS } from "./notifications-utils";

/** Navigation de la section notifications (onglets défilants sur mobile). Chaque entrée n'apparaît qu'avec sa permission. */
export function NotificationsNav() {
  const t = useTranslations("v2Notifications.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/notifications", label: t("journal"), permission: READ, exact: true },
        { href: "/v2/notifications/send", label: t("send"), anyPermission: SEND_PERMISSIONS },
        { href: "/v2/notifications/templates", label: t("templates"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/notifications/rules", label: t("rules"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/notifications/channels", label: t("channels"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/account/notifications", label: t("preferences"), anyPermission: SELF_PERMISSIONS },
      ]}
    />
  );
}

export function NotificationsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <NotificationsNav />
      {children}
    </div>
  );
}
