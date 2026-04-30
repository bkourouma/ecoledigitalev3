'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Filter, AlertCircle, User, Calendar, Download, Eye, RefreshCw, CreditCard, Receipt } from 'lucide-react';
import { PaymentReceiptDocument, PaymentReceiptFilter } from '@ecoledigitale/contracts';
import { usePaymentReceipts } from '@/lib/hooks/use-parent-documents';

interface PaymentReceiptsProps {
  children?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: PaymentReceiptFilter;
  onFiltersChange?: (filters: PaymentReceiptFilter) => void;
}

export function PaymentReceipts({
  children = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: PaymentReceiptsProps) {
  const [localFilters, setLocalFilters] = useState<PaymentReceiptFilter>(filters);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Use the hook with current filters
  const { data, isLoading, error, refetch } = usePaymentReceipts(
    localFilters.childId,
    localFilters.academicYearId,
    localFilters.startDate,
    localFilters.endDate
  );

  const paymentReceipts = data?.data?.paymentReceipts || [];

  // Handle filter change
  const handleFilterChange = (key: keyof PaymentReceiptFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    const newFilters = {
      ...localFilters,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: PaymentReceiptFilter = {};
    setLocalFilters(resetFilters);
    setStartDate('');
    setEndDate('');
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Format currency
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency || 'XOF',
    }).format(amount);
  };

  // Get fee type badge
  const getFeeTypeBadge = (feeType: string) => {
    const feeTypeMap: Record<string, { label: string; className: string }> = {
      tuition: { label: 'Scolarité', className: 'border-sky-500/40 bg-sky-500/15 text-sky-200' },
      inscription: { label: 'Inscription', className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' },
      annexes: { label: 'Annexes', className: 'border-amber-500/40 bg-amber-500/15 text-amber-200' },
      autres: { label: 'Autres', className: 'border-border bg-muted/60 text-muted-foreground' },
    };
    const fee = feeTypeMap[feeType] || feeTypeMap.autres;
    return (
      <Badge variant="outline" className={fee.className}>
        {fee.label}
      </Badge>
    );
  };

  // Get payment method label
  const getPaymentMethodLabel = (method: string) => {
    const methodMap: Record<string, string> = {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      mobile_money: 'Mobile Money',
      check: 'Chèque',
    };
    return methodMap[method] || method;
  };

  // Handle download
  const handleDownload = (receipt: PaymentReceiptDocument) => {
    if (receipt.downloadable && receipt.receiptUrl) {
      window.open(receipt.receiptUrl, '_blank');
    }
  };

  // Handle view
  const handleView = (receipt: PaymentReceiptDocument) => {
    if (receipt.viewable && receipt.receiptUrl) {
      window.open(receipt.receiptUrl, '_blank');
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-400" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Liste des reçus de paiement de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
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
            <Receipt className="h-5 w-5 text-emerald-400" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Liste des reçus de paiement de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
            <h3 className="mb-2 text-lg font-semibold text-destructive">Erreur lors du chargement</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Une erreur est survenue lors du chargement des reçus de paiement.'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (paymentReceipts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-400" />
            Reçus de Paiement
          </CardTitle>
          <CardDescription>
            Liste des reçus de paiement de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Child filter */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Enfant
                </label>
                <Select
                  value={localFilters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.filter(child => child.id).map((child, index) => (
                      <SelectItem key={`payment-receipts-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Academic year filter */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Année Académique
                </label>
                <Select
                  value={localFilters.academicYearId || 'all'}
                  onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.filter(year => year.id).map((year, index) => (
                      <SelectItem key={year.id || `payment-receipts-year-empty-${index}`} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date range filters */}
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="startDate">Date de début</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={handleDateRangeChange}
                />
              </div>
              <div>
                <Label htmlFor="endDate">Date de fin</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={handleDateRangeChange}
                />
              </div>
            </div>

            {(localFilters.childId || localFilters.academicYearId || localFilters.startDate || localFilters.endDate) && (
              <div className="mt-4">
                <Button onClick={handleResetFilters} variant="outline" size="sm">
                  Réinitialiser les filtres
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold text-foreground">Aucun reçu de paiement disponible</h3>
            <p className="text-sm text-muted-foreground">
              Aucun reçu de paiement n'a été trouvé pour les critères sélectionnés.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-emerald-400" />
          Reçus de Paiement
        </CardTitle>
        <CardDescription>
          Liste des reçus de paiement de vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Child filter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Enfant
              </label>
              <Select
                value={localFilters.childId || 'all'}
                onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={child.id || `payment-receipts-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Academic year filter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Année Académique
              </label>
              <Select
                value={localFilters.academicYearId || 'all'}
                onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Toutes les années" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les années</SelectItem>
                  {academicYears.map((year, index) => (
                    <SelectItem key={year.id || `payment-receipts-year-${index}`} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date range filters */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="startDate">Date de début</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onBlur={handleDateRangeChange}
              />
            </div>
            <div>
              <Label htmlFor="endDate">Date de fin</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onBlur={handleDateRangeChange}
              />
            </div>
          </div>

          {(localFilters.childId || localFilters.academicYearId || localFilters.startDate || localFilters.endDate) && (
            <div className="mt-4">
              <Button onClick={handleResetFilters} variant="outline" size="sm">
                Réinitialiser les filtres
              </Button>
            </div>
          )}
        </div>

        {/* Payment receipts list */}
        <div className="space-y-4">
          {paymentReceipts.map((receipt, index) => (
            <Card key={receipt.receiptId || `payment-receipt-${index}`} className="border border-border transition-colors hover:border-emerald-500/40">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-lg font-semibold text-foreground">{receipt.childName}</h3>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground md:grid-cols-4">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>N° {receipt.receiptNumber || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{receipt.academicYearName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{formatDate(receipt.paymentDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{getPaymentMethodLabel(receipt.paymentMethod)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {getFeeTypeBadge(receipt.feeType)}
                      <span className="text-lg font-semibold text-foreground">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {receipt.downloadable && (
                      <Button
                        onClick={() => handleDownload(receipt)}
                        variant="outline"
                        size="sm"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Télécharger
                      </Button>
                    )}
                    {receipt.viewable && (
                      <Button
                        onClick={() => handleView(receipt)}
                        variant="default"
                        size="sm"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Voir
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

