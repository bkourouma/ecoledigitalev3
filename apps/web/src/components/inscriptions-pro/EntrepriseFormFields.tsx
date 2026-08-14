"use client";

import { useState } from "react";
import { Input, Label } from "@ecoledigitale/ui";
import { CompanyInfo } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { EntrepriseAutocomplete } from "./EntrepriseAutocomplete";

interface EntrepriseFormFieldsProps {
  selectedCompany: CompanyInfo | null;
  onCompanySelect: (company: CompanyInfo | null) => void;
  onNewCompany: () => void;
  companyData: {
    raison_sociale: string;
    siret: string;
    adresse: string;
    code_postal: string;
    ville: string;
    pays: string;
    telephone: string;
    email: string;
  };
  onCompanyDataChange: (data: Partial<typeof companyData>) => void;
  errors: Record<string, string>;
  isNewCompany: boolean;
}

export function EntrepriseFormFields({
  selectedCompany,
  onCompanySelect,
  onNewCompany,
  companyData,
  onCompanyDataChange,
  errors,
  isNewCompany,
}: EntrepriseFormFieldsProps) {
  // Format SIRET (14 digits)
  const formatSIRET = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.slice(0, 14);
  };

  const handleSIRETChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatSIRET(e.target.value);
    onCompanyDataChange({ siret: formatted });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Informations de l'entreprise</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Recherchez votre entreprise ou créez-en une nouvelle
        </p>

        <EntrepriseAutocomplete
          value={selectedCompany}
          onChange={onCompanySelect}
          onNewCompany={onNewCompany}
          error={errors.entreprise}
        />

        {selectedCompany && !isNewCompany && (
          <div className="mt-4 p-4 bg-muted rounded-md">
            <p className="text-sm text-muted-foreground">
              Entreprise sélectionnée : <strong>{selectedCompany.raison_sociale}</strong>
            </p>
            {selectedCompany.siret && (
              <p className="text-sm text-muted-foreground">SIRET: {selectedCompany.siret}</p>
            )}
          </div>
        )}
      </div>

      {isNewCompany && (
        <div className="space-y-4 border-t pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="raison_sociale">
                Raison sociale <span className="text-destructive">*</span>
              </Label>
              <Input
                id="raison_sociale"
                value={companyData.raison_sociale}
                onChange={(e) => onCompanyDataChange({ raison_sociale: e.target.value })}
                placeholder="Nom de l'entreprise"
                className={errors.raison_sociale ? "border-destructive" : ""}
              />
              {errors.raison_sociale && (
                <p className="text-sm text-destructive mt-1">{errors.raison_sociale}</p>
              )}
            </div>

            <div>
              <Label htmlFor="siret">SIRET (14 chiffres)</Label>
              <Input
                id="siret"
                value={companyData.siret}
                onChange={handleSIRETChange}
                placeholder="12345678901234"
                maxLength={14}
                className={errors.siret ? "border-destructive" : ""}
              />
              {errors.siret && (
                <p className="text-sm text-destructive mt-1">{errors.siret}</p>
              )}
            </div>

            <div>
              <Label htmlFor="code_postal">Code postal</Label>
              <Input
                id="code_postal"
                value={companyData.code_postal}
                onChange={(e) => onCompanyDataChange({ code_postal: e.target.value })}
                placeholder="75001"
                className={errors.code_postal ? "border-destructive" : ""}
              />
            </div>

            <div>
              <Label htmlFor="ville">Ville</Label>
              <Input
                id="ville"
                value={companyData.ville}
                onChange={(e) => onCompanyDataChange({ ville: e.target.value })}
                placeholder="Paris"
                className={errors.ville ? "border-destructive" : ""}
              />
            </div>

            <div>
              <Label htmlFor="pays">Pays</Label>
              <Input
                id="pays"
                value={companyData.pays}
                onChange={(e) => onCompanyDataChange({ pays: e.target.value })}
                placeholder="France"
                className={errors.pays ? "border-destructive" : ""}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="adresse">Adresse</Label>
              <Input
                id="adresse"
                value={companyData.adresse}
                onChange={(e) => onCompanyDataChange({ adresse: e.target.value })}
                placeholder="123 Rue Example"
                className={errors.adresse ? "border-destructive" : ""}
              />
            </div>

            <div>
              <Label htmlFor="entreprise_telephone">Téléphone</Label>
              <Input
                id="entreprise_telephone"
                value={companyData.telephone}
                onChange={(e) => onCompanyDataChange({ telephone: e.target.value })}
                placeholder="+225 07 07 12 34 56"
                className={errors.entreprise_telephone ? "border-destructive" : ""}
              />
            </div>

            <div>
              <Label htmlFor="entreprise_email">Email</Label>
              <Input
                id="entreprise_email"
                type="email"
                value={companyData.email}
                onChange={(e) => onCompanyDataChange({ email: e.target.value })}
                placeholder="contact@entreprise.fr"
                className={errors.entreprise_email ? "border-destructive" : ""}
              />
              {errors.entreprise_email && (
                <p className="text-sm text-destructive mt-1">{errors.entreprise_email}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

