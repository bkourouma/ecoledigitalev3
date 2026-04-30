"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@ecoledigitale/ui";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Mail, MessageSquare, Send, Loader2, Users } from "lucide-react";
import { useSendGroupMessage } from "@/lib/hooks/use-formateur-messaging";
import { toast } from "sonner";

interface MessageGroupeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  enrolledLearners: Array<{
    id: string;
    apprenant: {
      id: string;
      nom: string;
      prenom: string;
      email: string;
      telephone?: string;
    };
    presence?: boolean;
  }>;
}

export function MessageGroupeModal({
  open,
  onOpenChange,
  sessionId,
  enrolledLearners,
}: MessageGroupeModalProps) {
  const [sujet, setSujet] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"email" | "sms" | "both">("email");
  const [destinataires, setDestinataires] = useState<"tous" | "presents" | "absents">("tous");

  const sendMessage = useSendGroupMessage();

  // Calculate recipient count based on filters
  const getRecipientCount = () => {
    if (destinataires === "tous") {
      return enrolledLearners.length;
    } else if (destinataires === "presents") {
      return enrolledLearners.filter((l) => l.presence === true).length;
    } else {
      return enrolledLearners.filter((l) => l.presence === false || l.presence === undefined).length;
    }
  };

  const recipientCount = getRecipientCount();

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setSujet("");
      setMessage("");
      setType("email");
      setDestinataires("tous");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sujet.trim()) {
      toast.error("Le sujet est requis");
      return;
    }

    if (!message.trim()) {
      toast.error("Le message est requis");
      return;
    }

    if (recipientCount === 0) {
      toast.error("Aucun destinataire trouvé avec les filtres sélectionnés");
      return;
    }

    try {
      const result = await sendMessage.mutateAsync({
        sessionId,
        messageData: {
          sujet: sujet.trim(),
          message: message.trim(),
          type,
          destinataires,
        },
      });

      // Show success message with counts
      const counts = [];
      if (result.data.email_envoyes !== undefined) {
        counts.push(`${result.data.email_envoyes} email(s)`);
      }
      if (result.data.sms_envoyes !== undefined) {
        counts.push(`${result.data.sms_envoyes} SMS`);
      }

      toast.success(`Message envoyé à ${result.data.nb_destinataires} destinataire(s) (${counts.join(", ")})`);

      // Close modal on success
      onOpenChange(false);
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Envoyer un Message de Groupe
              </DialogTitle>
              <DialogDescription className="mt-2">
                Envoyez un message à tous les apprenants inscrits à cette session
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {/* Recipient Filter */}
          <div className="space-y-2">
            <Label>Destinataires</Label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{recipientCount} destinataire(s) sélectionné(s)</span>
            </div>
            <select
              value={destinataires}
              onChange={(e) => setDestinataires(e.target.value as "tous" | "presents" | "absents")}
              disabled={sendMessage.isPending}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="tous">Tous les apprenants inscrits</option>
              <option value="presents">Uniquement les présents</option>
              <option value="absents">Uniquement les absents</option>
            </select>
          </div>

          {/* Message Type */}
          <div className="space-y-2">
            <Label>Type de message</Label>
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Type de message">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  value="email"
                  checked={type === "email"}
                  onChange={(e) => setType(e.target.value as "email")}
                  disabled={sendMessage.isPending}
                  className="h-4 w-4"
                  aria-label="Envoyer par email uniquement"
                />
                <Mail className="h-4 w-4" aria-hidden="true" />
                <span>Email</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  value="sms"
                  checked={type === "sms"}
                  onChange={(e) => setType(e.target.value as "sms")}
                  disabled={sendMessage.isPending}
                  className="h-4 w-4"
                  aria-label="Envoyer par SMS uniquement"
                />
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                <span>SMS</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  value="both"
                  checked={type === "both"}
                  onChange={(e) => setType(e.target.value as "both")}
                  disabled={sendMessage.isPending}
                  className="h-4 w-4"
                  aria-label="Envoyer par email et SMS"
                />
                <div className="flex items-center gap-1" aria-hidden="true">
                  <Mail className="h-4 w-4" />
                  <MessageSquare className="h-4 w-4" />
                </div>
                <span>Email et SMS</span>
              </label>
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="sujet">Sujet *</Label>
            <Input
              id="sujet"
              value={sujet}
              onChange={(e) => setSujet(e.target.value)}
              required
              maxLength={200}
              disabled={sendMessage.isPending}
              placeholder="Sujet du message"
            />
            <p className="text-xs text-muted-foreground">{sujet.length}/200 caractères</p>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Message *</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={2000}
              disabled={sendMessage.isPending}
              rows={8}
              placeholder="Votre message aux apprenants..."
            />
            <p className="text-xs text-muted-foreground">{message.length}/2000 caractères</p>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sendMessage.isPending}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={sendMessage.isPending || !sujet.trim() || !message.trim() || recipientCount === 0}
            >
              {sendMessage.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Envoyer le message
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

