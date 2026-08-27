"use client";

import { useState } from "react";
import { getSession, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveToken } from "@/lib/jwt-storage";
import { routeForRole } from "@/lib/role-landing";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

export default function SelectRolePage() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const roles = ((session as any)?.availableRoles || (session as any)?.roles || []) as string[];
  const activeRole = (session as any)?.activeRole as string | undefined;

  const chooseRole = async (role: string) => {
    setIsLoading(role);
    setError("");

    try {
      const currentSession = await getSession();
      const jwtToken = (currentSession as any)?.jwtToken;
      if (!jwtToken) {
        router.push("/login");
        return;
      }

      const response = await fetch(`${apiBaseUrl()}/api/v1/auth/switch-role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ activeRole: role }),
      });

      if (!response.ok) {
        setError("Impossible de changer de role actif.");
        return;
      }

      const data = await response.json();
      saveToken(data.token);
      localStorage.removeItem("superAdminToken");
      localStorage.removeItem("superAdminEmail");
      localStorage.removeItem("superAdminSelectedTenant");
      await update({
        jwtToken: data.token,
        jwtExpiresAt: data.expiresAt,
        activeRole: data.user.activeRole,
        roles: data.user.roles,
        availableRoles: data.user.availableRoles,
        requiresRoleSelection: false,
      });

      router.replace(routeForRole(data.user.activeRole));
      router.refresh();
    } catch {
      setError("Erreur lors du changement de role.");
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card variant="glass" className="w-full max-w-lg">
        <CardHeader>
          <CardTitle gradient>Choisir votre role actif</CardTitle>
          <CardDescription>
            Vos permissions seront limitees au role choisi. Vous pourrez le changer sans vous reconnecter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.map((role) => (
            <Button
              key={role}
              variant={role === activeRole ? "default" : "outline"}
              className="w-full justify-between"
              disabled={Boolean(isLoading)}
              onClick={() => chooseRole(role)}
            >
              <span>{role}</span>
              <span>{isLoading === role ? "Activation..." : role === activeRole ? "Actuel" : "Choisir"}</span>
            </Button>
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun role disponible pour ce compte.</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
