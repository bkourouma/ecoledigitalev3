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
  Badge,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  DollarSign,
  TrendingDown,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  FileText,
  Settings,
  Download,
  Plus,
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
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import Link from "next/link";
import { useStudents } from "@/lib/hooks/use-students";
import { createApiHeaders } from "@/lib/api-utils";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to format month names in French
const formatMonth = (monthStr: string): string => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return monthNames[parseInt(month) - 1] || month;
};

export default function AdminFinancesPage() {
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
      const response = await fetch(
        `${API_BASE_URL}/api/v1/financial-reports/dashboard?period=${selectedPeriod}`,
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

  // Fetch recent transactions
  const { data: recentTransactionsData, isLoading: loadingTransactions } = useQuery({
    queryKey: ["recent-transactions"],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/student-payments/recent?limit=10`,
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

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(dateObj);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "overdue":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // Process dashboard data
  const summary = dashboardData?.data?.summary || {};
  const revenueByFeeType = dashboardData?.data?.revenueByFeeType || {};
  const revenueByPaymentMethod = dashboardData?.data?.revenueByPaymentMethod || {};
  const monthlyTrends = dashboardData?.data?.monthlyTrends || [];

  // Format payment method data for pie chart
  const pieChartData = useMemo(() => {
    return Object.entries(revenueByPaymentMethod).map(([method, amount]) => ({
      name: method.replace('_', ' ').toUpperCase(),
      value: parseFloat(String(amount || 0)),
    }));
  }, [revenueByPaymentMethod]);

  // Format monthly revenue data
  const monthlyRevenueData = useMemo(() => {
    return monthlyTrends.map((trend: any) => ({
      month: formatMonth(trend.month || trend.date || ''),
      revenue: parseFloat(trend.revenue || 0),
      target: parseFloat(trend.target || trend.revenue || 0), // Use revenue as target if no target
    }));
  }, [monthlyTrends]);

  // Format fee type data
  const feeTypeData = useMemo(() => {
    return Object.entries(revenueByFeeType).map(([feeType, data]: [string, any]) => ({
      feeType,
      total: parseFloat(data?.total || data || 0),
      collected: parseFloat(data?.collected || data || 0),
      pending: parseFloat(data?.pending || 0),
    }));
  }, [revenueByFeeType]);

  // Format recent transactions
  const recentTransactions = useMemo(() => {
    return (recentTransactionsData?.data || []).map((tx: any) => ({
      id: tx.id,
      studentName: tx.studentName || tx.student_name || 'N/A',
      feeType: tx.feeType || tx.fee_type || 'N/A',
      amount: parseFloat(tx.amount || 0),
      status: tx.status || 'pending',
      createdAt: tx.createdAt || tx.created_at || tx.processedAt || tx.processed_at || new Date(),
    }));
  }, [recentTransactionsData]);

  const isLoading = loadingDashboard || loadingStudents || loadingTransactions;

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
          <h1 className="font-bold text-gray-900 whitespace-nowrap text-2xl leading-tight md:text-3xl">Gestion Financière</h1>
          <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
            Tableau de bord des paiements étudiants et revenus
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
              <SelectItem value="current_month">Mois en cours</SelectItem>
              <SelectItem value="last_month">Mois précédent</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
          <Link href="/admin/finances/tuition-schedules">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Gérer Échéanciers
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* Error Alert */}
      {dashboardError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Erreur lors du chargement des données: {dashboardError instanceof Error ? dashboardError.message : 'Erreur inconnue'}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Étudiants</p>
                {isLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-gray-900">
                    {summary.totalStudents || activeStudentsCount || 0}
                  </p>
                )}
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Revenus Totaux</p>
                {isLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(summary.totalRevenue || 0)}
                  </p>
                )}
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">En Attente</p>
                {isLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-orange-600">
                    {formatCurrency(summary.totalOutstanding || 0)}
                  </p>
                )}
              </div>
              <div className="p-3 bg-orange-100 rounded-full">
                <Clock className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">En Retard</p>
                {isLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-red-600">
                    {summary.studentsWithOverdue || 0}
                  </p>
                )}
              </div>
              <div className="p-3 bg-red-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Main Content Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
            <TabsTrigger value="analytics">Analyses</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="reports">Rapports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Revenue by Fee Type */}
              <Card>
                <CardHeader>
                  <CardTitle>Revenus par Type de Frais</CardTitle>
                  <CardDescription>Répartition des revenus collectés</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : feeTypeData.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">Aucune donnée disponible</p>
                  ) : (
                    <div className="space-y-4">
                      {feeTypeData.map((data) => {
                        const percentage = data.total > 0 ? (data.collected / data.total) * 100 : 0;
                        return (
                          <div key={data.feeType} className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="capitalize">{data.feeType}</span>
                              <span>{formatCurrency(data.collected)} / {formatCurrency(data.total)}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-600">
                              {percentage.toFixed(1)}% collecté
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Payment Methods Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Méthodes de Paiement</CardTitle>
                  <CardDescription>Répartition par méthode de paiement</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : pieChartData.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">Aucune donnée disponible</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={pieChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {pieChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(value as number)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Transactions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Transactions Récentes
                </CardTitle>
                <CardDescription>Dernières transactions de paiement</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : recentTransactions.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Aucune transaction récente</p>
                ) : (
                  <div className="space-y-4">
                    {recentTransactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-100 rounded-full">
                            <DollarSign className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium">{transaction.studentName}</p>
                            <p className="text-sm text-gray-600 capitalize">
                              {transaction.feeType} • {formatDate(transaction.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">{formatCurrency(transaction.amount)}</p>
                          <Badge variant="secondary" className={getStatusColor(transaction.status)}>
                            {transaction.status === "completed" ? "Complété" : transaction.status === "pending" ? "En attente" : transaction.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 text-center">
                  <Link href="/admin/finances/transactions">
                    <Button variant="outline">Voir toutes les transactions</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            {/* Monthly Revenue Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Évolution des Revenus</CardTitle>
                <CardDescription>Revenus mensuels vs objectifs</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : monthlyRevenueData.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Aucune donnée disponible</p>
                ) : (
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={monthlyRevenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => `${value / 1000000}M`} />
                      <Tooltip formatter={(value) => formatCurrency(value as number)} />
                      <Bar dataKey="revenue" fill="#3B82F6" name="Revenus" />
                      <Bar dataKey="target" fill="#E5E7EB" name="Objectif" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Gestion des Transactions</CardTitle>
                <CardDescription>
                  Consultez et gérez toutes les transactions de paiement
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-500 mb-4">Interface de gestion des transactions</p>
                  <Link href="/admin/finances/transactions">
                    <Button>Accéder aux Transactions</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Rapports Financiers</CardTitle>
                <CardDescription>
                  Générez des rapports détaillés sur les finances
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Download className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-500 mb-4">Fonctionnalité de rapports en développement</p>
                  <Button variant="outline" disabled>
                    Générer Rapport
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
