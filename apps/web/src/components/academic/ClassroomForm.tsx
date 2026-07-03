"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Loader2, Plus, X } from "lucide-react";
import { Classroom, CreateClassroom, UpdateClassroom, ClassroomType, ClassroomStatus } from "@ecoledigitale/contracts";
import { useState } from "react";

const classroomTypeEnum = z.enum(['amphitheatre', 'salle_cours', 'laboratoire', 'salle_informatique', 'atelier', 'bibliotheque', 'salle_reunion', 'autre']);

// Champs communs aux deux variantes du formulaire.
const classroomBaseFields = {
  name: z.string().min(1, "Le nom est requis").max(255),
  code: z.string().min(1, "Le code est requis").max(50),
  floor: z.number().int().optional(),
  building: z.string().max(100).optional(),
  description: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  status: z.enum(['disponible', 'occupe', 'maintenance', 'hors_service']).optional(),
  isActive: z.boolean().optional(),
};

// Formulaire complet (édition / création détaillée) : type et capacité requis.
const classroomFormSchema = z.object({
  ...classroomBaseFields,
  type: classroomTypeEnum,
  capacity: z.number().int().positive("La capacité doit être positive"),
});

// Formulaire simplifié (création rapide) : seuls le nom et le code sont requis.
// Les autres champs sont masqués et optionnels ; des valeurs par défaut valides
// sont envoyées à la soumission (l'API exige encore type et capacité).
const classroomSimplifiedSchema = z.object({
  ...classroomBaseFields,
  type: classroomTypeEnum.optional(),
  capacity: z.number().int().positive("La capacité doit être positive").optional(),
});

type ClassroomFormData = z.infer<typeof classroomFormSchema>;

interface ClassroomFormProps {
  initialData?: Classroom | null;
  onSubmit: (data: CreateClassroom | UpdateClassroom) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  /**
   * Mode création rapide : n'affiche que « Nom » et « Code ». Les autres champs
   * sont masqués et non obligatoires (valeurs par défaut envoyées à l'API).
   */
  simplified?: boolean;
}

const equipmentOptions = [
  "Tableau blanc",
  "Tableau noir",
  "Projecteur",
  "Écran de projection",
  "Ordinateur",
  "Système audio",
  "Microphone",
  "Caméra",
  "Climatisation",
  "Chauffage",
  "Prises électriques",
  "Connexion Internet",
  "WiFi",
  "Imprimante",
  "Scanner",
  "Télévision",
  "Lecteur DVD/Blu-ray",
  "Équipement de laboratoire",
  "Outils d'atelier",
  "Mobilier spécialisé"
];

