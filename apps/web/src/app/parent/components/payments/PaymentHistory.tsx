'use client';

import React, { useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar, CreditCard, AlertCircle, Filter, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { ParentPaymentTransaction, PaymentFilter } from '@ecoledigitale/contracts';

interface PaymentHistoryProps {
  transactions: ParentPaymentTransaction[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  filters?: PaymentFilter;
  onFiltersChange?: (filters: PaymentFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}

export function PaymentHistory({ 
  transactions, 
  isLoading, 
  error,
  children,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange
}: PaymentHistoryProps) {
  // Memoized handlers
  const handleFilterChange = useCallback((key: keyof PaymentFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  }, [filters, onFiltersChange]);

  const handleResetFilters = useCallback(() => {
    const resetFilters: PaymentFilter = {
      childId: undefined,
      feeType: undefined,
      startDate: undefined,
      endDate: undefined,
      status: undefined,
    };
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  }, [onFiltersChange]);

  const handleView = useCallback((receiptUrl: string | null) => {
    if (receiptUrl) {
      window.open(receiptUrl, '_blank');
    }
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    if (onPageChange) {
      onPageChange(newPage);
    }
  }, [onPageChange]);

  // Memoized filtered transactions count
  const transactionsCount = useMemo(() => transactions?.length || 0, [transactions]);


  // Memoized utility functions
  const formatDate = useCallback((dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, []);

  const formatCurrency = useCallback((amount: number, currency: string = 'XOF') => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }, []);

  const getFeeTypeLabel = useCallback((feeType: string) => {
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
  }, []);

  const getPaymentMethodLabel = useCallback((paymentMethod: string | null) => {
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
  }, []);

  const getPaymentMethodIcon = useCallback((paymentMethod: string | null) => {
    if (!paymentMethod) return null;

    switch (paymentMethod) {
      case 'orange_money':
      case 'mtn_money':
      case 'moov_money':
        return '📱'; // Mobile money icon
      case 'card':
        return <CreditCard className="h-4 w-4" aria-hidden="true" />;
      case 'bank_transfer':
        return '🏦'; // Bank icon
      case 'especes':
        return '💵'; // Cash icon
      default:
        return null;
    }
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Complété</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">En attente</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Échoué</Badge>;
      case 'cancelled':
        return <Badge className="bg-gray-100 text-gray-800">Annulé</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }, []);

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Historique des Paiements
          </CardTitle>
          <CardDescription>
            Liste de tous les paiements pour vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4" role="status" aria-label="Chargement de l'historique des paiements">
            {/* Loading skeleton */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-gray-300 rounded-lg p-4 bg-white animate-pulse">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="h-5 bg-gray-200 rounded w-1/3"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  </div>
                  <div className="h-6 bg-gray-200 rounded w-20"></div>
                </div>
              </div>
            ))}
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
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Historique des Paiements
          </CardTitle>
          <CardDescription>
            Liste de tous les paiements pour vos enfants
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
          <CreditCard className="h-5 w-5 text-emerald-600" />
          Historique des Paiements
        </CardTitle>
        <CardDescription>
          Liste de tous les paiements pour vos enfants
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Child Filter */}
              {children && children.length > 0 && (
                <div>
                  <label htmlFor="child-filter" className="block text-sm font-medium text-gray-700 mb-1">
                    Enfant
                  </label>
                  <Select
                    value={filters.childId || 'all'}
                    onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger id="child-filter" className="w-full" aria-label="Filtrer par enfant">
                      <SelectValue placeholder="Tous les enfants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les enfants</SelectItem>
                      {children.map((child, index) => (
                        <SelectItem key={`payment-history-child-${index}`} value={child.id}>
                          {child.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Fee Type Filter */}
              <div>
                <label htmlFor="fee-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Type de frais
                </label>
                <Select
                  value={filters.feeType || 'all'}
                  onValueChange={(value) => handleFilterChange('feeType', value === 'all' ? undefined : value)}
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

              {/* Status Filter */}
              <div>
                <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Statut
                </label>
                <Select
                  value={filters.status || 'all'}
                  onValueChange={(value) => handleFilterChange('status', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger id="status-filter" className="w-full" aria-label="Filtrer par statut">
                    <SelectValue placeholder="Tous les statuts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les statuts</SelectItem>
                    <SelectItem value="completed">Complété</SelectItem>
                    <SelectItem value="pending">En attente</SelectItem>
                    <SelectItem value="failed">Échoué</SelectItem>
                    <SelectItem value="cancelled">Annulé</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div>
                <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 mb-1">
                  Date début
                </label>
                <Input
                  id="start-date"
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
                  className="w-full"
                />
              </div>

              <div>
                <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 mb-1">
                  Date fin
                </label>
                <Input
                  id="end-date"
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
                  className="w-full"
                />
              </div>
            </div>

            {/* Reset Button */}
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                aria-label="Réinitialiser les filtres"
              >
                Réinitialiser les filtres
              </Button>
            </div>
          </div>

          {/* Transactions List */}
          {!transactions || transactions.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <CreditCard className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun paiement</h3>
              <p className="text-gray-600">
                Aucun paiement n'est disponible pour le moment.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {transactions.map((transaction, index) => {
                  // Use composite key to ensure uniqueness even if IDs are duplicated
                  const uniqueKey = `transaction-${transaction.id}-${index}`;
                  
                  return (
                  <div
                    key={uniqueKey}
                    className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Transaction Info */}
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-lg font-semibold text-gray-900">
                            {formatCurrency(transaction.amount, transaction.currency)}
                          </h4>
                          {getStatusBadge(transaction.status)}
                          <Badge variant="outline" className="text-xs text-gray-900">
                            {getFeeTypeLabel(transaction.feeType)}
                          </Badge>
                        </div>

                        {/* Child and Payment Method */}
                        <div className="flex items-center gap-4 mb-2 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">Enfant:</span>
                            <span>{transaction.childName}</span>
                          </div>
                          {transaction.paymentMethod && (
                            <div className="flex items-center gap-1">
                              {typeof getPaymentMethodIcon(transaction.paymentMethod) === 'string' ? (
                                <span className="text-base" aria-hidden="true">
                                  {getPaymentMethodIcon(transaction.paymentMethod)}
                                </span>
                              ) : (
                                getPaymentMethodIcon(transaction.paymentMethod)
                              )}
                              <span className="font-medium">Méthode de paiement:</span>
                              <span>{getPaymentMethodLabel(transaction.paymentMethod)}</span>
                            </div>
                          )}
                        </div>

                        {/* Dates */}
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" aria-hidden="true" />
                            <span className="font-medium">Date:</span>
                            <span>{formatDate(transaction.createdAt)}</span>
                          </div>
                          {transaction.processedAt && (
                            <div className="flex items-center gap-1">
                              <span className="font-medium">Traité le:</span>
                              <span>{formatDate(transaction.processedAt)}</span>
                            </div>
                          )}
                        </div>

                        {/* Receipt */}
                        {transaction.receiptUrl && (
                          <div className="mt-3 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(transaction.receiptUrl!, '_blank')}
                              className="flex items-center gap-2"
                            >
                              <Eye className="h-4 w-4" />
                              Voir le reçu
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-gray-600">
                    Page {pagination.page} sur {pagination.totalPages} ({pagination.total} paiements)
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                      disabled={pagination.page <= 1}
                      aria-label="Page précédente"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages}
                      aria-label="Page suivante"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

