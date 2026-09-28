"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { 
  Award, 
  Users, 
  BookOpen,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  BarChart3,
  CheckCircle,
  FileText,
  Target,
  Activity,
  AlertCircle
} from 'lucide-react';
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
  Badge,
  Progress
} from "@ecoledigitale/ui";
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
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { useTeacherAssignments } from '@/lib/hooks/use-teachers';
import { useTeachingHours, useTeacherPayments } from '@/lib/hooks/use-teachers';
import { useTeacherClasses } from '@/lib/hooks/use-classes';

export default function PersonalStatsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [selectedPeriod, setSelectedPeriod] = useState('current');

  // Fetch data - All hooks must be called before any early returns
  const { data: classesData, isLoading: classesLoading } = useTeacherClasses();
  const { data: assignments = [], isLoading: assignmentsLoading } = useTeacherAssignments();
  const { data: hoursData, isLoading: hoursLoading } = useTeachingHours();
  const { data: paymentsData, isLoading: paymentsLoading } = useTeacherPayments();

  // Process data
  const classes = classesData?.data || [];
  const hours = hoursData?.data || [];
  const payments = paymentsData?.data || [];

  // Calculate statistics
  const stats = useMemo(() => {
    const totalClasses = classes.length;
    const totalCourses = new Set(assignments.map((a: any) => a.courseId)).size;
    const totalStudents = classes.reduce((sum: number, c: any) => sum + (c.studentCount || 0), 0);
    
    // Calculate total hours
    const totalHours = hours.reduce((sum: number, h: any) => sum + (h.duration || 0), 0);
    const validatedHours = hours.filter((h: any) => h.validated).reduce((sum: number, h: any) => sum + (h.duration || 0), 0);
    const validationRate = totalHours > 0 ? (validatedHours / totalHours) * 100 : 0;
    
    // Calculate payments
    const totalEarnings = payments.reduce((sum: number, p: any) => sum + (p.netAmount || 0), 0);
    const pendingPayments = payments.filter((p: any) => p.status === 'pending').reduce((sum: number, p: any) => sum + (p.netAmount || 0), 0);
    const paidPayments = payments.filter((p: any) => p.status === 'paid' || p.status === 'completed').reduce((sum: number, p: any) => sum + (p.netAmount || 0), 0);
    
    // Calculate assignments
    const totalAssignments = assignments.length;
    const pendingCorrections = assignments.filter((a: any) => a.status === 'pending' || a.status === 'submitted').length;
    const completedAssignments = assignments.filter((a: any) => a.status === 'completed' || a.status === 'graded').length;
    
    // Calculate completion rate
    const completionRate = totalAssignments > 0 
      ? (completedAssignments / totalAssignments) * 100 
      : 0;

    return {
      totalClasses,
      totalCourses,
      totalStudents,
      totalHours,
      validatedHours,
      validationRate,
      totalEarnings,
      pendingPayments,
      paidPayments,
      totalAssignments,
      pendingCorrections,
      completedAssignments,
      completionRate
    };
  }, [classes, assignments, hours, payments]);

  // Prepare chart data
  const hoursChartData = useMemo(() => {
    // Group hours by month
    const monthlyHours = hours.reduce((acc: any, h: any) => {
      if (!h.date) return acc;
      const month = new Date(h.date).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
      if (!acc[month]) {
        acc[month] = { month, total: 0, validated: 0 };
      }
      acc[month].total += h.duration || 0;
      if (h.validated) {
        acc[month].validated += h.duration || 0;
      }
      return acc;
    }, {});

    return Object.values(monthlyHours).slice(-6); // Last 6 months
  }, [hours]);

  const paymentsChartData = useMemo(() => {
    return payments.slice(-6).map((p: any) => ({
      period: p.periodName || 'Période',
      amount: p.netAmount || 0,
      status: p.status
    }));
  }, [payments]);

  const classesDistributionData = useMemo(() => {
    return classes.slice(0, 5).map((c: any) => ({
      name: c.name,
      students: c.studentCount || 0
    }));
  }, [classes]);

  const assignmentsPieData = useMemo(() => {
    return [
      { name: 'Complétés', value: stats.completedAssignments, color: '#10b981' },
      { name: 'En attente', value: stats.pendingCorrections, color: '#f59e0b' },
      { name: 'Autres', value: stats.totalAssignments - stats.completedAssignments - stats.pendingCorrections, color: '#6b7280' }
    ].filter(item => item.value > 0);
  }, [stats]);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading' || classesLoading || assignmentsLoading || hoursLoading || paymentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatHours = (hours: number) => {
    return `${hours.toFixed(1)}h`;
  };

  const getTrendIcon = (value: number, threshold: number = 0) => {
    if (value > threshold) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (value < threshold) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Activity className="h-4 w-4 text-gray-600" />;
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold text-gray-900 flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <Award className="h-8 w-8 text-purple-600" />
            Mes Statistiques
          </h1>
          <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">Vue d'ensemble de votre activité d'enseignement</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Période" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Période actuelle</SelectItem>
              <SelectItem value="last">Dernière période</SelectItem>
              <SelectItem value="year">Cette année</SelectItem>
              <SelectItem value="all">Toutes les périodes</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Exporter
          </Button>
        </div>
      </div>

      {/* Main Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Classes</CardTitle>
            <div className="p-2 bg-blue-100 rounded-lg">
              <BookOpen className="h-6 w-6 text-blue-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{stats.totalClasses}</div>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              {stats.totalCourses} cours différents
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Étudiants</CardTitle>
            <div className="p-2 bg-green-100 rounded-lg">
              <Users className="h-6 w-6 text-green-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{stats.totalStudents}</div>
            <p className="text-xs text-gray-500 mt-1">Étudiants suivis</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Heures Enseignées</CardTitle>
            <div className="p-2 bg-purple-100 rounded-lg">
              <Clock className="h-6 w-6 text-purple-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{formatHours(stats.totalHours)}</div>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              {formatHours(stats.validatedHours)} validées ({stats.validationRate.toFixed(0)}%)
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Revenus</CardTitle>
            <div className="p-2 bg-yellow-100 rounded-lg">
              <DollarSign className="h-6 w-6 text-yellow-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{formatCurrency(stats.totalEarnings)}</div>
            <p className="text-xs text-gray-500 mt-1">
              {formatCurrency(stats.pendingPayments)} en attente
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Évolution des Heures Enseignées
            </CardTitle>
            <CardDescription>Heures totales et validées par mois</CardDescription>
          </CardHeader>
          <CardContent>
            {hoursChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hoursChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="total" fill="#8b5cf6" name="Total" />
                  <Bar dataKey="validated" fill="#10b981" name="Validées" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                Aucune donnée disponible
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Évolution des Revenus
            </CardTitle>
            <CardDescription>Paiements par période</CardDescription>
          </CardHeader>
          <CardContent>
            {paymentsChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={paymentsChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(value: any) => formatCurrency(value)} />
                  <Line type="monotone" dataKey="amount" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                Aucune donnée disponible
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Secondary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Devoirs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">Total</span>
                </div>
                <span className="font-bold text-lg">{stats.totalAssignments}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm">Complétés</span>
                </div>
                <span className="font-bold text-green-600">{stats.completedAssignments}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm">En attente</span>
                </div>
                <span className="font-bold text-yellow-600">{stats.pendingCorrections}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Taux de complétion</span>
                  <span className="font-bold">{stats.completionRate.toFixed(1)}%</span>
                </div>
                <Progress value={stats.completionRate} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Activité Récente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Heures totales</span>
                <span className="font-bold text-lg">{formatHours(stats.totalHours)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Heures validées</span>
                <div className="flex items-center gap-1">
                  {getTrendIcon(stats.validationRate, 80)}
                  <span className="font-bold text-green-600">{formatHours(stats.validatedHours)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Heures en attente</span>
                <span className="font-bold text-yellow-600">
                  {formatHours(stats.totalHours - stats.validatedHours)}
                </span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Taux de validation</span>
                  <span className="font-bold">{stats.validationRate.toFixed(1)}%</span>
                </div>
                <Progress value={stats.validationRate} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5" />
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Paiements reçus</span>
                <div className="flex items-center gap-1">
                  {getTrendIcon(stats.paidPayments, 0)}
                  <span className="font-bold text-green-600">{formatCurrency(stats.paidPayments)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Paiements en attente</span>
                <span className="font-bold text-yellow-600">{formatCurrency(stats.pendingPayments)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Total des revenus</span>
                <span className="font-bold text-lg">{formatCurrency(stats.totalEarnings)}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Taux de paiement</span>
                  <span className="font-bold">
                    {stats.totalEarnings > 0 
                      ? ((stats.paidPayments / stats.totalEarnings) * 100).toFixed(1) 
                      : 0}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Répartition par Classe
            </CardTitle>
            <CardDescription>Nombre d'étudiants par classe</CardDescription>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>Aucune classe</p>
              </div>
            ) : (
              <div className="space-y-3">
                {classes.slice(0, 5).map((classItem: any) => (
                  <div key={classItem.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div>
                      <div className="font-medium text-gray-900">{classItem.name}</div>
                      <div className="text-sm text-gray-500">{classItem.code}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg text-gray-900">{classItem.studentCount || 0}</div>
                      <div className="text-xs text-gray-500">étudiants</div>
                    </div>
                  </div>
                ))}
                {classes.length > 5 && (
                  <div className="text-center pt-2 text-sm text-gray-500">
                    +{classes.length - 5} autre{classes.length - 5 > 1 ? 's' : ''} classe{classes.length - 5 > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Paiements
            </CardTitle>
            <CardDescription>Détails des paiements récents</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <DollarSign className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>Aucun paiement</p>
              </div>
            ) : (
              <div className="space-y-3">
                {payments.slice(0, 5).map((payment: any) => (
                  <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div>
                      <div className="font-medium text-gray-900">{payment.periodName || 'Période'}</div>
                      <div className="text-sm text-gray-500">
                        {payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString('fr-FR') : 'En attente'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg text-gray-900">{formatCurrency(payment.netAmount || 0)}</div>
                      <Badge 
                        variant={payment.status === 'paid' || payment.status === 'completed' ? 'default' : 'secondary'}
                        className={payment.status === 'paid' || payment.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                      >
                        {payment.status === 'paid' || payment.status === 'completed' ? 'Payé' : 'En attente'}
                      </Badge>
                    </div>
                  </div>
                ))}
                {payments.length > 5 && (
                  <div className="text-center pt-2 text-sm text-gray-500">
                    +{payments.length - 5} autre{payments.length - 5 > 1 ? 's' : ''} paiement{payments.length - 5 > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

