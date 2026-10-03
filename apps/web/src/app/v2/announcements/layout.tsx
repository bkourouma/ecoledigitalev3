import type { ReactNode } from "react";
import { MessagingShell } from "../messages/_components/MessagingShell";
import { AppShell } from "@/platform/shell/AppShell";

/** Habillage des annonces (`/v2/announcements/*`) : même navigation et même cloche que la messagerie. */
export default async function AnnouncementsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <MessagingShell>{children}</MessagingShell>
    </AppShell>
  );
}
