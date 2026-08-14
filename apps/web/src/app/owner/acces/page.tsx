"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOwnerAssignableRoles, useOwnerUsers } from "@/lib/hooks/use-owner-users";
import { createApiHeaders } from "@/lib/api-utils";
import { RoleMenusPanel } from "./role-menus-panel";

export default function OwnerAccesPage() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const queryClient = useQueryClient();
  const usersQ = useOwnerUsers();
  const rolesQ = useOwnerAssignableRoles();
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});

  const assignableSet = useMemo(
    () => new Set(rolesQ.data?.roleKeys ?? []),
    [rolesQ.data?.roleKeys]
  );

  useEffect(() => {
    if (!usersQ.data?.users || !rolesQ.data?.roleKeys.length) return;
    const assign = new Set(rolesQ.data.roleKeys);
    setDrafts(
      Object.fromEntries(
        usersQ.data.users.map((u) => [
          u.userId,
          u.roleKeys.filter((k) => assign.has(k)),
        ])
      )
    );
  }, [usersQ.data?.users, rolesQ.data?.roleKeys]);

  const saveRoles = useMutation({
    mutationFn: async ({ userId, roleKeys }: { userId: string; roleKeys: string[] }) => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/users/${userId}/roles`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-users", tenantId] });
    },
  });

  function toggleRole(userId: string, roleKey: string, checked: boolean) {
    setDrafts((prev) => {
      const cur = new Set(prev[userId] ?? []);
      if (checked) cur.add(roleKey);
      else cur.delete(roleKey);
      return { ...prev, [userId]: [...cur] };
    });
  }

  const loading = usersQ.isLoading || rolesQ.isLoading;
  const err = usersQ.error || rolesQ.error;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des accès…
      </div>
    );
  }

  if (err || !usersQ.data || !rolesQ.data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {err instanceof Error ? err.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="utilisateurs" className="space-y-6">
      <TabsList>
        <TabsTrigger value="utilisateurs">Utilisateurs</TabsTrigger>
        <TabsTrigger value="menus">Menus par rôle</TabsTrigger>
      </TabsList>

      <TabsContent value="utilisateurs" className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Gestion des accès</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Attribution des rôles gérables par le propriétaire :{" "}
          <span className="font-mono text-xs">{rolesQ.data.roleKeys.join(", ")}</span>. Le rôle{" "}
          <code className="text-xs bg-muted px-1 rounded">owner</code> ne peut pas être modifié ici.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilisateurs du tenant</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôles hors périmètre</TableHead>
                <TableHead>Rôles modifiables</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQ.data.users.map((u) => {
                const fixed = u.roleKeys.filter((k) => !assignableSet.has(k));
                const draft = drafts[u.userId] ?? [];
                const dirty =
                  [...draft].sort().join(",") !==
                  u.roleKeys.filter((k) => assignableSet.has(k)).sort().join(",");
                return (
                  <TableRow key={u.userId}>
                    <TableCell>
                      <div className="font-medium">
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {fixed.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          fixed.map((k) => (
                            <Badge key={k} variant="outline" className="text-xs">
                              {k}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {rolesQ.data.roleKeys.map((rk) => (
                          <div key={rk} className="flex items-center gap-2">
                            <Checkbox
                              id={`${u.userId}-${rk}`}
                              checked={draft.includes(rk)}
                              onCheckedChange={(v) => toggleRole(u.userId, rk, v === true)}
                            />
                            <Label htmlFor={`${u.userId}-${rk}`} className="text-sm font-normal cursor-pointer">
                              {rk}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!dirty || saveRoles.isPending}
                        onClick={() => saveRoles.mutate({ userId: u.userId, roleKeys: draft })}
                      >
                        {saveRoles.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {saveRoles.isError ? (
        <p className="text-sm text-red-600">
          {saveRoles.error instanceof Error ? saveRoles.error.message : "Enregistrement impossible."}
        </p>
      ) : null}
      </TabsContent>

      <TabsContent value="menus">
        <RoleMenusPanel />
      </TabsContent>
    </Tabs>
  );
}
