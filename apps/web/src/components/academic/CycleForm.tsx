"use client";

import { useState } from "react";
import { 
  CreateCycle, 
  UpdateCycle, 
  Cycle, 
  CycleType, 
  CycleStatus,
  CreateCycleSchema,
  UpdateCycleSchema 
} from "@ecoledigitale/contracts";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle, 
  Button, 
  Input, 
  Label, 
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from "@ecoledigitale/ui";
import { Save, X } from "lucide-react";

interface CycleFormProps {
  cycle?: Cycle;
  onSubmit: (data: CreateCycle | UpdateCycle) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const cycleTypes: { value: CycleType; label: string }[] = [
  { value: "academic", label: "Académique" },
  { value: "professional", label: "Professionnel" },
  { value: "short", label: "Formation courte" },
  { value: "certification", label: "Certification" },
];

const cycleStatuses: { value: CycleStatus; label: string }[] = [
  { value: "draft", label: "Brouillon" },
  { value: "active", label: "Actif" },
  { value: "archived", label: "Archivé" },
];

export function CycleForm({ cycle, onSubmit, onCancel, isLoading }: CycleFormProps) {
  const [formData, setFormData] = useState({
    name: cycle?.name || "",
    code: cycle?.code || "",
    type: cycle?.type || "academic" as CycleType,
    description: cycle?.description || "",
    certificationLevel: cycle?.certificationLevel || "",
    status: cycle?.status || "draft" as CycleStatus,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const schema = cycle ? UpdateCycleSchema : CreateCycleSchema;
      // Pour la création, définir automatiquement le statut sur 'active'
      const dataToSubmit = cycle ? formData : { ...formData, status: 'active' as CycleStatus };
      const validatedData = schema.parse(dataToSubmit);
      await onSubmit(validatedData);
    } catch (error: any) {
      if (error.errors) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err: any) => {
          fieldErrors[err.path[0]] = err.message;
        });
        setErrors(fieldErrors);
      }
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          {cycle ? "Modifier le cycle" : "Nouveau cycle"}
        </CardTitle>
        <CardDescription>
          {cycle 
            ? "Modifiez les informations du cycle académique" 
            : "Créez un nouveau cycle académique"
          }
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nom du cycle *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="Ex: BTS Services Informatiques"
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="code">Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => handleChange("code", e.target.value)}
                placeholder="Ex: BTS-SIO"
                className={errors.code ? "border-red-500" : ""}
              />
              {errors.code && (
                <p className="text-sm text-red-500">{errors.code}</p>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select value={formData.type} onValueChange={(value) => handleChange("type", value)}>
                <SelectTrigger className={errors.type ? "border-red-500" : ""}>
                  <SelectValue placeholder="Sélectionnez un type" />
                </SelectTrigger>
                <SelectContent>
                  {cycleTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && (
                <p className="text-sm text-red-500">{errors.type}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificationLevel">Niveau de certification</Label>
              <Input
                id="certificationLevel"
                value={formData.certificationLevel}
                onChange={(e) => handleChange("certificationLevel", e.target.value)}
                placeholder="Ex: Bac+2, Bac+3"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Description du cycle académique..."
              rows={4}
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isLoading}>
              <Save className="h-4 w-4 mr-2" />
              {isLoading ? "Enregistrement..." : "Enregistrer"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              <X className="h-4 w-4 mr-2" />
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
