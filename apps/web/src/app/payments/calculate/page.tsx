"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Calculator, RefreshCcw, Users, DollarSign, Clock, Settings } from "lucide-react";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

interface PaymentPeriod {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "active" | "closed" | "archived";
}

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface ValidatedHour {
  id: string;
  teacherId: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  hoursValidated: number;
  hourlyRate?: number;
  amount?: number;
  date?: string; // Session date
}

interface TeacherPaymentConfig {
  id: string;
  teacherId: string;
  configType: 'salary' | 'hourly' | 'mixed';
  monthlySalary?: number;
  annualSalary?: number;
  defaultHourlyRate?: number;
}

interface PaymentCalculation {
  teacherId: string;
  teacherName: string;
  configType: 'salary' | 'hourly' | 'mixed';
  salaryAmount?: number;
  hourlyDetails: ValidatedHour[];
  totalHourlyAmount: number;
  bonusAmount: number;
  deductions: number;
  totalAmount: number;
}

interface BatchPaymentResult {
  teacherId?: string;
  teacherName?: string;
  status: "calculated" | "skipped" | "error" | string;
  paymentId?: string;
  paymentType?: "salary" | "hourly" | "mixed" | string;
  baseAmount?: number;
  overtimeAmount?: number;
  bonusAmount?: number;
  deductions?: number;
  regularHours?: number;
  overtimeHours?: number;
  totalHours?: number;
  totalAmount?: number;
  currency?: string;
  // Motif d'exclusion (feature 031) : sans lui, un enseignant non payé est
  // indiscernable d'un enseignant hors périmètre.
  skipReason?: "NO_CONFIG" | "NO_HOURS" | "OUT_OF_SCOPE" | "PAYMENT_LOCKED" | "NO_RATE_RESOLVED" | string;
  hoursBySource?: { academique?: number; professionnel?: number };
  error?: string;
  message?: string;
}

interface CalcResponse {
  data: {
    calculated: number;
    skipped: number;
    errors: number;
    results: BatchPaymentResult[];
  };
}

const FRENCH_MONTH_INDEX: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  février: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  août: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  décembre: 11,
};

const parsePeriodRangeFromName = (name: string): { fromDate: string; toDate: string } | null => {
  const trimmed = name.trim().toLowerCase();
  const match = trimmed.match(/^([a-zàâçéèêëîïôûùüÿñæœ]+)\s+(\d{4})$/i);
  if (!match) return null;

  const monthToken = match[1];
  const year = Number(match[2]);
  const monthIndex = FRENCH_MONTH_INDEX[monthToken];
  if (!Number.isFinite(year) || monthIndex === undefined) return null;

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    fromDate: start.toISOString().split("T")[0],
    toDate: end.toISOString().split("T")[0],
  };
};

const normalizePeriodDates = (period: PaymentPeriod): { fromDate: string; toDate: string } => {
  const dbFromDate = period.periodStart.split("T")[0];
  const dbToDate = period.periodEnd.split("T")[0];
  const from = new Date(period.periodStart);
  const to = new Date(period.periodEnd);
  const fromMonth = from.getUTCMonth();
  const toMonth = to.getUTCMonth();
  const fromYear = from.getUTCFullYear();
  const toYear = to.getUTCFullYear();

  const parsedFromName = parsePeriodRangeFromName(period.name);
  if (!parsedFromName) {
    return { fromDate: dbFromDate, toDate: dbToDate };
  }

  const nameFrom = new Date(parsedFromName.fromDate);
  const nameMonth = nameFrom.getUTCMonth();
  const nameYear = nameFrom.getUTCFullYear();
  const dbAlignedWithName =
    fromMonth === nameMonth &&
    toMonth === nameMonth &&
    fromYear === nameYear &&
    toYear === nameYear;

  return dbAlignedWithName ? { fromDate: dbFromDate, toDate: dbToDate } : parsedFromName;
};

const statusColors: Record<PaymentPeriod["status"], string> = {
  draft: "bg-gray-100 text-gray-800",
  active: "bg-green-100 text-green-800",
  closed: "bg-blue-100 text-blue-800",
  archived: "bg-red-100 text-red-800",
};

// Helper function to format FCFA amounts
const formatFCFA = (amount: number) => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA';
};

/**
 * Motifs d'exclusion du calcul (feature 031). Chacun appelle une action
 * différente du gestionnaire — d'où l'intérêt de les distinguer plutôt que
 * d'afficher « ignoré ».
 */
const SKIP_REASON_LABELS: Record<string, string> = {
  NO_CONFIG: "Sans configuration",
  NO_HOURS: "Aucune heure",
  OUT_OF_SCOPE: "Hors périmètre",
  PAYMENT_LOCKED: "Paiement verrouillé",
  NO_RATE_RESOLVED: "Tarif introuvable",
};

