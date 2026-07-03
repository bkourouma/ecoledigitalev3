"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@ecoledigitale/ui";
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Presentation,
  Trash2,
  Upload,
  Eye,
  X,
  BarChart3,
} from "lucide-react";
import {
  useDeleteSubjectMaterial,
  useMaterialViewsSummary,
  useSubjectMaterials,
  useUploadSubjectMaterial,
  fetchMaterialBlobUrl,
} from "@/lib/hooks/use-professional-subject-materials";

interface Props {
  subjectId: string;
  /** Active le bouton « Ajouter » / suppression (admin ou enseignant du sujet). */
  canManage?: boolean;
  /** Affiche le bouton « Statistiques » (admin ou enseignant du sujet). */
  canViewStats?: boolean;
  title?: string;
  description?: string;
}

const ACCEPTED_MIME =
  ".pdf,.ppt,.pptx,.mp4,.webm,.mov,.m4v,.png,.jpg,.jpeg,.gif,.webp";

function fmtSize(size?: number | null): string {
  if (!size) return "—";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (kind === "pptx") return <Presentation className="h-4 w-4 text-orange-500" />;
  if (kind === "video") return <Film className="h-4 w-4 text-purple-500" />;
  if (kind === "image") return <ImageIcon className="h-4 w-4 text-blue-500" />;
  return <FileText className="h-4 w-4 text-gray-400" />;
}

