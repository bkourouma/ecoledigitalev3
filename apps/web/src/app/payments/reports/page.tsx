"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  FileText,
  Download,
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { usePaymentPeriods } from "@/lib/hooks/use-payment-periods";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { createApiHeaders } from "@/lib/api-utils";
import Link from "next/link";

// Helper function to format FCFA amounts
const formatFCFA = (amount: number) => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA';
};

interface PaymentReportSummary {
  totalPayments: number;
  totalAmount: number;
  pendingApprovals: number;
  pendingPayments: number;
  byStatus: Record<string, { count: number; amount: number }>;
  byType: Record<string, { count: number; amount: number }>;
}

interface PaymentReportData {
  summary: PaymentReportSummary;
  details: any[];
  period: any;
  generatedAt: string;
}

export default function PaymentReportsPage() {
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("all");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [groupBy, setGroupBy] = useState<"teacher" | "course" | "period" | "month">("teacher");
  const [includeDetails, setIncludeDetails] = useState(true);

  // Fetch payment periods
  const { data: periodsData, isLoading: loadingPeriods } = usePaymentPeriods({
    academicYearScopeKey: activeAcademicYearId,
  });
  const periods = periodsData?.data || [];

  // Build query params
  const queryParams = new URLSearchParams();
  if (selectedPeriodId && selectedPeriodId !== "all") queryParams.append("periodId", selectedPeriodId);
  if (selectedTeacherId) queryParams.append("teacherId", selectedTeacherId);
  if (fromDate) queryParams.append("fromDate", fromDate);
  if (toDate) queryParams.append("toDate", toDate);
  queryParams.append("groupBy", groupBy);
  queryParams.append("includeDetails", includeDetails.toString());

  // Fetch payment report
  const {
    data: reportData,
    isLoading: loadingReport,
    error: reportError,
  } = useQuery<{ data: PaymentReportData }>({
    queryKey: ["payment-reports", activeAcademicYearId, queryParams.toString()],
    queryFn: async () => {
      const response = await fetch(
        `/api/v1/payment-reports/summary?${queryParams.toString()}`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return response.json();
    },
    enabled: true, // Always enabled, but will only fetch when needed
  });

  const report = reportData?.data;
  
  // Debug: log period data
  if (report?.period) {
    console.log('Period data received:', {
      name: report.period.name,
      periodStart: report.period.periodStart,
      periodEnd: report.period.periodEnd,
      selectedPeriodId
    });
  }

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedPeriodId && selectedPeriodId !== "all") params.append("periodId", selectedPeriodId);
      if (selectedTeacherId) params.append("teacherId", selectedTeacherId);
      if (fromDate) params.append("fromDate", fromDate);
      if (toDate) params.append("toDate", toDate);
      params.append("groupBy", groupBy);
      params.append("includeDetails", includeDetails.toString());
      params.append("format", "csv");
      
      const response = await fetch(
        `/api/v1/payment-reports/export/csv?${params.toString()}`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error("Erreur lors de l'export");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-paiements-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export error:", error);
      alert("Erreur lors de l'export du rapport");
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
      calculated: { label: "Calculé", variant: "secondary", icon: Clock },
      approved: { label: "Approuvé", variant: "default", icon: CheckCircle2 },
      paid: { label: "Payé", variant: "default", icon: CheckCircle2 },
      cancelled: { label: "Annulé", variant: "destructive", icon: XCircle },
    };

    const config = statusConfig[status] || { label: status, variant: "outline", icon: AlertTriangle };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Rapports Enseignants
          </h1>
          <p className="text-muted-foreground mt-2">
            Générez et consultez des rapports détaillés sur les paiements des enseignants
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!report}>
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
          <Link href="/payments/calculate">
            <Button size="sm" variant="outline">
              Retour au Calcul
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>Filtrez les rapports selon vos critères</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Période de Paiement</label>
              <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes les périodes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les périodes</SelectItem>
                  {loadingPeriods ? (
                    <SelectItem value="loading" disabled>
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </SelectItem>
                  ) : (
                    periods.map((period) => (
                      <SelectItem key={period.id} value={period.id}>
                        {period.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Enseignant</label>
              <Input
                placeholder="ID de l'enseignant"
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Date de début</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Date de fin</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Grouper par</label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="teacher">Enseignant</SelectItem>
                  <SelectItem value="course">Cours</SelectItem>
                  <SelectItem value="period">Période</SelectItem>
                  <SelectItem value="month">Mois</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {loadingReport ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : reportError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Erreur lors du chargement du rapport: {(reportError as any)?.message || "Erreur inconnue"}
          </AlertDescription>
        </Alert>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Paiements</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.summary.totalPayments}</div>
                <p className="text-xs text-muted-foreground">
                  {formatFCFA(report.summary.totalAmount)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">En Attente d'Approbation</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.summary.pendingApprovals}</div>
                <p className="text-xs text-muted-foreground">
                  {report.summary.pendingApprovals > 0 ? "Nécessite une action" : "Aucune action requise"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">En Attente de Paiement</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.summary.pendingPayments}</div>
                <p className="text-xs text-muted-foreground">
                  Approuvés mais non payés
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Montant Total</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatFCFA(report.summary.totalAmount)}</div>
                <p className="text-xs text-muted-foreground">
                  Tous les paiements confondus
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown by Status */}
          <Card>
            <CardHeader>
              <CardTitle>Répartition par Statut</CardTitle>
              <CardDescription>Vue d'ensemble des paiements par statut</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(report.summary.byStatus).map(([status, data]: [string, any]) => (
                  <div key={status} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="text-sm font-medium">{getStatusBadge(status)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {data.count} paiement{data.count > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{formatFCFA(data.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Details Table */}
          {includeDetails && report.details && report.details.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Détails du Rapport</CardTitle>
                <CardDescription>
                  Grouper par: {groupBy === "teacher" ? "Enseignant" : groupBy === "course" ? "Cours" : groupBy === "period" ? "Période" : "Mois"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {groupBy === "teacher" && (
                          <>
                            <TableHead>Enseignant</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Nombre de Paiements</TableHead>
                            <TableHead>Montant Total</TableHead>
                            <TableHead>En Attente</TableHead>
                            <TableHead>Approuvé</TableHead>
                            <TableHead>Payé</TableHead>
                          </>
                        )}
                        {groupBy === "course" && (
                          <>
                            <TableHead>Cours</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Nombre de Paiements</TableHead>
                            <TableHead>Montant Total</TableHead>
                          </>
                        )}
                        {groupBy === "period" && (
                          <>
                            <TableHead>Période</TableHead>
                            <TableHead>Date de Début</TableHead>
                            <TableHead>Date de Fin</TableHead>
                            <TableHead>Nombre de Paiements</TableHead>
                            <TableHead>Montant Total</TableHead>
                          </>
                        )}
                        {groupBy === "month" && (
                          <>
                            <TableHead>Mois</TableHead>
                            <TableHead>Nombre de Paiements</TableHead>
                            <TableHead>Montant Total</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.details.map((detail: any, index: number) => (
                        <TableRow key={index}>
                          {groupBy === "teacher" && (
                            <>
                              <TableCell className="font-medium">
                                {detail.teacher_name || "N/A"}
                              </TableCell>
                              <TableCell>{detail.teacher_email || "N/A"}</TableCell>
                              <TableCell>{detail.payment_count || 0}</TableCell>
                              <TableCell className="font-semibold">
                                {formatFCFA(detail.total_amount || 0)}
                              </TableCell>
                              <TableCell>{formatFCFA(detail.pending_amount || 0)}</TableCell>
                              <TableCell>{formatFCFA(detail.approved_amount || 0)}</TableCell>
                              <TableCell>{formatFCFA(detail.paid_amount || 0)}</TableCell>
                            </>
                          )}
                          {groupBy === "course" && (
                            <>
                              <TableCell className="font-medium">
                                {detail.course_title || "N/A"}
                              </TableCell>
                              <TableCell>{detail.course_code || "N/A"}</TableCell>
                              <TableCell>{detail.payment_count || 0}</TableCell>
                              <TableCell className="font-semibold">
                                {formatFCFA(detail.total_amount || 0)}
                              </TableCell>
                            </>
                          )}
                          {groupBy === "period" && (
                            <>
                              <TableCell className="font-medium">
                                {detail.period_name || "N/A"}
                              </TableCell>
                              <TableCell>
                                {detail.period_start
                                  ? new Date(detail.period_start).toLocaleDateString("fr-FR")
                                  : "N/A"}
                              </TableCell>
                              <TableCell>
                                {detail.period_end
                                  ? new Date(detail.period_end).toLocaleDateString("fr-FR")
                                  : "N/A"}
                              </TableCell>
                              <TableCell>{detail.payment_count || 0}</TableCell>
                              <TableCell className="font-semibold">
                                {formatFCFA(detail.total_amount || 0)}
                              </TableCell>
                            </>
                          )}
                          {groupBy === "month" && (
                            <>
                              <TableCell className="font-medium">
                                {detail.month
                                  ? new Date(detail.month).toLocaleDateString("fr-FR", {
                                      month: "long",
                                      year: "numeric",
                                    })
                                  : "N/A"}
                              </TableCell>
                              <TableCell>{detail.payment_count || 0}</TableCell>
                              <TableCell className="font-semibold">
                                {formatFCFA(detail.total_amount || 0)}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* No Details Message */}
          {includeDetails && (!report.details || report.details.length === 0) && (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Aucun détail disponible pour les filtres sélectionnés</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Period Info */}
          {report?.period && selectedPeriodId && selectedPeriodId !== "all" && (
            <Card>
              <CardHeader>
                <CardTitle>Informations sur la Période</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Nom</div>
                    <div className="text-lg font-semibold">{report.period.name || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Date de Début</div>
                    <div className="text-lg font-semibold">
                      {report.period.periodStart && report.period.periodStart !== 'Invalid Date'
                        ? (() => {
                            try {
                              const date = new Date(report.period.periodStart);
                              return isNaN(date.getTime()) 
                                ? 'N/A' 
                                : date.toLocaleDateString("fr-FR", {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  });
                            } catch {
                              return 'N/A';
                            }
                          })()
                        : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Date de Fin</div>
                    <div className="text-lg font-semibold">
                      {report.period.periodEnd && report.period.periodEnd !== 'Invalid Date'
                        ? (() => {
                            try {
                              const date = new Date(report.period.periodEnd);
                              return isNaN(date.getTime()) 
                                ? 'N/A' 
                                : date.toLocaleDateString("fr-FR", {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  });
                            } catch {
                              return 'N/A';
                            }
                          })()
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generated At */}
          <div className="text-sm text-muted-foreground text-center">
            Rapport généré le {new Date(report.generatedAt).toLocaleString("fr-FR")}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Sélectionnez des filtres et le rapport sera généré automatiquement</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

