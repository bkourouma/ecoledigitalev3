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
  AlertTriangle,
  CreditCard,
  Calendar,
  GraduationCap,
} from "lucide-react";

interface TuitionInstallment {
  id: string;
  installmentNumber: number;
  installmentLabel: string;
  amount: number;
  dueDate: Date;
  status: "pending" | "partial" | "completed" | "overdue";
  amountPaid: number;
  lateFee: number;
}

interface TuitionScheduleProps {
  installments: TuitionInstallment[];
  onPaymentClick: (installment: TuitionInstallment) => void;
}

export function TuitionSchedule({ installments, onPaymentClick }: TuitionScheduleProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20";
      case "pending":
        return "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20";
      case "overdue":
        return "border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/20";
      case "partial":
        return "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/20";
      default:
        return "border-border bg-muted/50 text-muted-foreground hover:bg-muted/70";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4" />;
      case "pending":
        return <Clock className="h-4 w-4" />;
      case "overdue":
        return <AlertTriangle className="h-4 w-4" />;
      case "partial":
        return <Clock className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "Payé";
      case "pending":
        return "En attente";
      case "overdue":
        return "En retard";
      case "partial":
        return "Partiel";
      default:
        return status;
    }
  };

  const isOverdue = (dueDate: Date, status: string) => {
    return status !== "completed" && new Date() > dueDate;
  };

  const getDaysUntilDue = (dueDate: Date) => {
    const today = new Date();
    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const totalTuitionAmount = installments.reduce((sum, inst) => sum + inst.amount, 0);
  const totalPaidAmount = installments.reduce((sum, inst) => sum + inst.amountPaid, 0);
  const progressPercentage = totalTuitionAmount > 0 ? (totalPaidAmount / totalTuitionAmount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card className="border-border bg-gradient-to-r from-violet-500/10 via-background to-fuchsia-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Échéancier de Scolarité
          </CardTitle>
          <CardDescription>
            Paiements échelonnés pour les frais de scolarité
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Scolarité</p>
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(totalTuitionAmount)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Montant Payé</p>
              <p className="text-xl font-semibold text-emerald-400">
                {formatCurrency(totalPaidAmount)}
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Progression des paiements</span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Installments List */}
      <div className="space-y-4">
        {installments.map((installment, index) => {
          const progressPercentage = installment.amount > 0 
            ? (installment.amountPaid / installment.amount) * 100 
            : 0;
          const daysUntilDue = getDaysUntilDue(installment.dueDate);
          const overdue = isOverdue(installment.dueDate, installment.status);

          return (
            <motion.div
              key={installment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
            >
              <Card className={`transition-shadow hover:shadow-md ${
                overdue ? "border-destructive/40 bg-destructive/10" : "border-border"
              }`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${
                        installment.status === "completed" 
                          ? "bg-emerald-500/15 text-emerald-400"
                          : overdue
                          ? "bg-red-500/15 text-red-400"
                          : "bg-sky-500/15 text-sky-400"
                      }`}>
                        <span className="font-bold text-sm">
                          {installment.installmentNumber}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {installment.installmentLabel}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4 shrink-0" />
                          <span>Échéance: {formatDate(installment.dueDate)}</span>
                          {daysUntilDue > 0 && installment.status !== "completed" && (
                            <span className="text-amber-400 font-medium">
                              ({daysUntilDue} jour{daysUntilDue > 1 ? "s" : ""} restant{daysUntilDue > 1 ? "s" : ""})
                            </span>
                          )}
                          {overdue && (
                            <span className="text-red-400 font-medium">
                              (En retard de {Math.abs(daysUntilDue)} jour{Math.abs(daysUntilDue) > 1 ? "s" : ""})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg text-foreground">
                        {formatCurrency(installment.amount)}
                      </p>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(installment.status)}
                      >
                        {getStatusIcon(installment.status)}
                        <span className="ml-1">{getStatusLabel(installment.status)}</span>
                      </Badge>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-muted-foreground mb-1">
                      <span>Montant payé</span>
                      <span>{formatCurrency(installment.amountPaid)} / {formatCurrency(installment.amount)}</span>
                    </div>
                    <Progress 
                      value={progressPercentage} 
                      className="h-2"
                    />
                  </div>

                  {/* Late Fee Warning */}
                  {installment.lateFee > 0 && (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-center gap-2 text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          Frais de retard: {formatCurrency(installment.lateFee)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {installment.status === "completed" ? (
                        <span className="text-emerald-400 font-medium">
                          Paiement complet effectué
                        </span>
                      ) : (
                        <span>
                          Montant restant: {formatCurrency(installment.amount - installment.amountPaid)}
                          {installment.lateFee > 0 && (
                            <span className="text-amber-400">
                              {" "}+ {formatCurrency(installment.lateFee)} (frais de retard)
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {installment.status !== "completed" && (
                      <Button
                        size="sm"
                        onClick={() => onPaymentClick(installment)}
                        className={
                          overdue
                            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            : "bg-primary hover:bg-primary/90"
                        }
                      >
                        <CreditCard className="h-4 w-4 mr-2" />
                        {installment.status === "partial" ? "Compléter" : "Payer"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
