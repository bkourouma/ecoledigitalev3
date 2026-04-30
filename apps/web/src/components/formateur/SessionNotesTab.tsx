"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Save, Loader2, Lock } from "lucide-react";
import { useUpdateSessionNotes } from "@/lib/hooks/use-formateur-sessions";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface SessionNotesTabProps {
  sessionId: string;
  initialNotes?: string;
  notesUpdatedAt?: string;
}

export function SessionNotesTab({
  sessionId,
  initialNotes = "",
  notesUpdatedAt,
}: SessionNotesTabProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [hasChanges, setHasChanges] = useState(false);
  const updateNotes = useUpdateSessionNotes();

  // Update local state when initialNotes changes
  useEffect(() => {
    setNotes(initialNotes);
    setHasChanges(false);
  }, [initialNotes]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasChanges(value !== initialNotes);
  };

  const handleSave = async () => {
    try {
      await updateNotes.mutateAsync({
        sessionId,
        notes: notes.trim(),
      });
      setHasChanges(false);
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <CardTitle>Mes Notes Privées</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Visibles uniquement par vous</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="notes">Notes de session</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Ajoutez vos notes privées sur cette session..."
            rows={12}
            maxLength={10000}
            disabled={updateNotes.isPending}
            className="font-mono text-sm"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{notes.length}/10000 caractères</span>
            {hasChanges && (
              <span className="text-amber-600">Modifications non enregistrées</span>
            )}
          </div>
        </div>

        {notesUpdatedAt && (
          <div className="text-xs text-muted-foreground">
            Dernière mise à jour: {format(new Date(notesUpdatedAt), "d MMM yyyy à HH:mm", { locale: fr })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button
            onClick={handleSave}
            disabled={updateNotes.isPending || !hasChanges}
            size="sm"
          >
            {updateNotes.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Enregistrer les notes
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

