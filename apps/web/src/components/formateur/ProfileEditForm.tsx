"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Save, Loader2, Upload, FileText, X } from "lucide-react";
import { useUpdateFormateurProfile, useUploadFormateurCV } from "@/lib/hooks/use-formateur-profile";
import { PhotoUpload } from "./PhotoUpload";
import { SpecialitesEditor } from "./SpecialitesEditor";

interface ProfileEditFormProps {
  formateur: {
    id: string;
    nom: string;
    prenom: string;
    email: string;
    telephone?: string;
    bio?: string;
    specialites?: string[];
    linkedin_url?: string;
    photo_url?: string;
    cv_url?: string;
  };
  formationsAssignees: Array<{
    id: string;
    titre: string;
  }>;
}

export function ProfileEditForm({ formateur, formationsAssignees }: ProfileEditFormProps) {
  const [bio, setBio] = useState(formateur.bio || "");
  const [specialites, setSpecialites] = useState<string[]>(formateur.specialites || []);
  const [linkedinUrl, setLinkedinUrl] = useState(formateur.linkedin_url || "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(formateur.photo_url || null);

  const updateProfile = useUpdateFormateurProfile();
  const uploadCV = useUploadFormateurCV();

  useEffect(() => {
    setBio(formateur.bio || "");
    setSpecialites(formateur.specialites || []);
    setLinkedinUrl(formateur.linkedin_url || "");
    setPhotoPreview(formateur.photo_url || null);
  }, [formateur]);

  const handlePhotoChange = (file: File | null) => {
    setPhotoFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPhotoPreview(formateur.photo_url || null);
    }
  };

  const handleCVUpload = async (file: File) => {
    await uploadCV.mutateAsync(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await updateProfile.mutateAsync({
      bio: bio.trim() || undefined,
      specialites: specialites.length > 0 ? specialites : undefined,
      linkedin_url: linkedinUrl.trim() || undefined,
      photo: photoFile || undefined,
    });
  };

  const hasChanges =
    bio !== (formateur.bio || "") ||
    JSON.stringify(specialites) !== JSON.stringify(formateur.specialites || []) ||
    linkedinUrl !== (formateur.linkedin_url || "") ||
    photoFile !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations du Profil</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Read-only Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
            <div>
              <Label className="text-xs text-muted-foreground">Nom</Label>
              <p className="font-medium">{formateur.nom}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Prénom</Label>
              <p className="font-medium">{formateur.prenom}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="font-medium">{formateur.email}</p>
            </div>
            {formateur.telephone && (
              <div>
                <Label className="text-xs text-muted-foreground">Téléphone</Label>
                <p className="font-medium">{formateur.telephone}</p>
              </div>
            )}
          </div>

          {/* Photo Upload */}
          <div className="space-y-2">
            <Label>Photo de profil</Label>
            <PhotoUpload
              currentPhotoUrl={formateur.photo_url}
              preview={photoPreview}
              onFileChange={handlePhotoChange}
            />
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="bio">Biographie</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={2000}
              rows={6}
              disabled={updateProfile.isPending}
              placeholder="Décrivez votre parcours et votre expertise..."
            />
            <p className="text-xs text-muted-foreground">{bio.length}/2000 caractères</p>
          </div>

          {/* Specialites */}
          <div className="space-y-2">
            <Label>Domaines d'expertise</Label>
            <SpecialitesEditor
              specialites={specialites}
              onChange={setSpecialites}
              disabled={updateProfile.isPending}
            />
          </div>

          {/* LinkedIn */}
          <div className="space-y-2">
            <Label htmlFor="linkedin">Profil LinkedIn</Label>
            <Input
              id="linkedin"
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/votre-profil"
              disabled={updateProfile.isPending}
            />
          </div>

          {/* CV Upload */}
          <div className="space-y-2">
            <Label>CV</Label>
            <div className="flex items-center gap-4">
              {formateur.cv_url ? (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg flex-1">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <a
                    href={formateur.cv_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Voir le CV actuel
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun CV téléchargé</p>
              )}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleCVUpload(file);
                    }
                  }}
                  disabled={uploadCV.isPending}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadCV.isPending}
                  asChild
                >
                  <span>
                    {uploadCV.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Téléchargement...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        {formateur.cv_url ? "Remplacer" : "Télécharger"} CV
                      </>
                    )}
                  </span>
                </Button>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Format PDF uniquement, max 10MB</p>
          </div>

          {/* Assigned Training Programs */}
          {formationsAssignees.length > 0 && (
            <div className="space-y-2">
              <Label>Formations assignées</Label>
              <div className="p-4 bg-muted rounded-lg">
                <ul className="space-y-2">
                  {formationsAssignees.map((formation) => (
                    <li key={formation.id} className="text-sm">
                      • {formation.titre}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end pt-4 border-t">
            <Button
              type="submit"
              disabled={updateProfile.isPending || !hasChanges}
            >
              {updateProfile.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Enregistrer les modifications
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

