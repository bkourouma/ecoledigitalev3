"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
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
  Alert,
  AlertDescription,
  Input,
  Label,
  Badge,
} from "@ecoledigitale/ui";
import {
  TrendingUp,
  Users,
  DollarSign,
  AlertTriangle,
  Loader2,
  Download,
  Filter,
  ArrowLeft,
  Clock,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { createApiHeaders } from "@/lib/api-utils";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to format fee type names in French
const formatFeeType = (feeType: string): string => {
  const feeTypeNames: Record<string, string> = {
    inscription: "Inscription",
    scolarite: "Scolarité",
    annexes: "Frais Annexes",
    autres: "Autres",
  };
  return feeTypeNames[feeType] || feeType;
};

interface ClassReport {
  classId: string;
  className: string;
  totalStudents: number;
  totalFees: number;
  totalCollected: number;
  collectionRate: number;
  studentsWithOverdue: number;
  averagePaymentTime: number; // days
}

export default function ClassesReportPage() {
  const [filters, setFilters] = useState({
    academicYearId: "",
    feeType: "",
    fromDate: "",
    toDate: "",
  });

  // Fetch academic years
  const { data: academicYearsData } = useAcademicYears({ limit: 100 });
  const academicYears = academicYearsData?.data || [];

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.academicYearId) params.append("academicYearId", filters.academicYearId);
    if (filters.feeType) params.append("feeType", filters.feeType);
    if (filters.fromDate) params.append("fromDate", filters.fromDate);
    if (filters.toDate) params.append("toDate", filters.toDate);
    return params.toString();
  }, [filters]);

  // Fetch class reports
  const { data: reportsData, isLoading, error } = useQuery({
    queryKey: ["class-reports", queryParams],
    queryFn: async () => {
      const url = `${API_BASE_URL}/api/v1/financial-reports/classes${queryParams ? `?${queryParams}` : ""}`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return response.json();
    },
    enabled: true,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount || 0);
  };

  const reports: ClassReport[] = reportsData?.data || [];

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters({
      academicYearId: "",
      feeType: "",
      fromDate: "",
      toDate: "",
    });
  };

  const handleExport = () => {
    // TODO: Implement export functionality
    alert("Fonctionnalité d'export à venir");
  };

  // Calculate summary statistics
  const summary = useMemo(() => {
    return reports.reduce(
      (acc, report) => ({
        totalClasses: acc.totalClasses + 1,
        totalStudents: acc.totalStudents + report.totalStudents,
        totalFees: acc.totalFees + report.totalFees,
        totalCollected: acc.totalCollected + report.totalCollected,
        totalOutstanding: acc.totalOutstanding + (report.totalFees - report.totalCollected),
        totalOverdue: acc.totalOverdue + report.studentsWithOverdue,
        avgCollectionRate: acc.avgCollectionRate + report.collectionRate,
      }),
      {
        totalClasses: 0,
        totalStudents: 0,
        totalFees: 0,
        totalCollected: 0,
        totalOutstanding: 0,
        totalOverdue: 0,
        avgCollectionRate: 0,
      }
    );
  }, [reports]);

  const avgCollectionRate = summary.totalClasses > 0 ? summary.avgCollectionRate / summary.totalClasses : 0;

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Erreur lors du chargement du rapport: {error instanceof Error ? error.message : "Erreur inconnue"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rapport par Classe</h1>
          <p className="text-gray-600 mt-2">
            Performance de paiement par classe
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
          <Link href="/admin/finances/reports">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtres
            </CardTitle>
            <CardDescription>
              Filtrez les données du rapport selon vos besoins
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Academic Year Filter */}
              <div>
                <Label htmlFor="academicYear">Année Académique</Label>
                <Select
                  value={filters.academicYearId || "all"}
                  onValueChange={(value) => handleFilterChange("academicYearId", value === "all" ? "" : value)}
                >
                  <SelectTrigger id="academicYear">
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Fee Type Filter */}
              <div>
                <Label htmlFor="feeType">Type de Frais</Label>
                <Select
                  value={filters.feeType || "all"}
                  onValueChange={(value) => handleFilterChange("feeType", value === "all" ? "" : value)}
                >
                  <SelectTrigger id="feeType">
                    <SelectValue placeholder="Tous les types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les types</SelectItem>
                    <SelectItem value="inscription">Inscription</SelectItem>
                    <SelectItem value="scolarite">Scolarité</SelectItem>
                    <SelectItem value="annexes">Frais Annexes</SelectItem>
                    <SelectItem value="autres">Autres</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* From Date Filter */}
              <div>
                <Label htmlFor="fromDate">Date Début</Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => handleFilterChange("fromDate", e.target.value)}
                />
              </div>

              {/* To Date Filter */}
              <div>
                <Label htmlFor="toDate">Date Fin</Label>
                <Input
                  id="toDate"
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => handleFilterChange("toDate", e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                Réinitialiser les filtres
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Chargement du rapport...</span>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Total Classes</p>
                <p className="text-2xl font-bold">{summary.totalClasses}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Total Étudiants</p>
                <p className="text-2xl font-bold text-blue-600">{summary.totalStudents}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Taux de Collecte Moyen</p>
                <p className="text-2xl font-bold text-green-600">{avgCollectionRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Étudiants en Retard</p>
                <p className="text-2xl font-bold text-red-600">{summary.totalOverdue}</p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Classes Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Détails par Classe</CardTitle>
                <CardDescription>
                  Vue détaillée des performances de paiement par classe
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reports.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    Aucune classe trouvée avec les filtres sélectionnés
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3 font-semibold">Classe</th>
                          <th className="text-right p-3 font-semibold">Étudiants</th>
                          <th className="text-right p-3 font-semibold">Total Frais</th>
                          <th className="text-right p-3 font-semibold">Collecté</th>
                          <th className="text-right p-3 font-semibold">En Attente</th>
                          <th className="text-right p-3 font-semibold">En Retard</th>
                          <th className="text-right p-3 font-semibold">Taux</th>
                          <th className="text-right p-3 font-semibold">Temps Moyen</th>
                          <th className="text-center p-3 font-semibold">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((report) => {
                          const outstanding = report.totalFees - report.totalCollected;
                          const isExcellent = report.collectionRate >= 90;
                          const isGood = report.collectionRate >= 70;
                          const isPoor = report.collectionRate < 50;
                          
                          return (
                            <tr key={report.classId} className="border-b hover:bg-gray-50">
                              <td className="p-3 font-medium">{report.className}</td>
                              <td className="p-3 text-right">{report.totalStudents}</td>
                              <td className="p-3 text-right font-medium">{formatCurrency(report.totalFees)}</td>
                              <td className="p-3 text-right text-green-600">{formatCurrency(report.totalCollected)}</td>
                              <td className="p-3 text-right text-orange-600">{formatCurrency(outstanding)}</td>
                              <td className="p-3 text-right text-red-600">{report.studentsWithOverdue}</td>
                              <td className="p-3 text-right">
                                <span className={`font-medium ${isExcellent ? 'text-green-600' : isGood ? 'text-orange-600' : isPoor ? 'text-red-600' : 'text-gray-600'}`}>
                                  {report.collectionRate.toFixed(1)}%
                                </span>
                              </td>
                              <td className="p-3 text-right text-gray-600">
                                {report.averagePaymentTime ? `${Math.round(report.averagePaymentTime)}j` : "-"}
                              </td>
                              <td className="p-3 text-center">
                                {isExcellent ? (
                                  <Badge variant="default" className="bg-green-100 text-green-700">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Excellent
                                  </Badge>
                                ) : isGood ? (
                                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                                    <TrendingUp className="h-3 w-3 mr-1" />
                                    Bon
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    À Améliorer
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}

