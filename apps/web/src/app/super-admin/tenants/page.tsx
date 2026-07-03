"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KNOWN_TENANTS_STORAGE_KEY } from "@/lib/technical-accounts";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
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

export default function SuperAdminTenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadTenants = async () => {
    const token = localStorage.getItem("superAdminToken");
    if (!token) {
      router.push("/super-admin/login");
      return;
    }

    const response = await fetch(`${apiBaseUrl()}/api/v1/super-admin/tenants`, {
      headers: authHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      router.push("/super-admin/login");
      return;
    }

    const data = await response.json();
    const list: Tenant[] = data.tenants || [];
    setTenants(list);

    // Cache for the login page tenant selector (no dedicated endpoint needed).
    localStorage.setItem(
      KNOWN_TENANTS_STORAGE_KEY,
      JSON.stringify(list.map((t) => ({ slug: t.slug, name: t.name })))
    );
  };

  useEffect(() => {
    loadTenants().catch(() => setError("Impossible de charger les tenants."));
  }, []);

  const createTenant = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl()}/api/v1/super-admin/tenants`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name, slug }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Creation du tenant impossible.");
        return;
      }

      setName("");
      setSlug("");
      await loadTenants();
    } finally {
      setLoading(false);
    }
  };

  const setActive = async (tenant: Tenant, isActive: boolean) => {
    await fetch(`${apiBaseUrl()}/api/v1/super-admin/tenants/${tenant.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ isActive }),
    });
    await loadTenants();
  };

  const deleteTenant = async (tenant: Tenant) => {
    if (!window.confirm(`Supprimer definitivement le tenant ${tenant.slug} ?`)) return;
    await fetch(`${apiBaseUrl()}/api/v1/super-admin/tenants/${tenant.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await loadTenants();
  };

  const selectTenant = (tenant: Tenant) => {
    localStorage.setItem("superAdminSelectedTenant", tenant.slug);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Tenants</h1>
            <p className="text-muted-foreground">Creation et pilotage global des etablissements.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/super-admin/roles">Roles</Link>
            </Button>
            <Button variant="outline" onClick={() => router.push("/super-admin/login")}>
              Deconnexion
            </Button>
          </div>
        </div>

        <Card variant="glass">
          <CardHeader>
            <CardTitle>Creer un tenant</CardTitle>
            <CardDescription>
              Les comptes techniques seront crees automatiquement pour tous les roles globaux.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createTenant} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label htmlFor="name">Nom</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="exemple-ecole"
                  required
                />
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
          {tenants.map((tenant) => (
            <Card key={tenant.id} variant="glass">
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold">{tenant.name}</div>
                  <div className="text-sm text-muted-foreground">{tenant.slug}</div>
                  <div className="text-sm">{tenant.is_active ? "Actif" : "Desactive"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => selectTenant(tenant)}>
                    Selectionner
                  </Button>
                  <Button variant="outline" onClick={() => setActive(tenant, !tenant.is_active)}>
                    {tenant.is_active ? "Desactiver" : "Activer"}
                  </Button>
                  <Button variant="destructive" onClick={() => deleteTenant(tenant)}>
                    Supprimer
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
