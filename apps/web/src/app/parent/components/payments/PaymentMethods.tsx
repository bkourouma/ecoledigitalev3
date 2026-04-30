'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreditCard, AlertCircle, Smartphone, Building, CheckCircle } from 'lucide-react';
import { PaymentMethod } from '@ecoledigitale/contracts';

interface PaymentMethodsProps {
  methods: PaymentMethod[] | null;
  isLoading?: boolean;
  error?: Error | null;
}

export function PaymentMethods({ 
  methods, 
  isLoading, 
  error
}: PaymentMethodsProps) {
  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Get payment method label
  const getPaymentMethodLabel = (methodType: string) => {
    switch (methodType) {
      case 'card':
        return 'Carte Bancaire';
      case 'bank_transfer':
        return 'Virement Bancaire';
      case 'orange_money':
        return 'Orange Money';
      case 'mtn_money':
        return 'MTN Mobile Money';
      case 'moov_money':
        return 'Moov Money';
      case 'mobile_money':
        return 'Mobile Money';
      default:
        return methodType;
    }
  };

  // Get payment method icon
  const getPaymentMethodIcon = (methodType: string) => {
    switch (methodType) {
      case 'card':
        return <CreditCard className="h-5 w-5 text-blue-600" />;
      case 'bank_transfer':
        return <Building className="h-5 w-5 text-green-600" />;
      case 'orange_money':
      case 'mtn_money':
      case 'moov_money':
      case 'mobile_money':
        return <Smartphone className="h-5 w-5 text-purple-600" />;
      default:
        return <CreditCard className="h-5 w-5 text-gray-600" />;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Méthodes de Paiement
          </CardTitle>
          <CardDescription>
            Consultez vos méthodes de paiement enregistrées
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des méthodes de paiement">
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
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Méthodes de Paiement
          </CardTitle>
          <CardDescription>
            Consultez vos méthodes de paiement enregistrées
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
          Méthodes de Paiement
        </CardTitle>
        <CardDescription>
          Consultez vos méthodes de paiement enregistrées
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Methods List */}
          {!methods || methods.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <CreditCard className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune méthode de paiement</h3>
              <p className="text-gray-600">
                Aucune méthode de paiement n'est enregistrée pour le moment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {methods.map((method) => (
                <div
                  key={method.id}
                  className={`border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow ${
                    method.isDefault ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      {/* Method Icon */}
                      <div className="flex-shrink-0 mt-1">
                        {getPaymentMethodIcon(method.methodType)}
                      </div>

                      {/* Method Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-lg font-semibold text-gray-900">
                            {getPaymentMethodLabel(method.methodType)}
                          </h4>
                          {method.isDefault && (
                            <Badge className="bg-emerald-100 text-emerald-800">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Par défaut
                            </Badge>
                          )}
                        </div>

                        {/* Method Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                          {method.last4Digits && (
                            <div className="flex items-center gap-1">
                              <span className="font-medium">Derniers 4 chiffres:</span>
                              <span className="font-mono font-bold">**** {method.last4Digits}</span>
                            </div>
                          )}
                          {method.expirationDate && (
                            <div className="flex items-center gap-1">
                              <span className="font-medium">Date d'expiration:</span>
                              <span>{formatDate(method.expirationDate)}</span>
                            </div>
                          )}
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

