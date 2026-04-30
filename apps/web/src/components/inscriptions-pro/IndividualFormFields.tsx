"use client";

import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";

interface IndividualFormFieldsProps {
  data: {
    civilite?: string;
    nom: string;
    prenom: string;
    email: string;
    telephone: string;
    poste?: string;
  };
  onChange: (data: IndividualFormFieldsProps["data"]) => void;
  errors?: Record<string, string>;
}

export function IndividualFormFields({ data, onChange, errors = {} }: IndividualFormFieldsProps) {
  const updateField = (field: string, value: string) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="civilite">Civilité</Label>
          <Select
            value={data.civilite || "none"}
            onValueChange={(value) => updateField("civilite", value === "none" ? "" : value)}
          >
            <SelectTrigger id="civilite">
              <SelectValue placeholder="Sélectionner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sélectionner</SelectItem>
              <SelectItem value="M.">M.</SelectItem>
              <SelectItem value="Mme">Mme</SelectItem>
              <SelectItem value="Autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="nom">Nom *</Label>
          <Input
            id="nom"
            value={data.nom}
            onChange={(e) => updateField("nom", e.target.value)}
            className={errors.nom ? "border-destructive" : ""}
            required
          />
          {errors.nom && <p className="text-sm text-destructive mt-1">{errors.nom}</p>}
        </div>

        <div>
          <Label htmlFor="prenom">Prénom *</Label>
          <Input
            id="prenom"
            value={data.prenom}
            onChange={(e) => updateField("prenom", e.target.value)}
            className={errors.prenom ? "border-destructive" : ""}
            required
          />
          {errors.prenom && <p className="text-sm text-destructive mt-1">{errors.prenom}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            value={data.email}
            onChange={(e) => updateField("email", e.target.value)}
            className={errors.email ? "border-destructive" : ""}
            required
          />
          {errors.email && <p className="text-sm text-destructive mt-1">{errors.email}</p>}
        </div>

        <div>
          <Label htmlFor="telephone">Téléphone *</Label>
          <Input
            id="telephone"
            type="tel"
            value={data.telephone}
            onChange={(e) => updateField("telephone", e.target.value)}
            className={errors.telephone ? "border-destructive" : ""}
            required
          />
          {errors.telephone && <p className="text-sm text-destructive mt-1">{errors.telephone}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="poste">Poste</Label>
        <Input
          id="poste"
          value={data.poste || ""}
          onChange={(e) => updateField("poste", e.target.value)}
          placeholder="Ex: Développeur, Manager, etc."
        />
      </div>
    </div>
  );
}

