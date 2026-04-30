"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { UploadCloud, ArrowLeft, Loader2 } from "lucide-react";
import { useUploadSupport } from "@/lib/hooks/use-formateur-supports";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { useFormateurSessions } from "@/lib/hooks/use-formateur-sessions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import { toast } from "sonner";

export default function UploadSupportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [formationId, setFormationId] = useState<string>("");
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [videoProvider, setVideoProvider] = useState<"local" | "vimeo">("local");
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [visibleApprenants, setVisibleApprenants] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadSupport = useUploadSupport();
  const { data: formationsData } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];

  // Fetch sessions if formation is selected
  const { data: sessionsData } = useFormateurSessions({
    page: 1,
    limit: 100,
    formation_id: formationId || undefined,
  });
  const sessions = sessionsData?.data?.sessions || [];

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
      "application/x-zip-compressed",
      "video/mp4",
      "video/avi",
      "video/x-msvideo",
      "video/quicktime",
    ];

    if (!allowedTypes.includes(selectedFile.type)) {
      toast.error("Type de fichier non supporté. Types acceptés: PDF, PowerPoint, Word, ZIP, Vidéo");
      return;
    }

    const isVideo = selectedFile.type.startsWith("video/");
    const maxSize = isVideo ? 1024 * 1024 * 1024 : 100 * 1024 * 1024;

    // Validate file size (1GB for videos, 100MB for other files)
    if (selectedFile.size > maxSize) {
      toast.error(isVideo ? "La vidéo ne doit pas dépasser 1GB" : "Le fichier ne doit pas dépasser 100MB");
      return;
    }

    setFile(selectedFile);
    // Auto-fill title if empty
    if (!titre) {
      setTitre(selectedFile.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleSessionToggle = (sessionId: string) => {
    setSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      toast.error("Veuillez sélectionner un fichier");
      return;
    }

    if (!titre.trim()) {
      toast.error("Le titre est requis");
      return;
    }

    if (!formationId && sessionIds.length === 0) {
      toast.error("Veuillez sélectionner une formation ou au moins une session");
      return;
    }

    const isVideo = file.type.startsWith("video/");
    if (isVideo && videoProvider === "vimeo" && !vimeoUrl.trim()) {
      toast.error("Veuillez renseigner une URL Vimeo pour le mode Vimeo");
      return;
    }

    try {
      setUploadProgress(0);
      // Simulate progress (actual progress would require XMLHttpRequest)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      await uploadSupport.mutateAsync({
        file,
        titre: titre.trim(),
        description: description.trim() || undefined,
        formation_id: formationId || undefined,
        video_provider: isVideo ? videoProvider : undefined,
        vimeo_url: isVideo && videoProvider === "vimeo" ? vimeoUrl.trim() : undefined,
        thumbnail_url: thumbnailUrl.trim() || undefined,
        session_ids: sessionIds.length > 0 ? sessionIds : undefined,
        visible_apprenants: visibleApprenants,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      toast.success("Support de cours uploadé avec succès");
      
      // Redirect to materials list after a short delay
      setTimeout(() => {
        router.push("/formateur/supports");
      }, 1000);
    } catch (error) {
      setUploadProgress(0);
      // Error is handled by the hook (toast)
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Link href="/formateur/supports">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div className="flex items-center gap-3 flex-1">
                <div className="rounded-lg bg-primary/10 p-3">
                  <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Ajouter un Support de Cours</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">
                    Téléchargez un fichier et ajoutez les informations nécessaires
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      <ErrorBoundary>
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* File Upload with Drag & Drop */}
              <div className="space-y-2">
                <Label htmlFor="file">Fichier *</Label>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-primary/50"
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  {file ? (
                    <div className="space-y-2">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFile(null)}
                        disabled={uploadSupport.isPending}
                      >
                        Changer de fichier
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <UploadCloud className="h-12 w-12 text-muted-foreground mx-auto" />
                      <div>
                        <p className="text-sm font-medium">
                          Glissez-déposez un fichier ici ou cliquez pour sélectionner
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Types acceptés: PDF, PowerPoint, Word, ZIP, Vidéo (max 1GB pour vidéo, 100MB sinon)
                        </p>
                      </div>
                      <Input
                        id="file"
                        type="file"
                        onChange={handleFileInputChange}
                        accept=".pdf,.ppt,.pptx,.doc,.docx,.zip,.mp4,.avi"
                        disabled={uploadSupport.isPending}
                        className="hidden"
                      />
                      <Label htmlFor="file">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          disabled={uploadSupport.isPending}
                          onClick={() => document.getElementById("file")?.click()}
                        >
                          Sélectionner un fichier
                        </Button>
                      </Label>
                    </div>
                  )}
                </div>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>Upload en cours...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
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
                  placeholder="Titre du support de cours"
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
                  rows={4}
                  placeholder="Description du support (optionnelle)"
                />
                <p className="text-xs text-muted-foreground">
                  {description.length}/2000 caractères
                </p>
              </div>

              {/* Video storage options */}
              {file?.type?.startsWith("video/") && (
                <div className="space-y-3 rounded-md border p-4">
                  <Label>Stockage vidéo</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="video_provider"
                        value="local"
                        checked={videoProvider === "local"}
                        onChange={() => setVideoProvider("local")}
                        disabled={uploadSupport.isPending}
                      />
                      Stockage local
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="video_provider"
                        value="vimeo"
                        checked={videoProvider === "vimeo"}
                        onChange={() => setVideoProvider("vimeo")}
                        disabled={uploadSupport.isPending}
                      />
                      Vimeo
                    </label>
                  </div>

                  {videoProvider === "vimeo" && (
                    <div className="space-y-2">
                      <Label htmlFor="vimeo_url">URL Vimeo *</Label>
                      <Input
                        id="vimeo_url"
                        value={vimeoUrl}
                        onChange={(e) => setVimeoUrl(e.target.value)}
                        placeholder="https://vimeo.com/123456789"
                        disabled={uploadSupport.isPending}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="thumbnail_url">URL thumbnail (optionnelle)</Label>
                    <Input
                      id="thumbnail_url"
                      value={thumbnailUrl}
                      onChange={(e) => setThumbnailUrl(e.target.value)}
                      placeholder="https://.../thumbnail.jpg"
                      disabled={uploadSupport.isPending}
                    />
                  </div>
                </div>
              )}

              {/* Formation */}
              <div className="space-y-2">
                <Label htmlFor="formation">Formation (optionnelle)</Label>
                <select
                  id="formation"
                  value={formationId}
                  onChange={(e) => {
                    setFormationId(e.target.value);
                    setSessionIds([]); // Reset sessions when formation changes
                  }}
                  disabled={uploadSupport.isPending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Aucune formation</option>
                  {formations.map((formation) => (
                    <option key={formation.id} value={formation.id}>
                      {formation.titre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sessions (multi-select) */}
              {formationId && sessions.length > 0 && (
                <div className="space-y-2">
                  <Label>Sessions associées (optionnel)</Label>
                  <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`session-${session.id}`}
                          checked={sessionIds.includes(session.id)}
                          onCheckedChange={() => handleSessionToggle(session.id)}
                          disabled={uploadSupport.isPending}
                        />
                        <Label
                          htmlFor={`session-${session.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {session.code_session} - {session.formation?.titre || "Formation"}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
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
                <Link href="/formateur/supports">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadSupport.isPending}
                  >
                    Annuler
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={uploadSupport.isPending || !file || !titre.trim()}
                >
                  {uploadSupport.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Upload en cours...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="mr-2 h-4 w-4" />
                      Télécharger
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </ErrorBoundary>
    </div>
  );
}
