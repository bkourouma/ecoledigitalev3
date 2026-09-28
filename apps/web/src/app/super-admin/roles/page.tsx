"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Role = {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
  is_system: boolean;
};

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("superAdminToken");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export default function SuperAdminRolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadRoles = async () => {
    const token = localStorage.getItem("superAdminToken");
    if (!token) {
      router.push("/super-admin/login");
      return;
    }

    const response = await fetch(`${apiBaseUrl()}/api/v1/super-admin/roles`, {
      headers: authHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      router.push("/super-admin/login");
      return;
    }

    const data = await response.json();
    setRoles(data.roles || []);
  };

  useEffect(() => {
    loadRoles().catch(() => setError("Impossible de charger les roles."));
  }, []);

  const createRole = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl()}/api/v1/super-admin/roles`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ key, name }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Creation du role impossible.");
        return;
      }

      setKey("");
      setName("");
      await loadRoles();
    } finally {
      setLoading(false);
    }
  };

  const setActive = async (role: Role, isActive: boolean) => {
    await fetch(`${apiBaseUrl()}/api/v1/super-admin/roles/${role.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ isActive }),
    });
    await loadRoles();
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-bold gradient-text whitespace-nowrap text-2xl leading-tight md:text-3xl">Roles globaux</h1>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Les roles sont communs, mais leurs affectations restent isolees par tenant.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/super-admin/tenants">Tenants</Link>
          </Button>
        </div>

        <Card variant="glass">
          <CardHeader>
            <CardTitle>Creer un role</CardTitle>
            <CardDescription>
              Un compte technique sera cree immediatement pour ce role dans tous les tenants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createRole} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label htmlFor="key">Cle</Label>
                <Input
                  id="key"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toLowerCase())}
                  placeholder="role_key"
                  required
                />
              </div>
              <div>
                <Label htmlFor="name">Libelle</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={loading}>
                  {loading ? "Creation..." : "Creer"}
                </Button>
              </div>
            </form>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {roles.map((role) => (
            <Card key={role.id} variant="glass">
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold">{role.name}</div>
                  <div className="text-sm text-muted-foreground">{role.key}</div>
                  <div className="text-sm">{role.is_active ? "Actif" : "Desactive"}</div>
                </div>
                <Button variant="outline" onClick={() => setActive(role, !role.is_active)}>
                  {role.is_active ? "Desactiver" : "Activer"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
