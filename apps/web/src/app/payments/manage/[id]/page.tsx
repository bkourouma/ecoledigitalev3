"use client";

import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  DollarSign,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

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

const statusConfig = {
  calculated: { label: 'Calculé', color: 'bg-blue-100 text-blue-800', icon: Clock },
  approved: { label: 'Approuvé', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  paid: { label: 'Payé', color: 'bg-gray-100 text-gray-800', icon: DollarSign },
  cancelled: { label: 'Annulé', color: 'bg-red-100 text-red-800', icon: Clock },
};

async function fetchPayment(id: string): Promise<Payment> {
  const response = await fetch(`/api/v1/teacher-payments/${id}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to fetch payment");
  }
  const payload = await response.json();
  // The API returns { data: {...} }
  const payment = payload.data;
  
  // Map the API response to our Payment interface
  return {
    id: payment.id,
    teacher_name: payment.teacherName || payment.teacher_name || 'Unknown',
    teacher_email: payment.teacherEmail || payment.teacher_email || '',
    period_name: payment.periodName || payment.period_name || '',
    payment_type: payment.paymentType || payment.payment_type || '',
    base_amount: (payment.baseAmount || payment.base_amount || 0).toString(),
    overtime_amount: (payment.overtimeAmount || payment.overtime_amount || 0).toString(),
    bonus_amount: (payment.bonusAmount || payment.bonus_amount || 0).toString(),
    deductions: (payment.deductions || 0).toString(),
    total_amount: (payment.totalAmount || payment.total_amount || 0).toString(),
    currency: payment.currency || 'XOF',
    status: payment.status || 'calculated',
    calculated_at: payment.calculatedAt || payment.calculated_at || '',
    approved_at: payment.approvedAt || payment.approved_at,
    paid_at: payment.paidAt || payment.paid_at,
  };
}

export default function PaymentDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const paymentId = params.id as string;
  const { toast } = useToast();

  const { data: payment, isLoading, error } = useQuery<Payment>({
    queryKey: ["payment", paymentId],
    queryFn: () => fetchPayment(paymentId),
    enabled: !!paymentId,
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
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des détails du paiement...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/payments/manage")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
        </div>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <AlertCircle className="h-8 w-8 text-red-600" />
              <div>
                <h3 className="text-lg font-semibold text-red-900">Erreur</h3>
                <p className="text-red-700">
                  {error instanceof Error ? error.message : "Paiement introuvable. Le paiement demandé n'existe pas ou vous n'avez pas les permissions pour le consulter."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const StatusIcon = statusConfig[payment.status].icon;

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/payments/manage")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Détails du paiement
          </h1>
          <p className="text-muted-foreground mt-2">
            Informations détaillées du paiement
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Teacher Information */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Informations de l'enseignant</span>
            </CardTitle>
            <CardDescription>
              Informations personnelles de l'enseignant concerné
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <span className="text-sm font-medium text-gray-600">Nom:</span>
                <p className="text-gray-900 text-lg font-semibold">{payment.teacher_name}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Email:</span>
                <p className="text-gray-900 text-lg">
                  {payment.teacher_email && payment.teacher_email.trim() ? (
                    payment.teacher_email
                  ) : (
                    <span className="text-gray-400 italic">Non renseigné</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Information */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Informations du paiement</span>
            </CardTitle>
            <CardDescription>
              Détails généraux du paiement
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <span className="text-sm font-medium text-gray-600">Période:</span>
                <p className="text-gray-900 text-lg font-semibold">{payment.period_name}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Type de paiement:</span>
                <p className="text-gray-900 text-lg font-semibold">{payment.payment_type}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Statut:</span>
                <div className="mt-1">
                  <Badge className={statusConfig[payment.status].color}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {statusConfig[payment.status].label}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">ID du paiement:</span>
                <p className="text-gray-900 text-sm font-mono">{payment.id}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Amount Breakdown */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              <span>Détail des montants</span>
            </CardTitle>
            <CardDescription>
              Répartition détaillée des montants du paiement
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Montant de base:</span>
                <span className="font-semibold text-gray-900 text-lg">
                  {formatCurrency(payment.base_amount, payment.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Heures supplémentaires:</span>
                <span className="font-semibold text-gray-900 text-lg">
                  {formatCurrency(payment.overtime_amount, payment.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Bonus:</span>
                <span className="font-semibold text-gray-900 text-lg">
                  {formatCurrency(payment.bonus_amount, payment.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Déductions:</span>
                <span className="font-semibold text-red-600 text-lg">
                  -{formatCurrency(payment.deductions, payment.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 mt-4 pt-4 border-t-2 border-gray-300">
                <span className="text-gray-900 font-bold text-xl">Total:</span>
                <span className="text-green-600 font-bold text-2xl">
                  {formatCurrency(payment.total_amount, payment.currency)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status and Dates */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <span>Statut et dates</span>
            </CardTitle>
            <CardDescription>
              Historique des statuts et dates importantes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Statut actuel:</span>
                <Badge className={statusConfig[payment.status].color}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {statusConfig[payment.status].label}
                </Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-gray-600 font-medium">Calculé le:</span>
                <span className="text-gray-900 font-semibold">{formatDate(payment.calculated_at)}</span>
              </div>
              {payment.approved_at && (
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-600 font-medium">Approuvé le:</span>
                  <span className="text-gray-900 font-semibold">{formatDate(payment.approved_at)}</span>
                </div>
              )}
              {payment.paid_at && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600 font-medium">Payé le:</span>
                  <span className="text-gray-900 font-semibold">{formatDate(payment.paid_at)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Card className="shadow-lg">
          <CardContent className="pt-6">
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={async () => {
                  const { exportTeacherPayslipToWord } = await import("@/lib/utils/payment-export");
                  exportTeacherPayslipToWord({
                    teacherName: payment.teacher_name,
                    teacherEmail: payment.teacher_email,
                    payments: [payment],
                    organisationName: 'Imhotep Academy - Bulletin de paie détaillé'
                  });
                }}
                className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
              >
                <FileText className="w-4 h-4 mr-2" />
                Générer Bulletin Word
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/payments/manage")}
              >
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

