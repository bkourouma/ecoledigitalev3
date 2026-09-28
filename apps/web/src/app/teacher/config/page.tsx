"use client";

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Settings,
  DollarSign,
  Clock,
  Calendar,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle,
  Info
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle, 
  Button, 
  Input,
  Label,
  Badge,
  Alert
} from "@ecoledigitale/ui";
import { useCurrentTeacherId } from '@/lib/hooks/use-teachers';
import { useToast } from '@/components/ui/use-toast';
import { Textarea } from "@ecoledigitale/ui";

interface TeacherPaymentConfig {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export default function TeacherConfigPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const { data: teacherId, isLoading: isLoadingTeacherId } = useCurrentTeacherId();
  
  const [config, setConfig] = useState<TeacherPaymentConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<TeacherPaymentConfig>>({});

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, router]);

  // Fetch current config
  useEffect(() => {
    if (teacherId) {
      fetchCurrentConfig();
    }
  }, [teacherId]);

  const fetchCurrentConfig = async () => {
    if (!teacherId) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/v1/teacher-payment-configs/teacher/${teacherId}/current`, {
        headers: {
          "Content-Type": "application/json"
        },
      });

      if (response.ok) {
        const data = await response.json();
        const configData = data.data || data;
        setConfig(configData);
        setFormData(configData);
      } else if (response.status === 404) {
        // No config found - that's okay, teacher might not have one yet
        setConfig(null);
      } else {
        const error = await response.json().catch(() => ({}));
        toast({
          title: "Erreur",
          description: error.message || "Impossible de charger la configuration",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config || !teacherId) return;

    setIsSaving(true);
    try {
      // Only allow updating notes - other fields are managed by admin
      const response = await fetch(`/api/v1/teacher-payment-configs/${config.id}`, {
        method: 'PUT',
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: formData.notes,
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setConfig(updated.data || updated);
        setIsEditing(false);
        toast({
          title: "Configuration mise à jour",
          description: "Votre configuration de paiement a été mise à jour avec succès.",
          variant: "success",
        });
        fetchCurrentConfig(); // Refresh
      } else {
        const error = await response.json().catch(() => ({}));
        toast({
          title: "Erreur",
          description: error.message || "Impossible de mettre à jour la configuration",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error saving config:', error);
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatAmount = (amount: number) => {
    return amount.toLocaleString('fr-FR') + ' FCFA';
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Non défini';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getConfigTypeLabel = (type: string) => {
    switch (type) {
      case 'salary':
        return 'Salaire fixe';
      case 'hourly':
        return 'Taux horaire';
      case 'mixed':
        return 'Mixte (Salaire + Horaire)';
      default:
        return type;
    }
  };

  if (status === 'loading' || isLoadingTeacherId || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-gray-600">Chargement...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-gray-900 flex items-center whitespace-nowrap text-2xl leading-tight md:text-3xl">
                <Settings className="w-8 h-8 text-purple-600 mr-3" />
                Configuration Personnelle
              </h1>
              <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                Gérez votre configuration de paiement et rémunération
              </p>
            </div>
          </div>
        </div>

        {!config ? (
          <Card>
            <CardContent className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Aucune configuration trouvée
              </h3>
              <p className="text-gray-500 mb-4">
                Votre configuration de paiement n'a pas encore été définie par l'administration.
              </p>
              <p className="text-sm text-gray-400">
                Contactez l'administration pour configurer votre rémunération.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Info Alert */}
            <Alert>
              <Info className="w-4 h-4" />
              <div>
                <h4 className="font-semibold">Information</h4>
                <p className="text-sm">
                  Cette configuration détermine comment vos paiements sont calculés. 
                  Contactez l'administration pour modifier les paramètres principaux.
                </p>
              </div>
            </Alert>

            {/* Configuration Details */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Configuration de Paiement</CardTitle>
                    <CardDescription>
                      Détails de votre configuration actuelle
                    </CardDescription>
                  </div>
                  {!isEditing && (
                    <Button
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Modifier
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label>Type de Configuration</Label>
                        <div className="mt-2">
                          <Badge variant="default">
                            {getConfigTypeLabel(formData.configType || config.configType)}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          Le type de configuration ne peut pas être modifié
                        </p>
                      </div>

                      {(formData.configType === 'salary' || formData.configType === 'mixed') && (
                        <>
                          <div>
                            <Label htmlFor="monthlySalary">Salaire Mensuel (FCFA)</Label>
                            <Input
                              id="monthlySalary"
                              type="number"
                              value={formData.monthlySalary || ''}
                              onChange={(e) => setFormData({ ...formData, monthlySalary: parseFloat(e.target.value) || undefined })}
                              className="mt-2"
                              disabled
                            />
                            <p className="text-sm text-gray-500 mt-1">
                              Contactez l'administration pour modifier
                            </p>
                          </div>
                          <div>
                            <Label htmlFor="annualSalary">Salaire Annuel (FCFA)</Label>
                            <Input
                              id="annualSalary"
                              type="number"
                              value={formData.annualSalary || ''}
                              onChange={(e) => setFormData({ ...formData, annualSalary: parseFloat(e.target.value) || undefined })}
                              className="mt-2"
                              disabled
                            />
                          </div>
                        </>
                      )}

                      {(formData.configType === 'hourly' || formData.configType === 'mixed') && (
                        <div>
                          <Label htmlFor="defaultHourlyRate">Taux Horaire par Défaut (FCFA)</Label>
                          <Input
                            id="defaultHourlyRate"
                            type="number"
                            value={formData.defaultHourlyRate || ''}
                            onChange={(e) => setFormData({ ...formData, defaultHourlyRate: parseFloat(e.target.value) || undefined })}
                            className="mt-2"
                            disabled
                          />
                          <p className="text-sm text-gray-500 mt-1">
                            Contactez l'administration pour modifier
                          </p>
                        </div>
                      )}

                      <div>
                        <Label htmlFor="overtimeThreshold">Seuil d'Heures Supplémentaires</Label>
                        <Input
                          id="overtimeThreshold"
                          type="number"
                          value={formData.overtimeThreshold || config.overtimeThreshold}
                          onChange={(e) => setFormData({ ...formData, overtimeThreshold: parseInt(e.target.value) || 40 })}
                          className="mt-2"
                          disabled
                        />
                        <p className="text-sm text-gray-500 mt-1">
                          Nombre d'heures après lesquelles les heures supplémentaires s'appliquent
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="overtimeMultiplier">Multiplicateur d'Heures Supplémentaires</Label>
                        <Input
                          id="overtimeMultiplier"
                          type="number"
                          step="0.1"
                          value={formData.overtimeMultiplier || config.overtimeMultiplier}
                          onChange={(e) => setFormData({ ...formData, overtimeMultiplier: parseFloat(e.target.value) || 1.5 })}
                          className="mt-2"
                          disabled
                        />
                        <p className="text-sm text-gray-500 mt-1">
                          Multiplicateur appliqué au taux horaire pour les heures supplémentaires
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="effectiveFrom">Date d'Effet</Label>
                        <Input
                          id="effectiveFrom"
                          type="date"
                          value={formData.effectiveFrom ? formData.effectiveFrom.substring(0, 10) : config.effectiveFrom.substring(0, 10)}
                          className="mt-2"
                          disabled
                        />
                      </div>

                      {formData.effectiveTo && (
                        <div>
                          <Label htmlFor="effectiveTo">Date de Fin</Label>
                          <Input
                            id="effectiveTo"
                            type="date"
                            value={formData.effectiveTo ? formData.effectiveTo.substring(0, 10) : ''}
                            className="mt-2"
                            disabled
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        value={formData.notes || ''}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="mt-2 min-h-[100px]"
                        placeholder="Notes personnelles (optionnel)"
                      />
                    </div>

                    <div className="flex justify-end space-x-3">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditing(false);
                          setFormData(config);
                        }}
                        disabled={isSaving}
                      >
                        Annuler
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Enregistrement...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 mr-2" />
                            Enregistrer
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label className="text-gray-600">Type de Configuration</Label>
                        <div className="mt-2">
                          <Badge variant="default">
                            {getConfigTypeLabel(config.configType)}
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <Label className="text-gray-600">Date d'Effet</Label>
                        <p className="mt-2 text-gray-900">{formatDate(config.effectiveFrom)}</p>
                      </div>

                      {config.effectiveTo && (
                        <div>
                          <Label className="text-gray-600">Date de Fin</Label>
                          <p className="mt-2 text-gray-900">{formatDate(config.effectiveTo)}</p>
                        </div>
                      )}

                      {(config.configType === 'salary' || config.configType === 'mixed') && (
                        <>
                          {config.monthlySalary && (
                            <div>
                              <Label className="text-gray-600">Salaire Mensuel</Label>
                              <p className="mt-2 text-lg font-semibold text-gray-900">
                                {formatAmount(config.monthlySalary)}
                              </p>
                            </div>
                          )}
                          {config.annualSalary && (
                            <div>
                              <Label className="text-gray-600">Salaire Annuel</Label>
                              <p className="mt-2 text-lg font-semibold text-gray-900">
                                {formatAmount(config.annualSalary)}
                              </p>
                            </div>
                          )}
                        </>
                      )}

                      {(config.configType === 'hourly' || config.configType === 'mixed') && (
                        <div>
                          <Label className="text-gray-600">Taux Horaire par Défaut</Label>
                          <p className="mt-2 text-lg font-semibold text-gray-900">
                            {formatAmount(config.defaultHourlyRate || 0)}
                          </p>
                        </div>
                      )}

                      <div>
                        <Label className="text-gray-600">Seuil d'Heures Supplémentaires</Label>
                        <p className="mt-2 text-gray-900">{config.overtimeThreshold} heures</p>
                      </div>

                      <div>
                        <Label className="text-gray-600">Multiplicateur d'Heures Supplémentaires</Label>
                        <p className="mt-2 text-gray-900">{config.overtimeMultiplier}x</p>
                      </div>
                    </div>

                    {config.notes && (
                      <div>
                        <Label className="text-gray-600">Notes</Label>
                        <p className="mt-2 text-gray-900 bg-gray-50 p-4 rounded-lg">
                          {config.notes}
                        </p>
                      </div>
                    )}

                    <div className="pt-4 border-t">
                      <div className="flex items-center justify-between text-sm text-gray-500">
                        <span>Créé le {formatDate(config.createdAt)}</span>
                        <span>Mis à jour le {formatDate(config.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

