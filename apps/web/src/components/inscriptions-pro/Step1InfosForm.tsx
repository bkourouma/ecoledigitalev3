"use client";

import { useState } from "react";
import { IndividualEnrollmentRequest, CompanyEnrollmentRequest, CompanyInfo } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { TypeInscriptionSelector } from "./TypeInscriptionSelector";
import { IndividualFormFields } from "./IndividualFormFields";
import { EntrepriseFormFields } from "./EntrepriseFormFields";
import { Button } from "@ecoledigitale/ui";
import { ArrowRight } from "lucide-react";

interface Step1InfosFormProps {
  initialData?: Partial<IndividualEnrollmentRequest | CompanyEnrollmentRequest>;
  onComplete: (data: Partial<IndividualEnrollmentRequest | CompanyEnrollmentRequest>) => void;
  onCancel?: () => void;
}

export function Step1InfosForm({ initialData, onComplete, onCancel }: Step1InfosFormProps) {
  const [typeInscription, setTypeInscription] = useState<"individuelle" | "entreprise">(
    initialData?.type_inscription || "individuelle"
  );
  const [formData, setFormData] = useState({
    civilite: initialData?.apprenant?.civilite || "",
    nom: initialData?.apprenant?.nom || "",
    prenom: initialData?.apprenant?.prenom || "",
    email: initialData?.apprenant?.email || "",
    telephone: initialData?.apprenant?.telephone || "",
    poste: initialData?.apprenant?.poste || "",
  });
  const [selectedCompany, setSelectedCompany] = useState<CompanyInfo | null>(null);
  const [isNewCompany, setIsNewCompany] = useState(false);
  const [companyData, setCompanyData] = useState({
    raison_sociale: "",
    siret: "",
    adresse: "",
    code_postal: "",
    ville: "",
    pays: "",
    telephone: "",
    email: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate apprenant fields (always required)
    if (!formData.nom.trim()) {
      newErrors.nom = "Le nom est requis";
    }
    if (!formData.prenom.trim()) {
      newErrors.prenom = "Le prénom est requis";
    }
    if (!formData.email.trim()) {
      newErrors.email = "L'email est requis";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Format d'email invalide";
    }
    if (!formData.telephone.trim()) {
      newErrors.telephone = "Le téléphone est requis";
    } else if (!/^[\d\s\+\-\(\)]+$/.test(formData.telephone)) {
      newErrors.telephone = "Format de téléphone invalide";
    }

    // Validate company fields if company enrollment
    if (typeInscription === "entreprise") {
      if (!selectedCompany && !isNewCompany) {
        newErrors.entreprise = "Veuillez sélectionner ou créer une entreprise";
      }
      
      if (isNewCompany) {
        if (!companyData.raison_sociale.trim()) {
          newErrors.raison_sociale = "La raison sociale est requise";
        }
        if (companyData.siret && !/^\d{14}$/.test(companyData.siret)) {
          newErrors.siret = "Le SIRET doit contenir 14 chiffres";
        }
        if (companyData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyData.email)) {
          newErrors.entreprise_email = "Format d'email invalide";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (typeInscription === "entreprise") {
      const companyEnrollment: Partial<CompanyEnrollmentRequest> = {
        type_inscription: "entreprise",
        apprenant: {
          civilite: formData.civilite || undefined,
          nom: formData.nom,
          prenom: formData.prenom,
          email: formData.email,
          telephone: formData.telephone,
          poste: formData.poste || undefined,
        },
        entreprise: selectedCompany
          ? {
              raison_sociale: selectedCompany.raison_sociale,
              siret: selectedCompany.siret || undefined,
              adresse: selectedCompany.adresse || undefined,
              code_postal: selectedCompany.code_postal || undefined,
              ville: selectedCompany.ville || undefined,
              pays: selectedCompany.pays || undefined,
              telephone: selectedCompany.telephone || undefined,
              email: selectedCompany.email || undefined,
            }
          : {
              raison_sociale: companyData.raison_sociale,
              siret: companyData.siret || undefined,
              adresse: companyData.adresse || undefined,
              code_postal: companyData.code_postal || undefined,
              ville: companyData.ville || undefined,
              pays: companyData.pays || undefined,
              telephone: companyData.telephone || undefined,
              email: companyData.email || undefined,
            },
        entreprise_id: selectedCompany?.id,
      };
      onComplete(companyEnrollment);
    } else {
      onComplete({
        type_inscription: "individuelle",
        apprenant: {
          civilite: formData.civilite || undefined,
          nom: formData.nom,
          prenom: formData.prenom,
          email: formData.email,
          telephone: formData.telephone,
          poste: formData.poste || undefined,
        },
      });
    }
  };

  const handleNewCompany = () => {
    setIsNewCompany(true);
    setSelectedCompany(null);
  };

  const handleCompanySelect = (company: CompanyInfo | null) => {
    setSelectedCompany(company);
    setIsNewCompany(false);
    if (company) {
      setCompanyData({
        raison_sociale: company.raison_sociale,
        siret: company.siret || "",
        adresse: company.adresse || "",
        code_postal: company.code_postal || "",
        ville: company.ville || "",
        pays: company.pays || "",
        telephone: company.telephone || "",
        email: company.email || "",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Informations personnelles</h2>
        <p className="text-muted-foreground">Remplissez vos informations pour compléter l'inscription</p>
      </div>

      <TypeInscriptionSelector
        value={typeInscription}
        onChange={setTypeInscription}
      />

      {typeInscription === "individuelle" && (
        <IndividualFormFields
          data={{
            civilite: formData.civilite || undefined,
            nom: formData.nom,
            prenom: formData.prenom,
            email: formData.email,
            telephone: formData.telephone,
            poste: formData.poste || undefined,
          }}
          onChange={(newData) => setFormData((prev) => ({ ...prev, ...newData }))}
          errors={errors}
        />
      )}

      {typeInscription === "entreprise" && (
        <>
          <EntrepriseFormFields
            selectedCompany={selectedCompany}
            onCompanySelect={handleCompanySelect}
            onNewCompany={handleNewCompany}
            companyData={companyData}
            onCompanyDataChange={(data) => setCompanyData((prev) => ({ ...prev, ...data }))}
            errors={errors}
            isNewCompany={isNewCompany}
          />
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Informations de l'employé</h3>
            <IndividualFormFields
              data={{
                civilite: formData.civilite || undefined,
                nom: formData.nom,
                prenom: formData.prenom,
                email: formData.email,
                telephone: formData.telephone,
                poste: formData.poste || undefined,
              }}
              onChange={(newData) => setFormData((prev) => ({ ...prev, ...newData }))}
              errors={errors}
            />
          </div>
        </>
      )}

      <div className="flex justify-between pt-6">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" className="ml-auto">
          Continuer
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

