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
  Download,
  Search,
  Receipt,
  Calendar,
  Eye,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// Mock data - replace with actual API calls
const mockReceipts = [
  {
    id: "receipt-1",
    receiptNumber: "REC-2024-001",
    transactionId: "tx-123",
    feeType: "inscription",
    amount: 50000,
    currency: "XOF",
    paymentMethod: "orange_money",
    generatedAt: new Date("2024-09-01"),
    downloadUrl: "/api/receipts/download/REC-2024-001",
  },
  {
    id: "receipt-2",
    receiptNumber: "REC-2024-002",
    transactionId: "tx-124",
    feeType: "scolarite",
    amount: 66667,
    currency: "XOF",
    paymentMethod: "mtn_money",
    generatedAt: new Date("2024-10-01"),
    downloadUrl: "/api/receipts/download/REC-2024-002",
  },
  {
    id: "receipt-3",
    receiptNumber: "REC-2024-003",
    transactionId: "tx-125",
    feeType: "annexes",
    amount: 25000,
    currency: "XOF",
    paymentMethod: "card",
    generatedAt: new Date("2024-10-15"),
    downloadUrl: "/api/receipts/download/REC-2024-003",
  },
];

export default function StudentReceiptsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [feeTypeFilter, setFeeTypeFilter] = useState<string>("all");

  const { data: receipts, isLoading, error } = useQuery({
    queryKey: ["student-receipts"],
    queryFn: async () => {
      // Replace with actual API call
      return mockReceipts;
    },
  });

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

  const filteredReceipts = receipts?.filter((receipt) => {
    const matchesSearch = 
      receipt.receiptNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getFeeTypeLabel(receipt.feeType).toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFeeType = feeTypeFilter === "all" || receipt.feeType === feeTypeFilter;

    return matchesSearch && matchesFeeType;
  }) || [];

  const handleDownload = (receipt: any) => {
    // In a real app, this would trigger the download
    window.open(receipt.downloadUrl, '_blank');
  };

  const handleView = (receipt: any) => {
    // In a real app, this would open the receipt in a modal or new tab
    window.open(`/receipts/view/${receipt.receiptNumber}`, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
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
          <h1 className="text-3xl font-bold text-gray-900">Mes Reçus de Paiement</h1>
          <p className="text-gray-600 mt-2">
            Consultez et téléchargez tous vos reçus de paiement
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Télécharger Tout
          </Button>
        </div>
      </motion.div>

      {/* Summary Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total des Reçus</p>
                <p className="text-2xl font-bold text-gray-900">
                  {filteredReceipts.length}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-muted-foreground">Montant Total</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(
                    filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0)
                  )}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <Receipt className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="flex flex-col md:flex-row gap-4"
      >
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Rechercher par numéro de reçu ou type de frais..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
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
      </motion.div>

      {/* Receipts List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="space-y-4"
      >
        {filteredReceipts.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Receipt className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 mb-4">Aucun reçu trouvé</p>
              <p className="text-sm text-gray-400">
                Vos reçus de paiement apparaîtront ici après vos transactions
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredReceipts.map((receipt, index) => (
            <motion.div
              key={receipt.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-100 rounded-full">
                        <FileText className="h-6 w-6 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {receipt.receiptNumber}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                          <span>{getFeeTypeLabel(receipt.feeType)}</span>
                          <span>•</span>
                          <span>{getPaymentMethodLabel(receipt.paymentMethod)}</span>
                          <span>•</span>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(receipt.generatedAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-lg text-gray-900">
                          {formatCurrency(receipt.amount)}
                        </p>
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Payé
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleView(receipt)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleDownload(receipt)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>
    </div>
  );
}