export function ClassroomForm({ initialData, onSubmit, onCancel, isLoading = false, simplified = false }: ClassroomFormProps) {
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(initialData?.equipment || []);
  const [newEquipment, setNewEquipment] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<ClassroomFormData>({
    resolver: zodResolver(simplified ? classroomSimplifiedSchema : classroomFormSchema),
    defaultValues: {
      name: initialData?.name || "",
      code: initialData?.code || "",
      type: initialData?.type || "salle_cours",
      capacity: initialData?.capacity || 30,
      floor: initialData?.floor || undefined,
      building: initialData?.building || "",
      description: initialData?.description || "",
      equipment: initialData?.equipment || [],
      status: initialData?.status || "disponible",
      isActive: initialData?.isActive !== undefined ? initialData.isActive : true,
    },
  });

  const handleEquipmentToggle = (equipment: string) => {
    const newSelected = selectedEquipment.includes(equipment)
      ? selectedEquipment.filter(e => e !== equipment)
      : [...selectedEquipment, equipment];
    
    setSelectedEquipment(newSelected);
    setValue("equipment", newSelected);
  };

  const handleAddCustomEquipment = () => {
    if (newEquipment.trim() && !selectedEquipment.includes(newEquipment.trim())) {
      const newSelected = [...selectedEquipment, newEquipment.trim()];
      setSelectedEquipment(newSelected);
      setValue("equipment", newSelected);
      setNewEquipment("");
    }
  };

  const handleRemoveEquipment = (equipment: string) => {
    const newSelected = selectedEquipment.filter(e => e !== equipment);
    setSelectedEquipment(newSelected);
    setValue("equipment", newSelected);
  };

  const onFormSubmit = async (data: ClassroomFormData) => {
    try {
      // Build the submission object, ensuring required fields are always present
      const submitData: CreateClassroom | UpdateClassroom = {
        name: data.name,
        code: data.code,
        // Champs requis par l'API : en mode simplifié ils sont masqués, on
        // envoie donc des valeurs par défaut valides.
        type: data.type ?? "salle_cours",
        capacity: data.capacity ?? 30,
        ...(data.floor !== undefined && data.floor !== null && { floor: data.floor }),
        ...(data.building && data.building.trim() && { building: data.building.trim() }),
        ...(data.description && data.description.trim() && { description: data.description.trim() }),
        ...(selectedEquipment.length > 0 && { equipment: selectedEquipment }),
        ...(data.status && { status: data.status }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      };

      // Ensure at least the required fields are present
      if (!submitData.name || !submitData.code || !submitData.type || !submitData.capacity) {
        throw new Error("Les champs requis sont manquants");
      }

      await onSubmit(submitData);
    } catch (error) {
      console.error("Error submitting form:", error);
      throw error; // Re-throw to let the form handle the error
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      {/* Basic Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nom de la salle *</Label>
          <Input
            id="name"
            {...register("name")}
            placeholder="ex: Salle A101"
            className={errors.name ? "border-red-500" : ""}
          />
          {errors.name && (
            <p className="text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="code">Code *</Label>
          <Input
            id="code"
            {...register("code")}
            placeholder="ex: A101"
            className={errors.code ? "border-red-500" : ""}
          />
          {errors.code && (
            <p className="text-sm text-red-600">{errors.code.message}</p>
          )}
        </div>
      </div>

      {!simplified && (
      <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="type">Type de salle *</Label>
          <Select
            value={watch("type")}
            onValueChange={(value: ClassroomType) => setValue("type", value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="salle_cours">Salle de cours</SelectItem>
              <SelectItem value="amphitheatre">Amphithéâtre</SelectItem>
              <SelectItem value="laboratoire">Laboratoire</SelectItem>
              <SelectItem value="salle_informatique">Salle informatique</SelectItem>
              <SelectItem value="atelier">Atelier</SelectItem>
              <SelectItem value="bibliotheque">Bibliothèque</SelectItem>
              <SelectItem value="salle_reunion">Salle de réunion</SelectItem>
              <SelectItem value="autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="capacity">Capacité *</Label>
          <Input
            id="capacity"
            type="number"
            min="1"
            {...register("capacity", { valueAsNumber: true })}
            placeholder="30"
            className={errors.capacity ? "border-red-500" : ""}
          />
          {errors.capacity && (
            <p className="text-sm text-red-600">{errors.capacity.message}</p>
          )}
        </div>
      </div>

      {/* Location Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="building">Bâtiment</Label>
          <Input
            id="building"
            {...register("building")}
            placeholder="ex: Bâtiment A"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="floor">Étage</Label>
          <Input
            id="floor"
            type="number"
            {...register("floor", { valueAsNumber: true })}
            placeholder="ex: 1"
          />
        </div>
      </div>

      {/* Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="status">Statut</Label>
          <Select
            value={watch("status")}
            onValueChange={(value: ClassroomStatus) => setValue("status", value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disponible">Disponible</SelectItem>
              <SelectItem value="occupe">Occupée</SelectItem>
              <SelectItem value="maintenance">En maintenance</SelectItem>
              <SelectItem value="hors_service">Hors service</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 flex items-end">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isActive"
              checked={watch("isActive")}
              onChange={(e) => setValue("isActive", e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <Label htmlFor="isActive">Salle active</Label>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...register("description")}
          placeholder="Description de la salle..."
          rows={3}
        />
      </div>

      {/* Equipment */}
      <div className="space-y-4">
        <Label>Équipements disponibles</Label>
        
        {/* Predefined equipment options */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {equipmentOptions.map((equipment) => (
            <div key={equipment} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={equipment}
                checked={selectedEquipment.includes(equipment)}
                onChange={() => handleEquipmentToggle(equipment)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <Label htmlFor={equipment} className="text-sm">
                {equipment}
              </Label>
            </div>
          ))}
        </div>

        {/* Custom equipment input */}
        <div className="flex gap-2">
          <Input
            value={newEquipment}
            onChange={(e) => setNewEquipment(e.target.value)}
            placeholder="Ajouter un équipement personnalisé..."
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomEquipment();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAddCustomEquipment}
            disabled={!newEquipment.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Selected equipment display */}
        {selectedEquipment.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Équipements sélectionnés:</Label>
            <div className="flex flex-wrap gap-2">
              {selectedEquipment.map((equipment) => (
                <div
                  key={equipment}
                  className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-sm"
                >
                  <span>{equipment}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveEquipment(equipment)}
                    className="hover:bg-blue-200 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={isLoading} className="bg-teal-600 hover:bg-teal-700">
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {initialData ? "Mettre à jour" : "Créer"}
        </Button>
      </div>
    </form>
  );
}
