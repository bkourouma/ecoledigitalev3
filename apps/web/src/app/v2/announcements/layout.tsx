import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { MessagingShell } from "../messages/_components/MessagingShell";

/** Habillage des annonces (`/v2/announcements/*`) : même navigation et même cloche que la messagerie. */
export default async function AnnouncementsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <MessagingShell>{children}</MessagingShell>;
}
