'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, AlertCircle, Filter, ChevronDown, ChevronRight, DollarSign, Clock } from 'lucide-react';
import { PaymentSchedule } from '@ecoledigitale/contracts';

interface PaymentSchedulesProps {
  schedules: PaymentSchedule[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  onChildChange?: (childId: string | undefined) => void;
}

export function PaymentSchedules({ 
  schedules, 
  isLoading, 
  error,
  children,
  selectedChildId,
  onChildChange
}: PaymentSchedulesProps) {
  const [expandedSchedules, setExpandedSchedules] = useState<Set<string>>(new Set());

  // Toggle schedule expansion
  const toggleSchedule = (scheduleId: string) => {
    const newExpanded = new Set(expandedSchedules);
    if (newExpanded.has(scheduleId)) {
      newExpanded.delete(scheduleId);
    } else {
      newExpanded.add(scheduleId);
    }
    setExpandedSchedules(newExpanded);
  };

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

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-100 text-green-800">Payé</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">En attente</Badge>;
      case 'overdue':
        return <Badge className="bg-red-100 text-red-800">En retard</Badge>;
      case 'partial':
        return <Badge className="bg-blue-100 text-blue-800">Partiel</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Échéanciers de Paiement
          </CardTitle>
          <CardDescription>
            Liste des échéanciers de paiement pour vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des échéanciers">
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
            <Calendar className="h-5 w-5 text-emerald-600" />
            Échéanciers de Paiement
          </CardTitle>
          <CardDescription>
            Liste des échéanciers de paiement pour vos enfants
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
          <Calendar className="h-5 w-5 text-emerald-600" />
          Échéanciers de Paiement
        </CardTitle>
        <CardDescription>
          Liste des échéanciers de paiement pour vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Child Filter */}
          {children && children.length > 0 && (
            <div className="border border-gray-300 rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-5 w-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">Filtre</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <SelectItem key={`payment-schedules-child-${index}`} value={child.id}>
                          {child.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Schedules List */}
          {!schedules || schedules.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <Calendar className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun échéancier</h3>
              <p className="text-gray-600">
                Aucun échéancier de paiement n'est disponible pour le moment.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {schedules.map((schedule, index) => {
                const isExpanded = expandedSchedules.has(schedule.id);
                const totalPaid = schedule.installments?.reduce((sum, inst) => sum + (inst.amountPaid || 0), 0) || 0;
                const totalOutstanding = schedule.totalTuition - totalPaid;
                
                // Use composite key to ensure uniqueness even if IDs are duplicated
                const uniqueKey = `schedule-${schedule.id}-${index}`;
                
                return (
                  <div
                    key={uniqueKey}
                    className="border border-gray-300 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* Schedule Header */}
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="text-lg font-semibold text-gray-900">
                              {schedule.scheduleName}
                            </h4>
                            <Badge variant="outline" className="text-xs text-gray-900">
                              {schedule.academicYear}
                            </Badge>
                          </div>

                          {/* Child Info */}
                          <div className="flex items-center gap-4 mb-3 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">Enfant:</span>
                              <span>{schedule.childName}</span>
                            </div>
                          </div>

                          {/* Schedule Summary */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                            <div className="flex items-center gap-1 text-gray-600">
                              <DollarSign className="h-4 w-4" aria-hidden="true" />
                              <span className="font-medium">Total scolarité:</span>
                              <span className="font-bold">{formatCurrency(schedule.totalTuition)}</span>
                            </div>
                            <div className="flex items-center gap-1 text-gray-600">
                              <span className="font-medium">Nombre d'échéances:</span>
                              <span className="font-bold">{schedule.numberOfInstallments}</span>
                            </div>
                            <div className="flex items-center gap-1 text-gray-600">
                              <span className="font-medium">Payé:</span>
                              <span className="text-green-600 font-bold">{formatCurrency(totalPaid)}</span>
                            </div>
                            {totalOutstanding > 0 && (
                              <div className="flex items-center gap-1 text-red-600">
                                <span className="font-medium">Reste à payer:</span>
                                <span className="font-bold">{formatCurrency(totalOutstanding)}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Expand/Collapse Button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSchedule(schedule.id)}
                          className="ml-4"
                          aria-label={isExpanded ? 'Réduire' : 'Développer'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronRight className="h-5 w-5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Installments List (Expanded) */}
                    {isExpanded && schedule.installments && schedule.installments.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        <div className="p-4 space-y-3">
                          <h5 className="text-sm font-semibold text-gray-700 mb-3">Échéances détaillées:</h5>
                          {schedule.installments.map((installment) => {
                            const remainingAmount = installment.amount - (installment.amountPaid || 0);
                            const isOverdue = installment.dueDate && 
                              new Date(installment.dueDate) < new Date() && 
                              installment.status !== 'paid';
                            
                            return (
                              <div
                                key={installment.installmentNumber}
                                className={`border rounded-lg p-3 bg-white ${
                                  isOverdue ? 'border-red-300 bg-red-50' : 'border-gray-200'
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="font-semibold text-gray-900">
                                        Échéance {installment.installmentNumber} - {installment.installmentLabel}
                                      </span>
                                      {getStatusBadge(installment.status)}
                                      {isOverdue && (
                                        <Badge className="bg-red-100 text-red-800">En retard</Badge>
                                      )}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                                      <div className="flex items-center gap-1">
                                        <DollarSign className="h-4 w-4" aria-hidden="true" />
                                        <span className="font-medium">Montant:</span>
                                        <span>{formatCurrency(installment.amount)}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Calendar className="h-4 w-4" aria-hidden="true" />
                                        <span className="font-medium">Date d'échéance:</span>
                                        <span className={isOverdue ? 'text-red-600 font-bold' : ''}>
                                          {formatDate(installment.dueDate)}
                                        </span>
                                      </div>
                                      {installment.amountPaid > 0 && (
                                        <div className="flex items-center gap-1 text-green-600">
                                          <span className="font-medium">Payé:</span>
                                          <span className="font-bold">{formatCurrency(installment.amountPaid)}</span>
                                        </div>
                                      )}
                                      {remainingAmount > 0 && (
                                        <div className="flex items-center gap-1 text-red-600">
                                          <span className="font-medium">Reste:</span>
                                          <span className="font-bold">{formatCurrency(remainingAmount)}</span>
                                        </div>
                                      )}
                                      {installment.lateFee > 0 && (
                                        <div className="flex items-center gap-1 text-red-600">
                                          <span className="font-medium">Frais de retard:</span>
                                          <span className="font-bold">{formatCurrency(installment.lateFee)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

