"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Loader2, Pencil, Plus, Shield, Trash2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAdminMenuCatalog,
  useAdminRoles,
  useCreateAdminRole,
  useDeleteAdminRole,
  useUpdateAdminRole,
} from "@/lib/hooks/use-admin-roles";
import type { AdminRole } from "@ecoledigitale/contracts";

function hasAdminAccess(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((role) =>
    ["admin", "super_admin", "administrateur", "owner"].includes(String(role).toLowerCase())
  );
}

const EMPTY_FORM = { name: "", menuKeys: [] as string[] };

export default function AdminRolesPage() {
  const { data: session, status } = useSession();

  const catalogQ = useAdminMenuCatalog();
  const rolesQ = useAdminRoles();
  const createRole = useCreateAdminRole();
  const updateRole = useUpdateAdminRole();
  const deleteRole = useDeleteAdminRole();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sections = catalogQ.data?.sections ?? [];
  const selected = useMemo(() => new Set(form.menuKeys), [form.menuKeys]);

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

  function toggleMenu(key: string, checked: boolean) {
    setForm((prev) => {
      const next = new Set(prev.menuKeys);
      if (checked) next.add(key);
      else next.delete(key);
      return { ...prev, menuKeys: [...next] };
    });
  }

  function toggleGroup(keys: string[], checked: boolean) {
    setForm((prev) => {
      const next = new Set(prev.menuKeys);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return { ...prev, menuKeys: [...next] };
    });
  }

  function startEdit(role: AdminRole) {
    setEditingId(role.id);
    setForm({ name: role.name, menuKeys: [...role.menuKeys] });
    setFormError(null);
    setNotice(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function submit() {
    setFormError(null);
    setNotice(null);

    const name = form.name.trim();
    if (name.length < 2) {
      setFormError("Le nom du rôle doit contenir au moins 2 caractères.");
      return;
    }
    if (form.menuKeys.length === 0) {
      setFormError("Sélectionnez au moins un menu pour ce rôle.");
      return;
    }

    try {
      if (editingId) {
        await updateRole.mutateAsync({ id: editingId, name, menuKeys: form.menuKeys });
        setNotice(`Rôle « ${name} » mis à jour.`);
      } else {
        await createRole.mutateAsync({ name, menuKeys: form.menuKeys });
        setNotice(`Rôle « ${name} » créé.`);
      }
      resetForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Enregistrement impossible.");
    }
  }

  async function remove(role: AdminRole) {
    setFormError(null);
    setNotice(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Supprimer définitivement le rôle « ${role.name} » ?`)
    ) {
      return;
    }
    try {
      await deleteRole.mutateAsync(role.id);
      if (editingId === role.id) resetForm();
      setNotice(`Rôle « ${role.name} » supprimé.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Suppression impossible.");
    }
  }

  const saving = createRole.isPending || updateRole.isPending;
  const roles = rolesQ.data?.roles ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rôles &amp; permissions</h1>
          <p className="text-sm text-muted-foreground">
            Créez des rôles et cochez les menus du sidebar Administration auxquels ils donnent
            accès.
          </p>
        </div>
      </div>

      {notice ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      ) : null}

      {/* ----------------------------------------------------------------- */}
      {/* Formulaire de création / modification                              */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? "Modifier le rôle" : "Créer un rôle"}
          </CardTitle>
          <CardDescription>
            Les menus non cochés seront masqués pour les utilisateurs portant ce rôle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name">Nom du rôle *</Label>
              <Input
                id="role-name"
                value={form.name}
                placeholder="Comptable, Scolarité, Surveillant général…"
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Menus autorisés *</Label>
              <span className="text-xs text-muted-foreground">
                {form.menuKeys.length} menu(s) sélectionné(s)
              </span>
            </div>

            {catalogQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement du catalogue des menus…
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {sections.map((section) => (
                  <div key={section.label} className="rounded-lg border p-4 space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </h3>
                    {section.groups.map((group) => {
                      const groupKeys = group.items.map((item) => item.key);
                      const allChecked = groupKeys.every((key) => selected.has(key));
                      return (
                        <div key={`${section.label}-${group.label}`} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`group-${section.label}-${group.label}`}
                              checked={allChecked}
                              onCheckedChange={(value) => toggleGroup(groupKeys, value === true)}
                            />
                            <Label
                              htmlFor={`group-${section.label}-${group.label}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {group.label}
                            </Label>
                          </div>
                          <div className="ml-6 grid gap-2 sm:grid-cols-2">
                            {group.items.map((item) => (
                              <div key={item.key} className="flex items-center gap-2">
                                <Checkbox
                                  id={`menu-${item.key}`}
                                  checked={selected.has(item.key)}
                                  onCheckedChange={(value) => toggleMenu(item.key, value === true)}
                                />
                                <Label
                                  htmlFor={`menu-${item.key}`}
                                  className="text-sm font-normal cursor-pointer"
                                >
                                  {item.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

          <div className="flex gap-2">
            <Button type="button" onClick={submit} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {editingId ? "Enregistrer les modifications" : "Créer le rôle"}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Liste des rôles                                                    */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rôles existants</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rolesQ.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement des rôles…
            </div>
          ) : roles.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              Aucun rôle pour le moment. Créez-en un ci-dessus.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Menus autorisés</TableHead>
                  <TableHead className="w-[110px]">Utilisateurs</TableHead>
                  <TableHead className="w-[190px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <div className="font-medium">{role.name}</div>
                      {!role.isActive ? (
                        <Badge variant="outline" className="mt-1 text-xs">
                          désactivé
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{role.menuKeys.length} menu(s)</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{role.userCount}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(role)}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          disabled={deleteRole.isPending}
                          onClick={() => remove(role)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
