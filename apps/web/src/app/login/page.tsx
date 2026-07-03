"use client";

import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveToken } from "@/lib/jwt-storage";
import {
  DEFAULT_TECHNICAL_PASSWORD,
  KNOWN_TENANTS_STORAGE_KEY,
  SELECTED_TENANT_STORAGE_KEY,
  buildTechnicalAccounts,
  type TechnicalAccount,
} from "@/lib/technical-accounts";

type Tenant = { slug: string; name: string };

function routeForRole(role?: string): string {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "owner") return "/owner/dashboard";
  if (normalized === "teacher") return "/teacher/dashboard";
  if (normalized === "parent") return "/parent/children";
  if (normalized === "student") return "/student/courses";
  return "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");

  // Restore the previously picked tenant, render instantly from the cached list,
  // then refresh the list from the server route (/api/tenants).
  useEffect(() => {
    const storedSlug = localStorage.getItem(SELECTED_TENANT_STORAGE_KEY) || "";
    if (storedSlug) setSelectedSlug(storedSlug);

    try {
      const cached = localStorage.getItem(KNOWN_TENANTS_STORAGE_KEY);
      if (cached) {
        const list = JSON.parse(cached) as Tenant[];
        if (Array.isArray(list)) setTenants(list);
      }
    } catch {
      /* ignore malformed cache */
    }

    fetch("/api/tenants")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.tenants)) {
          setTenants(data.tenants as Tenant[]);
          localStorage.setItem(KNOWN_TENANTS_STORAGE_KEY, JSON.stringify(data.tenants));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyOverflowY = document.body.style.overflowY;
    const originalBodyHeight = document.body.style.height;
    const originalHtmlHeight = document.documentElement.style.height;

    document.documentElement.style.overflow = "auto";
    document.documentElement.style.height = "auto";
    document.body.style.overflow = "auto";
    document.body.style.overflowY = "auto";
    document.body.style.height = "auto";

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.height = originalHtmlHeight;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.overflowY = originalBodyOverflowY;
      document.body.style.height = originalBodyHeight;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Identifiants invalides. Verifiez votre email et votre mot de passe.");
        return;
      }

      const session = await getSession();
      if (session && (session as any).jwtToken) {
        saveToken((session as any).jwtToken);
        localStorage.removeItem("superAdminToken");
        localStorage.removeItem("superAdminEmail");
        localStorage.removeItem("superAdminSelectedTenant");
      }

      if ((session as any)?.requiresRoleSelection) {
        router.push("/select-role");
      } else {
        router.push(routeForRole((session as any)?.activeRole || (session as any)?.roles?.[0]));
      }
      router.refresh();
    } catch {
      setError("Erreur de connexion");
    } finally {
      setIsLoading(false);
    }
  };

  const fillForm = (account: TechnicalAccount) => {
    setEmail(account.email);
    setPassword(account.password);
  };

  const handleSelectTenant = (slug: string) => {
    setSelectedSlug(slug);
    localStorage.setItem(SELECTED_TENANT_STORAGE_KEY, slug);
  };

  // Technical accounts of the currently selected tenant.
  const technicalAccounts: TechnicalAccount[] = selectedSlug
    ? buildTechnicalAccounts(selectedSlug)
    : [];

  const selectedTenant = tenants.find((t) => t.slug === selectedSlug);

  // Tenant options for the selector — include the stored slug even if it is not
  // (yet) in the cached list.
  const tenantOptions = tenants.map((t) => ({ slug: t.slug, label: t.name || t.slug }));
  if (selectedSlug && !tenantOptions.some((o) => o.slug === selectedSlug)) {
    tenantOptions.unshift({ slug: selectedSlug, label: selectedSlug });
  }

  return (
    <div className="min-h-screen flex items-start justify-center bg-background pt-12 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-emerald-600 rounded-2xl flex items-center justify-center shadow-xl">
              <span className="text-white font-bold text-2xl">ED</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold gradient-text">EcoleDigitale</h1>
          <p className="mt-2 text-muted-foreground">Connexion a votre espace educatif</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card variant="glass" className="hover-lift">
            <CardHeader>
              <CardTitle gradient>Connexion</CardTitle>
              <CardDescription>Le tenant est deduit automatiquement de votre compte.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <div className="text-red-600 text-sm">{error}</div>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Connexion..." : "Se connecter"}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Pas encore de compte ?{" "}
                  <Link href="/register" className="text-blue-400 hover:underline">
                    S&apos;inscrire en ligne
                  </Link>
                </p>
              </form>
            </CardContent>
          </Card>

          <Card variant="glass" className="hover-lift">
            <CardHeader>
              <CardTitle>Comptes par tenant</CardTitle>
              <CardDescription>
                {selectedSlug
                  ? `Tenant : ${selectedTenant?.name || selectedSlug} — mot de passe : ${DEFAULT_TECHNICAL_PASSWORD}`
                  : "Choisissez un tenant pour voir ses comptes."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Tenant</Label>
                <Select value={selectedSlug || undefined} onValueChange={handleSelectTenant}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenantOptions.map((opt) => (
                      <SelectItem key={opt.slug} value={opt.slug}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {technicalAccounts.map((account, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    className="w-full justify-start text-left h-auto p-3"
                    onClick={() => fillForm(account)}
                  >
                    <div className="w-full">
                      <div className="font-medium flex items-center gap-2">
                        {account.name}
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                          {account.role}
                        </span>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
