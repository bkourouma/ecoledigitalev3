"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Download,
  Search,
  History,
  Smartphone,
  CreditCard,
  Building,
} from "lucide-react";

interface PaymentTransaction {
  id: string;
  feeType: "inscription" | "scolarite" | "annexes" | "autres";
  amount: number;
  currency: string;
  paymentMethod: "orange_money" | "mtn_money" | "moov_money" | "card" | "bank_transfer";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "refunded";
  createdAt: Date;
  processedAt?: Date;
  receiptUrl?: string;
}

interface PaymentHistoryProps {
  transactions: PaymentTransaction[];
}

export function PaymentHistory({ transactions }: PaymentHistoryProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [feeTypeFilter, setFeeTypeFilter] = useState<string>("all");

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
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20";
      case "pending":
        return "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20";
      case "processing":
        return "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/20";
      case "failed":
        return "border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/20";
      case "cancelled":
        return "border-border bg-muted/50 text-muted-foreground hover:bg-muted/70";
      case "refunded":
        return "border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/20";
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
      case "processing":
        return <Clock className="h-4 w-4" />;
      case "failed":
        return <XCircle className="h-4 w-4" />;
      case "cancelled":
        return <XCircle className="h-4 w-4" />;
      case "refunded":
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "Complété";
      case "pending":
        return "En attente";
      case "processing":
        return "En cours";
      case "failed":
        return "Échoué";
      case "cancelled":
        return "Annulé";
      case "refunded":
        return "Remboursé";
      default:
        return status;
    }
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case "orange_money":
      case "mtn_money":
      case "moov_money":
        return <Smartphone className="h-4 w-4" />;
      case "card":
        return <CreditCard className="h-4 w-4" />;
      case "bank_transfer":
        return <Building className="h-4 w-4" />;
      default:
        return <CreditCard className="h-4 w-4" />;
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "orange_money":
        return "Orange Money";
      case "mtn_money":
        return "MTN Money";
      case "moov_money":
        return "Moov Money";
      case "card":
        return "Carte Bancaire";
      case "bank_transfer":
        return "Virement Bancaire";
      default:
        return method;
    }
  };

  const getFeeTypeLabel = (feeType: string) => {
    switch (feeType) {
      case "inscription":
        return "Inscription";
      case "scolarite":
        return "Scolarité";
      case "annexes":
        return "Frais Annexes";
      case "autres":
        return "Autres Frais";
      default:
        return feeType;
    }
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((transaction) => {
    const matchesSearch = 
      transaction.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getFeeTypeLabel(transaction.feeType).toLowerCase().includes(searchTerm.toLowerCase()) ||
      getPaymentMethodLabel(transaction.paymentMethod).toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || transaction.status === statusFilter;
    const matchesFeeType = feeTypeFilter === "all" || transaction.feeType === feeTypeFilter;

    return matchesSearch && matchesStatus && matchesFeeType;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historique des Paiements
          </CardTitle>
          <CardDescription>
            Consultez l'historique de tous vos paiements
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
                <Input
                  placeholder="Rechercher par ID, type de frais ou méthode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="completed">Complété</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
                <SelectItem value="processing">En cours</SelectItem>
                <SelectItem value="failed">Échoué</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
                <SelectItem value="refunded">Remboursé</SelectItem>
              </SelectContent>
            </Select>
            <Select value={feeTypeFilter} onValueChange={setFeeTypeFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Type de frais" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                <SelectItem value="inscription">Inscription</SelectItem>
                <SelectItem value="scolarite">Scolarité</SelectItem>
                <SelectItem value="annexes">Frais Annexes</SelectItem>
                <SelectItem value="autres">Autres Frais</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Transactions List */}
          <div className="space-y-4">
            {filteredTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                <p>Aucune transaction trouvée</p>
                <p className="text-sm text-muted-foreground/80">Essayez de modifier vos filtres de recherche</p>
              </div>
            ) : (
              filteredTransactions.map((transaction, index) => (
                <motion.div
                  key={transaction.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  className="rounded-lg border border-border p-4 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-muted/60 p-2 text-muted-foreground">
                        {getPaymentMethodIcon(transaction.paymentMethod)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {getFeeTypeLabel(transaction.feeType)}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {getPaymentMethodLabel(transaction.paymentMethod)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg text-foreground">
                        {formatCurrency(transaction.amount)}
                      </p>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(transaction.status)}
                      >
                        {getStatusIcon(transaction.status)}
                        <span className="ml-1">{getStatusLabel(transaction.status)}</span>
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div>
                      <p>ID: {transaction.id.slice(0, 8)}...</p>
                      <p>Initié le: {formatDate(transaction.createdAt)}</p>
                      {transaction.processedAt && (
                        <p>Traité le: {formatDate(transaction.processedAt)}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {transaction.receiptUrl && transaction.status === "completed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(transaction.receiptUrl, "_blank")}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Reçu
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Load More Button */}
          {filteredTransactions.length > 0 && (
            <div className="text-center mt-6">
              <Button variant="outline">
                Charger plus de transactions
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
