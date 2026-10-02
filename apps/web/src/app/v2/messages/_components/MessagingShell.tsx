"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";
import { NotificationBell } from "./NotificationBell";
import { READ_PERMISSIONS } from "./messaging-utils";

/** Navigation de la section messagerie / annonces (onglets défilants sur mobile) et cloche de notifications. */
export function MessagingNav() {
  const t = useTranslations("v2Messaging.nav");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <SectionNav
          label={t("label")}
          items={[
            { href: "/v2/messages", label: t("messages"), anyPermission: READ_PERMISSIONS, exact: true },
            { href: "/v2/announcements", label: t("announcements"), anyPermission: READ_PERMISSIONS },
            { href: "/v2/messages/notifications", label: t("notifications"), anyPermission: READ_PERMISSIONS },
            { href: "/v2/messages/moderation", label: t("moderation"), permission: "messaging.moderation.read" },
            { href: "/v2/messages/settings", label: t("settings"), permission: "messaging.settings.manage" },
          ]}
        />
      </div>
      <div className="mb-6 shrink-0">
        <NotificationBell />
      </div>
    </div>
  );
}

export function MessagingShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <MessagingNav />
      {children}
    </div>
  );
}
