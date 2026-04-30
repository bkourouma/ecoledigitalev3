"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { useToast } from "@/components/ui/use-toast";
import {
  CreditCard,
  CheckCircle,
  Clock,
  DollarSign,
  Filter,
  Search,
  Calendar,
  FileSpreadsheet,
  FileText,
  Download,
  Loader2,
  Users
} from "lucide-react";
import type { PaymentExportData } from "@/lib/utils/payment-export";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { createApiHeaders } from "@/lib/api-utils";

interface Payment {
  id: string;
  teacher_name: string;
  teacher_email: string;
  period_name: string;
  payment_type: string;
  base_amount: string;
  overtime_amount: string;
  bonus_amount: string;
  deductions: string;
  total_amount: string;
  currency: string;
  status: 'calculated' | 'approved' | 'paid' | 'cancelled';
  calculated_at: string;
  approved_at?: string;
  paid_at?: string;
}

interface ConsolidatedPayment {
  teacher_name: string;
  teacher_email: string;
  total_base_amount: number;
  total_overtime_amount: number;
  total_bonus_amount: number;
  total_deductions: number;
  total_amount: number;
  payment_count: number;
  periods: string[];
  payment_types: string[];
  statuses: {
    calculated: number;
    approved: number;
    paid: number;
    cancelled: number;
  };
  latest_payment_date: string;
  earliest_payment_date: string;
  individual_payments: Payment[];
}

