"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleMenus, useSaveRoleMenus } from "@/lib/hooks/use-admin-roles";
import {
  MENU_CATALOG_BY_SCOPE,
  MENU_SCOPES,
  MENU_SCOPE_LABELS,
  menuItemsForScope,
  type MenuScope,
} from "@ecoledigitale/contracts";

function keysOf(scope: MenuScope): string[] {
  return menuItemsForScope(scope).map((item) => item.key);
}

/**
 * Édition des menus par défaut de chaque rôle socle.
 *
 * Un menu décoché est retiré du sidebar de tous les utilisateurs portant ce rôle
 * (le propriétaire excepté : il conserve l'accès complet pour pouvoir revenir en
 * arrière). Recocher le menu le rétablit.
 */
export function RoleMenusPanel() {
  const rolesQ = useRoleMenus();
  const saveMenus = useSaveRoleMenus();

  const [scope, setScope] = useState<MenuScope>("admin");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Les cases cochées sont l'inverse de ce que stocke l'API (qui garde les
  // exclusions) : on reconstruit l'état « autorisé » à partir du catalogue.
  useEffect(() => {
    if (!rolesQ.data) return;
    const next: Record<string, string[]> = {};
    for (const role of rolesQ.data.roles) {
      const denied = new Set(role.deniedMenuKeys);
      next[role.roleKey] = keysOf(role.roleKey).filter((key) => !denied.has(key));
    }
    setDrafts(next);
  }, [rolesQ.data]);

  const savedByRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const role of rolesQ.data?.roles ?? []) {
      const denied = new Set(role.deniedMenuKeys);
      map[role.roleKey] = keysOf(role.roleKey).filter((key) => !denied.has(key));
    }
    return map;
  }, [rolesQ.data]);

  function toggle(roleKey: MenuScope, keys: string[], checked: boolean) {
    setDrafts((prev) => {
      const current = new Set(prev[roleKey] ?? []);
      for (const key of keys) {
        if (checked) current.add(key);
        else current.delete(key);
      }
      return { ...prev, [roleKey]: [...current] };
    });
  }

  function isDirty(roleKey: MenuScope): boolean {
    const draft = [...(drafts[roleKey] ?? [])].sort().join(",");
    const saved = [...(savedByRole[roleKey] ?? [])].sort().join(",");
    return draft !== saved;
  }

  async function save(roleKey: MenuScope) {
    setError(null);
    setNotice(null);
    try {
      await saveMenus.mutateAsync({ roleKey, allowedMenuKeys: drafts[roleKey] ?? [] });
      setNotice(`Menus du rôle « ${MENU_SCOPE_LABELS[roleKey]} » enregistrés.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  function resetAll(roleKey: MenuScope) {
    setDrafts((prev) => ({ ...prev, [roleKey]: keysOf(roleKey) }));
  }

  if (rolesQ.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des menus…
      </div>
    );
  }

  if (rolesQ.error) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {rolesQ.error instanceof Error ? rolesQ.error.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Menus par rôle</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Décochez un menu pour le retirer à tous les utilisateurs portant ce rôle ; recochez-le pour
          le rétablir. Le rôle <code className="text-xs bg-muted px-1 rounded">owner</code> n&apos;est
          jamais restreint.
        </p>
      </div>

      {notice ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Tabs value={scope} onValueChange={(value) => setScope(value as MenuScope)}>
        <TabsList className="flex-wrap h-auto">
          {MENU_SCOPES.map((roleKey) => {
            const hidden = keysOf(roleKey).length - (savedByRole[roleKey]?.length ?? 0);
            return (
              <TabsTrigger key={roleKey} value={roleKey} className="gap-2">
                {MENU_SCOPE_LABELS[roleKey]}
                {hidden > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    -{hidden}
                  </Badge>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {MENU_SCOPES.map((roleKey) => {
          const draft = new Set(drafts[roleKey] ?? []);
          const total = keysOf(roleKey).length;
          return (
            <TabsContent key={roleKey} value={roleKey} className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-base">
                      Menus de « {MENU_SCOPE_LABELS[roleKey]} »
                    </CardTitle>
                    <CardDescription>
                      {draft.size} menu(s) actif(s) sur {total}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => resetAll(roleKey)}
                      disabled={draft.size === total}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Tout rétablir
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => save(roleKey)}
                      disabled={!isDirty(roleKey) || saveMenus.isPending}
                    >
                      {saveMenus.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Enregistrer
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {MENU_CATALOG_BY_SCOPE[roleKey].map((section) => (
                      <div key={section.label} className="rounded-lg border p-4 space-y-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.label}
                        </h3>
                        {section.groups.map((group) => {
                          const groupKeys = group.items.map((item) => item.key);
                          const allChecked = groupKeys.every((key) => draft.has(key));
                          return (
                            <div key={`${section.label}-${group.label}`} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`${roleKey}-group-${section.label}-${group.label}`}
                                  checked={allChecked}
                                  onCheckedChange={(value) =>
                                    toggle(roleKey, groupKeys, value === true)
                                  }
                                />
                                <Label
                                  htmlFor={`${roleKey}-group-${section.label}-${group.label}`}
                                  className="text-sm font-medium cursor-pointer"
                                >
                                  {group.label}
                                </Label>
                              </div>
                              <div className="ml-6 grid gap-2 sm:grid-cols-2">
                                {group.items.map((item) => (
                                  <div key={item.key} className="flex items-center gap-2">
                                    <Checkbox
                                      id={`${roleKey}-${item.key}`}
                                      checked={draft.has(item.key)}
                                      onCheckedChange={(value) =>
                                        toggle(roleKey, [item.key], value === true)
                                      }
                                    />
                                    <Label
                                      htmlFor={`${roleKey}-${item.key}`}
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
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
