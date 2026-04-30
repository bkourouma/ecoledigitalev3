"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AdminSupportAssignmentsData,
  AdminSupportAssignmentItem,
} from "@/lib/admin-assignments";

type AssignmentState = Record<
  string,
  {
    formateurId: string;
    sessionId: string;
  }
>;

const selectClassName =
  "flex h-11 w-full rounded-2xl border border-input bg-white/85 px-4 py-2 text-sm text-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AffectationWorkspace({
  tenants,
  supports,
}: AdminSupportAssignmentsData) {
  const router = useRouter();
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveMessages, setSaveMessages] = useState<Record<string, string>>({});
  const [savingSupportId, setSavingSupportId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newFormateur, setNewFormateur] = useState({
    tenantId: tenants[0]?.id || "",
    prenom: "",
    nom: "",
    email: "",
    telephone: "",
  });
  const [assignmentState, setAssignmentState] = useState<AssignmentState>(() =>
    Object.fromEntries(
      supports.map((support) => [
        support.id,
        {
          formateurId: support.isPlaceholder ? "" : support.currentFormateurId,
          sessionId: support.currentSessionId || "",
        },
      ])
    )
  );

  const summary = useMemo(
    () => ({
      supportCount: supports.length,
      placeholderCount: supports.filter((support) => support.isPlaceholder).length,
      missingSessionCount: supports.filter((support) => support.needsSession).length,
    }),
    [supports]
  );

  function updateAssignment(
    supportId: string,
    key: "formateurId" | "sessionId",
    value: string
  ) {
    setAssignmentState((current) => ({
      ...current,
      [supportId]: {
        ...current[supportId],
        [key]: value,
      },
    }));
  }

  async function saveAssignment(support: AdminSupportAssignmentItem) {
    const current = assignmentState[support.id];

    if (!current?.formateurId) {
      setSaveErrors((state) => ({
        ...state,
        [support.id]: "Choisissez d'abord un formateur.",
      }));
      setSaveMessages((state) => ({ ...state, [support.id]: "" }));
      return;
    }

    setSavingSupportId(support.id);
    setSaveErrors((state) => ({ ...state, [support.id]: "" }));
    setSaveMessages((state) => ({ ...state, [support.id]: "" }));

    try {
      const response = await fetch("/api/admin/support-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supportId: support.id,
          formateurId: current.formateurId,
          sessionId: current.sessionId || null,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSaveErrors((state) => ({
          ...state,
          [support.id]: payload?.error || "Impossible de sauvegarder cette affectation.",
        }));
        return;
      }

      setSaveMessages((state) => ({
        ...state,
        [support.id]: payload?.message || "Affectation enregistrée.",
      }));
      router.refresh();
    } finally {
      setSavingSupportId(null);
    }
  }

  async function createFormateur(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setCreateError("");
    setCreateMessage("");

    try {
      const response = await fetch("/api/admin/formateurs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFormateur),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setCreateError(payload?.error || "Impossible de créer ce formateur.");
        return;
      }

      setCreateMessage(
        payload?.message || "Le formateur a été créé. Vous pouvez maintenant l'affecter."
      );
      setNewFormateur((current) => ({
        ...current,
        prenom: "",
        nom: "",
        email: "",
        telephone: "",
      }));
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Supports à traiter</CardTitle>
            <CardDescription>
              Affectez un vrai formateur et, si besoin, une session à chaque ressource.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">{summary.supportCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Formateurs placeholder</CardTitle>
            <CardDescription>
              Supports encore reliés à un profil de secours généré par migration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">{summary.placeholderCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sessions manquantes</CardTitle>
            <CardDescription>
              Supports encore génériques, sans rattachement à une session précise.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">{summary.missingSessionCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Créer un formateur</CardTitle>
          <CardDescription>
            Si aucun vrai formateur n'existe encore sur un tenant, commencez ici.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={createFormateur}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tenant</label>
              <select
                className={selectClassName}
                value={newFormateur.tenantId}
                onChange={(event) =>
                  setNewFormateur((current) => ({
                    ...current,
                    tenantId: event.target.value,
                  }))
                }
                required
              >
                <option value="">Choisir un tenant</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Prénom</label>
              <Input
                value={newFormateur.prenom}
                onChange={(event) =>
                  setNewFormateur((current) => ({
                    ...current,
                    prenom: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nom</label>
              <Input
                value={newFormateur.nom}
                onChange={(event) =>
                  setNewFormateur((current) => ({
                    ...current,
                    nom: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={newFormateur.email}
                onChange={(event) =>
                  setNewFormateur((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Téléphone</label>
              <Input
                value={newFormateur.telephone}
                onChange={(event) =>
                  setNewFormateur((current) => ({
                    ...current,
                    telephone: event.target.value,
                  }))
                }
              />
            </div>
            <div className="md:col-span-2 xl:col-span-5">
              {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
              {createMessage ? <p className="text-sm text-emerald-700">{createMessage}</p> : null}
            </div>
            <div className="md:col-span-2 xl:col-span-5">
              <Button type="submit" disabled={isCreating || !newFormateur.tenantId}>
                {isCreating ? "Création..." : "Créer le formateur"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-5">
        {supports.map((support) => {
          const current = assignmentState[support.id];

          return (
            <Card key={support.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{support.titre}</CardTitle>
                  {support.isPlaceholder ? (
                    <Badge tone="warning">Formateur placeholder</Badge>
                  ) : null}
                  {support.needsSession ? (
                    <Badge tone="neutral">Session non affectée</Badge>
                  ) : null}
                </div>
                <CardDescription>
                  {support.formationTitre} - {support.tenantLabel}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                  <p>
                    Formateur actuel : {support.currentFormateurLabel} ({support.currentFormateurEmail})
                  </p>
                  <p>
                    Session actuelle : {support.currentSessionLabel || "Aucune session précise"}
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nouveau formateur</label>
                    <select
                      className={selectClassName}
                      value={current?.formateurId || ""}
                      onChange={(event) =>
                        updateAssignment(support.id, "formateurId", event.target.value)
                      }
                    >
                      <option value="">Choisir un formateur</option>
                      {support.availableFormateurs.map((formateur) => (
                        <option key={formateur.id} value={formateur.id}>
                          {formateur.label} - {formateur.email}
                        </option>
                      ))}
                    </select>
                    {!support.availableFormateurs.length ? (
                      <p className="text-sm text-muted-foreground">
                        Aucun vrai formateur disponible pour ce tenant. Créez-en un juste au-dessus.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Session</label>
                    <select
                      className={selectClassName}
                      value={current?.sessionId || ""}
                      onChange={(event) =>
                        updateAssignment(support.id, "sessionId", event.target.value)
                      }
                    >
                      <option value="">Laisser le support au niveau formation</option>
                      {support.availableSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.label}
                        </option>
                      ))}
                    </select>
                    {!support.availableSessions.length ? (
                      <p className="text-sm text-muted-foreground">
                        Aucune session disponible pour cette formation pour le moment.
                      </p>
                    ) : null}
                  </div>
                </div>

                {saveErrors[support.id] ? (
                  <p className="text-sm text-destructive">{saveErrors[support.id]}</p>
                ) : null}
                {saveMessages[support.id] ? (
                  <p className="text-sm text-emerald-700">{saveMessages[support.id]}</p>
                ) : null}

                <Button
                  onClick={() => saveAssignment(support)}
                  disabled={savingSupportId === support.id || !current?.formateurId}
                >
                  {savingSupportId === support.id
                    ? "Enregistrement..."
                    : "Enregistrer l'affectation"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
