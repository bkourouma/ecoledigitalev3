"use client";

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  Eye,
  CreditCard,
  TrendingUp,
  FileText,
  Loader2,
  X
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
  Badge
} from "@ecoledigitale/ui";
import { useTeacherPayments, useCurrentTeacherId } from '@/lib/hooks/use-teachers';
import { useSimplePaymentPeriods } from '@/lib/hooks/use-payment-periods';

export default function TeacherPaymentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Fetch payment periods
  const { data: periodsData, isLoading: isLoadingPeriods } = useSimplePaymentPeriods();
  const periods = periodsData?.data || [];
  
  // Get current teacher ID
  const { data: teacherId, isLoading: isLoadingTeacherId } = useCurrentTeacherId();
  
  // Get selected period ID (not just 'all')
  const selectedPeriodId = selectedPeriod === 'all' ? undefined : selectedPeriod;
  
  // Fetch teacher payments
  const { data: paymentsData, isLoading: isLoadingPayments, error } = useTeacherPayments(teacherId || undefined, selectedPeriodId);

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

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span className="text-muted-foreground">Chargement...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  if (isLoadingPayments || isLoadingPeriods || isLoadingTeacherId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span className="text-muted-foreground">Chargement des paiements...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-red-400">Erreur lors du chargement</CardTitle>
            <CardDescription className="text-muted-foreground">{error.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Use real data from API - map API response to expected format
  const payments = (paymentsData?.data || []).map((p: any) => {
    const hourlyDetails = p.calculationDetails?.hourlyDetails || [];
    const totalHours = hourlyDetails.reduce((sum: number, detail: any) => (
      sum + Number(detail.hoursValidated || detail.hoursCount || 0)
    ), 0);
    const courses = Object.values(hourlyDetails.reduce((acc: Record<string, any>, detail: any) => {
      const key = detail.courseId || detail.courseName || 'course';
      if (!acc[key]) {
        acc[key] = {
          name: detail.courseName || 'Cours',
          hours: 0,
          amount: 0,
        };
      }
      acc[key].hours += Number(detail.hoursValidated || detail.hoursCount || 0);
      acc[key].amount += Number(detail.amount || 0);
      return acc;
    }, {}));

    return {
      id: p.id,
      teacherId: p.teacherId,
      periodId: p.paymentPeriodId,
      periodName: p.periodName,
      totalHours,
      grossAmount: p.baseAmount + (p.overtimeAmount || 0) + (p.bonusAmount || 0),
      baseAmount: p.baseAmount,
      overtimeAmount: p.overtimeAmount || 0,
      bonusAmount: p.bonusAmount || 0,
      deductions: p.deductions,
      netAmount: p.totalAmount,
      totalAmount: p.totalAmount,
      status: p.status,
      paymentDate: p.paidAt || p.approvedAt || p.calculatedAt,
      paymentMethod: 'Virement bancaire',
      reference: p.id,
      calculatedAt: p.calculatedAt,
      approvedAt: p.approvedAt,
      paidAt: p.paidAt,
      notes: p.notes,
      courses,
    };
  });

  // Calculate statistics
  const totalPaid = payments.filter((p: any) => p.status === 'paid').reduce((sum: number, p: any) => sum + (p.netAmount || 0), 0);
  const totalPending = payments.filter((p: any) => p.status === 'calculated' || p.status === 'approved').reduce((sum: number, p: any) => sum + (p.netAmount || 0), 0);
  const totalHours = payments.reduce((sum: number, p: any) => sum + (p.totalHours || 0), 0);
  const paidPaymentsCount = payments.filter((p: any) => p.status === 'paid').length;
  const averageMonthly = paidPaymentsCount > 0 ? totalPaid / paidPaymentsCount : 0;

  // Build periods list from API data
  const periodsList = [
    { value: 'all', label: 'Toutes les périodes' },
    ...periods.map((period) => ({
      value: period.id,
      label: period.name
    }))
  ];

  const statuses = [
    { value: 'all', label: 'Tous les statuts' },
    { value: 'paid', label: 'Payé' },
    { value: 'calculated', label: 'Calculé' },
    { value: 'approved', label: 'Approuvé' },
    { value: 'cancelled', label: 'Annulé' }
  ];

  const filteredPayments = payments.filter((payment: any) => {
    const matchesPeriod = selectedPeriod === 'all' || payment.periodId === selectedPeriod;
    // Map status for filtering: 'pending'/'processing' map to 'calculated'/'approved'
    const paymentStatus = payment.status === 'pending' ? 'calculated' : 
                         payment.status === 'processing' ? 'approved' : 
                         payment.status;
    const matchesStatus = selectedStatus === 'all' || paymentStatus === selectedStatus;
    return matchesPeriod && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
            Payé
          </Badge>
        );
      case 'pending':
      case 'calculated':
        return (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">
            Calculé
          </Badge>
        );
      case 'processing':
      case 'approved':
        return (
          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">
            Approuvé
          </Badge>
        );
      case 'cancelled':
        return <Badge variant="destructive">Annulé</Badge>;
      default:
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            Inconnu
          </Badge>
        );
    }
  };

  const formatAmount = (amount: number) => {
    return `${Math.round(amount)} FCFA`;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Non défini';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  // Fonctions pour les actions
  const handleShowDetails = (payment: any) => {
    setSelectedPayment(payment);
    setShowDetailsModal(true);
  };

  const handleDownloadStatement = async (payment: any) => {
    try {
      // Ouvrir le relevé dans un nouvel onglet
      const url = `/api/teacher-payments/${payment.id}/statement`;
      window.open(url, '_blank');
    } catch (error) {
      console.error('Erreur:', error);
      alert('Erreur lors de l\'ouverture du relevé');
    }
  };

  const handleDownloadPDF = async (payment: any) => {
    try {
      // Ouvrir le PDF détaillé dans un nouvel onglet
      const url = `/api/teacher-payments/${payment.id}/pdf`;
      window.open(url, '_blank');
    } catch (error) {
      console.error('Erreur:', error);
      alert('Erreur lors de l\'ouverture du PDF');
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <DollarSign className="w-8 h-8 text-purple-400 shrink-0" />
                Mes Paiements
              </h1>
              <p className="mt-2 text-muted-foreground">
                Consultez l'historique de vos paiements et rémunérations
              </p>
            </div>
            <Button
              variant="outline"
              className="flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Exporter</span>
            </Button>
          </div>
        </div>
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Payé</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-400">{formatAmount(totalPaid)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">En Attente</CardTitle>
              <Clock className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-400">{formatAmount(totalPending)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Heures</CardTitle>
              <Clock className="h-4 w-4 text-sky-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-sky-400">{totalHours}h</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Moyenne Mensuelle</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-400">{formatAmount(averageMonthly)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 gap-4">
              <CardTitle className="text-foreground">Historique des Paiements</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <Select
                  value={selectedPeriod}
                  onValueChange={(value) => setSelectedPeriod(value)}
                >
                  <SelectTrigger className="w-[200px] text-foreground">
                    <SelectValue placeholder="Toutes les périodes" />
                  </SelectTrigger>
                  <SelectContent>
                    {periodsList.map((period) => (
                      <SelectItem key={period.value} value={period.value}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => setSelectedStatus(value)}
                >
                  <SelectTrigger className="w-[180px] text-foreground">
                    <SelectValue placeholder="Tous les statuts" />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Payments List */}
        {filteredPayments.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <DollarSign className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">Aucun paiement trouvé</h3>
              <p className="text-muted-foreground">
                Aucun paiement ne correspond à vos critères de recherche.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredPayments.map((payment: any) => {
              return (
                <Card key={payment.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4 flex-wrap">
                          <h3 className="text-lg font-semibold text-foreground">
                            Paiement - {payment.periodName || `Période ${payment.periodId}`}
                          </h3>
                          {getStatusBadge(payment.status)}
                        </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{payment.totalHours || 0} heures</p>
                          <p className="text-xs text-muted-foreground">Total enseigné</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {payment.totalHours ? formatAmount(payment.grossAmount / payment.totalHours) : 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">Taux horaire moyen</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatDate(payment.paymentDate)}</p>
                          <p className="text-xs text-muted-foreground">Date de paiement</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{payment.paymentMethod || 'Virement bancaire'}</p>
                          <p className="text-xs text-muted-foreground">{payment.reference || 'Référence non définie'}</p>
                        </div>
                      </div>
                    </div>

                        {/* Payment Breakdown */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div className="rounded-lg border border-border bg-muted/40 p-4">
                            <p className="text-sm text-muted-foreground mb-1">Montant Brut</p>
                            <p className="text-lg font-semibold text-foreground">
                              {formatAmount(payment.grossAmount || payment.baseAmount || 0)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/40 p-4">
                            <p className="text-sm text-muted-foreground mb-1">Déductions</p>
                            <p className="text-lg font-semibold text-red-400">
                              -{formatAmount(payment.deductions || 0)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
                            <p className="text-sm text-purple-300 mb-1">Montant Net</p>
                            <p className="text-xl font-bold text-purple-400">
                              {formatAmount(payment.netAmount || payment.totalAmount || 0)}
                            </p>
                          </div>
                        </div>

                        {/* Course Breakdown */}
                        {payment.courses && payment.courses.length > 0 ? (
                          <div className="mt-4">
                            <h4 className="text-sm font-medium text-foreground mb-2">Répartition par cours :</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              {payment.courses.map((course: any, index: number) => (
                                <div key={index} className="flex justify-between items-center text-sm gap-2">
                                  <span className="text-muted-foreground">{course.name}</span>
                                  <span className="font-medium text-foreground shrink-0">
                                    {course.hours}h • {formatAmount(course.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4">
                            <h4 className="text-sm font-medium text-foreground mb-2">Détails du paiement :</h4>
                            <div className="text-sm text-muted-foreground">
                              <span>Paiement global pour {payment.totalHours || 0} heures d'enseignement</span>
                            </div>
                          </div>
                        )}
                      </div>

                        <div className="flex items-center space-x-2 ml-4">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleShowDetails(payment)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            Détails
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadStatement(payment)}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Relevé
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadPDF(payment)}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Fiche
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
      </div>

      {/* Modal des détails */}
      {showDetailsModal && selectedPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto border-border">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-2xl text-foreground">Détails du Paiement</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetailsModal(false)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Informations générales */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Informations Générales</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Période</label>
                      <p className="text-foreground">{selectedPayment.periodName || `Période ${selectedPayment.periodId}`}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Type de paiement</label>
                      <p className="text-foreground">
                        {selectedPayment.paymentType === 'mixed' ? 'Mixte' :
                         selectedPayment.paymentType === 'base' ? 'Base' :
                         selectedPayment.paymentType === 'overtime' ? 'Heures supplémentaires' : 'Standard'}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Statut</label>
                      <div className="mt-1">
                        {getStatusBadge(selectedPayment.status)}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Date de calcul</label>
                      <p className="text-foreground">{formatDate(selectedPayment.calculatedAt || selectedPayment.calculated_at)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Date de paiement</label>
                      <p className="text-foreground">{formatDate(selectedPayment.paymentDate || selectedPayment.paid_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Détails financiers */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Détails Financiers</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Montant de base</label>
                      <p className="text-foreground">{formatAmount(selectedPayment.baseAmount || selectedPayment.base_amount || 0)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Heures supplémentaires</label>
                      <p className="text-foreground">{formatAmount(selectedPayment.overtimeAmount || selectedPayment.overtime_amount || 0)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Bonus</label>
                      <p className="text-foreground">{formatAmount(selectedPayment.bonusAmount || selectedPayment.bonus_amount || 0)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Déductions</label>
                      <p className="text-red-400">-{formatAmount(selectedPayment.deductions || 0)}</p>
                    </div>
                    <div className="border-t border-border pt-3">
                      <label className="text-sm font-medium text-muted-foreground">Total Net</label>
                      <p className="text-xl font-bold text-purple-400">
                        {formatAmount(selectedPayment.netAmount || selectedPayment.totalAmount || selectedPayment.total_amount || 0)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedPayment.notes && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Notes</h3>
                  <p className="text-foreground bg-muted/50 border border-border p-4 rounded-lg">{selectedPayment.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => handleDownloadStatement(selectedPayment)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Voir le relevé
                </Button>
                <Button
                  onClick={() => handleDownloadPDF(selectedPayment)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Voir la fiche détaillée
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
