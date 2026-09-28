"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ecoledigitale/ui";
import { Alert, AlertDescription } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, ArrowLeft, Shield, Check, X } from "lucide-react";
import { getRSOToken, getRSOUserFromToken } from "@/lib/rso/auth";
import { listPermissions, type RSOPermission } from "@/lib/rso/permissions-api";

const API_BASE = "/api/v1/rso";


const roleLabels: Record<string, string> = {
  administrateur: "Administrateur",
  rso_formateur: "RSO Formateur",
  agent_pfso: "Agent PFSO",
  agent_surete: "Agent Sûreté",
};

const moduleLabels: Record<string, string> = {
  gestion_utilisateurs: "Gestion Utilisateurs",
  gestion_activites: "Gestion Activités",
  gestion_installations: "Gestion Installations",
};

export default function RSOAdminPermissionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<RSOPermission[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check authentication and role
    const token = getRSOToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const userInfo = getRSOUserFromToken();
    if (userInfo && userInfo.role !== "administrateur") {
      router.push("/login");
      return;
    }

    loadPermissions();
  }, [router]);

  const loadPermissions = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await listPermissions();
      setPermissions(result.permissions);
    } catch (err: any) {
      console.error("Error loading permissions:", err);
      setError(err.message || "Erreur lors du chargement des permissions");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push("/rso/admin/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex-1">
          <h1 className="whitespace-nowrap font-bold flex items-center gap-3 text-2xl leading-tight md:text-3xl">
            <Shield className="h-8 w-8" />
            Gestion des Permissions
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Visualisez et gérez les permissions par rôle et module
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Permissions Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Matrice des Permissions</CardTitle>
          <CardDescription>
            Les permissions sont configurées dans la base de données. Cette page affiche la configuration actuelle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-center">Créer</TableHead>
                  <TableHead className="text-center">Lire</TableHead>
                  <TableHead className="text-center">Modifier</TableHead>
                  <TableHead className="text-center">Supprimer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Aucune permission trouvée
                    </TableCell>
                  </TableRow>
                ) : (
                  permissions.map((perm) => (
                    <TableRow key={perm.id}>
                      <TableCell className="font-medium">{roleLabels[perm.role] || perm.role}</TableCell>
                      <TableCell>{moduleLabels[perm.module] || perm.module}</TableCell>
                      <TableCell className="text-center">
                        {perm.canCreate ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <Check className="h-3 w-3 mr-1" />
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200">
                            <X className="h-3 w-3 mr-1" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {perm.canRead ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <Check className="h-3 w-3 mr-1" />
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200">
                            <X className="h-3 w-3 mr-1" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {perm.canUpdate ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <Check className="h-3 w-3 mr-1" />
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200">
                            <X className="h-3 w-3 mr-1" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {perm.canDelete ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <Check className="h-3 w-3 mr-1" />
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200">
                            <X className="h-3 w-3 mr-1" />
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

