"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, Plus, Edit, Trash2, Eye } from "lucide-react";
import { getRSOToken, getRSOUserFromToken } from "@/lib/rso/auth";
import {
  listRSOActivities,
  deleteRSOActivity,
  RSOActivity,
  RSOActivityFilters,
} from "@/lib/rso/activities";
import { listRSOInstallations, RSOInstallation } from "@/lib/rso/installations";
import { CreateActivityForm } from "@/components/rso/formateur/CreateActivityForm";
import { EditActivityForm } from "@/components/rso/formateur/EditActivityForm";
import { ActivityDetail } from "@/components/rso/pfso/ActivityDetail";
import toast from "react-hot-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function RSOFormateurActivitiesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<RSOActivity[]>([]);
  const [installations, setInstallations] = useState<RSOInstallation[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<RSOActivity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [filters, setFilters] = useState<RSOActivityFilters>({
    year: new Date().getFullYear(),
  });
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // Get current year as default
  const currentYear = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let i = 0; i < 6; i++) {
    yearOptions.push(currentYear - i);
  }

  useEffect(() => {
    // Check authentication and role
    const token = getRSOToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const userInfo = getRSOUserFromToken();
    if (userInfo && userInfo.role !== "rso_formateur") {
      router.push("/login");
      return;
    }

    loadInstallations();
    loadActivities();
  }, [router, filters]);

  const loadInstallations = async () => {
    try {
      const installationsList = await listRSOInstallations();
      setInstallations(installationsList.installations);
    } catch (error: any) {
      console.error("Error loading installations:", error);
      setError(error.message || "Erreur lors du chargement des installations");
      setInstallations([]); // Ensure installations is always an array
    }
  };

  const loadActivities = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await listRSOActivities(filters);
      setActivities(result.activities);
      setPagination(result.pagination);
    } catch (error: any) {
      console.error("Error loading activities:", error);
      setError(error.message || "Erreur lors du chargement des activités");
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (activity: RSOActivity) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer l'activité "${activity.titre}" ?`)) {
      return;
    }

    try {
      await deleteRSOActivity(activity.id);
      toast.success("Activité supprimée avec succès");
      loadActivities();
    } catch (error: any) {
      console.error("Error deleting activity:", error);
      toast.error(error.message || "Erreur lors de la suppression de l'activité");
    }
  };

  const handleViewDetails = (activity: RSOActivity) => {
    setSelectedActivity(activity);
    setDetailOpen(true);
  };

  const handleEdit = (activity: RSOActivity) => {
    // Redirect to new editor page with rich text editor (Phase 4)
    router.push(`/rso/formateur/activites/${activity.id}/modifier`);
  };

  const handleDownload = async (activity: RSOActivity) => {
    try {
      const token = getRSOToken();
      if (!token) {
        throw new Error("Non authentifié");
      }

      const response = await fetch(`/api/v1/rso/activities/${activity.id}/pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Tenant": "aspci",
        },
      });

      if (!response.ok) {
        throw new Error("Erreur lors du téléchargement");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rapport-activite-${activity.id}-${activity.titre.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Error downloading report:", error);
      toast.error(error.message || "Erreur lors du téléchargement du rapport");
    }
  };

  const handlePrint = async (activity: RSOActivity) => {
    try {
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        throw new Error("Impossible d'ouvrir la fenêtre d'impression");
      }

      printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <title>Rapport d'activité - ${activity.titre}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
    .meta { margin: 20px 0; }
    .meta-item { margin: 10px 0; }
    .meta-label { font-weight: bold; }
    .description { margin: 20px 0; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>RAPPORT D'ACTIVITÉ RSO</h1>
  <div class="meta">
    <div class="meta-item"><span class="meta-label">Titre:</span> ${activity.titre}</div>
    <div class="meta-item"><span class="meta-label">Type:</span> ${activity.type}</div>
    <div class="meta-item"><span class="meta-label">Date:</span> ${format(new Date(activity.dateActivite), "dd MMMM yyyy", { locale: fr })}</div>
    <div class="meta-item"><span class="meta-label">Statut:</span> ${activity.statut}</div>
  </div>
  ${activity.description ? `<div class="description"><strong>Description:</strong><br>${activity.description.replace(/\n/g, "<br>")}</div>` : ""}
  <div class="meta">
    <div class="meta-item"><span class="meta-label">Généré le:</span> ${new Date().toLocaleString("fr-FR")}</div>
  </div>
</body>
</html>
      `);

      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
    } catch (error: any) {
      console.error("Error printing report:", error);
      toast.error(error.message || "Erreur lors de l'impression du rapport");
    }
  };

  if (loading && activities.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestion des activités</h1>
          <p className="text-muted-foreground mt-2">
            Créez et gérez les activités de sûreté portuaire
          </p>
        </div>
        <Button onClick={() => router.push("/rso/formateur/activites/creer")}>
          <Plus className="mr-2 h-4 w-4" />
          Nouvelle activité
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Année</label>
            <Select
              value={filters.year?.toString() || currentYear.toString()}
              onValueChange={(value) =>
                setFilters({ ...filters, year: parseInt(value, 10) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Installation</label>
            <Select
              value={filters.installationId?.toString() || "all"}
              onValueChange={(value) =>
                setFilters({
                  ...filters,
                  installationId: value === "all" ? undefined : parseInt(value, 10),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les installations</SelectItem>
                {installations.map((installation) => (
                  <SelectItem key={installation.id} value={installation.id.toString()}>
                    {installation.nomPort} ({installation.codeInstallation})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={loadActivities}>Rechercher</Button>
          </div>
        </CardContent>
      </Card>

      {/* Activities List */}
      {activities.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium mb-2">Aucune activité trouvée</p>
              <p className="text-sm">
                {filters.year || filters.installationId
                  ? "Aucune activité ne correspond aux filtres sélectionnés."
                  : "Commencez par créer une nouvelle activité."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {activities.map((activity) => (
            <Card key={activity.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2">{activity.titre}</CardTitle>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div>
                        {format(new Date(activity.dateActivite), "dd MMMM yyyy", {
                          locale: fr,
                        })}
                      </div>
                      <div className="capitalize">{activity.type}</div>
                      <div>
                        <span className="px-2 py-1 rounded-full bg-muted text-xs capitalize">
                          {activity.statut}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(activity)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(activity)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(activity)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Card className="mt-4">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages} (
                {pagination.total} activité{pagination.total > 1 ? "s" : ""})
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ ...filters, page: pagination.page - 1 });
                    loadActivities();
                  }}
                  disabled={pagination.page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ ...filters, page: pagination.page + 1 });
                    loadActivities();
                  }}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      <CreateActivityForm
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={loadActivities}
        installations={installations}
      />

      <EditActivityForm
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        onSuccess={loadActivities}
        activity={selectedActivity}
        installations={installations}
      />

      <ActivityDetail
        activity={selectedActivity}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDownload={handleDownload}
        onPrint={handlePrint}
      />
    </div>
  );
}