const statusConfig = {
  calculated: { label: 'Calculé', color: 'bg-blue-100 text-blue-800', icon: Clock },
  approved: { label: 'Approuvé', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  paid: { label: 'Payé', color: 'bg-gray-100 text-gray-800', icon: DollarSign },
  cancelled: { label: 'Annulé', color: 'bg-red-100 text-red-800', icon: Clock },
};

export default function PaymentManagePage() {
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [viewMode, setViewMode] = useState<'consolidated' | 'detailed'>('consolidated');
  const { toast } = useToast();

  // Consolidate payments by teacher
  const consolidatePaymentsByTeacher = (payments: Payment[]): ConsolidatedPayment[] => {
    const teacherMap = new Map<string, ConsolidatedPayment>();

    payments.forEach(payment => {
      const key = payment.teacher_email; // Use email as unique identifier

      if (!teacherMap.has(key)) {
        teacherMap.set(key, {
          teacher_name: payment.teacher_name,
          teacher_email: payment.teacher_email,
          total_base_amount: 0,
          total_overtime_amount: 0,
          total_bonus_amount: 0,
          total_deductions: 0,
          total_amount: 0,
          payment_count: 0,
          periods: [],
          payment_types: [],
          statuses: {
            calculated: 0,
            approved: 0,
            paid: 0,
            cancelled: 0
          },
          latest_payment_date: payment.calculated_at,
          earliest_payment_date: payment.calculated_at,
          individual_payments: []
        });
      }

      const consolidated = teacherMap.get(key)!;

      // Aggregate amounts
      consolidated.total_base_amount += parseFloat(payment.base_amount);
      consolidated.total_overtime_amount += parseFloat(payment.overtime_amount);
      consolidated.total_bonus_amount += parseFloat(payment.bonus_amount);
      consolidated.total_deductions += parseFloat(payment.deductions);
      consolidated.total_amount += parseFloat(payment.total_amount);
      consolidated.payment_count += 1;

      // Collect unique periods and payment types
      if (!consolidated.periods.includes(payment.period_name)) {
        consolidated.periods.push(payment.period_name);
      }
      if (!consolidated.payment_types.includes(payment.payment_type)) {
        consolidated.payment_types.push(payment.payment_type);
      }

      // Count statuses
      consolidated.statuses[payment.status] += 1;

      // Track date range
      if (new Date(payment.calculated_at) > new Date(consolidated.latest_payment_date)) {
        consolidated.latest_payment_date = payment.calculated_at;
      }
      if (new Date(payment.calculated_at) < new Date(consolidated.earliest_payment_date)) {
        consolidated.earliest_payment_date = payment.calculated_at;
      }

      // Store individual payment for details
      consolidated.individual_payments.push(payment);
    });

    return Array.from(teacherMap.values()).sort((a, b) =>
      a.teacher_name.localeCompare(b.teacher_name)
    );
  };

  useEffect(() => {
    fetchPayments();
  }, [activeAcademicYearId]);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/payment-reports/list', {
        headers: createApiHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setPayments(data.data || []);
      } else {
        toast({
          title: "Erreur",
          description: "Impossible de charger les paiements",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (paymentId: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/v1/payment-reports/${paymentId}/status`, {
        method: 'PATCH',
        headers: createApiHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        toast({
          title: "Succès",
          description: `Paiement ${newStatus === 'approved' ? 'approuvé' : 'marqué comme payé'}`,
        });
        fetchPayments();
      } else {
        const error = await response.json();
        toast({
          title: "Erreur",
          description: error.message || "Impossible de changer le statut",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    }
  };

  const handleBulkStatusChangeForTeacher = async (
    teacherEmail: string,
    fromStatus: 'calculated' | 'approved',
    toStatus: 'approved' | 'paid'
  ) => {
    try {
      const targetPayments = payments.filter(
        (p) => p.teacher_email === teacherEmail && p.status === fromStatus
      );

      if (targetPayments.length === 0) return;

      const responses = await Promise.all(
        targetPayments.map((p) =>
          fetch(`/api/v1/payment-reports/${p.id}/status`, {
            method: 'PATCH',
            headers: createApiHeaders(),
            body: JSON.stringify({ status: toStatus }),
          })
        )
      );

      if (responses.some((r) => !r.ok)) {
        throw new Error("Bulk status update failed");
      }

      toast({
        title: "Succès",
        description:
          toStatus === 'approved'
            ? `${targetPayments.length} paiement(s) approuvé(s)`
            : `${targetPayments.length} paiement(s) marqué(s) comme payé(s)`,
      });
      fetchPayments();
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour les paiements",
        variant: "destructive",
      });
    }
  };

  const handleExportToExcel = async () => {
    setIsExporting(true);
    try {
      const { exportPaymentsToExcel } = await import("@/lib/utils/payment-export");
      const exportData: PaymentExportData = {
        payments: filteredPayments,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredPayments.length
      };
      exportPaymentsToExcel(exportData);
      toast({
        title: "Export réussi",
        description: `${filteredPayments.length} paiements exportés en Excel`,
      });
    } catch (error) {
      console.error("Failed to export to Excel:", error);
      toast({
        title: "Erreur d'export",
        description: "Impossible d'exporter les données en Excel",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportToWord = async () => {
    setIsExporting(true);
    try {
      const { exportPaymentsToWord } = await import("@/lib/utils/payment-export");
      const exportData: PaymentExportData = {
        payments: filteredPayments,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredPayments.length
      };
      exportPaymentsToWord(exportData);
      toast({
        title: "Export réussi",
        description: `${filteredPayments.length} paiements exportés en Word`,
      });
    } catch (error) {
      console.error("Failed to export to Word:", error);
      toast({
        title: "Erreur d'export",
        description: "Impossible d'exporter les données en Word",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Get consolidated payments
  const consolidatedPayments = consolidatePaymentsByTeacher(payments);

  // Filter consolidated payments based on search and status
  const filteredConsolidatedPayments = consolidatedPayments.filter(consolidated => {
    const matchesSearch = searchTerm === '' ||
      consolidated.teacher_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      consolidated.teacher_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      consolidated.periods.some(period => period.toLowerCase().includes(searchTerm.toLowerCase()));

    // For status filtering, check if teacher has any payments with the selected status
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'calculated' && consolidated.statuses.calculated > 0) ||
      (statusFilter === 'approved' && consolidated.statuses.approved > 0) ||
      (statusFilter === 'paid' && consolidated.statuses.paid > 0) ||
      (statusFilter === 'cancelled' && consolidated.statuses.cancelled > 0);

    return matchesSearch && matchesStatus;
  });

  // Also keep the original filtered payments for export and stats
  const filteredPayments = payments.filter(payment => {
    const teacherName = payment.teacher_name || '';
    const periodName = payment.period_name || '';
    const matchesSearch = teacherName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         periodName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || payment.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formatCurrency = (amount: string, currency: string = 'XOF') => {
    const numAmount = parseFloat(amount) || 0;
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount) + ' FCFA';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Clock className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Chargement des paiements...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestion des Paiements</h1>
          <p className="text-white">Approuvez et suivez les paiements des enseignants</p>
        </div>
        <div className="flex gap-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleExportToExcel}
              disabled={isExporting || filteredPayments.length === 0}
              className="bg-green-50 border-green-200 hover:bg-green-100 text-green-700 hover:text-green-800 shadow-sm"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 mr-2" />
              )}
              Exporter Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportToWord}
              disabled={isExporting || filteredPayments.length === 0}
              className="bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700 hover:text-blue-800 shadow-sm"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Exporter Word
            </Button>
          </div>
        </div>
      </div>

      {/* Payment Statistics Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Payments */}
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600">Total Paiements</p>
                <p className="text-3xl font-bold text-blue-900">{filteredPayments.length}</p>
                <p className="text-xs text-blue-600 mt-1">
                  {filteredPayments.length !== payments.length && `sur ${payments.length} total`}
                </p>
              </div>
              <div className="h-12 w-12 bg-blue-200 rounded-full flex items-center justify-center">
                <CreditCard className="h-6 w-6 text-blue-700" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Amount */}
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">Montant Total</p>
                <p className="text-2xl font-bold text-green-900">
                  {formatCurrency(
                    filteredPayments.reduce((sum, p) => sum + parseFloat(p.total_amount), 0).toString()
                  )}
                </p>
                <p className="text-xs text-green-600 mt-1">Tous statuts confondus</p>
              </div>
              <div className="h-12 w-12 bg-green-200 rounded-full flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-700" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Approved Payments */}
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600">Approuvés</p>
                <p className="text-3xl font-bold text-purple-900">
                  {filteredPayments.filter(p => p.status === 'approved').length}
                </p>
                <p className="text-xs text-purple-600 mt-1">
                  {formatCurrency(
                    filteredPayments
                      .filter(p => p.status === 'approved')
                      .reduce((sum, p) => sum + parseFloat(p.total_amount), 0)
                      .toString()
                  )}
                </p>
              </div>
              <div className="h-12 w-12 bg-purple-200 rounded-full flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-purple-700" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending Payments */}
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-600">En Attente</p>
                <p className="text-3xl font-bold text-orange-900">
                  {filteredPayments.filter(p => p.status === 'calculated').length}
                </p>
                <p className="text-xs text-orange-600 mt-1">
                  {formatCurrency(
                    filteredPayments
                      .filter(p => p.status === 'calculated')
                      .reduce((sum, p) => sum + parseFloat(p.total_amount), 0)
                      .toString()
                  )}
                </p>
              </div>
              <div className="h-12 w-12 bg-orange-200 rounded-full flex items-center justify-center">
                <Clock className="h-6 w-6 text-orange-700" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Payment Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Paid Payments */}
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-emerald-600">Paiements Effectués</p>
                <p className="text-2xl font-bold text-emerald-900">
                  {filteredPayments.filter(p => p.status === 'paid').length}
                </p>
                <p className="text-xs text-emerald-600 mt-1">
                  {formatCurrency(
                    filteredPayments
                      .filter(p => p.status === 'paid')
                      .reduce((sum, p) => sum + parseFloat(p.total_amount), 0)
                      .toString()
                  )}
                </p>
              </div>
              <div className="h-10 w-10 bg-emerald-200 rounded-full flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-emerald-700" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Average Payment */}
        <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-indigo-600">Paiement Moyen</p>
                <p className="text-2xl font-bold text-indigo-900">
                  {filteredPayments.length > 0
                    ? formatCurrency(
                        (filteredPayments.reduce((sum, p) => sum + parseFloat(p.total_amount), 0) / filteredPayments.length).toString()
                      )
                    : formatCurrency('0')
                  }
                </p>
                <p className="text-xs text-indigo-600 mt-1">Par enseignant</p>
              </div>
              <div className="h-10 w-10 bg-indigo-200 rounded-full flex items-center justify-center">
                <Calendar className="h-5 w-5 text-indigo-700" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unique Teachers */}
        <Card className="bg-gradient-to-br from-teal-50 to-teal-100 border-teal-200 shadow-lg hover:shadow-xl transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-teal-600">Enseignants Payés</p>
                <p className="text-2xl font-bold text-teal-900">
                  {new Set(filteredPayments.map(p => p.teacher_name)).size}
                </p>
                <p className="text-xs text-teal-600 mt-1">Enseignants uniques</p>
              </div>
              <div className="h-10 w-10 bg-teal-200 rounded-full flex items-center justify-center">
                <Users className="h-5 w-5 text-teal-700" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* View Mode Toggle and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-white">Mode d'affichage:</span>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('consolidated')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'consolidated'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Vue consolidée (par enseignant)
                </button>
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Vue détaillée (par paiement)
                </button>
              </div>
            </div>

            {/* Search and Filters */}
            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder={viewMode === 'consolidated'
                      ? "Rechercher par enseignant..."
                      : "Rechercher par enseignant ou période..."
                    }
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="calculated">Calculé</SelectItem>
                  <SelectItem value="approved">Approuvé</SelectItem>
                  <SelectItem value="paid">Payé</SelectItem>
                  <SelectItem value="cancelled">Annulé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payments List */}
      <div className="grid gap-4">
        {viewMode === 'consolidated' ? (
          // Consolidated View - One line per teacher
          filteredConsolidatedPayments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CreditCard className="w-12 h-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun enseignant trouvé</h3>
                <p className="text-gray-600 text-center">
                  {searchTerm || statusFilter !== "all"
                    ? "Aucun enseignant ne correspond à vos critères de recherche."
                    : "Aucun paiement n'a été calculé pour le moment."
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredConsolidatedPayments.map((consolidated) => {
              // Determine overall status based on payment statuses
              const getOverallStatus = () => {
                if (consolidated.statuses.paid > 0) return 'paid';
                if (consolidated.statuses.approved > 0) return 'approved';
                if (consolidated.statuses.calculated > 0) return 'calculated';
                return 'cancelled';
              };

              const overallStatus = getOverallStatus();
              const StatusIcon = statusConfig[overallStatus].icon;

              return (
                <Card key={consolidated.teacher_email} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-gray-50">{consolidated.teacher_name}</h3>
                          <Badge className={statusConfig[overallStatus].color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {consolidated.payment_count} paiement{consolidated.payment_count > 1 ? 's' : ''}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-white mb-3">
                          <div>
                            <span className="font-medium text-white">Email:</span>
                            <br />
                            {consolidated.teacher_email}
                          </div>
                          <div>
                            <span className="font-medium text-white">Périodes:</span>
                            <br />
                            {consolidated.periods.slice(0, 2).join(', ')}
                            {consolidated.periods.length > 2 && ` +${consolidated.periods.length - 2}`}
                          </div>
                          <div>
                            <span className="font-medium text-white">Types:</span>
                            <br />
                            {consolidated.payment_types.join(', ')}
                          </div>
                          <div>
                            <span className="font-medium text-white">Montant total:</span>
                            <br />
                            <span className="font-bold text-white text-lg">
                              {formatCurrency(consolidated.total_amount.toString())}
                            </span>
                          </div>
                        </div>

                        {/* Payment Status Breakdown */}
                        <div className="flex gap-4 text-xs">
                          {consolidated.statuses.calculated > 0 && (
                            <span className="text-orange-600">
                              {consolidated.statuses.calculated} calculé{consolidated.statuses.calculated > 1 ? 's' : ''}
                            </span>
                          )}
                          {consolidated.statuses.approved > 0 && (
                            <span className="text-purple-600">
                              {consolidated.statuses.approved} approuvé{consolidated.statuses.approved > 1 ? 's' : ''}
                            </span>
                          )}
                          {consolidated.statuses.paid > 0 && (
                            <span className="text-green-600">
                              {consolidated.statuses.paid} payé{consolidated.statuses.paid > 1 ? 's' : ''}
                            </span>
                          )}
                          {consolidated.statuses.cancelled > 0 && (
                            <span className="text-red-600">
                              {consolidated.statuses.cancelled} annulé{consolidated.statuses.cancelled > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 ml-4">
                        {consolidated.statuses.calculated > 0 && (
                          <Button
                            size="sm"
                            onClick={() =>
                              handleBulkStatusChangeForTeacher(consolidated.teacher_email, 'calculated', 'approved')
                            }
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approuver
                          </Button>
                        )}
                        {consolidated.statuses.approved > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleBulkStatusChangeForTeacher(consolidated.teacher_email, 'approved', 'paid')
                            }
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Marquer payé
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                          onClick={async () => {
                            const { exportTeacherPayslipToWord } = await import("@/lib/utils/payment-export");
                            exportTeacherPayslipToWord({
                              teacherName: consolidated.teacher_name,
                              teacherEmail: consolidated.teacher_email,
                              payments: consolidated.individual_payments,
                              organisationName: 'Imhotep Academy - Bulletin de paie'
                            });
                          }}
                        >
                          <FileText className="w-4 h-4 mr-1" />
                          Bulletin DOCX
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )
        ) : (
          // Detailed View - Original individual payments
          filteredPayments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CreditCard className="w-12 h-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun paiement trouvé</h3>
                <p className="text-gray-600 text-center">
                  {searchTerm || statusFilter !== "all"
                    ? "Aucun paiement ne correspond à vos critères de recherche."
                    : "Aucun paiement n'a été calculé pour le moment."
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredPayments.map((payment) => {
              const StatusIcon = statusConfig[payment.status].icon;
              return (
                <Card key={payment.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-gray-50">{payment.teacher_name}</h3>
                          <Badge className={statusConfig[payment.status].color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {statusConfig[payment.status].label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-white">
                          <div>
                            <span className="font-medium text-white">Période:</span>
                            <br />
                            {payment.period_name}
                          </div>
                          <div>
                            <span className="font-medium text-white">Type:</span>
                            <br />
                            {payment.payment_type}
                          </div>
                          <div>
                            <span className="font-medium text-white">Montant total:</span>
                            <br />
                            <span className="font-semibold text-white">
                              {formatCurrency(payment.total_amount, payment.currency)}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-white">Calculé le:</span>
                            <br />
                            {formatDate(payment.calculated_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {payment.status === 'calculated' && (
                          <Button
                            size="sm"
                            onClick={() => handleStatusChange(payment.id, 'approved')}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approuver
                          </Button>
                        )}
                        {payment.status === 'approved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(payment.id, 'paid')}
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Marquer payé
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )
        )}
      </div>
    </div>
  );
}
