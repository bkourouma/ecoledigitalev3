// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TechnicalAccount } from "@/lib/technical-accounts";
import { LoginWithTechnicalAccounts } from "./LoginWithTechnicalAccounts";
import { TechnicalAccountsPanel } from "./TechnicalAccountsPanel";

// Doublure du formulaire : n'expose que le préremplissage reçu (le vrai formulaire dépend de NextAuth et du routeur).
vi.mock("./LoginFlow", () => ({
  LoginFlow: ({ prefill }: { prefill?: { email: string; password: string } }) => (
    <form aria-label="Connexion">
      <input aria-label="Adresse e-mail" readOnly value={prefill?.email ?? ""} />
      <input aria-label="Mot de passe" readOnly value={prefill?.password ?? ""} />
    </form>
  ),
}));
vi.mock("@/platform/tenant/browser", () => ({ resolveBrowserTenant: () => null }));

const accounts: TechnicalAccount[] = [
  { tenant: "ecole-a", role: "directeur", label: "Directeur", email: "dir@ecole-a.test", password: "fake-pw-1", name: "dir@ecole-a.test", mfa: true },
  { tenant: "ecole-a", role: "enseignant", label: "Enseignant", email: "ens@ecole-a.test", password: "fake-pw-2", name: "ens@ecole-a.test", mfa: false },
  { tenant: "ecole-b", role: "parent", label: "Parent (tuteur)", email: "par@ecole-b.test", password: "fake-pw-3", name: "par@ecole-b.test", mfa: false },
];

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("TechnicalAccountsPanel", () => {
  it("regroupe les comptes par établissement et appelle onPick au clic", () => {
    const onPick = vi.fn();
    render(<TechnicalAccountsPanel accounts={accounts} onPick={onPick} />);
    expect(screen.getByRole("heading", { name: "ecole-a" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ecole-b" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Remplir le formulaire avec Parent \(tuteur\)/ }));
    expect(onPick).toHaveBeenCalledWith(accounts[2]);
  });

  it("filtre par établissement avec le sélecteur quand il y en a plusieurs", () => {
    render(<TechnicalAccountsPanel accounts={accounts} onPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("Établissement"), { target: { value: "ecole-b" } });
    expect(screen.queryByRole("heading", { name: "ecole-a" })).toBeNull();
    expect(screen.getByRole("heading", { name: "ecole-b" })).toBeTruthy();
  });

  it("n'affiche pas de sélecteur pour un seul établissement", () => {
    render(<TechnicalAccountsPanel accounts={accounts.slice(0, 2)} onPick={() => {}} />);
    expect(screen.queryByLabelText("Établissement")).toBeNull();
  });

  it("garde l'avertissement quand aucun mot de passe n'est configuré", () => {
    const sansMotDePasse = accounts.map((a) => ({ ...a, password: "" }));
    render(<TechnicalAccountsPanel accounts={sansMotDePasse} onPick={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Mot de passe non configuré");
  });

  it("affiche le code MFA courant avec son compte à rebours dans une zone aria-live", async () => {
    const fetchMock = mockFetch({ "/api/technical-accounts/totp": { body: { code: "287082", expiresIn: 12 } } });
    render(<TechnicalAccountsPanel accounts={accounts} onPick={() => {}} />);
    // Un seul compte à MFA : un seul bouton « Afficher le code MFA ».
    fireEvent.click(screen.getByRole("button", { name: "Afficher le code MFA de dir@ecole-a.test" }));
    const live = await screen.findByText("287082", { exact: false });
    expect(live.closest("[aria-live='polite']")).toBeTruthy();
    expect(screen.getByTestId("mfa-countdown").textContent).toBe("expire dans 12 s");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/technical-accounts/totp?email=dir%40ecole-a.test");
    expect(screen.getByRole("button", { name: "Copier le code MFA actuel de dir@ecole-a.test" })).toBeTruthy();
  });

  it("copie le code dans le presse-papiers", async () => {
    mockFetch({ "/api/technical-accounts/totp": { body: { code: "287082", expiresIn: 20 } } });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TechnicalAccountsPanel accounts={accounts} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Afficher le code MFA/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Copier le code MFA actuel/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("287082"));
    expect(await screen.findByText("Copié")).toBeTruthy();
  });

  it("signale l'indisponibilité du code MFA (404)", async () => {
    mockFetch({ "/api/technical-accounts/totp": { status: 404, body: { error: "not_found" } } });
    render(<TechnicalAccountsPanel accounts={accounts} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Afficher le code MFA/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("indisponible");
  });
});

describe("LoginWithTechnicalAccounts", () => {
  it("un clic sur un compte remplit e-mail et mot de passe du formulaire", async () => {
    mockFetch({ "/api/technical-accounts": { body: { enabled: true, accounts } } });
    render(<LoginWithTechnicalAccounts />);
    const panel = await screen.findByRole("complementary", { name: "Comptes de test" });
    fireEvent.click(within(panel).getByRole("button", { name: /Remplir le formulaire avec Enseignant/ }));
    expect((screen.getByLabelText("Adresse e-mail") as HTMLInputElement).value).toBe("ens@ecole-a.test");
    expect((screen.getByLabelText("Mot de passe") as HTMLInputElement).value).toBe("fake-pw-2");
  });

  it("n'affiche aucun panneau quand le serveur le désactive (production)", async () => {
    const fetchMock = mockFetch({ "/api/technical-accounts": { body: { enabled: false, accounts: [] } } });
    render(<LoginWithTechnicalAccounts />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("form", { name: "Connexion" })).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText("Comptes par tenant")).toBeNull();
  });

  it("n'affiche aucun panneau si la requête échoue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("réseau"))));
    render(<LoginWithTechnicalAccounts />);
    await Promise.resolve();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