const toNumber = (value: unknown) => {
  const numberValue = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatPaymentType = (type?: string) => {
  if (type === "salary") return "Salaire";
  if (type === "hourly") return "Horaire";
  if (type === "mixed") return "Mixte";
  return "-";
};

export default function CalculatePaymentsPage() {
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const [periods, setPeriods] = useState<PaymentPeriod[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [paymentCalculation, setPaymentCalculation] = useState<PaymentCalculation | null>(null);
  const [allTeachersPreview, setAllTeachersPreview] = useState<PaymentCalculation[]>([]);
  const [loadingAllTeachersPreview, setLoadingAllTeachersPreview] = useState(false);
  const [result, setResult] = useState<CalcResponse["data"] | null>(null);
  // Check if there are teachers without payment configs
  const [teachersWithoutConfigs, setTeachersWithoutConfigs] = useState<string[]>([]);
  // Check if there are teachers who already have payments for the selected period
  const [teachersWithExistingPayments, setTeachersWithExistingPayments] = useState<string[]>([]);
  const [recalculateExisting, setRecalculateExisting] = useState(false);
  // Périmètre de collecte des heures (feature 031). « Tous » par défaut : le
  // bulletin d'un enseignant intervenant dans les deux modules doit les cumuler.
  const [calculationScope, setCalculationScope] = useState<"all" | "academique" | "professionnel">("all");
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [pRes, tRes] = await Promise.all([
          fetch("/api/v1/simple-payment-periods", { headers: createApiHeaders() }),
          fetch("/api/v1/teachers", { headers: createApiHeaders() }),
        ]);
        if (pRes.ok) {
          const p = await pRes.json();
          setPeriods(p.data || []);
          if (!selectedPeriodId && p.data?.length) setSelectedPeriodId(p.data[0].id);
        } else {
          toast({ title: "Erreur", description: "Impossible de charger les périodes", variant: "destructive" });
        }
        if (tRes.ok) {
          const t = await tRes.json();
          setTeachers(t.data || []);
        } else {
          toast({ title: "Erreur", description: "Impossible de charger les enseignants", variant: "destructive" });
        }
      } catch (e) {
        toast({ title: "Erreur", description: "Erreur de connexion", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activeAcademicYearId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load payment calculation when teacher is selected
  useEffect(() => {
    if (selectedTeacherId && selectedTeacherId !== "ALL" && selectedPeriodId) {
      loadTeacherPaymentCalculation();
    } else {
      setPaymentCalculation(null);
    }
  }, [selectedTeacherId, selectedPeriodId]);

  const teacherNameById = useMemo(() =>
    Object.fromEntries(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`])), [teachers]
  );

  // Filter teachers to show only those available for payment calculation
  const availableTeachers = useMemo(() => {
    return teachers.filter(teacher => {
      // Exclude teachers without payment configs
      if (teachersWithoutConfigs.includes(teacher.id)) {
        return false;
      }
      // Exclude teachers who already have payments for this period
      if (teachersWithExistingPayments.includes(teacher.id)) {
        return false;
      }
      return true;
    });
  }, [teachers, teachersWithoutConfigs, teachersWithExistingPayments]);

  const teachersToCalculate = useMemo(() => {
    if (selectedTeacherId !== "ALL") {
      return availableTeachers.filter((teacher) => teacher.id === selectedTeacherId);
    }

    if (recalculateExisting) {
      return teachers.filter((teacher) => !teachersWithoutConfigs.includes(teacher.id));
    }

    return availableTeachers;
  }, [availableTeachers, recalculateExisting, selectedTeacherId, teachers, teachersWithoutConfigs]);

  const buildTeacherPaymentCalculation = async (teacherId: string): Promise<PaymentCalculation | null> => {
    const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
    const teacher = teachers.find((t) => t.id === teacherId);

    if (!selectedPeriod || !teacher) return null;

    const { fromDate, toDate } = normalizePeriodDates(selectedPeriod);
    const configRes = await fetch(`/api/v1/teacher-payment-configs/teacher/${teacherId}/current?date=${toDate}`, {
      headers: createApiHeaders(),
    });

    if (!configRes.ok) return null;

    const configData = await configRes.json();
    const config = configData.data;

    if (!config) {
      return {
        teacherId,
        teacherName: `${teacher.firstName} ${teacher.lastName}`,
        configType: "salary",
        salaryAmount: 0,
        hourlyDetails: [],
        totalHourlyAmount: 0,
        bonusAmount: 0,
        deductions: 0,
        totalAmount: 0,
      };
    }

    const attendanceRes = await fetch(`/api/teacher/attendance?fromDate=${fromDate}&toDate=${toDate}&teacherId=${teacherId}`, {
      headers: { "Content-Type": "application/json" },
    });

    let validatedHours: ValidatedHour[] = [];
    if (attendanceRes.ok) {
      const attendanceData = await attendanceRes.json();
      const defaultHourlyRate = config.defaultHourlyRate || 15000;

      if (Array.isArray(attendanceData.data)) {
        validatedHours = attendanceData.data
          .filter((session: any) => session.validated && session.duration > 0)
          .map((session: any, index: number) => {
            const duration = toNumber(session.duration);
            const hourlyRate = defaultHourlyRate || toNumber(session.hourlyRate);

            return {
              id: session.id || `session-${index}`,
              teacherId,
              courseId: session.courseId || session.assignmentId,
              courseName: session.courseName || "Cours non défini",
              courseCode: session.courseCode || "",
              hoursValidated: duration,
              hourlyRate,
              amount: duration * hourlyRate,
              date: session.date,
            };
          });
      }
    }

    const totalHourlyAmount = validatedHours.reduce((sum, hour) => sum + toNumber(hour.amount), 0);
    const salaryAmount = config.configType === "salary" || config.configType === "mixed"
      ? toNumber(config.monthlySalary)
      : 0;

    return {
      teacherId,
      teacherName: `${teacher.firstName} ${teacher.lastName}`,
      configType: config.configType,
      salaryAmount,
      hourlyDetails: validatedHours,
      totalHourlyAmount,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: salaryAmount + totalHourlyAmount,
    };
  };

  useEffect(() => {
    if (selectedTeacherId !== "ALL" || !selectedPeriodId || teachersToCalculate.length === 0) {
      setAllTeachersPreview([]);
      return;
    }

    let cancelled = false;
    const loadPreview = async () => {
      setLoadingAllTeachersPreview(true);
      try {
        const preview = await Promise.all(
          teachersToCalculate.map((teacher) => buildTeacherPaymentCalculation(teacher.id))
        );

        if (!cancelled) {
          setAllTeachersPreview(preview.filter((item): item is PaymentCalculation => Boolean(item)));
        }
      } finally {
        if (!cancelled) {
          setLoadingAllTeachersPreview(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedTeacherId, selectedPeriodId, teachersToCalculate]);

  useEffect(() => {
    const checkTeachersWithoutConfigs = async () => {
      if (teachers.length === 0) return;
      
      try {
        console.log('Checking teachers without configs...');
        const res = await fetch('/api/v1/teacher-payment-configs', {
          headers: createApiHeaders(),
        });
        
        console.log('Response status:', res.status, res.statusText);
        
        if (res.ok) {
          const data = await res.json();
          console.log('Configs data:', data);
          const teachersWithConfigs = new Set(data.data.map((c: any) => c.teacherId));
          const withoutConfigs = teachers.filter(t => !teachersWithConfigs.has(t.id)).map(t => t.id);
          setTeachersWithoutConfigs(withoutConfigs);
          console.log('Teachers without configs:', withoutConfigs);
        } else {
          const errorText = await res.text();
          console.warn('Failed to fetch teacher payment configs:', res.status, res.statusText, errorText);
        }
      } catch (e) {
        console.warn('Could not check teachers without configs:', e);
        // Don't crash the component if this fails
      }
    };

    checkTeachersWithoutConfigs();
  }, [teachers]);

  // Check for existing payments when period changes
  useEffect(() => {
    const checkExistingPayments = async () => {
      if (!selectedPeriodId || teachers.length === 0) return;
      
      try {
        console.log('Checking existing payments for period:', selectedPeriodId);
        const res = await fetch(`/api/v1/teacher-payments?periodId=${selectedPeriodId}`, {
          headers: createApiHeaders(),
        });
        
        if (res.ok) {
          const data = await res.json();
          console.log('Existing payments data:', data);
          console.log('Number of payments returned:', data.data?.length || 0);
          const teachersWithPayments = new Set<string>((data.data || []).map((p: any) => p.teacherId).filter(Boolean));
          const uniqueTeachers = Array.from(teachersWithPayments);
          console.log('Unique teachers with payments:', uniqueTeachers);
          console.log('Count:', uniqueTeachers.length);
          setTeachersWithExistingPayments(uniqueTeachers);
        } else {
          const errorText = await res.text();
          console.warn('Failed to fetch existing payments:', res.status, res.statusText, errorText);
          setTeachersWithExistingPayments([]);
        }
      } catch (e) {
        console.warn('Could not check existing payments:', e);
        setTeachersWithExistingPayments([]);
      }
    };

    checkExistingPayments();
  }, [selectedPeriodId, teachers]);

  const loadTeacherPaymentCalculation = async () => {
    if (!selectedTeacherId || selectedTeacherId === "ALL" || !selectedPeriodId) return;

    setCalculating(true);
    try {
      // Get selected period dates
      const selectedPeriod = periods.find(p => p.id === selectedPeriodId);
      if (!selectedPeriod) {
        toast({ title: "Erreur", description: "Période non trouvée", variant: "destructive" });
        return;
      }

      // Keep range consistent when a period label (e.g. "Avril 2026")
      // does not match stored boundaries.
      const { fromDate, toDate } = normalizePeriodDates(selectedPeriod);

      // Get teacher payment config first (needed for hourly rate)
      console.log('Fetching payment config for teacher:', selectedTeacherId);
      const configRes = await fetch(`/api/v1/teacher-payment-configs/teacher/${selectedTeacherId}/current?date=${toDate}`, {
        headers: createApiHeaders(),
      });
      console.log('Config response status:', configRes.status, configRes.statusText);

      // Check if config response is successful (required for payment calculation)
      if (!configRes.ok) {
        toast({ title: "Erreur", description: "Impossible de charger la configuration de paiement", variant: "destructive" });
        return;
      }

      const configData = await configRes.json();
      const config = configData.data;
      const teacher = teachers.find(t => t.id === selectedTeacherId);

      if (!teacher) {
        toast({ title: "Erreur", description: "Enseignant non trouvé", variant: "destructive" });
        return;
      }

      if (!config) {
        // Teacher exists but has no payment config
          setPaymentCalculation({
            teacherId: selectedTeacherId,
            teacherName: `${teacher.firstName} ${teacher.lastName}`,
            configType: 'salary' as const, // Default to salary
            salaryAmount: 0,
            hourlyDetails: [],
            totalHourlyAmount: 0,
            bonusAmount: 0,
            deductions: 0,
            totalAmount: 0,
          });
        
        toast({ 
          title: "Configuration manquante", 
          description: `${teacher.firstName} ${teacher.lastName} n'a pas de configuration de paiement. Veuillez en créer une dans la section Configurations.`,
          variant: "destructive",
          duration: 8000
        });
        return;
      }

      // APERÇU PAR LE MOTEUR — plus de calcul parallèle ici.
      //
      // Cet écran recalculait les heures dans le navigateur à partir de la
      // seule chaîne académique (/api/teacher/attendance). Un enseignant du
      // Module Professionnel y ressortait donc à 0, alors que le calcul en lot
      // lui trouvait ses heures : deux calculs pour un même enseignant, deux
      // résultats. On interroge désormais le MÊME moteur que la validation, en
      // mode aperçu — il collecte les deux origines et résout les tarifs
      // exactement comme il le fera à l'enregistrement.
      const previewRes = await fetch("/api/v1/teacher-payments/calculate", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify({
          periodId: selectedPeriodId,
          teacherIds: [selectedTeacherId],
          scope: calculationScope,
          dryRun: true,
        }),
      });

      if (!previewRes.ok) {
        const err = await previewRes.json().catch(() => ({}));
        toast({
          title: "Calcul impossible",
          description: err.message || "Le moteur n'a pas pu calculer ce paiement.",
          variant: "destructive",
        });
        return;
      }

      const preview: CalcResponse = await previewRes.json();
      const ligne = (preview.data?.results || []).find(
        (r) => r.teacherId === selectedTeacherId
      );

      if (!ligne || ligne.status !== "preview") {
        // Le moteur a écarté cet enseignant : afficher SON motif plutôt qu'un
        // zéro muet, qui ne dit pas s'il manque une config, des heures ou un tarif.
        setPaymentCalculation({
          teacherId: selectedTeacherId,
          teacherName: `${teacher.firstName} ${teacher.lastName}`,
          configType: config.configType,
          salaryAmount: 0,
          hourlyDetails: [],
          totalHourlyAmount: 0,
          bonusAmount: 0,
          deductions: 0,
          totalAmount: 0,
        });
        toast({
          title: "Aucun montant calculé",
          description:
            ligne?.message ||
            (ligne?.skipReason ? SKIP_REASON_LABELS[ligne.skipReason] : undefined) ||
            "Aucune heure validée pour cet enseignant sur cette période.",
          variant: "destructive",
          duration: 8000,
        });
        return;
      }

      // Le détail du moteur alimente directement l'aperçu.
      const details: any[] = (ligne as any).hourDetails || [];
      const validatedHours: ValidatedHour[] = details.map((d: any, i: number) => ({
        id: d.seanceId || d.attendanceSessionId || `ligne-${i}`,
        teacherId: selectedTeacherId,
        courseId: d.seanceId || d.attendanceSessionId || "",
        courseName: d.intitule || "Séance",
        courseCode: d.code || "",
        hoursValidated: toNumber(d.hoursCount),
        hourlyRate: toNumber(d.hourlyRate),
        amount: toNumber(d.amount),
        date: d.sessionDate || undefined,
      }));
      const totalHourlyAmount = validatedHours.reduce((sum, h) => sum + (h.amount || 0), 0);

      // Part salariale = ce que le montant de base ne doit pas aux heures.
      // Vaut 0 en configuration horaire, le salaire prorata en salarié et mixte.
      const salaryAmount = Math.max(
        0,
        toNumber(ligne.baseAmount) + toNumber(ligne.overtimeAmount) - totalHourlyAmount
      );

      setPaymentCalculation({
        teacherId: selectedTeacherId,
        teacherName: ligne.teacherName || `${teacher.firstName} ${teacher.lastName}`,
        configType: (ligne.paymentType as any) || config.configType,
        salaryAmount,
        hourlyDetails: validatedHours,
        totalHourlyAmount,
        bonusAmount: 0,
        deductions: 0,
        totalAmount: salaryAmount + totalHourlyAmount,
      });
    } catch (e) {
      console.error('Error loading payment calculation:', e);
      toast({ title: "Erreur", description: "Erreur de connexion", variant: "destructive" });
    } finally {
      setCalculating(false);
    }
  };

  const handleCalculate = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sélection requise", description: "Veuillez choisir une période.", variant: "destructive" });
      return;
    }
    
    if (teachersToCalculate.length === 0) {
      toast({ title: "Aucun enseignant disponible", description: "Tous les enseignants ont déjà des paiements ou n'ont pas de configuration.", variant: "destructive" });
      return;
    }
    
    setCalculating(true);
    setResult(null);
    try {
      console.log('Starting calculation for period:', selectedPeriodId);
      console.log('Teachers to calculate:', teachersToCalculate.map(t => ({ id: t.id, name: `${t.firstName} ${t.lastName}` })));
      
      const res = await fetch("/api/v1/teacher-payments/calculate", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify({
          periodId: selectedPeriodId,
          teacherIds: teachersToCalculate.map(t => t.id),
          recalculate: recalculateExisting,
          scope: calculationScope,
        }),
      });

      console.log('Response status:', res.status, res.statusText);

      if (res.ok) {
        const data: CalcResponse = await res.json();
        console.log('Calculation result:', data);
        setResult(data.data);
        
        if (data.data.calculated === 0 && data.data.skipped === 0 && data.data.errors === 0) {
          toast({ 
            title: "Aucun calcul effectué", 
            description: "Aucun paiement n'a pu être calculé. Vérifiez que les enseignants ont des configurations et des heures validées.", 
            variant: "destructive",
            duration: 8000
          });
        } else {
          toast({ 
            title: "Calcul terminé", 
            description: `${data.data.calculated} calculé(s), ${data.data.skipped} ignoré(s), ${data.data.errors} erreur(s)` 
          });
        }
      } else {
        const errorText = await res.text();
        console.error('Calculation error:', res.status, errorText);
        let errorMessage = "Le calcul a échoué";
        try {
          const err = JSON.parse(errorText);
          errorMessage = err.message || err.error || errorMessage;
          console.error('Parsed error:', err);
        } catch {
          errorMessage = errorText || errorMessage;
          console.error('Error text (not JSON):', errorText);
        }
        toast({ 
          title: "Erreur de calcul", 
          description: errorMessage, 
          variant: "destructive",
          duration: 10000
        });
      }
    } catch (e) {
      console.error('Calculation exception:', e);
      const errorMessage = e instanceof Error ? e.message : "Erreur de connexion";
      toast({ 
        title: "Erreur", 
        description: errorMessage, 
        variant: "destructive",
        duration: 8000
      });
    } finally {
      setCalculating(false);
    }
  };

  const updateHourlyRate = (hourId: string, rate: number) => {
    if (!paymentCalculation) return;

    const updatedDetails = paymentCalculation.hourlyDetails.map(hour =>
      hour.id === hourId
        ? { ...hour, hourlyRate: rate, amount: hour.hoursValidated * rate }
        : hour
    );

    const totalHourlyAmount = updatedDetails.reduce((sum, hour) => sum + (hour.amount || 0), 0);

    setPaymentCalculation({
      ...paymentCalculation,
      hourlyDetails: updatedDetails,
      totalHourlyAmount,
      totalAmount: (paymentCalculation.salaryAmount || 0) + totalHourlyAmount,
    });
  };

  const updateAmount = (hourId: string, amount: number) => {
    if (!paymentCalculation) return;

    const updatedDetails = paymentCalculation.hourlyDetails.map(hour =>
      hour.id === hourId
        ? { ...hour, amount, hourlyRate: hour.hoursValidated > 0 ? amount / hour.hoursValidated : 0 }
        : hour
    );

    const totalHourlyAmount = updatedDetails.reduce((sum, hour) => sum + (hour.amount || 0), 0);

    setPaymentCalculation({
      ...paymentCalculation,
      hourlyDetails: updatedDetails,
      totalHourlyAmount,
      totalAmount: (paymentCalculation.salaryAmount || 0) + totalHourlyAmount + paymentCalculation.bonusAmount - paymentCalculation.deductions,
    });
  };

  const updateBonusAmount = (bonusAmount: number) => {
    if (!paymentCalculation) return;

    setPaymentCalculation({
      ...paymentCalculation,
      bonusAmount,
      totalAmount: (paymentCalculation.salaryAmount || 0) + paymentCalculation.totalHourlyAmount + bonusAmount - paymentCalculation.deductions,
    });
  };

  const updateDeductionsAmount = (deductions: number) => {
    if (!paymentCalculation) return;

    setPaymentCalculation({
      ...paymentCalculation,
      deductions,
      totalAmount: (paymentCalculation.salaryAmount || 0) + paymentCalculation.totalHourlyAmount + paymentCalculation.bonusAmount - deductions,
    });
  };

  const updateSalaryAmount = (amount: number) => {
    if (!paymentCalculation) return;

    setPaymentCalculation({
      ...paymentCalculation,
      salaryAmount: amount,
      totalAmount: amount + paymentCalculation.totalHourlyAmount + paymentCalculation.bonusAmount - paymentCalculation.deductions,
    });
  };

  const handleValidatePayment = async () => {
    if (!paymentCalculation || !selectedPeriodId) {
      toast({ title: "Erreur", description: "Données de paiement manquantes", variant: "destructive" });
      return;
    }

    setCalculating(true);
    try {
      // ENREGISTREMENT PAR LE MOTEUR.
      //
      // L'ancien chemin envoyait les montants calculés côté navigateur à
      // POST /teacher-payments, qui crée bien le paiement mais N'ÉCRIT AUCUNE
      // ligne de détail : le bulletin affichait un total que rien ne justifiait.
      // On laisse donc le moteur écrire paiement ET détail, puis on applique
      // par-dessus les seuls ajustements qui se saisissent à la main.
      const res = await fetch("/api/v1/teacher-payments/calculate", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify({
          periodId: selectedPeriodId,
          teacherIds: [paymentCalculation.teacherId],
          scope: calculationScope,
          recalculate: true,
        }),
      });

      const calcJson: CalcResponse = res.ok ? await res.json() : ({} as CalcResponse);
      const ligne = (calcJson.data?.results || []).find(
        (r) => r.teacherId === paymentCalculation.teacherId
      );

      if (res.ok && ligne?.status !== "calculated") {
        toast({
          title: "Paiement non enregistré",
          description:
            ligne?.message ||
            (ligne?.skipReason ? SKIP_REASON_LABELS[ligne.skipReason] : undefined) ||
            "Le moteur n'a produit aucun paiement pour cet enseignant.",
          variant: "destructive",
          duration: 8000,
        });
        return;
      }

      // Primes, retenues et correction éventuelle du montant de base. Le total
      // est recalculé côté serveur à partir de ces composantes.
      const aAjuster =
        paymentCalculation.bonusAmount > 0 ||
        paymentCalculation.deductions > 0 ||
        Math.abs(
          paymentCalculation.salaryAmount +
            paymentCalculation.totalHourlyAmount -
            (toNumber(ligne?.baseAmount) + toNumber(ligne?.overtimeAmount))
        ) > 0.5;

      if (res.ok && ligne?.paymentId && aAjuster) {
        const adjRes = await fetch(
          `/api/v1/teacher-payments/${ligne.paymentId}/adjustments`,
          {
            method: "PATCH",
            headers: createApiHeaders(),
            body: JSON.stringify({
              baseAmount:
                paymentCalculation.salaryAmount +
                paymentCalculation.totalHourlyAmount -
                toNumber(ligne.overtimeAmount),
              bonusAmount: paymentCalculation.bonusAmount,
              deductions: paymentCalculation.deductions,
            }),
          }
        );
        if (!adjRes.ok) {
          const err = await adjRes.json().catch(() => ({}));
          toast({
            title: "Paiement créé, ajustements refusés",
            description: err.message || "Primes et retenues n'ont pas pu être appliquées.",
            variant: "destructive",
            duration: 8000,
          });
        }
      }

      if (res.ok) {
        toast({
          title: "✅ Paiement validé",
          description: `Paiement de ${formatFCFA(paymentCalculation.totalAmount)} créé pour ${paymentCalculation.teacherName}`,
          duration: 5000
        });
        setPaymentCalculation(null);
        setSelectedTeacherId("ALL");
        
        // Refresh the existing payments list to hide this teacher
        const refreshRes = await fetch(`/api/v1/teacher-payments?periodId=${selectedPeriodId}`, {
          headers: createApiHeaders(),
        });
        
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const teachersWithPayments = new Set<string>((refreshData.data || []).map((p: any) => p.teacherId).filter(Boolean));
          setTeachersWithExistingPayments(Array.from(teachersWithPayments));
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Erreur", description: err.message || "Impossible de créer le paiement", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Erreur", description: "Erreur de connexion", variant: "destructive" });
    } finally {
      setCalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (periods.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="mb-4 text-gray-700">Aucune période de paiement trouvée.</p>
          <Button asChild>
            <Link href="/payments/periods">Créer une période</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const allTeachersPreviewTotals = allTeachersPreview.reduce(
    (totals, calculation) => {
      const hours = calculation.hourlyDetails.reduce((sum, hour) => sum + toNumber(hour.hoursValidated), 0);

      return {
        hours: totals.hours + hours,
        salaryAmount: totals.salaryAmount + toNumber(calculation.salaryAmount),
        totalHourlyAmount: totals.totalHourlyAmount + toNumber(calculation.totalHourlyAmount),
        bonusAmount: totals.bonusAmount + toNumber(calculation.bonusAmount),
        deductions: totals.deductions + toNumber(calculation.deductions),
        totalAmount: totals.totalAmount + toNumber(calculation.totalAmount),
      };
    },
    {
      hours: 0,
      salaryAmount: 0,
      totalHourlyAmount: 0,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: 0,
    }
  );
  const batchRows = (result?.results || []).map((row) => {
    const teacher = row.teacherId ? teachers.find((t) => t.id === row.teacherId) : undefined;
    const teacherName = row.teacherName && row.teacherName !== "Unknown"
      ? row.teacherName
      : row.teacherId && teacherNameById[row.teacherId]
        ? teacherNameById[row.teacherId]
        : teacher
          ? `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim()
          : row.teacherId || "Enseignant inconnu";

    return {
      ...row,
      teacherName,
      regularHours: toNumber(row.regularHours),
      overtimeHours: toNumber(row.overtimeHours),
      totalHours: toNumber(row.totalHours),
      baseAmount: toNumber(row.baseAmount),
      overtimeAmount: toNumber(row.overtimeAmount),
      bonusAmount: toNumber(row.bonusAmount),
      deductions: toNumber(row.deductions),
      totalAmount: toNumber(row.totalAmount),
    };
  });
  const batchTotals = batchRows.reduce(
    (totals, row) => ({
      regularHours: totals.regularHours + row.regularHours,
      overtimeHours: totals.overtimeHours + row.overtimeHours,
      totalHours: totals.totalHours + row.totalHours,
      baseAmount: totals.baseAmount + row.baseAmount,
      overtimeAmount: totals.overtimeAmount + row.overtimeAmount,
      bonusAmount: totals.bonusAmount + row.bonusAmount,
      deductions: totals.deductions + row.deductions,
      totalAmount: totals.totalAmount + row.totalAmount,
    }),
    {
      regularHours: 0,
      overtimeHours: 0,
      totalHours: 0,
      baseAmount: 0,
      overtimeAmount: 0,
      bonusAmount: 0,
      deductions: 0,
      totalAmount: 0,
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calculator className="w-6 h-6" /> Calcul des Paiements
          </h1>
          <p className="text-gray-600">Sélectionnez une période et un enseignant pour calculer son paiement, ou calculez tous les enseignants.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={async () => {
              if (selectedPeriodId) {
                const refreshRes = await fetch(`/api/v1/teacher-payments?periodId=${selectedPeriodId}`, {
                  headers: createApiHeaders(),
                });
                
                if (refreshRes.ok) {
                  const refreshData = await refreshRes.json();
                  const teachersWithPayments = new Set<string>((refreshData.data || []).map((p: any) => p.teacherId).filter(Boolean));
                  setTeachersWithExistingPayments(Array.from(teachersWithPayments));
                  toast({ title: "Liste mise à jour", description: "Liste des enseignants mise à jour" });
                }
              }
            }}
          >
            <RefreshCcw className="w-4 h-4 mr-2" /> Mettre à jour la liste
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            <RefreshCcw className="w-4 h-4 mr-2" /> Rafraîchir tout
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paramètres</CardTitle>
          <CardDescription>Choisissez la période et l'enseignant pour calculer le paiement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Summary of teacher status for the selected period */}
          {teachers.length > 0 && selectedPeriodId && (
            <div className="p-4 bg-gray-50 border rounded-lg">
              <h3 className="font-medium text-gray-900 mb-3">Résumé pour la période sélectionnée</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{teachers.length}</div>
                  <div className="text-gray-600">Total enseignants</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{availableTeachers.length}</div>
                  <div className="text-gray-600">Disponibles</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{teachersWithExistingPayments.length}</div>
                  <div className="text-gray-600">Déjà payés</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{teachersWithoutConfigs.length}</div>
                  <div className="text-gray-600">Sans config</div>
                </div>
              </div>
            </div>
          )}

          {/* Help message for teachers without payment configs and existing payments */}
          {teachers.length > 0 && (
            <div className="space-y-3">
              {/* Teachers without configs */}
              {teachersWithoutConfigs.length > 0 && (
                <div className="p-3 border rounded-lg bg-yellow-50 border-yellow-200">
                  <p className="text-sm text-yellow-700">
                    ⚠️ <strong>Attention:</strong> {teachersWithoutConfigs.length} enseignant(s) n'ont pas de configuration de paiement. 
                    Ils n'apparaîtront pas dans les calculs. 
                    <Link href="/payments/teacher-configs" className="underline ml-1 hover:text-yellow-900">
                      Configurer maintenant
                    </Link>
                  </p>
                </div>
              )}
              
              {/* Teachers with existing payments */}
              {teachersWithExistingPayments.length > 0 && (
                <div className="p-3 border rounded-lg bg-blue-50 border-blue-200">
                  <p className="text-sm text-blue-700">
                    ℹ️ <strong>Information:</strong> {teachersWithExistingPayments.length} enseignant(s) ont déjà des paiements pour cette période. 
                    Ils n'apparaîtront plus dans la liste de sélection.
                  </p>
                </div>
              )}
              
              {/* All teachers ready */}
              {teachersWithoutConfigs.length === 0 && teachersWithExistingPayments.length === 0 && (
                <div className="p-3 border rounded-lg bg-green-50 border-green-200">
                  <p className="text-sm text-green-700">
                    ✅ <strong>Parfait:</strong> Tous les enseignants sont prêts pour le calcul des paiements.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Période</Label>
              <div className="mt-2">
                <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une période" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        <span className="ml-2"><Badge className={statusColors[p.status]}>{p.status}</Badge></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedPeriod && (
                <p className="text-sm text-gray-500 mt-1">
                  Période du {new Date(selectedPeriod.periodStart).toLocaleDateString()} au {" "}
                  {new Date(selectedPeriod.periodEnd).toLocaleDateString()}
                </p>
              )}
            </div>

            <div>
              <Label>Enseignant</Label>
              <div className="mt-2">
                <Select value={selectedTeacherId} onValueChange={setSelectedTeacherId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un enseignant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Tous les enseignants</SelectItem>
                    {availableTeachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.firstName} {t.lastName} ({t.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Sélectionnez un enseignant pour voir le détail ou "Tous" pour calculer en masse.
              </p>
            </div>

            {/* Périmètre des heures collectées — feature 031. Un enseignant
                intervenant dans les deux modules reçoit un seul bulletin
                cumulant les deux origines, d'où « Tous » par défaut. */}
            <div>
              <Label className="text-sm font-medium">Périmètre des heures</Label>
              <Select
                value={calculationScope}
                onValueChange={(v) => setCalculationScope(v as "all" | "academique" | "professionnel")}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les modules</SelectItem>
                  <SelectItem value="academique">Académique uniquement</SelectItem>
                  <SelectItem value="professionnel">Professionnel uniquement</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-gray-500 mt-1">
                {calculationScope === "all"
                  ? "Heures académiques et professionnelles cumulées sur un seul bulletin."
                  : calculationScope === "academique"
                    ? "Séances de présence enseignant uniquement."
                    : "Séances d'ECUE validées uniquement."}
              </p>
            </div>
          </div>

          {selectedTeacherId === "ALL" && (
            <div className="space-y-3">
              {teachersWithExistingPayments.length > 0 && (
                <div className="flex items-center space-x-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <Checkbox
                    id="recalculate-existing"
                    checked={recalculateExisting}
                    onCheckedChange={(checked) => setRecalculateExisting(checked === true)}
                  />
                  <Label htmlFor="recalculate-existing" className="text-sm text-yellow-800 dark:text-yellow-200 cursor-pointer">
                    Recalculer les paiements existants ({teachersWithExistingPayments.length} enseignant(s) ont déjà un paiement)
                  </Label>
                </div>
              )}
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  {teachersToCalculate.length} enseignant(s) inclus dans le calcul
                </p>
                <Button onClick={handleCalculate} disabled={calculating || teachersToCalculate.length === 0}>
                  {calculating ? (
                    <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>Calcul en cours…</span>
                  ) : (
                    <span className="flex items-center"><Calculator className="w-4 h-4 mr-2" />Calculer {teachersToCalculate.length} enseignant(s)</span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedTeacherId === "ALL" && (
        <Card>
          <CardHeader>
            <CardTitle>Aperçu tous les enseignants</CardTitle>
            <CardDescription>Détails des heures validées, salaires, bonus et totaux pour la période sélectionnée.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border border-border/70">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/70 bg-muted/30">
                    <th className="py-3 px-3">Enseignant</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3 text-right">Heures validées</th>
                    <th className="py-3 px-3 text-right">Salaire / base</th>
                    <th className="py-3 px-3 text-right">Heures</th>
                    <th className="py-3 px-3 text-right">Bonus</th>
                    <th className="py-3 px-3 text-right">Déductions</th>
                    <th className="py-3 px-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAllTeachersPreview && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        Chargement des détails de rémunération...
                      </td>
                    </tr>
                  )}

                  {!loadingAllTeachersPreview && allTeachersPreview.map((calculation) => {
                    const hours = calculation.hourlyDetails.reduce((sum, hour) => sum + toNumber(hour.hoursValidated), 0);

                    return (
                      <tr key={calculation.teacherId} className="border-b border-border/60">
                        <td className="py-3 px-3 font-medium text-foreground">{calculation.teacherName}</td>
                        <td className="py-3 px-3">{formatPaymentType(calculation.configType)}</td>
                        <td className="py-3 px-3 text-right font-mono">{hours.toFixed(2)}h</td>
                        <td className="py-3 px-3 text-right font-mono">{formatFCFA(toNumber(calculation.salaryAmount))}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatFCFA(calculation.totalHourlyAmount)}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatFCFA(calculation.bonusAmount)}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatFCFA(calculation.deductions)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold">{formatFCFA(calculation.totalAmount)}</td>
                      </tr>
                    );
                  })}

                  {!loadingAllTeachersPreview && allTeachersPreview.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        Aucun détail disponible pour les enseignants sélectionnés.
                      </td>
                    </tr>
                  )}
                </tbody>
                {!loadingAllTeachersPreview && allTeachersPreview.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border bg-muted/40 font-semibold">
                      <td className="py-3 px-3" colSpan={2}>Totaux</td>
                      <td className="py-3 px-3 text-right font-mono">{allTeachersPreviewTotals.hours.toFixed(2)}h</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(allTeachersPreviewTotals.salaryAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(allTeachersPreviewTotals.totalHourlyAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(allTeachersPreviewTotals.bonusAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(allTeachersPreviewTotals.deductions)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(allTeachersPreviewTotals.totalAmount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Individual Teacher Payment Calculation */}
      {paymentCalculation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Calcul de Paiement - {paymentCalculation.teacherName}
            </CardTitle>
            <CardDescription>
              Type: {paymentCalculation.configType === 'salary' ? 'Salarié' : paymentCalculation.configType === 'hourly' ? 'Horaire' : 'Mixte'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Show warning if teacher has no payment config */}
            {paymentCalculation.totalAmount === 0 && paymentCalculation.configType === 'salary' && (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="w-5 h-5 text-yellow-600" />
                  <Label className="text-lg font-medium text-yellow-800">Configuration de paiement requise</Label>
                </div>
                <p className="text-sm text-yellow-700 mb-3">
                  Cet enseignant n'a pas de configuration de paiement. Veuillez créer une configuration pour définir son salaire.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/payments/teacher-configs">
                    <Settings className="w-4 h-4 mr-2" />
                    Configurer le Paiement
                  </Link>
                </Button>
              </div>
            )}
            {/* Salary Section */}
            {(paymentCalculation.configType === 'salary' || paymentCalculation.configType === 'mixed') && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-lg font-medium text-gray-900">Salaire Mensuel</Label>
                  <Badge variant="secondary">Salarié</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={paymentCalculation.salaryAmount || 0}
                    onChange={(e) => updateSalaryAmount(parseFloat(e.target.value) || 0)}
                    className="w-40 text-right"
                  />
                  <span className="text-sm text-gray-600">FCFA</span>
                </div>
              </div>
            )}

            {/* Hourly Details Section - Show for hourly and mixed config types */}
            {(paymentCalculation.configType === 'hourly' || paymentCalculation.configType === 'mixed') && (
              paymentCalculation.hourlyDetails.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5" />
                    <Label className="text-lg font-medium">Heures Validées</Label>
                    <Badge variant="outline">{paymentCalculation.hourlyDetails.length} séance(s)</Badge>
                  </div>

                  <div className="overflow-auto rounded-lg border border-border/70 bg-card/40">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-border/70 bg-muted/30">
                          <th className="py-2 pr-3">Cours</th>
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Heures</th>
                          <th className="py-2 pr-3">Taux Horaire</th>
                          <th className="py-2 pr-3">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentCalculation.hourlyDetails.map((hour) => (
                          <tr key={hour.id} className="border-b border-border/60">
                            <td className="py-2 pr-3">
                              <div>
                                <div className="font-medium text-foreground">{hour.courseName}</div>
                                <div className="text-muted-foreground text-xs">{hour.courseCode}</div>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {hour.date ? new Date(hour.date).toLocaleDateString('fr-FR') : '-'}
                            </td>
                            <td className="py-2 pr-3 text-foreground font-medium">{hour.hoursValidated}h</td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={hour.hourlyRate || 0}
                                  onChange={(e) => updateHourlyRate(hour.id, parseFloat(e.target.value) || 0)}
                                  className="w-24 h-8 text-right bg-background/80"
                                />
                                <span className="text-xs text-muted-foreground">FCFA/h</span>
                              </div>
                            </td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={hour.amount || 0}
                                  onChange={(e) => updateAmount(hour.id, parseFloat(e.target.value) || 0)}
                                  className="w-28 h-8 text-right bg-background/80"
                                />
                                <span className="text-xs text-muted-foreground">FCFA</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                // Show message for teachers with no hourly details
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <Label className="text-lg font-medium text-gray-600">Aucune heure validée</Label>
                  </div>
                  <p className="text-sm text-gray-500">
                    Aucune heure de cours n'a été validée pour cette période. Les heures validées apparaîtront ici une fois approuvées.
                  </p>
                </div>
              )
            )}

            {/* Bonus and Deductions Input */}
            <div className="pt-4 border-t border-border/70">
              <h4 className="text-lg font-semibold text-white mb-3">Ajustements Finaux</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="p-4 rounded-lg border border-purple-500/25 bg-purple-500/10">
                  <Label className="text-sm font-medium text-purple-300 mb-2 block">Bonus</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={paymentCalculation.bonusAmount}
                      onChange={(e) => updateBonusAmount(parseFloat(e.target.value) || 0)}
                      className="w-32 text-right bg-background/80"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">FCFA</span>
                  </div>
                  <p className="text-xs text-purple-200/90 mt-1">Montant bonus à ajouter</p>
                </div>
                
                <div className="p-4 rounded-lg border border-red-500/25 bg-red-500/10">
                  <Label className="text-sm font-medium text-red-300 mb-2 block">Déductions</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={paymentCalculation.deductions}
                      onChange={(e) => updateDeductionsAmount(parseFloat(e.target.value) || 0)}
                      className="w-32 text-right bg-background/80"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">FCFA</span>
                  </div>
                  <p className="text-xs text-red-200/90 mt-1">Montant à déduire</p>
                </div>
              </div>
            </div>

            {/* Total and Validation */}
            <div className="pt-4 border-t border-border/70">
              <div className="flex items-center justify-between mb-4">
                <div className="space-y-1">
                  {paymentCalculation.salaryAmount && (
                    <div className="text-sm text-muted-foreground">
                      Salaire: {formatFCFA(paymentCalculation.salaryAmount)}
                    </div>
                  )}
                  {paymentCalculation.totalHourlyAmount > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Heures: {formatFCFA(paymentCalculation.totalHourlyAmount)}
                    </div>
                  )}
                  {paymentCalculation.bonusAmount > 0 && (
                    <div className="text-sm text-purple-300">
                      Bonus: +{formatFCFA(paymentCalculation.bonusAmount)}
                    </div>
                  )}
                  {paymentCalculation.deductions > 0 && (
                    <div className="text-sm text-red-300">
                      Déductions: -{formatFCFA(paymentCalculation.deductions)}
                    </div>
                  )}
                  <div className="text-2xl font-bold text-foreground">
                    Total: {formatFCFA(paymentCalculation.totalAmount)}
                  </div>
                </div>
                <Button onClick={handleValidatePayment} disabled={calculating}>
                  {calculating ? (
                    <span className="flex items-center">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                      Validation...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <DollarSign className="w-4 h-4 mr-2" />
                      Valider le Paiement
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* Detailed Payment Breakdown */}
            <div className="pt-4 border-t">
              <div className="mb-4">
                <h4 className="text-lg font-semibold text-white mb-3">Détails du Paiement</h4>
                
                {/* Payment Summary Card */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <div className="font-medium text-gray-700">Montant de base</div>
                      <div className="text-lg font-bold text-green-700">
                        {formatFCFA(paymentCalculation.salaryAmount || 0)}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-700">Heures supplémentaires</div>
                      <div className="text-lg font-bold text-blue-700">
                        {formatFCFA(paymentCalculation.totalHourlyAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-700">Bonus</div>
                      <div className="text-lg font-bold text-purple-700">
                        {formatFCFA(paymentCalculation.bonusAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-700">Déductions</div>
                      <div className="text-lg font-bold text-red-700">
                        {formatFCFA(paymentCalculation.deductions)}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-700">Total net à payer</div>
                      <div className="text-xl font-bold text-green-800">
                        {formatFCFA(paymentCalculation.totalAmount)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detailed Payment Table */}
                <div className="overflow-auto">
                  <table className="w-full text-sm border border-gray-200 rounded-lg">
                    <thead>
                      <tr className="bg-gray-50 text-left text-gray-700">
                        <th className="py-3 px-4 border-b">Période</th>
                        <th className="py-3 px-4 border-b">Type</th>
                        <th className="py-3 px-4 border-b">Base</th>
                        <th className="py-3 px-4 border-b">H. Sup.</th>
                        <th className="py-3 px-4 border-b">Bonus</th>
                        <th className="py-3 px-4 border-b">Déductions</th>
                        <th className="py-3 px-4 border-b">Total</th>
                        <th className="py-3 px-4 border-b">Statut</th>
                        <th className="py-3 px-4 border-b">Date calcul</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-3 px-4 font-medium">
                          {selectedPeriod ? selectedPeriod.name : 'Période sélectionnée'}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={
                            paymentCalculation.configType === 'salary' ? 'secondary' :
                            paymentCalculation.configType === 'hourly' ? 'outline' : 'default'
                          }>
                            {paymentCalculation.configType === 'salary' ? 'salary' :
                             paymentCalculation.configType === 'hourly' ? 'hourly' : 'mixed'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatFCFA(paymentCalculation.salaryAmount || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatFCFA(paymentCalculation.totalHourlyAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatFCFA(paymentCalculation.bonusAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {formatFCFA(paymentCalculation.deductions)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-lg">
                          {formatFCFA(paymentCalculation.totalAmount)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                            Calculé
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {new Date().toLocaleDateString('fr-FR')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Additional Payment Information */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">Informations de l'Enseignant</h5>
                    <div className="space-y-1 text-sm text-gray-600">
                      <div><span className="font-medium">Nom:</span> {paymentCalculation.teacherName}</div>
                      <div><span className="font-medium">Type de contrat:</span> {
                        paymentCalculation.configType === 'salary' ? 'Salarié' :
                        paymentCalculation.configType === 'hourly' ? 'Horaire' : 'Mixte'
                      }</div>
                      <div><span className="font-medium">Période:</span> {selectedPeriod ? selectedPeriod.name : 'Non définie'}</div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-2">Détails du Calcul</h5>
                    <div className="space-y-1 text-sm text-gray-600">
                      <div><span className="font-medium">Salaire de base:</span> {formatFCFA(paymentCalculation.salaryAmount || 0)}</div>
                      <div><span className="font-medium">Heures validées:</span> {paymentCalculation.hourlyDetails.length} cours</div>
                      <div><span className="font-medium">Taux horaire moyen:</span> {
                        paymentCalculation.hourlyDetails.length > 0 
                          ? formatFCFA(paymentCalculation.hourlyDetails.reduce((sum, h) => sum + (h.hourlyRate || 0), 0) / paymentCalculation.hourlyDetails.length)
                          : 'N/A'
                      }</div>
                    </div>
                  </div>
                </div>

                {/* Payment Summary for Payslip */}
                <div className="mt-4 bg-white border border-gray-300 rounded-lg p-6">
                  <div className="text-center mb-4">
                    <h3 className="text-xl font-bold text-gray-900">Imhotep Academy - Bulletin de paie</h3>
                    <p className="text-sm text-gray-600">Généré le {new Date().toLocaleDateString('fr-FR')}</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                      <p className="text-sm text-gray-600"><span className="font-medium">Enseignant:</span> {paymentCalculation.teacherName}</p>
                      <p className="text-sm text-gray-600"><span className="font-medium">Périodes concernées:</span> {selectedPeriod ? selectedPeriod.name : 'Non définie'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600"><span className="font-medium">Type:</span> {
                        paymentCalculation.configType === 'salary' ? 'Salarié' :
                        paymentCalculation.configType === 'hourly' ? 'Horaire' : 'Mixte'
                      }</p>
                      <p className="text-sm text-gray-600"><span className="font-medium">Statut:</span> Calculé</p>
                    </div>
                  </div>
                  
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="font-medium text-gray-700">Montant de base</div>
                        <div className="text-lg font-bold text-green-700">
                          {formatFCFA(paymentCalculation.salaryAmount || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-gray-700">Heures supplémentaires</div>
                        <div className="text-lg font-bold text-blue-700">
                          {formatFCFA(paymentCalculation.totalHourlyAmount)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-gray-700">Bonus</div>
                        <div className="text-lg font-bold text-purple-700">
                          {formatFCFA(paymentCalculation.bonusAmount)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-gray-700">Déductions</div>
                        <div className="text-lg font-bold text-red-700">
                          {formatFCFA(paymentCalculation.deductions)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-gray-700">Total net à payer</div>
                        <div className="text-xl font-bold text-green-800">
                          {formatFCFA(paymentCalculation.totalAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700 text-center">
                    Document généré automatiquement. Valide sans signature.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats détaillés par enseignant</CardTitle>
            <CardDescription>
              {result.calculated} calculé(s), {result.skipped} ignoré(s), {result.errors} erreur(s). Les totaux sont affichés en bas du tableau.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border border-border/70">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/70 bg-muted/30">
                    <th className="py-3 px-3">Enseignant</th>
                    <th className="py-3 px-3">Statut</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3 text-right">Heures validées</th>
                    <th className="py-3 px-3 text-right">Heures sup.</th>
                    <th className="py-3 px-3 text-right">Salaire / base</th>
                    <th className="py-3 px-3 text-right">Heures</th>
                    <th className="py-3 px-3 text-right">Bonus</th>
                    <th className="py-3 px-3 text-right">Déductions</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, idx) => {
                    // Get teacher name from multiple sources
                    const teacher = r.teacherId ? teachers.find(t => t.id === r.teacherId) : undefined;
                    const teacherName = r.teacherName && r.teacherName !== "Unknown"
                      ? r.teacherName
                      : r.teacherId && teacherNameById[r.teacherId]
                        ? teacherNameById[r.teacherId]
                        : teacher
                          ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim()
                          : r.teacherId || "Enseignant inconnu";
                    
                    return (
                      <tr key={idx} className="border-t">
                        <td className="py-2 pr-3 font-medium">{teacherName}</td>
                        <td className="py-2 pr-3">
                          <Badge 
                            variant={r.status === "calculated" ? "default" : r.status === "skipped" ? "secondary" : "destructive"}
                            className="capitalize"
                          >
                            {r.status === "calculated" ? "Calculé" : r.status === "skipped" ? "Ignoré" : r.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{formatPaymentType(r.paymentType)}</td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {toNumber(r.totalHours).toFixed(2)}h
                          {/* Ventilation par origine : c'est elle qui rend
                              vérifiable qu'un enseignant du professionnel est
                              bien payé sur ses séances. */}
                          {r.hoursBySource &&
                            (toNumber(r.hoursBySource.academique) > 0 ||
                              toNumber(r.hoursBySource.professionnel) > 0) && (
                              <div className="text-[11px] text-gray-500 font-sans">
                                {toNumber(r.hoursBySource.academique) > 0 &&
                                  `acad. ${toNumber(r.hoursBySource.academique).toFixed(1)}h`}
                                {toNumber(r.hoursBySource.academique) > 0 &&
                                  toNumber(r.hoursBySource.professionnel) > 0 &&
                                  " · "}
                                {toNumber(r.hoursBySource.professionnel) > 0 &&
                                  `pro. ${toNumber(r.hoursBySource.professionnel).toFixed(1)}h`}
                              </div>
                            )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{toNumber(r.overtimeHours).toFixed(2)}h</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatFCFA(toNumber(r.baseAmount))}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatFCFA(toNumber(r.overtimeAmount))}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatFCFA(toNumber(r.bonusAmount))}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatFCFA(toNumber(r.deductions))}</td>
                        <td className="py-2 pr-3 font-mono">
                          {typeof r.totalAmount === "number" && r.totalAmount > 0 
                            ? formatFCFA(r.totalAmount) 
                            : "-"}
                        </td>
                        <td className="py-2 pr-3 text-sm text-gray-600">
                          {r.skipReason && (
                            <Badge variant="outline" className="mr-1 font-mono text-[10px]">
                              {SKIP_REASON_LABELS[r.skipReason] ?? r.skipReason}
                            </Badge>
                          )}
                          {r.error || r.message || ""}
                        </td>
                      </tr>
                    );
                  })}
                  {result.results.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-4 text-center text-gray-500">Aucun résultat</td>
                    </tr>
                  )}
                </tbody>
                {batchRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border bg-muted/40 font-semibold">
                      <td className="py-3 px-3" colSpan={3}>Totaux</td>
                      <td className="py-3 px-3 text-right font-mono">{batchTotals.totalHours.toFixed(2)}h</td>
                      <td className="py-3 px-3 text-right font-mono">{batchTotals.overtimeHours.toFixed(2)}h</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(batchTotals.baseAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(batchTotals.overtimeAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(batchTotals.bonusAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(batchTotals.deductions)}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatFCFA(batchTotals.totalAmount)}</td>
                      <td className="py-3 px-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
