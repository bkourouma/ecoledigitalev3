"use client";

import { useState, useMemo, useEffect } from "react";
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
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import { createApiHeaders } from "@/lib/api-utils";

interface Receipt {
  receiptNumber: string;
  receiptUrl: string;
  transactionId: string;
  amount: number;
  currency: string;
  feeType: string;
  paymentMethod: string;
  processedAt: string;
  generatedAt: string;
}

export function Receipts() {
  const { data: session } = useSession();
  const { data: currentStudent } = useCurrentStudent();
  const studentId = currentStudent?.id;
  
  const [searchTerm, setSearchTerm] = useState("");
  const [feeTypeFilter, setFeeTypeFilter] = useState<string>("all");

  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pagination, setPagination] = useState<{ total: number; limit: number; offset: number; hasMore: boolean } | null>(null);

  const { data: receiptsResponse, isLoading, error, refetch } = useQuery({
    queryKey: ["student-receipts", studentId],
    queryFn: async () => {
      if (!studentId) {
        throw new Error("Student ID not available");
      }

      const headers = createApiHeaders(session);
      // Fetch with a higher limit to get more receipts at once
      const response = await fetch(`/api/receipts/student/${studentId}?limit=100&offset=0`, {
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const json = await response.json();
      return json;
    },
    enabled: !!studentId && !!session,
  });

  // Update all receipts when data changes
  useEffect(() => {
    if (receiptsResponse?.data) {
      setAllReceipts(receiptsResponse.data);
      if (receiptsResponse.pagination) {
        setPagination(receiptsResponse.pagination);
      }
    }
  }, [receiptsResponse]);

  // Load more receipts if needed
  const loadMoreReceipts = async () => {
    if (!studentId || !pagination?.hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const headers = createApiHeaders(session);
      const nextOffset = pagination.offset + pagination.limit;
      const response = await fetch(`/api/receipts/student/${studentId}?limit=100&offset=${nextOffset}`, {
        headers,
      });

      if (response.ok) {
        const json = await response.json();
        if (json.data && json.data.length > 0) {
          setAllReceipts(prev => [...prev, ...json.data]);
          if (json.pagination) {
            setPagination(json.pagination);
          }
        }
      }
    } catch (error) {
      console.error("Error loading more receipts:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
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
      case "tuition":
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
      case "cash":
        return "Espèces";
      default:
        return method || "N/A";
    }
  };

  const filteredReceipts = useMemo(() => {
    if (!allReceipts || allReceipts.length === 0) return [];
    
    return allReceipts.filter((receipt: Receipt) => {
      const matchesSearch = 
        receipt.receiptNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getFeeTypeLabel(receipt.feeType).toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesFeeType = feeTypeFilter === "all" || receipt.feeType === feeTypeFilter;

      return matchesSearch && matchesFeeType;
    });
  }, [allReceipts, searchTerm, feeTypeFilter]);

  const handleDownload = async (receipt: Receipt) => {
    if (!receipt.receiptUrl) return;

    try {
      // Use the proxy route to ensure headers are included
      const receiptUrl = encodeURIComponent(receipt.receiptUrl);
      const proxyUrl = `/api/receipts/view?url=${receiptUrl}`;
      
      // For download, we want to trigger a download
      const response = await fetch(proxyUrl, {
        headers: createApiHeaders(session),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${receipt.receiptNumber || 'receipt'}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        // Fallback: try opening in new tab
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const url = receipt.receiptUrl.startsWith('http') 
          ? receipt.receiptUrl 
          : `${apiBaseUrl}${receipt.receiptUrl.startsWith('/') ? '' : '/'}${receipt.receiptUrl}`;
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Error downloading receipt:', error);
      // Fallback: try opening in new tab
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const url = receipt.receiptUrl.startsWith('http') 
        ? receipt.receiptUrl 
        : `${apiBaseUrl}${receipt.receiptUrl.startsWith('/') ? '' : '/'}${receipt.receiptUrl}`;
      window.open(url, '_blank');
    }
  };

  const handleView = (receipt: Receipt) => {
    if (!receipt.receiptUrl) return;

    // Use the proxy route to ensure headers are included
    const receiptUrl = encodeURIComponent(receipt.receiptUrl);
    const proxyUrl = `/api/receipts/view?url=${receiptUrl}`;
    window.open(proxyUrl, '_blank');
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-muted-foreground">Chargement des reçus...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <p className="mb-2 text-muted-foreground">
              {error instanceof Error ? error.message : "Erreur lors du chargement des reçus"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Téléchargez vos reçus de paiement
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/40 p-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total des Reçus</p>
              <p className="text-2xl font-bold text-foreground">
                {pagination?.total ?? filteredReceipts.length}
              </p>
              {pagination && pagination.total > allReceipts.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  {allReceipts.length} affichés sur {pagination.total}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-muted-foreground">Montant Total</p>
              <p className="text-2xl font-bold text-emerald-400">
                {formatCurrency(
                  filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0)
                )}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
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
          </div>

          {/* Receipts List */}
          {filteredReceipts.length === 0 ? (
            <div className="py-12 text-center">
              <Receipt className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="mb-4 text-muted-foreground">Aucun reçu trouvé</p>
              <p className="text-sm text-muted-foreground/80">
                {allReceipts && allReceipts.length === 0
                  ? "Vos reçus de paiement apparaîtront ici après vos transactions"
                  : "Aucun reçu ne correspond à vos critères de recherche"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredReceipts.map((receipt: Receipt, index: number) => (
                <Card key={receipt.receiptNumber || index} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="rounded-full bg-sky-500/15 p-3">
                          <FileText className="h-6 w-6 text-sky-400" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {receipt.receiptNumber}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span>{getFeeTypeLabel(receipt.feeType)}</span>
                            <span>•</span>
                            <span>{getPaymentMethodLabel(receipt.paymentMethod)}</span>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(receipt.generatedAt || receipt.processedAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-lg text-foreground">
                            {formatCurrency(receipt.amount)}
                          </p>
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Payé
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleView(receipt)}
                            disabled={!receipt.receiptUrl}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleDownload(receipt)}
                            disabled={!receipt.receiptUrl}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Load More Button */}
          {pagination?.hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={loadMoreReceipts}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Chargement...
                  </>
                ) : (
                  <>
                    Charger plus ({pagination.total - allReceipts.length} restants)
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

