"use client";

import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { X, Loader2, Upload } from "lucide-react";
import { useUploadSupport } from "@/lib/hooks/use-formateur-supports";
import { useFormations } from "@/lib/hooks/use-formations-pro";

interface UploadSupportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadSupportModal({
  open,
  onOpenChange,
}: UploadSupportModalProps) {
  const [supportType, setSupportType] = useState<"file" | "video">("file");
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [formationId, setFormationId] = useState<string>("");
  const [videoProvider, setVideoProvider] = useState<"local" | "vimeo">("local");
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [visibleApprenants, setVisibleApprenants] = useState(true);
  const uploadSupport = useUploadSupport();
  const { data: formationsData } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];
  const isVideoSupport = supportType === "video";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];

      const isVideo = selectedFile.type.startsWith("video/");
      if (isVideoSupport && !isVideo) {
        alert("Veuillez sélectionner un fichier vidéo");
        return;
      }
      if (!isVideoSupport && isVideo) {
        alert("Ce support est défini comme fichier. Passez en type vidéo pour ce format.");
        return;
      }

      const maxSize = isVideo ? 1024 * 1024 * 1024 : 100 * 1024 * 1024;

      // Validate file size (1GB for videos, 100MB for other files)
      if (selectedFile.size > maxSize) {
        alert(isVideo ? "La vidéo ne doit pas dépasser 1GB" : "Le fichier ne doit pas dépasser 100MB");
        return;
      }

      setFile(selectedFile);
      // Auto-fill title if empty
      if (!titre) {
        setTitre(selectedFile.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleSupportTypeChange = (type: "file" | "video") => {
    setSupportType(type);
    setFile(null);
    setVideoProvider("local");
    setVimeoUrl("");
    setThumbnailFile(null);
    setThumbnailUrl("");
  };

  const handleThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedThumbnail = e.target.files[0];
      if (!selectedThumbnail.type.startsWith("image/")) {
        alert("La miniature doit être une image");
        return;
      }
      if (selectedThumbnail.size > 10 * 1024 * 1024) {
        alert("La miniature ne doit pas dépasser 10MB");
        return;
      }
      setThumbnailFile(selectedThumbnail);
      setThumbnailUrl("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      alert("Veuillez sélectionner un fichier");
      return;
    }

    if (!titre.trim()) {
      alert("Le titre est requis");
      return;
    }

    if (!formationId) {
      alert("Veuillez sélectionner une formation");
      return;
    }
    const isVideo = file.type.startsWith("video/");
    if (isVideoSupport !== isVideo) {
      alert("Le type choisi ne correspond pas au fichier sélectionné.");
      return;
    }
    if (isVideo && videoProvider === "vimeo" && !vimeoUrl.trim()) {
      alert("Veuillez renseigner l'URL Vimeo");
      return;
    }

    try {
      await uploadSupport.mutateAsync({
        file,
        titre: titre.trim(),
        description: description.trim() || undefined,
        formation_id: formationId || undefined,
        video_provider: isVideo ? videoProvider : undefined,
        vimeo_url: isVideo && videoProvider === "vimeo" ? vimeoUrl.trim() : undefined,
        thumbnail_url: isVideo && !thumbnailFile ? thumbnailUrl.trim() || undefined : undefined,
        thumbnail_file: isVideo ? thumbnailFile || undefined : undefined,
        visible_apprenants: visibleApprenants,
      });

      // Reset form
      setFile(null);
      setThumbnailFile(null);
      setSupportType("file");
      setTitre("");
      setDescription("");
      setFormationId("");
      setVideoProvider("local");
      setVimeoUrl("");
      setThumbnailUrl("");
      setVisibleApprenants(true);
      onOpenChange(false);
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  };

  const handleClose = () => {
    if (!uploadSupport.isPending) {
      setFile(null);
      setThumbnailFile(null);
      setSupportType("file");
      setTitre("");
      setDescription("");
      setFormationId("");
      setVideoProvider("local");
      setVimeoUrl("");
      setThumbnailUrl("");
      setVisibleApprenants(true);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle>Ajouter un support de cours</DialogTitle>
              <DialogDescription className="mt-2">
                Téléchargez un fichier et ajoutez les informations nécessaires
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0"
              disabled={uploadSupport.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Type de support *</Label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="support_type_modal"
                  checked={supportType === "file"}
                  onChange={() => handleSupportTypeChange("file")}
                  disabled={uploadSupport.isPending}
                />
                Fichier
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="support_type_modal"
                  checked={supportType === "video"}
                  onChange={() => handleSupportTypeChange("video")}
                  disabled={uploadSupport.isPending}
                />
                Vidéo
              </label>
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="file">{isVideoSupport ? "Vidéo" : "Fichier"} *</Label>
            <div className="flex items-center gap-2">
              <Input
                id="file"
                type="file"
                onChange={handleFileChange}
                accept={
                  isVideoSupport
                    ? "video/mp4,video/avi,video/x-msvideo,video/quicktime,video/webm"
                    : ".pdf,.ppt,.pptx,.doc,.docx,.zip"
                }
                disabled={uploadSupport.isPending}
                className="flex-1"
              />
            </div>
            {file && (
              <p className="text-sm text-muted-foreground">
                {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {isVideoSupport
                ? "Types acceptés: MP4, AVI, MOV, WEBM (max 1GB)"
                : "Types acceptés: PDF, PowerPoint, Word, ZIP (max 100MB)"}
            </p>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="titre">Titre *</Label>
            <Input
              id="titre"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              required
              maxLength={255}
              disabled={uploadSupport.isPending}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              disabled={uploadSupport.isPending}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/2000 caractères
            </p>
          </div>

          {/* Formation */}
          <div className="space-y-2">
            <Label htmlFor="formation">Formation *</Label>
            <select
              id="formation"
              value={formationId}
              onChange={(e) => setFormationId(e.target.value)}
              disabled={uploadSupport.isPending}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Sélectionner une formation</option>
              {formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.titre}
                </option>
              ))}
            </select>
          </div>

          {/* Video storage options */}
          {isVideoSupport && (
            <div className="space-y-3 rounded-md border p-3">
              <Label>Stockage vidéo</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="video_provider_modal"
                    checked={videoProvider === "local"}
                    onChange={() => setVideoProvider("local")}
                    disabled={uploadSupport.isPending}
                  />
                  Local
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="video_provider_modal"
                    checked={videoProvider === "vimeo"}
                    onChange={() => setVideoProvider("vimeo")}
                    disabled={uploadSupport.isPending}
                  />
                  Vimeo
                </label>
              </div>

              {videoProvider === "vimeo" && (
                <div className="space-y-2">
                  <Label htmlFor="vimeo_url_modal">URL Vimeo *</Label>
                  <Input
                    id="vimeo_url_modal"
                    value={vimeoUrl}
                    onChange={(e) => setVimeoUrl(e.target.value)}
                    placeholder="https://vimeo.com/123456789"
                    disabled={uploadSupport.isPending}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="thumbnail_file_modal">Thumbnail locale (optionnelle)</Label>
                <Input
                  id="thumbnail_file_modal"
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailFileChange}
                  disabled={uploadSupport.isPending}
                />
                {thumbnailFile && (
                  <p className="text-xs text-muted-foreground">
                    {thumbnailFile.name} ({(thumbnailFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}
              </div>

              {!thumbnailFile && (
                <div className="space-y-2">
                  <Label htmlFor="thumbnail_url_modal">URL thumbnail (optionnelle)</Label>
                  <Input
                    id="thumbnail_url_modal"
                    value={thumbnailUrl}
                    onChange={(e) => setThumbnailUrl(e.target.value)}
                    placeholder="https://.../thumb.jpg"
                    disabled={uploadSupport.isPending}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Vous pouvez soit charger une image locale, soit fournir une URL.
              </p>
            </div>
          )}

          {isVideoSupport && file && !file.type.startsWith("video/") && (
            <p className="text-xs text-destructive">
              Le fichier sélectionné n'est pas une vidéo. Merci de choisir une vidéo.
            </p>
          )}

          {!isVideoSupport && file && file.type.startsWith("video/") && (
            <p className="text-xs text-destructive">
              Le type de support est "Fichier". Passez en "Vidéo" pour ce fichier.
            </p>
          )}

          {/* Visible to learners */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="visible_apprenants"
              checked={visibleApprenants}
              onCheckedChange={(checked) => setVisibleApprenants(checked === true)}
              disabled={uploadSupport.isPending}
            />
            <Label
              htmlFor="visible_apprenants"
              className="text-sm font-normal cursor-pointer"
            >
              Visible pour les apprenants
            </Label>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploadSupport.isPending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={uploadSupport.isPending || !file || !titre.trim()}>
              {uploadSupport.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Upload className="mr-2 h-4 w-4" />
              Télécharger
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
