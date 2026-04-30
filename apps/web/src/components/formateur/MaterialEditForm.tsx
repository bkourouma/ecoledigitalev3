"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { useFormateurSupportDetail, useUpdateSupport } from "@/lib/hooks/use-formateur-supports";
import { useFormateurSessions } from "@/lib/hooks/use-formateur-sessions";
import { toast } from "sonner";

interface MaterialEditFormProps {
  supportId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MaterialEditForm({
  supportId,
  onSuccess,
  onCancel,
}: MaterialEditFormProps) {
  const { data, isLoading } = useFormateurSupportDetail(supportId);
  const updateSupport = useUpdateSupport();

  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [visibleApprenants, setVisibleApprenants] = useState(true);
  const [sessionIds, setSessionIds] = useState<string[]>([]);

  // Fetch sessions for the formation if available
  const formationId = data?.data?.support?.formation?.id;
  const { data: sessionsData } = useFormateurSessions({
    page: 1,
    limit: 100,
    formation_id: formationId || undefined,
  });
  const sessions = sessionsData?.data?.sessions || [];

  // Initialize form when data loads
  useEffect(() => {
    if (data?.data?.support) {
      const support = data.data.support;
      setTitre(support.titre);
      setDescription(support.description || "");
      setVisibleApprenants(support.visible_apprenants);
      
      // Set session IDs from associations
      if (data.data.sessions_associees) {
        setSessionIds(data.data.sessions_associees.map((s: any) => s.id));
      }
    }
  }, [data]);

  const handleSessionToggle = (sessionId: string) => {
    setSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!titre.trim()) {
      toast.error("Le titre est requis");
      return;
    }

    try {
      await updateSupport.mutateAsync({
        supportId,
        updates: {
          titre: titre.trim(),
          description: description.trim() || undefined,
          visible_apprenants: visibleApprenants,
          session_ids: sessionIds.length > 0 ? sessionIds : [],
        },
      });

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data?.data) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Erreur lors du chargement des données</p>
      </div>
    );
  }

  const support = data.data.support;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File Info (read-only) */}
      <div className="space-y-2">
        <Label>Fichier (non modifiable)</Label>
        <div className="p-3 bg-muted rounded-md">
          <p className="text-sm font-medium">{support.titre}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Type: {support.type_fichier} • Taille: {(support.taille_fichier / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="titre">Titre *</Label>
        <Input
          id="titre"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          required
          maxLength={255}
          disabled={updateSupport.isPending}
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          disabled={updateSupport.isPending}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          {description.length}/2000 caractères
        </p>
      </div>

      {/* Sessions (multi-select) */}
      {sessions.length > 0 && (
        <div className="space-y-2">
          <Label>Sessions associées</Label>
          <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`session-${session.id}`}
                  checked={sessionIds.includes(session.id)}
                  onCheckedChange={() => handleSessionToggle(session.id)}
                  disabled={updateSupport.isPending}
                />
                <Label
                  htmlFor={`session-${session.id}`}
                  className="text-sm font-normal cursor-pointer flex-1"
                >
                  {session.code_session} - {session.formation?.titre || "Formation"}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visible to learners */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="visible_apprenants"
          checked={visibleApprenants}
          onCheckedChange={(checked) => setVisibleApprenants(checked === true)}
          disabled={updateSupport.isPending}
        />
        <Label
          htmlFor="visible_apprenants"
          className="text-sm font-normal cursor-pointer"
        >
          Visible pour les apprenants
        </Label>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={updateSupport.isPending}
          >
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={updateSupport.isPending || !titre.trim()}>
          {updateSupport.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Mise à jour...
            </>
          ) : (
            "Enregistrer les modifications"
          )}
        </Button>
      </div>
    </form>
  );
}

