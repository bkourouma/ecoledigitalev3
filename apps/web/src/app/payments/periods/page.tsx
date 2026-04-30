"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Calendar, Edit, Trash2, CheckCircle, XCircle, Archive, Loader2, AlertCircle } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from "@ecoledigitale/ui";
import { usePaymentPeriods, useUpdatePaymentPeriodStatus, useDeletePaymentPeriod } from "@/lib/hooks/use-payment-periods";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const statusColors = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  closed: 'bg-blue-100 text-blue-800',
  archived: 'bg-red-100 text-red-800',
};

const statusLabels = {
  draft: 'Brouillon',
  active: 'Actif',
  closed: 'Fermé',
  archived: 'Archivé',
};

export default function PaymentPeriodsPage() {
  const router = useRouter();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const { data: periodsData, isLoading, error } = usePaymentPeriods({
    academicYearScopeKey: activeAcademicYearId,
  });
  const updateStatusMutation = useUpdatePaymentPeriodStatus();
  const deletePeriodMutation = useDeletePaymentPeriod();
  
  const periods = periodsData?.data || [];
  const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const handleCreateNew = () => {
    router.push("/payments/periods/new");
  };

  const handleEdit = (periodId: string) => {
    router.push(`/payments/periods/${periodId}/edit`);
  };

  const handleStatusChange = async (periodId: string, newStatus: string) => {
    try {
      await updateStatusMutation.mutateAsync({ id: periodId, status: newStatus });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleDeletePeriod = async (periodId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette période ?')) return;
    
    try {
      await deletePeriodMutation.mutateAsync({ id: periodId, cascade: false });
    } catch (error) {
      console.error("Error deleting period:", error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Une erreur est survenue lors de la suppression de la période';
      
      // Vérifier si l'erreur contient des informations sur les paiements
      const hasPayments = errorMessage.includes('contient') && 
                         (errorMessage.includes('paiement') || errorMessage.includes('paiements'));
      const paymentCount = (error as any)?.paymentCount;
      
      // Si l'erreur indique qu'il y a des paiements, proposer la suppression en cascade
      if (hasPayments || paymentCount !== undefined) {
        const paymentText = paymentCount 
          ? `${paymentCount} paiement${paymentCount > 1 ? 's' : ''}`
          : 'des paiements';
        const confirmCascade = confirm(
          `${errorMessage}\n\nVoulez-vous supprimer cette période ainsi que tous les paiements associés (${paymentText}) ?\n\n⚠️ Cette action est irréversible.`
        );
        
        if (confirmCascade) {
          try {
            await deletePeriodMutation.mutateAsync({ id: periodId, cascade: true });
          } catch (cascadeError) {
            console.error("Error deleting period with cascade:", cascadeError);
            const cascadeErrorMessage = cascadeError instanceof Error 
              ? cascadeError.message 
              : 'Une erreur est survenue lors de la suppression en cascade';
            alert(cascadeErrorMessage);
          }
        }
      } else {
        alert(errorMessage);
      }
    }
  };

  const handlePurgeDev = async () => {
    if (!confirm('Voulez-vous PURGER TOUTES les périodes de paiement pour ce tenant ?')) return;
    try {
      const res = await fetch('/api/v1/payment-periods/purge-dev', {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "imhotepacademy",
          "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
        }
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Purge effectuée: Avant: ${data.data.before.periods}/${data.data.before.payments} - Après: ${data.data.after.periods}/${data.data.after.payments}`);
        window.location.reload();
      } else {
        const err = await res.text();
        alert(`Erreur purge: ${err}`);
      }
    } catch (e) {
      const msg = (e as any)?.message ?? String(e);
      alert(`Erreur purge: ${msg}`);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Périodes de Paiement</h2>
            <p className="text-muted-foreground">
              Gérez les périodes de paiement des enseignants
            </p>
          </div>
        </div>

        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground">Erreur de chargement</h3>
                <p className="text-muted-foreground">
                  Impossible de charger les périodes. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => window.location.reload()} className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white">
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
          </div>
          <p className="text-muted-foreground text-lg">Chargement des périodes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
            Périodes de Paiement
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les périodes de paiement des enseignants
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDev && (
            <Button
              variant="destructive"
              onClick={handlePurgeDev}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Purger toutes les périodes (DEV)
            </Button>
          )}
          <Button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle période
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-orange-500 to-amber-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total périodes
                </p>
                <p className="text-3xl font-bold mt-1">{periods.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Calendar className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Actives
                </p>
                <p className="text-3xl font-bold mt-1">
                  {periods.filter(p => p.status === 'active').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <CheckCircle className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Fermées
                </p>
                <p className="text-3xl font-bold mt-1">
                  {periods.filter(p => p.status === 'closed').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <XCircle className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-500 to-slate-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Brouillons
                </p>
                <p className="text-3xl font-bold mt-1">
                  {periods.filter(p => p.status === 'draft').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Archive className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Periods List */}
      {!isLoading && periods.length > 0 && (
        <div className="grid gap-4">
          {periods.map((period) => (
            <Card key={period.id} className="bg-card border-border shadow-lg hover:shadow-xl transition-all duration-300">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Calendar className="w-5 h-5 text-orange-600" />
                      {period.name}
                      <Badge className={statusColors[period.status]}>
                        {statusLabels[period.status]}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-muted-foreground mt-2">
                      {format(new Date(period.periodStart), 'dd MMMM yyyy', { locale: fr })} - {' '}
                      {format(new Date(period.periodEnd), 'dd MMMM yyyy', { locale: fr })}
                    </CardDescription>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(period.id)}
                      disabled={period.status === 'archived'}
                      className="bg-background hover:bg-accent border-border text-foreground"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {period.status === 'draft' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange(period.id, 'active')}
                        disabled={updateStatusMutation.isPending}
                        className="bg-background hover:bg-green-50 border-border text-foreground hover:text-green-700"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    )}
                    {period.status === 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange(period.id, 'closed')}
                        disabled={updateStatusMutation.isPending}
                        className="bg-background hover:bg-blue-50 border-border text-foreground hover:text-blue-700"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    )}
                    {period.status === 'closed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange(period.id, 'archived')}
                        disabled={updateStatusMutation.isPending}
                        className="bg-background hover:bg-red-50 border-border text-foreground hover:text-red-700"
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeletePeriod(period.id)}
                      disabled={period.status !== 'draft' || deletePeriodMutation.isPending}
                      className="bg-background hover:bg-destructive/10 border-border text-foreground hover:text-destructive"
                    >
                      {deletePeriodMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {period.description && (
                <CardContent>
                  <p className="text-muted-foreground">{period.description}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && periods.length === 0 && (
        <Card className="bg-card border-border shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Calendar className="h-10 w-10 text-orange-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Aucune période de paiement</h3>
                <p className="text-muted-foreground text-lg">
                  Commencez par créer votre première période de paiement pour gérer les rémunérations des enseignants.
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer ma première période
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}