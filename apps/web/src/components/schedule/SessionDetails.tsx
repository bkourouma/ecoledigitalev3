"use client";

import React, { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from "@ecoledigitale/ui";

type Props = {
  id: string;
  initialNotes?: string;
  onUpdated: () => void;
  onDeleted: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

export default function SessionDetails({
  id,
  initialNotes,
  onUpdated,
  onDeleted,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes || "");
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    setNotes(initialNotes || "");
  }, [id, initialNotes]);

  const save = async () => {
    const res = await fetch(`/api/v1/sessions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-tenant': 'default' }, body: JSON.stringify({ notes }) });
    if (res.ok) { setOpen(false); onUpdated(); }
  };

  const del = async () => {
    if (!confirm('Supprimer cette session ?')) return;
    const res = await fetch(`/api/v1/sessions/${id}`, { method: 'DELETE', headers: { 'x-tenant': 'default' } });
    if (res.status === 204) { setOpen(false); onDeleted(); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">Détails</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-between">
            <Button variant="destructive" onClick={del}>Supprimer</Button>
            <div className="space-x-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
              <Button onClick={save}>Enregistrer</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


