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
import { NativeSelect } from "@/platform/ui/FormField";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
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
          <span role="status" aria-live="polite" className="rounded-md bg-black/20 px-2 py-1 font-mono text-base tracking-[0.25em] text-foreground">
            <span className="sr-only">{`Code MFA de ${email} : `}</span>
            {state.code}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="mfa-countdown">{`expire dans ${remaining} s`}</span>
          <Button type="button" size="sm" variant="outline" className="ml-auto h-8 rounded-md px-3 text-xs" onClick={() => void copy(state.code)} aria-label={`Copier le code MFA actuel de ${email}`}>
            {copied ? "Copié" : "Copier le code MFA actuel"}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-md px-3 text-xs" disabled={state.kind === "loading"} onClick={() => void load()} aria-label={`Afficher le code MFA de ${email}`}>
          {state.kind === "loading" ? "Chargement…" : "Afficher le code MFA"}
        </Button>
      )}
      {state.kind === "error" ? (
        <span role="alert" className="text-xs text-red-400">
          Code MFA indisponible.
        </span>
      ) : null}
    </div>
  );
}

/** Une teinte stable par rôle (avatar + badge), pour repérer d'un coup d'œil les comptes de même rôle. */
const TONES = [
  { avatar: "bg-sky-500", badge: "bg-sky-500/15 text-sky-300" },
  { avatar: "bg-rose-500", badge: "bg-rose-500/15 text-rose-300" },
  { avatar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-300" },
  { avatar: "bg-violet-500", badge: "bg-violet-500/15 text-violet-300" },
  { avatar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-300" },
  { avatar: "bg-teal-500", badge: "bg-teal-500/15 text-teal-300" },
  { avatar: "bg-pink-500", badge: "bg-pink-500/15 text-pink-300" },
  { avatar: "bg-indigo-500", badge: "bg-indigo-500/15 text-indigo-300" },
];
function toneOf(role: string) {
  let h = 0;
  for (const c of role) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Identifiant de rôle lisible : `_` remplacé par une espace. */
function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

const ALL = "__all__";

export function TechnicalAccountsPanel({
  accounts,
  onPick,
  header,
  description,
  className = "",
}: {
  accounts: TechnicalAccount[];
  /** Appelé au clic sur un compte : le parent remplit le formulaire de connexion. */
  onPick: (account: TechnicalAccount) => void;
  /** Contenu libre au-dessus de la liste (sélecteur de tenant de la page historique). */
  header?: ReactNode;
  description?: string;
  className?: string;
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
  const visibleCount = groups.reduce((n, [, rows]) => n + rows.length, 0);

  return (
    <Card variant="glass" className={`flex flex-col overflow-hidden shadow-xl shadow-black/20 ${className}`}>
      <div className="flex items-start gap-4 border-b border-white/10 p-6 sm:px-8">
        <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/20">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
            <path d="M16 9h2a2 2 0 0 1 2 2v10M2 21h20" />
            <path d="M8 7h4M8 11h4M8 15h4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-2xl">Comptes par tenant</CardTitle>
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Test uniquement
            </span>
          </div>
          <CardDescription className="leading-relaxed">{description ?? "Cliquez un compte pour remplir le formulaire de connexion."}</CardDescription>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 sm:px-8">
        {header}

        {tenants.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="technical-accounts-tenant" className="text-sm font-medium">
              Établissement
            </label>
            <NativeSelect
              id="technical-accounts-tenant"
              value={tenantFilter}
              onChange={setTenantFilter}
              options={[{ value: ALL, label: "Tous les établissements" }, ...tenants.map((t) => ({ value: t, label: t }))]}
            />
          </div>
        ) : null}

        {noPassword ? (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Mot de passe non configuré : un clic remplit seulement l'e-mail. Définissez <code>TECHNICAL_ACCOUNT_PASSWORD</code>{" "}
            dans <code>apps/web/.env.local</code> (et la même valeur côté API), puis redémarrez le serveur web.
          </p>
        ) : null}

        {visibleCount === 0 && accounts.length > 0 ? <p className="text-sm text-muted-foreground">Aucun compte pour cet établissement.</p> : null}

        <div className="custom-scrollbar -mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
          {groups.map(([tenant, rows]) => (
            <section key={tenant || "_"} aria-label={tenant ? `Comptes de ${tenant}` : "Comptes"} className="space-y-2">
              {tenant ? (
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {tenant}
                  <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
                </h2>
              ) : null}
              <ul className="space-y-2">
                {rows.map((account) => {
                  const tone = toneOf(account.role);
                  return (
                    <li
                      key={`${tenant}:${account.email}`}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] transition-colors focus-within:border-violet-400/50 hover:border-violet-400/40 hover:bg-white/[0.06]"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-2xl p-3 text-left"
                        onClick={() => onPick(account)}
                        aria-label={`Remplir le formulaire avec ${account.label ?? account.role} (${account.email})`}
                      >
                        <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${tone.avatar}`}>
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="8" r="3.5" />
                            <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold leading-tight">{account.label ?? account.name}</span>
                            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone.badge}`}>{roleLabel(account.role)}</span>
                            {account.mfa ? <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">MFA</span> : null}
                          </span>
                          {account.label ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{account.email}</span> : null}
                        </span>
                      </button>
                      {account.mfa ? (
                        <div className="border-t border-white/10 px-3 py-2">
                          <MfaCode email={account.email} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Card>
  );
}