export function SubjectMaterialsPanel({
  subjectId,
  canManage = false,
  canViewStats = false,
  title = "Supports de cours",
  description = "Supports rattachés à la matière, réutilisables d'une session à l'autre. Lecture seule via le site (PDF, PowerPoint, vidéo).",
}: Props) {
  const materialsQuery = useSubjectMaterials(subjectId);
  const uploadMut = useUploadSubjectMaterial();
  const deleteMut = useDeleteSubjectMaterial(subjectId);

  const [titre, setTitre] = useState("");
  const [description2, setDescription2] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; titre: string; kind: string } | null>(null);
  const [statsFor, setStatsFor] = useState<{ id: string; titre: string } | null>(null);

  const materials: any[] = materialsQuery.data ?? [];

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return;
    // Fallback : nom du fichier (sans extension) si pas de titre saisi
    const finalTitre =
      titre.trim() || file.name.replace(/\.[^.]+$/, "") || "Support";
    try {
      await uploadMut.mutateAsync({
        subjectId,
        titre: finalTitre,
        description: description2 || undefined,
        file,
      });
      setTitre("");
      setDescription2("");
      setFile(null);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'upload.");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    if (typeof window !== "undefined" && !window.confirm("Supprimer définitivement ce support ?")) return;
    try {
      await deleteMut.mutateAsync(id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {materialsQuery.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun support pour le moment.</p>
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <KindIcon kind={m.kind} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.titre}</p>
                    {m.description && (
                      <p className="text-xs text-muted-foreground truncate">{m.description}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {m.kind.toUpperCase()} · {fmtSize(m.file_size)} · {m.nb_views} lecture
                      {m.nb_views > 1 ? "s" : ""} ({m.nb_viewers} utilisateur
                      {m.nb_viewers > 1 ? "s" : ""})
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setViewer({ id: m.id, titre: m.titre, kind: m.kind })}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Lire
                  </Button>
                  {canViewStats && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setStatsFor({ id: m.id, titre: m.titre })}
                    >
                      <BarChart3 className="h-4 w-4 mr-1" />
                      Stats
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(m.id)}
                      disabled={deleteMut.isPending}
                      className="text-red-600 hover:text-red-700"
                    >
                      {deleteMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form
            onSubmit={handleUpload}
            className="space-y-2 rounded-lg border border-border bg-muted/30 p-4"
          >
            <p className="text-sm font-medium">Ajouter un support</p>
            <Input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder="Titre (rempli automatiquement à partir du nom du fichier)"
            />
            <Input
              value={description2}
              onChange={(e) => setDescription2(e.target.value)}
              placeholder="Description (optionnel)"
            />
            <input
              type="file"
              accept={ACCEPTED_MIME}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                // Auto-remplit le titre avec le nom du fichier (sans extension) si vide
                if (f && !titre.trim()) {
                  const nameNoExt = f.name.replace(/\.[^.]+$/, "");
                  setTitre(nameNoExt);
                }
              }}
              required
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-200"
            />
            <p className="text-[11px] text-muted-foreground">
              Formats acceptés : PDF, PowerPoint (.ppt/.pptx), vidéo (.mp4/.webm/.mov), image.
            </p>
            <Button type="submit" disabled={uploadMut.isPending || !file}>
              {uploadMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Téléverser
            </Button>
          </form>
        )}
      </CardContent>

      {viewer && (
        <MaterialViewer
          materialId={viewer.id}
          titre={viewer.titre}
          kind={viewer.kind}
          onClose={() => setViewer(null)}
        />
      )}
      {statsFor && (
        <MaterialStatsModal
          materialId={statsFor.id}
          titre={statsFor.titre}
          onClose={() => setStatsFor(null)}
        />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Viewer en lecture seule                                                     */
/* -------------------------------------------------------------------------- */

function MaterialViewer({
  materialId,
  titre,
  kind,
  onClose,
}: {
  materialId: string;
  titre: string;
  kind: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ loading: boolean; url?: string; type?: string; error?: string }>({
    loading: true,
  });

  useEffect(() => {
    let revoked = false;
    let blobUrl: string | undefined;
    setState({ loading: true });
    fetchMaterialBlobUrl(materialId)
      .then(({ url, type }) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrl = url;
        setState({ loading: false, url, type });
      })
      .catch((err: Error) => {
        if (!revoked) setState({ loading: false, error: err.message });
      });
    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [materialId]);

  const isPdf = kind === "pdf" || state.type === "application/pdf";
  const isVideo = kind === "video" || state.type?.startsWith("video/");
  const isImage = kind === "image" || state.type?.startsWith("image/");
  const isPptx = kind === "pptx";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold truncate">{titre}</h3>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-muted">
          {state.loading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          )}
          {state.error && (
            <div className="flex items-center justify-center h-full text-red-600 px-6 text-center">
              {state.error}
            </div>
          )}
          {!state.loading && state.url && isPdf && (
            <iframe
              src={`${state.url}#toolbar=0&navpanes=0`}
              className="w-full h-full border-0"
              title={titre}
            />
          )}
          {!state.loading && state.url && isVideo && (
            <video
              src={state.url}
              controls
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              className="w-full h-full bg-black"
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
          {!state.loading && state.url && isImage && (
            <div className="flex items-center justify-center h-full p-4">
              <img
                src={state.url}
                alt={titre}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="max-w-full max-h-full object-contain select-none"
              />
            </div>
          )}
          {!state.loading && state.url && isPptx && (
            <div className="p-6 space-y-3 text-sm text-gray-700">
              <p className="font-medium text-orange-700">
                Le format PowerPoint ne peut pas être prévisualisé directement dans le navigateur.
              </p>
              <p>
                Pour offrir une lecture sans téléchargement, exportez votre fichier au format PDF
                (Fichier → Exporter au format PDF) et téléversez-le à la place.
              </p>
              <p className="text-xs text-gray-500">
                La consultation a quand même été comptabilisée pour respecter le suivi.
              </p>
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border bg-muted/40 text-xs text-muted-foreground">
          Lecture seule — le téléchargement est désactivé.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal de statistiques de consultation                                       */
/* -------------------------------------------------------------------------- */

function MaterialStatsModal({
  materialId,
  titre,
  onClose,
}: {
  materialId: string;
  titre: string;
  onClose: () => void;
}) {
  const summaryQuery = useMaterialViewsSummary(materialId);
  const rows: any[] = summaryQuery.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">Consultations du support</h3>
            <p className="text-xs text-muted-foreground truncate">{titre}</p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {summaryQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : summaryQuery.isError ? (
            <p className="text-sm text-red-700">
              {(summaryQuery.error as Error)?.message ?? "Erreur de chargement."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune consultation enregistrée.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Utilisateur</th>
                  <th className="py-2">Rôles</th>
                  <th className="py-2 text-right">Ouvertures</th>
                  <th className="py-2">Dernière</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="font-medium">
                        {r.first_name} {r.last_name}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </td>
                    <td className="py-2 text-xs">
                      {Array.isArray(r.roles) && r.roles.length > 0 ? r.roles.join(", ") : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">{r.nb_views}</td>
                    <td className="py-2 text-xs">
                      {new Date(r.last_opened_at).toLocaleString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
