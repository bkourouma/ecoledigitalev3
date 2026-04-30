"use client";

import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Progress,
} from "@ecoledigitale/ui";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  BookOpen,
  FileText,
  Package,
} from "lucide-react";

interface ImmediateFeeStatus {
  amount: number;
  paid: boolean;
  paidAmount: number;
}

interface FeeBreakdownProps {
  immediateFeesStatus: {
    inscription: ImmediateFeeStatus;
    annexes: ImmediateFeeStatus;
    autres: ImmediateFeeStatus;
  };
  onPaymentClick: (feeType: string) => void;
}

export function FeeBreakdown({ immediateFeesStatus, onPaymentClick }: FeeBreakdownProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getFeeIcon = (feeType: string) => {
    switch (feeType) {
      case "inscription":
        return <FileText className="h-5 w-5" />;
      case "annexes":
        return <Package className="h-5 w-5" />;
      case "autres":
        return <BookOpen className="h-5 w-5" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  const getFeeLabel = (feeType: string) => {
    switch (feeType) {
      case "inscription":
        return "Frais d'Inscription";
      case "annexes":
        return "Frais Annexes";
      case "autres":
        return "Autres Frais";
      default:
        return feeType;
    }
  };

  const getFeeDescription = (feeType: string) => {
    switch (feeType) {
      case "inscription":
        return "Frais d'inscription et d'administration";
      case "annexes":
        return "Frais de matériel et d'équipement";
      case "autres":
        return "Autres frais divers";
      default:
        return "";
    }
  };

  const feeTypes = ["inscription", "annexes", "autres"] as const;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Frais Immédiats
          </CardTitle>
          <CardDescription>
            Ces frais doivent être payés en totalité lors du paiement
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {feeTypes.map((feeType, index) => {
            const feeStatus = immediateFeesStatus?.[feeType] || { amount: 0, paid: false, paidAmount: 0 };
            const progressPercentage = feeStatus.amount > 0 
              ? (feeStatus.paidAmount / feeStatus.amount) * 100 
              : 0;

            return (
              <motion.div
                key={feeType}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className="rounded-lg border border-border p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${
                      feeStatus.paid 
                        ? "bg-emerald-500/15 text-emerald-400" 
                        : "bg-amber-500/15 text-amber-400"
                    }`}>
                      {getFeeIcon(feeType)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {getFeeLabel(feeType)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {getFeeDescription(feeType)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg text-foreground">
                      {formatCurrency(feeStatus.amount)}
                    </p>
                    <Badge 
                      variant="outline"
                      className={
                        feeStatus.paid
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20"
                          : "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20"
                      }
                    >
                      {feeStatus.paid ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Payé
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" />
                          En attente
                        </>
                      )}
                    </Badge>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-sm text-muted-foreground mb-1">
                    <span>Progression du paiement</span>
                    <span>{Math.round(progressPercentage)}%</span>
                  </div>
                  <Progress 
                    value={progressPercentage} 
                    className="h-2"
                  />
                </div>

                {/* Payment Details */}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {feeStatus.paid ? (
                      <span className="text-emerald-400 font-medium">
                        Payé intégralement le {new Date().toLocaleDateString("fr-FR")}
                      </span>
                    ) : (
                      <span>
                        Montant restant: {formatCurrency(feeStatus.amount - feeStatus.paidAmount)}
                      </span>
                    )}
                  </div>
                  {!feeStatus.paid && feeStatus.amount > 0 && (
                    <Button
                      size="sm"
                      onClick={() => onPaymentClick(feeType)}
                      className="bg-primary hover:bg-primary/90"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Payer
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card className="border-border bg-gradient-to-r from-sky-500/10 via-background to-violet-500/10">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground mb-1">
                Résumé des Frais Immédiats
              </h3>
              <p className="text-sm text-muted-foreground">
                Total des frais à payer immédiatement
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(
                  (immediateFeesStatus?.inscription?.amount || 0) +
                  (immediateFeesStatus?.annexes?.amount || 0) +
                  (immediateFeesStatus?.autres?.amount || 0)
                )}
              </p>
              <p className="text-sm text-emerald-400 font-medium">
                {formatCurrency(
                  (immediateFeesStatus?.inscription?.paidAmount || 0) +
                  (immediateFeesStatus?.annexes?.paidAmount || 0) +
                  (immediateFeesStatus?.autres?.paidAmount || 0)
                )} payé
              </p>
            </div>
          </div>
          
          <div className="mt-4">
            <div className="flex justify-between text-sm text-muted-foreground mb-2">
              <span>Progression globale</span>
              <span>
                {(() => {
                  const totalPaid = (immediateFeesStatus?.inscription?.paidAmount || 0) +
                    (immediateFeesStatus?.annexes?.paidAmount || 0) +
                    (immediateFeesStatus?.autres?.paidAmount || 0);
                  const totalAmount = (immediateFeesStatus?.inscription?.amount || 0) +
                    (immediateFeesStatus?.annexes?.amount || 0) +
                    (immediateFeesStatus?.autres?.amount || 0);
                  return totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;
                })()}%
              </span>
            </div>
            <Progress 
              value={(() => {
                const totalPaid = (immediateFeesStatus?.inscription?.paidAmount || 0) +
                  (immediateFeesStatus?.annexes?.paidAmount || 0) +
                  (immediateFeesStatus?.autres?.paidAmount || 0);
                const totalAmount = (immediateFeesStatus?.inscription?.amount || 0) +
                  (immediateFeesStatus?.annexes?.amount || 0) +
                  (immediateFeesStatus?.autres?.amount || 0);
                return totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0;
              })()}
              className="h-3"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
