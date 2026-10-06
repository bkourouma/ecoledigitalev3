import { NextRequest, NextResponse } from "next/server";
import {
  buildDevCredentialAccounts,
  buildTechnicalAccounts,
  technicalAccountsEnabled,
} from "@/lib/technical-accounts.server";

/**
 * Comptes techniques affichés sur la page de connexion.
 *
 * Désactivé, la route ne renvoie que `{ enabled: false }` : aucun identifiant
 * ne quitte le serveur. Voir `technicalAccountsEnabled()` pour le réglage.
 *
 * Si `DEV_CREDENTIALS_FILE` désigne un fichier lisible (même forme que
 * `.demo/credentials.json`), ses comptes sont renvoyés (tous établissements,
 * sans secret TOTP) ; sinon, comptes génériques du tenant demandé.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!technicalAccountsEnabled()) {
    return NextResponse.json({ enabled: false, accounts: [] }, { headers: NO_STORE });
  }

  const fromFile = buildDevCredentialAccounts();
  if (fromFile) return NextResponse.json({ enabled: true, accounts: fromFile }, { headers: NO_STORE });

  const tenant = request.nextUrl.searchParams.get("tenant")?.trim() ?? "";
  const accounts = /^[a-z0-9-]{1,64}$/i.test(tenant) ? buildTechnicalAccounts(tenant) : [];

  return NextResponse.json({ enabled: true, accounts }, { headers: NO_STORE });
}
