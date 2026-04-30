'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Filter, DollarSign, TrendingUp, CheckCircle } from 'lucide-react';
import { OutstandingBalance } from '@ecoledigitale/contracts';

interface OutstandingBalancesProps {
  balances: OutstandingBalance[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  selectedFeeType?: 'tuition' | 'inscription' | 'annexes' | 'autres';
  onChildChange?: (childId: string | undefined) => void;
  onFeeTypeChange?: (feeType: 'tuition' | 'inscription' | 'annexes' | 'autres' | undefined) => void;
}

export function OutstandingBalances({ 
  balances, 
  isLoading, 
  error,
  children,
  selectedChildId,
  selectedFeeType,
  onChildChange,
  onFeeTypeChange
}: OutstandingBalancesProps) {
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

  // Get fee type badge color
  const getFeeTypeBadge = (feeType: string) => {
    switch (feeType) {
      case 'tuition':
        return <Badge className="bg-blue-100 text-blue-800">{getFeeTypeLabel(feeType)}</Badge>;
      case 'inscription':
        return <Badge className="bg-purple-100 text-purple-800">{getFeeTypeLabel(feeType)}</Badge>;
      case 'annexes':
        return <Badge className="bg-orange-100 text-orange-800">{getFeeTypeLabel(feeType)}</Badge>;
      case 'autres':
        return <Badge className="bg-gray-100 text-gray-800">{getFeeTypeLabel(feeType)}</Badge>;
      default:
        return <Badge variant="secondary">{feeType}</Badge>;
    }
  };

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Handle fee type filter change
  const handleFeeTypeChange = (value: string) => {
    if (onFeeTypeChange) {
      onFeeTypeChange(value === 'all' ? undefined : value as 'tuition' | 'inscription' | 'annexes' | 'autres');
    }
  };

  // Calculate totals
  const totals = balances?.reduce((acc, balance) => {
    acc.totalOutstanding += balance.totalOutstanding;
    acc.amountPaid += balance.amountPaid;
    acc.amountDue += balance.amountDue;
    return acc;
  }, { totalOutstanding: 0, amountPaid: 0, amountDue: 0 }) || { totalOutstanding: 0, amountPaid: 0, amountDue: 0 };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            Soldes Impayés
          </CardTitle>
          <CardDescription>
            Consultez les soldes impayés pour vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des soldes">
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
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            Soldes Impayés
          </CardTitle>
          <CardDescription>
            Consultez les soldes impayés pour vos enfants
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
          <TrendingUp className="h-5 w-5 text-emerald-600" />
          Soldes Impayés
        </CardTitle>
        <CardDescription>
          Consultez les soldes impayés pour vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Filters */}
          {(children && children.length > 0) || true ? (
            <div className="border border-gray-300 rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-5 w-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">Filtre</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {children && children.length > 0 && (
                  <div>
                    <label htmlFor="child-filter" className="block text-sm font-medium text-gray-700 mb-1">
                      Enfant
                    </label>
                    <Select
                      value={selectedChildId || 'all'}
                      onValueChange={handleChildChange}
                    >
                      <SelectTrigger id="child-filter" className="w-full" aria-label="Filtrer par enfant">
                        <SelectValue placeholder="Tous les enfants" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous les enfants</SelectItem>
                        {children.map((child, index) => (
                          <SelectItem key={`outstanding-balances-child-${index}`} value={child.id}>
                            {child.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <label htmlFor="fee-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                    Type de frais
                  </label>
                  <Select
                    value={selectedFeeType || 'all'}
                    onValueChange={handleFeeTypeChange}
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
              </div>
            </div>
          ) : null}

          {/* Summary */}
          {balances && balances.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-red-600" />
                  <span className="text-sm font-medium text-red-900">Total Impayé</span>
                </div>
                <div className="text-2xl font-bold text-red-600" aria-live="polite">
                  {formatCurrency(totals.totalOutstanding)}
                </div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium text-green-900">Total Payé</span>
                </div>
                <div className="text-2xl font-bold text-green-600" aria-live="polite">
                  {formatCurrency(totals.amountPaid)}
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Total Dû</span>
                </div>
                <div className="text-2xl font-bold text-blue-600" aria-live="polite">
                  {formatCurrency(totals.amountDue)}
                </div>
              </div>
            </div>
          )}

          {/* Balances List */}
          {!balances || balances.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <CheckCircle className="mx-auto h-16 w-16 text-green-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun solde impayé</h3>
              <p className="text-gray-600">
                Tous les paiements sont à jour. Aucun solde impayé pour le moment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {balances.map((balance, index) => (
                <div
                  key={`${balance.studentId}-${balance.feeType}-${index}`}
                  className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Balance Info */}
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">
                          {balance.childName}
                        </h4>
                        {getFeeTypeBadge(balance.feeType)}
                      </div>

                      {/* Balance Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        <div className="flex items-center gap-1 text-red-600">
                          <TrendingUp className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Impayé:</span>
                          <span className="font-bold">{formatCurrency(balance.totalOutstanding)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Payé:</span>
                          <span className="font-bold">{formatCurrency(balance.amountPaid)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-blue-600">
                          <DollarSign className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Total dû:</span>
                          <span className="font-bold">{formatCurrency(balance.amountDue)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

