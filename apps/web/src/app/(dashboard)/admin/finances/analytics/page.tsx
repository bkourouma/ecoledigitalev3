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
} from "@ecoledigitale/ui";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  Calendar,
  Users,
  DollarSign,
  AlertTriangle,
  Loader2,
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
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from "recharts";
import Link from "next/link";
import { useStudents } from "@/lib/hooks/use-students";
import { createApiHeaders } from "@/lib/api-utils";

const COLORS = ['#FF6B35', '#FFD23F', '#3B82F6', '#10B981', '#8B5CF6'];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to format month names in French
const formatMonth = (monthStr: string): string => {
  const [year, month] = monthStr.split('-');
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return monthNames[parseInt(month) - 1] || month;
};

export default function FinancialAnalyticsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("current_year");

  // Fetch active students count
  const { data: studentsData, isLoading: loadingStudents } = useStudents({ 
    status: 'active',
    limit: 1000 
  });
  const activeStudentsCount = studentsData?.data?.length || 0;

  // Fetch financial dashboard data
  const { data: dashboardData, isLoading: loadingDashboard, error: dashboardError } = useQuery({
    queryKey: ["financial-dashboard", selectedPeriod],
    queryFn: async () => {
      const periodMap: Record<string, string> = {
        current_year: "current_year",
        last_year: "last_year",
        custom: "current_year", // Default to current_year for custom
      };
      
      const response = await fetch(
        `${API_BASE_URL}/api/v1/financial-reports/dashboard?period=${periodMap[selectedPeriod] || "current_year"}`,
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
    enabled: true,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount || 0);
  };

  // Process dashboard data
  const summary = dashboardData?.data?.summary || {};
  const monthlyTrends = dashboardData?.data?.monthlyTrends || [];
  const paymentMethodAnalysis = dashboardData?.data?.paymentMethodAnalysis || [];
  const revenueByPaymentMethod = dashboardData?.data?.revenueByPaymentMethod || {};

  // Format monthly data for charts
  const monthlyData = useMemo(() => {
    return monthlyTrends.map((trend: any) => ({
      month: formatMonth(trend.month || trend.date || ''),
      revenue: parseFloat(trend.revenue || 0),
      transactions: parseInt(trend.transactions || 0),
    }));
  }, [monthlyTrends]);

  // Format payment method data for pie chart
  const paymentMethodData = useMemo(() => {
    const methods = Object.entries(revenueByPaymentMethod).map(([method, amount]: [string, any]) => {
      const methodNames: Record<string, string> = {
        orange_money: "Orange Money",
        mtn_money: "MTN Money",
        card: "Carte Bancaire",
        bank_transfer: "Virement",
        moov_money: "Moov Money",
      };
      
      return {
        name: methodNames[method] || method,
        value: parseFloat(amount || 0),
      };
    });

    // Calculate total for percentage
    const total = methods.reduce((sum, m) => sum + m.value, 0);
    
    return methods.map(m => ({
      ...m,
      percent: total > 0 ? (m.value / total) * 100 : 0,
    }));
  }, [revenueByPaymentMethod]);

  // Calculate metrics
  const collectionRate = summary.collectionRate || 0;
  const averageRevenue = summary.totalRevenue ? summary.totalRevenue / Math.max(monthlyData.length, 1) : 0;
  const overdueCount = summary.studentsWithOverdue || 0;

  // Calculate trends (simplified - comparing current month to previous)
  const currentMonthRevenue = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].revenue : 0;
  const previousMonthRevenue = monthlyData.length > 1 ? monthlyData[monthlyData.length - 2].revenue : 0;
  const revenueChange = previousMonthRevenue > 0 
    ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100 
    : 0;

  const isLoading = loadingDashboard || loadingStudents;

  if (dashboardError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Erreur lors du chargement des données: {dashboardError instanceof Error ? dashboardError.message : "Erreur inconnue"}
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
          <h1 className="text-3xl font-bold text-gray-900">Analyses Financières</h1>
          <p className="text-gray-600 mt-2">
            Analyses approfondies et tendances des paiements étudiants
          </p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current_year">Année en cours</SelectItem>
              <SelectItem value="last_year">Année précédente</SelectItem>
              <SelectItem value="custom">Période personnalisée</SelectItem>
            </SelectContent>
          </Select>
          <Link href="/admin/finances">
            <Button size="sm">
              Retour au Tableau de Bord
            </Button>
          </Link>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Chargement des données...</span>
        </div>
      ) : (
        <>
          {/* Key Metrics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="grid grid-cols-1 md:grid-cols-4 gap-6"
          >
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Taux de Collecte</p>
                    <p className="text-2xl font-bold text-green-600">
                      {collectionRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-green-600 flex items-center mt-1">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}% ce mois
                    </p>
                  </div>
                  <div className="p-3 bg-green-100 rounded-full">
                    <TrendingUp className="h-6 w-6 text-green-600" />
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
                      {formatCurrency(averageRevenue)}
                    </p>
                    <p className="text-xs text-blue-600 flex items-center mt-1">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}% ce mois
                    </p>
                  </div>
                  <div className="p-3 bg-blue-100 rounded-full">
                    <DollarSign className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Étudiants Actifs</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {activeStudentsCount}
                    </p>
                    <p className="text-xs text-purple-600 flex items-center mt-1">
                      <Users className="h-3 w-3 mr-1" />
                      Total actifs
                    </p>
                  </div>
                  <div className="p-3 bg-purple-100 rounded-full">
                    <Users className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Retards de Paiement</p>
                    <p className="text-2xl font-bold text-red-600">
                      {overdueCount}
                    </p>
                    <p className="text-xs text-red-600 flex items-center mt-1">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Étudiants en retard
                    </p>
                  </div>
                  <div className="p-3 bg-red-100 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trends */}
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
                Revenus mensuels vs objectifs (en millions XOF)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`} />
                    <Tooltip formatter={(value) => formatCurrency(value as number)} />
                    <Bar dataKey="revenue" fill="#3B82F6" name="Revenus" />
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
          transition={{ delay: 0.6, duration: 0.6 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="h-5 w-5" />
                Méthodes de Paiement
              </CardTitle>
              <CardDescription>
                Répartition des paiements par méthode
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

      {/* Student Growth Trend */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.6 }}
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
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="transactions" 
                    stroke="#10B981" 
                    strokeWidth={3}
                    name="Transactions"
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


        </>
      )}
    </div>
  );
}
