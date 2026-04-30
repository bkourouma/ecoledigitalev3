"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Settings, Edit, Trash2, User, DollarSign, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useActiveAcademicYear } from '@/lib/hooks/use-academic-years';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';


interface TeacherPaymentConfig {
  id: string;
  tenantId: string;
  academicYearId?: string | null;
  teacherId: string;
  configType: 'salary' | 'hourly' | 'mixed';
  monthlySalary?: number;
  annualSalary?: number;
  defaultHourlyRate?: number;
  overtimeThreshold: number;
  overtimeMultiplier: number;
  effectiveFrom: string;
  effectiveTo?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  teacherName: string;
  teacherEmail: string;
}


const configTypeLabels = {
  salary: 'Salaire',
  hourly: 'Horaire',
  mixed: 'Mixte',
};

const configTypeColors = {
  salary: 'bg-blue-100 text-blue-800',
  hourly: 'bg-green-100 text-green-800',
  mixed: 'bg-purple-100 text-purple-800',
};

export default function TeacherPaymentConfigsPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<TeacherPaymentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;

  useEffect(() => {
    fetchConfigs();
  }, [activeAcademicYearId]);

  const fetchConfigs = async () => {
    try {
      const response = await fetch('/api/v1/teacher-payment-configs', {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });
      if (response.ok) {
        const data = await response.json();
        setConfigs(data.data);
      } else {
        toast({
          title: "Erreur",
          description: "Impossible de charger les configurations",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };




  const handleDeleteConfig = async (configId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette configuration ?')) return;

    try {
      const response = await fetch(`/api/v1/teacher-payment-configs/${configId}`, {
        method: 'DELETE',
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });

      if (response.ok) {
        toast({
          title: "Succès",
          description: "Configuration supprimée avec succès",
        });
        fetchConfigs();
      } else {
        const error = await response.json();
        toast({
          title: "Erreur",
          description: error.message || "Impossible de supprimer la configuration",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    }
  };



  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
            Configuration des Paiements
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les configurations de paiement des enseignants
          </p>
        </div>
        <Button onClick={() => router.push('/payments/teacher-configs/new')}>
          <Plus className="w-4 h-4 mr-2" />
          Nouvelle Configuration
        </Button>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <Settings className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune configuration trouvée</h3>
                <p className="text-gray-600">Commencez par créer votre première configuration de paiement</p>
              </div>
              <Button onClick={() => router.push('/payments/teacher-configs/new')}>
                <Plus className="w-4 h-4 mr-2" />
                Créer ma première configuration
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {configs.map((config) => (
            <Card key={config.id} className="shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 mb-2">
                      <User className="w-5 h-5 text-blue-600" />
                      <span>{config.teacherName}</span>
                      <Badge className={configTypeColors[config.configType]}>
                        {configTypeLabels[config.configType]}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <span className="block sm:inline">{config.teacherEmail}</span>
                      <span className="hidden sm:inline"> • </span>
                      <span className="block sm:inline">
                        Effectif du {format(new Date(config.effectiveFrom), 'dd MMMM yyyy', { locale: fr })}
                        {config.effectiveTo && (
                          <> au {format(new Date(config.effectiveTo), 'dd MMMM yyyy', { locale: fr })}</>
                        )}
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/payments/teacher-configs/${config.id}/edit`)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteConfig(config.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {config.monthlySalary && (
                    <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                      <DollarSign className="w-5 h-5 text-green-600 mt-1 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700">Salaire mensuel</p>
                        <p className="text-lg font-bold text-gray-900">{config.monthlySalary?.toLocaleString('fr-FR')} FCFA</p>
                      </div>
                    </div>
                  )}
                  {config.defaultHourlyRate && (
                    <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
                      <Clock className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700">Taux horaire</p>
                        <p className="text-lg font-bold text-gray-900">{config.defaultHourlyRate.toLocaleString('fr-FR')} FCFA/h</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3 p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <Settings className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700">Seuil heures sup.</p>
                      <p className="text-lg font-bold text-gray-900">{config.overtimeThreshold}h</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border border-orange-100">
                    <Settings className="w-5 h-5 text-orange-600 mt-1 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700">Multiplicateur</p>
                      <p className="text-lg font-bold text-gray-900">×{config.overtimeMultiplier}</p>
                    </div>
                  </div>
                </div>
                {config.notes && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm font-medium text-gray-700 mb-1">Notes</p>
                    <p className="text-sm text-gray-600">{config.notes}</p>
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