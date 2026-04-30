/**
 * DocumentGenerationModal Component
 * 
 * Modal for generating individual documents
 */

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input } from "@ecoledigitale/ui";
import {
  useGenerateConvention,
  useGenerateAttestationPresence,
  useGenerateAttestationReussite,
  useGenerateDevis,
} from "@/lib/hooks/use-documents";
import { Loader2 } from "lucide-react";

interface DocumentGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentGenerationModal({ open, onOpenChange }: DocumentGenerationModalProps) {
  const [documentType, setDocumentType] = useState<string>("");
  const [inscriptionId, setInscriptionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [client, setClient] = useState({
    nom: "",
    prenom: "",
    email: "",
    telephone: "",
    entreprise: "",
  });
  const [validiteJours, setValiditeJours] = useState(30);
  const [note, setNote] = useState<number | undefined>();

  const generateConvention = useGenerateConvention();
  const generateAttestationPresence = useGenerateAttestationPresence();
  const generateAttestationReussite = useGenerateAttestationReussite();
  const generateDevis = useGenerateDevis();

  const isLoading =
    generateConvention.isPending ||
    generateAttestationPresence.isPending ||
    generateAttestationReussite.isPending ||
    generateDevis.isPending;

  const handleGenerate = async () => {
    try {
      if (documentType === "convention") {
        await generateConvention.mutateAsync({ inscription_id: inscriptionId });
      } else if (documentType === "attestation_presence") {
        await generateAttestationPresence.mutateAsync({ inscription_id: inscriptionId });
      } else if (documentType === "attestation_reussite") {
        await generateAttestationReussite.mutateAsync({
          inscription_id: inscriptionId,
          note,
        });
      } else if (documentType === "devis") {
        await generateDevis.mutateAsync({
          session_id: sessionId,
          client: {
            nom: client.nom,
            prenom: client.prenom,
            email: client.email,
            telephone: client.telephone || undefined,
            entreprise: client.entreprise || undefined,
          },
          validite_jours: validiteJours,
        });
      }
      onOpenChange(false);
      // Reset form
      setDocumentType("");
      setInscriptionId("");
      setSessionId("");
      setClient({ nom: "", prenom: "", email: "", telephone: "", entreprise: "" });
    } catch (error) {
      // Error handled by hook
    }
  };

  const canGenerate = () => {
    if (!documentType) return false;
    if (documentType === "devis") {
      return sessionId && client.nom && client.prenom && client.email;
    }
    return inscriptionId;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Générer un document</DialogTitle>
          <DialogDescription>
            Sélectionnez le type de document à générer et remplissez les informations requises.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Type de document</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="convention">Convention</SelectItem>
                <SelectItem value="attestation_presence">Attestation de Présence</SelectItem>
                <SelectItem value="attestation_reussite">Attestation de Réussite</SelectItem>
                <SelectItem value="devis">Devis</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {documentType && documentType !== "devis" && (
            <div>
              <Label>ID Inscription</Label>
              <Input
                value={inscriptionId}
                onChange={(e) => setInscriptionId(e.target.value)}
                placeholder="UUID de l'inscription"
              />
            </div>
          )}

          {documentType === "devis" && (
            <>
              <div>
                <Label>ID Session</Label>
                <Input
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="UUID de la session"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nom client</Label>
                  <Input
                    value={client.nom}
                    onChange={(e) => setClient({ ...client, nom: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Prénom client</Label>
                  <Input
                    value={client.prenom}
                    onChange={(e) => setClient({ ...client, prenom: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Email client</Label>
                <Input
                  type="email"
                  value={client.email}
                  onChange={(e) => setClient({ ...client, email: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Téléphone (optionnel)</Label>
                  <Input
                    value={client.telephone}
                    onChange={(e) => setClient({ ...client, telephone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Entreprise (optionnel)</Label>
                  <Input
                    value={client.entreprise}
                    onChange={(e) => setClient({ ...client, entreprise: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Validité (jours)</Label>
                <Input
                  type="number"
                  value={validiteJours}
                  onChange={(e) => setValiditeJours(parseInt(e.target.value) || 30)}
                  min={1}
                  max={365}
                />
              </div>
            </>
          )}

          {documentType === "attestation_reussite" && (
            <div>
              <Label>Note (optionnel, 0-20)</Label>
              <Input
                type="number"
                value={note || ""}
                onChange={(e) => setNote(e.target.value ? parseFloat(e.target.value) : undefined)}
                min={0}
                max={20}
                step={0.5}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annuler
          </Button>
          <Button onClick={handleGenerate} disabled={!canGenerate() || isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

