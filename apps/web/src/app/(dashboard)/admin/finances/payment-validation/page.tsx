'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@ecoledigitale/ui';
import { Button } from '@ecoledigitale/ui';
import { Badge } from '@ecoledigitale/ui';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle,
  RefreshCw,
  Eye,
  DollarSign
} from 'lucide-react';

interface PaymentTransaction {
  id: string;
  studentId: string;
  studentName: string;
  enrollmentId: string;
  feeType: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  externalTransactionId: string;
  createdAt: string;
  processedAt?: string;
  gatewayResponse?: any;
}

export default function PaymentValidationPage() {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      // Fetch recent completed transactions instead of pending ones
      const response = await fetch('/api/v1/student-payments/recent', {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const data = await response.json();
      setTransactions(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    fetchTransactions();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Complété</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />En attente</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800"><RefreshCw className="w-3 h-3 mr-1" />En cours</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800"><AlertTriangle className="w-3 h-3 mr-1" />{status}</Badge>;
    }
  };

  const getFeeTypeLabel = (feeType: string) => {
    switch (feeType) {
      case 'inscription': return 'Inscription';
      case 'scolarite': return 'Scolarité';
      case 'annexes': return 'Frais annexes';
      case 'autres': return 'Autres frais';
      default: return feeType;
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <span className="ml-2">Chargement des transactions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center text-red-600">
              <XCircle className="w-5 h-5 mr-2" />
              <span>Erreur: {error}</span>
            </div>
            <Button onClick={fetchTransactions} className="mt-4">
              <RefreshCw className="w-4 h-4 mr-2" />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Historique des Paiements</h1>
          <p className="text-gray-600">Consultez les paiements récents enregistrés</p>
        </div>
        <Button onClick={fetchTransactions} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <DollarSign className="w-12 h-12 mx-auto text-blue-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Aucun paiement récent</h3>
            <p className="text-gray-600">Aucun paiement n'a été enregistré récemment.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {transactions.map((transaction) => (
            <Card key={transaction.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{transaction.studentName}</CardTitle>
                    <p className="text-sm text-gray-600">
                      {getFeeTypeLabel(transaction.feeType)} • {transaction.paymentMethod}
                    </p>
                  </div>
                  <div className="text-right">
                    {getStatusBadge(transaction.status)}
                    <p className="text-lg font-bold mt-1">
                      {formatAmount(transaction.amount, transaction.currency)}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">ID Transaction</p>
                    <p className="font-mono text-sm">{transaction.id.slice(0, 8)}...</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">ID Externe</p>
                    <p className="font-mono text-sm">{transaction.externalTransactionId?.slice(0, 12)}...</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Date de création</p>
                    <p className="text-sm">{new Date(transaction.createdAt).toLocaleString('fr-FR')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Méthode</p>
                    <p className="text-sm capitalize">{transaction.paymentMethod.replace('_', ' ')}</p>
                  </div>
                </div>

                {transaction.processedAt && (
                  <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
                    <div className="flex items-center text-green-800">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      <p className="text-sm font-medium">
                        Paiement enregistré le: {new Date(transaction.processedAt).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
