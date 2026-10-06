"use client";

/**
 * Panneau « Comptes par tenant » de la page de connexion (développement uniquement).
 *
 * Il liste les comptes de test servis par `/api/technical-accounts` (jamais présents dans le bundle) : un clic
 * remplit le formulaire de connexion. Pour les comptes à MFA, `/api/technical-accounts/totp` fournit le code
 * courant afin qu'un testeur puisse franchir l'étape de vérification en deux étapes.
 *
 * Le panneau n'existe que si le serveur répond `enabled: true` (voir `technicalAccountsEnabled()`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  TechnicalAccount,
  TechnicalAccountsResponse,
  TechnicalAccountTotpResponse,
} from "@/lib/technical-accounts";

/** Récupère les comptes techniques. `enabled` reste faux tant que le serveur ne l'a pas explicitement autorisé. */
export function useTechnicalAccounts(tenantSlug?: string): { enabled: boolean; accounts: TechnicalAccount[] } {
  const [state, setState] = useState<{ enabled: boolean; accounts: TechnicalAccount[] }>({ enabled: false, accounts: [] });

  useEffect(() => {
    let cancelled = false;
    const query = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : "";
    fetch(`/api/technical-accounts${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TechnicalAccountsResponse | null) => {
        if (cancelled) return;
        setState(data?.enabled === true ? { enabled: true, accounts: Array.isArray(data.accounts) ? data.accounts : [] } : { enabled: false, accounts: [] });
      })
      .catch(() => {
        if (!cancelled) setState({ enabled: false, accounts: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return state;
}

type MfaState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "code"; code: string; deadline: number };

/** Code MFA courant d'un compte : affichage, compte à rebours (renouvelé automatiquement) et copie. */
function MfaCode({ email }: { email: string }) {
  const [state, setState] = useState<MfaState>({ kind: "idle" });
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev.kind === "code" ? prev : { kind: "loading" }));
    try {
      const res = await fetch(`/api/technical-accounts/totp?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("totp");
      const data = (await res.json()) as TechnicalAccountTotpResponse;
      setCopied(false);
      setRemaining(data.expiresIn);
      setState({ kind: "code", code: data.code, deadline: Date.now() + data.expiresIn * 1000 });
    } catch {
      setState({ kind: "error" });
    }
  }, [email]);

  const deadline = state.kind === "code" ? state.deadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        void load();
      } else {
        setRemaining(left);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, load]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {state.kind === "code" ? (
        <>
          <span role="status" aria-live="polite" className="font-mono text-base tracking-widest">
            <span className="sr-only">{`Code MFA de ${email} : `}</span>
            {state.code}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="mfa-countdown">{`expire dans ${remaining} s`}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(state.code)} aria-label={`Copier le code MFA actuel de ${email}`}>
            {copied ? "Copié" : "Copier le code MFA actuel"}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={state.kind === "loading"} onClick={() => void load()} aria-label={`Afficher le code MFA de ${email}`}>
          {state.kind === "loading" ? "Chargement…" : "Afficher le code MFA"}
        </Button>
      )}
      {state.kind === "error" ? (
        <span role="alert" className="text-xs text-red-700">
          Code MFA indisponible.
        </span>
      ) : null}
    </div>
  );
}

const ALL = "__all__";

export function TechnicalAccountsPanel({
  accounts,
  onPick,
  header,
  description,
}: {
  accounts: TechnicalAccount[];
  /** Appelé au clic sur un compte : le parent remplit le formulaire de connexion. */
  onPick: (account: TechnicalAccount) => void;
  /** Contenu libre au-dessus de la liste (sélecteur de tenant de la page historique). */
  header?: ReactNode;
  description?: string;
}) {
  const [tenantFilter, setTenantFilter] = useState(ALL);

  const tenants = useMemo(() => {
    const seen: string[] = [];
    for (const a of accounts) if (a.tenant && !seen.includes(a.tenant)) seen.push(a.tenant);
    return seen;
  }, [accounts]);

  const groups = useMemo(() => {
    const map = new Map<string, TechnicalAccount[]>();
    for (const a of accounts) {
      const key = a.tenant ?? "";
      if (tenantFilter !== ALL && key !== tenantFilter) continue;
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()];
  }, [accounts, tenantFilter]);

  const noPassword = accounts.length > 0 && accounts.every((a) => !a.password);

  return (
    <Card variant="glass" className="hover-lift">
      <CardHeader>
        <CardTitle>Comptes par tenant</CardTitle>
        <CardDescription>{description ?? "Cliquez un compte pour remplir le formulaire de connexion."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {header}

        {tenants.length > 1 ? (
          <div className="space-y-1">
            <label htmlFor="technical-accounts-tenant" className="text-sm font-medium">
              Établissement
            </label>
            <select
              id="technical-accounts-tenant"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
            >
              <option value={ALL}>Tous les établissements</option>
              {tenants.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {noPassword ? (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Mot de passe non configuré : un clic remplit seulement l'e-mail. Définissez <code>TECHNICAL_ACCOUNT_PASSWORD</code>{" "}
            dans <code>apps/web/.env.local</code> (et la même valeur côté API), puis redémarrez le serveur web.
          </p>
        ) : null}

        {groups.map(([tenant, rows]) => (
          <section key={tenant || "_"} aria-label={tenant ? `Comptes de ${tenant}` : "Comptes"} className="space-y-2">
            {tenant ? <h2 className="text-sm font-semibold text-muted-foreground">{tenant}</h2> : null}
            <ul className="space-y-2">
              {rows.map((account) => (
                <li key={`${tenant}:${account.email}`} className="space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-start p-3 text-left"
                    onClick={() => onPick(account)}
                    aria-label={`Remplir le formulaire avec ${account.label ?? account.role} (${account.email})`}
                  >
                    <span className="block w-full">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {account.label ?? account.name}
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">{account.role}</span>
                        {account.mfa ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">MFA</span> : null}
                      </span>
                      {account.label ? <span className="block break-all text-xs text-muted-foreground">{account.email}</span> : null}
                    </span>
                  </Button>
                  {account.mfa ? <MfaCode email={account.email} /> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
