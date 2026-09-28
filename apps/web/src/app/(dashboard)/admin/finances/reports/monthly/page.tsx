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
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Loader2,
  Download,
  Filter,
  ArrowLeft,
  BarChart3,
  DollarSign,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";
import Link from "next/link";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useClasses } from "@/lib/hooks/use-classes";
import { createApiHeaders } from "@/lib/api-utils";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to format month names in French
const formatMonth = (monthStr: string): string => {
  const [year, month] = monthStr.split('-');
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${monthNames[parseInt(month) - 1] || month} ${year}`;
};

// Helper to format month short names
const formatMonthShort = (monthStr: string): string => {
  const [year, month] = monthStr.split('-');
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${monthNames[parseInt(month) - 1] || month} ${year}`;
};

export default function MonthlyReportPage() {
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
      limit: 100,
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

  // Fetch revenue report (which includes monthly trends)
  const { data: reportData, isLoading, error } = useQuery({
    queryKey: ["monthly-report", queryParams],
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
  const monthlyTrends = report.monthlyTrends || [];

  // Format monthly data for charts
  const monthlyData = useMemo(() => {
    return monthlyTrends.map((trend: any) => ({
      month: formatMonthShort(trend.month || trend.date || ''),
      monthFull: formatMonth(trend.month || trend.date || ''),
      revenue: parseFloat(trend.revenue || 0),
      transactions: parseInt(trend.transactions || 0),
    }));
  }, [monthlyTrends]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (monthlyData.length === 0) {
      return {
        totalRevenue: 0,
        totalTransactions: 0,
        averageRevenue: 0,
        averageTransactions: 0,
        growthRate: 0,
        bestMonth: null,
        worstMonth: null,
      };
    }

    const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
    const totalTransactions = monthlyData.reduce((sum, m) => sum + m.transactions, 0);
    const averageRevenue = totalRevenue / monthlyData.length;
    const averageTransactions = totalTransactions / monthlyData.length;

    // Calculate growth rate (comparing last month to first month)
    const firstMonth = monthlyData[0]?.revenue || 0;
    const lastMonth = monthlyData[monthlyData.length - 1]?.revenue || 0;
    const growthRate = firstMonth > 0 ? ((lastMonth - firstMonth) / firstMonth) * 100 : 0;

    // Find best and worst months
    const bestMonth = monthlyData.reduce((best, current) => 
      current.revenue > best.revenue ? current : best, monthlyData[0]
    );
    const worstMonth = monthlyData.reduce((worst, current) => 
      current.revenue < worst.revenue ? current : worst, monthlyData[0]
    );

    return {
      totalRevenue,
      totalTransactions,
      averageRevenue,
      averageTransactions,
      growthRate,
      bestMonth,
      worstMonth,
    };
  }, [monthlyData]);

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
        className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3"
      >
        <div>
          <h1 className="font-bold text-gray-900 whitespace-nowrap text-2xl leading-tight md:text-3xl">Rapport Mensuel</h1>
          <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
            Évolution des paiements par mois
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
          {/* Statistics Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Revenus Totaux</p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(stats.totalRevenue)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Sur {monthlyData.length} mois
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
                    <p className="text-sm font-medium text-muted-foreground">Revenus Moyens</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {formatCurrency(stats.averageRevenue)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Par mois
                    </p>
                  </div>
                  <div className="p-3 bg-blue-100 rounded-full">
                    <TrendingUp className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Taux de Croissance</p>
                    <p className={`text-2xl font-bold ${stats.growthRate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stats.growthRate >= 0 ? '+' : ''}{stats.growthRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Premier vs dernier mois
                    </p>
                  </div>
                  <div className={`p-3 rounded-full ${stats.growthRate >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                    {stats.growthRate >= 0 ? (
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    ) : (
                      <TrendingDown className="h-6 w-6 text-red-600" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Transactions</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {stats.totalTransactions.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Moyenne: {Math.round(stats.averageTransactions)}/mois
                    </p>
                  </div>
                  <div className="p-3 bg-purple-100 rounded-full">
                    <BarChart3 className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Trend - Area Chart */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Évolution des Revenus
                  </CardTitle>
                  <CardDescription>
                    Tendances des revenus mensuels
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {monthlyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={monthlyData}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`} />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          labelFormatter={(label) => `Mois: ${label}`}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="revenue" 
                          stroke="#10B981" 
                          fillOpacity={1}
                          fill="url(#colorRevenue)"
                          name="Revenus"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      Aucune donnée disponible
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Transactions Trend - Bar Chart */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Évolution des Transactions
                  </CardTitle>
                  <CardDescription>
                    Nombre de transactions par mois
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {monthlyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={monthlyData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="transactions" fill="#3B82F6" name="Transactions" />
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
          </div>

          {/* Monthly Details Table */}
          {monthlyData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Détails Mensuels</CardTitle>
                  <CardDescription>
                    Vue détaillée des revenus et transactions par mois
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3 font-semibold">Mois</th>
                          <th className="text-right p-3 font-semibold">Revenus</th>
                          <th className="text-right p-3 font-semibold">Transactions</th>
                          <th className="text-right p-3 font-semibold">Moyenne par Transaction</th>
                          <th className="text-right p-3 font-semibold">Évolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyData.map((month, index) => {
                          const previousMonth = index > 0 ? monthlyData[index - 1] : null;
                          const change = previousMonth 
                            ? ((month.revenue - previousMonth.revenue) / previousMonth.revenue) * 100 
                            : 0;
                          const avgPerTransaction = month.transactions > 0 
                            ? month.revenue / month.transactions 
                            : 0;

                          return (
                            <tr key={month.month} className="border-b hover:bg-gray-50">
                              <td className="p-3 font-medium">{month.monthFull}</td>
                              <td className="p-3 text-right font-medium">{formatCurrency(month.revenue)}</td>
                              <td className="p-3 text-right">{month.transactions.toLocaleString()}</td>
                              <td className="p-3 text-right text-gray-600">{formatCurrency(avgPerTransaction)}</td>
                              <td className="p-3 text-right">
                                {previousMonth && (
                                  <span className={`font-medium ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                                  </span>
                                )}
                                {!previousMonth && <span className="text-gray-400">-</span>}
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
          )}

          {/* Best/Worst Months */}
          {stats.bestMonth && stats.worstMonth && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.6 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-700">
                    <TrendingUp className="h-5 w-5" />
                    Meilleur Mois
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-2xl font-bold text-green-700">{stats.bestMonth.monthFull}</p>
                    <p className="text-lg text-green-600">{formatCurrency(stats.bestMonth.revenue)}</p>
                    <p className="text-sm text-gray-600">{stats.bestMonth.transactions} transactions</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-red-200 bg-red-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-700">
                    <TrendingDown className="h-5 w-5" />
                    Mois le Plus Faible
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-2xl font-bold text-red-700">{stats.worstMonth.monthFull}</p>
                    <p className="text-lg text-red-600">{formatCurrency(stats.worstMonth.revenue)}</p>
                    <p className="text-sm text-gray-600">{stats.worstMonth.transactions} transactions</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

