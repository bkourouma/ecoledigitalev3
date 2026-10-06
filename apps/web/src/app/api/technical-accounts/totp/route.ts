import { NextRequest, NextResponse } from "next/server";
import { findDevTotpSecret, technicalAccountsEnabled, totpAt, totpSecondsLeft } from "@/lib/technical-accounts.server";

/**
 * Code MFA courant d'un compte de test de `DEV_CREDENTIALS_FILE`, pour qu'un testeur remplisse l'étape de
 * vérification en deux étapes. Même garde que la liste : coupé en production sauf `SHOW_TECHNICAL_ACCOUNTS=true`.
 * Le secret TOTP ne quitte jamais le serveur, seul le code à 6 chiffres (valable 30 s) est renvoyé.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!technicalAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  const secret = email ? findDevTotpSecret(email) : null;
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  try {
    const now = Date.now();
    return NextResponse.json({ code: totpAt(secret, now), expiresIn: totpSecondsLeft(now) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
}
