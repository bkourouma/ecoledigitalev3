'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Receipt, AlertCircle, Filter, Download, Eye, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { PaymentReceipt, PaymentFilter } from '@ecoledigitale/contracts';

interface ReceiptsProps {
  receipts: PaymentReceipt[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  filters?: { feeType?: 'tuition' | 'inscription' | 'annexes' | 'autres'; startDate?: string; endDate?: string };
  onFiltersChange?: (filters: { feeType?: 'tuition' | 'inscription' | 'annexes' | 'autres'; startDate?: string; endDate?: string }) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}

export function Receipts({ 
  receipts, 
  isLoading, 
  error,
  children,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange
}: ReceiptsProps) {
  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Format currency
  const formatCurrency = (amount: number, currency: string = 'XOF') => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get fee type label
  const getFeeTypeLabel = (feeType: string) => {
    switch (feeType) {
      case 'tuition':
        return 'Scolarité';
      case 'inscription':
        return 'Inscription';
      case 'annexes':
        return 'Annexes';
      case 'autres':
        return 'Autres';
      default:
        return feeType;
    }
  };

  // Get payment method label
  const getPaymentMethodLabel = (paymentMethod: string | null) => {
    if (!paymentMethod) return 'Non spécifié';

    switch (paymentMethod) {
      case 'orange_money':
        return 'Orange Money';
      case 'mtn_money':
        return 'MTN Mobile Money';
      case 'moov_money':
        return 'Moov Money';
      case 'card':
        return 'Carte Bancaire';
      case 'bank_transfer':
        return 'Virement Bancaire';
      case 'especes':
        return 'Espèces';
      default:
        return paymentMethod;
    }
  };

  // Handle filter change
  const handleFilterChange = (key: 'feeType' | 'startDate' | 'endDate', value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle download
  const handleDownload = (receipt: PaymentReceipt) => {
    if (receipt.receiptUrl) {
      window.open(reipt.receiptUrl, '_blank');
    }
  };

  // Handle view
  const handleView = (receipt: PaymentReceipt) => {
    if (receipt.receiptUrl) {
      window.open(reipt.receiptUrl, '_blank');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-600" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Consultez et téléchargez les reçus de paiement pour vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des reçus">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-600" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Consultez et téléchargez les reçus de paiement pour vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium">Erreur lors du chargement</p>
            <p className="text-gray-600 text-sm mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-emerald-600" />
          Reçus de Paiement
        </CardTitle>
        <CardDescription>
          Consultez et téléchargez les reçus de paiement pour vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Filters */}
          <div className="border border-gray-300 rounded-lg p-4 bg-white">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-5 w-5 text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-900">Filtres</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="fee-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Type de frais
                </label>
                <Select
                  value={filters.feeType || 'all'}
                  onValueChange={(value) => handleFilterChange('feeType', value === 'all' ? undefined : value as any)}
                >
                  <SelectTrigger id="fee-type-filter" className="w-full" aria-label="Filtrer par type de frais">
                    <SelectValue placeholder="Tous les types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les types</SelectItem>
                    <SelectItem value="tuition">Scolarité</SelectItem>
                    <SelectItem value="inscription">Inscription</SelectItem>
                    <SelectItem value="annexes">Annexes</SelectItem>
                    <SelectItem value="autres">Autres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="start-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Date de début
                </label>
                <Input
                  id="start-date-filter"
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
                  className="w-full"
                  aria-label="Filtrer par date de début"
                />
              </div>
              <div>
                <label htmlFor="end-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Date de fin
                </label>
                <Input
                  id="end-date-filter"
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
                  className="w-full"
                  aria-label="Filtrer par date de fin"
                />
              </div>
            </div>
          </div>

          {/* Receipts List */}
          {!receipts || receipts.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <Receipt className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun reçu</h3>
              <p className="text-gray-600">
                Aucun reçu de paiement n'est disponible pour le moment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {receipts.map((receipt) => (
                <div
                  key={receipt.id}
                  className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Receipt Info */}
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">
                          Reçu #{receipt.receiptNumber}
                        </h4>
                        <Badge variant="outline" className="text-xs">
                          {getFeeTypeLabel(receipt.feeType)}
                        </Badge>
                      </div>

                      {/* Child Info */}
                      <div className="flex items-center gap-4 mb-2 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Enfant:</span>
                          <span>{receipt.childName}</span>
                        </div>
                      </div>

                      {/* Payment Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Date de paiement:</span>
                          <span>{formatDate(receipt.processedAt || receipt.generatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Montant:</span>
                          <span className="font-bold text-gray-900">{formatCurrency(receipt.amount, receipt.currency || 'XOF')}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Méthode de paiement:</span>
                          <span>{getPaymentMethodLabel(receipt.paymentMethod)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Date de génération:</span>
                          <span>{formatDate(receipt.generatedAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleView(receipt)}
                        className="flex items-center gap-1"
                        aria-label={`Voir le reçu ${receipt.receiptNumber}`}
                      >
                        <Eye className="h-4 w-4" />
                        Voir
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleDownload(receipt)}
                        className="flex items-center gap-1"
                        aria-label={`Télécharger le reçu ${receipt.receiptNumber}`}
                      >
                        <Download className="h-4 w-4" />
                        Télécharger
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
              <div className="text-sm text-gray-600">
                Affichage de {((pagination.page - 1) * pagination.limit) + 1} à {Math.min(pagination.page * pagination.limit, pagination.total)} sur {pagination.total} reçus
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  aria-label="Page précédente"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Précédent
                </Button>
                <div className="text-sm text-gray-600">
                  Page {pagination.page} sur {pagination.totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  aria-label="Page suivante"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

