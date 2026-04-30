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
  Users,
  DollarSign,
  AlertTriangle,
  Loader2,
  Download,
  Filter,
  ArrowLeft,
  TrendingUp,
  CheckCircle2,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useClasses } from "@/lib/hooks/use-classes";
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

// Helper to format payment method names in French
const formatPaymentMethod = (method: string): string => {
  const methodNames: Record<string, string> = {
    orange_money: "Orange Money",
    mtn_money: "MTN Money",
    card: "Carte Bancaire",
    bank_transfer: "Virement",
    moov_money: "Moov Money",
    especes: "Espèces",
  };
  return methodNames[method] || method;
};

interface StudentReport {
  studentId: string;
  studentName: string;
  studentNumber: string;
  className?: string;
  totalFees: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueAmount: number;
  paymentHistory: Array<{
    date: Date;
    feeType: string;
    amount: number;
    paymentMethod: string;
  }>;
}

export default function StudentsReportPage() {
  const [filters, setFilters] = useState({
    academicYearId: "",
    classId: "",
    feeType: "",
    fromDate: "",
    toDate: "",
  });

  // Fetch academic years
  const { data: academicYearsData } = useAcademicYears({ limit: 100 });
  const academicYears = academicYearsData?.data || [];

  // Fetch classes (only if academicYearId is set)
  const { data: classesData } = useClasses(
    filters.academicYearId ? {
      academicYearId: filters.academicYearId,
      limit: 100, // API max limit is 100
    } : {}
  );
  const classes = filters.academicYearId ? (classesData?.data || []) : [];

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.academicYearId) params.append("academicYearId", filters.academicYearId);
    if (filters.classId) params.append("classId", filters.classId);
    if (filters.feeType) params.append("feeType", filters.feeType);
    if (filters.fromDate) params.append("fromDate", filters.fromDate);
    if (filters.toDate) params.append("toDate", filters.toDate);
    params.append("includeDetails", "true");
    return params.toString();
  }, [filters]);

  // Fetch student reports
  const { data: reportsData, isLoading, error } = useQuery({
    queryKey: ["student-reports", queryParams],
    queryFn: async () => {
      const url = `${API_BASE_URL}/api/v1/financial-reports/students${queryParams ? `?${queryParams}` : ""}`;
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

  const reports: StudentReport[] = reportsData?.data || [];

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters({
      academicYearId: "",
      classId: "",
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
        totalStudents: acc.totalStudents + 1,
        totalFees: acc.totalFees + report.totalFees,
        totalPaid: acc.totalPaid + report.totalPaid,
        totalOutstanding: acc.totalOutstanding + report.totalOutstanding,
        totalOverdue: acc.totalOverdue + report.overdueAmount,
        studentsWithOverdue: acc.studentsWithOverdue + (report.overdueAmount > 0 ? 1 : 0),
      }),
      {
        totalStudents: 0,
        totalFees: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        totalOverdue: 0,
        studentsWithOverdue: 0,
      }
    );
  }, [reports]);

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
          <h1 className="text-3xl font-bold text-gray-900">Rapport par Étudiant</h1>
          <p className="text-gray-600 mt-2">
            État des paiements de chaque étudiant
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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

              {/* Class Filter */}
              <div>
                <Label htmlFor="class">Classe</Label>
                <Select
                  value={filters.classId || "all"}
                  onValueChange={(value) => handleFilterChange("classId", value === "all" ? "" : value)}
                  disabled={!filters.academicYearId}
                >
                  <SelectTrigger id="class">
                    <SelectValue placeholder="Toutes les classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les classes</SelectItem>
                    {classes.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
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
            className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4"
          >
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Total Étudiants</p>
                <p className="text-2xl font-bold">{summary.totalStudents}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Total Frais</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.totalFees)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Total Payé</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalPaid)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">En Attente</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary.totalOutstanding)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">En Retard</p>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalOverdue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">Avec Retard</p>
                <p className="text-2xl font-bold text-red-600">{summary.studentsWithOverdue}</p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Students Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Détails par Étudiant</CardTitle>
                <CardDescription>
                  Vue détaillée des paiements pour chaque étudiant
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reports.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    Aucun étudiant trouvé avec les filtres sélectionnés
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3 font-semibold">Étudiant</th>
                          <th className="text-left p-3 font-semibold">Classe</th>
                          <th className="text-right p-3 font-semibold">Total Frais</th>
                          <th className="text-right p-3 font-semibold">Payé</th>
                          <th className="text-right p-3 font-semibold">En Attente</th>
                          <th className="text-right p-3 font-semibold">En Retard</th>
                          <th className="text-right p-3 font-semibold">Taux</th>
                          <th className="text-center p-3 font-semibold">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((report) => {
                          const rate = report.totalFees > 0 ? (report.totalPaid / report.totalFees) * 100 : 0;
                          const isOverdue = report.overdueAmount > 0;
                          const isComplete = report.totalOutstanding === 0 && report.totalFees > 0;
                          
                          return (
                            <tr key={report.studentId} className="border-b hover:bg-gray-50">
                              <td className="p-3">
                                <div>
                                  <div className="font-medium">{report.studentName}</div>
                                  <div className="text-sm text-gray-500">{report.studentNumber}</div>
                                </div>
                              </td>
                              <td className="p-3">{report.className || "-"}</td>
                              <td className="p-3 text-right font-medium">{formatCurrency(report.totalFees)}</td>
                              <td className="p-3 text-right text-green-600">{formatCurrency(report.totalPaid)}</td>
                              <td className="p-3 text-right text-orange-600">{formatCurrency(report.totalOutstanding)}</td>
                              <td className="p-3 text-right text-red-600">{formatCurrency(report.overdueAmount)}</td>
                              <td className="p-3 text-right">
                                <span className={`font-medium ${rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-orange-600' : 'text-red-600'}`}>
                                  {rate.toFixed(1)}%
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                {isComplete ? (
                                  <Badge variant="default" className="bg-green-100 text-green-700">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Complété
                                  </Badge>
                                ) : isOverdue ? (
                                  <Badge variant="destructive">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    En Retard
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">
                                    <Clock className="h-3 w-3 mr-1" />
                                    En Cours
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

