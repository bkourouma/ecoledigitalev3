"use client";

import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveToken } from "@/lib/jwt-storage";

type DemoAccount = {
  email: string;
  password: string;
  role?: string;
  name: string;
};

const demoAccounts =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEMO_ACCOUNTS
    ? (JSON.parse(process.env.NEXT_PUBLIC_DEMO_ACCOUNTS) as DemoAccount[])
    : process.env.NODE_ENV === "development"
      ? [
          {
            email: "admin@ecoledigitale.local",
            password: "Password@2025",
            role: "admin",
            name: "Admin EcoleDigitale",
          },
          {
            email: "owner@ecoledigitale.local",
            password: "Password@2025",
            role: "owner",
            name: "Owner EcoleDigitale",
          },
          {
            email: "seed.lp.teacher01@ecoledigitale.local",
            password: "LpRigl!2026-01",
            name: "seed.lp.teacher01@ecoledigitale.local",
          },
          {
            email: "fabrice.kouadio.lprigla01@example.com",
            password: "?DbFJ3EkSmA9",
            role: "student",
            name: "fabrice.kouadio.lprigla01@example.com",
          },
          {
            email: "marie.koffi.parent.lprigla@example.com",
            password: "4rJn%TgUYA7#",
            role: "parent",
            name: "marie.koffi.parent.lprigla@example.com",
          },
        ]
      : [];

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

  const fillForm = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
  };

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
              </form>
            </CardContent>
          </Card>

          <Card variant="glass" className="hover-lift">
            <CardHeader>
              <CardTitle>Comptes techniques</CardTitle>
              <CardDescription>Crees automatiquement par tenant et par role.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {demoAccounts.map((account, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="w-full justify-start text-left h-auto p-3"
                  onClick={() => fillForm(account)}
                >
                  <div className="w-full">
                    <div className="font-medium flex items-center gap-2">
                      {account.name}
                      {account.role ? (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                          {account.role}
                        </span>
                      ) : null}
                    </div>
                    {account.email !== account.name ? (
                      <div className="text-sm text-muted-foreground">{account.email}</div>
                    ) : null}
                  </div>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
