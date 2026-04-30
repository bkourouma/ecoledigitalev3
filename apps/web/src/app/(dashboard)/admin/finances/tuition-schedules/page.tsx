"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  Plus,
  Search,
  Calendar,
  Edit,
  Trash2,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { CreateScheduleForm } from "./components/CreateScheduleForm";
import { useTuitionSchedules, generateInstallments } from "@/lib/hooks/use-tuition-schedules";
import { toast } from "@/components/ui/use-toast";

export default function TuitionSchedulesPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedSchedule, setSelectedSchedule] = useState<any>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const handleEditExistingSchedule = async (scheduleId: string) => {
    try {
      const response = await fetch(`${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/tuition-schedules/${scheduleId}`, {
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "imhotepacademy",
          "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
        }
      });
      if (response.ok) {
        const result = await response.json();
        setSelectedSchedule(result.data);
      } else {
        toast({ 
          title: "Erreur", 
          description: "Impossible de charger l'échéancier existant", 
          variant: "destructive" as any 
        });
      }
    } catch (err) {
      console.error("Failed to load existing schedule:", err);
      toast({ 
        title: "Erreur", 
        description: "Impossible de charger l'échéancier existant", 
        variant: "destructive" as any 
      });
    }
  };

  // Load tuition schedules from API
  const {
    schedules,
    loading,
    error,
    refetch,
    deleteSchedule
  } = useTuitionSchedules();

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateString));
  };

  const filteredSchedules = (schedules || []).filter((schedule) => {
    const matchesSearch =
      schedule.scheduleName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (schedule.academicYearName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (schedule.cycleName || "Tous les cycles").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && schedule.isActive) ||
      (statusFilter === "inactive" && !schedule.isActive);

    return matchesSearch && matchesStatus;
  });

  const handleDeleteSchedule = async (scheduleId: string) => {
    try {
      await deleteSchedule(scheduleId);
      toast({
        title: "Echeancier supprime",
        description: "La suppression a ete effectuee avec succes.",
      });
    } catch (error) {
      console.error("Failed to delete schedule:", error);
      toast({
        title: "Suppression impossible",
        description: error instanceof Error ? error.message : "Une erreur est survenue pendant la suppression.",
        variant: "destructive" as any,
      });
    }
  };

  const handleCreateSuccess = () => {
    refetch(); // Refresh the list
  };

  const handleToggleStatus = (scheduleId: string) => {
    // Implement toggle status logic
    console.log("Toggle status for schedule:", scheduleId);
  };

  const handleGenerate = async (scheduleId: string) => {
    try {
      setGeneratingFor(scheduleId);
      const res = await generateInstallments({ scheduleId, overwriteExisting: false });
      const created = res?.data?.createdCount ?? 0;
      const updated = res?.data?.updatedCount ?? 0;
      toast({ title: "Échéances générées", description: `${created} créées / ${updated} mises à jour` });
    } catch (e) {
      console.error("Failed to generate installments", e);
      toast({ title: "Échec de génération", description: "Veuillez réessayer.", variant: "destructive" as any });
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-white">
            Échéanciers de Paiement
          </h1>
          <p className="mt-2 text-base font-normal text-white">
            Gérez les échéanciers de paiement pour les frais de scolarité
          </p>
        </div>
        <Button onClick={() => router.push("/admin/finances/tuition-schedules/new")}>
          <Plus className="h-4 w-4 mr-2" />
          Créer un Échéancier
        </Button>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="flex flex-col md:flex-row gap-4"
      >
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Rechercher par nom, année académique ou cycle..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="active">Actif</SelectItem>
            <SelectItem value="inactive">Inactif</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Schedules List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="space-y-6"
      >
        {loading ? (
          <Card>
            <CardContent className="text-center py-12">
              <div className="flex items-center justify-center space-x-2 text-gray-700 dark:text-gray-300">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 dark:border-blue-400 border-t-transparent" />
                <span>Chargement des échéanciers...</span>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="text-center py-12">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-500 dark:text-red-400" />
              <p className="text-red-600 dark:text-red-400 mb-4 font-medium">Erreur lors du chargement: {error}</p>
              <Button onClick={refetch} variant="outline">
                Réessayer
              </Button>
            </CardContent>
          </Card>
        ) : filteredSchedules.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
              <p className="text-gray-600 dark:text-gray-400 mb-4">Aucun échéancier trouvé</p>
              <Button onClick={() => router.push("/admin/finances/tuition-schedules/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Créer le premier échéancier
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredSchedules.map((schedule, index) => (
              <motion.div
                key={schedule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
              >
                <Card className="hover:shadow-md transition-shadow bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                  <CardHeader className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-gray-100 text-lg font-bold">
                          {schedule.scheduleName}
                          <Badge 
                            variant={schedule.isActive ? "default" : "secondary"}
                            className={schedule.isActive 
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40" 
                              : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }
                          >
                            {schedule.isActive ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Actif
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 mr-1" />
                                Inactif
                              </>
                            )}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-4 mt-2 text-gray-700 dark:text-gray-200">
                          <span className="font-medium">Année: <span className="font-normal">{schedule.academicYearName || "Non définie"}</span></span>
                          <span className="text-gray-400 dark:text-gray-500">•</span>
                          <span className="font-medium">Cycle: <span className="font-normal">{schedule.cycleName || "Tous les cycles"}</span></span>
                          <span className="text-gray-400 dark:text-gray-500">•</span>
                          <span className="flex items-center gap-1 font-medium">
                            <Users className="h-4 w-4" />
                            <span className="font-normal">{schedule.studentsCount || 0} étudiants</span>
                          </span>
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedSchedule(schedule)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerate(schedule.id)}
                          disabled={generatingFor === schedule.id}
                        >
                          {generatingFor === schedule.id ? (
                            <>
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mr-1" />
                              Génération...
                            </>
                          ) : (
                            <>
                              <Settings className="h-4 w-4 mr-1" />
                              Générer les Échéances
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-3 text-gray-900 dark:text-gray-100 text-base">Échéances de Paiement</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {schedule.installments.map((installment, idx) => (
                            <div
                              key={idx}
                              className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 border-gray-200"
                            >
                              <div className="flex justify-between items-start mb-2">
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                  {installment.label}
                                </span>
                                <Badge variant="outline" className="text-xs border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                                  {installment.percentage}%
                                </Badge>
                              </div>
                              <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-1 font-medium">
                                <Calendar className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                                {formatDate(installment.dueDate)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {!schedule.isActive && (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            Cet échéancier est inactif et ne sera pas appliqué aux nouveaux étudiants.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Edit Schedule Dialog */}
      {selectedSchedule && (
        <Dialog open={!!selectedSchedule} onOpenChange={() => setSelectedSchedule(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Modifier l'Échéancier</DialogTitle>
              <DialogDescription>
                Modifiez les paramètres de l'échéancier de paiement
              </DialogDescription>
            </DialogHeader>
            <CreateScheduleForm
              initialData={selectedSchedule}
              onSuccess={() => {
                setSelectedSchedule(null);
                refetch(); // Refresh data
              }}
              onCancel={() => setSelectedSchedule(null)}
              onEditExisting={handleEditExistingSchedule}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
