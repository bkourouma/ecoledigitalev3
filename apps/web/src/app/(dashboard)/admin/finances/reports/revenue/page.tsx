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
} from "@ecoledigitale/ui";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Loader2,
  Download,
  Filter,
  ArrowLeft,
  BarChart3,
  PieChart,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import Link from "next/link";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useClasses } from "@/lib/hooks/use-classes";
import { createApiHeaders } from "@/lib/api-utils";

const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444'];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to format month names in French
const formatMonth = (monthStr: string): string => {
  const [year, month] = monthStr.split('-');
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${monthNames[parseInt(month) - 1] || month} ${year}`;
};

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

export default function RevenueReportPage() {
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
    return params.toString();
  }, [filters]);

  // Fetch revenue report
  const { data: reportData, isLoading, error } = useQuery({
    queryKey: ["revenue-report", queryParams],
    queryFn: async () => {
      const url = `${API_BASE_URL}/api/v1/financial-reports/revenue${queryParams ? `?${queryParams}` : ""}`;
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

  const report = reportData?.data || {};
  const {
    totalRevenue = 0,
    totalOutstanding = 0,
    collectionRate = 0,
    byFeeType = {},
    byPaymentMethod = {},
    monthlyTrends = [],
  } = report;

  // Format fee type data for charts
  const feeTypeData = useMemo(() => {
    return Object.entries(byFeeType).map(([feeType, data]: [string, any]) => ({
      name: formatFeeType(feeType),
      collected: parseFloat(data.collected || 0),
      pending: parseFloat(data.pending || 0),
      overdue: parseFloat(data.overdue || 0),
      total: parseFloat(data.total || 0),
    }));
  }, [byFeeType]);

  // Format payment method data for pie chart
  const paymentMethodData = useMemo(() => {
    const methods = Object.entries(byPaymentMethod).map(([method, amount]: [string, any]) => {
      const methodNames: Record<string, string> = {
        orange_money: "Orange Money",
        mtn_money: "MTN Money",
        card: "Carte Bancaire",
        bank_transfer: "Virement",
        moov_money: "Moov Money",
        cash: "Espèces",
      };
      
      return {
        name: methodNames[method] || method,
        value: parseFloat(amount || 0),
      };
    });

    const total = methods.reduce((sum, m) => sum + m.value, 0);
    
    return methods.map(m => ({
      ...m,
      percent: total > 0 ? (m.value / total) * 100 : 0,
    }));
  }, [byPaymentMethod]);

  // Format monthly trends
  const monthlyData = useMemo(() => {
    return monthlyTrends.map((trend: any) => ({
      month: formatMonth(trend.month || trend.date || ''),
      revenue: parseFloat(trend.revenue || 0),
      transactions: parseInt(trend.transactions || 0),
    }));
  }, [monthlyTrends]);

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
    try {
      // Create CSV content
      let csvContent = "";
      
      // Add BOM for proper UTF-8 encoding in Excel
      const BOM = '\uFEFF';
      
      // Header section
      csvContent += "RAPPORT DE REVENUS\n";
      csvContent += `Date d'export: ${new Date().toLocaleDateString("fr-FR")}\n`;
      csvContent += "\n";
      
      // Key Metrics
      csvContent += "MÉTRIQUES CLÉS\n";
      csvContent += "Revenus Totaux," + totalRevenue + "\n";
      csvContent += "En Attente," + totalOutstanding + "\n";
      csvContent += "Taux de Collecte," + collectionRate.toFixed(2) + "%\n";
      csvContent += "\n";
      
      // Revenue by Fee Type
      if (feeTypeData.length > 0) {
        csvContent += "REVENUS PAR TYPE DE FRAIS\n";
        csvContent += "Type de Frais,Total,Collecté,En Attente,En Retard,Taux de Collecte (%)\n";
        feeTypeData.forEach((item) => {
          const rate = item.total > 0 ? (item.collected / item.total) * 100 : 0;
          csvContent += `"${item.name}",${item.total},${item.collected},${item.pending},${item.overdue},${rate.toFixed(2)}\n`;
        });
        csvContent += "\n";
      }
      
      // Payment Methods
      if (paymentMethodData.length > 0) {
        csvContent += "MÉTHODES DE PAIEMENT\n";
        csvContent += "Méthode,Montant,Pourcentage\n";
        paymentMethodData.forEach((item) => {
          csvContent += `"${item.name}",${item.value},${item.percent.toFixed(2)}%\n`;
        });
        csvContent += "\n";
      }
      
      // Monthly Trends
      if (monthlyData.length > 0) {
        csvContent += "ÉVOLUTION MENSUELLE\n";
        csvContent += "Mois,Revenus,Transactions\n";
        monthlyData.forEach((item) => {
          csvContent += `"${item.month}",${item.revenue},${item.transactions}\n`;
        });
      }
      
      // Create and download CSV file
      const csvWithBOM = BOM + csvContent;
      const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `rapport-revenus-${dateStr}.csv`;
      
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
      alert("Erreur lors de l'export du rapport");
    }
  };

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
          <h1 className="text-3xl font-bold text-gray-900">Rapport de Revenus</h1>
          <p className="text-gray-600 mt-2">
            Analyse détaillée des revenus par type de frais
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
          {/* Key Metrics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Revenus Totaux</p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(totalRevenue)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Paiements complétés
                    </p>
                  </div>
                  <div className="p-3 bg-green-100 rounded-full">
                    <DollarSign className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">En Attente</p>
                    <p className="text-2xl font-bold text-orange-600">
                      {formatCurrency(totalOutstanding)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Paiements en attente
                    </p>
                  </div>
                  <div className="p-3 bg-orange-100 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Taux de Collecte</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {collectionRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Taux de recouvrement
                    </p>
                  </div>
                  <div className="p-3 bg-blue-100 rounded-full">
                    <TrendingUp className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue by Fee Type */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Revenus par Type de Frais
                  </CardTitle>
                  <CardDescription>
                    Répartition des revenus collectés, en attente et en retard
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {feeTypeData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={feeTypeData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`} />
                        <Tooltip formatter={(value) => formatCurrency(value as number)} />
                        <Bar dataKey="collected" fill="#10B981" name="Collecté" stackId="a" />
                        <Bar dataKey="pending" fill="#F59E0B" name="En Attente" stackId="a" />
                        <Bar dataKey="overdue" fill="#EF4444" name="En Retard" stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      Aucune donnée disponible
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Payment Methods Distribution */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    Méthodes de Paiement
                  </CardTitle>
                  <CardDescription>
                    Répartition des revenus par méthode de paiement
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {paymentMethodData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <RechartsPieChart>
                        <Pie
                          data={paymentMethodData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {paymentMethodData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      Aucune donnée disponible
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Monthly Trends */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Évolution Mensuelle
                </CardTitle>
                <CardDescription>
                  Tendances des revenus et transactions sur les 12 derniers mois
                </CardDescription>
              </CardHeader>
              <CardContent>
                {monthlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`} />
                      <Tooltip formatter={(value) => formatCurrency(value as number)} />
                      <Line 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#3B82F6" 
                        strokeWidth={3}
                        name="Revenus"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500">
                    Aucune donnée disponible
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Fee Type Details Table */}
          {/* {feeTypeData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Détails par Type de Frais</CardTitle>
                  <CardDescription>
                    Vue détaillée des revenus par type de frais
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3 font-semibold">Type de Frais</th>
                          <th className="text-right p-3 font-semibold">Total</th>
                          <th className="text-right p-3 font-semibold">Collecté</th>
                          <th className="text-right p-3 font-semibold">En Attente</th>
                          <th className="text-right p-3 font-semibold">En Retard</th>
                          <th className="text-right p-3 font-semibold">Taux</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeTypeData.map((item, index) => {
                          const rate = item.total > 0 ? (item.collected / item.total) * 100 : 0;
                          return (
                            <tr key={index} className="border-b hover:bg-gray-50">
                              <td className="p-3">{item.name}</td>
                              <td className="p-3 text-right font-medium">{formatCurrency(item.total)}</td>
                              <td className="p-3 text-right text-green-600">{formatCurrency(item.collected)}</td>
                              <td className="p-3 text-right text-orange-600">{formatCurrency(item.pending)}</td>
                              <td className="p-3 text-right text-red-600">{formatCurrency(item.overdue)}</td>
                              <td className="p-3 text-right">
                                <span className={`font-medium ${rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-orange-600' : 'text-red-600'}`}>
                                  {rate.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )} */}
        </>
      )}
    </div>
  );
}

