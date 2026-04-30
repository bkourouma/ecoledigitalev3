"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MotionDiv = dynamic(
  () => import("framer-motion").then((mod) => mod.motion.div),
  { ssr: false }
);
import {
  Card,
  CardContent,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  CreditCard,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Download,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { FeeBreakdown } from "./components/FeeBreakdown";
import { TuitionSchedule } from "./components/TuitionSchedule";
import { PaymentHistory } from "./components/PaymentHistory";
import { PaymentForm } from "./components/PaymentForm";
import { Receipts } from "./components/Receipts";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { isStudentProfileMissingError } from "@/lib/student-profile-errors";

export default function StudentPaymentsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // Récupérer l'étudiant connecté
  const {
    data: currentStudent,
    isLoading: isLoadingStudent,
    error: currentStudentError,
  } = useCurrentStudent();
  const studentId = currentStudent?.id;
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id;

  // Récupérer les données de paiement depuis l'API
  const { data: paymentData, isLoading, error } = useQuery({
    queryKey: ["student-payments", studentId, activeAcademicYearId || "no-academic-year"],
    queryFn: async () => {
      if (!studentId) {
        throw new Error("Student ID not available");
      }

      const headers = createApiHeaders(session);
      const query = activeAcademicYearId ? `?academicYearId=${encodeURIComponent(activeAcademicYearId)}` : "";
      const response = await fetch(`/api/v1/student-payments/${studentId}${query}`, {
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const json = await response.json();
      return json.data;
    },
    enabled: !!studentId && !!session,
  });

  // Rediriger si non authentifié
  if (sessionStatus === "loading" || isLoadingStudent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-muted-foreground">Chargement de vos paiements...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  if (currentStudentError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {isStudentProfileMissingError(currentStudentError)
              ? "Ce compte n'est pas encore rattache a une fiche etudiant. Veuillez contacter l'administrateur."
              : currentStudentError instanceof Error
                ? currentStudentError.message
                : "Impossible de charger le profil etudiant."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-muted-foreground">Chargement de vos paiements...</p>
        </div>
      </div>
    );
  }

  if (error || !paymentData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : "Erreur lors du chargement des informations de paiement. Veuillez réessayer."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Recalculer les montants payés depuis les transactions pour avoir les données les plus récentes
  // On compte les transactions completed et processing comme payées
  const calculatePaidAmountFromTransactions = (feeType: string, transactions: any[]) => {
    return transactions
      .filter((tx: any) => 
        tx.feeType === feeType && 
        (tx.status === 'completed' || tx.status === 'processing')
      )
      .reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  };

  // Transformer les données de l'API pour correspondre au format attendu par les composants
  const transactions = paymentData.recentTransactions || [];
  
  const transformedData = {
    studentId: paymentData.studentId,
    studentName: paymentData.studentName || (session?.user as any)?.firstName || "Étudiant",
    enrollmentId: paymentData.enrollmentId,
    totalFees: paymentData.totalFees || 0,
    totalPaid: paymentData.totalPaid || 0,
    totalOutstanding: paymentData.totalOutstanding || 0,
    immediateFeesStatus: {
      inscription: (() => {
        const fee = paymentData.immediateFeesStatus?.inscription || { amount: 0, paid: false, paidAmount: 0 };
        const amount = Number(fee.amount || 0);
        // Recalculer depuis les transactions pour avoir les données les plus récentes
        // Utiliser le maximum entre le calcul depuis les transactions et la valeur de l'API
        const paidAmountFromTx = calculatePaidAmountFromTransactions('inscription', transactions);
        const paidAmountFromAPI = Number(fee.paidAmount || 0);
        // Utiliser le maximum pour être sûr d'avoir les données les plus récentes
        const paidAmount = Math.max(paidAmountFromTx, paidAmountFromAPI);
        // Recalculer le statut paid en comparant les montants
        const paid = amount > 0 && paidAmount >= amount;
        return { amount, paid, paidAmount };
      })(),
      annexes: (() => {
        const fee = paymentData.immediateFeesStatus?.annexes || { amount: 0, paid: false, paidAmount: 0 };
        const amount = Number(fee.amount || 0);
        // Recalculer depuis les transactions pour avoir les données les plus récentes
        const paidAmountFromTx = calculatePaidAmountFromTransactions('annexes', transactions);
        const paidAmountFromAPI = Number(fee.paidAmount || 0);
        // Utiliser le maximum pour être sûr d'avoir les données les plus récentes
        const paidAmount = Math.max(paidAmountFromTx, paidAmountFromAPI);
        // Recalculer le statut paid en comparant les montants
        const paid = amount > 0 && paidAmount >= amount;
        return { amount, paid, paidAmount };
      })(),
      autres: (() => {
        const fee = paymentData.immediateFeesStatus?.autres || { amount: 0, paid: false, paidAmount: 0 };
        const amount = Number(fee.amount || 0);
        // Recalculer depuis les transactions pour avoir les données les plus récentes
        const paidAmountFromTx = calculatePaidAmountFromTransactions('autres', transactions);
        const paidAmountFromAPI = Number(fee.paidAmount || 0);
        // Utiliser le maximum pour être sûr d'avoir les données les plus récentes
        const paidAmount = Math.max(paidAmountFromTx, paidAmountFromAPI);
        // Recalculer le statut paid en comparant les montants
        const paid = amount > 0 && paidAmount >= amount;
        return { amount, paid, paidAmount };
      })(),
    },
    tuitionInstallments: (paymentData.tuitionInstallments || []).map((inst: any) => ({
      id: inst.id,
      installmentNumber: inst.installmentNumber,
      installmentLabel: inst.installmentLabel,
      amount: inst.amount,
      dueDate: inst.dueDate ? new Date(inst.dueDate) : new Date(),
      status: inst.status || (inst.amountPaid >= inst.amount ? "completed" : inst.amountPaid > 0 ? "partial" : "pending"),
      amountPaid: inst.amountPaid || 0,
      lateFee: inst.lateFee || 0,
    })),
    recentTransactions: (paymentData.recentTransactions || []).map((tx: any) => ({
      id: tx.id,
      feeType: tx.feeType,
      amount: tx.amount,
      currency: tx.currency || "XOF",
      paymentMethod: tx.paymentMethod,
      status: tx.status,
      createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
    })),
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <MotionDiv
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-foreground">Mes Paiements</h1>
          <p className="text-muted-foreground mt-2">
            Gérez vos frais scolaires et effectuez vos paiements
            {transformedData.studentName && ` — ${transformedData.studentName}`}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Télécharger Reçus
          </Button>
          <Button 
            onClick={() => setShowPaymentForm(true)}
            className="bg-primary hover:bg-primary/90"
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Effectuer un Paiement
          </Button>
        </div>
      </MotionDiv>

      {/* Summary Cards */}
      <MotionDiv
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total des Frais</p>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(transformedData.totalFees)}
                </p>
              </div>
              <div className="p-3 bg-sky-500/15 rounded-full shrink-0">
                <DollarSign className="h-6 w-6 text-sky-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Montant Payé</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {formatCurrency(transformedData.totalPaid)}
                </p>
              </div>
              <div className="p-3 bg-emerald-500/15 rounded-full shrink-0">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Solde Restant</p>
                <p className="text-2xl font-bold text-amber-400">
                  {formatCurrency(transformedData.totalOutstanding)}
                </p>
              </div>
              <div className="p-3 bg-amber-500/15 rounded-full shrink-0">
                <Clock className="h-6 w-6 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </MotionDiv>

      {/* Main Content Tabs */}
      <MotionDiv
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1 sm:grid-cols-4">
            <TabsTrigger
              value="overview"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Vue d&apos;ensemble
            </TabsTrigger>
            <TabsTrigger
              value="schedule"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Échéancier
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Historique
            </TabsTrigger>
            <TabsTrigger
              value="receipts"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Reçus
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <FeeBreakdown 
              immediateFeesStatus={transformedData.immediateFeesStatus}
              onPaymentClick={(feeType) => {
                setSelectedPayment({ feeType, type: 'immediate' });
                setShowPaymentForm(true);
              }}
            />
          </TabsContent>

          <TabsContent value="schedule" className="space-y-6">
            <TuitionSchedule 
              installments={transformedData.tuitionInstallments}
              onPaymentClick={(installment) => {
                setSelectedPayment({ installment, type: 'tuition' });
                setShowPaymentForm(true);
              }}
            />
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <PaymentHistory transactions={transformedData.recentTransactions} />
          </TabsContent>

          <TabsContent value="receipts" className="space-y-6">
            <Receipts />
          </TabsContent>
        </Tabs>
      </MotionDiv>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <PaymentForm
          selectedPayment={selectedPayment}
          onClose={() => {
            setShowPaymentForm(false);
            setSelectedPayment(null);
          }}
          onSuccess={() => {
            setShowPaymentForm(false);
            setSelectedPayment(null);
            // Refresh payment data
          }}
        />
      )}
    </div>
  );
}
