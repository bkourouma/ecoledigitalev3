"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Loader2, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAdminManagedUsers,
  useAdminRoles,
  useCreateAdminUser,
  useSetUserAdminRole,
} from "@/lib/hooks/use-admin-roles";

const NO_ROLE = "__none__";

function hasAdminAccess(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((role) =>
    ["admin", "super_admin", "administrateur", "owner"].includes(String(role).toLowerCase())
  );
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  adminRoleId: "",
};

export default function AdminUsersPage() {
  const { data: session, status } = useSession();

  const rolesQ = useAdminRoles();
  const usersQ = useAdminManagedUsers();
  const createUser = useCreateAdminUser();
  const setUserRole = useSetUserAdminRole();

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (!session) redirect("/login");

  if (!hasAdminAccess((session as { roles?: string[] }).roles)) {
    return (
      <div className="p-6">
        <Card className="max-w-lg border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 text-base">Accès refusé</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-700">
            Cette page est réservée aux administrateurs de l&apos;établissement.
          </CardContent>
        </Card>
      </div>
    );
  }

  const roles = (rolesQ.data?.roles ?? []).filter((role) => role.isActive);
  const users = usersQ.data?.users ?? [];

  async function submit() {
    setFormError(null);
    setNotice(null);

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError("Le nom et le prénom sont obligatoires.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setFormError("Adresse email invalide.");
      return;
    }
    if (form.password.length < 6) {
      setFormError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (!form.adminRoleId) {
      setFormError("Sélectionnez un rôle.");
      return;
    }

    try {
      await createUser.mutateAsync({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        adminRoleId: form.adminRoleId,
      });
      setNotice(`Utilisateur ${form.firstName} ${form.lastName} créé.`);
      setForm(EMPTY_FORM);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Création impossible.");
    }
  }

  async function changeRole(userId: string, value: string) {
    setFormError(null);
    setNotice(null);
    try {
      await setUserRole.mutateAsync({
        userId,
        adminRoleId: value === NO_ROLE ? null : value,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Affectation impossible.");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">
            Créez des comptes et attribuez-leur un rôle : à la connexion, l&apos;utilisateur ne verra
            que les menus autorisés par ce rôle.
          </p>
        </div>
      </div>

      {notice ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      ) : null}

      {/* ----------------------------------------------------------------- */}
      {/* Enregistrement d'un utilisateur                                    */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enregistrer un utilisateur</CardTitle>
          <CardDescription>
            Le compte reçoit le rôle socle « administrateur », restreint aux menus du rôle choisi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {roles.length === 0 && !rolesQ.isLoading ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Aucun rôle actif n&apos;existe.{" "}
              <Link href="/admin/roles" className="underline font-medium">
                Créez d&apos;abord un rôle
              </Link>{" "}
              pour pouvoir enregistrer un utilisateur.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lastName">Nom *</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">Prénoms *</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe *</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="6 caractères minimum"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rôle *</Label>
              <Select
                value={form.adminRoleId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, adminRoleId: value }))}
              >
                <SelectTrigger id="role">
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

          <Button type="button" onClick={submit} disabled={createUser.isPending}>
            {createUser.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <UserPlus className="h-4 w-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Liste des utilisateurs                                             */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilisateurs de l&apos;établissement</CardTitle>
          <CardDescription>
            « Accès complet » signifie qu&apos;aucun rôle ne restreint les menus de cet utilisateur.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {usersQ.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement des utilisateurs…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Rôles socle</TableHead>
                  <TableHead className="w-[260px]">Rôle administratif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell>
                      <div className="font-medium">
                        {user.lastName} {user.firstName}
                      </div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roleKeys.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          user.roleKeys.map((key) => (
                            <Badge key={key} variant="outline" className="text-xs">
                              {key}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.adminRoleId ?? NO_ROLE}
                        onValueChange={(value) => changeRole(user.userId, value)}
                        disabled={setUserRole.isPending}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ROLE}>Accès complet (aucun rôle)</SelectItem>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
