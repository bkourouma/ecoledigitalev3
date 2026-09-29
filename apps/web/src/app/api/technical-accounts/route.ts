import { NextRequest, NextResponse } from "next/server";
import {
  buildTechnicalAccounts,
  technicalAccountsEnabled,
} from "@/lib/technical-accounts.server";

/**
 * Comptes techniques affichés sur la page de connexion.
 *
 * Désactivé, la route ne renvoie que `{ enabled: false }` : aucun identifiant
 * ne quitte le serveur. Voir `technicalAccountsEnabled()` pour le réglage.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!technicalAccountsEnabled()) {
    return NextResponse.json({ enabled: false, accounts: [] });
  }

  const tenant = request.nextUrl.searchParams.get("tenant")?.trim() ?? "";
  const accounts = /^[a-z0-9-]{1,64}$/i.test(tenant) ? buildTechnicalAccounts(tenant) : [];

  return NextResponse.json({ enabled: true, accounts });
}
