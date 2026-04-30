/**
 * EntrepriseFormModal Component
 * 
 * Modal form for creating/editing enterprises with SIRET validation
 */

"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Label, Input, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { useCreateEntreprise, useUpdateEntreprise } from "@/lib/hooks/use-entreprises";
import { Loader2 } from "lucide-react";
import { EntrepriseWithStats } from "@ecoledigitale/contracts/src/entreprises";
import { CreateEntrepriseRequest, UpdateEntrepriseRequest } from "@ecoledigitale/contracts/src/entreprises";

interface EntrepriseFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enterprise?: EntrepriseWithStats | null;
}

export function EntrepriseFormModal({ open, onOpenChange, enterprise }: EntrepriseFormModalProps) {
  const isEditMode = !!enterprise;
  const createMutation = useCreateEntreprise();
  const updateMutation = useUpdateEntreprise();

  const [formData, setFormData] = useState<CreateEntrepriseRequest>({
    raison_sociale: "",
    siret: "",
    forme_juridique: "",
    adresse: "",
    code_postal: "",
    ville: "",
    pays: "Côte d'Ivoire",
    contact_nom: "",
    contact_prenom: "",
    contact_email: "",
    contact_telephone: "",
    secteur_activite: "",
    nombre_employes: undefined,
    notes: "",
  });

  const [siretError, setSiretError] = useState<string | null>(null);

  useEffect(() => {
    if (enterprise) {
      setFormData({
        raison_sociale: enterprise.raison_sociale,
        siret: enterprise.siret || "",
        forme_juridique: enterprise.forme_juridique || "",
        adresse: enterprise.adresse || "",
        code_postal: enterprise.code_postal || "",
        ville: enterprise.ville || "",
        pays: enterprise.pays || "Côte d'Ivoire",
        contact_nom: enterprise.contact_nom || "",
        contact_prenom: enterprise.contact_prenom || "",
        contact_email: enterprise.contact_email || "",
        contact_telephone: enterprise.contact_telephone || "",
        secteur_activite: enterprise.secteur_activite || "",
        nombre_employes: enterprise.nombre_employes || undefined,
        notes: enterprise.notes || "",
      });
    } else {
      // Reset form
      setFormData({
        raison_sociale: "",
        siret: "",
        forme_juridique: "",
        adresse: "",
        code_postal: "",
        ville: "",
        pays: "Côte d'Ivoire",
        contact_nom: "",
        contact_prenom: "",
        contact_email: "",
        contact_telephone: "",
        secteur_activite: "",
        nombre_employes: undefined,
        notes: "",
      });
    }
    setSiretError(null);
  }, [enterprise, open]);

  const validateSIRET = (siret: string): boolean => {
    if (!siret) {
      setSiretError(null);
      return true; // SIRET is optional
    }
    if (!/^\d{14}$/.test(siret)) {
      setSiretError("Le SIRET doit contenir exactement 14 chiffres");
      return false;
    }
    setSiretError(null);
    return true;
  };

  const handleSiretChange = (value: string) => {
    const numericValue = value.replace(/\D/g, ""); // Remove non-digits
    setFormData({ ...formData, siret: numericValue });
    if (numericValue.length > 0) {
      validateSIRET(numericValue);
    } else {
      setSiretError(null);
    }
  };

  const handleSubmit = async () => {
    // Validate required fields
    if (!formData.raison_sociale || !formData.contact_email || !formData.contact_nom || !formData.contact_prenom) {
      return;
    }

    // Validate SIRET if provided
    if (formData.siret && !validateSIRET(formData.siret)) {
      return;
    }

    try {
      if (isEditMode && enterprise) {
        const updateData: UpdateEntrepriseRequest = {
          ...formData,
          nombre_employes: formData.nombre_employes || undefined,
        };
        await updateMutation.mutateAsync({ id: enterprise.id, data: updateData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      onOpenChange(false);
    } catch (error) {
      // Error handled by hook
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Modifier l'entreprise" : "Ajouter une entreprise"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Modifiez les informations de l'entreprise"
              : "Remplissez les informations pour créer une nouvelle entreprise"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Company Information */}
          <div className="space-y-4">
            <h3 className="font-semibold">Informations de l'entreprise</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Raison sociale *</Label>
                <Input
                  value={formData.raison_sociale}
                  onChange={(e) => setFormData({ ...formData, raison_sociale: e.target.value })}
                  placeholder="Nom de l'entreprise"
                />
              </div>
              <div>
                <Label>SIRET</Label>
                <Input
                  value={formData.siret}
                  onChange={(e) => handleSiretChange(e.target.value)}
                  placeholder="14 chiffres"
                  maxLength={14}
                />
                {siretError && <p className="text-sm text-destructive mt-1">{siretError}</p>}
              </div>
              <div>
                <Label>Forme juridique</Label>
                <Select
                  value={formData.forme_juridique}
                  onValueChange={(value) => setFormData({ ...formData, forme_juridique: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SARL">SARL</SelectItem>
                    <SelectItem value="SAS">SAS</SelectItem>
                    <SelectItem value="SA">SA</SelectItem>
                    <SelectItem value="EURL">EURL</SelectItem>
                    <SelectItem value="SNC">SNC</SelectItem>
                    <SelectItem value="Autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Secteur d'activité</Label>
                <Select
                  value={formData.secteur_activite || ""}
                  onValueChange={(value) => setFormData({ ...formData, secteur_activite: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Technologie">Technologie</SelectItem>
                    <SelectItem value="Finance">Finance</SelectItem>
                    <SelectItem value="Santé">Santé</SelectItem>
                    <SelectItem value="Éducation">Éducation</SelectItem>
                    <SelectItem value="Autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Adresse</Label>
              <Input
                value={formData.adresse}
                onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                placeholder="Adresse complète"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Code postal</Label>
                <Input
                  value={formData.code_postal}
                  onChange={(e) => setFormData({ ...formData, code_postal: e.target.value })}
                  placeholder="Code postal"
                />
              </div>
              <div>
                <Label>Ville</Label>
                <Input
                  value={formData.ville}
                  onChange={(e) => setFormData({ ...formData, ville: e.target.value })}
                  placeholder="Ville"
                />
              </div>
              <div>
                <Label>Pays</Label>
                <Input
                  value={formData.pays}
                  onChange={(e) => setFormData({ ...formData, pays: e.target.value })}
                  placeholder="Pays"
                />
              </div>
            </div>
            <div>
              <Label>Nombre d'employés</Label>
              <Input
                type="number"
                value={formData.nombre_employes || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    nombre_employes: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder="Nombre d'employés"
                min="0"
              />
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold">Contact</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Prénom *</Label>
                <Input
                  value={formData.contact_prenom}
                  onChange={(e) => setFormData({ ...formData, contact_prenom: e.target.value })}
                  placeholder="Prénom du contact"
                />
              </div>
              <div>
                <Label>Nom *</Label>
                <Input
                  value={formData.contact_nom}
                  onChange={(e) => setFormData({ ...formData, contact_nom: e.target.value })}
                  placeholder="Nom du contact"
                />
              </div>
              <div>
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.contact_email}
                  onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <Label>Téléphone</Label>
                <Input
                  value={formData.contact_telephone || ""}
                  onChange={(e) => setFormData({ ...formData, contact_telephone: e.target.value })}
                  placeholder="+225 XX XX XX XX XX"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="pt-4 border-t">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notes supplémentaires..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !formData.raison_sociale || !formData.contact_email}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Modifier" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

